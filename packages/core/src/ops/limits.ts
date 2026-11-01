import { MAX_PDF_PAGES, MAX_SEGMENTS } from "@whatbuild/parsers";
import { sql } from "kysely";
import { z } from "zod";
import { checkEtag } from "../common.ts";
import { json, type Db } from "../db.ts";
import { conflict, forbidden, invalid, notFound } from "../errors.ts";
import { guestCounts } from "../guests.ts";
import {
  definedPlans, GUEST_DEFAULTS, GUEST_FIELDS, holdingsOf, isDefinedPlan, LIMITS, loadLimits, organizationToday, PLAN_ID, planCatalogue, planName, UNLIMITED, usageToday,
  type Holdings, type LimitKey, type LimitState, type Plan,
} from "../limits.ts";
import { readGuests, readPlans, saveSetting, settingRecord } from "../settings.ts";
import { REST_BODY_MAX_BYTES, SIGN_IN_LINKS_PER_HOUR, type CoreConfig } from "../ports.ts";
import { membershipsFor, readsOnlyTheStoryIn, tenantNamed } from "../policy.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag } from "../schemas.ts";
import { isInstanceOwner, tenantAllowanceOf } from "../tenant-allowance.ts";
import { STORY_HTML_MAX } from "../story-html.ts";
import { newEtag } from "../util.ts";
import { ownerAddresses, tellOwnersReadOnly } from "../organization-notices.ts";
import { MAX_ATTACHMENTS } from "./attachments.ts";
import { MAX_MOCKUPS, MOCKUP_HTML_TOTAL, MOCKUP_PAGE_MAX } from "./mockups.ts";
import { MAX_BATCH } from "./sources.ts";
import { MAX_PAGES } from "./story.ts";

/**
 * An organization's plan, the limits it sets and what the organization holds against them: everyone
 * in it reads them but someone who reads only the Story there, and only an instance owner moves an
 * organization to another plan. Limits belong to plans, never to one organization. A change of plan
 * belongs to no organization's content, so it writes no activity event; the tenant keeps who made
 * it last.
 */

const tenant = z.string().min(1).describe("Tenant slug or id.");

/** What a total limit measures in `Holdings`. */
const HELD: Partial<Record<LimitKey, (h: Holdings) => number>> = {
  members_max: (h) => h.members + h.invited,
  products_max: (h) => h.products,
  sources_max: (h) => h.sources,
  storage_max_bytes: (h) => h.storage.total,
};


/** How long an organization stays read-only, kept for its people to export, before it may be erased. */
export const READ_ONLY_KEPT_DAYS = 365;

/** The plan organizations start on here (WHATBUILD_NEW_ORGANIZATION_PLAN), whose organizations an allowance counts. */
function startingPlan(ctx: OpContext): string {
  return ctx.ports.config.newOrganizationPlan ?? UNLIMITED;
}

/**
 * Whether an organization that is not a counted one on the starting plan (on another plan, or
 * read-only) would be read-only rather than writable if moved to the starting plan: when that plan
 * is one the deployment defines and the person who started the organization already has as many
 * there as they may have. Everyone has a place for one, even with no allowance to start another
 * (someone who started theirs before allowances, or was never given one), and an instance owner
 * may give more. Since it is not counted, any place left is its place. An account that is gone has
 * nothing to count it against, and an instance owner has no limit.
 */
async function startWouldBeReadOnly(ctx: OpContext, createdBy: unknown): Promise<boolean> {
  if (startingPlan(ctx) === UNLIMITED) return false;
  const accountId = (createdBy as { account_id?: string } | null)?.account_id;
  if (!accountId) return false;
  const account = await ctx.db.selectFrom("accounts").select(["account_id", "email"]).where("account_id", "=", accountId).where("deleted_at", "is", null).executeTakeFirst();
  if (!account) return false;
  const room = await tenantAllowanceOf(ctx.db, ctx.ports.config, account);
  return room.allowed !== null && room.created >= Math.max(room.allowed, 1);
}

/** The read-only state an organization row carries, as everyone reads it. */
export function readOnlyOf(row: { read_only_since: string | null; kept_until: string | null }) {
  return row.read_only_since ? { read_only: { since: row.read_only_since, kept_until: row.kept_until } } : {};
}

