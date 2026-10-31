import { parserFor } from "@whatbuild/parsers";
import { sql } from "kysely";
import type { ActorSnapshot, Db } from "./db.ts";
import { AppError, conflict, rateLimited, tooLarge } from "./errors.ts";
import { mediaTypeFor } from "./media.ts";
import type { OperationDef, Principal, Scope } from "./registry.ts";

/**
 * Plans, and the limits each one sets on how often and how much people work in an organization.
 *
 * - Every organization is on one plan, and a plan belongs to one organization: a second
 *   organization is a second plan.
 * - Limits belong to a plan, never to one organization. The deployment defines its plans and every
 *   limit each sets (`WHATBUILD_PLANS`, `plans.ts`); on `unlimited`, which this WhatBuild's own
 *   organizations and every organization of a deployment that defines no plans are on, nobody meets
 *   any. Only an instance owner moves an organization to another plan.
 * - Everyone in an organization meets its plan's limits, its owners included. A guest of the example
 *   organization meets only the guests' calls a minute and bytes downloaded a day.
 * - A day's use is counted on every plan, so an organization moved to a plan during a day meets what
 *   that day already used. The minute's counters are kept only where someone meets them.
 * - Limits are read here and enforced in `execute`, so REST and MCP cannot differ.
 */

export {
  configurePlans, defaultPlans, definedPlans, GUEST_DEFAULTS, GUEST_FIELDS, guestLimits, isDefinedPlan, LIMITS, PLAN_ID, planCatalogue, planName, UNLIMITED,
  type GuestKey, type GuestSettings, type LimitInfo, type LimitKey, type Limits, type Plan, type PlanDefinition, type PlanEntry, type PlanSetting, type PlanSettings,
} from "./plans.ts";
import { guestLimits, UNLIMITED, type LimitKey, type Limits, type Plan } from "./plans.ts";
import { readGuests, readPlans } from "./settings.ts";

const MiB = 1024 * 1024;

// ---- The organization a call is in --------------------------------------------------------------

/** A day, for the daily limits: from midnight UTC to the next. */
export function dayOf(now: Date): { day_start: string; day_end: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { day_start: new Date(start).toISOString(), day_end: new Date(start + 86_400_000).toISOString() };
}

export interface LimitState {
  tenant_id: string;
  plan: Plan;
  /** The organization is on a plan the deployment no longer defines: it meets no limit until it is moved. */
  undefined_plan?: true;
  /** The plan's limits; null on the unlimited plan, or one the deployment no longer defines. */
  limits: Limits | null;
  /** Guards `products.set_plan`; null until an instance owner first moves the organization. */
  etag: string | null;
  changed_at: string | null;
  changed_by: ActorSnapshot | null;
  /** Midnight UTC today: where the day's allowances began. */
  day_start: string;
  /** Midnight UTC tomorrow: when they start again. */
  day_end: string;
}

export interface LimitContext extends Omit<LimitState, "limits"> {
  /** What the call meets: its plan's limits, or for a guest the free plan's calls a minute. */
  limits: Limits;
  /** A guest of the example organization, who meets only the limit on calls a minute. */
  guest: boolean;
}

export async function loadLimits(db: Db, tenantId: string, now = new Date()): Promise<LimitState> {
  const row = await db
    .selectFrom("tenants")
    .select(["tenant_id", "plan", "plan_etag", "plan_changed_at", "plan_changed_by"])
    .where("tenant_id", "=", tenantId)
    .executeTakeFirstOrThrow();
  const plan = row.plan as Plan;
  const limits = plan === UNLIMITED ? null : ((await readPlans(db))[plan]?.limits ?? null);
  return {
    tenant_id: row.tenant_id,
    plan,
    ...(plan !== UNLIMITED && !limits ? { undefined_plan: true as const } : {}),
    limits,
    etag: row.plan_etag,
    changed_at: row.plan_changed_at,
    changed_by: row.plan_changed_by,
    ...dayOf(now),
  };
}

