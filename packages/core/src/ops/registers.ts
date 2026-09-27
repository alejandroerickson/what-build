import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, normalizeDimensions, normalizeTags, productId, recordActivity, tenantId } from "../common.ts";
import { checkCitationList, CITATION_MAX_COUNT, citationInput, citationViews, snapshotAll } from "../citations.ts";
import { json, type RegisterEntriesTable, type RegisterLink } from "../db.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext, type OperationDef } from "../registry.ts";
import { authorType, dimensions, expectedEtag, id, provenanceDepth, tags } from "../schemas.ts";
import { newEtag, newId, uniq } from "../util.ts";

export type RegisterKind = "assumption" | "decision";
type Row = Selectable<RegisterEntriesTable>;

const MAX_REVIEWS = 500;

const linkInput = z.strictObject({ id: id("assumption or decision"), type: z.enum(["supports", "contradicts", "supersedes"]) });

const STATUS = z.enum(["unconfirmed", "confirmed", "refuted", "superseded"]);

async function checkLinks(ctx: OpContext, selfId: string | null, links: RegisterLink[]) {
  const seen = new Set<string>();
  for (const l of links) {
    const key = `${l.id}:${l.type}`;
    if (seen.has(key)) throw invalid("invalid_link", `Duplicate link ${l.type} → ${l.id}.`);
    seen.add(key);
    if (l.id === selfId) throw invalid("invalid_link", "An entry cannot link to itself.");
  }
  const ids = uniq(links.map((l) => l.id));
  if (!ids.length) return;
  const found = await ctx.db.selectFrom("register_entries").select(["entry_id", "product_id", "links"]).where("entry_id", "in", ids).execute();
  for (const i of ids) {
    const f = found.find((x) => x.entry_id === i);
    if (!f) throw invalid("unknown_reference", `No assumption or decision ${i}.`);
    if (f.product_id !== productId(ctx)) throw invalid("cross_product_reference", `Entry ${i} is in another product.`);
  }
  // supersedes must stay acyclic.
  if (selfId) {
    const graph = new Map<string, string[]>();
    const all = await ctx.db.selectFrom("register_entries").select(["entry_id", "links"]).where("product_id", "=", productId(ctx)).execute();
    for (const e of all) graph.set(e.entry_id, e.links.filter((l) => l.type === "supersedes").map((l) => l.id));
    graph.set(selfId, links.filter((l) => l.type === "supersedes").map((l) => l.id));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cyclic = (n: string): boolean => {
      if (visiting.has(n)) return true;
      if (done.has(n)) return false;
      visiting.add(n);
      for (const m of graph.get(n) ?? []) if (cyclic(m)) return true;
      visiting.delete(n);
      done.add(n);
      return false;
    };
    if (cyclic(selfId)) throw invalid("invalid_link", "That supersedes link would make a cycle.");
  }
}

function defaultReviewerType(ctx: OpContext): "human" | "agent" {
  return ctx.actor.surface === "web" ? "human" : "agent";
}

async function humanReview(ctx: OpContext, entryId: string) {
  const r = await ctx.db
    .selectFrom("reviews")
    .select(["confidence", "reviewer", "created_at"])
    .where("entry_id", "=", entryId)
    .where("reviewer_type", "=", "human")
    .where("confidence", "is not", null)
    .orderBy("review_id", "desc")
    .executeTakeFirst();
  return r ? { confidence: r.confidence, reviewer: r.reviewer, reviewed_at: r.created_at } : { confidence: "unreviewed", reviewer: null, reviewed_at: null };
}

