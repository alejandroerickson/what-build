import { sql } from "kysely";
import { z } from "zod";
import { changedInWords } from "../common.ts";
import { roleWords } from "../policy.ts";
import { defineOperation } from "../registry.ts";

/**
 * The kinds of object a product's log has entries about, and so all its entity_type filter offers.
 * What happens to the organization (its people and their access) belongs to no product
 * and is read with members.activity; someone joining the product through an invitation is the one
 * entry about people a product's log holds.
 */
export const ENTITY_TYPES = ["product", "membership", "source", "outcome", "story_page", "story_hierarchy", "story_style", "mockup"] as const;

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
      summary: summaryAsRead(r.action, r.entity_type, r.summary),
    }));
    return { items, next_cursor: rows.length > input.limit ? items[items.length - 1]!.activity_id : null };
  },
});

/**
 * An entry's summary as it reads now, whenever it was recorded. The product's log and the
 * organization's access log (members.activity) both read their summaries through it.
 */
export function summaryAsRead(action: string, entityType: string, summary: string): string {
  if (entityType === "membership") return accessSummaryAsRead(action, summary);
  if (action === "derived") return withoutParserLabel(summary);
  if (action === "note_archived") return withoutArchiveReason(summary);
  if (action === "updated" || action === "reordered") return changedInWords(entityType, summary);
  return summary;
}

/** The roles a team's grant could give, before an organization held its products directly. */
const TEAM_ROLES = new Set(["admin", "editor", "viewer", "reader"]);

/**
 * An entry about people and access, as it reads now. Entries recorded before an organization held
 * its products directly named a team as the place of a role ("Granted editor on team Product
 * team"): no grant names a team now, so the role reads without its place ("Granted editor").
 * Entries recorded before the Story-only role was named story_reader called it reader: it reads as
 * a Story reader. A role some entries named by its identifier (story_reader, creator) reads in
 * words, as roleWords gives it, and an organization once called a tenant reads as an organization.
 * Every other summary reads as it was written.
 */
export function accessSummaryAsRead(action: string, summary: string): string {
  if (action === "granted" || action === "role_changed") {
    const [, verb, role = "", place = ""] = /^(Granted|Changed role to) (\w+) on (.+)$/s.exec(summary) ?? [];
    const read = verb && roleOnPlaceAsRead(role, place);
    return read ? `${verb} ${read}` : summary;
  }
  if (action === "revoked") {
    // Their only role, so they left the organization with it.
    const [, organization, role = "", place = ""] = /^Removed from (.+): (\w+) on (.+) was their only role$/s.exec(summary) ?? [];
    if (organization) {
      const read = roleOnPlaceAsRead(role, place);
      return read ? `Removed from ${organization}: ${read} was their only role` : summary;
    }
    const [one, oneRole = "", onePlace = ""] = /^Removed (\w+) on (.+)$/s.exec(summary) ?? [];
    const read = one && roleOnPlaceAsRead(oneRole, onePlace);
    return read ? `Removed ${read}` : summary;
  }
  if (action === "invited" || action === "joined" || action === "invitation_declined") {
    const [, verb, role = ""] = /^(Invited someone|Accepted an invitation|Declined an invitation) as (\w+)$/.exec(summary) ?? [];
    return verb ? `${verb} as ${roleAsRead(role)}` : summary;
  }
  return summary;
}

/** The name an invitation's entry records for all of an organization's products, as a heading would write it. */
const ALL_PRODUCTS_TITLE = "All products";

/**
 * An access entry's title as it reads now. An invitation to all of an organization's products, sent
 * or declined, records their name as a heading writes it, "All products", and its entry ends a
 * sentence ("invited someone to all products"), so it reads in lower case. `invitationScope` is the
 * scope_type of the invitation the entry is about, where it is still stored: a product that is
 * really called "All products" keeps its name. An invitation no longer stored (deleted with its
 * product, organization or address) is taken to be one to all products, as almost every entry
 * with that title is. Every other title reads as it was written.
 */
export function entryTitleAsRead(action: string, entityType: string, title: string | null, invitationScope?: string | null): string | null {
  if (!titleNeedsInvitationScope(action, entityType, title)) return title;
  if (invitationScope && invitationScope !== "all_products") return title;
  return "all products";
}

/** The access entries whose title entryTitleAsRead may reword, so a reader looks up only their invitations. */
export function titleNeedsInvitationScope(action: string, entityType: string, title: string | null): boolean {
  return entityType === "membership" && title === ALL_PRODUCTS_TITLE && (action === "invited" || action === "invitation_declined");
}

/** A role an access entry named, in today's words: reader was the Story reader's name before story_reader. */
function roleAsRead(role: string): string {
  return role === "reader" ? "Story reader" : roleWords(role);
}

/** "<role> on <place>" from an old access entry as it reads now, or null where it reads as written. */
function roleOnPlaceAsRead(role: string, place: string): string | null {
  if (place.startsWith("team ") && TEAM_ROLES.has(role)) return roleAsRead(role);
  const read = `${roleAsRead(role)} on ${place.replace(/^tenant /, "organization ")}`;
  return read === `${role} on ${place}` ? null : read;
}

/**
 * An access log entry's action as it reads now. An account's ending was once recorded as "revoked",
 * as if someone had taken a role, so the log said the person removed their own; its summary says
 * which ending it was.
 */
export function actionAsRead(action: string, summary: string): string {
  if (action !== "revoked") return action;
  if (/^Left .* \(\d+ roles?\) by deleting their account$/s.test(summary)) return "account_deleted";
  if (/^Removed from .* \(\d+ roles?\) with the account, by an owner of this instance$/s.test(summary)) return "account_removed";
  return action;
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