/**
 * A plan this deployment defines, or `unlimited` where it may be named; anything else is refused,
 * listing the plans there are.
 */
function knownPlan(id: string, unlimited: boolean) {
  const plan = definedPlans().find((p) => p.id === id);
  if (plan || (unlimited && id === UNLIMITED)) return plan ?? null;
  const ids = [...definedPlans().map((p) => p.id), ...(unlimited ? [UNLIMITED] : [])];
  throw invalid("unknown_plan", `${id} is not a plan this WhatBuild defines. ${ids.length ? `It has ${ids.join(", ")}.` : "It defines none, so every organization is unlimited."} Nothing was changed.`, { plans: ids });
}

/** What a plan is for, in a sentence. */
function aboutPlan(plan: string): string {
  if (plan === UNLIMITED) return "No limits. For this WhatBuild's own organizations; never offered.";
  return definedPlans().find((p) => p.id === plan)?.about ?? "A plan this WhatBuild no longer defines: no limit applies until the organization moves to another plan.";
}

function requireInstanceOwner(ctx: OpContext) {
  if (!isInstanceOwner(ctx.ports.config, ctx.principal.email))
    throw forbidden("Only an owner of this WhatBuild instance can see every organization's plan or change one.");
}

/** The limits every organization on this deployment has, whatever its plan, set where the service is deployed. */
function deploymentLimits(cfg: CoreConfig) {
  return [
    { key: "file_max_bytes", label: "File size", value: cfg.fileMaxBytes, unit: "bytes", set_by: "WHATBUILD_FILE_MAX_BYTES" },
    { key: "relay_max_bytes", label: "File size through the upload relay", value: cfg.relayMaxBytes, unit: "bytes", set_by: "WHATBUILD_RELAY_MAX_BYTES" },
    { key: "parse_cap_bytes", label: "Read per attachment", value: cfg.parseCapBytes, unit: "bytes", set_by: "WHATBUILD_PARSE_CAP_BYTES" },
    { key: "parse_memory_bytes", label: "Memory for reading one attachment", value: cfg.parseMemoryMb * 1024 * 1024, unit: "bytes", set_by: "WHATBUILD_PARSE_MEMORY_MB" },
    { key: "parse_timeout_seconds", label: "Time for reading one attachment", value: cfg.parseTimeoutSeconds, unit: "seconds", set_by: "WHATBUILD_PARSE_TIMEOUT_SECONDS" },
    { key: "paragraphs_per_attachment", label: "Paragraphs read from one attachment", value: MAX_SEGMENTS, unit: "paragraphs", set_by: null },
    { key: "pdf_pages", label: "Pages of a parsed PDF", value: MAX_PDF_PAGES, unit: "pages", set_by: null },
    { key: "url_fetch_max_bytes", label: "A file fetched from a URL", value: cfg.urlFetchMaxBytes, unit: "bytes", set_by: "WHATBUILD_URL_FETCH_MAX_BYTES" },
    { key: "request_body_max_bytes", label: "A request body", value: REST_BODY_MAX_BYTES, unit: "bytes", set_by: null },
    { key: "story_page_max_chars", label: "A Story page", value: STORY_HTML_MAX, unit: "characters", set_by: null },
    { key: "story_pages_per_product", label: "Story pages in a product", value: MAX_PAGES, unit: "pages", set_by: null },
    { key: "mockup_page_max_chars", label: "A mockup page", value: MOCKUP_PAGE_MAX, unit: "characters", set_by: null },
    { key: "mockup_html_max_chars", label: "A mockup version's HTML, all pages", value: MOCKUP_HTML_TOTAL, unit: "characters", set_by: null },
    { key: "mockups_per_product", label: "Mockups in a product", value: MAX_MOCKUPS, unit: "mockups", set_by: null },
    { key: "attachments_per_source", label: "Attachments on a source", value: MAX_ATTACHMENTS, unit: "attachments", set_by: null },
    { key: "sources_per_call", label: "Sources in one archive or restore call", value: MAX_BATCH, unit: "sources", set_by: null },
    { key: "sign_in_links_per_hour", label: "Sign-in links for one address", value: SIGN_IN_LINKS_PER_HOUR, unit: "an hour", set_by: null },
  ];
}

