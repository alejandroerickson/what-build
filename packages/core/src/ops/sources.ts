import { currentReading, IMAGE_DETAIL, SCAN_DETAIL, settledReading } from "@whatbuild/parsers";
import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, normalizeTags, productId, recordActivity, tenantId } from "../common.ts";
import { json, type RecordsTable, type Tx } from "../db.ts";
import { checkConfirmation, DELETE_CONFIRMATION, DELETE_GUIDANCE, deleteGuards, dropRevisions, leaveTombstone, refuseIfDeleted } from "../deletion.ts";
import { conflict, gone, invalid, notFound } from "../errors.ts";
import { effectiveRole, membershipsFor, roleAtLeast } from "../policy.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id, isoDate, tags } from "../schemas.ts";
import { indexSource, indexText } from "../text-index.ts";
import { likeContaining, newEtag, newId, sameEtag, slugify, uniq } from "../util.ts";

type RecordRow = Selectable<RecordsTable>;

export const MAX_BATCH = 200;

export async function loadRecord(ctx: OpContext, recordId: string, opts: { lock?: boolean; live?: boolean } = {}): Promise<RecordRow> {
  let q = ctx.db.selectFrom("records").selectAll().where("record_id", "=", recordId).where("product_id", "=", productId(ctx));
  if (opts.lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) {
    const tomb = await ctx.db.selectFrom("tombstones").selectAll().where("object_id", "=", recordId).where("product_id", "=", productId(ctx)).executeTakeFirst();
    if (tomb) throw gone("record_deleted", `Source ${recordId} was deleted permanently on ${tomb.deleted_at}.`, { tombstone: tomb });
    throw notFound(`Source ${recordId} doesn’t exist in this product.`);
  }
  if (opts.live && row.archived_at) throw archivedSource(recordId);
  return row;
}

/** The refusal of a write to an archived source, which is read-only until restored: what to do, in both doors' words. */
export function archivedSource(recordId: string) {
  return conflict(
    "record_archived",
    `Source ${recordId} is archived, and an archived source is read-only. Nothing was changed. Restore it first, with sources(action="restore", params={"record_ids": ["${recordId}"]}) or Restore on the source in the web app, then send this again.`,
  );
}

/**
 * Each of the sources' attachments with its latest reading, of its current version, and that
 * version's media type and size. A reading's status and detail are said as this version says them
 * (`currentReading`), whenever it was made.
 */
export async function attachmentReadings(db: Tx, recordIds: string[]) {
  if (!recordIds.length) return [];
  const r = await sql<{
    record_id: string;
    file_id: string;
    path: string;
    added_at: string;
    added_by: unknown;
    current_version_id: string | null;
    media_type: string | null;
    size: string | null;
    derivation_id: string | null;
    status: string | null;
    status_detail: string | null;
    parser: string | null;
    parser_version: string | null;
    text_chars: number | null;
    duration_ms: string | null;
    blob_prefix: string | null;
    read_at: string | null;
  }>`
    select f.record_id, f.file_id, f.path, f.added_at, f.added_by, f.current_version_id, v.media_type, v.size,
      d.derivation_id, d.status, d.status_detail, d.parser, d.parser_version, d.text_chars, d.duration_ms, d.blob_prefix, d.created_at as read_at
    from files f
    left join file_versions v on v.file_version_id = f.current_version_id
    left join lateral (
      select * from derivations d where d.file_version_id = f.current_version_id order by d.derivation_id desc limit 1) d on true
    where f.record_id = any(${recordIds})
    order by f.record_id, f.added_at, f.path`.execute(db);
  return r.rows.map((x) => ({
    ...x,
    ...(x.status ? currentReading(x.status, x.status_detail) : {}),
    size: x.size === null ? null : Number(x.size),
    duration_ms: x.duration_ms === null ? null : Number(x.duration_ms),
  }));
}

type AttachmentReading = Awaited<ReturnType<typeof attachmentReadings>>[number];

/**
 * How an attachment's text stands: its latest reading's; before it is read, what its name, type
 * and size already settle (a format no parser reads, a recording, a file over the parse cap), as
 * its reading will record it; else `pending`. `settled` says the name, type and size decide its
 * reading, so a reading of it still to come changes nothing.
 */
export function attachmentText(a: AttachmentReading, parseCapBytes: number): { status: string; status_detail: string | null; settled: boolean } {
  const settled = a.size === null ? undefined : settledReading(a.path, { mediaType: a.media_type, size: a.size, parseCapBytes });
  if (a.derivation_id) return { status: a.status!, status_detail: a.status_detail, settled: Boolean(settled) };
  return settled ? { ...settled, settled: true } : { status: "pending", status_detail: null, settled: false };
}

/** The attachment a source's derived text was taken from, while it is still that attachment's text. */
export async function textFileId(db: Tx, recordId: string): Promise<string | null> {
  const t = await db
    .selectFrom("source_texts as t")
    .innerJoin("file_versions as v", "v.file_version_id", "t.from_file_version_id")
    .select("v.file_id")
    .where("t.record_id", "=", recordId)
    .executeTakeFirst();
  return t?.file_id ?? null;
}

/** The attachment a derived text is still the text of: its path and version. */
export async function takenFrom(db: Tx, fileVersionId: string | null): Promise<{ path: string; file_version_id: string } | null> {
  if (!fileVersionId) return null;
  const f = await db
    .selectFrom("file_versions as v")
    .innerJoin("files as f", "f.file_id", "v.file_id")
    .select(["f.path", "v.file_version_id"])
    .where("v.file_version_id", "=", fileVersionId)
    .executeTakeFirst();
  return f ?? null;
}

export interface TextStatus {
  derived_status: string;
  status_detail: string | null;
  text_chars: number;
  /** The longest recording or timed transcript among its attachments. */
  duration_ms: number | null;
  attachment_count: number;
  /** The path of the attachment the derived text is still the text of. */
  text_from: string | null;
  /** An attachment whose upload is under way. */
  pending_path: string | null;
  /** The attachments read with some text that the source's derived text is not taken from. */
  unused_text: string[];
  /**
   * Its status is `unsupported` because what it holds is pictures: each of its attachments read as
   * `unsupported` is an image, or a PDF whose pages are pictures. Someone who can see them gives it
   * its words, where a format no parser reads wants a copy in one that a parser does.
   */
  pictures: boolean;
}

/** The details of an attachment that is pictures, as `currentReading` says them. */
const PICTURE_DETAILS = new Set<string>([IMAGE_DETAIL, SCAN_DETAIL]);

/**
 * Where each source's derived text stands: `ready` when it has one; otherwise `pending` while an
 * attachment is arriving or being read, `awaiting_file` with no attachment, `awaiting_text` when
 * an attachment has text the source does not use, and else how its newest attachment was read
 * (`needs_transcript`, `unsupported`, `too_large` or `failed`). An attachment whose name, type and
 * size settle its reading (`attachmentText`) is never being read: its status is known at once.
 */
