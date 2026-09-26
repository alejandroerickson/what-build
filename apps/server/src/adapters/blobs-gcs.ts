import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Storage, type Bucket } from "@google-cloud/storage";
import { AppError, conflict, tooLarge, type BlobStat, type BlobStore } from "@whatbuild/core";

/**
 * Google Cloud Storage, reached with the runtime's own identity — no keys in configuration.
 * The only file in the codebase that imports the GCS SDK. Every write is create-only
 * (ifGenerationMatch: 0), so a replayed upload can never overwrite stored bytes.
 */
export class GcsBlobStore implements BlobStore {
  private readonly bucket: Bucket;
  readonly signedUploadUrl?: BlobStore["signedUploadUrl"];
  readonly signedDownloadUrl?: BlobStore["signedDownloadUrl"];

  constructor(bucketName: string, signedUrls: boolean) {
    this.bucket = new Storage().bucket(bucketName);
    if (signedUrls) {
      this.signedUploadUrl = async (key, contentType, expiresAt) => {
        const [url] = await this.bucket.file(key).getSignedUrl({
          version: "v4",
          action: "write",
          expires: expiresAt,
          contentType,
          extensionHeaders: { "x-goog-if-generation-match": "0" },
        });
        return { url, headers: { "Content-Type": contentType, "x-goog-if-generation-match": "0" } };
      };
      this.signedDownloadUrl = async (key, fileName, contentType, expiresAt) => {
        const [url] = await this.bucket.file(key).getSignedUrl({
          version: "v4",
          action: "read",
          expires: expiresAt,
          responseDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          responseType: contentType,
        });
        return url;
      };
    }
  }

  private isPrecondition(e: unknown) {
    return (e as { code?: number }).code === 412;
  }

  async put(key: string, data: Uint8Array, options: { contentType: string }) {
    const sha256 = createHash("sha256").update(data).digest("hex");
    try {
      await this.bucket.file(key).save(Buffer.from(data), {
        resumable: false,
        contentType: options.contentType,
        metadata: { metadata: { sha256 } },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (e) {
      if (this.isPrecondition(e)) throw conflict("blob_exists", "Those bytes have already been stored.");
      throw e;
    }
    return { size: data.byteLength, sha256 };
  }

  async putStream(key: string, body: ReadableStream<Uint8Array>, options: { contentType: string; maxBytes: number }) {
    const hash = createHash("sha256");
    let size = 0;
    const file = this.bucket.file(key);
    const source = Readable.fromWeb(body as never);
    source.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      hash.update(chunk);
      if (size > options.maxBytes) source.destroy(tooLarge(`The upload is larger than this grant allows (${options.maxBytes} bytes).`, { limit: options.maxBytes }));
    });
    try {
      await pipeline(source, file.createWriteStream({ resumable: false, contentType: options.contentType, preconditionOpts: { ifGenerationMatch: 0 } }));
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (this.isPrecondition(e)) throw conflict("blob_exists", "Those bytes have already been stored.");
      throw e;
    }
    const sha256 = hash.digest("hex");
    await file.setMetadata({ metadata: { sha256 } });
    return { size, sha256 };
  }

  async get(key: string) {
    try {
      const [buf] = await this.bucket.file(key).download();
      return new Uint8Array(buf);
    } catch (e) {
      if ((e as { code?: number }).code === 404) throw new AppError(404, "blob_missing", `Stored bytes for ${key} are missing.`);
      throw e;
    }
  }

  async getStream(key: string, range?: { start: number; end?: number }) {
    const s = await this.stat(key);
    if (!s) throw new AppError(404, "blob_missing", `Stored bytes for ${key} are missing.`);
    if (range && range.start >= s.size) return new ReadableStream<Uint8Array>({ start: (c) => c.close() });
    const node = this.bucket.file(key).createReadStream(range ? { start: range.start, ...(range.end !== undefined ? { end: range.end } : {}) } : {});
    return Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;
  }

  async stat(key: string): Promise<BlobStat | null> {
    try {
      const [m] = await this.bucket.file(key).getMetadata();
      return { size: Number(m.size ?? 0), contentType: (m.contentType as string) ?? null, sha256: ((m.metadata as Record<string, string> | undefined)?.["sha256"]) ?? null };
    } catch (e) {
      if ((e as { code?: number }).code === 404) return null;
      throw e;
    }
  }

  async delete(key: string) {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}