/**
 * The limits a call meets, if any: everyone's on a plan with limits, and a guest's in the example,
 * whose calls a minute and downloads a day are the guests' settings.
 */
export async function limitsFor(db: Db, scope: Pick<Scope, "tenant" | "tenantRole">): Promise<LimitContext | null> {
  if (!scope.tenant) return null;
  const guest = scope.tenantRole === "guest";
  if (!guest && scope.tenant.plan === UNLIMITED) return null;
  const state = await loadLimits(db, scope.tenant.tenant_id);
  if (guest) return { ...state, limits: guestLimits(await readGuests(db)), guest };
  return state.limits ? { ...state, limits: state.limits, guest } : null;
}

/** Where a day's use is counted: an organization's day, whatever its plan. */
export type Tally = Pick<LimitState, "tenant_id" | "day_start">;

export function tallyOf(tenantId: string, now = new Date()): Tally {
  return { tenant_id: tenantId, day_start: dayOf(now).day_start };
}

// ---- Counters -----------------------------------------------------------------------------------

/** The organization's own counters sit under this account id. */
const ORG = "";

type Counter = "requests" | "writes" | "sources" | "exports" | "bytes" | "sent";

/** Add to counters and return their new values, keyed `<account>:<counter>`. */
async function bump(db: Db, tenantId: string, bucket: "minute" | "day", startsAt: string, adds: { account_id: string; counter: Counter; by: number }[]): Promise<Map<string, number>> {
  if (!adds.length) return new Map();
  const rows = await db
    .insertInto("limit_counters")
    .values(adds.map((a) => ({ tenant_id: tenantId, account_id: a.account_id, bucket, starts_at: startsAt, counter: a.counter, n: a.by })))
    .onConflict((oc) => oc.columns(["tenant_id", "account_id", "bucket", "starts_at", "counter"]).doUpdateSet({ n: sql<number>`limit_counters.n + excluded.n` }))
    .returning(["account_id", "counter", "n"])
    .execute();
  return new Map(rows.map((r) => [`${r.account_id}:${r.counter}`, Number(r.n)]));
}

/** What a person, and the organization, have used today. */
export async function usageToday(db: Db, state: Pick<LimitState, "tenant_id" | "day_start">, accountId: string) {
  const rows = await db
    .selectFrom("limit_counters")
    .select(["account_id", "counter", "n"])
    .where("tenant_id", "=", state.tenant_id)
    .where("bucket", "=", "day")
    .where("starts_at", "=", state.day_start)
    .where("account_id", "in", [accountId, ORG])
    .execute();
  const of = (account: string, counter: Counter) => Number(rows.find((r) => r.account_id === account && r.counter === counter)?.n ?? 0);
  return {
    writes: of(accountId, "writes"),
    sources: of(accountId, "sources"),
    exports: of(accountId, "exports"),
    bytes: of(accountId, "bytes"),
    sent: of(accountId, "sent"),
    org_writes: of(ORG, "writes"),
    org_bytes: of(ORG, "bytes"),
  };
}

/** What everyone together has used today, and how many people wrote: for the control panel. */
export async function organizationToday(db: Db, state: Pick<LimitState, "tenant_id" | "day_start">) {
  const usage = await db
    .selectFrom("limit_counters")
    .select(["counter", (eb) => eb.fn.sum<number>("n").as("n"), (eb) => eb.fn.count<number>("account_id").as("accounts")])
    .where("tenant_id", "=", state.tenant_id)
    .where("bucket", "=", "day")
    .where("starts_at", "=", state.day_start)
    .where("account_id", "!=", ORG)
    .groupBy("counter")
    .execute();
  const total = (counter: string) => Number(usage.find((u) => u.counter === counter)?.n ?? 0);
  return {
    people_writing: Number(usage.find((u) => u.counter === "writes")?.accounts ?? 0),
    writes: total("writes"),
    sources: total("sources"),
    exports: total("exports"),
    bytes: total("bytes"),
  };
}