export async function derivedStatuses(ctx: OpContext, recordIds: string[]) {
  const out = new Map<string, TextStatus>();
  if (!recordIds.length) return out;
  const cap = ctx.ports.config.parseCapBytes;
  const readings = (await attachmentReadings(ctx.db, recordIds)).map((x) => ({ ...x, shown: attachmentText(x, cap) }));
  const texts = await ctx.db
    .selectFrom("source_texts as t")
    .leftJoin("file_versions as v", "v.file_version_id", "t.from_file_version_id")
    .leftJoin("files as f", "f.file_id", "v.file_id")
    .select(["t.record_id", "t.chars", "f.path"])
    .where("t.record_id", "in", recordIds)
    .execute();
  // The attachment versions waiting to be read, or read again.
  const jobs = await sql<{ file_version_id: string }>`
    select distinct payload->>'file_version_id' as file_version_id from jobs
    where kind = 'derive' and done_at is null and payload->>'record_id' = any(${recordIds})`.execute(ctx.db);
  const queued = new Set(jobs.rows.map((j) => j.file_version_id));
  const grants = await ctx.db
    .selectFrom("upload_grants")
    .select(["record_id", "path"])
    .where("record_id", "in", recordIds)
    .where("completed_at", "is", null)
    .where("expires_at", ">", ctx.now)
    .orderBy("created_at", "desc")
    .execute();
  for (const id of recordIds) {
    const mine = readings.filter((x) => x.record_id === id);
    const text = texts.find((x) => x.record_id === id);
    const pending_path = grants.find((g) => g.record_id === id)?.path ?? null;
    const reading = mine.some((x) => x.shown.status === "pending" || (!x.shown.settled && x.current_version_id !== null && queued.has(x.current_version_id)));
    let status: string;
    let detail: string | null = null;
    if (text) status = "ready";
    else if (reading || pending_path) status = "pending";
    else if (!mine.length) status = "awaiting_file";
    else if (mine.some((x) => x.shown.status === "ready")) status = "awaiting_text";
    else {
      const newest = mine.reduce((a, b) => (b.added_at > a.added_at ? b : a));
      status = newest.shown.status;
      detail = newest.shown.status_detail;
    }
    const durations = mine.map((x) => x.duration_ms).filter((d): d is number => d !== null);
    const textFrom = text?.path ?? null;
    const unread = mine.filter((x) => x.shown.status === "unsupported");
    out.set(id, {
      derived_status: status,
      status_detail: detail,
      text_chars: text ? Number(text.chars) : 0,
      duration_ms: durations.length ? Math.max(...durations) : null,
      attachment_count: mine.length,
      text_from: textFrom,
      pending_path,
      unused_text: mine.filter((x) => x.shown.status === "ready" && Number(x.text_chars ?? 0) > 0 && x.path !== textFrom).map((x) => x.path),
      pictures: status === "unsupported" && unread.length > 0 && unread.every((x) => PICTURE_DETAILS.has(x.shown.status_detail ?? "")),
    });
  }
  return out;
}

/** Said wherever a source whose attachments have text, but which has no derived text, shows up. */
export const NO_TEXT_WARNING =
  "This source has an attachment with text but no derived text of its own, so search finds it only by its title, tags, summary, notes and comments. Take an attachment's text with derived(action=\"write_text\", from_attachment=…), or write the text.";

/** Some paths, in words: "a.vtt", "a.vtt and b.xlsx", "a.vtt, b.xlsx and c.pdf". */
const listed = (paths: string[]) => (paths.length < 2 ? (paths[0] ?? "") : `${paths.slice(0, -1).join(", ")} and ${paths[paths.length - 1]}`);

/**
 * What a read of a source should warn about, beyond its derived_status: that it has no derived
 * text though an attachment has text, or which attachments hold text its derived text does not
 * use, which search never reads. An attachment with no text (a recording, an image) is not named.
 */
export function sourceWarnings(s: Pick<TextStatus, "derived_status" | "text_from" | "unused_text">): string[] {
  if (s.derived_status === "awaiting_text") return [NO_TEXT_WARNING];
  if (s.derived_status !== "ready" || !s.unused_text.length) return [];
  const one = s.unused_text.length === 1;
  const read = `the text read from ${listed(s.unused_text)} is kept but never searched`;
  if (s.text_from)
    return [
      `This source's derived text is taken from ${s.text_from}, so ${read}. If ${one ? "its" : "their"} words should be found, write them into the derived text, the summary or the notes, or add ${one ? "it" : "each"} as a source of its own.`,
    ];
  return [
    `This source's derived text was written or edited, so it follows no attachment: ${read}, and a new version of ${one ? "it" : "one"} does not change the derived text. Take an attachment's text with derived(action="write_text", from_attachment=…), passing the derived text's etag as expected_etag, only if it should replace the derived text.`,
  ];
}

/**
 * A soft warning, never a refusal, when a live source in this product already has the same title
 * (ignoring case and surrounding space) and date: duplicates dilute search.
 */
export async function duplicateWarnings(ctx: OpContext, meta: { title: string; date?: string | null | undefined }): Promise<string[]> {
  const date = meta.date ?? null;
  const same = await ctx.db
    .selectFrom("records")
    .select(["record_id", "title"])
    .where("product_id", "=", productId(ctx))
    .where("archived_at", "is", null)
    .where(sql<boolean>`lower(btrim(title)) = lower(btrim(${meta.title}))`)
    .where(date === null ? sql<boolean>`date is null` : sql<boolean>`date = ${date}`)
    .orderBy("record_id")
    .limit(5)
    .execute();
  if (!same.length) return [];
  const ids = same.map((r) => r.record_id).join(", ");
  return [
    `A source with the same title and date already exists (${ids}). If this is the same material, add attachments to that source and archive this one; if it is different, give this one a title that tells them apart.`,
  ];
}

export function recordSummary(r: RecordRow, s?: { derived_status: string; text_chars: number; attachment_count: number }) {
  return {
    record_id: r.record_id,
    title: r.title,
    date: r.date,
    tags: r.tags,
    uploaded_by: r.uploaded_by,
    uploaded_at: r.uploaded_at,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
    archived_at: r.archived_at,
    derived_status: s?.derived_status ?? "awaiting_file",
    text_chars: s?.text_chars ?? 0,
    attachment_count: s?.attachment_count ?? 0,
    etag: r.etag,
  };
}

/** A date, update-time or title cursor from sources.list: the last row's sort key and id. */
function readSortCursor(cursor: string): { v: string | null; id: string } {
  try {
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; id?: unknown };
    if (typeof c.id === "string" && (c.v === null || typeof c.v === "string")) return { v: c.v, id: c.id };
  } catch {
    // Not ours; refused below.
  }
  throw badCursor();
}

