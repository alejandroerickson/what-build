import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { AppError, conflict, tooLarge, type BlobStat, type BlobStore } from "@whatbuild/core";

function checkKey(key: string) {
  if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes("..") || key.startsWith("/")) throw new Error(`invalid blob key ${key}`);
}

async function* limited(body: ReadableStream<Uint8Array>, maxBytes: number) {
  let n = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    n += value.byteLength;
    if (n > maxBytes) {
      await reader.cancel();
      throw tooLarge(`The upload is larger than this grant allows (${maxBytes} bytes).`, { limit: maxBytes });
    }
    yield value;
  }
}

/** Blobs on the local filesystem: the development default. Create-only, like every store. */
export class FsBlobStore implements BlobStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    checkKey(key);
    return join(this.root, key);
  }
  private async writeMeta(key: string, meta: { contentType: string; sha256: string; size: number }) {
    await writeFile(`${this.path(key)}.meta.json`, JSON.stringify(meta));
  }
  async put(key: string, data: Uint8Array, options: { contentType: string }) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    let fh;
    try {
      fh = await open(p, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw conflict("blob_exists", "Those bytes have already been stored.");
      throw e;
    }
    try {
      await fh.writeFile(data);
    } finally {
      await fh.close();
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    await this.writeMeta(key, { contentType: options.contentType, sha256, size: data.byteLength });
    return { size: data.byteLength, sha256 };
  }
  async putStream(key: string, body: ReadableStream<Uint8Array>, options: { contentType: string; maxBytes: number }) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    let fh;
    try {
      fh = await open(p, "wx");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw conflict("blob_exists", "Those bytes have already been stored.");
      throw e;
    }
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of limited(body, options.maxBytes)) {
        hash.update(chunk);
        size += chunk.byteLength;
        await fh.write(chunk);
      }
    } catch (e) {
      await fh.close();
      await rm(p, { force: true });
      throw e;
    }
    await fh.close();
    const sha256 = hash.digest("hex");
    await this.writeMeta(key, { contentType: options.contentType, sha256, size });
    return { size, sha256 };
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new AppError(404, "blob_missing", `Stored bytes for ${key} are missing.`);
      throw e;
    }
  }
  async getStream(key: string, range?: { start: number; end?: number }) {
    const p = this.path(key);
    const s = await stat(p);
    if (range && range.start >= s.size) return new ReadableStream<Uint8Array>({ start: (c) => c.close() });
    const node = createReadStream(p, range ? { start: range.start, ...(range.end !== undefined ? { end: range.end } : {}) } : {});
    return Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;
  }
  async stat(key: string): Promise<BlobStat | null> {
    try {
      const s = await stat(this.path(key));
      let meta: { contentType?: string; sha256?: string } = {};
      try {
        meta = JSON.parse(await readFile(`${this.path(key)}.meta.json`, "utf8"));
      } catch {
        meta = {};
      }
      return { size: s.size, contentType: meta.contentType ?? null, sha256: meta.sha256 ?? null };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
    await rm(`${this.path(key)}.meta.json`, { force: true });
  }
}

/** In-memory blobs for tests. */
export class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, { data: Uint8Array; contentType: string; sha256: string }>();
  async put(key: string, data: Uint8Array, options: { contentType: string }) {
    checkKey(key);
    if (this.blobs.has(key)) throw conflict("blob_exists", "Those bytes have already been stored.");
    const sha256 = createHash("sha256").update(data).digest("hex");
    this.blobs.set(key, { data: new Uint8Array(data), contentType: options.contentType, sha256 });
    return { size: data.byteLength, sha256 };
  }
  async putStream(key: string, body: ReadableStream<Uint8Array>, options: { contentType: string; maxBytes: number }) {
    const chunks: Uint8Array[] = [];
    for await (const c of limited(body, options.maxBytes)) chunks.push(c);
    return this.put(key, Buffer.concat(chunks), options);
  }
  async get(key: string) {
    const b = this.blobs.get(key);
    if (!b) throw new AppError(404, "blob_missing", `Stored bytes for ${key} are missing.`);
    return b.data;
  }
  async getStream(key: string, range?: { start: number; end?: number }) {
    const data = await this.get(key);
    const slice = range ? data.slice(range.start, range.end === undefined ? undefined : range.end + 1) : data;
    return new ReadableStream<Uint8Array>({
      start(c) {
        if (slice.byteLength) c.enqueue(slice);
        c.close();
      },
    });
  }
  async stat(key: string) {
    const b = this.blobs.get(key);
    return b ? { size: b.data.byteLength, contentType: b.contentType, sha256: b.sha256 } : null;
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
}