/**
 * Each limit with the value the organization's plan sets (null for none) and, where it has one, what
 * is used of it: today's for the daily ones, counted on every plan; what the organization holds for
 * its totals.
 */
async function limitsView(db: Db, state: LimitState, accountId: string | null, holdings: Holdings | null) {
  const used = accountId ? await usageToday(db, state, accountId) : null;
  const usedOf: Partial<Record<LimitKey, number>> = used
    ? { writes_per_day: used.writes, sources_per_day: used.sources, exports_per_day: used.exports, bytes_per_day: used.bytes, sent_bytes_per_day: used.sent, org_writes_per_day: used.org_writes, org_bytes_per_day: used.org_bytes }
    : {};
  if (holdings) for (const [k, f] of Object.entries(HELD)) usedOf[k as LimitKey] = f(holdings);
  return LIMITS.map((l) => {
    const value = state.limits ? state.limits[l.key] : null;
    return {
      ...l,
      value,
      ...(usedOf[l.key] !== undefined ? { used: usedOf[l.key] } : {}),
      // A daily allowance of 0 is switched off: refused as restricted, not as used up.
      refusal: value === 0 && l.refusal === "409 quota_exceeded" && l.group !== "total" ? "403 plan_restricted" : l.refusal,
    };
  });
}

export const organizationLimits = defineOperation({
  name: "products.limits",
  scope: "tenant",
  access: "any",
  needsSomewhere: "viewer",
  mutates: false,
  summary: "An organization's plan, the limits it sets, what the organization holds against them, and what you have used of each today.",
  description:
    "plan is the organization's plan, one this WhatBuild defines (plans lists them) or unlimited, and an organization is on one plan of its own. On a defined plan everyone in the organization meets the plan's limits, its owners included: limits lists each with its value (null for no limit), what it is counted over, the error a call over it receives and what is used of it (used): what you, or everyone together, used today for a daily one, a day being a UTC day that starts again at allowances_restart_at; what the organization holds for a total (people, products and sources, archived ones included, storage in bytes). holds gives the totals, with storage split into files (attachments, the text read from each attachment, which is kept as a file of its own, and prototypes' files) and text (what is written in WhatBuild itself: derived texts, notes, comments, Story and mockup pages, entries, outcomes and their earlier versions); what is archived still counts under products, sources and storage, and only deleting makes room under them. On the unlimited plan nobody meets them, and you_meet_them is false; so does an organization on a plan this WhatBuild no longer defines (undefined_plan), until it is moved. read_only, when present, means the organization went back to the plan new organizations start on while whoever started it already had one there: everyone in it may read, export, delete and take people out, as their roles allow, every other write is refused (409 organization_read_only), and it is kept until kept_until. In the example organization a guest meets only the guests' limits on calls a minute and bytes downloaded a day. deployment_limits are the ones every organization has, whatever its plan. plans compares the plans this WhatBuild offers. Only an instance owner moves an organization to another plan; tell the person to ask whoever runs this WhatBuild. Someone who reads only the Story everywhere in the organization (a reader on its teams or products and nothing more) reads none of this: 403.",
  input: z.strictObject({ tenant }),
  rest: { method: "GET", path: "/limits" },
  mcp: { tool: "products", action: "limits" },
  async handler(ctx) {
    const tid = ctx.scope.tenant!.tenant_id;
    // How many people, products and sources it holds stays with the team, as its people and evidence do.
    if (readsOnlyTheStoryIn(await membershipsFor(ctx.db, ctx.principal.account_id, tid), tid))
      throw forbidden(`You read only the Story in ${ctx.scope.tenant!.name}, so you can’t see its plan’s limits or what it holds. Viewer access to one of its teams or products shows them.`, { role: "reader", needed: "viewer" });
    const state = await loadLimits(ctx.db, tid, new Date(ctx.now));
    const guest = ctx.scope.tenantRole === "guest";
    const meets = guest || Boolean(state.limits);
    const holdings = guest ? null : await holdingsOf(ctx.db, tid);
    return {
      organization: { slug: ctx.scope.tenant!.slug, name: ctx.scope.tenant!.name, ...(ctx.scope.tenant!.example ? { example: true } : {}) },
      plan: state.plan,
      plan_name: planName(state.plan),
      plan_about: aboutPlan(state.plan),
      ...(state.undefined_plan ? { undefined_plan: true } : {}),
      ...(ctx.scope.tenant!.read_only ? { read_only: ctx.scope.tenant!.read_only } : {}),
      you_meet_them: meets ? (guest ? "calls_per_minute_only" : true) : false,
      ...(holdings ? { holds: holdings } : {}),
      limits: await limitsView(ctx.db, state, guest ? null : ctx.principal.account_id, holdings),
      allowances_restart_at: state.day_end,
      plans: planCatalogue(await readPlans(ctx.db)),
      deployment_limits: deploymentLimits(ctx.ports.config),
    };
  },
});