function badCursor() {
  return invalid("invalid_cursor", "This cursor doesn’t belong to this sort. Pass next_cursor back with the same filters and sort.");
}

// ---- Facets -------------------------------------------------------------------------------------

/** At most this many tags come back from sources.facets, most used first. */
export const MAX_FACET_TAGS = 500;

export const sourceFacets = defineOperation({
  name: "sources.facets",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "What sources can be filtered by: the tags in use, most used first, and the people who added sources.",
  description:
    "Read the tags before tagging a source, and reuse one the team already uses rather than coining a near-duplicate (interview, not interviews or customer-interview). A tag says what the material is (interview, workshop, deck, analysis), whom it concerns (an organization or a segment) or what it bears on. Counts are of live sources unless include_archived is true; tags_truncated says the list stopped at the most used " +
    `${MAX_FACET_TAGS}. added_by lists each person who added sources, by account_id with their name when they last added one, and how many; an agent's additions count as the person's. Filter with sources(action=\"list\", tags=…) or (added_by=account_id).`,
  input: z.strictObject({ include_archived: z.boolean().default(false) }),
  // Registered before sources.get, so /sources/facets is never read as a source id.
  rest: { method: "GET", path: "/sources/facets" },
  mcp: { tool: "sources", action: "facets" },
  async handler(ctx, input) {
    const live = input.include_archived ? sql`` : sql` and r.archived_at is null`;
    const tags = await sql<{ tag: string; count: number }>`
      select t as tag, count(*)::int as count from records r cross join lateral unnest(r.tags) as t
      where r.product_id = ${productId(ctx)}${live}
      group by t order by count desc, t asc limit ${MAX_FACET_TAGS + 1}`.execute(ctx.db);
    const people = await sql<{ account_id: string; display_name: string; count: number }>`
      select r.uploaded_by->>'account_id' as account_id,
        (array_agg(r.uploaded_by->>'display_name' order by r.uploaded_at desc))[1] as display_name,
        count(*)::int as count
      from records r where r.product_id = ${productId(ctx)}${live}
      group by 1 order by count desc, display_name asc`.execute(ctx.db);
    const total = await sql<{ n: number }>`select count(*)::int as n from records r where r.product_id = ${productId(ctx)}${live}`.execute(ctx.db);
    return {
      sources: total.rows[0]?.n ?? 0,
      tags: tags.rows.slice(0, MAX_FACET_TAGS),
      tags_truncated: tags.rows.length > MAX_FACET_TAGS,
      added_by: people.rows,
    };
  },
});

// ---- Listing and reading ------------------------------------------------------------------------

/** How much of each source's summary sources.list returns with include_summary. */
export const LIST_SUMMARY_MAX = 1000;

export const listSources = defineOperation({
  name: "sources.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List sources by metadata: newest added first, or by date, last update or title, either way round. For what sources say, use search.",
  description:
    "Filters combine. `tags` must all be on a source; sources(action=\"facets\") lists the tags in use and who added sources. `added_by` is an account_id; `added_since` keeps sources added at or after a date or time; `date_from` and `date_to` bound the source's own date. `query` is a case-insensitive substring over metadata only — title, tags and attachment names — never what a source says; use `search` for that. `sort`: added (newest added first, the default), date (the source's own date, newest first, undated last), updated (details most recently changed first) or title (A to Z). `order` reverses it: asc or desc, defaulting to desc for the three dates and asc for title; undated sources stay last either way. Returns each source's metadata with derived_status, the attachment the derived text was taken from (text_from) and next_cursor; pass the cursor back with the same filters, sort and order. " +
    `include_summary adds each source's summary (null without one, cut at ${LIST_SUMMARY_MAX} characters), which is what people read when they browse the list.`,
  input: z.strictObject({
    tags: z.array(z.string()).max(20).optional().describe("All must match."),
    added_by: z.string().min(1).max(100).optional().describe("An account_id from sources(action=\"facets\"): only the sources that person added, in the app or through an agent."),
    added_since: z.union([isoDate, z.iso.datetime({ offset: true })]).optional().describe("Only sources added at or after this date (UTC midnight) or time."),
    date_from: isoDate.optional().describe("The source's own date, on or after."),
    date_to: isoDate.optional().describe("The source's own date, on or before."),
    query: z.string().max(500).optional(),
    include_archived: z.boolean().default(false),
    include_summary: z.boolean().default(false).describe("Add each source's summary."),
    sort: z.enum(["added", "date", "updated", "title"]).default("added"),
    order: z.enum(["asc", "desc"]).optional().describe("Defaults to desc for added, date and updated, and asc for title."),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
  }),
  rest: { method: "GET", path: "/sources" },
  mcp: { tool: "sources", action: "list" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("records").selectAll().where("product_id", "=", productId(ctx));
    if (!input.include_archived) q = q.where("archived_at", "is", null);
    if (input.added_by) q = q.where(sql<boolean>`uploaded_by->>'account_id' = ${input.added_by}`);
    if (input.added_since) q = q.where(sql<boolean>`uploaded_at >= ${input.added_since}::timestamptz`);
    if (input.date_from) q = q.where("date", ">=", input.date_from);
    if (input.date_to) q = q.where("date", "<=", input.date_to);
    if (input.tags?.length) q = q.where(sql<boolean>`tags @> ${normalizeTags(input.tags)}::text[]`);
    if (input.query) {
      const like = likeContaining(input.query);
      q = q.where(
        sql<boolean>`(title ilike ${like} or array_to_string(tags, ' ') ilike ${like}
          or exists (select 1 from files f where f.record_id = records.record_id and f.path ilike ${like}))`,
      );
    }
    // Keyset paging. "added" keeps the bare record id as its cursor; the other sorts carry the sort
    // key as well, as opaque base64url JSON, so a page boundary never skips or repeats a row. The
    // update time travels as Postgres text, which keeps its microseconds.
    const dir = input.order ?? (input.sort === "title" ? "asc" : "desc");
    const past = sql.raw(dir === "desc" ? "<" : ">");
    const after = input.cursor && input.sort !== "added" ? readSortCursor(input.cursor) : null;
    let sorted = q.select([sql<string>`lower(title)`.as("sort_title"), sql<string>`updated_at::text`.as("sort_updated")]);
    if (input.sort === "added") {
      if (input.cursor) sorted = sorted.where(sql<boolean>`record_id ${past} ${input.cursor}`);
    } else if (input.sort === "date") {
      if (after)
        sorted = sorted.where(
          after.v === null
            ? sql<boolean>`(date is null and record_id ${past} ${after.id})`
            : sql<boolean>`(date ${past} ${after.v}::date or (date = ${after.v}::date and record_id ${past} ${after.id}) or date is null)`,
        );
      sorted = sorted.orderBy(sql`date ${sql.raw(dir)} nulls last`);
    } else if (input.sort === "updated") {
      if (after && !/^\d{4}-\d{2}-\d{2} [\d:.]+[+-][\d:]+$/.test(after.v ?? "")) throw badCursor();
      if (after) sorted = sorted.where(sql<boolean>`(updated_at ${past} ${after.v}::timestamptz or (updated_at = ${after.v}::timestamptz and record_id ${past} ${after.id}))`);
      sorted = sorted.orderBy("updated_at", dir);
    } else {
      const v = after?.v ?? "";
      if (after) sorted = sorted.where(sql<boolean>`(lower(title) ${past} ${v} or (lower(title) = ${v} and record_id ${past} ${after.id}))`);
      sorted = sorted.orderBy(sql`lower(title) ${sql.raw(dir)}`);
    }
    sorted = sorted.orderBy("record_id", dir);
    const rows = await sorted.limit(input.limit + 1).execute();
    const page = rows.slice(0, input.limit);
    const statuses = await derivedStatuses(ctx, page.map((r) => r.record_id));
    const last = page[page.length - 1];
    let next: string | null = null;
    if (rows.length > input.limit && last)
      next =
        input.sort === "added"
          ? last.record_id
          : Buffer.from(JSON.stringify({ v: input.sort === "date" ? last.date : input.sort === "updated" ? last.sort_updated : last.sort_title, id: last.record_id })).toString("base64url");
    const summaries =
      input.include_summary && page.length
        ? new Map(
            (
              await ctx.db
                .selectFrom("agent_notes")
                .select(["record_id", sql<string>`left(content, ${LIST_SUMMARY_MAX + 1})`.as("content")])
                .where("kind", "=", "summary")
                .where("record_id", "in", page.map((r) => r.record_id))
                .execute()
            ).map((n) => [n.record_id, truncateQuote(n.content, LIST_SUMMARY_MAX)]),
          )
        : null;
    return {
      records: page.map((r) => ({
        ...recordSummary(r, statuses.get(r.record_id)),
        text_from: statuses.get(r.record_id)?.text_from ?? null,
        ...(summaries ? { summary: summaries.get(r.record_id) ?? null } : {}),
      })),
      next_cursor: next,
    };
  },
});

