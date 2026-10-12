import { MAX_PDF_PAGES, MAX_SEGMENTS } from "@whatbuild/parsers";
import { sql } from "kysely";
import { z } from "zod";
import { checkEtag, recordActivity } from "../common.ts";
import { json } from "../db.ts";
import { AppError, conflict, gone, invalid, notFound } from "../errors.ts";
import { REST_BODY_MAX_BYTES, SIGN_IN_LINKS_PER_HOUR } from "../ports.ts";
import { membershipsFor, readsOnlyTheStoryIn } from "../policy.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { baselineView, BASELINES_KEPT, resetToBaseline, saveBaseline } from "../public-sandbox-baseline.ts";
import {
  describeSettingsChange, loadSandbox, lockSettings, resetIsDue, SANDBOX_DEFAULTS, SANDBOX_LIMITS, sandboxSettingsPatch, usageToday, VISITOR_CODE_SQL, visitorName,
  type SandboxContext, type SandboxSettings, type SandboxState,
} from "../public-sandbox.ts";
import { expectedEtag, id } from "../schemas.ts";
import { decodeCursor, encodeCursor, newEtag, newId, randomToken, sha256Hex } from "../util.ts";
import { MAX_BATCH } from "./sources.ts";
import { MAX_MOCKUPS, MOCKUP_HTML_TOTAL } from "./mockups.ts";
import { MAX_PAGES } from "./story.ts";
import { STORY_HTML_MAX } from "../story-html.ts";

export const RESET_CONFIRMATION = "reset the sandbox";

const tenant = z.string().min(1).describe("Tenant slug or id.");

function sandboxOf(ctx: OpContext): SandboxContext {
  if (!ctx.sandbox) throw notFound(`${ctx.scope.tenant!.name} isn’t a public sandbox.`);
  return ctx.sandbox;
}

/**
 * How a person stands in a public sandbox. Its staff are its owners and admins. A visitor came in
 * by an invitation link. A member was given a role by its staff; in a sandbox a member is treated
 * as a visitor is (the made-up name, the limits), without being one.
 */
export type SandboxStanding = "staff" | "member" | "visitor";

export function sandboxStanding(tenantRole: string | null | undefined): SandboxStanding {
  return tenantRole === "owner" || tenantRole === "admin" ? "staff" : tenantRole === "visitor" ? "visitor" : "member";
}

/** What others see of what a person adds, by how they stand in the sandbox. */
const WHO_SEES: Record<SandboxStanding, string> = {
  visitor: "Other visitors see what you add, under a made-up name.",
  member: "Everyone here sees what you add, under a made-up name.",
  staff: "Visitors see what you add, under your own name.",
};

/** The words every surface shows a person, and an agent shows its person, before anything is added. */
export function sandboxNotice(state: Pick<SandboxState, "settings" | "baseline_id">, as: SandboxStanding = "visitor", readsOnlyTheStory = false): string {
  const s = state.settings;
  const erased = s.reset_enabled && state.baseline_id
    ? `Everything added is erased every day at ${s.reset_time} (${s.reset_timezone.replace(/_/g, " ")} time)`
    : "Everything added may be erased at any time";
  if (readsOnlyTheStory) return `This is a public sandbox. You can only read the Story here. ${erased}.`;
  return `This is a public sandbox. ${WHO_SEES[as]} ${erased}. Don’t add anything private.`;
}

