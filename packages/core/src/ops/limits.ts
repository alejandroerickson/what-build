import { MAX_PDF_PAGES, MAX_SEGMENTS } from "@whatbuild/parsers";
import { sql } from "kysely";
import { z } from "zod";
import { checkEtag } from "../common.ts";
import { json, type Db } from "../db.ts";
import { conflict, forbidden, notFound } from "../errors.ts";
import {
  changedFromFree, FREE_LIMITS, LIMITS, limitsPatch, loadLimits, organizationToday, PLANS, usageToday,
  type LimitKey, type LimitState, type Limits, type Plan,
} from "../limits.ts";
import { REST_BODY_MAX_BYTES, SIGN_IN_LINKS_PER_HOUR, type CoreConfig } from "../ports.ts";
import { tenantNamed } from "../policy.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag } from "../schemas.ts";
import { isInstanceOwner } from "../tenant-allowance.ts";
import { STORY_HTML_MAX } from "../story-html.ts";
import { newEtag } from "../util.ts";
import { MAX_ATTACHMENTS } from "./attachments.ts";
import { MAX_MOCKUPS, MOCKUP_HTML_TOTAL, MOCKUP_PAGE_MAX } from "./mockups.ts";
import { MAX_BATCH } from "./sources.ts";
import { MAX_PAGES } from "./story.ts";

/**
 * An organization's plan and its limits: every member reads them, and only an instance owner
 * changes them. A change belongs to no organization's content, so it writes no activity event; the
 * tenant keeps who made it last.
 */

const tenant = z.string().min(1).describe("Tenant slug or id.");

const PLAN_NAMES: Record<Plan, string> = { free: "Free", unlimited: "Unlimited" };

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

/** Each limit with its value, the free plan's, and, for a member, what they used today: counted on every plan. */
async function limitsView(db: Db, state: LimitState, accountId: string | null) {
  const used = accountId ? await usageToday(db, state, accountId) : null;
  const usedOf: Partial<Record<LimitKey, number>> = used
    ? { writes_per_day: used.writes, sources_per_day: used.sources, exports_per_day: used.exports, bytes_per_day: used.bytes, org_writes_per_day: used.org_writes, org_bytes_per_day: used.org_bytes }
    : {};
  return LIMITS.map((l) => ({
    ...l,
    value: state.limits[l.key],
    free_plan: FREE_LIMITS[l.key],
    ...(usedOf[l.key] !== undefined ? { used: usedOf[l.key] } : {}),
    // A daily allowance of 0 is switched off: refused as restricted, not as used up.
    refusal: state.limits[l.key] === 0 && l.refusal === "409 quota_exceeded" ? "403 plan_restricted" : l.refusal,
  }));
}