// ---- Enforcement --------------------------------------------------------------------------------

const restricted = (message: string, details?: Record<string, unknown>) => new AppError(403, "plan_restricted", message, details);

/** Where the limits come from, for a refusal: the free plan, or the example organization. */
const HERE = (lc: Pick<LimitContext, "guest">) => (lc.guest ? "The example organization" : "This organization's plan");

/** `used` is what the day had used before the refused call; `asked`, when one call takes several, how many it would have taken. */
function quota(lc: LimitContext, name: LimitKey, used: number, unit: string, what: string, asked = 1) {
  const limit = lc.limits[name] as number;
  const left = Math.max(0, limit - used);
  const batch = asked > 1 ? `, and this call would add ${asked} with ${left} left today` : "";
  return conflict("quota_exceeded", `${HERE(lc)} allows ${what}${batch}. The allowance starts again at ${lc.day_end}. Reading, searching and what is already here are unaffected.`, {
    quota: name, limit, used, unit, resets_at: lc.day_end,
  });
}

/**
 * Operations counted against a daily allowance beyond the count of writes, and what one call takes
 * from it: one, unless `takes` says how many its input adds.
 */
const DAILY: Record<string, { counter: Counter; setting: LimitKey; unit: string; what: (n: number) => string; takes?: (input: unknown) => number }> = {
  "sources.create": { counter: "sources", setting: "sources_per_day", unit: "sources", what: (n) => `each person ${n} new sources a day` },
  "attachments.create_upload": { counter: "sources", setting: "sources_per_day", unit: "sources", what: (n) => `each person ${n} new sources a day` },
  // Each source in the batch is a source added.
  "attachments.create_uploads": {
    counter: "sources", setting: "sources_per_day", unit: "sources", what: (n) => `each person ${n} new sources a day`,
    takes: (input) => Math.max(1, (input as { sources?: unknown[] } | null)?.sources?.length ?? 1),
  },
  "sources.copy_to_product": { counter: "sources", setting: "sources_per_day", unit: "sources", what: (n) => `each person ${n} new sources a day` },
  "products.export": { counter: "exports", setting: "exports_per_day", unit: "exports", what: (n) => `each person ${n} exports a day` },
};

/** What a daily allowance set to 0 switches off, for a person. */
const OFF: Partial<Record<LimitKey, string>> = {
  writes_per_day: "Writing",
  org_writes_per_day: "Writing",
  sources_per_day: "Adding sources",
  exports_per_day: "Exporting a product",
  bytes_per_day: "Uploading files",
  org_bytes_per_day: "Uploading files",
};

function off(setting: LimitKey) {
  return restricted(`${OFF[setting]!} is off on this organization's plan. Reading and searching still work; whoever runs this WhatBuild can change the plan.`, { setting, limit: 0 });
}

/**
 * A daily allowance set to 0 is not used up, it is switched off: the call is refused as something
 * the plan does not allow (`403 plan_restricted`), never as an allowance that starts again tomorrow.
 * A Story preview asks it as a write, so it is refused wherever publishing would be.
 */
export function refuseSwitchedOff(lc: LimitContext, op: Pick<OperationDef, "name" | "mutates">): void {
  const s = lc.limits;
  if (lc.guest || !op.mutates) return;
  if (op.name !== "products.export") {
    if (s.writes_per_day === 0) throw off("writes_per_day");
    if (s.org_writes_per_day === 0) throw off("org_writes_per_day");
  }
  const daily = DAILY[op.name];
  if (daily && s[daily.setting] === 0) throw off(daily.setting);
}

/**
 * What a call meets before anything else runs: what the plan switches off, and how often anyone may
 * call. A refused call still counts as a call.
 */
