import { sql } from "kysely";
import { z } from "zod";
import { defineOperation } from "../registry.ts";

/**
 * The kinds of object a product's log has entries about, and so all its entity_type filter offers.
 * What happens to the organization (its teams, its people and their access) belongs to no product
 * and is read with members.activity; someone joining the product through an invitation is the one
 * entry about people a product's log holds.
 */
export const ENTITY_TYPES = ["product", "membership", "source", "outcome", "assumption", "story_page", "story_hierarchy", "story_style", "mockup"] as const;

/** The channels people act through: the web app, and rest in entries from when a personal token could call the REST API. */
const PEOPLE = ["web", "rest"];

export const listActivity = defineOperation({
  name: "activity.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "What changed in this product, who changed it, and through which surface — newest first.",
  description:
    "Use it for \"what changed since…\", when resuming work, and before revising something a teammate may just have edited. Entries name what changed; they never quote content, so read the item itself before relying on it. Do not write a separate \"what I changed\" note: every write is already here. Filters: entity_type, entity_id (the history of one item), actor (account id), by (people: what people did in the web app, and through the REST API in entries from when personal tokens reached it; agents: what agents did over MCP; what WhatBuild does by itself, such as reading an attachment, has no channel and is in neither), channel, since (ISO 8601).",
  input: z.strictObject({
    entity_type: z.enum(ENTITY_TYPES).optional(),
    entity_id: z.string().max(100).optional(),
    actor: z.string().max(100).optional(),
    channel: z.enum(["web", "rest", "mcp"]).optional(),
    /** people: what people did in the web app, and through the REST API in older entries; agents: what agents did over MCP. Neither holds what WhatBuild does by itself. */
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
    // An entry without a channel is WhatBuild's own work (account "system": the parser, a move into
    // Evidence), as it has been since the first release, so it is no one's.
    if (input.by === "people") q = q.where("channel", "in", PEOPLE);
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
      summary: summaryAsRead(r.action, r.summary),
    }));
    return { items, next_cursor: rows.length > input.limit ? items[items.length - 1]!.activity_id : null };
  },
});

/** An entry's summary as it reads now, whenever it was recorded. */
export function summaryAsRead(action: string, summary: string): string {
  if (action === "derived") return withoutParserLabel(summary);
  if (action === "note_archived") return withoutArchiveReason(summary);
  return summary;
}

/**
 * Parse events recorded before summaries stopped naming the parser ended with its internal label,
 * "(plaintext 5)"; they are read without it, so every parse line says what a person understands.
 */
export function withoutParserLabel(summary: string): string {
  return summary.replace(/ \([a-z]+ \d+\)$/, "");
}

/**
 * An archived comment's entry recorded before the log stopped quoting content ended with the
 * reason it was archived, "Archived a comment: …"; it is read without the person's words.
 */
export function withoutArchiveReason(summary: string): string {
  return summary.replace(/^Archived a comment: [\s\S]*$/, "Archived a comment");
}

export const activityOps = [listActivity];
