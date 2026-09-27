import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, productId, recordActivity, tenantId } from "../common.ts";
import { json, type ObjectivesTable } from "../db.ts";
import { notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { newEtag, newId } from "../util.ts";

const STATUS = z.enum(["active", "achieved", "archived"]);

type Row = Selectable<ObjectivesTable>;

const objectiveId = id("objective").describe("The objective id. id is accepted as another name for it.");

async function load(ctx: OpContext, objectiveId: string, lock = false) {
  let q = ctx.db.selectFrom("objectives").selectAll().where("objective_id", "=", objectiveId).where("product_id", "=", productId(ctx));
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw notFound(`Objective ${objectiveId} does not exist in this product.`);
  return row as Row;
}

/** Referenced objectives that are archived: hidden from the objectives list, but still linkable. */
export async function archivedObjectiveIds(ctx: OpContext, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await ctx.db.selectFrom("objectives").select("objective_id").where("product_id", "=", productId(ctx)).where("status", "=", "archived").where("objective_id", "in", [...new Set(ids)]).execute();
  return new Set(rows.map((r) => r.objective_id));
}

async function withCounts(ctx: OpContext, rows: Row[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.objective_id);
  const insightCounts = await sql<{ id: string; n: number }>`
    select o.id, count(*)::int as n
    from insights i, jsonb_array_elements_text(i.refs->'objectives') as o(id)
    where i.product_id = ${productId(ctx)} and i.status != 'archived' and o.id = any(${ids})
    group by o.id`.execute(ctx.db);
  const registerCounts = await sql<{ id: string; kind: string; n: number }>`
    select o.id, r.kind, count(*)::int as n
    from register_entries r, unnest(r.objective_ids) as o(id)
    where r.product_id = ${productId(ctx)} and r.archived_at is null and r.status in ('unconfirmed', 'confirmed') and o.id = any(${ids})
    group by o.id, r.kind`.execute(ctx.db);
  return rows.map((r) => ({
    ...r,
    counts: {
      insights: insightCounts.rows.find((c) => c.id === r.objective_id)?.n ?? 0,
      assumptions: registerCounts.rows.find((c) => c.id === r.objective_id && c.kind === "assumption")?.n ?? 0,
      decisions: registerCounts.rows.find((c) => c.id === r.objective_id && c.kind === "decision")?.n ?? 0,
    },
  }));
}

export const listObjectives = defineOperation({
  name: "objectives.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List the product's objectives in order, with how many insights, assumptions and decisions point at each.",
  description:
    "Objectives are the short outcomes discovery serves. Read them before writing insights, and link insights to them through refs.objectives. Archived objectives are left out unless status is \"archived\"; archived_hidden says how many were left out. An archived objective can still be linked, and insights and registers flag such links in archived_objective_ids. Counts cover unarchived insights and current (unconfirmed or confirmed) assumptions and decisions; superseded and refuted entries are not counted.",
  input: z.strictObject({
    status: STATUS.optional().describe("Only this status. Omit for active and achieved."),
    query: z.string().max(500).optional().describe("Case-insensitive substring of title or description."),
    limit: z.number().int().min(1).max(100).default(100),
    cursor: z.string().optional(),
  }),
  rest: { method: "GET", path: "/objectives" },
  mcp: { tool: "objectives", action: "list" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("objectives").selectAll().where("product_id", "=", productId(ctx));
    q = input.status ? q.where("status", "=", input.status) : q.where("status", "!=", "archived");
    if (input.query) q = q.where(sql<boolean>`(title ilike ${"%" + input.query + "%"} or description ilike ${"%" + input.query + "%"})`);
    if (input.cursor) q = q.where("position", ">", Number(input.cursor));
    const rows = (await q.orderBy("position").orderBy("objective_id").limit(input.limit + 1).execute()) as Row[];
    const items = await withCounts(ctx, rows.slice(0, input.limit));
    let archived_hidden = 0;
    if (!input.status) {
      let a = ctx.db.selectFrom("objectives").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", productId(ctx)).where("status", "=", "archived");
      if (input.query) a = a.where(sql<boolean>`(title ilike ${"%" + input.query + "%"} or description ilike ${"%" + input.query + "%"})`);
      archived_hidden = Number((await a.executeTakeFirst())?.n ?? 0);
    }
    return {
      items,
      next_cursor: rows.length > input.limit ? String(items[items.length - 1]!.position) : null,
      archived_hidden,
      ...(archived_hidden ? { note: `${archived_hidden} archived objective${archived_hidden === 1 ? " is" : "s are"} not listed; pass status "archived" to see ${archived_hidden === 1 ? "it" : "them"}.` } : {}),
    };
  },
});

export const getObjective = defineOperation({
  name: "objectives.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read one objective with its etag.",
  description: "The etag guards update.",
  input: z.strictObject({ objective_id: objectiveId }),
  rest: { method: "GET", path: "/objectives/:objective_id" },
  mcp: { tool: "objectives", action: "get" },
  async handler(ctx, input) {
    const [row] = await withCounts(ctx, [await load(ctx, input.objective_id)]);
    return row;
  },
});

export const createObjective = defineOperation({
  name: "objectives.create",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Add an objective: an outcome the discovery serves, not a task.",
  description:
    "Describe the intended outcome and what success means, not a task list. Keep the active set small. New objectives go to the end of the order.",
  input: z.strictObject({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default("").describe("Markdown, up to 2,000 characters."),
    status: STATUS.default("active"),
  }),
  rest: { method: "POST", path: "/objectives" },
  mcp: { tool: "objectives", action: "create" },
  async handler(ctx, input) {
    const last = await ctx.db.selectFrom("objectives").select((eb) => eb.fn.max("position").as("p")).where("product_id", "=", productId(ctx)).executeTakeFirst();
    const objective_id = newId();
    await ctx.db
      .insertInto("objectives")
      .values({
        objective_id, tenant_id: tenantId(ctx), product_id: productId(ctx), title: input.title, description: input.description,
        status: input.status, position: Number(last?.p ?? 0) + 1, etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    await recordActivity(ctx, { action: "created", entity_type: "objective", entity_id: objective_id, entity_title: input.title, summary: `Added an ${input.status} objective` });
    const [row] = await withCounts(ctx, [await load(ctx, objective_id)]);
    return row;
  },
});

export const updateObjective = defineOperation({
  name: "objectives.update",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Change an objective's title, description, status or position. Pass only what changes.",
  description:
    "Requires expected_etag from your latest read. Fields you omit keep their values. Setting status to archived retires it; achieved keeps it visible. The previous title and description are kept as a revision.",
  input: z.strictObject({
    objective_id: objectiveId,
    expected_etag: expectedEtag,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: STATUS.optional(),
    position: z.number().optional().describe("Ordering key; to move between two objectives, use a value between their positions."),
  }),
  rest: { method: "PATCH", path: "/objectives/:objective_id" },
  mcp: { tool: "objectives", action: "update" },
  async handler(ctx, input) {
    const row = await load(ctx, input.objective_id, true);
    checkEtag(input.expected_etag, row.etag, "objective");
    const textChanged =
      (input.title !== undefined && input.title !== row.title) || (input.description !== undefined && input.description !== row.description);
    if (textChanged) await keepRevision(ctx, "objective", row.objective_id, { title: row.title, description: row.description }, row.updated_at, row.updated_by);
    const changed = (["title", "description", "status", "position"] as const).filter((k) => input[k] !== undefined && input[k] !== row[k]);
    if (changed.length) {
      await ctx.db
        .updateTable("objectives")
        .set({
          title: input.title ?? row.title,
          description: input.description ?? row.description,
          status: input.status ?? row.status,
          position: input.position ?? row.position,
          etag: newEtag(),
          updated_at: ctx.now,
          updated_by: json(ctx.actor),
        })
        .where("objective_id", "=", row.objective_id)
        .execute();
      const statusChange = input.status && input.status !== row.status;
      await recordActivity(ctx, {
        action: statusChange ? (input.status === "archived" ? "archived" : row.status === "archived" ? "restored" : input.status!) : changed.includes("position") && changed.length === 1 ? "reordered" : "updated",
        entity_type: "objective",
        entity_id: row.objective_id,
        entity_title: input.title ?? row.title,
        summary: statusChange ? `Changed status from ${row.status} to ${input.status}` : `Changed ${changed.join(", ")}`,
      });
    }
    const [next] = await withCounts(ctx, [await load(ctx, row.objective_id)]);
    return next;
  },
});

export const objectiveOps = [listObjectives, getObjective, createObjective, updateObjective];