/**
 * A recording's detail beside the source's derived text, when it has one: where that text comes
 * from, instead of asking for a transcript the source already has.
 */
export function recordingDetail(detail: string | null, source: { hasText: boolean; textFrom: string | null }): string | null {
  if (!source.hasText) return detail;
  return `a recording is stored and playable but has no text of its own; ${source.textFrom ? `the source's text is taken from ${source.textFrom}` : "the source's text was written or edited"}`;
}

/**
 * A source's attachments as a read shows them: each with its versions and how its text was read,
 * or, before it is read, what its name, type and size already settle (`attachmentText`).
 */
export async function attachmentEntries(db: Tx, recordId: string, parseCapBytes: number) {
  const readings = await attachmentReadings(db, [recordId]);
  const versions = await db
    .selectFrom("file_versions")
    .select(["file_version_id", "file_id", "size", "sha256", "media_type", "created_at", "created_by"])
    .where("record_id", "=", recordId)
    .orderBy("file_version_id", "desc")
    .execute();
  const textFile = await textFileId(db, recordId);
  const source = {
    hasText: Boolean(await db.selectFrom("source_texts").select("record_id").where("record_id", "=", recordId).executeTakeFirst()),
    textFrom: readings.find((a) => a.file_id === textFile)?.path ?? null,
  };
  return readings.map((a) => {
    const vs = versions.filter((v) => v.file_id === a.file_id);
    const cur = vs.find((v) => v.file_version_id === a.current_version_id) ?? vs[0];
    const shown = attachmentText(a, parseCapBytes);
    return {
      path: a.path,
      media_type: cur?.media_type ?? null,
      size: cur ? Number(cur.size) : null,
      sha256: cur?.sha256 ?? null,
      file_version_id: a.current_version_id,
      versions: vs.map((v) => ({ file_version_id: v.file_version_id, size: Number(v.size), media_type: v.media_type, created_at: v.created_at, created_by: v.created_by })),
      added_at: a.added_at,
      added_by: a.added_by,
      // Read when it arrives; kept, never searched.
      text: {
        status: shown.status,
        status_detail: shown.status === "needs_transcript" ? recordingDetail(shown.status_detail, source) : shown.status_detail,
        chars: Number(a.text_chars ?? 0),
        duration_ms: a.duration_ms,
        parser: a.parser,
        derivation_id: a.derivation_id,
        read_at: a.read_at,
      },
      is_text_source: a.file_id === textFile,
    };
  });
}

export const getSource = defineOperation({
  name: "sources.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read a source cheaply (brief), or everything about it (full): attachments, derived text, comments.",
  description:
    "Start with detail=\"brief\": derived_status says whether the source has a derived text (ready) and text_chars how long it is, to plan derived(action=\"text\") windows; warnings names each attachment with text that the derived text does not use, which search never reads (attachments with no text, such as recordings and images, are not named), and says when the source has no derived text though an attachment has text. etag is the one sources.update and sources.delete expect. `full` adds the attachments (each with how its text was read, and which one the derived text was taken from), the derived text's etag (the one derived(action=\"write_text\") takes) and who wrote it last, comments, and in agent_notes the summary and notes that exist, each with its own etag (the one derived(action=\"write_note\") takes) and who wrote it last. Neither returns file bytes or the text itself. An archived source is still readable by id.",
  input: z.strictObject({ record_id: id("source"), detail: z.enum(["brief", "full"]).default("brief") }),
  rest: { method: "GET", path: "/sources/:record_id" },
  mcp: { tool: "sources", action: "get" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id);
    const s = (await derivedStatuses(ctx, [r.record_id])).get(r.record_id)!;
    const brief = {
      ...recordSummary(r, s),
      text_from: s.text_from,
      duration_ms: s.duration_ms,
      status_detail: s.status_detail,
      warnings: sourceWarnings(s),
      annotation_count: Number(
        (await ctx.db.selectFrom("annotations").select((eb) => eb.fn.countAll<number>().as("n")).where("record_id", "=", r.record_id).where("archived_at", "is", null).executeTakeFirst())?.n ?? 0,
      ),
    };
    if (input.detail === "brief") return brief;
    const text = await ctx.db.selectFrom("source_texts").select(["chars", "etag", "updated_at", "updated_by", "from_file_version_id"]).where("record_id", "=", r.record_id).executeTakeFirst();
    const annotations = await ctx.db.selectFrom("annotations").selectAll().where("record_id", "=", r.record_id).where("archived_at", "is", null).orderBy("annotation_id", "desc").limit(100).execute();
    const agentNotes = await ctx.db.selectFrom("agent_notes").select(["kind", "etag", "updated_at", "updated_by"]).where("record_id", "=", r.record_id).execute();
    return {
      ...brief,
      copied_from: r.copied_from,
      updated_at: r.updated_at,
      updated_by: r.updated_by,
      pending_upload_path: s.pending_path,
      attachments: await attachmentEntries(ctx.db, r.record_id, ctx.ports.config.parseCapBytes),
      text: text
        ? { chars: Number(text.chars), etag: text.etag, updated_at: text.updated_at, updated_by: text.updated_by, taken_from: await takenFrom(ctx.db, text.from_file_version_id) }
        : null,
      annotations,
      agent_notes: agentNotes,
    };
  },
});