async function organizationRow(db: Db, ref: string) {
  const t = await db
    .selectFrom("tenants")
    .select(["tenant_id", "slug", "name", "example", "created_at", "created_by"])
    .where("tenant_id", "=", tenantNamed(ref))
    .executeTakeFirst();
  if (!t) throw notFound(`No organization ${ref} on this instance.`);
  return t;
}

export const listOrganizations = defineOperation({
  name: "products.organizations",
  scope: "account",
  access: "any",
  instanceOwnersOnly: true,
  webOnly: "a person does it in the web app, on Organizations (`/instance`)",
  mutates: false,
  summary: "Every organization on this instance, with its plan, what it holds, who created it and what it used today (instance owners).",
  description:
    "For the instance's owners: new_organization_plan, the plan an organization someone else creates gets on this deployment (WHATBUILD_NEW_ORGANIZATION_PLAN), plans, the plans this deployment defines (WHATBUILD_PLANS) with each one's limits and price, empty when it offers none, and each organization with its slug (and former_slugs, the ones it had before), name, plan, read_only when it is read-only (since, and kept_until), starting_plan_is_read_only when moving it to the starting plan would make it read-only, undefined_plan when it is on a plan the deployment no longer defines (it meets no limit until moved), whether it is the example organization, who created it and when, what it holds (people, products and sources, archived ones included, storage in bytes) and what everyone in it used today, whatever its plan. It names no product and holds none of an organization's content. Move an organization to another plan with products.set_plan, whose expected_etag is etag; rename one with products.rename_tenant, whose expected_etag is name_etag.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/organizations" },
  mcp: { tool: "products", action: "organizations" },
  async handler(ctx) {
    requireInstanceOwner(ctx);
    const rows = await ctx.db
      .selectFrom("tenants as t")
      .select([
        "t.tenant_id", "t.slug", "t.name", "t.name_etag", "t.example", "t.plan", "t.created_at", "t.created_by", "t.plan_etag", "t.plan_changed_at", "t.plan_changed_by",
        "t.read_only_since", "t.kept_until",
      ])
      .orderBy("t.name")
      .execute();
    const former = await ctx.db.selectFrom("tenant_slugs").select(["tenant_id", "slug"]).orderBy("retired_at").execute();
    const items = [];
    for (const r of rows) {
      const slugs = former.filter((f) => f.tenant_id === r.tenant_id).map((f) => f.slug);
      const state = await loadLimits(ctx.db, r.tenant_id, new Date(ctx.now));
      // What an organization holds is behind row-level security: read it as that organization, then as none.
      await sql`select set_config('app.tenant_id', ${r.tenant_id}, true)`.execute(ctx.db);
      const holds = await holdingsOf(ctx.db, r.tenant_id);
      items.push({
        slug: r.slug,
        name: r.name,
        name_etag: r.name_etag,
        ...(slugs.length ? { former_slugs: slugs } : {}),
        plan: state.plan,
        ...readOnlyOf(r),
        // What moving it to the starting plan would do: read-only, when whoever started it already has all the organizations there they may have.
        ...(state.undefined_plan ? { undefined_plan: true } : {}),
        ...((r.plan !== startingPlan(ctx) || r.read_only_since) && !r.example && (await startWouldBeReadOnly(ctx, r.created_by)) ? { starting_plan_is_read_only: true } : {}),
        ...(r.example ? { example: true } : {}),
        created_at: r.created_at,
        created_by: r.created_by,
        holds,
        etag: r.plan_etag,
        plan_changed_at: r.plan_changed_at,
        plan_changed_by: r.plan_changed_by,
        today: await organizationToday(ctx.db, state),
      });
    }
    await sql`select set_config('app.tenant_id', '', true)`.execute(ctx.db);
    const ids = definedPlans().map((p) => p.id);
    const records = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await settingRecord(ctx.db, `plan:${id}`)] as const)));
    return {
      plans: planCatalogue(await readPlans(ctx.db)),
      plan_defaults: Object.fromEntries(definedPlans().map((p) => [p.id, p.limits])),
      plan_records: Object.fromEntries(ids.map((id) => [id, { etag: records[id]!.etag, updated_at: records[id]!.updated_at, updated_by: records[id]!.updated_by, changed: (records[id]!.value["limits"] ?? {}) }])),
      plan_names: Object.fromEntries([...definedPlans().map((p) => [p.id, p.name]), [UNLIMITED, planName(UNLIMITED)]]),
      new_organization_plan: ctx.ports.config.newOrganizationPlan ?? "unlimited",
      limits: LIMITS,
      items,
    };
  },
});

