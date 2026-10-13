import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, productId, recordActivity, tenantId } from "../common.ts";
import { json, type OutcomesTable } from "../db.ts";
import { checkConfirmation, DELETE_GUIDANCE, deleteGuards, dropRevisions, leaveTombstone, mockupVersionsReferring, refuseIfDeleted, storyVersionsReferring } from "../deletion.ts";
import { notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { newEtag, newId } from "../util.ts";

const STATUS = z.enum(["active", "achieved", "archived"]);

type Row = Selectable<OutcomesTable>;

const outcomeId = id("outcome").describe("The outcome id. id is accepted as another name for it.");

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
  const rows = await ctx.db.selectFrom("outcomes").select("outcome_id").where("product_id", "=", productId(ctx)).where("status", "=", "archived").where("outcome_id", "in", [...new Set(ids)]).execute();
  return new Set(rows.map((r) => r.outcome_id));
}

async function withCounts(ctx: OpContext, rows: Row[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.outcome_id);
  const assumptionCounts = await sql<{ id: string; n: number }>`
    select o.id, count(*)::int as n
    from register_entries r, unnest(r.outcome_ids) as o(id)
    where r.product_id = ${productId(ctx)} and r.kind = 'assumption' and r.archived_at is null and r.status in ('unconfirmed', 'confirmed') and o.id = any(${ids})
    group by o.id`.execute(ctx.db);
  return rows.map((r) => ({ ...r, counts: { assumptions: assumptionCounts.rows.find((c) => c.id === r.outcome_id)?.n ?? 0 } }));
}

export const listOutcomes = defineOperation({
  name: "outcomes.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List the product's outcomes in order, with how many assumptions point at each.",
  description:
    "Outcomes are what the product's users should be able to achieve with it, under the product concept. Read them before writing anything that serves them, and link to them through outcome_ids on an assumption and refs.outcomes on a mockup or Story page. Archived outcomes are left out unless status is \"archived\"; archived_hidden says how many were left out. An archived outcome can still be linked, and assumptions flag such links in archived_outcome_ids. Counts cover current (unconfirmed or confirmed) assumptions; superseded and refuted ones are not counted.",
  input: z.strictObject({
    status: STATUS.optional().describe("Only this status. Omit for active and achieved."),
    query: z.string().max(500).optional().describe("Case-insensitive substring of title or description."),
    limit: z.number().int().min(1).max(100).default(100),
    cursor: z.string().optional(),
  }),
  rest: { method: "GET", path: "/outcomes" },
  mcp: { tool: "outcomes", action: "list" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("outcomes").selectAll().where("product_id", "=", productId(ctx));
    q = input.status ? q.where("status", "=", input.status) : q.where("status", "!=", "archived");
    if (input.query) q = q.where(sql<boolean>`(title ilike ${"%" + input.query + "%"} or description ilike ${"%" + input.query + "%"})`);
    if (input.cursor) q = q.where("position", ">", Number(input.cursor));
    const rows = (await q.orderBy("position").orderBy("outcome_id").limit(input.limit + 1).execute()) as Row[];
    const items = await withCounts(ctx, rows.slice(0, input.limit));
    let archived_hidden = 0;
    if (!input.status) {
      let a = ctx.db.selectFrom("outcomes").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", productId(ctx)).where("status", "=", "archived");
      if (input.query) a = a.where(sql<boolean>`(title ilike ${"%" + input.query + "%"} or description ilike ${"%" + input.query + "%"})`);
      archived_hidden = Number((await a.executeTakeFirst())?.n ?? 0);
    }
    return {
      items,
      next_cursor: rows.length > input.limit ? String(items[items.length - 1]!.position) : null,
      archived_hidden,
      ...(archived_hidden ? { note: `${archived_hidden} archived outcome${archived_hidden === 1 ? " is" : "s are"} not listed; pass status "archived" to see ${archived_hidden === 1 ? "it" : "them"}.` } : {}),
    };
  },
});

export const getOutcome = defineOperation({
  name: "outcomes.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read one outcome with its etag.",
  description: "The etag guards update.",
  input: z.strictObject({ outcome_id: outcomeId }),
  rest: { method: "GET", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "get" },
  async handler(ctx, input) {
    const [row] = await withCounts(ctx, [await load(ctx, input.outcome_id)]);
    return row;
  },
});

