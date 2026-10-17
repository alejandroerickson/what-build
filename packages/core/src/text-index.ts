import { sql } from "kysely";
import type { Db, TextField } from "./db.ts";

/**
 * The search index of what a source says: its title, tags, summary, notes, derived text and
 * comments, each cut into pieces that search matches one at a time
 * (okf/spec/08-search.md). Every write of one of those texts writes its pieces again in the same
 * transaction, so search never finds words a source no longer holds. Attachments are never in it.
 */

/** A piece runs to about this many characters: big enough to hold a thought, small enough for an excerpt near its words. */
export const CHUNK_CHARS = 1500;

export interface Chunk {
  /** Code points into the field's text, half-open. */
  char_start: number;
  char_end: number;
  text: string;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Where a too-long paragraph is cut: after a sentence, else at a line break or a space, else hard, never inside a surrogate pair. */
function cutAt(text: string, start: number, end: number): number {
  const limit = start + CHUNK_CHARS;
  if (end <= limit) return end;
  const window = text.slice(start, limit);
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf("\n"));
  if (sentence > CHUNK_CHARS / 2) return start + sentence + 1;
  const space = window.lastIndexOf(" ");
  if (space > CHUNK_CHARS / 2) return start + space + 1;
  return isHigh(text.charCodeAt(limit - 1)) && isLow(text.charCodeAt(limit)) ? limit - 1 : limit;
}

/**
 * A text in pieces of at most CHUNK_CHARS, cut at blank lines where it can be: neighbouring
 * paragraphs share a piece while they fit, and a longer paragraph is cut on its own. Each piece is
 * the text between its offsets exactly, so a hit maps back to where it is.
 */
export function chunkText(text: string): Chunk[] {
  // Paragraphs as UTF-16 ranges, without the blank lines between them.
  const paras: [number, number][] = [];
  const gap = /\n[ \t]*\n\s*/g;
  let at = 0;
  for (let m = gap.exec(text); m; m = gap.exec(text)) {
    if (m.index > at) paras.push([at, m.index]);
    at = m.index + m[0].length;
  }
  if (at < text.length) paras.push([at, text.length]);
  const ranges: [number, number][] = [];
  let open: [number, number] | null = null;
  for (const [s, e] of paras) {
    if (open && e - open[0] <= CHUNK_CHARS) {
      open[1] = e;
      continue;
    }
    if (open) ranges.push(open);
    open = null;
    if (e - s <= CHUNK_CHARS) {
      open = [s, e];
      continue;
    }
    for (let from = s; from < e; ) {
      const to = cutAt(text, from, e);
      ranges.push([from, to]);
      from = to;
    }
  }
  if (open) ranges.push(open);
  // UTF-16 offsets to code points, counted once along the text.
  const out: Chunk[] = [];
  let unit = 0;
  let point = 0;
  const advance = (to: number) => {
    for (; unit < to; unit++, point++) if (isHigh(text.charCodeAt(unit)) && isLow(text.charCodeAt(unit + 1)) && unit + 1 < to) unit++;
  };
  for (const [s, e] of ranges) {
    const piece = text.slice(s, e);
    if (!piece.trim()) continue;
    advance(s);
    const start = point;
    advance(e);
    out.push({ char_start: start, char_end: point, text: piece });
  }
  return out;
}

/** Hold the source while its pieces are written, so two writes of one text never interleave. */
async function lockSource(db: Db, recordId: string) {
  await sql`select 1 from records where record_id = ${recordId} for update`.execute(db);
}

async function writePieces(db: Db, tenantId: string, recordId: string, field: TextField, ref: string, text: string | null | undefined) {
  await db.deleteFrom("text_chunks").where("record_id", "=", recordId).where("field", "=", field).where("ref", "=", ref).execute();
  const chunks = text?.trim() ? chunkText(text) : [];
  for (let i = 0; i < chunks.length; i += 500)
    await db
      .insertInto("text_chunks")
      .values(chunks.slice(i, i + 500).map((c, k) => ({ tenant_id: tenantId, record_id: recordId, field, ref, n: i + k, ...c })))
      .execute();
}

/** Index one text of a source again, or remove it from the index when it is gone. A comment is named by its annotation_id. */
export async function indexText(db: Db, tenantId: string, recordId: string, field: TextField, text: string | null | undefined, ref = "") {
  await lockSource(db, recordId);
  await writePieces(db, tenantId, recordId, field, ref, text);
}

/** Index everything search reads of one source. */
export async function indexSource(db: Db, recordId: string): Promise<boolean> {
  await lockSource(db, recordId);
  const r = await db.selectFrom("records").select(["tenant_id", "title", "tags"]).where("record_id", "=", recordId).executeTakeFirst();
  if (!r) return false;
  await db.deleteFrom("text_chunks").where("record_id", "=", recordId).execute();
  await writePieces(db, r.tenant_id, recordId, "title", "", r.title);
  await writePieces(db, r.tenant_id, recordId, "tags", "", r.tags.join(", "));
  for (const n of await db.selectFrom("agent_notes").select(["kind", "content"]).where("record_id", "=", recordId).execute())
    await writePieces(db, r.tenant_id, recordId, n.kind, "", n.content);
  const text = await db.selectFrom("source_texts").select("content").where("record_id", "=", recordId).executeTakeFirst();
  await writePieces(db, r.tenant_id, recordId, "text", "", text?.content);
  for (const a of await db.selectFrom("annotations").select(["annotation_id", "note"]).where("record_id", "=", recordId).execute())
    await writePieces(db, r.tenant_id, recordId, "comment", a.annotation_id, a.note);
  return true;
}

/** Index every source of a product, or of the whole organization the transaction is scoped to. */
export async function indexSources(db: Db, scope: { product_id?: string }): Promise<number> {
  let q = db.selectFrom("records").select("record_id").orderBy("record_id");
  if (scope.product_id) q = q.where("product_id", "=", scope.product_id);
  const ids = (await q.execute()).map((r) => r.record_id);
  for (const id of ids) await indexSource(db, id);
  return ids.length;
}
