import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, normalizeDimensions, normalizeTags, productId, recordActivity, tenantId } from "../common.ts";
import { json, type RecordsTable } from "../db.ts";
import { conflict, gone, invalid, notFound } from "../errors.ts";
import { describeFolder, folderFor, GROUPS, KINDS, kindInfo, SEARCH_RULE } from "../kinds.ts";
import { effectiveRole, membershipsFor, roleAtLeast } from "../policy.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { dimensions, expectedEtag, id, isoDate, kind, provenanceDepth, tags } from "../schemas.ts";
import { newEtag, newId, sameEtag, slugify, uniq } from "../util.ts";

type RecordRow = Selectable<RecordsTable>;

export const MAX_BATCH = 200;
export const DELETE_CONFIRMATION = "delete permanently";

export async function loadRecord(ctx: OpContext, recordId: string, opts: { lock?: boolean; live?: boolean } = {}): Promise<RecordRow> {
  let q = ctx.db.selectFrom("records").selectAll().where("record_id", "=", recordId).where("product_id", "=", productId(ctx));
  if (opts.lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) {
    const tomb = await ctx.db.selectFrom("tombstones").selectAll().where("object_id", "=", recordId).where("product_id", "=", productId(ctx)).executeTakeFirst();
    if (tomb) throw gone("record_deleted", `Source ${recordId} was deleted permanently on ${tomb.deleted_at}.`, { tombstone: tomb });
    throw notFound(`Source ${recordId} does not exist in this product.`);
  }
  if (opts.live && row.archived_at) throw conflict("record_archived", `Source ${recordId} is archived; restore it first.`);
  return row;
}

/** The derived status a caller sees: the current derivation's status, or where the record stands before one exists. */
export async function derivedStatuses(ctx: OpContext, recordIds: string[]) {
  const out = new Map<string, { derived_status: string; segment_count: number; text_chars: number; duration_ms: number | null; file_count: number; pending_primary_path: string | null; status_detail: string | null; derivation_id: string | null }>();
  if (!recordIds.length) return out;
  const rows = await sql<{
    record_id: string;
    status: string | null;
    status_detail: string | null;
    segment_count: number | null;
    text_chars: number | null;
    duration_ms: string | null;
    derivation_id: string | null;
    derivation_version: string | null;
    primary_version: string | null;
    file_count: number;
    pending_primary: string | null;
    job_pending: boolean;
  }>`
    select r.record_id, d.status, d.status_detail, d.segment_count, d.text_chars, d.duration_ms, d.derivation_id,
      d.file_version_id as derivation_version,
      (select f.current_version_id from files f where f.record_id = r.record_id and f.role = 'primary') as primary_version,
      (select count(*)::int from files f where f.record_id = r.record_id) as file_count,
      (select g.path from upload_grants g where g.record_id = r.record_id and g.role = 'primary'
         and g.completed_at is null and g.expires_at > now() order by g.created_at desc limit 1) as pending_primary,
      exists (select 1 from jobs j where j.kind = 'derive' and j.done_at is null and j.payload->>'record_id' = r.record_id) as job_pending
    from records r left join derivations d on d.derivation_id = r.current_derivation_id
    where r.record_id = any(${recordIds})`.execute(ctx.db);
  for (const r of rows.rows) {
    let status: string;
    if (!r.primary_version) status = r.pending_primary ? "pending" : "awaiting_file";
    else if (r.job_pending || !r.status || r.derivation_version !== r.primary_version) status = "pending";
    else status = r.status;
    out.set(r.record_id, {
      derived_status: status,
      status_detail: status === r.status ? r.status_detail : null,
      segment_count: status === "ready" ? Number(r.segment_count ?? 0) : 0,
      text_chars: status === "ready" ? Number(r.text_chars ?? 0) : 0,
      // A transcript's last cue time, or a recording's playing time read from its container.
      duration_ms: status === r.status && r.duration_ms !== null ? Number(r.duration_ms) : null,
      file_count: r.file_count,
      pending_primary_path: r.primary_version ? null : r.pending_primary,
      derivation_id: r.derivation_id,
    });
  }
  return out;
}

/** Said wherever a source with files but no primary shows up: a primary is still expected. */
export const NO_PRIMARY_WARNING =
  "This source has no primary file yet, so nothing on it is parsed or searched. A primary is still expected: upload one with files(action=\"request_upload\", role=\"primary\"), or make an existing file the primary with files(action=\"set_role\").";

/** What a read of a source should warn about, beyond its derived_status. */
function sourceWarnings(s: { derived_status: string; file_count: number }): string[] {
  return s.derived_status === "awaiting_file" && s.file_count > 0 ? [NO_PRIMARY_WARNING] : [];
}

/**
 * A soft warning, never a refusal, when a live source in this product already has the same title
 * (ignoring case and surrounding space), kind and date: duplicates split citations and dilute search.
 */
export async function duplicateWarnings(ctx: OpContext, meta: { kind: string; title: string; date?: string | null | undefined }): Promise<string[]> {
  const date = meta.date ?? null;
  const same = await ctx.db
    .selectFrom("records")
    .select(["record_id", "title"])
    .where("product_id", "=", productId(ctx))
    .where("archived_at", "is", null)
    .where("kind", "=", meta.kind)
    .where(sql<boolean>`lower(btrim(title)) = lower(btrim(${meta.title}))`)
    .where(date === null ? sql<boolean>`date is null` : sql<boolean>`date = ${date}`)
    .orderBy("record_id")
    .limit(5)
    .execute();
  if (!same.length) return [];
  const ids = same.map((r) => r.record_id).join(", ");
  return [
    `A source with the same title, kind and date already exists (${ids}). If this is the same material, add files to that source and archive this one; if it is different, give this one a title that tells them apart.`,
  ];
}

