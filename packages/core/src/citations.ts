import { z } from "zod";
import type { CitationSnapshot } from "./db.ts";
import { invalid } from "./errors.ts";
import { productId } from "./common.ts";
import type { OpContext } from "./registry.ts";
import { id } from "./schemas.ts";
import { canonicalJson, sha256Hex, uniq } from "./util.ts";

/**
 * Citations: exact passages of a source, frozen as snapshots when written. Register entries and
 * Story page versions both cite this way, with the same input, limits, snapshot and drift check.
 */

export const CITATION_MAX_SEGMENTS = 100;
/** At most this many citations on one entry or one page version. */
export const CITATION_MAX_COUNT = 20;
/** The quotes of one entry or one page version together stay under this many characters. */
export const QUOTE_BUDGET = 40_000;

export const citationInput = z.strictObject({
  record_id: id("source"),
  seq_start: z.number().int().min(0),
  seq_end: z.number().int().min(0),
  quote: z.string().min(1).max(10_000).optional().describe("Optional exact words that must occur within the range's text; stored as the citation's quote."),
});

export type CitationInput = z.output<typeof citationInput>;

/** Resolve a caller's citation against the source's current passages and freeze a snapshot of it. */
export async function snapshotCitation(ctx: OpContext, c: CitationInput): Promise<CitationSnapshot> {
  if (c.seq_end < c.seq_start) throw invalid("invalid_citation", `Citation to ${c.record_id}: seq_end must not be before seq_start.`);
  if (c.seq_end - c.seq_start + 1 > CITATION_MAX_SEGMENTS) throw invalid("invalid_citation", `A citation covers at most ${CITATION_MAX_SEGMENTS} segments; cite the narrowest passage that supports the claim.`);
  const r = await ctx.db.selectFrom("records").select(["record_id", "product_id", "archived_at", "current_derivation_id", "title"]).where("record_id", "=", c.record_id).executeTakeFirst();
  if (!r || r.product_id !== productId(ctx)) throw invalid("invalid_citation", `Source ${c.record_id} does not exist in this product.`);
  if (r.archived_at) throw invalid("invalid_citation", `Source ${c.record_id} is archived; a new citation cannot point at it.`);
  if (!r.current_derivation_id) throw invalid("invalid_citation", `Source ${c.record_id} has no passages yet.`);
  const d = await ctx.db.selectFrom("derivations").select(["derivation_id", "status", "file_version_id", "source_path"]).where("derivation_id", "=", r.current_derivation_id).executeTakeFirstOrThrow();
  if (d.status !== "ready") throw invalid("invalid_citation", `Source ${c.record_id} has no passages (${d.status}).`);
  const segs = await ctx.db
    .selectFrom("segments")
    .select(["seq", "text", "speaker", "start_ms", "end_ms", "char_start", "char_end"])
    .where("derivation_id", "=", d.derivation_id)
    .where("seq", ">=", c.seq_start)
    .where("seq", "<=", c.seq_end)
    .orderBy("seq")
    .execute();
  if (segs.length !== c.seq_end - c.seq_start + 1) throw invalid("invalid_citation", `Segments ${c.seq_start}–${c.seq_end} do not exist in full in source ${c.record_id}.`);
  const rangeText = segs.map((s) => s.text).join("\n\n");
  if (c.quote !== undefined && !rangeText.includes(c.quote))
    throw invalid("quote_not_found", `The quote does not occur in segments ${c.seq_start}–${c.seq_end} of source ${c.record_id}. Read the passage and quote it exactly, or omit quote.`);
  const quote = c.quote ?? rangeText;
  const anchors = segs.map((s) => ({ ...s, start_ms: s.start_ms === null ? null : Number(s.start_ms), end_ms: s.end_ms === null ? null : Number(s.end_ms) }));
  return {
    record_id: c.record_id,
    seq_start: c.seq_start,
    seq_end: c.seq_end,
    char_start: segs[0]!.char_start,
    char_end: segs[segs.length - 1]!.char_end,
    start_ms: anchors[0]!.start_ms,
    end_ms: anchors[anchors.length - 1]!.end_ms,
    speakers: uniq(segs.map((s) => s.speaker).filter((s): s is string => Boolean(s))),
    source_file: d.source_path,
    file_version_id: d.file_version_id,
    derivation_id: d.derivation_id,
    quote,
    quote_hash: sha256Hex(quote),
    anchors_hash: sha256Hex(canonicalJson(anchors)),
    captured_at: ctx.now,
  };
}

