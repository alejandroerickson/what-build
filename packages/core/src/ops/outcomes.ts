import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, productId, recordActivity, tenantId } from "../common.ts";
import { json, type OutcomesTable } from "../db.ts";
import { checkConfirmation, DELETE_GUIDANCE, deleteGuards, dropRevisions, leaveTombstone, refuseIfDeleted } from "../deletion.ts";
import { invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { likeContaining, newEtag, newId } from "../util.ts";

type Row = Selectable<OutcomesTable>;

const outcomeId = id("outcome").describe("The outcome id. id is accepted as another name for it.");

/**
 * What an outcome is, said once for every operation that writes one. Outcomes are the product's
 * compass: the evidence, the assumptions, the mockups and the Story are all read against them, so
 * an outcome says where the product is going and never retells how the team found out.
 */
const WHAT_AN_OUTCOME_IS =
  "An outcome is what the product's users should be able to achieve with it: the compass the evidence, assumptions, mockups and Story are read against, so write it to last. " +
  "Title: what the user achieves, from their side (\"The crew lead plans next week in minutes\"). Description: what success looks like for them, in a few sentences. " +
  "Neither cites or retells evidence: no sources, quotes, calls, emails, dates, named customers or people who asked, journeys, assumptions or mockups. " +
  "Evidence belongs in sources, and what it suggests in assumptions, which point at the outcome through outcome_ids. An id or a link to a record is refused. Keep the set small.";

/** Any id names a record (a source, an assumption, a mockup, a Story page), and an outcome names none. */
const RECORD_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

function refuseReferences(text: { title?: string; description?: string }) {
  for (const field of ["title", "description"] as const) {
    const found = text[field] && RECORD_ID.exec(text[field]!);
    if (found)
      throw invalid(
        "outcome_cites_a_record",
        `An outcome cites nothing: its ${field} names the record ${found[0]}. Say what the users achieve and what success looks like for them, and put the evidence in an assumption that points at this outcome through outcome_ids.`,
        { field, id: found[0] },
      );
  }
}

async function load(ctx: OpContext, outcomeId: string, lock = false) {
  let q = ctx.db.selectFrom("outcomes").selectAll().where("outcome_id", "=", outcomeId).where("product_id", "=", productId(ctx));
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) {
    await refuseIfDeleted(ctx, "outcome", outcomeId, `Outcome ${outcomeId}`);
    throw notFound(`Outcome ${outcomeId} doesn’t exist in this product.`);
  }
  return row as Row;
}

/** Referenced outcomes that are archived: hidden from the outcomes list, but still linkable. */
export async function archivedOutcomeIds(ctx: OpContext, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await ctx.db.selectFrom("outcomes").select("outcome_id").where("product_id", "=", productId(ctx)).where("archived_at", "is not", null).where("outcome_id", "in", [...new Set(ids)]).execute();
  return new Set(rows.map((r) => r.outcome_id));
}

export const listOutcomes = defineOperation({
  name: "outcomes.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List the product's outcomes in order: the compass every other part of the product is read against.",
  description:
    "Outcomes are what the product's users should be able to achieve with it, under the product concept. Read them at the start of any work in a product, and check what you write against them. " +
    "Assumptions point at them through outcome_ids; an outcome points at nothing. To see the assumptions that serve one, list assumptions with its outcome_id. " +
    "Archived outcomes are left out unless include_archived; archived_hidden says how many were left out. An archived outcome can still be linked, and assumptions flag such links in archived_outcome_ids.",
  input: z.strictObject({
    include_archived: z.boolean().default(false),
    query: z.string().max(500).optional().describe("Case-insensitive substring of title or description."),
    limit: z.number().int().min(1).max(100).default(100),
    cursor: z.string().optional(),
  }),
  rest: { method: "GET", path: "/outcomes" },
  mcp: { tool: "outcomes", action: "list" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("outcomes").selectAll().where("product_id", "=", productId(ctx));
    if (!input.include_archived) q = q.where("archived_at", "is", null);
    if (input.query) q = q.where(sql<boolean>`(title ilike ${likeContaining(input.query)} or description ilike ${likeContaining(input.query)})`);
    if (input.cursor) q = q.where("position", ">", Number(input.cursor));
    const rows = (await q.orderBy("position").orderBy("outcome_id").limit(input.limit + 1).execute()) as Row[];
    const items = rows.slice(0, input.limit);
    let archived_hidden = 0;
    if (!input.include_archived) {
      let a = ctx.db.selectFrom("outcomes").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", productId(ctx)).where("archived_at", "is not", null);
      if (input.query) a = a.where(sql<boolean>`(title ilike ${likeContaining(input.query)} or description ilike ${likeContaining(input.query)})`);
      archived_hidden = Number((await a.executeTakeFirst())?.n ?? 0);
    }
    return {
      items,
      next_cursor: rows.length > input.limit ? String(items[items.length - 1]!.position) : null,
      archived_hidden,
      ...(archived_hidden ? { note: `${archived_hidden} archived outcome${archived_hidden === 1 ? " is" : "s are"} not listed; pass include_archived to see ${archived_hidden === 1 ? "it" : "them"}.` } : {}),
    };
  },
});