async function seatsUsed(ctx: OpContext, tenantId: string): Promise<number> {
  const r = await ctx.db
    .selectFrom("memberships")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("scope_type", "=", "tenant")
    .where("role", "=", "visitor")
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

function schedule(sb: SandboxState) {
  const s = sb.settings;
  return {
    enabled: s.reset_enabled,
    time: s.reset_time,
    timezone: s.reset_timezone,
    // A reset needs a baseline to put back; without one the hour passes and nothing happens.
    next_at: s.reset_enabled && sb.baseline_id ? sb.day_end : null,
    last_at: sb.last_reset_at,
  };
}

// ---- For everyone in the sandbox ----------------------------------------------------------------

export const sandboxStatus = defineOperation({
  name: "sandbox.status",
  scope: "tenant",
  access: "any",
  mutates: false,
  summary: "What a public sandbox is for the caller: the notice to show, when it resets, the name they write under, and what is left of each allowance.",
  description:
    "Call it when products(action=\"list\") marks a tenant as a sandbox, before your first write there, and tell the person the notice. you.role is staff (an owner or admin, under their own name), visitor (came in by an invitation link) or member (given a role by its staff); a visitor or member writes under appears_as, sees no other person and meets the limits; a member who reads only the Story has you.story_only true and appears_as null, and writes nothing. allowances lists every limit with what is used today; a write over one is refused with 429 rate_limited or 409 quota_exceeded, one whose daily allowance is 0 is switched off and refused with 403 sandbox_restricted, and reads are never stopped by an allowance. Answers 404 in an organization that is not a sandbox.",
  input: z.strictObject({ tenant }),
  rest: { method: "GET", path: "/sandbox" },
  mcp: { tool: "sandbox", action: "status" },
  async handler(ctx) {
    const sb = sandboxOf(ctx);
    const s = sb.settings;
    const standing = sandboxStanding(ctx.scope.tenantRole);
    // A member given only reader roles reads the Story and writes nothing, so nothing is said of writing.
    const tid = ctx.scope.tenant!.tenant_id;
    const reader = standing === "member" && readsOnlyTheStoryIn(await membershipsFor(ctx.db, ctx.principal.account_id, tid), tid);
    const used = sb.visitor ? await usageToday(ctx.db, sb, ctx.principal.account_id) : null;
    const usedOf: Partial<Record<keyof SandboxSettings, number>> = used
      ? { writes_per_day: used.writes, sources_per_day: used.sources, exports_per_day: used.exports, bytes_per_day: used.bytes, org_writes_per_day: used.org_writes, org_bytes_per_day: used.org_bytes }
      : {};
    return {
      public_sandbox: true,
      organization: { slug: ctx.scope.tenant!.slug, name: ctx.scope.tenant!.name },
      notice: sandboxNotice(sb, standing, reader),
      visitor_access: s.visitor_access,
      agents_allowed: s.visitor_agents,
      resets: schedule(sb),
      you: {
        role: standing,
        appears_as: reader ? null : sb.appears_as,
        ...(reader ? { story_only: true } : {}),
        can:
          reader
            ? "Read the Story of the products you were given. You write nothing here, and you can’t see who else is here."
            : standing === "staff"
            ? "Everything an owner or admin can, under your own name. The limits below apply only to visitors."
            : standing === "member"
              ? "Read, search, and add or change content where your role allows. As in every public sandbox, anyone but its owners and admins writes under a made-up name and meets the limits below. You can’t manage products or people, see who else is here, or delete anything permanently."
              : "Read, search, and add or change content in every product here. You can’t manage products or people, see who else is here, or delete anything permanently.",
      },
      allowances: SANDBOX_LIMITS.map((l) => ({
        key: l.key,
        label: l.label,
        per: l.per,
        limit: s[l.key],
        unit: l.unit,
        ...(usedOf[l.key] !== undefined ? { used: usedOf[l.key] } : {}),
        // An allowance of 0 is switched off: refused as restricted, not as used up.
        refusal: s[l.key] === 0 && l.refusal === "409 quota_exceeded" ? "403 sandbox_restricted" : l.refusal,
      })),
      allowances_restart_at: sb.day_end,
    };
  },
});

export const joinSandbox = defineOperation({
  name: "sandbox.join",
  scope: "account",
  access: "any",
  mutates: true,
  summary: "Enter a public sandbox with an invitation code; you become a visitor there.",
  description:
    "The code is the last part of an invitation link (…/join/<code>). An invitation admits a set number of people and the sandbox holds a set number of visitors, so either may be full. Someone already in the organization keeps the role they have and takes no seat. Returns the notice to show the person, the name they will write under, and the products to open.",
  input: z.strictObject({ code: z.string().trim().min(10).max(200) }),
  rest: { method: "POST", path: "/sandbox/join" },
  mcp: { tool: "sandbox", action: "join" },
  async handler(ctx, input) {
    const inv = await ctx.db
      .selectFrom("sandbox_invites as i")
      .innerJoin("tenants as t", "t.tenant_id", "i.tenant_id")
      .select(["i.invite_id", "i.tenant_id", "i.max_uses", "i.used", "i.expires_at", "i.revoked_at", "i.created_by", "t.slug", "t.name", "t.sandbox"])
      .where("i.code_hash", "=", sha256Hex(input.code))
      .executeTakeFirst();
    if (!inv || !inv.sandbox) throw notFound("This invitation link isn’t valid. Check that the whole link was copied, or ask for a new one.");
    // Joins are counted one at a time, so neither the invitation nor the sandbox takes one too many.
    await lockSettings(ctx.db, inv.tenant_id);
    const sb = await loadSandbox(ctx.db, inv.tenant_id);
    const products = await ctx.db
      .selectFrom("products as p")
      .innerJoin("teams as tm", "tm.team_id", "p.team_id")
      .select(["p.name", "p.slug", "tm.slug as team_slug"])
      .where("p.tenant_id", "=", inv.tenant_id)
      .where("p.archived_at", "is", null)
      .orderBy("p.name")
      .execute();
    const entered = {
      joined: true,
      organization: { slug: inv.slug, name: inv.name },
      resets: schedule(sb),
      products: products.map((p) => ({ name: p.name, path: `${inv.slug}/${p.team_slug}/${p.slug}` })),
    };
    const held = await ctx.db.selectFrom("memberships").select(["scope_type", "role"]).where("tenant_id", "=", inv.tenant_id).where("account_id", "=", ctx.principal.account_id).execute();
    if (held.length) {
      const own = held.find((m) => m.scope_type === "tenant")?.role ?? "member";
      const standing = sandboxStanding(own);
      return { ...entered, notice: sandboxNotice(sb, standing), already: true, role: own, appears_as: standing === "staff" ? null : visitorName(inv.tenant_id, ctx.principal.account_id) };
    }
    if (inv.revoked_at) throw gone("invite_revoked", "This invitation was withdrawn. Ask whoever sent it for a new link.");
    if (inv.expires_at && Date.parse(inv.expires_at) < Date.parse(ctx.now)) throw gone("invite_expired", "This invitation has expired. Ask whoever sent it for a new link.");
    const current = await ctx.db.selectFrom("sandbox_invites").select("used").where("invite_id", "=", inv.invite_id).forUpdate().executeTakeFirstOrThrow();
    if (current.used >= inv.max_uses) throw gone("invite_used_up", "Every place on this invitation has been taken. Ask whoever sent it for a new link.");
    if (sb.settings.visitor_access === "closed") throw new AppError(403, "sandbox_closed", "This public sandbox is closed to visitors for now. Your invitation is still good; try again later.");
    const seats = await seatsUsed(ctx, inv.tenant_id);
    if (seats >= sb.settings.max_visitors)
      throw conflict("sandbox_full", "This public sandbox is full for now. Your invitation is still good; try again later.", { quota: "max_visitors", limit: sb.settings.max_visitors, used: seats, unit: "visitors" });
    await ctx.db
      .insertInto("memberships")
      .values({ membership_id: newId(), tenant_id: inv.tenant_id, scope_type: "tenant", scope_id: inv.tenant_id, account_id: ctx.principal.account_id, role: "visitor", created_by: json(inv.created_by) })
      .execute();
    await ctx.db.updateTable("sandbox_invites").set({ used: current.used + 1 }).where("invite_id", "=", inv.invite_id).execute();
    // No activity event: a visitor's name is never written into the organization.
    return { ...entered, notice: sandboxNotice(sb), already: false, role: "visitor", appears_as: visitorName(inv.tenant_id, ctx.principal.account_id) };
  },
});

// ---- For its staff: the control panel -----------------------------------------------------------

async function panel(ctx: OpContext, sb: SandboxState) {
  const tid = sb.tenant_id;
  const s = sb.settings;
  const cfg = ctx.ports.config;
  const baseline = sb.baseline_id ? await ctx.db.selectFrom("sandbox_baselines").selectAll().where("baseline_id", "=", sb.baseline_id).executeTakeFirst() : undefined;
  const invites = await ctx.db.selectFrom("sandbox_invites").select(["max_uses", "used", "expires_at", "revoked_at"]).where("tenant_id", "=", tid).execute();
  const open = invites.filter((i) => !i.revoked_at && (!i.expires_at || Date.parse(i.expires_at) > Date.parse(ctx.now)) && i.used < i.max_uses);
  const usage = await ctx.db
    .selectFrom("sandbox_usage")
    .select(["counter", (eb) => eb.fn.sum<number>("n").as("n"), (eb) => eb.fn.count<number>("account_id").as("accounts")])
    .where("tenant_id", "=", tid)
    .where("bucket", "=", "day")
    .where("starts_at", "=", sb.day_start)
    .where("account_id", "!=", "")
    .groupBy("counter")
    .execute();
  const total = (counter: string) => Number(usage.find((u) => u.counter === counter)?.n ?? 0);
  return {
    organization: { slug: ctx.scope.tenant!.slug, name: ctx.scope.tenant!.name },
    etag: sb.etag,
    // What visitors are told: the panel shows staff the words their visitors read.
    notice: sandboxNotice(sb),
    settings: s,
    defaults: SANDBOX_DEFAULTS,
    limits: SANDBOX_LIMITS.map((l) => ({ ...l, value: s[l.key], default: SANDBOX_DEFAULTS[l.key] })),
    // The limits every organization on this deployment has, set where the service is deployed.
    deployment_limits: [
      { label: "File size", value: cfg.fileMaxBytes, unit: "bytes", set_by: "WHATBUILD_FILE_MAX_BYTES" },
      { label: "File size through the upload relay", value: cfg.relayMaxBytes, unit: "bytes", set_by: "WHATBUILD_RELAY_MAX_BYTES" },
      { label: "Parsed per primary file", value: cfg.parseCapBytes, unit: "bytes", set_by: "WHATBUILD_PARSE_CAP_BYTES" },
      { label: "Memory for parsing one file", value: cfg.parseMemoryMb * 1024 * 1024, unit: "bytes", set_by: "WHATBUILD_PARSE_MEMORY_MB" },
      { label: "Time for parsing one file", value: cfg.parseTimeoutSeconds, unit: "seconds", set_by: "WHATBUILD_PARSE_TIMEOUT_SECONDS" },
      { label: "Passages from one file", value: MAX_SEGMENTS, unit: "passages", set_by: null },
      { label: "Pages of a parsed PDF", value: MAX_PDF_PAGES, unit: "pages", set_by: null },
      { label: "A file fetched from a URL", value: cfg.urlFetchMaxBytes, unit: "bytes", set_by: "WHATBUILD_URL_FETCH_MAX_BYTES" },
      { label: "A request body", value: REST_BODY_MAX_BYTES, unit: "bytes", set_by: null },
      { label: "A Story page", value: STORY_HTML_MAX, unit: "characters", set_by: null },
      { label: "Story pages in a product", value: MAX_PAGES, unit: "pages", set_by: null },
      { label: "A mockup version's HTML, all pages", value: MOCKUP_HTML_TOTAL, unit: "characters", set_by: null },
      { label: "Mockups in a product", value: MAX_MOCKUPS, unit: "mockups", set_by: null },
      { label: "Files on a source", value: 50, unit: "files", set_by: null },
      { label: "Sources in one archive or restore call", value: MAX_BATCH, unit: "sources", set_by: null },
      { label: "Sign-in links for one address", value: SIGN_IN_LINKS_PER_HOUR, unit: "an hour", set_by: null },
    ],
    resets: { ...schedule(sb), due: resetIsDue(sb), last: sb.last_reset },
    baseline: baseline ? baselineView(baseline, sb.baseline_id) : null,
    seats: { used: await seatsUsed(ctx, tid), limit: s.max_visitors },
    invitations: { open: open.length, places_left: open.reduce((n, i) => n + (i.max_uses - i.used), 0) },
    today: {
      since: sb.day_start,
      until: sb.day_end,
      visitors_writing: Number(usage.find((u) => u.counter === "writes")?.accounts ?? 0),
      writes: total("writes"),
      sources: total("sources"),
      exports: total("exports"),
      bytes: total("bytes"),
    },
    updated_at: sb.updated_at,
    updated_by: sb.updated_by,
  };
}

export const sandboxSettings = defineOperation({
  name: "sandbox.settings",
  scope: "tenant",
  access: "admin",
  mutates: false,
  summary: "The sandbox's control panel: every switch and limit with its value, the reset schedule, the baseline in use, seats, invitations, and today's use (tenant admins).",
  description:
    "limits lists every limit on what a visitor does, with its value, its default, what it is counted over and the error a caller over it receives. deployment_limits are the ones every organization has; they are set where the service is deployed, not here. resets.due is true when the scheduled hour has passed and the reset has not run yet. The etag guards sandbox(action=\"update_settings\").",
  input: z.strictObject({ tenant }),
  rest: { method: "GET", path: "/sandbox/settings" },
  mcp: { tool: "sandbox", action: "settings" },
  async handler(ctx) {
    return panel(ctx, sandboxOf(ctx));
  },
});

export const updateSandboxSettings = defineOperation({
  name: "sandbox.update_settings",
  scope: "tenant",
  access: "admin",
  mutates: true,
  summary: "Change the sandbox's switches, schedule or limits (tenant admins).",
  description:
    "Pass only the settings that change, plus expected_etag. A change applies to the next call a visitor makes. visitor_access closes the sandbox to visitors (closed) or leaves them reading (read) without touching anyone's seat. Setting a limit to 0 refuses everything it counts. Returns the control panel as sandbox(action=\"settings\") does.",
  input: sandboxSettingsPatch.extend({ tenant, expected_etag: expectedEtag }),
  rest: { method: "PATCH", path: "/sandbox/settings" },
  mcp: { tool: "sandbox", action: "update_settings" },
  async handler(ctx, input) {
    sandboxOf(ctx);
    const tid = ctx.scope.tenant!.tenant_id;
    const row = await lockSettings(ctx.db, tid);
    const { tenant: _tenant, expected_etag, ...patch } = input;
    void _tenant;
    // A sandbox that has never been changed has no stored etag to have read.
    if (ctx.sandbox!.etag !== "unset") checkEtag(expected_etag, row.etag, "sandbox's settings");
    const changed = (Object.keys(patch) as (keyof SandboxSettings)[]).filter((k) => patch[k] !== undefined && patch[k] !== ctx.sandbox!.settings[k]);
    if (changed.length) {
      const next = { ...ctx.sandbox!.settings, ...Object.fromEntries(changed.map((k) => [k, patch[k]])) };
      await ctx.db.updateTable("sandbox_settings").set({ settings: json(next), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("tenant_id", "=", tid).execute();
      await recordActivity(ctx, { action: "updated", entity_type: "sandbox", entity_id: tid, entity_title: ctx.scope.tenant!.name, summary: describeSettingsChange(changed, next) });
    }
    return { ...(await panel(ctx, await loadSandbox(ctx.db, tid, new Date(ctx.now)))), changed };
  },
});

export const saveSandboxBaseline = defineOperation({
  name: "sandbox.save_baseline",
  scope: "tenant",
  access: "admin",
  mutates: true,
  exclusive: true,
  summary: "Save the organization's content as it is now as the baseline every reset puts back (tenant admins).",
  description:
    `Holds every team, product, source, file, passage, note, outcome, assumption, review, Story page, mockup and activity event, with their ids, so links keep working after a reset. It holds what visitors have added too, so reset first (or set visitor_access to read) unless you mean to keep it. People and their access are not part of a baseline. The newest ${BASELINES_KEPT} are kept. Files are referred to, not copied.`,
  input: z.strictObject({ tenant, note: z.string().trim().max(500).default("").describe("What this baseline is, for whoever reads the list later.") }),
  rest: { method: "POST", path: "/sandbox/baselines" },
  mcp: { tool: "sandbox", action: "save_baseline" },
  async handler(ctx, input) {
    sandboxOf(ctx);
    const tid = ctx.scope.tenant!.tenant_id;
    const saved = await saveBaseline(ctx.db, tid, ctx.actor, input.note, ctx.enqueue);
    await ctx.db.updateTable("sandbox_settings").set({ etag: newEtag() }).where("tenant_id", "=", tid).execute();
    await recordActivity(ctx, { action: "baseline_saved", entity_type: "sandbox", entity_id: saved.baseline_id, entity_title: ctx.scope.tenant!.name, summary: `Saved a baseline of ${saved.rows} rows` });
    return saved;
  },
});

export const listSandboxBaselines = defineOperation({
  name: "sandbox.baselines",
  scope: "tenant",
  access: "admin",
  mutates: false,
  summary: "The sandbox's saved baselines, newest first, with what each holds and which is in use (tenant admins).",
  description: `The newest ${BASELINES_KEPT} are kept. Pass a baseline_id to sandbox(action="reset") to go back to an earlier one.`,
  input: z.strictObject({ tenant }),
  rest: { method: "GET", path: "/sandbox/baselines" },
  mcp: { tool: "sandbox", action: "baselines" },
  async handler(ctx) {
    const sb = sandboxOf(ctx);
    const rows = await ctx.db.selectFrom("sandbox_baselines").selectAll().where("tenant_id", "=", sb.tenant_id).orderBy("baseline_id", "desc").execute();
    return { items: rows.map((b) => baselineView(b, sb.baseline_id)) };
  },
});

export const resetSandbox = defineOperation({
  name: "sandbox.reset",
  scope: "tenant",
  access: "admin",
  mutates: true,
  exclusive: true,
  summary: "Put the sandbox back to its baseline now, erasing everything added since (tenant admins).",
  description:
    `Erases everything in the organization that is not in the baseline: what visitors added, and what staff added without saving a baseline afterwards. It cannot be undone. confirm must be exactly "${RESET_CONFIRMATION}". With baseline_id, resets to that baseline and puts it in use. People keep their seats and roles. The scheduled reset does the same, by itself, at the hour in the settings.`,
  input: z.strictObject({
    tenant,
    baseline_id: id("baseline").optional().describe("An earlier baseline to go back to; omit it for the one in use."),
    confirm: z.string().describe(`Must be exactly "${RESET_CONFIRMATION}".`),
  }),
  rest: { method: "POST", path: "/sandbox/reset" },
  mcp: { tool: "sandbox", action: "reset" },
  async handler(ctx, input) {
    const sb = sandboxOf(ctx);
    if (input.confirm !== RESET_CONFIRMATION) throw invalid("confirmation_required", `A reset erases everything added since the baseline. Set confirm to exactly "${RESET_CONFIRMATION}".`);
    const done = await resetToBaseline(ctx.db, sb.tenant_id, { baseline_id: input.baseline_id, by: ctx.actor, scheduled: false, idle_days: sb.settings.visitor_idle_days, now: ctx.now, enqueue: ctx.enqueue });
    await ctx.db.updateTable("sandbox_settings").set({ etag: newEtag() }).where("tenant_id", "=", sb.tenant_id).execute();
    await recordActivity(ctx, { action: "reset", entity_type: "sandbox", entity_id: done.baseline_id, entity_title: ctx.scope.tenant!.name, summary: "Reset the sandbox to its baseline" });
    return done;
  },
});

function inviteView(i: { invite_id: string; label: string; max_uses: number; used: number; expires_at: string | null; revoked_at: string | null; created_at: string; created_by: unknown }, now: string) {
  const status = i.revoked_at ? "revoked" : i.expires_at && Date.parse(i.expires_at) < Date.parse(now) ? "expired" : i.used >= i.max_uses ? "full" : "open";
  return { invite_id: i.invite_id, label: i.label, places: i.max_uses, used: i.used, status, expires_at: i.expires_at, revoked_at: i.revoked_at, created_at: i.created_at, created_by: i.created_by };
}

export const listSandboxInvites = defineOperation({
  name: "sandbox.invites",
  scope: "tenant",
  access: "admin",
  mutates: false,
  summary: "The sandbox's invitations, newest first, with how many places each has and how many are taken (tenant admins).",
  description: "status is open, full, expired or revoked. A link is shown once, when its invitation is made; it is not kept and cannot be read back.",
  input: z.strictObject({ tenant }),
  rest: { method: "GET", path: "/sandbox/invites" },
  mcp: { tool: "sandbox", action: "invites" },
  async handler(ctx) {
    const sb = sandboxOf(ctx);
    const rows = await ctx.db.selectFrom("sandbox_invites").selectAll().where("tenant_id", "=", sb.tenant_id).orderBy("invite_id", "desc").limit(200).execute();
    return { items: rows.map((i) => inviteView(i, ctx.now)), seats: { used: await seatsUsed(ctx, sb.tenant_id), limit: sb.settings.max_visitors } };
  },
});

export const createSandboxInvite = defineOperation({
  name: "sandbox.create_invite",
  scope: "tenant",
  access: "admin",
  mutates: true,
  summary: "Make an invitation link that admits a set number of people to the sandbox as visitors (tenant admins).",
  description:
    "Anyone with the link may take one of its places by signing in, whatever their address, and an account that does not exist yet is created for them even where sign-up is otherwise limited. Such an account creates no organization unless an owner of the instance gives its address an allowance. The link is returned once and cannot be read back, so keep it. The sandbox's seats (max_visitors) cap every invitation together.",
  input: z.strictObject({
    tenant,
    label: z.string().trim().min(1).max(100).describe("Where the link is going, for whoever reads the list later: \"Launch post\", \"Workshop, 12 October\"."),
    places: z.number().int().min(1).max(1_000_000).describe("How many people the link admits."),
    expires_in_days: z.number().int().min(1).max(365).optional().describe("Days until the link stops admitting anyone; omit it for a link that does not expire."),
  }),
  rest: { method: "POST", path: "/sandbox/invites" },
  mcp: { tool: "sandbox", action: "create_invite" },
  async handler(ctx, input) {
    const sb = sandboxOf(ctx);
    const code = randomToken(18);
    const invite_id = newId();
    const expires_at = input.expires_in_days ? new Date(Date.parse(ctx.now) + input.expires_in_days * 86400_000).toISOString() : null;
    await ctx.db
      .insertInto("sandbox_invites")
      .values({ invite_id, tenant_id: sb.tenant_id, code_hash: sha256Hex(code), label: input.label, max_uses: input.places, expires_at, created_by: json(ctx.actor) })
      .execute();
    await recordActivity(ctx, { action: "invited", entity_type: "sandbox", entity_id: invite_id, entity_title: input.label, summary: `Made a sandbox invitation for ${input.places} ${input.places === 1 ? "person" : "people"}` });
    const row = await ctx.db.selectFrom("sandbox_invites").selectAll().where("invite_id", "=", invite_id).executeTakeFirstOrThrow();
    const seats = { used: await seatsUsed(ctx, sb.tenant_id), limit: sb.settings.max_visitors };
    return {
      ...inviteView(row, ctx.now),
      invite_link: `${ctx.ports.config.publicBaseUrl}/join/${code}`,
      seats,
      warnings: seats.limit - seats.used < input.places ? [`The sandbox has ${Math.max(0, seats.limit - seats.used)} of its ${seats.limit} seats free, fewer than this invitation's places. Raise max_visitors to admit them all.`] : [],
    };
  },
});

export const revokeSandboxInvite = defineOperation({
  name: "sandbox.revoke_invite",
  scope: "tenant",
  access: "admin",
  mutates: true,
  summary: "Withdraw a sandbox invitation: its link admits nobody else (tenant admins).",
  description: "Visitors it already admitted keep their seats; remove one with sandbox(action=\"remove_visitor\").",
  input: z.strictObject({ tenant, invite_id: id("invitation") }),
  rest: { method: "POST", path: "/sandbox/invites/revoke" },
  mcp: { tool: "sandbox", action: "revoke_invite" },
  async handler(ctx, input) {
    const sb = sandboxOf(ctx);
    const row = await ctx.db.selectFrom("sandbox_invites").selectAll().where("invite_id", "=", input.invite_id).where("tenant_id", "=", sb.tenant_id).forUpdate().executeTakeFirst();
    if (!row) throw notFound("No such invitation in this sandbox.");
    if (!row.revoked_at) {
      await ctx.db.updateTable("sandbox_invites").set({ revoked_at: ctx.now }).where("invite_id", "=", row.invite_id).execute();
      await recordActivity(ctx, { action: "invitation_cancelled", entity_type: "sandbox", entity_id: row.invite_id, entity_title: row.label, summary: "Withdrew a sandbox invitation" });
    }
    return inviteView({ ...row, revoked_at: row.revoked_at ?? ctx.now }, ctx.now);
  },
});

export const listSandboxVisitors = defineOperation({
  name: "sandbox.visitors",
  scope: "tenant",
  access: "admin",
  mutates: false,
  summary: "The sandbox's visitors, newest first, a page at a time: who each is, and the name they write under (tenant admins).",
  description:
    "Only the sandbox's staff see this; a visitor sees no other person. appears_as is the name on what the visitor wrote, so a name in the content leads here. Filter with query, a part of a name, an address or an appears_as code.",
  input: z.strictObject({
    tenant,
    query: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().max(500).optional(),
  }),
  rest: { method: "GET", path: "/sandbox/visitors" },
  mcp: { tool: "sandbox", action: "visitors" },
  async handler(ctx, input) {
    const sb = sandboxOf(ctx);
    let q = ctx.db
      .selectFrom("memberships as m")
      .innerJoin("accounts as a", "a.account_id", "m.account_id")
      .select(["m.membership_id", "m.created_at", "a.account_id", "a.display_name", "a.email"])
      .where("m.tenant_id", "=", sb.tenant_id)
      .where("m.scope_type", "=", "tenant")
      .where("m.role", "=", "visitor");
    const needle = input.query?.toLowerCase().replace(/^visitor\s+/, "");
    if (needle)
      q = q.where((eb) =>
        eb.or([eb(sql<string>`lower(a.display_name)`, "like", `%${needle}%`), eb(sql<string>`lower(a.email)`, "like", `%${needle}%`), eb(VISITOR_CODE_SQL, "=", needle.toUpperCase())]),
      );
    const after = input.cursor ? decodeCursor<string>(input.cursor) : undefined;
    if (input.cursor && !after) throw invalid("invalid_cursor", "That cursor isn’t from this list.");
    if (after) q = q.where("m.membership_id", "<", after);
    const rows = await q.orderBy("m.membership_id", "desc").limit(input.limit + 1).execute();
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((r) => ({ account_id: r.account_id, appears_as: visitorName(sb.tenant_id, r.account_id), display_name: r.display_name, email: r.email, joined_at: r.created_at })),
      next_cursor: rows.length > input.limit ? encodeCursor(page[page.length - 1]!.membership_id) : null,
      seats: { used: await seatsUsed(ctx, sb.tenant_id), limit: sb.settings.max_visitors },
    };
  },
});

export const removeSandboxVisitor = defineOperation({
  name: "sandbox.remove_visitor",
  scope: "tenant",
  access: "admin",
  mutates: true,
  summary: "Take a visitor's seat away: they can no longer open the sandbox (tenant admins).",
  description: "What they wrote stays until the next reset, under the name they wrote it with. They can enter again with an invitation that has a place left.",
  input: z.strictObject({ tenant, account_id: z.string().min(1) }),
  rest: { method: "POST", path: "/sandbox/visitors/remove" },
  mcp: { tool: "sandbox", action: "remove_visitor" },
  async handler(ctx, input) {
    const sb = sandboxOf(ctx);
    const m = await ctx.db
      .selectFrom("memberships")
      .select("membership_id")
      .where("tenant_id", "=", sb.tenant_id)
      .where("scope_type", "=", "tenant")
      .where("role", "=", "visitor")
      .where("account_id", "=", input.account_id)
      .executeTakeFirst();
    if (!m) throw notFound("That account isn’t a visitor in this sandbox.");
    // Every grant they hold here: a visitor given a role on a product as well loses that too.
    await ctx.db.deleteFrom("memberships").where("tenant_id", "=", sb.tenant_id).where("account_id", "=", input.account_id).execute();
    const appears_as = visitorName(sb.tenant_id, input.account_id);
    await recordActivity(ctx, { action: "revoked", entity_type: "sandbox", entity_id: input.account_id, entity_title: appears_as, summary: "Removed a visitor from the sandbox" });
    return { removed: true, account_id: input.account_id, appears_as, seats: { used: await seatsUsed(ctx, sb.tenant_id), limit: sb.settings.max_visitors } };
  },
});

export const sandboxOps = [
  sandboxStatus, joinSandbox, sandboxSettings, updateSandboxSettings, saveSandboxBaseline, listSandboxBaselines, resetSandbox,
  listSandboxInvites, createSandboxInvite, revokeSandboxInvite, listSandboxVisitors, removeSandboxVisitor,
];