export async function admitCall(db: Db, lc: LimitContext, principal: Principal, op: Pick<OperationDef, "name" | "mutates">): Promise<void> {
  const s = lc.limits;
  refuseSwitchedOff(lc, op);
  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const adds: { account_id: string; counter: Counter; by: number }[] = [{ account_id: principal.account_id, counter: "requests", by: 1 }];
  if (op.mutates && !lc.guest) adds.push({ account_id: principal.account_id, counter: "writes", by: 1 });
  const n = await bump(db, lc.tenant_id, "minute", minute, adds);
  const over = (used: number | undefined, limit: number) => (used ?? 0) > limit;
  if (over(n.get(`${principal.account_id}:requests`), s.requests_per_minute))
    throw rateLimited(`${HERE(lc)} allows each person ${s.requests_per_minute} calls a minute. Wait for the next minute, then carry on.`, { limit: s.requests_per_minute, per: "minute", retry_after_seconds: 60 - new Date().getUTCSeconds() });
  if (op.mutates && !lc.guest && over(n.get(`${principal.account_id}:writes`), s.writes_per_minute))
    throw rateLimited(`${HERE(lc)} allows each person ${s.writes_per_minute} writes a minute. Wait for the next minute, then carry on; reads are unaffected.`, { limit: s.writes_per_minute, per: "minute", retry_after_seconds: 60 - new Date().getUTCSeconds() });
}

/**
 * The limits on how much one call carries, checked on the validated input: the longest text a
 * field may hold, and how many sources one call may name.
 */
export function checkInput(lc: LimitContext, op: Pick<OperationDef, "name">, input: unknown): void {
  if (lc.guest) return;
  const s = lc.limits;
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (value.length > s.text_max_chars)
        throw tooLarge(`${path} holds ${value.length} characters; this organization's plan takes at most ${s.text_max_chars} in one field. Send less, or split it.`, { field: path, limit: s.text_max_chars, unit: "characters" });
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(input, "");
  const ids = (input as { record_ids?: unknown } | null)?.record_ids;
  if (Array.isArray(ids) && ids.length > s.batch_max)
    throw tooLarge(`${op.name} names ${ids.length} sources; this organization's plan takes at most ${s.batch_max} in one call. Send them in smaller groups.`, { field: "record_ids", limit: s.batch_max, unit: "sources" });
}

/**
 * The daily allowances, counted inside the operation's own transaction: a call that is refused, or
 * that fails, takes nothing from them. They are counted at `at` on every plan, and refused only
 * where the call meets limits (`lc`). `input` is the call's validated input, for an operation that
 * adds several of what an allowance counts.
 */
export async function countWrite(trx: Db, at: Tally, lc: LimitContext | null, principal: Principal, op: Pick<OperationDef, "name" | "mutates">, input?: unknown): Promise<void> {
  if (lc?.guest || !op.mutates) return;
  const me = principal.account_id;
  const daily = DAILY[op.name];
  const takes = daily?.takes ? daily.takes(input) : 1;
  const n = await bump(trx, at.tenant_id, "day", at.day_start, [
    { account_id: me, counter: "writes", by: 1 },
    { account_id: ORG, counter: "writes", by: 1 },
    ...(daily ? [{ account_id: me, counter: daily.counter, by: takes }] : []),
  ]);
  if (!lc) return;
  const s = lc.limits;
  // An export is counted, and never stopped by the allowance of writes: it is how someone leaves with their work.
  if (op.name !== "products.export") {
    const mine = n.get(`${me}:writes`) ?? 0;
    if (mine > s.writes_per_day) throw quota(lc, "writes_per_day", mine - 1, "writes", `each person ${s.writes_per_day} writes a day`);
    const all = n.get(`${ORG}:writes`) ?? 0;
    if (all > s.org_writes_per_day) throw quota(lc, "org_writes_per_day", all - 1, "writes", `${s.org_writes_per_day} writes a day from everyone together`);
  }
  if (daily) {
    const used = n.get(`${me}:${daily.counter}`) ?? 0;
    const limit = s[daily.setting] as number;
    if (used > limit) throw quota(lc, daily.setting, used - takes, daily.unit, daily.what(limit), takes);
  }
}