// ---- Creating and correcting --------------------------------------------------------------------

export const recordMetadata = {
  title: z.string().trim().min(1).max(300).describe('Say what it is: who, what, when — e.g. "Operations lead interview — Example Co, Sep 2026". Never a file name.'),
  date: isoDate.nullable().optional().describe("The date of the event or document, never the upload date. Null when unknown."),
  tags: tags
    .optional()
    .describe("What the material is (interview, workshop, deck, analysis), whom it concerns (an organization, a segment) and what it bears on. Reuse the product's tags from sources(action=\"facets\"). Up to 50, stored lower-case."),
};

export async function insertRecord(
  ctx: OpContext,
  input: {
    title: string;
    date?: string | null | undefined;
    tags?: string[] | undefined;
  },
  copiedFrom: { product_id: string; record_id: string } | null = null,
): Promise<RecordRow> {
  const record_id = newId();
  const date = input.date ?? null;
  await ctx.db
    .insertInto("records")
    .values({
      record_id,
      tenant_id: tenantId(ctx),
      team_id: ctx.scope.team!.team_id,
      product_id: productId(ctx),
      title: input.title,
      date,
      tags: normalizeTags(input.tags),
      slug: slugify(date ? `${date}-${input.title}` : input.title),
      copied_from: json(copiedFrom),
      etag: newEtag(),
      uploaded_by: json(ctx.actor),
      updated_by: json(ctx.actor),
    })
    .execute();
  await indexText(ctx.db, tenantId(ctx), record_id, "title", input.title);
  await indexText(ctx.db, tenantId(ctx), record_id, "tags", normalizeTags(input.tags).join(", "));
  await recordActivity(ctx, {
    action: copiedFrom ? "copied" : "created",
    entity_type: "source",
    entity_id: record_id,
    entity_title: input.title,
    summary: copiedFrom ? "Copied a source from another product" : "Added a source",
  });
  return loadRecord(ctx, record_id);
}

export const createSource = defineOperation({
  name: "sources.create",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Create a source from its title, date and tags; then add attachments with attachments.request_upload or attachments.fetch_url, or write its text with derived.write_text.",
  description:
    "Describe the material with a title and tags; there are no kinds or folders. To create a source and get an upload grant in one call, use attachments(action=\"create_upload\"). Before creating, check sources(action=\"list\", query=…) for an equivalent source — duplicates dilute search. warnings names any live source with the same title and date; nothing is refused.",
  input: z.strictObject(recordMetadata),
  rest: { method: "POST", path: "/sources" },
  mcp: { tool: "sources", action: "create" },
  async handler(ctx, input) {
    const warnings = await duplicateWarnings(ctx, input);
    const r = await insertRecord(ctx, input);
    return { ...recordSummary(r, { derived_status: "awaiting_file", text_chars: 0, attachment_count: 0 }), warnings };
  },
});

export const updateSource = defineOperation({
  name: "sources.update",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Correct a source's metadata in place: title, date or tags. Pass only what changes.",
  description:
    "Fix mistakes here; never archive and recreate, because links and comments point at the record id. The id, attachments, derived text and comments are untouched. tags replaces the whole list. Requires expected_etag: the source's current etag, from sources(action=\"get\") or the result of your last write to it. Adding an attachment also changes it. A stale one gets 409 stale_etag with details.current_etag; read the source again before retrying.",
  input: z.strictObject({ record_id: id("source"), expected_etag: expectedEtag, ...recordMetadata, title: recordMetadata.title.optional() }),
  rest: { method: "PATCH", path: "/sources/:record_id" },
  mcp: { tool: "sources", action: "update" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id, { lock: true });
    checkEtag(input.expected_etag, r.etag, "source");
    const next = {
      title: input.title ?? r.title,
      date: input.date === undefined ? r.date : input.date,
      tags: input.tags ? normalizeTags(input.tags) : r.tags,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(r[k]));
    if (!changed.length) return { ...recordSummary(r), changed: [] };
    await ctx.db
      .updateTable("records")
      .set({
        ...next,
        slug: slugify(next.date ? `${next.date}-${next.title}` : next.title),
        etag: newEtag(),
        updated_at: ctx.now,
        updated_by: json(ctx.actor),
      })
      .where("record_id", "=", r.record_id)
      .execute();
    if (changed.includes("title")) await indexText(ctx.db, tenantId(ctx), r.record_id, "title", next.title);
    if (changed.includes("tags")) await indexText(ctx.db, tenantId(ctx), r.record_id, "tags", next.tags.join(", "));
    await recordActivity(ctx, {
      action: "updated",
      entity_type: "source",
      entity_id: r.record_id,
      entity_title: next.title,
      summary: `Changed ${changed.join(", ")}`,
    });
    const after = await loadRecord(ctx, r.record_id);
    const s = (await derivedStatuses(ctx, [r.record_id])).get(r.record_id);
    return { ...recordSummary(after, s), changed };
  },
});

// ---- Archive and restore ------------------------------------------------------------------------

const batchIds = z.array(id("source")).min(1).max(MAX_BATCH).describe(`1 to ${MAX_BATCH} source ids; each is reported separately.`);