export function recordSummary(r: RecordRow, s?: { derived_status: string; segment_count: number; file_count: number }) {
  const info = kindInfo(r.kind);
  return {
    record_id: r.record_id,
    kind: r.kind,
    kind_label: info.label,
    title: r.title,
    date: r.date,
    organization: r.organization,
    tags: r.tags,
    dimensions: r.dimensions,
    provenance_depth: r.provenance_depth,
    folder: r.folder,
    folder_label: describeFolder(r.folder),
    uploaded_by: r.uploaded_by,
    uploaded_at: r.uploaded_at,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
    archived_at: r.archived_at,
    derived_status: s?.derived_status ?? "pending",
    segment_count: s?.segment_count ?? 0,
    file_count: s?.file_count ?? 0,
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
  return invalid("invalid_cursor", "This cursor does not belong to this sort. Pass next_cursor back with the same filters and sort.");
}

// ---- Taxonomy-----------------------------------------------------------------------------------

export const listKinds = defineOperation({
  name: "sources.kinds",
  scope: "account",
  access: "any",
  mutates: false,
  summary: "The source taxonomy: every kind, its group, and what intake asks for.",
  description:
    "Pick the kind that says what the material is. Dated kinds want the event date (not the upload date); organizational kinds want the organization concerned. Use analysis, digest and view for derived material so readers can tell evidence from interpretation.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/kinds" },
  mcp: { tool: "sources", action: "kinds" },
  async handler() {
    return { groups: GROUPS, kinds: KINDS, search_rule: SEARCH_RULE };
  },
});

// ---- Listing and reading ------------------------------------------------------------------------