export const organizationLimits = defineOperation({
  name: "products.limits",
  scope: "tenant",
  access: "any",
  mutates: false,
  summary: "An organization's plan, the limits on how often and how much people work in it, and what you have used of each today.",
  description:
    "plan is free or unlimited. On the free plan everyone in the organization meets every limit, its owners included: limits lists each with its value, the free plan's, what it is counted over, the error a call over it receives and, for the daily ones, what you and everyone together have used today (used); a day is a UTC day and the allowances start again at allowances_restart_at. On the unlimited plan nobody meets them, and you_meet_them is false, but a day's use is counted all the same and given as used: an organization moved to the free plan during a day starts from what that day already used. In the example organization a guest meets only the limit on calls a minute. deployment_limits are the ones every organization has, whatever its plan, each with a key that stays the same. Only an instance owner changes a plan or a limit; tell the person to ask whoever runs this WhatBuild.",
  input: z.strictObject({ tenant }),
  rest: { method: "GET", path: "/limits" },
  mcp: { tool: "products", action: "limits" },
  async handler(ctx) {
    const state = await loadLimits(ctx.db, ctx.scope.tenant!.tenant_id, new Date(ctx.now));
    const guest = ctx.scope.tenantRole === "guest";
    const meets = guest || state.plan === "free";
    return {
      organization: { slug: ctx.scope.tenant!.slug, name: ctx.scope.tenant!.name, ...(ctx.scope.tenant!.example ? { example: true } : {}) },
      plan: state.plan,
      plan_name: PLAN_NAMES[state.plan],
      you_meet_them: meets ? (guest ? "calls_per_minute_only" : true) : false,
      limits: await limitsView(ctx.db, state, guest ? null : ctx.principal.account_id),
      allowances_restart_at: state.day_end,
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
  mutates: false,
  summary: "Every organization on this instance, with its plan, who created it and what it used today (instance owners).",
  description:
    "For the instance's owners: new_organization_plan, the plan an organization someone else creates gets on this deployment (WHATBUILD_NEW_ORGANIZATION_PLAN), and each organization with its slug (and former_slugs, the ones it had before), name, plan, whether it is the example organization, who created it and when, how many people hold a role in it, the limits an instance owner changed from the free plan's (changed_limits), and what everyone in it used today, whatever its plan. It names no product and holds none of an organization's content. Change a plan or a limit with products(action=\"set_limits\"), whose expected_etag is etag; rename an organization with products(action=\"rename_tenant\"), whose expected_etag is name_etag.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/organizations" },
  mcp: { tool: "products", action: "organizations" },
  async handler(ctx) {
    requireInstanceOwner(ctx);
    const rows = await ctx.db
      .selectFrom("tenants as t")
      .select([
        "t.tenant_id", "t.slug", "t.name", "t.name_etag", "t.example", "t.plan", "t.limits", "t.created_at", "t.created_by", "t.limits_updated_at", "t.limits_updated_by",
        (eb) => eb.selectFrom("memberships as m").select((e) => e.fn.count<number>("m.account_id").distinct().as("n")).whereRef("m.tenant_id", "=", "t.tenant_id").as("people"),
      ])
      .orderBy("t.name")
      .execute();
    const former = await ctx.db.selectFrom("tenant_slugs").select(["tenant_id", "slug"]).orderBy("retired_at").execute();
    const items = [];
    for (const r of rows) {
      const slugs = former.filter((f) => f.tenant_id === r.tenant_id).map((f) => f.slug);
      const state = await loadLimits(ctx.db, r.tenant_id, new Date(ctx.now));
      items.push({
        slug: r.slug,
        name: r.name,
        name_etag: r.name_etag,
        ...(slugs.length ? { former_slugs: slugs } : {}),
        plan: r.plan as Plan,
        ...(r.example ? { example: true } : {}),
        people: Number(r.people ?? 0),
        created_at: r.created_at,
        created_by: r.created_by,
        changed_limits: changedFromFree(state.limits),
        etag: state.etag,
        limits_updated_at: r.limits_updated_at,
        limits_updated_by: r.limits_updated_by,
        today: await organizationToday(ctx.db, state),
      });
    }
    return { plans: PLANS, new_organization_plan: ctx.ports.config.newOrganizationPlan ?? "unlimited", free_limits: FREE_LIMITS, limits: LIMITS, items };
  },
});

export const setOrganizationLimits = defineOperation({
  name: "products.set_limits",
  scope: "account",
  access: "any",
  instanceOwnersOnly: true,
  mutates: true,
  connection: "admin",
  summary: "Change an organization's plan, or any of its limits (instance owners).",
  description:
    "Name the organization with tenant, its slug or id. plan is free (everyone in it meets the limits) or unlimited (nobody does). limits changes only the limits it names, from what they are now; reset_limits true first puts every limit back to the free plan's. A change applies to the next call anyone makes there. Pass expected_etag from products(action=\"organizations\") or products(action=\"limits\") once the organization's limits have been changed before; for one never changed, leave it out. Returns the organization's plan and limits as products(action=\"limits\") gives them.",
  input: z.strictObject({
    tenant,
    plan: z.enum(["free", "unlimited"]).optional(),
    limits: limitsPatch.optional(),
    reset_limits: z.boolean().default(false),
    expected_etag: expectedEtag.optional(),
  }),
  rest: { method: "PATCH", path: "/organizations/limits" },
  mcp: { tool: "products", action: "set_limits" },
  async handler(ctx, input) {
    requireInstanceOwner(ctx);
    const t = await organizationRow(ctx.db, input.tenant);
    const row = await ctx.db.selectFrom("tenants").select(["limits_etag"]).where("tenant_id", "=", t.tenant_id).forUpdate().executeTakeFirstOrThrow();
    if (row.limits_etag) {
      if (!input.expected_etag)
        throw conflict("stale_etag", `${t.name}'s limits have been changed before; read them with products(action="organizations") and pass their etag as expected_etag.`, { current_etag: row.limits_etag });
      checkEtag(input.expected_etag, row.limits_etag, "organization's limits");
    } else if (input.expected_etag !== undefined)
      throw conflict("stale_etag", `${t.name}'s limits have never been changed, so there is no etag to match. Leave expected_etag out.`, { current_etag: null });
    const state = await loadLimits(ctx.db, t.tenant_id, new Date(ctx.now));
    const base: Limits = input.reset_limits ? { ...FREE_LIMITS } : state.limits;
    const next: Limits = { ...base, ...Object.fromEntries(Object.entries(input.limits ?? {}).filter(([, v]) => v !== undefined)) };
    await ctx.db
      .updateTable("tenants")
      .set({
        ...(input.plan ? { plan: input.plan } : {}),
        limits: json(changedFromFree(next)),
        limits_etag: newEtag(),
        limits_updated_at: ctx.now,
        limits_updated_by: json(ctx.actor),
      })
      .where("tenant_id", "=", t.tenant_id)
      .execute();
    const after = await loadLimits(ctx.db, t.tenant_id, new Date(ctx.now));
    return {
      organization: { slug: t.slug, name: t.name },
      plan: after.plan,
      plan_name: PLAN_NAMES[after.plan],
      etag: after.etag,
      changed_limits: changedFromFree(after.limits),
      limits: await limitsView(ctx.db, after, null),
    };
  },
});

export const limitOps = [organizationLimits, listOrganizations, setOrganizationLimits];