export const setOrganizationPlan = defineOperation({
  name: "products.set_plan",
  scope: "account",
  access: "any",
  instanceOwnersOnly: true,
  webOnly: "a person does it in the web app, on Organizations (`/instance`), Change plan on the organization's row",
  mutates: true,
  connection: "admin",
  summary: "Move an organization to another plan (instance owners).",
  description:
    "Name the organization with tenant, its slug or id, and its new plan: one this WhatBuild defines (products.organizations lists them in plans), whose limits everyone in it meets, or unlimited, which has none and is for this WhatBuild's own organizations; any other is refused (422 unknown_plan). Limits belong to plans: an organization's own can't be changed. A move applies to the next call anyone makes there, and what the organization already holds stays, even past the new plan's totals, until people delete enough, or take people out. Each person has one organization on the plan new organizations start on: moving one there whose creator already has theirs (or all an instance owner let them have) makes it read-only instead, kept for a year (read_only, with kept_until), and products.organizations marks it starting_plan_is_read_only beforehand; its owners, but you, are mailed that it is (owners_notified says how many). Everyone in a read-only organization may read, export, delete and take people out, as their roles allow; every other write is refused (409 organization_read_only). Moving it to another plan, or to the starting plan once its creator has no other there, makes it writable again. Pass expected_etag from products.organizations once the organization's plan has been changed before; for one never changed, leave it out. Returns the organization's plan and limits as products.limits gives them.",
  input: z.strictObject({
    tenant,
    plan: z.string().trim().regex(PLAN_ID, "A plan's id: lowercase letters, digits, - and _."),
    expected_etag: expectedEtag.optional(),
  }),
  rest: { method: "PATCH", path: "/organizations/plan" },
  mcp: { tool: "products", action: "set_plan" },
  async handler(ctx, input) {
    requireInstanceOwner(ctx);
    const t = await organizationRow(ctx.db, input.tenant);
    const row = await ctx.db.selectFrom("tenants").select(["plan", "plan_etag", "read_only_since", "kept_until"]).where("tenant_id", "=", t.tenant_id).forUpdate().executeTakeFirstOrThrow();
    if (row.plan_etag) {
      if (!input.expected_etag)
        throw conflict("stale_etag", `${t.name}'s plan has been changed before; read it with products.organizations and pass its etag as expected_etag.`, { current_etag: row.plan_etag });
      checkEtag(input.expected_etag, row.plan_etag, "organization's plan");
    } else if (input.expected_etag !== undefined)
      throw conflict("stale_etag", `${t.name}'s plan has never been changed, so there is no etag to match. Leave expected_etag out.`, { current_etag: null });
    // The starting plan is read-only instead when the person who started it already has an organization there;
    // moving it to Free again once they have room, or to a paid plan, makes it writable.
    knownPlan(input.plan, true);
    const start = startingPlan(ctx);
    const counted = row.plan === start && !row.read_only_since;
    const readOnly = input.plan === start && !counted ? await startWouldBeReadOnly(ctx, t.created_by) : false;
    const keptUntil = new Date(new Date(ctx.now).getTime() + READ_ONLY_KEPT_DAYS * 86_400_000).toISOString();
    const next = readOnly
      ? { read_only_since: row.read_only_since ?? ctx.now, kept_until: row.read_only_since ? row.kept_until : keptUntil }
      : { read_only_since: null, kept_until: null };
    if (row.plan !== input.plan || row.read_only_since !== next.read_only_since)
      await ctx.db
        .updateTable("tenants")
        .set({ plan: input.plan, ...next, plan_etag: newEtag(), plan_changed_at: ctx.now, plan_changed_by: json(ctx.actor) })
        .where("tenant_id", "=", t.tenant_id)
        .execute();
    // Its owners hear that it became read-only from the mail, since the change is made from outside it.
    const owners_notified =
      readOnly && !row.read_only_since ? await tellOwnersReadOnly(ctx, await ownerAddresses(ctx.db, t.tenant_id, ctx.principal.account_id), t, next, planName(start)) : 0;
    const after = await loadLimits(ctx.db, t.tenant_id, new Date(ctx.now));
    await sql`select set_config('app.tenant_id', ${t.tenant_id}, true)`.execute(ctx.db);
    const holds = await holdingsOf(ctx.db, t.tenant_id);
    await sql`select set_config('app.tenant_id', '', true)`.execute(ctx.db);
    return {
      organization: { slug: t.slug, name: t.name },
      plan: after.plan,
      plan_name: planName(after.plan),
      ...readOnlyOf(next),
      owners_notified,
      etag: after.etag,
      holds,
      limits: await limitsView(ctx.db, after, null, holds),
    };
  },
});