export const listSources = defineOperation({
  name: "sources.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List sources by metadata: newest added first, or by date, last update or title, either way round. For passage content use search.",
  description:
    "Filters combine. `query` is a case-insensitive substring over metadata only — title, organization, participants, source system, tags and file names — never passage text; use `search` for content. `sort`: added (newest added first, the default), date (the source's own date, newest first, undated last), updated (details most recently changed first) or title (A to Z). `order` reverses it: asc or desc, defaulting to desc for the three dates and asc for title; undated sources stay last either way. Returns summaries with derived_status, the primary file's path (primary_file) and next_cursor; pass the cursor back with the same filters, sort and order.",
  input: z.strictObject({
    folder: z.string().max(100).optional().describe("A folder root such as interviews or documents/decks, or a prefix under it."),
    kind: kind.optional(),
    organization: z.string().max(200).optional().describe("Exact, case-insensitive."),
    date_from: isoDate.optional(),
    date_to: isoDate.optional(),
    tags: z.array(z.string()).max(20).optional().describe("All must match."),
    query: z.string().max(500).optional(),
    customer: z.string().max(120).optional(),
    product_area: z.string().max(120).optional(),
    lifecycle_stage: z.enum(["discovery", "sales", "research"]).optional(),
    provenance_depth: provenanceDepth.optional(),
    include_archived: z.boolean().default(false),
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
    if (input.folder) {
      const f = input.folder.replace(/^\/+|\/+$/g, "");
      q = q.where(sql<boolean>`(folder = ${f} or folder like ${f + "/%"})`);
    }
    if (input.kind) q = q.where("kind", "=", input.kind);
    if (input.organization) q = q.where(sql<boolean>`lower(organization) = lower(${input.organization})`);
    if (input.date_from) q = q.where("date", ">=", input.date_from);
    if (input.date_to) q = q.where("date", "<=", input.date_to);
    if (input.tags?.length) q = q.where(sql<boolean>`tags @> ${normalizeTags(input.tags)}::text[]`);
    for (const k of ["customer", "product_area", "lifecycle_stage"] as const) {
      const v = input[k];
      if (v) q = q.where(sql<boolean>`dimensions->>${k} = ${normalizeDimensions({ [k]: v })[k]!}`);
    }
    if (input.provenance_depth) q = q.where("provenance_depth", "=", input.provenance_depth);
    if (input.query) {
      const like = `%${input.query}%`;
      q = q.where(
        sql<boolean>`(title ilike ${like} or coalesce(organization,'') ilike ${like} or coalesce(source_system,'') ilike ${like}
          or array_to_string(participants, ' ') ilike ${like} or array_to_string(tags, ' ') ilike ${like}
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
    const primaries = page.length
      ? await ctx.db.selectFrom("files").select(["record_id", "path"]).where("role", "=", "primary").where("record_id", "in", page.map((r) => r.record_id)).execute()
      : [];
    const primaryOf = new Map(primaries.map((f) => [f.record_id, f.path]));
    const last = page[page.length - 1];
    let next: string | null = null;
    if (rows.length > input.limit && last)
      next =
        input.sort === "added"
          ? last.record_id
          : Buffer.from(JSON.stringify({ v: input.sort === "date" ? last.date : input.sort === "updated" ? last.sort_updated : last.sort_title, id: last.record_id })).toString("base64url");
    return {
      records: page.map((r) => ({ ...recordSummary(r, statuses.get(r.record_id)), primary_file: primaryOf.get(r.record_id) ?? null })),
      next_cursor: next,
    };
  },
});

export async function fileEntries(ctx: OpContext, recordId: string, derivedStatus: string) {
  const files = await ctx.db.selectFrom("files").selectAll().where("record_id", "=", recordId).orderBy("added_at").execute();
  const versions = await ctx.db
    .selectFrom("file_versions")
    .select(["file_version_id", "file_id", "size", "sha256", "media_type", "created_at", "created_by"])
    .where("record_id", "=", recordId)
    .orderBy("file_version_id", "desc")
    .execute();
  return files.map((f) => {
    const vs = versions.filter((v) => v.file_id === f.file_id);
    const cur = vs.find((v) => v.file_version_id === f.current_version_id) ?? vs[0];
    const searchable = f.role === "primary" && derivedStatus === "ready";
    return {
      path: f.path,
      role: f.role,
      media_type: cur?.media_type ?? null,
      size: cur ? Number(cur.size) : null,
      sha256: cur?.sha256 ?? null,
      file_version_id: f.current_version_id,
      versions: vs.map((v) => ({ file_version_id: v.file_version_id, size: Number(v.size), media_type: v.media_type, created_at: v.created_at, created_by: v.created_by })),
      derived_from: f.derived_from,
      derivation_note: f.derivation_note,
      derived_by: f.derived_by,
      added_at: f.added_at,
      added_by: f.added_by,
      role_changed_at: f.role_changed_at,
      role_changed_by: f.role_changed_by,
      searchable,
      search_status: f.role === "primary" ? derivedStatus : "not_searched",
    };
  });
}

export const getSource = defineOperation({
  name: "sources.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read a source cheaply (brief), or everything about it (full): files, manifest, outline, notes.",
  description:
    "Start with detail=\"brief\" to check derived_status and segment_count, then plan read_passage windows. warnings says when the source has files but still no primary. etag is the one sources.update and sources.delete expect. `full` adds files (each with searchable and search_status), the derivation manifest, the outline, notes, and for a view its lineage (direct inputs, how they were chosen, when captured and registered; staleness comes from lineage check). Neither returns file bytes or derived text. An archived source is still readable by id.",
  input: z.strictObject({ record_id: id("source"), detail: z.enum(["brief", "full"]).default("brief") }),
  rest: { method: "GET", path: "/sources/:record_id" },
  mcp: { tool: "sources", action: "get" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id);
    const s = (await derivedStatuses(ctx, [r.record_id])).get(r.record_id)!;
    const brief = {
      ...recordSummary(r, s),
      text_chars: s.text_chars,
      duration_ms: s.duration_ms,
      status_detail: s.status_detail,
      warnings: sourceWarnings(s),
      annotation_count: Number(
        (await ctx.db.selectFrom("annotations").select((eb) => eb.fn.countAll<number>().as("n")).where("record_id", "=", r.record_id).where("archived_at", "is", null).executeTakeFirst())?.n ?? 0,
      ),
    };
    if (input.detail === "brief") return brief;
    const derivation = s.derivation_id
      ? await ctx.db.selectFrom("derivations").selectAll().where("derivation_id", "=", s.derivation_id).executeTakeFirst()
      : undefined;
    let outline: string | null = null;
    if (derivation) {
      try {
        outline = new TextDecoder().decode(await ctx.ports.blobs.get(`${derivation.blob_prefix}/outline.md`));
      } catch {
        outline = null;
      }
    }
    const annotations = await ctx.db.selectFrom("annotations").selectAll().where("record_id", "=", r.record_id).where("archived_at", "is", null).orderBy("annotation_id", "desc").limit(100).execute();
    const lineage = await ctx.db.selectFrom("lineage").select(["inputs", "query_spec", "captured_at", "generated_at", "generated_by"]).where("record_id", "=", r.record_id).executeTakeFirst();
    const agentNotes = await ctx.db.selectFrom("agent_notes").select(["kind", "updated_at", "updated_by"]).where("record_id", "=", r.record_id).execute();
    return {
      ...brief,
      participants: r.participants,
      source_system: r.source_system,
      related_records: r.related_records,
      copied_from: r.copied_from,
      updated_at: r.updated_at,
      updated_by: r.updated_by,
      pending_primary_path: s.pending_primary_path,
      files: await fileEntries(ctx, r.record_id, s.derived_status),
      search_rule: SEARCH_RULE,
      manifest: derivation
        ? {
            derivation_id: derivation.derivation_id,
            status: derivation.status,
            status_detail: derivation.status_detail,
            parser: derivation.parser,
            parser_version: derivation.parser_version,
            source_path: derivation.source_path,
            file_version_id: derivation.file_version_id,
            segment_count: derivation.segment_count,
            text_chars: derivation.text_chars,
            duration_ms: derivation.duration_ms === null ? null : Number(derivation.duration_ms),
            facts: derivation.facts,
            created_at: derivation.created_at,
            inference: "none: passages come from a deterministic parser; no model produced or altered this text",
          }
        : null,
      outline,
      annotations,
      has_lineage: Boolean(lineage),
      lineage: lineage
        ? {
            scope: "direct_inputs",
            inputs: lineage.inputs.map((i) => ({ kind: i.kind, id: i.id })),
            query_spec: lineage.query_spec,
            captured_at: lineage.captured_at,
            registered_at: lineage.generated_at,
            registered_by: lineage.generated_by,
            staleness: 'Not checked here: call lineage(action="check").',
          }
        : null,
      agent_notes: agentNotes,
    };
  },
});

// ---- Creating and correcting --------------------------------------------------------------------

export const recordMetadata = {
  title: z.string().trim().min(1).max(300).describe('Say what it is: who, what, when — e.g. "Operations lead interview — Example Co, Sep 2026". Never a file name.'),
  date: isoDate.nullable().optional().describe("The date of the event or document, never the upload date. Null when unknown."),
  organization: z.string().trim().max(200).nullable().optional().describe("The external organization the material concerns."),
  participants: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  source_system: z.string().trim().max(100).nullable().optional().describe("Where it came from: a meeting tool, a wiki, a research tool, or manual."),
  tags: tags.optional(),
  related_records: z.array(id("source")).max(50).optional(),
  dimensions: dimensions.optional(),
  provenance_depth: provenanceDepth.optional(),
};

async function checkRelated(ctx: OpContext, ids: string[] | undefined, self?: string) {
  const list = uniq(ids ?? []).filter((i) => i !== self);
  if (!list.length) return list;
  const found = await ctx.db.selectFrom("records").select(["record_id", "product_id"]).where("record_id", "in", list).execute();
  for (const i of list) {
    const f = found.find((x) => x.record_id === i);
    if (!f) throw invalid("unknown_reference", `Related source ${i} does not exist.`);
    if (f.product_id !== productId(ctx)) throw invalid("cross_product_reference", `Related source ${i} is in another product.`);
  }
  return list;
}

export async function insertRecord(
  ctx: OpContext,
  input: {
    kind: string;
    title: string;
    date?: string | null | undefined;
    organization?: string | null | undefined;
    participants?: string[] | undefined;
    source_system?: string | null | undefined;
    tags?: string[] | undefined;
    related_records?: string[] | undefined;
    dimensions?: Record<string, unknown> | undefined;
    provenance_depth?: string | undefined;
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
      kind: input.kind,
      title: input.title,
      date,
      organization: input.organization ?? null,
      participants: input.participants ?? [],
      source_system: input.source_system ?? null,
      tags: normalizeTags(input.tags),
      related_records: await checkRelated(ctx, input.related_records),
      dimensions: json(normalizeDimensions(input.dimensions as never)),
      provenance_depth: input.provenance_depth ?? "unknown",
      folder: folderFor(input.kind, date),
      slug: slugify(date ? `${date}-${input.title}` : input.title),
      copied_from: json(copiedFrom),
      etag: newEtag(),
      uploaded_by: json(ctx.actor),
      updated_by: json(ctx.actor),
    })
    .execute();
  const info = kindInfo(input.kind);
  await recordActivity(ctx, {
    action: copiedFrom ? "copied" : "created",
    entity_type: "source",
    entity_id: record_id,
    entity_title: input.title,
    summary: copiedFrom ? `Copied a ${info.label.toLowerCase()} source from another product` : `Added a ${info.label.toLowerCase()} source`,
  });
  return loadRecord(ctx, record_id);
}

export const createSource = defineOperation({
  name: "sources.create",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Create a source (a record) from metadata; then add files with files.request_upload, files.add_note or files.fetch_url.",
  description:
    "Describe what the material is; the folder is derived from kind and date and never supplied. To create a source and get an upload grant in one call, use files(action=\"create_upload\"). Before creating, check sources(action=\"list\", query=…) for an equivalent source — duplicates dilute search and split citations. warnings names any live source with the same title, kind and date; nothing is refused.",
  input: z.strictObject({ kind, ...recordMetadata }),
  rest: { method: "POST", path: "/sources" },
  mcp: { tool: "sources", action: "create" },
  async handler(ctx, input) {
    const warnings = await duplicateWarnings(ctx, input);
    const r = await insertRecord(ctx, input);
    return { ...recordSummary(r, { derived_status: "awaiting_file", segment_count: 0, file_count: 0 }), warnings };
  },
});

export const updateSource = defineOperation({
  name: "sources.update",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Correct a source's metadata in place — kind, title, date, organization, tags and more. Pass only what changes.",
  description:
    "Fix mistakes here; never archive and recreate, because citations point at the record id. Changing kind, title or date re-derives the logical folder; the id, files, passages and every citation are untouched. Requires expected_etag: the source's current etag, from sources(action=\"get\") or the result of your last write to it. Adding a file also changes it. A stale one gets 409 stale_etag with details.current_etag; read the source again before retrying.",
  input: z.strictObject({ record_id: id("source"), expected_etag: expectedEtag, kind: kind.optional(), ...recordMetadata, title: recordMetadata.title.optional() }),
  rest: { method: "PATCH", path: "/sources/:record_id" },
  mcp: { tool: "sources", action: "update" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id, { lock: true });
    checkEtag(input.expected_etag, r.etag, "source");
    const next = {
      kind: input.kind ?? r.kind,
      title: input.title ?? r.title,
      date: input.date === undefined ? r.date : input.date,
      organization: input.organization === undefined ? r.organization : input.organization,
      participants: input.participants ?? r.participants,
      source_system: input.source_system === undefined ? r.source_system : input.source_system,
      tags: input.tags ? normalizeTags(input.tags) : r.tags,
      related_records: input.related_records ? await checkRelated(ctx, input.related_records, r.record_id) : r.related_records,
      dimensions: normalizeDimensions(input.dimensions, r.dimensions),
      provenance_depth: input.provenance_depth ?? r.provenance_depth,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(r[k]));
    if (!changed.length) return { ...recordSummary(r), changed: [] };
    const folder = folderFor(next.kind, next.date);
    await ctx.db
      .updateTable("records")
      .set({
        ...next,
        dimensions: json(next.dimensions),
        folder,
        slug: slugify(next.date ? `${next.date}-${next.title}` : next.title),
        etag: newEtag(),
        updated_at: ctx.now,
        updated_by: json(ctx.actor),
      })
      .where("record_id", "=", r.record_id)
      .execute();
    const moved = folder !== r.folder;
    await recordActivity(ctx, {
      action: moved ? "reorganized" : "updated",
      entity_type: "source",
      entity_id: r.record_id,
      entity_title: next.title,
      summary: moved ? `Refiled under ${describeFolder(folder)}; changed ${changed.join(", ")}` : `Changed ${changed.join(", ")}`,
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
    "Archive is how a team says \"stop showing me this, and stop letting the agent find it\" without losing it. Citations to an archived source still resolve and report record_archived. Archiving an archived source is a no-op success. Returns {archived, failed}.",
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
  summary: "Attach a note to a source, optionally to an exact segment range.",
  description:
    "Use notes for a single-source observation; use an insight for anything across sources. A segment range is inclusive, at most 50 segments, within the source's current derivation; the note keeps an anchor (the range, its offsets and derivation, and its text with the speaker's name at each change of turn) so it can be re-located after a re-parse.",
  input: z.strictObject({
    record_id: id("source"),
    note: z.string().trim().min(1).max(2000).describe("Markdown, up to 2,000 characters."),
    seq_start: z.number().int().min(0).optional(),
    seq_end: z.number().int().min(0).optional(),
    tags: tags.optional(),
  }),
  rest: { method: "POST", path: "/sources/:record_id/annotations" },
  mcp: { tool: "sources", action: "annotate" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id, { live: true });
    if ((input.seq_start === undefined) !== (input.seq_end === undefined)) throw invalid("invalid_input", "Give both seq_start and seq_end, or neither.");
    let anchor: Record<string, unknown> | null = null;
    if (input.seq_start !== undefined && input.seq_end !== undefined) {
      if (input.seq_end < input.seq_start) throw invalid("invalid_input", "seq_end must not be before seq_start.");
      if (input.seq_end - input.seq_start + 1 > 50) throw invalid("window_too_large", "A note covers at most 50 segments.");
      const segs = await ctx.db
        .selectFrom("segments")
        .select(["seq", "text", "speaker", "char_start", "char_end", "derivation_id"])
        .where("record_id", "=", r.record_id)
        .where("is_current", "=", true)
        .where("seq", ">=", input.seq_start)
        .where("seq", "<=", input.seq_end)
        .orderBy("seq")
        .execute();
      if (segs.length !== input.seq_end - input.seq_start + 1)
        throw invalid("out_of_range", "That segment range does not exist in full in the source's current passages.");
      // Each change of speaker opens with the speaker's name, so a note across turns keeps who said what.
      const text = segs.map((s, i) => (s.speaker && s.speaker !== segs[i - 1]?.speaker ? `${s.speaker}: ${s.text}` : s.text)).join("\n\n");
      anchor = {
        seq_start: input.seq_start,
        seq_end: input.seq_end,
        char_start: segs[0]!.char_start,
        char_end: segs[segs.length - 1]!.char_end,
        derivation_id: segs[0]!.derivation_id,
        quote: truncateQuote(text, 500),
      };
    }
    const annotation_id = newId();
    await ctx.db
      .insertInto("annotations")
      .values({
        annotation_id, tenant_id: tenantId(ctx), product_id: productId(ctx), record_id: r.record_id,
        seq_start: input.seq_start ?? null, seq_end: input.seq_end ?? null, note: input.note, tags: normalizeTags(input.tags),
        anchor: json(anchor), etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    await recordActivity(ctx, { action: "note_added", entity_type: "source", entity_id: r.record_id, entity_title: r.title, summary: input.seq_start !== undefined ? `Added a note on segments ${input.seq_start}–${input.seq_end}` : "Added a note" });
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
  summary: "List a source's notes, newest first.",
  description: "Archived notes are left out unless include_archived is true.",
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
  summary: "Edit a note's text or tags, or archive or restore it.",
  description: "Requires expected_etag. The previous note text is kept as a revision. When archiving, say why in archive_reason rather than rewriting the note.",
  input: z.strictObject({
    annotation_id: id("annotation"),
    expected_etag: expectedEtag,
    note: z.string().trim().min(1).max(2000).optional(),
    tags: tags.optional(),
    archived: z.boolean().optional(),
    archive_reason: z.string().trim().min(1).max(500).optional().describe("Why the note is archived. Only with archived: true; restoring clears it."),
  }),
  rest: { method: "PATCH", path: "/annotations/:annotation_id" },
  mcp: { tool: "sources", action: "update_annotation" },
  async handler(ctx, input) {
    const a = await ctx.db.selectFrom("annotations").selectAll().where("annotation_id", "=", input.annotation_id).where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
    if (!a) throw notFound(`Note ${input.annotation_id} does not exist in this product.`);
    checkEtag(input.expected_etag, a.etag, "note");
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
    const r = await ctx.db.selectFrom("records").select("title").where("record_id", "=", a.record_id).executeTakeFirst();
    await recordActivity(ctx, {
      action: input.archived === true ? "note_archived" : input.archived === false ? "note_restored" : "note_updated",
      entity_type: "source",
      entity_id: a.record_id,
      entity_title: r?.title ?? null,
      summary: input.archived === true ? (input.archive_reason ? `Archived a note: ${truncateQuote(input.archive_reason, 200)}` : "Archived a note") : input.archived === false ? "Restored a note" : "Edited a note",
    });
    return ctx.db.selectFrom("annotations").selectAll().where("annotation_id", "=", a.annotation_id).executeTakeFirstOrThrow();
  },
});

// ---- Connections --------------------------------------------------------------------------------

/** Story pages whose current version cites a source or lists it in refs. */
async function storyPagesUsing(ctx: OpContext, recordId: string, opts: { includeArchived: boolean }) {
  let q = ctx.db
    .selectFrom("story_pages as p")
    .innerJoin("story_versions as v", "v.version_id", "p.current_version_id")
    .select(["p.page_id", "p.title", "p.archived_at", "v.n", "v.citations", "v.refs"])
    .where("p.product_id", "=", productId(ctx))
    .where(sql<boolean>`(v.citations @> ${JSON.stringify([{ record_id: recordId }])}::jsonb or v.refs->'sources' ? ${recordId})`);
  if (!opts.includeArchived) q = q.where("p.archived_at", "is", null);
  const rows = await q.orderBy("p.title").execute();
  return rows.map((r) => ({
    page_id: r.page_id,
    title: r.title,
    version: r.n,
    archived_at: r.archived_at,
    referenced: r.refs.sources.includes(recordId),
    citations: r.citations.filter((c) => c.record_id === recordId).map((c) => ({ seq_start: c.seq_start, seq_end: c.seq_end })),
  }));
}

/** Mockups whose current version cites a source or lists it in refs. */
async function mockupsUsing(ctx: OpContext, recordId: string, opts: { includeArchived: boolean }) {
  let q = ctx.db
    .selectFrom("mockups as m")
    .innerJoin("mockup_versions as v", "v.version_id", "m.current_version_id")
    .select(["m.mockup_id", "m.title", "m.archived_at", "v.n", "v.citations", "v.refs"])
    .where("m.product_id", "=", productId(ctx))
    .where(sql<boolean>`(v.citations @> ${JSON.stringify([{ record_id: recordId }])}::jsonb or v.refs->'sources' ? ${recordId})`);
  if (!opts.includeArchived) q = q.where("m.archived_at", "is", null);
  const rows = await q.orderBy("m.title").execute();
  return rows.map((r) => ({
    mockup_id: r.mockup_id,
    title: r.title,
    version: r.n,
    archived_at: r.archived_at,
    referenced: r.refs.sources.includes(recordId),
    citations: r.citations.filter((c) => c.record_id === recordId).map((c) => ({ seq_start: c.seq_start, seq_end: c.seq_end })),
  }));
}

export const insightsFor = defineOperation({
  name: "sources.insights_for",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Everything built on a source: insights that reference it, assumptions and decisions that cite it, Story pages and mockups that cite or reference it, and views whose lineage lists it as an input.",
  description:
    "Each citation names its exact segment range, so you can read the passage that supports it. Story pages and mockups are judged by their current version; archived pages, mockups and views are left out. Views are those that list this source as a direct input; call lineage(action=\"check\") on one to see whether it is stale.",
  input: z.strictObject({ record_id: id("source") }),
  rest: { method: "GET", path: "/sources/:record_id/insights" },
  mcp: { tool: "sources", action: "insights_for" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id);
    const insights = await ctx.db
      .selectFrom("insights")
      .select(["insight_id", "title", "summary", "status", "updated_at"])
      .where("product_id", "=", productId(ctx))
      .where("status", "!=", "archived")
      .where(sql<boolean>`refs->'sources' ? ${input.record_id}`)
      .orderBy("insight_id", "desc")
      .limit(100)
      .execute();
    const entries = await ctx.db
      .selectFrom("register_entries")
      .select(["entry_id", "kind", "statement", "status", "citations", "updated_at"])
      .where("product_id", "=", productId(ctx))
      .where("archived_at", "is", null)
      .where(sql<boolean>`citations @> ${JSON.stringify([{ record_id: input.record_id }])}::jsonb`)
      .orderBy("entry_id", "desc")
      .limit(100)
      .execute();
    const shape = (e: (typeof entries)[number]) => ({
      id: e.entry_id,
      kind: e.kind,
      statement: e.statement,
      status: e.status,
      updated_at: e.updated_at,
      citations: e.citations.filter((c) => c.record_id === input.record_id).map((c) => ({ seq_start: c.seq_start, seq_end: c.seq_end })),
    });
    return {
      insights,
      assumptions: entries.filter((e) => e.kind === "assumption").map(shape),
      decisions: entries.filter((e) => e.kind === "decision").map(shape),
      story_pages: (await storyPagesUsing(ctx, input.record_id, { includeArchived: false })).map(({ archived_at, ...p }) => (void archived_at, p)),
      mockups: (await mockupsUsing(ctx, input.record_id, { includeArchived: false })).map(({ archived_at, ...m }) => (void archived_at, m)),
      views: await ctx.db
        .selectFrom("lineage as l")
        .innerJoin("records as r", "r.record_id", "l.record_id")
        .select(["r.record_id", "r.kind", "r.title", "l.generated_at as registered_at"])
        .where("l.product_id", "=", productId(ctx))
        .where("r.archived_at", "is", null)
        .where(sql<boolean>`l.inputs @> ${JSON.stringify([{ kind: "record", id: input.record_id }])}::jsonb`)
        .orderBy("l.generated_at", "desc")
        .limit(100)
        .execute(),
    };
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
  summary: "Move a source, with its files, passages and notes, to another product in the same team.",
  description:
    "The record keeps its id, so its passages, file versions and notes move intact. Refused with 409 source_in_use while anything in this product cites or references it — insights, assumptions, decisions, lineage, the current version of a Story page or a mockup — because references never cross products; the error lists them. Copy instead to keep it in both.",
  input: z.strictObject({ record_id: id("source"), to_product: z.string().min(1).describe("Target product id or slug, in the same team."), expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/sources/:record_id/move" },
  mcp: { tool: "sources", action: "move_to_product" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id, { lock: true });
    checkEtag(input.expected_etag, r.etag, "source");
    const target = await targetProduct(ctx, input.to_product);
    const pid = productId(ctx);
    const insights = await ctx.db.selectFrom("insights").select(["insight_id", "title"]).where("product_id", "=", pid).where(sql<boolean>`refs->'sources' ? ${r.record_id}`).execute();
    const entries = await ctx.db.selectFrom("register_entries").select(["entry_id", "kind", "statement"]).where("product_id", "=", pid).where(sql<boolean>`citations @> ${JSON.stringify([{ record_id: r.record_id }])}::jsonb`).execute();
    const lineage = await ctx.db.selectFrom("lineage").select("record_id").where("product_id", "=", pid).where(sql<boolean>`inputs @> ${JSON.stringify([{ id: r.record_id }])}::jsonb`).execute();
    const related = await ctx.db.selectFrom("records").select("record_id").where("product_id", "=", pid).where(sql<boolean>`${r.record_id} = any(related_records)`).execute();
    const pages = await storyPagesUsing(ctx, r.record_id, { includeArchived: true });
    const mockups = await mockupsUsing(ctx, r.record_id, { includeArchived: true });
    if (insights.length || entries.length || lineage.length || related.length || pages.length || mockups.length)
      throw conflict("source_in_use", "This source is referenced in its product, and references never cross products. Remove the references, or copy the source instead.", {
        insights: insights.map((i) => ({ id: i.insight_id, title: i.title })),
        register_entries: entries.map((e) => ({ id: e.entry_id, kind: e.kind, statement: e.statement })),
        views: lineage.map((l) => l.record_id),
        related_sources: related.map((x) => x.record_id),
        story_pages: pages.map((p) => ({ page_id: p.page_id, title: p.title })),
        mockups: mockups.map((m) => ({ mockup_id: m.mockup_id, title: m.title })),
      });
    await ctx.db.updateTable("records").set({ product_id: target.product_id, related_records: [], etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("record_id", "=", r.record_id).execute();
    await ctx.db.updateTable("annotations").set({ product_id: target.product_id }).where("record_id", "=", r.record_id).execute();
    await ctx.db.updateTable("upload_grants").set({ product_id: target.product_id }).where("record_id", "=", r.record_id).execute();
    await ctx.db.updateTable("lineage").set({ product_id: target.product_id }).where("record_id", "=", r.record_id).execute();
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
    "The copy shares the original's stored files (blobs are immutable) and is derived afresh in the target. Notes and citations stay with the original. Returns the new record id.",
  input: z.strictObject({ record_id: id("source"), to_product: z.string().min(1) }),
  rest: { method: "POST", path: "/sources/:record_id/copy" },
  mcp: { tool: "sources", action: "copy_to_product" },
  async handler(ctx, input) {
    const r = await loadRecord(ctx, input.record_id);
    const target = await targetProduct(ctx, input.to_product);
    const targetCtx: OpContext = { ...ctx, scope: { ...ctx.scope, product: { product_id: target.product_id, slug: target.slug, name: target.name, archived_at: null } } };
    const copy = await insertRecord(
      targetCtx,
      { ...r, dimensions: r.dimensions as Record<string, unknown>, related_records: [] },
      { product_id: productId(ctx), record_id: r.record_id },
    );
    const files = await ctx.db.selectFrom("files").selectAll().where("record_id", "=", r.record_id).execute();
    for (const f of files) {
      if (!f.current_version_id) continue;
      const v = await ctx.db.selectFrom("file_versions").selectAll().where("file_version_id", "=", f.current_version_id).executeTakeFirstOrThrow();
      const file_id = newId();
      const file_version_id = newId();
      await ctx.db.insertInto("files").values({ file_id, tenant_id: tenantId(ctx), record_id: copy.record_id, path: f.path, role: f.role, current_version_id: file_version_id, derived_from: f.derived_from, derivation_note: f.derivation_note, derived_by: f.derived_by, added_by: json(ctx.actor) }).execute();
      await ctx.db.insertInto("file_versions").values({ file_version_id, tenant_id: tenantId(ctx), record_id: copy.record_id, file_id, blob_key: v.blob_key, size: v.size, sha256: v.sha256, media_type: v.media_type, created_by: json(ctx.actor) }).execute();
      if (f.role === "primary") await ctx.enqueue("derive", { record_id: copy.record_id, file_version_id });
    }
    await recordActivity(ctx, { action: "copied_out", entity_type: "source", entity_id: r.record_id, entity_title: r.title, summary: `Copied to product ${target.name}` });
    return { record_id: copy.record_id, product_id: target.product_id, copied_from: { product_id: productId(ctx), record_id: r.record_id } };
  },
});

// ---- Delete: permanent, guarded, and said plainly ----------------------------------------------

/** Every Story page version, current or earlier, whose citations include a source. */
async function storyVersionsCiting(ctx: OpContext, recordId: string) {
  const rows = await ctx.db
    .selectFrom("story_versions as v")
    .innerJoin("story_pages as p", (j) => j.onRef("p.product_id", "=", "v.product_id").onRef("p.page_id", "=", "v.page_id"))
    .select(["v.page_id", "p.title", "v.n", "v.version_id", "p.current_version_id", "v.citations"])
    .where("v.product_id", "=", productId(ctx))
    .where(sql<boolean>`v.citations @> ${JSON.stringify([{ record_id: recordId }])}::jsonb`)
    .orderBy("p.title")
    .orderBy("v.n", "desc")
    .execute();
  return rows.map((v) => ({
    page_id: v.page_id,
    title: v.title,
    version: v.n,
    count: v.citations.filter((c) => c.record_id === recordId).length,
    is_current: v.version_id === v.current_version_id,
  }));
}

/** Every mockup version, current or earlier, whose citations include a source. */
async function mockupVersionsCiting(ctx: OpContext, recordId: string) {
  const rows = await ctx.db
    .selectFrom("mockup_versions as v")
    .innerJoin("mockups as m", "m.mockup_id", "v.mockup_id")
    .select(["v.mockup_id", "m.title", "v.n", "v.version_id", "m.current_version_id", "v.citations"])
    .where("v.product_id", "=", productId(ctx))
    .where(sql<boolean>`v.citations @> ${JSON.stringify([{ record_id: recordId }])}::jsonb`)
    .orderBy("m.title")
    .orderBy("v.n", "desc")
    .execute();
  return rows.map((v) => ({
    mockup_id: v.mockup_id,
    title: v.title,
    version: v.n,
    count: v.citations.filter((c) => c.record_id === recordId).length,
    is_current: v.version_id === v.current_version_id,
  }));
}

async function impact(ctx: OpContext, r: RecordRow) {
  const pid = productId(ctx);
  const files = await ctx.db.selectFrom("file_versions").select(["file_version_id", "size", "blob_key"]).where("record_id", "=", r.record_id).execute();
  const derivations = await ctx.db.selectFrom("derivations").select(["derivation_id", "blob_prefix"]).where("record_id", "=", r.record_id).execute();
  const annotations = await ctx.db.selectFrom("annotations").select("annotation_id").where("record_id", "=", r.record_id).execute();
  const entries = await ctx.db.selectFrom("register_entries").select(["entry_id", "kind", "statement", "citations"]).where("product_id", "=", pid).where(sql<boolean>`citations @> ${JSON.stringify([{ record_id: r.record_id }])}::jsonb`).execute();
  const insights = await ctx.db.selectFrom("insights").select(["insight_id", "title"]).where("product_id", "=", pid).where(sql<boolean>`refs->'sources' ? ${r.record_id}`).execute();
  const versions = await storyVersionsCiting(ctx, r.record_id);
  const mockupVersions = await mockupVersionsCiting(ctx, r.record_id);
  return {
    record_id: r.record_id,
    title: r.title,
    etag: r.etag,
    file_versions: files.length,
    bytes: files.reduce((n, f) => n + Number(f.size), 0),
    derivations: derivations.length,
    annotations: annotations.length,
    citations: entries.map((e) => ({ id: e.entry_id, kind: e.kind, statement: e.statement, count: e.citations.filter((c) => c.record_id === r.record_id).length })),
    insights_referencing: insights.map((i) => ({ id: i.insight_id, title: i.title })),
    story_pages_citing: (await storyPagesUsing(ctx, r.record_id, { includeArchived: true }))
      .filter((p) => p.citations.length)
      .map((p) => ({ page_id: p.page_id, title: p.title, version: p.version, count: p.citations.length })),
    story_versions_citing: versions,
    mockup_versions_citing: mockupVersions,
    after_delete:
      "Citations keep their quoted text (quote_kept: true) and then report record_deleted, with the tombstone: " +
      `${entries.length} register ${entries.length === 1 ? "entry" : "entries"}, ${versions.length} Story page ${versions.length === 1 ? "version" : "versions"} and ${mockupVersions.length} mockup ${mockupVersions.length === 1 ? "version" : "versions"} (story_versions_citing and mockup_versions_citing list every version, current or earlier).`,
    _blobs: files.map((f) => f.blob_key),
    _prefixes: derivations.map((d) => d.blob_prefix),
  };
}

export const deleteImpact = defineOperation({
  name: "sources.delete_impact",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Preview exactly what deleting a source would destroy, including the citations it would orphan.",
  description:
    "Read-only. Show the person this result before proposing a delete. Citations elsewhere keep their quoted snapshot text after a delete and report record_deleted; story_versions_citing and mockup_versions_citing list every Story page and mockup version that cites the source, earlier versions included. Pass this result's etag as the delete's expected_etag.",
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
  access: "write",
  mutates: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Destroys a source's files, passages and notes; archive is the reversible alternative.",
  description:
    "This is permanent and cannot be undone. Archive (sources.archive) is the reversible alternative and almost always what is wanted. Requires editor, expected_etag, a reason, and confirm set to exactly \"delete permanently\". expected_etag is the etag from the delete_impact result you showed the person; if the source changed since, the delete is refused with 409 stale_etag, so preview again. Call delete_impact first, show the person what it will destroy, and delete only once they approve that impact: never slip a delete into a run of other actions, and even with a delete approved in advance, read delete_impact first and stop to ask when it would destroy more than they approved. Leaves a tombstone: reads return 410 with who, when and why, and citations keep their quoted text.",
  input: z.strictObject({
    record_id: id("source"),
    expected_etag: expectedEtag,
    reason: z.string().trim().min(1).max(500),
    confirm: z.string().describe(`Must be exactly "${DELETE_CONFIRMATION}".`),
  }),
  rest: { method: "DELETE", path: "/sources/:record_id" },
  mcp: { tool: "sources", action: "delete" },
  async handler(ctx, input) {
    if (input.confirm !== DELETE_CONFIRMATION)
      throw invalid("confirmation_required", `Deleting is permanent. Set confirm to exactly "${DELETE_CONFIRMATION}" — or archive instead.`);
    const r = await loadRecord(ctx, input.record_id, { lock: true });
    if (!sameEtag(input.expected_etag, r.etag)) checkEtag(input.expected_etag, r.etag, "source");
    const im = await impact(ctx, r);
    await ctx.db.insertInto("tombstones").values({ tenant_id: tenantId(ctx), product_id: productId(ctx), object_type: "source", object_id: r.record_id, title: r.title, reason: input.reason, deleted_by: json(ctx.actor) }).execute();
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
  listKinds, listSources, getSource, createSource, updateSource, archiveSources, restoreSources,
  annotate, listAnnotations, updateAnnotation, insightsFor, moveSource, copySource, deleteImpact, deleteSource,
];