export const createOutcome = defineOperation({
  name: "outcomes.create",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Add an outcome: something the product's users should be able to achieve with it, not a feature or a task.",
  description:
    "Name what the user achieves, from their side (\"The crew lead plans next week in minutes\"), and in the description what success looks like for them. Not a feature list or a task list. Keep the active set small. A new outcome goes to the end of the order unless position places it.",
  input: z.strictObject({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default("").describe("Markdown, up to 2,000 characters."),
    status: STATUS.default("active"),
    position: z.number().optional().describe("Ordering key, as on update: to place the outcome between two others, use a value between their positions. Omit to put it last."),
  }),
  rest: { method: "POST", path: "/outcomes" },
  mcp: { tool: "outcomes", action: "create" },
  async handler(ctx, input) {
    const last = await ctx.db.selectFrom("outcomes").select((eb) => eb.fn.max("position").as("p")).where("product_id", "=", productId(ctx)).executeTakeFirst();
    const outcome_id = newId();
    await ctx.db
      .insertInto("outcomes")
      .values({
        outcome_id, tenant_id: tenantId(ctx), product_id: productId(ctx), title: input.title, description: input.description,
        status: input.status, position: input.position ?? Number(last?.p ?? 0) + 1, etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    await recordActivity(ctx, { action: "created", entity_type: "outcome", entity_id: outcome_id, entity_title: input.title, summary: `Added an ${input.status} outcome` });
    const [row] = await withCounts(ctx, [await load(ctx, outcome_id)]);
    return row;
  },
});

export const updateOutcome = defineOperation({
  name: "outcomes.update",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Change an outcome's title, description, status or position. Pass only what changes.",
  description:
    "Requires expected_etag from your latest read. Fields you omit keep their values. Setting status to archived retires it; achieved keeps it visible. The previous title and description are kept as a revision.",
  input: z.strictObject({
    outcome_id: outcomeId,
    expected_etag: expectedEtag,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: STATUS.optional(),
    position: z.number().optional().describe("Ordering key; to move between two outcomes, use a value between their positions."),
  }),
  rest: { method: "PATCH", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "update" },
  async handler(ctx, input) {
    const row = await load(ctx, input.outcome_id, true);
    checkEtag(input.expected_etag, row.etag, "outcome");
    const textChanged =
      (input.title !== undefined && input.title !== row.title) || (input.description !== undefined && input.description !== row.description);
    if (textChanged) await keepRevision(ctx, "outcome", row.outcome_id, { title: row.title, description: row.description }, row.updated_at, row.updated_by);
    const changed = (["title", "description", "status", "position"] as const).filter((k) => input[k] !== undefined && input[k] !== row[k]);
    if (changed.length) {
      await ctx.db
        .updateTable("outcomes")
        .set({
          title: input.title ?? row.title,
          description: input.description ?? row.description,
          status: input.status ?? row.status,
          position: input.position ?? row.position,
          etag: newEtag(),
          updated_at: ctx.now,
          updated_by: json(ctx.actor),
        })
        .where("outcome_id", "=", row.outcome_id)
        .execute();
      const statusChange = input.status && input.status !== row.status;
      await recordActivity(ctx, {
        action: statusChange ? (input.status === "archived" ? "archived" : row.status === "archived" ? "restored" : input.status!) : changed.includes("position") && changed.length === 1 ? "reordered" : "updated",
        entity_type: "outcome",
        entity_id: row.outcome_id,
        entity_title: input.title ?? row.title,
        summary: statusChange ? `Changed status from ${row.status} to ${input.status}` : `Changed ${changed.join(", ")}`,
      });
    }
    const [next] = await withCounts(ctx, [await load(ctx, row.outcome_id)]);
    return next;
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
    status: row.status,
    assumptions: assumptions.map((a) => ({ id: a.entry_id, statement: a.statement })),
    story_versions_referring: await storyVersionsReferring(ctx, "outcomes", row.outcome_id),
    mockup_versions_referring: await mockupVersionsReferring(ctx, "outcomes", row.outcome_id),
    after_delete:
      "Its title, description and earlier text go. It is removed from the outcome_ids of the assumptions that serve it. Story page and mockup versions that list it in refs keep their text, and that ref stops resolving.",
    reversible_alternative: 'outcomes(action="update", status: "archived") takes it out of the list and keeps it linkable.',
  };
}

export const outcomeDeleteImpact = defineOperation({
  name: "outcomes.delete_impact",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Preview exactly what deleting an outcome would destroy, and what points at it.",
  description:
    "Read-only. Show the person this result before proposing a delete. assumptions lists the assumptions it would be removed from; story_versions_referring and mockup_versions_referring list every version, current or earlier, that names it in its refs. Pass this result's etag as the delete's expected_etag.",
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
    'Setting its status to archived (outcomes(action="update")) is the reversible alternative and almost always what is wanted. ' +
    DELETE_GUIDANCE +
    " Leaves a tombstone: reads return 410 with who, when and why.",
  input: z.strictObject({ outcome_id: outcomeId, ...deleteGuards }),
  rest: { method: "DELETE", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "delete" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, 'archive it with outcomes(action="update", status: "archived")');
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

export const outcomeOps = [listOutcomes, getOutcome, createOutcome, updateOutcome, outcomeDeleteImpact, deleteOutcome];