// ---- A plan's limits and price, and the guests' settings: the instance owners' -------------------

const MAX = 1024 * 1024 * 1024 * 1024;

/** What `products.set_plan_limits` takes: any of a plan's limits, totals and bytes sent may be null (no limit). */
const planLimitsPatch = z.strictObject(
  Object.fromEntries(
    LIMITS.map((l) => {
      const base = l.group === "switch" ? z.boolean() : z.number().int().min(0).max(MAX);
      return [l.key, (l.group === "total" || l.key === "sent_bytes_per_day" ? base.nullable() : base).optional()];
    }),
  ) as unknown as Record<LimitKey, z.ZodOptional<z.ZodType>>,
);

/** Guard a setting with its etag once it has been changed; a first change takes none. */
function checkSettingEtag(current: string | null, expected: string | undefined, what: string) {
  if (current) {
    if (!expected) throw conflict("stale_etag", `${what} have been changed before; read them again and pass their etag as expected_etag.`, { current_etag: current });
    checkEtag(expected, current, what);
  } else if (expected !== undefined) throw conflict("stale_etag", `${what} have never been changed, so there is no etag to match. Leave expected_etag out.`, { current_etag: null });
}

export const setPlanLimits = defineOperation({
  name: "products.set_plan_limits",
  scope: "account",
  access: "any",
  instanceOwnersOnly: true,
  webOnly: "a person does it in the web app, on Organizations (`/instance`), under Plans, the plan's button",
  mutates: true,
  connection: "admin",
  summary: "Change a plan's limits or its price, for every organization on it (instance owners).",
  description:
    "Name the plan by its id, one this WhatBuild defines (products.organizations lists them). limits changes only the limits it names (a total, or the bytes sent a day, may be null: no limit); price is what the plan costs as people read it, such as \"$20 a month\", or null for none, and left out keeps the one it has; reset puts every limit back to what the deployment's configuration defines first. A change applies from the next call to every organization on the plan; never to one organization alone, which moves to another plan instead (products.set_plan). Pass expected_etag from products.organizations (plan_records) once the plan has been changed before. Returns the plans offered.",
  input: z.strictObject({
    plan: z.string().trim().regex(PLAN_ID, "A plan's id: lowercase letters, digits, - and _."),
    limits: planLimitsPatch.optional(),
    price: z.string().trim().max(60).nullable().optional(),
    reset: z.boolean().default(false),
    expected_etag: expectedEtag.optional(),
  }),
  rest: { method: "PATCH", path: "/plans" },
  mcp: { tool: "products", action: "set_plan_limits" },
  async handler(ctx, input) {
    requireInstanceOwner(ctx);
    const key = `plan:${input.plan}`;
    const record = await settingRecord(ctx.db, key);
    const plan = knownPlan(input.plan, false)!;
    checkSettingEtag(record.etag, input.expected_etag, `The ${plan.name} plan's limits`);
    const before = input.reset ? {} : ((record.value["limits"] ?? {}) as Record<string, unknown>);
    const named = Object.fromEntries(Object.entries(input.limits ?? {}).filter(([, v]) => v !== undefined));
    const merged: Record<string, unknown> = { ...before, ...named };
    // Only what differs from the plan as configured is kept, so a later change of the configuration reaches it.
    const defaults = plan.limits as Record<string, unknown>;
    const limits = Object.fromEntries(Object.entries(merged).filter(([k, v]) => defaults[k] !== v));
    // A price set here, or cleared (null), replaces the configured one; one never set leaves it.
    const price = input.price === undefined ? record.value["price"] : input.price || null;
    const etag = await saveSetting(ctx.db, key, { limits, ...(price !== undefined ? { price } : {}) }, ctx.actor, ctx.now);
    return { plan: input.plan, etag, plans: planCatalogue(await readPlans(ctx.db)) };
  },
});

