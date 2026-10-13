import { z } from "zod";
import type { CitationSnapshot } from "./db.ts";
import { invalid } from "./errors.ts";
import { productId } from "./common.ts";
import type { OpContext } from "./registry.ts";
import { id } from "./schemas.ts";
import { canonicalJson, sha256Hex, uniq } from "./util.ts";

/**
 * Citations: exact passages of a source, frozen as snapshots when written. Assumptions, Story page
 * versions and mockup versions all cite this way, with the same input, limits, snapshot and drift check.
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
  if (c.quote !== undefined && !rangeText.includes(c.quote)) {
    // A quote that differs only in markup, spacing or a speaker label is still refused (a quote is
    // exact), but the refusal gives the passage's own words to quote instead.
    const near = locateQuote(segs, c.quote, c);
    if (near && near.seq_start >= c.seq_start && near.seq_end <= c.seq_end) {
      const exact = rangeText.slice(near.start, near.end);
      throw invalid(
        "quote_not_found",
        `The quote does not occur exactly in segments ${c.seq_start}–${c.seq_end} of source ${c.record_id}; it matches only once emphasis or code markers, spacing or speaker labels are ignored. Quote the passage's own text: ${JSON.stringify(exact)}.`,
        { exact_quote: exact },
      );
    }
    throw invalid("quote_not_found", `The quote does not occur in segments ${c.seq_start}–${c.seq_end} of source ${c.record_id}. Read the passage and quote it exactly, or omit quote.`);
  }
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
 * or record_missing, plus version_drift when the primary file has a newer version, and
 * derivation_changed (with current_derivation_id) when the source was parsed again after the
 * snapshot. A quote that matches only once markup, spacing and speaker labels are set aside says
 * so in quote_match and note. valid is true when every citation is ok against the passages of each
 * source's current file; rederived says whether any source was parsed again since its snapshot.
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
    const derivationChanged = r.current_derivation_id !== c.derivation_id;
    let status = "ok";
    let relocated: { seq_start: number; seq_end: number } | undefined;
    let normalized = false;
    if (derivationChanged && r.current_derivation_id) {
      const segs = await ctx.db.selectFrom("segments").select(["seq", "text", "speaker"]).where("derivation_id", "=", r.current_derivation_id).orderBy("seq").execute();
      const found = locateQuote(segs, c.quote, c, c.speakers ?? []);
      if (!found) status = "text_changed";
      else {
        normalized = found.normalized;
        if (found.seq_start < c.seq_start || found.seq_end > c.seq_end) {
          status = "relocated";
          relocated = { seq_start: found.seq_start, seq_end: found.seq_end };
        }
      }
    } else if (!r.current_derivation_id) status = "text_changed";
    if (r.archived_at && status === "ok") status = "record_archived";
    const where = relocated ? `segments ${relocated.seq_start}–${relocated.seq_end}` : "the cited range";
    results.push({
      index,
      record_id: c.record_id,
      status,
      ...(relocated ? { relocated } : {}),
      version_drift: versionDrift,
      derivation_changed: derivationChanged,
      ...(derivationChanged ? { current_derivation_id: r.current_derivation_id } : {}),
      ...(normalized
        ? {
            quote_match: "normalized",
            note: `The quote's words occur in ${where} of the current passages once emphasis or code markers, spacing and speaker labels are set aside; the stored quote keeps its original form. Read the passage before relying on it.`,
          }
        : {}),
      archived: Boolean(r.archived_at),
    });
  }
  // A newer file whose passages are not the ones checked (not parsed yet, or failed) leaves a quote unverified.
  const unverified = results.some((x) => x.version_drift && !("derivation_changed" in x && x.derivation_changed));
  return {
    valid: !unverified && results.every((x) => x.status === "ok"),
    rederived: results.some((x) => "derivation_changed" in x && x.derivation_changed),
    ...(unverified ? { unverified_note: "A cited source has a newer file whose passages have not been read yet (it is still being parsed, or parsing failed), so its quotes were checked against the earlier file. Check again once the source's derived_status is ready." } : {}),
    citations: results,
  };
}

export type CitedRange = { seq_start: number; seq_end: number; moved_from?: { seq_start: number; seq_end: number }; quote_not_found?: true };

/**
 * Where citations of one source stand in its current passages, for a reader's link or mark. While
 * the source has not been parsed again since a snapshot, that is the stored range. After, it is
 * the range the quote is found in now, with the stored one as moved_from, or the stored range with
 * quote_not_found. A quote found within its stored range keeps that range, as check_citations
 * calls it ok. Nothing stored changes. The passages are read once, and only if some citation needs them.
 */
