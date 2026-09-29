import { sql } from "kysely";
import { z } from "zod";
import { defineOperation } from "../registry.ts";

const ENTITY_TYPES = ["product", "team", "tenant", "membership", "source", "outcome", "insight", "assumption", "decision", "story_page", "story_hierarchy", "feedback"] as const;

export const listActivity = defineOperation({
  name: "activity.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "What changed in this product, who changed it, and through which surface — newest first.",
  description:
    "Use it for \"what changed since…\", when resuming work, and before revising something a teammate may just have edited. Entries name what changed; they never quote content, so read the item itself before relying on it. Do not write a separate \"what I changed\" note: every write is already here. Filters: entity_type, entity_id (the history of one item), actor (account id), by (people: the app and the REST API; agents: MCP), channel, since (ISO 8601).",
  input: z.strictObject({
    entity_type: z.enum(ENTITY_TYPES).optional(),
    entity_id: z.string().max(100).optional(),
    actor: z.string().max(100).optional(),
    channel: z.enum(["web", "rest", "mcp"]).optional(),
    /** people: what people did in the app or through the REST API; agents: what agents did over MCP. */
    by: z.enum(["people", "agents"]).optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
  }),
  rest: { method: "GET", path: "/activity" },
  mcp: { tool: "activity", action: "list" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("activity").selectAll().where("product_id", "=", ctx.scope.product!.product_id);
    if (input.entity_type) q = q.where("entity_type", "=", input.entity_type);
    if (input.entity_id) q = q.where("entity_id", "=", input.entity_id);
    if (input.actor) q = q.where("actor_account_id", "=", input.actor);
    if (input.channel) q = q.where("channel", "=", input.channel);
    if (input.by === "agents") q = q.where("channel", "=", "mcp");
    if (input.by === "people") q = q.where((eb) => eb.or([eb("channel", "is", null), eb("channel", "!=", "mcp")]));
    if (input.since) q = q.where(sql<boolean>`occurred_at >= ${input.since}::timestamptz`);
    if (input.cursor) q = q.where("activity_id", "<", input.cursor);
    const rows = await q.orderBy("activity_id", "desc").limit(input.limit + 1).execute();
    const items = rows.slice(0, input.limit).map((r) => ({
      activity_id: r.activity_id,
      occurred_at: r.occurred_at,
      actor: r.actor,
      channel: r.channel,
      through_agent: r.channel === "mcp",
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      entity_title: r.entity_title,
      summary: r.summary,
    }));
    return { items, next_cursor: rows.length > input.limit ? items[items.length - 1]!.activity_id : null };
  },
});

export const activityOps = [listActivity];