/**
 * What an upload may be, decided before a grant is issued: the type, the size of the one file, and
 * the bytes left in today's allowances. Returns the most bytes the grant may take.
 */
export async function uploadLimit(trx: Db, lc: LimitContext, accountId: string, file: { path: string; media_type?: string | null | undefined; size?: number | undefined }, fileMaxBytes: number): Promise<number> {
  const s = lc.limits;
  if (s.documents_only && !parserFor(file.path, mediaTypeFor(file.path, file.media_type)))
    throw restricted(`This organization's plan takes only files its parsers read: text, Markdown, transcripts (VTT, SRT), HTML, Word (DOC, DOCX), PDF, spreadsheets and XML. ${file.path} is not one of them.`, { path: file.path });
  if (s.bytes_per_day === 0) throw off("bytes_per_day");
  if (s.org_bytes_per_day === 0) throw off("org_bytes_per_day");
  const used = await usageToday(trx, lc, accountId);
  const left = await storageLeft(trx, lc);
  if (left <= 0)
    throw conflict("quota_exceeded", `This organization's plan keeps ${sizeWords(s.storage_max_bytes!)}, and it is full. Delete what is no longer needed to make room (archiving keeps it), or ask whoever runs this WhatBuild to move the organization to a larger plan.`, {
      quota: "storage_max_bytes", limit: s.storage_max_bytes, used: s.storage_max_bytes, unit: "bytes",
    });
  if (used.bytes >= s.bytes_per_day) throw quota(lc, "bytes_per_day", used.bytes, "bytes", `each person ${s.bytes_per_day} bytes of uploads a day`);
  if (used.org_bytes >= s.org_bytes_per_day) throw quota(lc, "org_bytes_per_day", used.org_bytes, "bytes", `${s.org_bytes_per_day} bytes of uploads a day from everyone together`);
  const daily = Math.min(s.bytes_per_day - used.bytes, s.org_bytes_per_day - used.org_bytes);
  const limit = Math.min(fileMaxBytes, s.file_max_bytes, daily, left);
  if (file.size !== undefined && file.size > limit)
    throw tooLarge(
      file.size > Math.min(fileMaxBytes, s.file_max_bytes)
        ? `The file is ${file.size} bytes; this organization's plan takes files of at most ${Math.min(fileMaxBytes, s.file_max_bytes)} bytes.`
        : left < daily
          ? `The file is ${file.size} bytes, and the organization's plan has ${left} bytes of storage left. Delete what is no longer needed to make room.`
          : `The file is ${file.size} bytes, and ${limit} bytes are left in today's upload allowance, which starts again at ${lc.day_end}.`,
      { limit },
    );
  return limit;
}

/**
 * Count bytes about to be sent to a person (an attachment, an export, a mockup's download) against
 * their day, on every plan, refusing them first where the plan caps what it sends each person a day.
 * An export is counted and never refused (`refuse` false): taking everything out always works. A
 * guest of the example organization meets the guests' downloads a day.
 */
export async function countSent(db: Db, at: Tally, lc: LimitContext | null, accountId: string, bytes: number, refuse = true): Promise<void> {
  const limit = refuse && lc ? lc.limits.sent_bytes_per_day : null;
  if (limit !== null && lc) {
    const used = (await usageToday(db, at, accountId)).sent;
    if (used + bytes > limit)
      throw conflict(
        "quota_exceeded",
        `${HERE(lc)} sends each person ${sizeWords(limit)} a day of attachments, exports and downloads; ${sizeWords(Math.max(0, limit - used))} is left today, and this is ${sizeWords(bytes)}. It starts again at ${lc.day_end}. Reading in the app, searching and the rest are unaffected.`,
        { quota: "sent_bytes_per_day", limit, used, unit: "bytes", resets_at: lc.day_end },
      );
  }
  await bump(db, at.tenant_id, "day", at.day_start, [{ account_id: accountId, counter: "sent", by: bytes }]);
}