export async function citedRanges(ctx: OpContext, recordId: string) {
  const r = await ctx.db.selectFrom("records").select("current_derivation_id").where("record_id", "=", recordId).executeTakeFirst();
  const current = r?.current_derivation_id ?? null;
  let passages: Passage[] | undefined;
  return async (c: CitationSnapshot): Promise<CitedRange> => {
    const stored = { seq_start: c.seq_start, seq_end: c.seq_end };
    if (!current || c.derivation_id === current) return stored;
    passages ??= await ctx.db.selectFrom("segments").select(["seq", "text", "speaker"]).where("derivation_id", "=", current).orderBy("seq").execute();
    const found = locateQuote(passages, c.quote, c, c.speakers ?? []);
    if (!found) return { ...stored, quote_not_found: true };
    if (found.seq_start >= c.seq_start && found.seq_end <= c.seq_end) return stored;
    return { seq_start: found.seq_start, seq_end: found.seq_end, moved_from: stored };
  };
}

// ---- Finding a quote in a source's passages ----------------------------------------------------

/** Emphasis and code markers: runs of `*` or `_` at a word edge (never inside snake_case or 2*3), and every backtick. */
const MARKUP = /(?<![\p{L}\p{N}])[*_]+|[*_]+(?![\p{L}\p{N}])|`+/gu;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text reduced for matching, with each character's index in the original and the speaker labels taken out of it. */
export interface NormalizedText {
  text: string;
  /** map[i] is the index in the original string of text[i]. */
  map: number[];
  /** A speaker label that stood before text[at], with the original index of that character. */
  labels: { at: number; orig: number; name: string }[];
}

/**
 * Reduce text for a markup-tolerant match: drop emphasis and code markers, drop a "Name:" label at
 * the start of a line when the name is one of `speakers`, and collapse whitespace. Words, their
 * order and punctuation stay, so only a difference in markup, spacing or labelling is forgiven.
 */
export function normalizeForMatch(s: string, speakers: string[] = []): NormalizedText {
  const drop = new Uint8Array(s.length);
  for (const m of s.matchAll(MARKUP)) drop.fill(1, m.index, m.index + m[0].length);
  const kept: string[] = [];
  const keptAt: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (drop[i]) continue;
    kept.push(s[i]!);
    keptAt.push(i);
  }
  const t = kept.join("");
  const dropLabel = new Uint8Array(t.length);
  const labelBefore = new Map<number, string>();
  const names = uniq(speakers.map((n) => n.trim()).filter(Boolean)).sort((a, b) => b.length - a.length);
  if (names.length) {
    const label = new RegExp(`^[ \\t]*(?:\\[?\\d{1,2}:\\d{2}(?::\\d{2})?\\]?[ \\t]+)?\\[?(${names.map(escapeRe).join("|")})\\]?[ \\t]*:[ \\t]*`, "gimu");
    for (const m of t.matchAll(label)) {
      dropLabel.fill(1, m.index, m.index + m[0].length);
      labelBefore.set(m.index + m[0].length, m[1]!);
    }
  }
  const out: string[] = [];
  const map: number[] = [];
  const labels: NormalizedText["labels"] = [];
  let space = -1;
  let pending: string | null = null;
  for (let j = 0; j < t.length; j++) {
    pending = labelBefore.get(j) ?? pending;
    if (dropLabel[j]) continue;
    const ch = t[j]!;
    if (/\s/.test(ch)) {
      if (space < 0) space = keptAt[j]!;
      continue;
    }
    if (space >= 0 && out.length) {
      out.push(" ");
      map.push(space);
    }
    space = -1;
    if (pending !== null) {
      labels.push({ at: out.length, orig: keptAt[j]!, name: pending });
      pending = null;
    }
    out.push(ch);
    map.push(keptAt[j]!);
  }
  return { text: out.join(""), map, labels };
}

type Passage = { seq: number; text: string; speaker: string | null };

export interface QuoteMatch {
  seq_start: number;
  seq_end: number;
  /** True when the quote matched only once markup, spacing and speaker labels were set aside. */
  normalized: boolean;
  /** Where the match lies in the passages joined by a blank line, as the derived text joins them. */
  start: number;
  end: number;
}

/**
 * Where a quote occurs in a derivation's passages (in seq order, joined by a blank line as the
 * derived text is). Preference: exactly within `range`, then normalised (normalizeForMatch) within
 * it, then exactly elsewhere, then normalised elsewhere. A normalised match whose quote carried a
 * speaker label counts only where the source gives that passage the same speaker, or none.
 */
export function locateQuote(passages: Passage[], quote: string, range: { seq_start: number; seq_end: number }, speakers: string[] = []): QuoteMatch | null {
  const starts: number[] = [];
  let pos = 0;
  for (const p of passages) {
    starts.push(pos);
    pos += p.text.length + 2;
  }
  const endOf = (i: number) => starts[i]! + passages[i]!.text.length;
  const full = passages.map((p) => p.text).join("\n\n");
  const first = passages.findIndex((p) => p.seq >= range.seq_start);
  const last = passages.findLastIndex((p) => p.seq <= range.seq_end);
  const lo = first >= 0 ? starts[first]! : Number.POSITIVE_INFINITY;
  const hi = last >= 0 ? endOf(last) : Number.NEGATIVE_INFINITY;
  const inRange = (start: number, end: number) => start >= lo && end <= hi;
  const indexAt = (offset: number) => passages.findIndex((_, i) => endOf(i) > offset);
  const match = (start: number, end: number, normalized: boolean): QuoteMatch => ({
    seq_start: passages[indexAt(start)]!.seq,
    seq_end: passages[passages.findLastIndex((_, i) => starts[i]! < end)]!.seq,
    normalized,
    start,
    end,
  });

  let exactElsewhere: QuoteMatch | null = null;
  for (let i = full.indexOf(quote); i >= 0; i = full.indexOf(quote, i + 1)) {
    if (inRange(i, i + quote.length)) return match(i, i + quote.length, false);
    exactElsewhere ??= match(i, i + quote.length, false);
  }

  const known = uniq([...speakers, ...passages.map((p) => p.speaker).filter((s): s is string => Boolean(s))]);
  const q = normalizeForMatch(quote, known);
  let normalizedElsewhere: QuoteMatch | null = null;
  if (q.text) {
    const f = normalizeForMatch(full, known);
    /** Who the source says is speaking at an offset: a label in the passage's text, else the passage's speaker. */
    const speakerAt = (offset: number) => {
      const i = indexAt(offset);
      if (i < 0) return null;
      const inText = f.labels.filter((l) => l.orig >= starts[i]! && l.orig <= offset).pop();
      return inText?.name ?? passages[i]!.speaker;
    };
    for (let i = f.text.indexOf(q.text); i >= 0; i = f.text.indexOf(q.text, i + 1)) {
      const attributed = q.labels.every((l) => {
        const who = speakerAt(f.map[i + l.at]!);
        return !who || who.toLowerCase() === l.name.toLowerCase();
      });
      if (!attributed) continue;
      const start = f.map[i]!;
      const end = f.map[i + q.text.length - 1]! + 1;
      if (inRange(start, end)) return match(start, end, true);
      normalizedElsewhere ??= match(start, end, true);
    }
  }
  return exactElsewhere ?? normalizedElsewhere;
}