/** Snapshot every citation of one entry or page version, within the shared quote budget. */
export async function snapshotAll(ctx: OpContext, citations: CitationInput[], what = "entry"): Promise<CitationSnapshot[]> {
  const out: CitationSnapshot[] = [];
  for (const c of citations) out.push(await snapshotCitation(ctx, c));
  if (out.reduce((n, c) => n + c.quote.length, 0) > QUOTE_BUDGET)
    throw invalid("invalid_citation", `The quotes in one ${what} total at most ${QUOTE_BUDGET} characters; narrow the ranges.`);
  return out;
}

/** Stored snapshots as readers see them: numbered, with each source's current title. */
export async function citationViews(ctx: OpContext, citations: CitationSnapshot[]) {
  const titles = citations.length
    ? await ctx.db.selectFrom("records").select(["record_id", "title", "archived_at"]).where("record_id", "in", uniq(citations.map((c) => c.record_id))).where("product_id", "=", productId(ctx)).execute()
    : [];
  return citations.map((c, index) => ({ index, ...c, source_title: titles.find((t) => t.record_id === c.record_id)?.title ?? null }));
}

/**
 * Re-resolve stored citations against the sources as they are now. Reports drift; never rewrites.
 * Per citation: ok, relocated (with the new range), text_changed, record_archived, record_deleted
 * or record_missing, plus version_drift when the primary file has a newer version.
 */
export async function checkCitationList(ctx: OpContext, citations: CitationSnapshot[]) {
  const results = [];
  for (const [index, c] of citations.entries()) {
    const r = await ctx.db.selectFrom("records").select(["record_id", "archived_at", "current_derivation_id", "product_id"]).where("record_id", "=", c.record_id).executeTakeFirst();
    if (!r || r.product_id !== productId(ctx)) {
      const tomb = await ctx.db.selectFrom("tombstones").selectAll().where("object_id", "=", c.record_id).executeTakeFirst();
      results.push({ index, record_id: c.record_id, status: tomb ? "record_deleted" : "record_missing", ...(tomb ? { tombstone: { deleted_at: tomb.deleted_at, deleted_by: tomb.deleted_by, reason: tomb.reason } } : {}), version_drift: false, quote_kept: true });
      continue;
    }
    const primary = await ctx.db.selectFrom("files").select("current_version_id").where("record_id", "=", c.record_id).where("role", "=", "primary").executeTakeFirst();
    const versionDrift = Boolean(primary?.current_version_id && primary.current_version_id !== c.file_version_id);
    let status = "ok";
    let relocated: { seq_start: number; seq_end: number } | undefined;
    if (r.current_derivation_id !== c.derivation_id && r.current_derivation_id) {
      const segs = await ctx.db.selectFrom("segments").select(["seq", "text"]).where("derivation_id", "=", r.current_derivation_id).orderBy("seq").execute();
      const same = segs.filter((s) => s.seq >= c.seq_start && s.seq <= c.seq_end).map((s) => s.text).join("\n\n");
      if (!same.includes(c.quote)) {
        const full = segs.map((s) => s.text).join("\n\n");
        const at = full.indexOf(c.quote);
        if (at >= 0) {
          let pos = 0;
          let start = -1;
          let end = -1;
          for (const s of segs) {
            const segEnd = pos + s.text.length;
            if (start < 0 && at < segEnd) start = s.seq;
            if (at + c.quote.length <= segEnd) {
              end = s.seq;
              break;
            }
            pos = segEnd + 2;
          }
          status = "relocated";
          relocated = { seq_start: start, seq_end: end };
        } else status = "text_changed";
      }
    } else if (!r.current_derivation_id) status = "text_changed";
    if (r.archived_at && status === "ok") status = "record_archived";
    results.push({ index, record_id: c.record_id, status, ...(relocated ? { relocated } : {}), version_drift: versionDrift, archived: Boolean(r.archived_at) });
  }
  return { valid: results.every((x) => x.status === "ok" && !x.version_drift), citations: results };
}