/** Count an attached file against today's upload allowances, on every plan. */
export async function countBytes(trx: Db, at: Tally, accountId: string, size: number): Promise<void> {
  await bump(trx, at.tenant_id, "day", at.day_start, [
    { account_id: accountId, counter: "bytes", by: size },
    { account_id: ORG, counter: "bytes", by: size },
  ]);
}

export function mayFetchUrl(lc: LimitContext): void {
  if (!lc.limits.fetch_url)
    throw restricted(`Fetching a file from a URL is off on this organization's plan. Download the file yourself and upload it with attachments_write(action="request_upload").`);
}

// ---- What an organization holds -----------------------------------------------------------------

export interface Holdings {
  /** People with a role above reading the Story, anywhere in the organization. */
  members: number;
  /** Invitations to more than reading the Story, not yet accepted, to someone not already counted: each holds a place. */
  invited: number;
  /** Products not archived. */
  products: number;
  /** Sources not archived. */
  sources: number;
  /** Bytes kept: files, and text as it is stored, every version of each. */
  storage: { files: number; text: number; total: number };
}

/** Sum of a column's stored size (pg_column_size reads no TOAST data) over an organization's rows. */
function stored(table: string, columns: string[]) {
  return sql<number>`(SELECT coalesce(sum(${sql.raw(columns.map((c) => `coalesce(pg_column_size(${c}), 0)`).join(" + "))}), 0) FROM ${sql.table(table)} WHERE tenant_id = t.tenant_id)`;
}

/**
 * What an organization holds against its plan's totals. Files are every attachment version, the
 * text read from each and the distinct files of mockup prototypes; text is what is written, as the
 * database stores it, every version kept. Archiving keeps all of it; only deleting frees it.
 */
export async function holdingsOf(db: Db, tenantId: string): Promise<Holdings> {
  const row = await db
    .selectFrom("tenants as t")
    .select([
      sql<number>`(SELECT count(DISTINCT account_id) FROM memberships WHERE tenant_id = t.tenant_id AND role <> 'reader')`.as("members"),
      sql<number>`(SELECT count(DISTINCT lower(i.email)) FROM invitations i WHERE i.tenant_id = t.tenant_id AND i.role <> 'reader' AND i.accepted_at IS NULL AND i.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM accounts a JOIN memberships m ON m.account_id = a.account_id AND m.tenant_id = t.tenant_id AND m.role <> 'reader' WHERE lower(a.email) = lower(i.email)))`.as("invited"),
      sql<number>`(SELECT count(*) FROM products WHERE tenant_id = t.tenant_id AND archived_at IS NULL)`.as("products"),
      sql<number>`(SELECT count(*) FROM records WHERE tenant_id = t.tenant_id AND archived_at IS NULL)`.as("sources"),
      sql<number>`(SELECT coalesce(sum(size), 0) FROM (SELECT DISTINCT blob_key, size FROM file_versions WHERE tenant_id = t.tenant_id) f)
        + (SELECT coalesce(sum(text_chars), 0) FROM derivations WHERE tenant_id = t.tenant_id)
        + (SELECT coalesce(sum(size), 0) FROM (SELECT DISTINCT blob_key, size FROM mockup_prototype_files WHERE tenant_id = t.tenant_id) p)`.as("files"),
      sql<number>`${stored("source_texts", ["content"])}
        + ${stored("agent_notes", ["content"])}
        + ${stored("annotations", ["note"])}
        + ${stored("story_versions", ["html"])}
        + ${stored("mockup_pages", ["html", "notes"])}
        + ${stored("mockup_files", ["content"])}
        + ${stored("register_entries", ["statement", "body"])}
        + ${stored("outcomes", ["description", "card_html"])}
        + ${stored("revisions", ["content"])}`.as("text"),
    ])
    .where("t.tenant_id", "=", tenantId)
    .executeTakeFirstOrThrow();
  const files = Number(row.files), text = Number(row.text);
  return { members: Number(row.members), invited: Number(row.invited), products: Number(row.products), sources: Number(row.sources), storage: { files, text, total: files + text } };
}