export const archiveSources = defineOperation({
  name: "sources.archive",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Archive sources: out of lists and out of search (including yours), erasing nothing. Reversible.",
  description:
    "Archive is how a team says \"stop showing me this, and stop letting the agent find it\" without losing it. Archiving an archived source is a no-op success. Returns {archived, failed}.",
  input: z.strictObject({ record_ids: batchIds }),
  rest: { method: "POST", path: "/sources/archive" },
  mcp: { tool: "sources", action: "archive" },
  async handler(ctx, input) {
    const archived: { record_id: string; archived_at: string }[] = [];
    const failed: { record_id: string; status: number; error: string }[] = [];
    for (const rid of uniq(input.record_ids)) {
      const r = await ctx.db.selectFrom("records").selectAll().where("record_id", "=", rid).where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
      if (!r) {
        failed.push({ record_id: rid, status: 404, error: "no such source in this product" });
        continue;
      }
      if (r.archived_at) {
        archived.push({ record_id: rid, archived_at: r.archived_at });
        continue;
      }
      await ctx.db.updateTable("records").set({ archived_at: ctx.now, archived_by: json(ctx.actor), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("record_id", "=", rid).execute();
      await recordActivity(ctx, { action: "archived", entity_type: "source", entity_id: rid, entity_title: r.title, summary: "Archived the source" });
      archived.push({ record_id: rid, archived_at: ctx.now });
    }
    return { archived, failed };
  },
});

export const restoreSources = defineOperation({
  name: "sources.restore",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Restore archived sources to lists and search.",
  description: "Restoring a live source is a no-op success. Returns {restored, failed}.",
  input: z.strictObject({ record_ids: batchIds }),
  rest: { method: "POST", path: "/sources/restore" },
  mcp: { tool: "sources", action: "restore" },
  async handler(ctx, input) {
    const restored: { record_id: string; restored_at: string }[] = [];
    const failed: { record_id: string; status: number; error: string }[] = [];
    for (const rid of uniq(input.record_ids)) {
      const r = await ctx.db.selectFrom("records").selectAll().where("record_id", "=", rid).where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
      if (!r) {
        failed.push({ record_id: rid, status: 404, error: "no such source in this product" });
        continue;
      }
      if (r.archived_at) {
        await ctx.db.updateTable("records").set({ archived_at: null, archived_by: json(null), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("record_id", "=", rid).execute();
        await recordActivity(ctx, { action: "restored", entity_type: "source", entity_id: rid, entity_title: r.title, summary: "Restored the source" });
      }
      restored.push({ record_id: rid, restored_at: ctx.now });
    }
    return { restored, failed };
  },
});

// ---- Annotations --------------------------------------------------------------------------------

export const annotate = defineOperation({
  name: "sources.annotate",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Comment on a source as a whole.",
  description:
    "A comment is an observation about the whole source, shown with the source's other comments and attributed to you. It is not anchored to any part of the text. Comments are searched with the rest of the source.",
  input: z.strictObject({
    record_id: id("source"),
    note: z.string().trim().min(1).max(2000).describe("The comment's text: Markdown, up to 2,000 characters."),
    tags: tags.optional(),
  }),
  rest: { method: "POST", path: "/sources/:record_id/annotations" },
  mcp: { tool: "sources", action: "annotate" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id, { live: true });
    const annotation_id = newId();
    await ctx.db
      .insertInto("annotations")
      .values({
        annotation_id, tenant_id: tenantId(ctx), product_id: productId(ctx), record_id: r.record_id,
        note: input.note, tags: normalizeTags(input.tags), etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    await indexText(ctx.db, tenantId(ctx), r.record_id, "comment", input.note, annotation_id);
    await recordActivity(ctx, { action: "note_added", entity_type: "source", entity_id: r.record_id, entity_title: r.title, summary: "Added a comment" });
    return ctx.db.selectFrom("annotations").selectAll().where("annotation_id", "=", annotation_id).executeTakeFirstOrThrow();
  },
});

/**
 * At most `max` code points of `text`. A longer text is cut at the last word boundary that fits
 * and ends with an ellipsis, so a snapshot never ends mid-word.
 */
export function truncateQuote(text: string, max: number): string {
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  const head = cps.slice(0, max - 1).join("");
  // The next character decides whether the last word in `head` is whole.
  const boundary = /\s/.test(cps[max - 1]!) ? head.length : head.search(/\s\S*$/);
  const cut = boundary > 0 ? head.slice(0, boundary) : head;
  return `${cut.trimEnd()}…`;
}

export const listAnnotations = defineOperation({
  name: "sources.list_annotations",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List a source's comments, newest first.",
  description: "Archived comments are left out unless include_archived is true.",
  input: z.strictObject({ record_id: id("source"), include_archived: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().optional() }),
  rest: { method: "GET", path: "/sources/:record_id/annotations" },
  mcp: { tool: "sources", action: "list_annotations" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id);
    let q = ctx.db.selectFrom("annotations").selectAll().where("record_id", "=", input.record_id);
    if (!input.include_archived) q = q.where("archived_at", "is", null);
    if (input.cursor) q = q.where("annotation_id", "<", input.cursor);
    const rows = await q.orderBy("annotation_id", "desc").limit(input.limit + 1).execute();
    const items = rows.slice(0, input.limit);
    return { items, next_cursor: rows.length > input.limit ? items[items.length - 1]!.annotation_id : null };
  },
});

export const updateAnnotation = defineOperation({
  name: "sources.update_annotation",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Edit a comment's text or tags, or archive or restore it.",
  description:
    "Requires expected_etag. Pass only what changes. The previous text is kept, and a product export includes it, but no action reads it back yet. When archiving, say why in archive_reason rather than rewriting the comment; the reason stays with the comment (list_annotations shows it) and stays out of the activity log. While the source is archived it is read-only, its comments included: this is refused with 409 record_archived until the source is restored.",
  input: z.strictObject({
    annotation_id: id("annotation"),
    expected_etag: expectedEtag,
    note: z.string().trim().min(1).max(2000).optional().describe("The comment's new text, which replaces it: Markdown, up to 2,000 characters."),
    tags: tags.optional().describe("The comment's whole list of tags, which replaces the current one: send every tag to keep, or [] for none. Up to 50, stored lower-case."),
    archived: z.boolean().optional(),
    archive_reason: z.string().trim().min(1).max(500).optional().describe("Why the comment is archived. Only with archived: true; restoring clears it."),
  }),
  rest: { method: "PATCH", path: "/annotations/:annotation_id" },
  mcp: { tool: "sources", action: "update_annotation" },
  async handler(ctx, input) {
    const a = await ctx.db.selectFrom("annotations").selectAll().where("annotation_id", "=", input.annotation_id).where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
    if (!a) throw notFound(`Comment ${input.annotation_id} doesn’t exist in this product.`);
    // A comment is part of its source, which is read-only while archived: editing, archiving and restoring one wait for it.
    await loadRecord(ctx, a.record_id, { live: true });
    checkEtag(input.expected_etag, a.etag, "comment");
    if (input.archive_reason !== undefined && input.archived !== true) throw invalid("invalid_input", "archive_reason goes with archived: true.");
    if (input.note !== undefined && input.note !== a.note) {
      await keepRevision(ctx, "annotation", a.annotation_id, { note: a.note }, a.updated_at, a.updated_by);
    }
    await ctx.db
      .updateTable("annotations")
      .set({
        note: input.note ?? a.note,
        tags: input.tags ? normalizeTags(input.tags) : a.tags,
        archived_at: input.archived === undefined ? a.archived_at : input.archived ? ctx.now : null,
        archive_reason: input.archived === undefined ? a.archive_reason : input.archived ? (input.archive_reason ?? null) : null,
        etag: newEtag(),
        updated_at: ctx.now,
        updated_by: json(ctx.actor),
      })
      .where("annotation_id", "=", a.annotation_id)
      .execute();
    if (input.note !== undefined && input.note !== a.note) await indexText(ctx.db, tenantId(ctx), a.record_id, "comment", input.note, a.annotation_id);
    const r = await ctx.db.selectFrom("records").select("title").where("record_id", "=", a.record_id).executeTakeFirst();
    await recordActivity(ctx, {
      action: input.archived === true ? "note_archived" : input.archived === false ? "note_restored" : "note_updated",
      entity_type: "source",
      entity_id: a.record_id,
      entity_title: r?.title ?? null,
      // The archive reason is the person's own words, so it stays on the comment: the log never quotes content.
      summary: input.archived === true ? "Archived a comment" : input.archived === false ? "Restored a comment" : "Edited a comment",
    });
    return ctx.db.selectFrom("annotations").selectAll().where("annotation_id", "=", a.annotation_id).executeTakeFirstOrThrow();
  },
});

export const deleteAnnotation = defineOperation({
  name: "sources.delete_annotation",
  scope: "product",
  access: "admin",
  mutates: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Delete one comment on a source; archiving it is the reversible alternative.",
  description:
    "Destroys the comment, its tags and its earlier text, and leaves a tombstone: reads of it return 410 with who, when and why. Nothing points at a comment, so there is no delete_impact: show the person the comment itself (from list_annotations) and delete only once they approve. While the source is archived, it is refused with 409 record_archived until the source is restored. " +
    `This is permanent and cannot be undone. Needs admin, and a connection at Admin. Never slip a delete into a run of other actions. Pass the comment's etag as expected_etag, the person's reason, and confirm set to exactly "${DELETE_CONFIRMATION}".`,
  input: z.strictObject({ annotation_id: id("annotation"), ...deleteGuards }),
  rest: { method: "DELETE", path: "/annotations/:annotation_id" },
  mcp: { tool: "sources", action: "delete_annotation" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, "archive it with sources(action=\"update_annotation\", archived: true)");
    const a = await ctx.db.selectFrom("annotations").selectAll().where("annotation_id", "=", input.annotation_id).where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
    if (!a) {
      await refuseIfDeleted(ctx, "annotation", input.annotation_id, `Comment ${input.annotation_id}`);
      throw notFound(`Comment ${input.annotation_id} doesn’t exist in this product.`);
    }
    // Deleting a comment is a write to its source, refused while the source is archived, as adding one is.
    await loadRecord(ctx, a.record_id, { live: true });
    checkEtag(input.expected_etag, a.etag, "comment");
    const r = await ctx.db.selectFrom("records").select("title").where("record_id", "=", a.record_id).executeTakeFirst();
    await leaveTombstone(ctx, { object_type: "annotation", object_id: a.annotation_id, title: truncateQuote(a.note, 200), reason: input.reason });
    await dropRevisions(ctx, "annotation", [a.annotation_id]);
    await ctx.db.deleteFrom("annotations").where("annotation_id", "=", a.annotation_id).execute();
    await indexText(ctx.db, tenantId(ctx), a.record_id, "comment", null, a.annotation_id);
    await recordActivity(ctx, { action: "note_deleted", entity_type: "source", entity_id: a.record_id, entity_title: r?.title ?? null, summary: "Deleted a comment permanently" });
    return { deleted: true, annotation_id: a.annotation_id, record_id: a.record_id, reason: input.reason };
  },
});

// ---- Move and copy between products ------------------------------------------------------------

async function targetProduct(ctx: OpContext, ref: string) {
  const tid = tenantId(ctx);
  const row = await ctx.db
    .selectFrom("products")
    .select(["product_id", "team_id", "name", "slug", "archived_at"])
    .where("tenant_id", "=", tid)
    .where(sql<boolean>`(product_id = ${ref} or slug = ${ref})`)
    .where("team_id", "=", ctx.scope.team!.team_id)
    .executeTakeFirst();
  if (!row) throw notFound(`No product "${ref}" in this team. Sources move and copy only between products of the same team.`);
  if (row.product_id === productId(ctx)) throw invalid("same_product", "The source is already in that product.");
  if (row.archived_at) throw conflict("product_archived", `Product ${row.name} is archived.`);
  const memberships = await membershipsFor(ctx.db, ctx.principal.account_id, tid);
  const { role } = effectiveRole(memberships, { tenant_id: tid, team_id: row.team_id, product_id: row.product_id });
  if (!roleAtLeast(role, "editor")) throw notFound(`No product "${ref}" you can write to in this team.`);
  return row;
}

export const moveSource = defineOperation({
  name: "sources.move_to_product",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Move a source, with its attachments, derived text, summary, notes and comments, to another product in the same team.",
  description:
    "The source keeps its record_id, so its attachments and their versions, its derived text, summary, notes and comments move intact. Copy instead to keep it in both.",
  input: z.strictObject({ record_id: id("source"), to_product: z.string().min(1).describe("Target product id or slug, in the same team."), expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/sources/:record_id/move" },
  mcp: { tool: "sources", action: "move_to_product" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id, { lock: true });
    checkEtag(input.expected_etag, r.etag, "source");
    const target = await targetProduct(ctx, input.to_product);
    await ctx.db.updateTable("records").set({ product_id: target.product_id, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("record_id", "=", r.record_id).execute();
    await ctx.db.updateTable("annotations").set({ product_id: target.product_id }).where("record_id", "=", r.record_id).execute();
    await ctx.db.updateTable("upload_grants").set({ product_id: target.product_id }).where("record_id", "=", r.record_id).execute();
    await recordActivity(ctx, { action: "moved_out", entity_type: "source", entity_id: r.record_id, entity_title: r.title, summary: `Moved to product ${target.name}` });
    await recordActivity(
      { ...ctx, scope: { ...ctx.scope, product: { product_id: target.product_id, slug: target.slug, name: target.name, archived_at: null } } },
      { action: "moved_in", entity_type: "source", entity_id: r.record_id, entity_title: r.title, summary: `Moved here from product ${ctx.scope.product!.name}` },
    );
    return { record_id: r.record_id, product_id: target.product_id, product: target.name };
  },
});

export const copySource = defineOperation({
  name: "sources.copy_to_product",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Copy a source into another product in the same team, with a new id and a copied_from link.",
  description:
    "The copy shares the original's stored attachments (blobs are immutable), which are read afresh in the target, and takes its derived text. The summary, notes and comments stay with the original. Returns the new record id.",
  input: z.strictObject({ record_id: id("source"), to_product: z.string().min(1) }),
  rest: { method: "POST", path: "/sources/:record_id/copy" },
  mcp: { tool: "sources", action: "copy_to_product" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id);
    const target = await targetProduct(ctx, input.to_product);
    const targetCtx: OpContext = { ...ctx, scope: { ...ctx.scope, product: { product_id: target.product_id, slug: target.slug, name: target.name, archived_at: null } } };
    const copy = await insertRecord(targetCtx, r, { product_id: productId(ctx), record_id: r.record_id });
    const files = await ctx.db.selectFrom("files").selectAll().where("record_id", "=", r.record_id).execute();
    const text = await ctx.db.selectFrom("source_texts").selectAll().where("record_id", "=", r.record_id).executeTakeFirst();
    // The copy's derived text is still the text of the attachment it was taken from: its copy.
    let textFrom: string | null = null;
    for (const f of files) {
      if (!f.current_version_id) continue;
      const v = await ctx.db.selectFrom("file_versions").selectAll().where("file_version_id", "=", f.current_version_id).executeTakeFirstOrThrow();
      const file_id = newId();
      const file_version_id = newId();
      await ctx.db.insertInto("files").values({ file_id, tenant_id: tenantId(ctx), record_id: copy.record_id, path: f.path, current_version_id: file_version_id, added_by: json(ctx.actor) }).execute();
      await ctx.db.insertInto("file_versions").values({ file_version_id, tenant_id: tenantId(ctx), record_id: copy.record_id, file_id, blob_key: v.blob_key, size: v.size, sha256: v.sha256, media_type: v.media_type, created_by: json(ctx.actor) }).execute();
      if (text?.from_file_version_id) {
        const was = await ctx.db.selectFrom("file_versions").select("file_id").where("file_version_id", "=", text.from_file_version_id).executeTakeFirst();
        if (was?.file_id === f.file_id) textFrom = file_version_id;
      }
      await ctx.enqueue("derive", { record_id: copy.record_id, file_version_id });
    }
    if (text) {
      await ctx.db
        .insertInto("source_texts")
        .values({ record_id: copy.record_id, tenant_id: tenantId(ctx), content: text.content, chars: text.chars, from_file_version_id: textFrom, updated_at: text.updated_at, updated_by: json(text.updated_by), etag: newEtag() })
        .execute();
      await indexSource(ctx.db, copy.record_id);
    }
    await recordActivity(ctx, { action: "copied_out", entity_type: "source", entity_id: r.record_id, entity_title: r.title, summary: `Copied to product ${target.name}` });
    return { record_id: copy.record_id, product_id: target.product_id, copied_from: { product_id: productId(ctx), record_id: r.record_id } };
  },
});

// ---- Delete: permanent, guarded, and said plainly ----------------------------------------------

async function impact(ctx: OpContext, r: RecordRow) {
  const files = await ctx.db.selectFrom("file_versions").select(["file_version_id", "size", "blob_key"]).where("record_id", "=", r.record_id).execute();
  const derivations = await ctx.db.selectFrom("derivations").select(["derivation_id", "blob_prefix"]).where("record_id", "=", r.record_id).execute();
  const annotations = await ctx.db.selectFrom("annotations").select("annotation_id").where("record_id", "=", r.record_id).execute();
  return {
    record_id: r.record_id,
    title: r.title,
    etag: r.etag,
    file_versions: files.length,
    bytes: files.reduce((n, f) => n + Number(f.size), 0),
    derivations: derivations.length,
    annotations: annotations.length,
    after_delete: "Its attachments, every stored version of them and what was read from them, its derived text, summary, notes and comments go. Links to it from Story pages, mockups and notes open a record of the deletion instead.",
    _blobs: files.map((f) => f.blob_key),
    _prefixes: derivations.map((d) => d.blob_prefix),
  };
}

export const deleteImpact = defineOperation({
  name: "sources.delete_impact",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Preview exactly what deleting a source would destroy.",
  description:
    "Read-only. Show the person this result before proposing a delete. Pass this result's etag as the delete's expected_etag.",
  input: z.strictObject({ record_id: id("source") }),
  rest: { method: "GET", path: "/sources/:record_id/delete-impact" },
  mcp: { tool: "sources", action: "delete_impact" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id);
    const { _blobs, _prefixes, ...rest } = await impact(ctx, r);
    void _blobs;
    void _prefixes;
    return { ...rest, reversible_alternative: "sources(action=\"archive\") takes it out of views and search and erases nothing." };
  },
});

export const deleteSource = defineOperation({
  name: "sources.delete",
  scope: "product",
  access: "admin",
  mutates: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Destroys a source's attachments, derived text, notes and comments; archive is the reversible alternative.",
  description:
    "Archive (sources.archive) is the reversible alternative and almost always what is wanted. " +
    DELETE_GUIDANCE +
    " Leaves a tombstone: reads return 410 with who, when and why.",
  input: z.strictObject({ record_id: id("source"), ...deleteGuards }),
  rest: { method: "DELETE", path: "/sources/:record_id" },
  mcp: { tool: "sources", action: "delete" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, "archive");
    const r = await loadRecord(ctx, input.record_id, { lock: true });
    if (!sameEtag(input.expected_etag, r.etag)) checkEtag(input.expected_etag, r.etag, "source");
    const im = await impact(ctx, r);
    await leaveTombstone(ctx, { object_type: "source", object_id: r.record_id, title: r.title, reason: input.reason });
    const notes = await ctx.db.selectFrom("annotations").select("annotation_id").where("record_id", "=", r.record_id).execute();
    await dropRevisions(ctx, "annotation", notes.map((n) => n.annotation_id));
    await ctx.db.deleteFrom("records").where("record_id", "=", r.record_id).execute();
    // Blobs shared with a copy in another product stay until nothing refers to them.
    const stillUsed = im._blobs.length
      ? (await ctx.db.selectFrom("file_versions").select("blob_key").where("blob_key", "in", im._blobs).execute()).map((x) => x.blob_key)
      : [];
    await ctx.enqueue("delete_blobs", { keys: im._blobs.filter((k) => !stillUsed.includes(k)), prefixes: im._prefixes });
    await recordActivity(ctx, { action: "deleted", entity_type: "source", entity_id: r.record_id, entity_title: r.title, summary: "Deleted the source permanently" });
    const { _blobs, _prefixes, ...rest } = im;
    void _blobs;
    void _prefixes;
    return { deleted: true, ...rest, reason: input.reason };
  },
});

export const sourceOps = [
  sourceFacets, listSources, getSource, createSource, updateSource, archiveSources, restoreSources,
  annotate, listAnnotations, updateAnnotation, deleteAnnotation, moveSource, copySource, deleteImpact, deleteSource,
];
