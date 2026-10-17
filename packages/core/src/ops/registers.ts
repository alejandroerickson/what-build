import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, normalizeTags, productId, recordActivity, tenantId } from "../common.ts";
import { json, type RegisterEntriesTable, type RegisterLink } from "../db.ts";
import { checkConfirmation, DELETE_GUIDANCE, deleteGuards, dropRevisions, leaveTombstone, refuseIfDeleted } from "../deletion.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext, type OperationDef } from "../registry.ts";
import { authorType, expectedEtag, id, provenanceDepth, tags } from "../schemas.ts";
import { applyEdits, editsInput, textDiff } from "../text-edits.ts";
import { newEtag, newId, uniq } from "../util.ts";
import { archivedOutcomeIds } from "./outcomes.ts";

type Row = Selectable<RegisterEntriesTable>;

const MAX_REVIEWS = 500;

const linkInput = z.strictObject({ id: id("assumption"), type: z.enum(["supports", "contradicts", "supersedes"]) });

const STATUS = z.enum(["unconfirmed", "confirmed", "refuted", "superseded"]);

/** The current entries: what a list shows without a status, and what every count counts. */
const CURRENT: z.infer<typeof STATUS>[] = ["unconfirmed", "confirmed"];

async function checkLinks(ctx: OpContext, selfId: string | null, links: RegisterLink[]) {
  const seen = new Set<string>();
  for (const l of links) {
    const key = `${l.id}:${l.type}`;
    if (seen.has(key)) throw invalid("invalid_link", `Duplicate link ${l.type} → ${l.id}.`);
    seen.add(key);
    if (l.id === selfId) throw invalid("invalid_link", "An assumption can’t link to itself.");
  }
  const ids = uniq(links.map((l) => l.id));
  if (!ids.length) return;
  const found = await ctx.db.selectFrom("register_entries").select(["entry_id", "product_id", "links"]).where("entry_id", "in", ids).where("kind", "=", "assumption").execute();
  for (const i of ids) {
    const f = found.find((x) => x.entry_id === i);
    if (!f) throw invalid("unknown_reference", `No assumption ${i}.`);
    if (f.product_id !== productId(ctx)) throw invalid("cross_product_reference", `Assumption ${i} is in another product.`);
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
    .orderBy("entry_id", "desc")
    .execute();
  const archivedOutcomes = await archivedOutcomeIds(ctx, row.outcome_ids);
  return {
    id: row.entry_id,
    kind: row.kind,
    statement: row.statement,
    body: row.body,
    status: row.status,
    frozen: row.review_count > 0,
    links: row.links.map((l) => ({ ...l, ...(() => { const e = linked.find((x) => x.entry_id === l.id); return e ? { kind: e.kind, statement: e.statement, status: e.status } : {}; })() })),
    linked_from: incoming.flatMap((e) => e.links.filter((l) => l.id === row.entry_id).map((l) => ({ id: e.entry_id, kind: e.kind, statement: e.statement, status: e.status, type: l.type }))),
    superseded_by: incoming.filter((e) => e.links.some((l) => l.id === row.entry_id && l.type === "supersedes")).map((e) => e.entry_id),
    outcome_ids: row.outcome_ids,
    archived_outcome_ids: row.outcome_ids.filter((o) => archivedOutcomes.has(o)),
    tags: row.tags,
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

/** For a page of entries: who links to each (linked_from), and which entries supersede it. */
async function incomingLinks(ctx: OpContext, ids: string[]) {
  const out = new Map<string, { linked_from: number; superseded_by: string[] }>(ids.map((i) => [i, { linked_from: 0, superseded_by: [] }]));
  if (!ids.length) return out;
  const rows = await sql<{ target: string; type: string; source: string }>`
    select l->>'id' as target, l->>'type' as type, e.entry_id as source
    from register_entries e, jsonb_array_elements(e.links) as l
    where e.product_id = ${productId(ctx)} and l->>'id' = any(${ids})
    order by e.entry_id desc`.execute(ctx.db);
  for (const r of rows.rows) {
    const o = out.get(r.target)!;
    o.linked_from++;
    if (r.type === "supersedes") o.superseded_by.push(r.source);
  }
  return out;
}

/** The assumption register: the one register a product keeps. */
function registerOps(): OperationDef[] {
  const kind = "assumption";
  const tool = `${kind}s`;
  const label = kind;
  const idField = z.string().min(1).describe(`The ${label} id. ${kind}_id is accepted as another name for it.`);
  const meaning = "An assumption is what the team is treating as true while evidence is incomplete.";

  async function load(ctx: OpContext, entryId: string, lock = false): Promise<Row> {
    let q = ctx.db.selectFrom("register_entries").selectAll().where("entry_id", "=", entryId).where("product_id", "=", productId(ctx));
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row) await refuseIfDeleted(ctx, kind, entryId, `Assumption ${entryId}`);
    if (!row || row.kind !== kind) throw notFound(`Assumption ${entryId} doesn’t exist in this product.`);
    return row;
  }

  /** What deleting an assumption destroys, and what points at it. */
  async function deletion(ctx: OpContext, row: Row) {
    const linkedFrom = await ctx.db
      .selectFrom("register_entries")
      .select(["entry_id", "statement", "links"])
      .where("product_id", "=", productId(ctx))
      .where("entry_id", "!=", row.entry_id)
      .where(sql<boolean>`links @> ${JSON.stringify([{ id: row.entry_id }])}::jsonb`)
      .execute();
    return {
      id: row.entry_id,
      statement: row.statement,
      etag: row.etag,
      status: row.status,
      archived: Boolean(row.archived_at),
      review_count: row.review_count,
      links: row.links.length,
      linked_from: linkedFrom.flatMap((e) => e.links.filter((l) => l.id === row.entry_id).map((l) => ({ id: e.entry_id, statement: e.statement, type: l.type }))),
      after_delete:
        `Its statement, body, ${row.review_count} review${row.review_count === 1 ? "" : "s"} and earlier text go. ` +
        `Links to it from other assumptions are removed.`,
      reversible_alternative: `${tool}(action="archive") takes it out of lists and search and erases nothing; to correct the claim itself, review or supersede it.`,
    };
  }

  const createFields = {
    statement: z.string().trim().min(1).max(1000).describe("The premise in one sentence. Frozen after the first review."),
    body: z.string().max(10_000).default("").describe("Markdown: reasoning, stakes, alternatives considered."),
    outcome_ids: z.array(id("outcome")).max(20).optional(),
    links: z.array(linkInput).max(50).optional(),
    tags: tags.optional(),
    provenance_depth: provenanceDepth.optional(),
    author_type: authorType.optional(),
  };

  /** Outcomes are referenced only inside their own product. */
  async function checkOutcomes(ctx: OpContext, ids: string[] | undefined) {
    if (!ids?.length) return;
    const found = await ctx.db.selectFrom("outcomes").select("outcome_id").where("product_id", "=", productId(ctx)).where("outcome_id", "in", ids).execute();
    const missing = ids.filter((o) => !found.some((f) => f.outcome_id === o));
    if (missing.length) throw invalid("unknown_reference", `No such outcomes in this product: ${missing.join(", ")}.`);
  }

  async function insertEntry(ctx: OpContext, input: z.output<z.ZodObject<typeof createFields>>) {
    const entry_id = newId();
    const links = input.links ?? [];
    await checkLinks(ctx, entry_id, links);
    await checkOutcomes(ctx, input.outcome_ids);
    await ctx.db
      .insertInto("register_entries")
      .values({
        entry_id, tenant_id: tenantId(ctx), product_id: productId(ctx), kind, statement: input.statement, body: input.body,
        links: json(links), outcome_ids: uniq(input.outcome_ids ?? []), tags: normalizeTags(input.tags), provenance_depth: input.provenance_depth ?? "unknown",
        author: json(ctx.actor), author_type: input.author_type ?? defaultReviewerType(ctx), status: "unconfirmed",
        etag: newEtag(), updated_by: json(ctx.actor),
      })
      .execute();
    await recordActivity(ctx, { action: "created", entity_type: kind, entity_id: entry_id, entity_title: input.statement, summary: `Recorded an unconfirmed ${kind}` });
    return entry_id;
  }

  const list = defineOperation({
    name: `${tool}.list`,
    scope: "product",
    access: "read",
    mutates: false,
    summary: `List ${kind}s, newest first, without quotes or review notes.`,
    description: `${meaning} Without status it lists the current entries (unconfirmed and confirmed), the ones products(action="list") and outcomes count; not_current_hidden says how many refuted or superseded entries matching the other filters it left out. Pass status (one or more of unconfirmed, confirmed, refuted, superseded) to list those too. Filter also by an outcome, a tag or human confidence. Archived entries are left out unless include_archived. Each item says whether it is frozen (reviewed, so its statement and body can no longer be edited), which entries supersede it (superseded_by, newest first), and how many links it has out (link_count) and in (linked_from_count); get returns the links themselves.`,
    input: z.strictObject({
      status: z.array(STATUS).max(4).optional().describe("Only these statuses. Omit for the current ones: unconfirmed and confirmed."),
      outcome_id: id("outcome").optional(),
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
      if (input.outcome_id) q = q.where(sql<boolean>`${input.outcome_id} = any(outcome_ids)`);
      if (input.tag) q = q.where(sql<boolean>`${normalizeTags([input.tag])[0]!} = any(tags)`);
      if (input.provenance_depth) q = q.where("provenance_depth", "=", input.provenance_depth);
      if (input.query) q = q.where(sql<boolean>`(statement ilike ${"%" + input.query + "%"} or body ilike ${"%" + input.query + "%"})`);
      if (input.human_confidence) {
        const latest = sql`(select r.confidence from reviews r where r.entry_id = register_entries.entry_id and r.reviewer_type = 'human' and r.confidence is not null order by r.review_id desc limit 1)`;
        q = input.human_confidence === "unreviewed" ? q.where(sql<boolean>`${latest} is null`) : q.where(sql<boolean>`${latest} = ${input.human_confidence}`);
      }
      // What the default leaves out is counted under the same filters.
      const filtered = q;
      q = q.where("status", "in", input.status?.length ? input.status : CURRENT);
      if (input.cursor) q = q.where("entry_id", "<", input.cursor);
      const rows = await q.orderBy("entry_id", "desc").limit(input.limit + 1).execute();
      const page = rows.slice(0, input.limit);
      const incoming = await incomingLinks(ctx, page.map((r) => r.entry_id));
      const archivedOutcomes = await archivedOutcomeIds(ctx, page.flatMap((r) => r.outcome_ids));
      const items = [];
      for (const r of page)
        items.push({
          id: r.entry_id, kind: r.kind, statement: r.statement, status: r.status, author: r.author, author_type: r.author_type,
          created_at: r.created_at, updated_at: r.updated_at, provenance_depth: r.provenance_depth, tags: r.tags,
          outcome_ids: r.outcome_ids, archived_outcome_ids: r.outcome_ids.filter((o) => archivedOutcomes.has(o)),
          frozen: r.review_count > 0, superseded_by: incoming.get(r.entry_id)!.superseded_by,
          link_count: r.links.length, linked_from_count: incoming.get(r.entry_id)!.linked_from,
          review_count: r.review_count, human_review: await humanReview(ctx, r.entry_id), archived_at: r.archived_at, etag: r.etag,
        });
      let not_current_hidden = 0;
      if (!input.status?.length) {
        const n = await filtered.clearSelect().select((eb) => eb.fn.countAll<number>().as("n")).where("status", "not in", CURRENT).executeTakeFirst();
        not_current_hidden = Number(n?.n ?? 0);
      }
      return {
        items,
        next_cursor: rows.length > input.limit ? page[page.length - 1]!.entry_id : null,
        not_current_hidden,
        ...(not_current_hidden
          ? { note: `${not_current_hidden} refuted or superseded ${kind}${not_current_hidden === 1 ? " is" : "s are"} not listed; pass status ["refuted", "superseded"] to see ${not_current_hidden === 1 ? "it" : "them"}.` }
          : {}),
      };
    },
  });

  const get = defineOperation({
    name: `${tool}.get`,
    scope: "product",
    access: "read",
    mutates: false,
    summary: `Read a ${kind}: statement, body, links, and the latest 20 reviews.`,
    description: "links are this entry's own typed links to other assumptions; linked_from lists the entries that link to it.",
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
    summary: `Record a ${kind}. Starts unconfirmed.`,
    description: `${meaning} Create one only when the team needs to track this specific premise, and keep the register small. Say in the body why the team holds it. Label author_type honestly: ordinary conversational agreement is not a person's authorship.`,
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
    summary: `Edit a ${kind}. Statement and body only until its first review; tags, outcomes and links always.`,
    description:
      "After the first review the statement and body are frozen, because a confirmation must refer to the exact words reviewed; correct a reviewed entry with supersede. For a small correction before then, pass edits (exact replacements in the statement or body that must each match once) instead of re-sending the whole text. Earlier text is kept as a revision. The result lists changed fields and a short diff of each changed text; check it.",
    input: z.strictObject({
      id: idField,
      expected_etag: expectedEtag,
      statement: createFields.statement.optional(),
      body: z.string().max(10_000).optional(),
      edits: editsInput(["body", "statement"] as const, "body").optional(),
      outcome_ids: createFields.outcome_ids,
      links: createFields.links,
      tags: createFields.tags,
      provenance_depth: createFields.provenance_depth,
    }),
    rest: { method: "PATCH", path: `/${tool}/:id` },
    mcp: { tool, action: "update" },
    async handler(ctx, input) {
      const row = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, row.etag, kind);
      const textChange = input.statement !== undefined || input.body !== undefined || input.edits !== undefined;
      if (textChange && row.review_count > 0)
        throw conflict("frozen", `This ${kind} has been reviewed, so its statement and body are frozen. Supersede it with a corrected entry instead.`);
      const next = { statement: input.statement ?? row.statement, body: input.body ?? row.body };
      if (input.edits) {
        Object.assign(next, applyEdits(next, input.edits, input));
        next.statement = next.statement.trim();
        if (!next.statement || next.statement.length > 1000) throw invalid("invalid_input", "After the edits the statement would be empty or longer than 1,000 characters. Nothing was changed.");
        if (next.body.length > 10_000) throw invalid("invalid_input", "After the edits the body would be longer than 10,000 characters. Nothing was changed.");
      }
      const links = input.links ?? row.links;
      if (input.links) await checkLinks(ctx, row.entry_id, links);
      await checkOutcomes(ctx, input.outcome_ids);
      if (textChange) await keepRevision(ctx, kind, row.entry_id, { statement: row.statement, body: row.body }, row.updated_at, row.updated_by);
      await ctx.db
        .updateTable("register_entries")
        .set({
          statement: next.statement,
          body: next.body,
          links: json(links),
          outcome_ids: input.outcome_ids ? uniq(input.outcome_ids) : row.outcome_ids,
          tags: input.tags ? normalizeTags(input.tags) : row.tags,
          provenance_depth: input.provenance_depth ?? row.provenance_depth,
          etag: newEtag(),
          updated_at: ctx.now,
          updated_by: json(ctx.actor),
        })
        .where("entry_id", "=", row.entry_id)
        .execute();
      const after = await load(ctx, row.entry_id);
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const changed = [
        ...(["statement", "body"] as const).filter((k) => next[k] !== row[k]),
        ...(["links", "outcome_ids", "tags", "provenance_depth"] as const).filter((k) => !same(after[k], row[k])),
      ];
      const diff = (["statement", "body"] as const).filter((k) => next[k] !== row[k]).map((k) => textDiff(k, row[k], next[k])!);
      await recordActivity(ctx, { action: "updated", entity_type: kind, entity_id: row.entry_id, entity_title: next.statement, summary: changed.length ? `Changed ${changed.join(", ")}` : "Edited the entry" });
      return { ...(await detail(ctx, after)), changed, diff };
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
    summary: `Record an attributed review of a ${kind}: a status and a required note, optionally a human's confidence. Any review freezes the statement and body.`,
    description:
      "Status is unconfirmed, confirmed, refuted or superseded; any review may move it anywhere. reviewer_type defaults to human in the web app and agent elsewhere; an agent may declare human only when relaying a judgment the person made in the conversation. confidence (low, medium, high) measures a human's view of suitability for current work, not truth, and is accepted only with reviewer_type human. Review with the current status to record confidence alone. Any review, by a person or an agent and whatever the status (even one that keeps it unconfirmed), freezes the entry's statement and body for good: make every edit first, and after that correct it only with supersede. Reviews are never edited; a changed mind is a new review.",
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
      if (input.confidence && reviewerType !== "human") throw invalid("confidence_requires_human", "confidence is recorded only for a human reviewer’s own judgment.");
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
    summary: `Add a typed link from this ${kind} to another: supports, contradicts or supersedes.`,
    description: "Links are checked before anything changes: the target must exist in this product, self-links and duplicates are refused, and supersedes stays acyclic.",
    input: z.strictObject({ id: idField, expected_etag: expectedEtag, target_id: id("assumption"), type: z.enum(["supports", "contradicts", "supersedes"]) }),
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
    input: z.strictObject({ id: idField, expected_etag: expectedEtag, target_id: id("assumption"), type: z.enum(["supports", "contradicts", "supersedes"]) }),
    rest: { method: "POST", path: `/${tool}/:id/unlink` },
    mcp: { tool, action: "unlink" },
    async handler(ctx, input) {
      const row = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, row.etag, kind);
      const links = row.links.filter((l) => !(l.id === input.target_id && l.type === input.type));
      if (links.length === row.links.length) throw notFound("No such link on this assumption.");
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

  const deleteImpact = defineOperation({
    name: `${tool}.delete_impact`,
    scope: "product",
    access: "read",
    mutates: false,
    summary: `Preview exactly what deleting a ${kind} would destroy, and what points at it.`,
    description: `Read-only. Show the person this result before proposing a delete. linked_from lists the other assumptions whose links to it would be removed. Pass this result's etag as the delete's expected_etag.`,
    input: z.strictObject({ id: idField }),
    rest: { method: "GET", path: `/${tool}/:id/delete-impact` },
    mcp: { tool, action: "delete_impact" },
    async handler(ctx, input) {
      return deletion(ctx, await load(ctx, input.id));
    },
  });

  const deleteEntry = defineOperation({
    name: `${tool}.delete`,
    scope: "product",
    access: "admin",
    mutates: true,
    summary: `DELETE PERMANENTLY — cannot be undone. Destroys a ${kind} with its reviews and history; archive is the reversible alternative.`,
    description:
      `Archive (${tool}(action="archive")) is the reversible alternative, and review or supersede corrects the claim itself; one of those is almost always what is wanted. ` +
      DELETE_GUIDANCE +
      " Leaves a tombstone: reads return 410 with who, when and why.",
    input: z.strictObject({ id: idField, ...deleteGuards }),
    rest: { method: "DELETE", path: `/${tool}/:id` },
    mcp: { tool, action: "delete" },
    async handler(ctx, input) {
      checkConfirmation(input.confirm, "archive");
      const row = await load(ctx, input.id, true);
      checkEtag(input.expected_etag, row.etag, kind);
      const impact = await deletion(ctx, row);
      // Links to it go from the entries that hold them; their etags change, so no stale write puts one back.
      for (const e of new Set(impact.linked_from.map((l) => l.id))) {
        const other = await load(ctx, e, true);
        await ctx.db
          .updateTable("register_entries")
          .set({ links: json(other.links.filter((l) => l.id !== row.entry_id)), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
          .where("entry_id", "=", other.entry_id)
          .execute();
      }
      await leaveTombstone(ctx, { object_type: kind, object_id: row.entry_id, title: row.statement, reason: input.reason });
      await dropRevisions(ctx, kind, [row.entry_id]);
      await ctx.db.deleteFrom("register_entries").where("entry_id", "=", row.entry_id).execute();
      await recordActivity(ctx, { action: "deleted", entity_type: kind, entity_id: row.entry_id, entity_title: row.statement, summary: "Deleted the assumption permanently" });
      const { etag, reversible_alternative, ...rest } = impact;
      void etag;
      void reversible_alternative;
      return { deleted: true, ...rest, reason: input.reason };
    },
  });

  return [list, get, create, update, review, supersede, link, unlink, archive, deleteImpact, deleteEntry] as OperationDef[];
}

export const registerOpsList = registerOps();