// ---- The totals a plan sets ---------------------------------------------------------------------

/** A write's text larger than this meets the storage total; a smaller one (a title, a review, a tag) never does. */
const STORAGE_CHECKED_FROM = 4096;

/** How many UTF-8 bytes of text a call's input carries. */
function textBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + textBytes(v), 0);
  if (value && typeof value === "object") return Object.values(value).reduce<number>((n, v) => n + textBytes(v), 0);
  return 0;
}

/** Operations that never add to what an organization holds, whatever text they carry: leaving, tidying, taking out. */
const NEVER_ADDS = /\.(archive|archive_page|restore_page|delete|delete_page|delete_annotation|revoke|cancel_invitation|export|set_hierarchy|review|link|unlink|remove_account|set_plan)$/;

/** What an operation adds to a total, read from its validated input. */
const ADDS: Record<string, { products?: number; sources?: (input: Record<string, unknown>) => number }> = {
  "products.create": { products: 1 },
  "products.restore": { products: 1 },
  "sources.create": { sources: () => 1 },
  "attachments.create_upload": { sources: () => 1 },
  "attachments.create_uploads": { sources: (i) => Math.max(1, (i["sources"] as unknown[] | undefined)?.length ?? 1) },
  "sources.copy_to_product": { sources: () => 1 },
  "sources.restore": { sources: (i) => (i["record_ids"] as unknown[] | undefined)?.length ?? 1 },
};

/** How to make room under each total. */
const ROOM: Partial<Record<LimitKey, string>> = {
  members_max: "Remove someone or cancel an invitation to make room",
  products_max: "Archive a product to make room",
  sources_max: "Archive sources that are no longer needed to make room",
  storage_max_bytes: "Delete what is no longer needed to make room (archiving keeps it)",
};

function overTotal(lc: LimitContext, name: LimitKey, used: number, unit: string, message: string) {
  return conflict("quota_exceeded", `${message} ${ROOM[name] ?? "Make room"}, or ask whoever runs this WhatBuild to move the organization to a larger plan. Reading, searching and export are unaffected.`, {
    quota: name, limit: lc.limits[name], used, unit,
  });
}

const sizeWords = (n: number) => (n >= 1024 * MiB ? `${+(n / (1024 * MiB)).toFixed(1)} GB` : `${+(n / MiB).toFixed(1)} MB`);

/**
 * The totals of the organization's plan: refused when the call would take the organization past
 * one. Runs in the operation's transaction, after the tenant row is locked, so two calls at once
 * cannot both take the last place. Products and sources that are archived don't count, so archiving
 * makes room; storage counts everything kept, so only deleting frees it.
 */