async function detail(ctx: OpContext, row: Row) {
  const reviews = await ctx.db.selectFrom("reviews").selectAll().where("entry_id", "=", row.entry_id).orderBy("review_id", "desc").limit(20).execute();
  const linked = row.links.length ? await ctx.db.selectFrom("register_entries").select(["entry_id", "kind", "statement", "status"]).where("entry_id", "in", row.links.map((l) => l.id)).execute() : [];
  const incoming = await ctx.db
    .selectFrom("register_entries")
    .select(["entry_id", "kind", "statement", "status", "links"])
    .where("product_id", "=", productId(ctx))
    .where(sql<boolean>`links @> ${JSON.stringify([{ id: row.entry_id }])}::jsonb`)
    .execute();
  return {
    id: row.entry_id,
    kind: row.kind,
    statement: row.statement,
    body: row.body,
    status: row.status,
    frozen: row.review_count > 0,
    citations: await citationViews(ctx, row.citations),
    links: row.links.map((l) => ({ ...l, ...(() => { const e = linked.find((x) => x.entry_id === l.id); return e ? { kind: e.kind, statement: e.statement, status: e.status } : {}; })() })),
    linked_from: incoming.flatMap((e) => e.links.filter((l) => l.id === row.entry_id).map((l) => ({ id: e.entry_id, kind: e.kind, statement: e.statement, status: e.status, type: l.type }))),
    objective_ids: row.objective_ids,
    tags: row.tags,
    dimensions: row.dimensions,
    provenance_depth: row.provenance_depth,
    author: row.author,
    author_type: row.author_type,
    reviews: reviews.map((r) => ({ status: r.status, note: r.note, reviewer: r.reviewer, reviewer_type: r.reviewer_type, confidence: r.confidence, created_at: r.created_at })),
    review_count: row.review_count,
    human_review: await humanReview(ctx, row.entry_id),
    archived_at: row.archived_at,
    etag: row.etag,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function registerOps(kind: RegisterKind): OperationDef[] {
  const tool = `${kind}s`;
  const label = kind;
  const other = kind === "assumption" ? "decision" : "assumption";
  const idField = z.string().min(1).describe(`The ${label} id.`);
  const meaning =
    kind === "assumption"
      ? "An assumption is what the team is treating as true while evidence is incomplete."
      : "A decision records a choice and its rationale. Creating one does not mean the team agreed to it.";

  async function load(ctx: OpContext, entryId: string, lock = false): Promise<Row> {
    let q = ctx.db.selectFrom("register_entries").selectAll().where("entry_id", "=", entryId).where("product_id", "=", productId(ctx));
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row || row.kind !== kind) throw notFound(`${label[0]!.toUpperCase() + label.slice(1)} ${entryId} does not exist in this product${row ? ` (it is a ${other})` : ""}.`);
    return row;
  }

  const createFields = {
    statement: z.string().trim().min(1).max(1000).describe("The premise or choice in one sentence. Frozen after the first review."),
    body: z.string().max(10_000).default("").describe("Markdown: reasoning, stakes, alternatives considered."),
    citations: z.array(citationInput).min(1).max(CITATION_MAX_COUNT).describe("1 to 20 exact passages: {record_id, seq_start, seq_end, quote?}. Read each passage first."),
    objective_ids: z.array(id("objective")).max(20).optional(),
    links: z.array(linkInput).max(50).optional(),
    tags: tags.optional(),
    dimensions: dimensions.optional(),
    provenance_depth: provenanceDepth.optional(),
    author_type: authorType.optional(),
  };

  async function insertEntry(ctx: OpContext, input: z.output<z.ZodObject<typeof createFields>>) {
    const entry_id = newId();
    const citations = await snapshotAll(ctx, input.citations);
    const links = input.links ?? [];
    await checkLinks(ctx, entry_id, links);
    if (input.objective_ids?.length) {
      const found = await ctx.db.selectFrom("objectives").select("objective_id").where("product_id", "=", productId(ctx)).where("objective_id", "in", input.objective_ids).execute();
      const missing = input.objective_ids.filter((o) => !found.some((f) => f.objective_id === o));
      if (missing.length) throw invalid("unknown_reference", `No such objectives in this product: ${missing.join(", ")}.`);
    }
    await ctx.db
      .insertInto("register_entries")
      .values({
        entry_id, tenant_id: tenantId(ctx), product_id: productId(ctx), kind, statement: input.statement, body: input.body,
        citations: json(citations), links: json(links), objective_ids: uniq(input.objective_ids ?? []), tags: normalizeTags(input.tags),
        dimensions: json(normalizeDimensions(input.dimensions)), provenance_depth: input.provenance_depth ?? "unknown",
        author: json(ctx.actor), author_type: input.author_type ?? defaultReviewerType(ctx), status: "unconfirmed",
        etag: newEtag(), updated_by: json(ctx.actor),
      })
      .execute();
    await recordActivity(ctx, { action: "created", entity_type: kind, entity_id: entry_id, entity_title: input.statement, summary: `Recorded an unconfirmed ${kind} citing ${citations.length} passage${citations.length === 1 ? "" : "s"}` });
    return entry_id;
  }

  const list = defineOperation({
    name: `${tool}.list`,
    scope: "product",
    access: "read",
    mutates: false,
    summary: `List ${kind}s, newest first, without quotes or review notes.`,
    description: `${meaning} Filter by review status, a cited source, an objective, a tag, human confidence or dimensions. Archived entries are left out unless include_archived.`,
    input: z.strictObject({
      status: z.array(STATUS).max(4).optional(),
      record_id: id("source").optional(),
      objective_id: id("objective").optional(),
      tag: z.string().max(50).optional(),
      human_confidence: z.enum(["unreviewed", "low", "medium", "high"]).optional(),
      provenance_depth: provenanceDepth.optional(),
      query: z.string().max(500).optional(),
      include_archived: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(25),
      cursor: z.string().optional(),
    }),
    rest: { method: "GET", path: `/${tool}` },
    mcp: { tool, action: "list" },
    async handler(ctx, input) {
      let q = ctx.db.selectFrom("register_entries").selectAll().where("product_id", "=", productId(ctx)).where("kind", "=", kind);
      if (!input.include_archived) q = q.where("archived_at", "is", null);
      if (input.status?.length) q = q.where("status", "in", input.status);
      if (input.record_id) q = q.where(sql<boolean>`citations @> ${JSON.stringify([{ record_id: input.record_id }])}::jsonb`);
      if (input.objective_id) q = q.where(sql<boolean>`${input.objective_id} = any(objective_ids)`);
      if (input.tag) q = q.where(sql<boolean>`${normalizeTags([input.tag])[0]!} = any(tags)`);
      if (input.provenance_depth) q = q.where("provenance_depth", "=", input.provenance_depth);
      if (input.query) q = q.where(sql<boolean>`(statement ilike ${"%" + input.query + "%"} or body ilike ${"%" + input.query + "%"})`);
      if (input.human_confidence) {
        const latest = sql`(select r.confidence from reviews r where r.entry_id = register_entries.entry_id and r.reviewer_type = 'human' and r.confidence is not null order by r.review_id desc limit 1)`;
        q = input.human_confidence === "unreviewed" ? q.where(sql<boolean>`${latest} is null`) : q.where(sql<boolean>`${latest} = ${input.human_confidence}`);
      }
      if (input.cursor) q = q.where("entry_id", "<", input.cursor);
      const rows = await q.orderBy("entry_id", "desc").limit(input.limit + 1).execute();
      const page = rows.slice(0, input.limit);
      const items = [];
      for (const r of page)
        items.push({
          id: r.entry_id, kind: r.kind, statement: r.statement, status: r.status, author: r.author, author_type: r.author_type,
          created_at: r.created_at, updated_at: r.updated_at, dimensions: r.dimensions, provenance_depth: r.provenance_depth, tags: r.tags,
          objective_ids: r.objective_ids, citation_count: r.citations.length, record_ids: uniq(r.citations.map((c) => c.record_id)),
          review_count: r.review_count, human_review: await humanReview(ctx, r.entry_id), archived_at: r.archived_at, etag: r.etag,
        });
      return { items, next_cursor: rows.length > input.limit ? page[page.length - 1]!.entry_id : null };
    },
  });

  const get = defineOperation({
    name: `${tool}.get`,
    scope: "product",
    access: "read",
    mutates: false,
    summary: `Read a ${kind}: statement, body, citations with their snapshot text, links, and the latest 20 reviews.`,
    description: "Citation quotes are snapshots taken when the entry was written; check_citations reports whether the source still says so.",
    input: z.strictObject({ id: idField }),
    rest: { method: "GET", path: `/${tool}/:id` },
    mcp: { tool, action: "get" },
    async handler(ctx, input) {
      return detail(ctx, await load(ctx, input.id));
    },
  });

  const create = defineOperation({
    name: `${tool}.create`,
    scope: "product",
    access: "write",
    mutates: true,
    summary: `Record a ${kind}, cited to exact passages. Starts unconfirmed.`,
    description: `${meaning} Create one only when the team needs to track this specific premise or choice; keep the register small and put everything else in an insight. Each citation is resolved against the source's current passages and frozen as a snapshot. Label author_type honestly: ordinary conversational agreement is not a person's authorship.`,
    input: z.strictObject(createFields),
    rest: { method: "POST", path: `/${tool}` },
    mcp: { tool, action: "create" },
    async handler(ctx, input) {
      const entryId = await insertEntry(ctx, input);
      return detail(ctx, await load(ctx, entryId));
    },
  });

  const update = defineOperation({
    name: `${tool}.update`,
    scope: "product",
    access: "write",
    mutates: true,
    summary: `Edit a ${kind}. Statement, body and citations only until its first review; tags, objectives, links and dimensions always.`,
    description: "After the first review the statement, body and citations are frozen, because a confirmation must refer to the exact words reviewed; correct a reviewed entry with supersede. Earlier text is kept as a revision.",
    input: z.strictObject({
      id: idField,
      expected_etag: expectedEtag,
      statement: createFields.statement.optional(),
      body: z.string().max(10_000).optional(),
      citations: createFields.citations.optional(),
      objective_ids: createFields.objective_ids,
      links: createFields.links,
      tags: createFields.tags,
      dimensions: createFields.dimensions,
      provenance_depth: createFields.provenance_depth,
    }),
    rest: { method: "PATCH", path: `/${tool}/:id` },
    mcp: { tool, action: "update" },
    async handler(ctx, input) {
      const row = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, row.etag, kind);
      const textChange = input.statement !== undefined || input.body !== undefined || input.citations !== undefined;
      if (textChange && row.review_count > 0)
        throw conflict("frozen", `This ${kind} has been reviewed, so its statement, body and citations are frozen. Supersede it with a corrected entry instead.`);
      const citations = input.citations ? await snapshotAll(ctx, input.citations) : row.citations;
      const links = input.links ?? row.links;
      if (input.links) await checkLinks(ctx, row.entry_id, links);
      if (textChange) await keepRevision(ctx, kind, row.entry_id, { statement: row.statement, body: row.body, citations: row.citations }, row.updated_at, row.updated_by);
      await ctx.db
        .updateTable("register_entries")
        .set({
          statement: input.statement ?? row.statement,
          body: input.body ?? row.body,
          citations: json(citations),
          links: json(links),
          objective_ids: input.objective_ids ? uniq(input.objective_ids) : row.objective_ids,
          tags: input.tags ? normalizeTags(input.tags) : row.tags,
          dimensions: json(normalizeDimensions(input.dimensions, row.dimensions)),
          provenance_depth: input.provenance_depth ?? row.provenance_depth,
          etag: newEtag(),
          updated_at: ctx.now,
          updated_by: json(ctx.actor),
        })
        .where("entry_id", "=", row.entry_id)
        .execute();
      await recordActivity(ctx, { action: "updated", entity_type: kind, entity_id: row.entry_id, entity_title: input.statement ?? row.statement, summary: "Edited the entry" });
      return detail(ctx, await load(ctx, row.entry_id));
    },
  });

  async function appendReview(ctx: OpContext, row: Row, r: { status: string; note: string; reviewer_type: "human" | "agent"; confidence: string | null }) {
    if (row.review_count >= MAX_REVIEWS) throw invalid("review_history_full", "Review history is full; create a superseding entry.");
    await ctx.db.insertInto("reviews").values({ review_id: newId(), tenant_id: tenantId(ctx), entry_id: row.entry_id, status: r.status, note: r.note, reviewer: json(ctx.actor), reviewer_type: r.reviewer_type, confidence: r.confidence }).execute();
    await ctx.db
      .updateTable("register_entries")
      .set({ status: r.status as Row["status"], review_count: row.review_count + 1, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
      .where("entry_id", "=", row.entry_id)
      .execute();
  }

  const review = defineOperation({
    name: `${tool}.review`,
    scope: "product",
    access: "write",
    mutates: true,
    summary: `Record an attributed review of a ${kind}: a status and a required note, optionally a human's confidence.`,
    description:
      "Status is unconfirmed, confirmed, refuted or superseded; any review may move it anywhere. reviewer_type defaults to human in the web app and agent elsewhere; an agent may declare human only when relaying a judgment the person made in the conversation. confidence (low, medium, high) measures a human's view of suitability for current work, not truth, and is accepted only with reviewer_type human. Review with the current status to record confidence alone. Reviews are never edited; a changed mind is a new review.",
    input: z.strictObject({
      id: idField,
      expected_etag: expectedEtag,
      status: STATUS,
      note: z.string().trim().min(1).max(2000),
      reviewer_type: authorType.optional(),
      confidence: z.enum(["low", "medium", "high"]).optional(),
    }),
    rest: { method: "POST", path: `/${tool}/:id/review` },
    mcp: { tool, action: "review" },
    async handler(ctx, input) {
      const row = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, row.etag, kind);
      const reviewerType = input.reviewer_type ?? defaultReviewerType(ctx);
      if (input.confidence && reviewerType !== "human") throw invalid("confidence_requires_human", "confidence is recorded only for a human reviewer's own judgment.");
      await appendReview(ctx, row, { status: input.status, note: input.note, reviewer_type: reviewerType, confidence: input.confidence ?? null });
      await recordActivity(ctx, { action: "reviewed", entity_type: kind, entity_id: row.entry_id, entity_title: row.statement, summary: `Marked ${input.status}${input.confidence ? ` with ${input.confidence} confidence` : ""}${reviewerType === "agent" ? " (agent review)" : ""}` });
      return detail(ctx, await load(ctx, row.entry_id));
    },
  });

  const supersede = defineOperation({
    name: `${tool}.supersede`,
    scope: "product",
    access: "write",
    mutates: true,
    summary: `Correct a ${kind} by creating a new entry that supersedes it; the old one is reviewed as superseded in the same step.`,
    description: "Takes the new entry's fields (as create) plus the old entry's id, its expected_etag and a note explaining the correction. Both happen atomically or not at all.",
    input: z.strictObject({ id: idField, expected_etag: expectedEtag, note: z.string().trim().min(1).max(2000), ...createFields }),
    rest: { method: "POST", path: `/${tool}/:id/supersede` },
    mcp: { tool, action: "supersede" },
    async handler(ctx, input) {
      const old = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, old.etag, kind);
      const { id: oldId, expected_etag, note, ...fields } = input;
      void expected_etag;
      const links = [...(fields.links ?? []).filter((l) => !(l.id === oldId && l.type === "supersedes")), { id: oldId, type: "supersedes" as const }];
      const newId_ = await insertEntry(ctx, { ...fields, links });
      await appendReview(ctx, old, { status: "superseded", note, reviewer_type: defaultReviewerType(ctx), confidence: null });
      await recordActivity(ctx, { action: "superseded", entity_type: kind, entity_id: old.entry_id, entity_title: old.statement, summary: "Superseded by a corrected entry" });
      return { superseded: old.entry_id, entry: await detail(ctx, await load(ctx, newId_)) };
    },
  });

  const link = defineOperation({
    name: `${tool}.link`,
    scope: "product",
    access: "write",
    mutates: true,
    summary: `Add a typed link from this ${kind} to an assumption or decision: supports, contradicts or supersedes.`,
    description: "Links are checked before anything changes: the target must exist in this product, self-links and duplicates are refused, and supersedes stays acyclic.",
    input: z.strictObject({ id: idField, expected_etag: expectedEtag, target_id: id("assumption or decision"), type: z.enum(["supports", "contradicts", "supersedes"]) }),
    rest: { method: "POST", path: `/${tool}/:id/links` },
    mcp: { tool, action: "link" },
    async handler(ctx, input) {
      const row = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, row.etag, kind);
      const links = [...row.links, { id: input.target_id, type: input.type }];
      await checkLinks(ctx, row.entry_id, links);
      await ctx.db.updateTable("register_entries").set({ links: json(links), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("entry_id", "=", row.entry_id).execute();
      await recordActivity(ctx, { action: "linked", entity_type: kind, entity_id: row.entry_id, entity_title: row.statement, summary: `Linked: ${input.type} another entry` });
      return detail(ctx, await load(ctx, row.entry_id));
    },
  });

  const unlink = defineOperation({
    name: `${tool}.unlink`,
    scope: "product",
    access: "write",
    mutates: true,
    summary: "Remove one typed link.",
    description: "Names the link by target_id and type.",
    input: z.strictObject({ id: idField, expected_etag: expectedEtag, target_id: id("assumption or decision"), type: z.enum(["supports", "contradicts", "supersedes"]) }),
    rest: { method: "POST", path: `/${tool}/:id/unlink` },
    mcp: { tool, action: "unlink" },
    async handler(ctx, input) {
      const row = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, row.etag, kind);
      const links = row.links.filter((l) => !(l.id === input.target_id && l.type === input.type));
      if (links.length === row.links.length) throw notFound("No such link on this entry.");
      await ctx.db.updateTable("register_entries").set({ links: json(links), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("entry_id", "=", row.entry_id).execute();
      await recordActivity(ctx, { action: "unlinked", entity_type: kind, entity_id: row.entry_id, entity_title: row.statement, summary: `Removed a ${input.type} link` });
      return detail(ctx, await load(ctx, row.entry_id));
    },
  });

  const archive = defineOperation({
    name: `${tool}.archive`,
    scope: "product",
    access: "write",
    mutates: true,
    summary: `Archive or restore a ${kind}. Archive takes it out of lists and search and erases nothing.`,
    description: "Set archived true to archive, false to restore. For a changed mind about the claim itself, review it or supersede it instead.",
    input: z.strictObject({ id: idField, expected_etag: expectedEtag, archived: z.boolean() }),
    rest: { method: "POST", path: `/${tool}/:id/archive` },
    mcp: { tool, action: "archive" },
    async handler(ctx, input) {
      const row = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, row.etag, kind);
      if (Boolean(row.archived_at) !== input.archived) {
        await ctx.db.updateTable("register_entries").set({ archived_at: input.archived ? ctx.now : null, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("entry_id", "=", row.entry_id).execute();
        await recordActivity(ctx, { action: input.archived ? "archived" : "restored", entity_type: kind, entity_id: row.entry_id, entity_title: row.statement, summary: input.archived ? "Archived the entry" : "Restored the entry" });
      }
      return detail(ctx, await load(ctx, row.entry_id));
    },
  });

  const checkCitations = defineOperation({
    name: `${tool}.check_citations`,
    scope: "product",
    access: "read",
    mutates: false,
    summary: `Re-resolve every citation of a ${kind} against the sources as they are now. Reports drift; never rewrites.`,
    description:
      "Per citation: ok, relocated (text intact at another range, which it gives), text_changed, record_archived, record_deleted or record_missing, plus version_drift when the source's primary file has a newer version than the snapshot's. A matching quote establishes textual integrity only, not truth. Check after a re-parse before relying on a conclusion.",
    input: z.strictObject({ id: idField }),
    rest: { method: "POST", path: `/${tool}/:id/check-citations` },
    mcp: { tool, action: "check_citations" },
    async handler(ctx, input) {
      const row = await load(ctx, input.id);
      return { id: row.entry_id, checked_at: ctx.now, ...(await checkCitationList(ctx, row.citations)) };
    },
  });

  return [list, get, create, update, review, supersede, link, unlink, archive, checkCitations] as OperationDef[];
}

export const registerOpsList = [...registerOps("assumption"), ...registerOps("decision")];