const guestPatch = z.strictObject(
  Object.fromEntries(GUEST_FIELDS.map((f) => [f.key, (f.unit === "switch" ? z.boolean() : z.number().int().min(0).max(f.unit === "bytes" ? MAX : 1_000_000)).optional()])) as unknown as Record<
    (typeof GUEST_FIELDS)[number]["key"],
    z.ZodOptional<z.ZodType>
  >,
);

export const guestSettings = defineOperation({
  name: "products.guests",
  scope: "account",
  access: "any",
  instanceOwnersOnly: true,
  webOnly: "a person does it in the web app, on Organizations (`/instance`), under Guests",
  mutates: false,
  summary: "How guests come in and what they may do, with how many are in and waiting now (instance owners).",
  description:
    "Guests are accounts in no organization, with no allowance to start one: they read the example organization and nothing else, and wait in line when every place is taken. settings are what this deployment has (each field in fields, with its default in defaults); now gives how many guests are in, waiting, came in for the first time today, and have ever come in. Change them with products.set_guests, whose expected_etag is etag.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/guests" },
  mcp: { tool: "products", action: "guests" },
  async handler(ctx) {
    requireInstanceOwner(ctx);
    const settings = await readGuests(ctx.db);
    const record = await settingRecord(ctx.db, "guests");
    // With no sign-up allowlist nothing limits who makes an account, whatever self_serve says, so the page says so.
    return { settings, defaults: GUEST_DEFAULTS, fields: GUEST_FIELDS, open_without_allowlist: !ctx.ports.config.signupAllowlist, etag: record.etag, updated_at: record.updated_at, updated_by: record.updated_by, now: await guestCounts(ctx.db, settings) };
  },
});

export const setGuestSettings = defineOperation({
  name: "products.set_guests",
  scope: "account",
  access: "any",
  instanceOwnersOnly: true,
  webOnly: "a person does it in the web app, on Organizations (`/instance`), under Guests",
  mutates: true,
  connection: "admin",
  summary: "Change how guests come in and what they may do (instance owners).",
  description:
    "Changes only the settings it names: self_serve (anyone may sign up as a guest), at_once (guests in at once; 0 lets none in), new_per_day, idle_minutes, minutes_per_day, requests_per_minute and sent_bytes_per_day. A change applies from the next call; guests already in keep their place until it frees. Pass expected_etag from products.guests once they have been changed before.",
  input: guestPatch.extend({ expected_etag: expectedEtag.optional() }),
  rest: { method: "PATCH", path: "/guests" },
  mcp: { tool: "products", action: "set_guests" },
  async handler(ctx, input) {
    requireInstanceOwner(ctx);
    const record = await settingRecord(ctx.db, "guests");
    checkSettingEtag(record.etag, input.expected_etag, "The guests' settings");
    const { expected_etag: _e, ...patch } = input as Record<string, unknown>;
    const merged = { ...record.value, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    const value = Object.fromEntries(Object.entries(merged).filter(([k, v]) => (GUEST_DEFAULTS as unknown as Record<string, unknown>)[k] !== v));
    const etag = await saveSetting(ctx.db, "guests", value, ctx.actor, ctx.now);
    const settings = await readGuests(ctx.db);
    return { settings, etag, now: await guestCounts(ctx.db, settings) };
  },
});

export const limitOps = [organizationLimits, listOrganizations, setOrganizationPlan, setPlanLimits, guestSettings, setGuestSettings];