export async function checkTotals(trx: Db, lc: LimitContext, op: Pick<OperationDef, "name" | "mutates">, input: Record<string, unknown>): Promise<void> {
  if (lc.guest || !op.mutates || NEVER_ADDS.test(op.name)) return;
  const s = lc.limits;
  const adds = ADDS[op.name];
  const incoming = textBytes(input);
  const storage = s.storage_max_bytes !== null && incoming > STORAGE_CHECKED_FROM;
  const products = adds?.products && s.products_max !== null;
  const sources = adds?.sources && s.sources_max !== null;
  if (!storage && !products && !sources) return;
  await trx.selectFrom("tenants").select("tenant_id").where("tenant_id", "=", lc.tenant_id).forUpdate().execute();
  const h = await holdingsOf(trx, lc.tenant_id);
  if (products && h.products + adds!.products! > s.products_max!)
    throw overTotal(lc, "products_max", h.products, "products", `This organization's plan allows ${s.products_max === 1 ? "1 product that isn't archived" : `${s.products_max} products that aren't archived`}, and it has ${h.products}.`);
  if (sources) {
    const n = adds!.sources!(input);
    if (h.sources + n > s.sources_max!)
      throw overTotal(lc, "sources_max", h.sources, "sources", `This organization's plan allows ${s.sources_max === 1 ? "1 source that isn't archived" : `${s.sources_max} sources that aren't archived`}; it has ${h.sources}${n > 1 ? `, and this call would add ${n}` : ""}.`);
  }
  if (storage && h.storage.total + incoming > s.storage_max_bytes!)
    throw overTotal(lc, "storage_max_bytes", h.storage.total, "bytes", `This organization's plan keeps ${sizeWords(s.storage_max_bytes!)}, and it holds ${sizeWords(h.storage.total)}, so this ${sizeWords(incoming)} doesn't fit.`);
}

/**
 * The people a plan allows: refused when giving someone a role, or inviting them, would take the
 * organization past them. A pending invitation holds its place until it is accepted, declined,
 * cancelled or runs out; someone already in the organization, and a reader of the Story, take none.
 */
export async function checkMembers(trx: Db, lc: LimitContext | null, email: string, role: string): Promise<void> {
  if (!lc || lc.guest || lc.limits.members_max === null || role === "reader") return;
  await trx.selectFrom("tenants").select("tenant_id").where("tenant_id", "=", lc.tenant_id).forUpdate().execute();
  const row = await trx
    .selectFrom("tenants as t")
    .select([
      sql<number>`(SELECT count(DISTINCT m.account_id) FROM memberships m WHERE m.tenant_id = t.tenant_id AND m.role <> 'reader')`.as("members"),
      sql<number>`(SELECT count(DISTINCT lower(i.email)) FROM invitations i WHERE i.tenant_id = t.tenant_id AND i.role <> 'reader' AND i.accepted_at IS NULL AND i.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM accounts a JOIN memberships m ON m.account_id = a.account_id AND m.tenant_id = t.tenant_id AND m.role <> 'reader' WHERE lower(a.email) = lower(i.email)))`.as("invited"),
      sql<boolean>`EXISTS (SELECT 1 FROM accounts a JOIN memberships m ON m.account_id = a.account_id AND m.tenant_id = t.tenant_id AND m.role <> 'reader' WHERE lower(a.email) = lower(${email}))
        OR EXISTS (SELECT 1 FROM invitations i WHERE i.tenant_id = t.tenant_id AND i.role <> 'reader' AND i.accepted_at IS NULL AND i.expires_at > now() AND lower(i.email) = lower(${email}))`.as("counted"),
    ])
    .where("t.tenant_id", "=", lc.tenant_id)
    .executeTakeFirstOrThrow();
  if (row.counted) return;
  const used = Number(row.members) + Number(row.invited);
  if (used >= lc.limits.members_max)
    throw overTotal(lc, "members_max", used, "people", `This organization's plan allows ${lc.limits.members_max} ${lc.limits.members_max === 1 ? "person" : "people"}, and ${used === Number(row.members) ? `it has ${used}` : `it has ${row.members} and ${Number(row.invited)} invited`}. Readers of the Story don't count: invite them as readers.`);
}

/** The bytes of storage left on the organization's plan, for an upload grant; Infinity where it sets none. */
export async function storageLeft(trx: Db, lc: LimitContext): Promise<number> {
  if (lc.guest || lc.limits.storage_max_bytes === null) return Infinity;
  const h = await holdingsOf(trx, lc.tenant_id);
  return Math.max(0, lc.limits.storage_max_bytes - h.storage.total);
}
