import { currentReading, extensionOf, isImage } from "@whatbuild/parsers";
import { sql } from "kysely";
import type { AttachmentPicturesTable, Tx } from "./db.ts";
import type { Ports, PictureSource } from "./ports.ts";
import { newId } from "./util.ts";

export const PICTURE_GRANT_PURPOSE = "picture";
/** Where a picture is served: `GET <route>/<grant>`, by the address `sources.list` gives. */
export const PICTURE_ROUTE = "/api/v1/pictures";
/** The two copies of a picture, beside each other under the row's `blob_prefix`. */
export const PICTURE_FILES = { thumb: "thumb.webp", preview: "preview.webp" } as const;
export type PictureSize = keyof typeof PICTURE_FILES;
const DECK_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
/** How long at least an address given now keeps working. */
const PICTURE_GRANT_SECONDS = 3 * 3600;

/** What an attachment's picture is made from, or null for one the worker makes none of (a video's is sent by a browser or an agent). */
export function pictureSource(path: string, mediaType: string | null): PictureSource | null {
  const type = (mediaType ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = extensionOf(path);
  if (type === "image/svg+xml" || ext === ".svg") return null;
  if (isImage(path, type)) return "image";
  if (type === "application/pdf" || ext === ".pdf") return "pdf";
  if (type === DECK_MEDIA_TYPE || ext === ".pptx") return "deck";
  return null;
}

/**
 * The address of one copy of a picture: a grant for that one copy, naming nobody. It costs no call
 * and no bytes of anyone's day, a browser may keep it, and its expiry is rounded up to the hour so
 * that it stays the same address, and a list loaded again finds it cached. Someone who holds an
 * address keeps reaching that one copy until it expires, whatever happens to their access.
 */
export function pictureAddress(ports: Pick<Ports, "grants">, blobPrefix: string, size: PictureSize, now: string): string {
  const exp = Math.ceil(Date.parse(now) / 3600_000) * 3600 + PICTURE_GRANT_SECONDS;
  return `${PICTURE_ROUTE}/${ports.grants.sign({ v: 1, purpose: PICTURE_GRANT_PURPOSE, k: `${blobPrefix}/${PICTURE_FILES[size]}`, exp })}`;
}

/** An attachment's picture as `sources.list` gives it: its addresses, or the card a deck has instead. */
export interface PictureSeen {
  made_from: AttachmentPicturesTable["made_from"];
  thumb_url: string | null;
  preview_url: string | null;
  width: number | null;
  height: number | null;
  pages: number | null;
  card: { title: string; colour: string | null } | null;
}

/** The pictures of these attachment versions that have something to show, by version. */
export async function picturesOf(db: Tx, ports: Pick<Ports, "grants">, versionIds: string[], now: string): Promise<Map<string, PictureSeen>> {
  if (!versionIds.length) return new Map();
  const rows = await db.selectFrom("attachment_pictures").selectAll().where("file_version_id", "in", versionIds).execute();
  const seen = new Map<string, PictureSeen>();
  for (const p of rows) {
    const ready = p.status === "ready" && p.blob_prefix;
    if (!ready && !p.card_title && !p.pages) continue;
    seen.set(p.file_version_id, {
      made_from: p.made_from,
      thumb_url: ready ? pictureAddress(ports, p.blob_prefix!, "thumb", now) : null,
      preview_url: ready ? pictureAddress(ports, p.blob_prefix!, "preview", now) : null,
      width: p.width,
      height: p.height,
      pages: p.pages,
      card: p.card_title ? { title: p.card_title, colour: p.card_colour } : null,
    });
  }
  return seen;
}

/** The picture folders of what is about to go, to release with the rest of its bytes. */
export async function picturePrefixes(db: Tx, where: { record_ids: string[] } | { tenant_id: string }): Promise<string[]> {
  if ("record_ids" in where && !where.record_ids.length) return [];
  let q = db.selectFrom("attachment_pictures").select("blob_prefix").where("blob_prefix", "is not", null);
  q = "record_ids" in where ? q.where("record_id", "in", where.record_ids) : q.where("tenant_id", "=", where.tenant_id);
  return (await q.execute()).map((r) => r.blob_prefix!);
}

/** What a `make_picture` job says. `frame_key` is a frame someone sent, to use for this video. */
export interface PictureJob {
  tenant_id: string;
  record_id: string;
  file_version_id: string;
  frame_key?: string | undefined;
}

/**
 * Makes one attachment version's picture and records what came of it. A version keeps the picture
 * it has, except that a frame someone sends replaces a frame sent before. Nothing is recorded when
 * the file has gone, or this deployment makes no pictures. A file past what a parse may hold in
 * memory is passed over with its reason; a thrown `ParseInterrupted` or `ParseStopped` records
 * nothing, and the job is tried again.
 */
export async function runPicture(db: Tx, ports: Pick<Ports, "blobs" | "pictures" | "config">, job: PictureJob): Promise<AttachmentPicturesTable["status"] | null> {
  if (!ports.pictures) return null;
  const version = await db
    .selectFrom("file_versions as v")
    .innerJoin("files as f", "f.file_id", "v.file_id")
    .select(["v.blob_key", "v.size", "v.media_type", "f.path"])
    .where("v.file_version_id", "=", job.file_version_id)
    .executeTakeFirst();
  if (!version) return null;
  const had = await db.selectFrom("attachment_pictures").select(["blob_prefix", "made_from"]).where("file_version_id", "=", job.file_version_id).executeTakeFirst();
  if (had && !job.frame_key) return null;
  const source = job.frame_key ? "image" : pictureSource(version.path, version.media_type);
  if (!source) return null;
  // A file that was too much to read is too much to draw: reading a PDF is the cheaper of the two.
  // Said as a reading made now would say it: older readings recorded a scan as failed, and a scan is
  // where a picture matters most.
  if (!job.frame_key) {
    const reading = await db.selectFrom("derivations").select(["status", "status_detail"]).where("file_version_id", "=", job.file_version_id).orderBy("derivation_id", "desc").limit(1).executeTakeFirst();
    if (reading && currentReading(reading.status, reading.status_detail).status === "failed") {
      await db.insertInto("attachment_pictures").values({ file_version_id: job.file_version_id, tenant_id: job.tenant_id, record_id: job.record_id, status: "none", detail: "reading the file failed, so no picture was made of it", made_from: source }).onConflict((c) => c.doNothing()).execute();
      return "none";
    }
  }
  const madeFrom: AttachmentPicturesTable["made_from"] = job.frame_key ? "frame" : source;

  const size = job.frame_key ? (await ports.blobs.stat(job.frame_key))?.size : Number(version.size);
  if (size === undefined) return null;
  const made =
    size > ports.config.parseCapBytes
      ? { status: "none" as const, detail: `the file is ${size} bytes, past the ${ports.config.parseCapBytes} a picture is made from`, thumb: null, preview: null, width: null, height: null, pages: null, card: null }
      : await ports.pictures.make(await ports.blobs.get(job.frame_key ?? version.blob_key), source);

  let prefix: string | null = null;
  if (made.status === "ready" && made.thumb && made.preview) {
    prefix = `t/${job.tenant_id}/r/${job.record_id}/p/${newId()}`;
    await ports.blobs.put(`${prefix}/${PICTURE_FILES.thumb}`, made.thumb, { contentType: "image/webp" });
    await ports.blobs.put(`${prefix}/${PICTURE_FILES.preview}`, made.preview, { contentType: "image/webp" });
  }
  // A frame that could not be used leaves the picture there was.
  if (job.frame_key && !prefix && had) return made.status;
  const row = {
    status: made.status, detail: made.detail, made_from: madeFrom, blob_prefix: prefix, width: made.width, height: made.height, pages: made.pages,
    card_title: made.card?.title ?? null, card_colour: made.card?.colour ?? null, made_at: new Date().toISOString(),
  };
  await db
    .insertInto("attachment_pictures")
    .values({ file_version_id: job.file_version_id, tenant_id: job.tenant_id, record_id: job.record_id, ...row })
    .onConflict((c) => c.column("file_version_id").doUpdateSet(row))
    .execute();
  if (had?.blob_prefix) await sql`insert into jobs (tenant_id, kind, payload) values (${job.tenant_id}, 'delete_blobs', ${JSON.stringify({ keys: [], prefixes: [had.blob_prefix] })}::jsonb)`.execute(db);
  return made.status;
}