export const getOutcome = defineOperation({
  name: "outcomes.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read one outcome with its etag.",
  description: "The etag guards update, archive and restore.",
  input: z.strictObject({ outcome_id: outcomeId }),
  rest: { method: "GET", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "get" },
  async handler(ctx, input) {
    return load(ctx, input.outcome_id);
  },
});

export const createOutcome = defineOperation({
  name: "outcomes.create",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Add an outcome: something the product's users should be able to achieve with it, not a feature, a task or a finding.",
  description: `${WHAT_AN_OUTCOME_IS} Propose outcomes to the person and add them once they agree. A new outcome goes to the end of the order unless position places it.`,
  input: z.strictObject({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default("").describe("Markdown, up to 2,000 characters: what success looks like for the users."),
    position: z.number().optional().describe("Ordering key, as on update: to place the outcome between two others, use a value between their positions. Omit to put it last."),
  }),
  rest: { method: "POST", path: "/outcomes" },
  mcp: { tool: "outcomes", action: "create" },
  async handler(ctx, input) {
    refuseReferences(input);
    const last = await ctx.db.selectFrom("outcomes").select((eb) => eb.fn.max("position").as("p")).where("product_id", "=", productId(ctx)).executeTakeFirst();
    const outcome_id = newId();
    await ctx.db
      .insertInto("outcomes")
      .values({
        outcome_id, tenant_id: tenantId(ctx), product_id: productId(ctx), title: input.title, description: input.description,
        position: input.position ?? Number(last?.p ?? 0) + 1, etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    await recordActivity(ctx, { action: "created", entity_type: "outcome", entity_id: outcome_id, entity_title: input.title, summary: "Added an outcome" });
    return load(ctx, outcome_id);
  },
});

export const updateOutcome = defineOperation({
  name: "outcomes.update",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Change an outcome's title, description or position. Pass only what changes.",
  description:
    `Requires expected_etag from your latest read. Fields you omit keep their values. The previous title and description are kept as a revision. ${WHAT_AN_OUTCOME_IS} ` +
    "An outcome changes when the person changes what the product is for, not when evidence arrives: when evidence challenges one, tell the person and propose new wording rather than adding the evidence to it. To retire one, archive it.",
  input: z.strictObject({
    outcome_id: outcomeId,
    expected_etag: expectedEtag,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    position: z.number().optional().describe("Ordering key; to move between two outcomes, use a value between their positions."),
  }),
  rest: { method: "PATCH", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "update" },
  async handler(ctx, input) {
    refuseReferences(input);
    const row = await load(ctx, input.outcome_id, true);
    checkEtag(input.expected_etag, row.etag, "outcome");
    const textChanged =
      (input.title !== undefined && input.title !== row.title) || (input.description !== undefined && input.description !== row.description);
    if (textChanged) await keepRevision(ctx, "outcome", row.outcome_id, { title: row.title, description: row.description }, row.updated_at, row.updated_by);
    const changed = (["title", "description", "position"] as const).filter((k) => input[k] !== undefined && input[k] !== row[k]);
    if (changed.length) {
      await ctx.db
        .updateTable("outcomes")
        .set({
          title: input.title ?? row.title,
          description: input.description ?? row.description,
          position: input.position ?? row.position,
          etag: newEtag(),
          updated_at: ctx.now,
          updated_by: json(ctx.actor),
        })
        .where("outcome_id", "=", row.outcome_id)
        .execute();
      await recordActivity(ctx, {
        action: changed.includes("position") && changed.length === 1 ? "reordered" : "updated",
        entity_type: "outcome",
        entity_id: row.outcome_id,
        entity_title: input.title ?? row.title,
        summary: `Changed ${changed.join(", ")}`,
      });
    }
    return load(ctx, row.outcome_id);
  },
});

/** Archive or restore: one switch, two operations, as for sources and mockups. */
async function setArchived(ctx: OpContext, input: { outcome_id: string; expected_etag: string }, archived: boolean) {
  const row = await load(ctx, input.outcome_id, true);
  checkEtag(input.expected_etag, row.etag, "outcome");
  if (Boolean(row.archived_at) === archived) return row;
  await ctx.db
    .updateTable("outcomes")
    .set({ archived_at: archived ? ctx.now : null, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
    .where("outcome_id", "=", row.outcome_id)
    .execute();
  await recordActivity(ctx, {
    action: archived ? "archived" : "restored",
    entity_type: "outcome",
    entity_id: row.outcome_id,
    entity_title: row.title,
    summary: archived ? "Archived the outcome" : "Restored the outcome",
  });
  return load(ctx, row.outcome_id);
}

export const archiveOutcome = defineOperation({
  name: "outcomes.archive",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Archive an outcome the product no longer aims at: out of the list, still linkable, its text kept.",
  description: "Pass the outcome's etag. Assumptions that point at it flag it in archived_outcome_ids. Restore brings it back.",
  input: z.strictObject({ outcome_id: outcomeId, expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/outcomes/:outcome_id/archive" },
  mcp: { tool: "outcomes", action: "archive" },
  async handler(ctx, input) {
    return setArchived(ctx, input, true);
  },
});

export const restoreOutcome = defineOperation({
  name: "outcomes.restore",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Restore an archived outcome.",
  description: "Pass the outcome's etag. It returns to its place in the order.",
  input: z.strictObject({ outcome_id: outcomeId, expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/outcomes/:outcome_id/restore" },
  mcp: { tool: "outcomes", action: "restore" },
  async handler(ctx, input) {
    return setArchived(ctx, input, false);
  },
});

/** What deleting an outcome destroys, and what points at it. */
async function deletion(ctx: OpContext, row: Row) {
  const assumptions = await ctx.db
    .selectFrom("register_entries")
    .select(["entry_id", "statement"])
    .where("product_id", "=", productId(ctx))
    .where(sql<boolean>`${row.outcome_id} = any(outcome_ids)`)
    .orderBy("entry_id", "desc")
    .execute();
  return {
    outcome_id: row.outcome_id,
    title: row.title,
    etag: row.etag,
    archived: Boolean(row.archived_at),
    assumptions: assumptions.map((a) => ({ id: a.entry_id, statement: a.statement })),
    after_delete: "Its title, description and earlier text go. It is removed from the outcome_ids of the assumptions that serve it.",
    reversible_alternative: 'outcomes(action="archive") takes it out of the list and keeps it linkable.',
  };
}

export const outcomeDeleteImpact = defineOperation({
  name: "outcomes.delete_impact",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Preview exactly what deleting an outcome would destroy, and what points at it.",
  description:
    "Read-only. Show the person this result before proposing a delete. assumptions lists the assumptions it would be removed from. Pass this result's etag as the delete's expected_etag.",
  input: z.strictObject({ outcome_id: outcomeId }),
  rest: { method: "GET", path: "/outcomes/:outcome_id/delete-impact" },
  mcp: { tool: "outcomes", action: "delete_impact" },
  async handler(ctx, input) {
    return deletion(ctx, await load(ctx, input.outcome_id));
  },
});

export const deleteOutcome = defineOperation({
  name: "outcomes.delete",
  scope: "product",
  access: "admin",
  mutates: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Destroys an outcome and its history; archiving it is the reversible alternative.",
  description:
    'Archiving it (outcomes(action="archive")) is the reversible alternative and almost always what is wanted. ' +
    DELETE_GUIDANCE +
    " Leaves a tombstone: reads return 410 with who, when and why.",
  input: z.strictObject({ outcome_id: outcomeId, ...deleteGuards }),
  rest: { method: "DELETE", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "delete" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, 'archive it with outcomes(action="archive")');
    const row = await load(ctx, input.outcome_id, true);
    checkEtag(input.expected_etag, row.etag, "outcome");
    const impact = await deletion(ctx, row);
    // The assumptions that served it stop naming it; their etags change, so no stale write names it again.
    for (const a of impact.assumptions)
      await ctx.db
        .updateTable("register_entries")
        .set({ outcome_ids: sql`array_remove(outcome_ids, ${row.outcome_id})`, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
        .where("entry_id", "=", a.id)
        .execute();
    await leaveTombstone(ctx, { object_type: "outcome", object_id: row.outcome_id, title: row.title, reason: input.reason });
    await dropRevisions(ctx, "outcome", [row.outcome_id]);
    await ctx.db.deleteFrom("outcomes").where("outcome_id", "=", row.outcome_id).execute();
    await recordActivity(ctx, { action: "deleted", entity_type: "outcome", entity_id: row.outcome_id, entity_title: row.title, summary: "Deleted the outcome permanently" });
    const { etag, reversible_alternative, ...rest } = impact;
    void etag;
    void reversible_alternative;
    return { deleted: true, ...rest, reason: input.reason };
  },
});

export const outcomeOps = [listOutcomes, getOutcome, createOutcome, updateOutcome, archiveOutcome, restoreOutcome, outcomeDeleteImpact, deleteOutcome];
