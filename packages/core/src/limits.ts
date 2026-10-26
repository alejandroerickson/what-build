import { parserFor } from "@whatbuild/parsers";
import { sql } from "kysely";
import { z } from "zod";
import type { ActorSnapshot, Db } from "./db.ts";
import { AppError, conflict, rateLimited, tooLarge } from "./errors.ts";
import { mediaTypeFor } from "./media.ts";
import type { OperationDef, Principal, Scope } from "./registry.ts";

/**
 * Limits on how often and how much people work in an organization on the free plan.
 *
 * - Every organization has a plan. On `free`, everyone in it meets these limits, its owners
 *   included; on `unlimited`, nobody does.
 * - The free plan's values are `FREE_LIMITS`. An instance owner may change any of them for one
 *   organization; the change is stored on the tenant, and an organization's owners cannot make it.
 * - A guest of the example organization meets only the limit on calls a minute.
 * - Limits are read here and enforced in `execute`, so REST and MCP cannot differ.
 */

export type Plan = "free" | "unlimited";
export const PLANS: Plan[] = ["free", "unlimited"];

const MiB = 1024 * 1024;

const count = (max: number) => z.number().int().min(0).max(max);

/** Every limit, without its default, so an update changes only what it names. */
const FIELDS = {
  requests_per_minute: count(100_000),
  writes_per_minute: count(100_000),
  writes_per_day: count(10_000_000),
  sources_per_day: count(1_000_000),
  exports_per_day: count(10_000),
  org_writes_per_day: count(1_000_000_000),
  file_max_bytes: count(1024 * MiB),
  bytes_per_day: count(1024 * 1024 * MiB),
  org_bytes_per_day: count(1024 * 1024 * MiB),
  text_max_chars: count(1_000_000),
  batch_max: count(200),
  fetch_url: z.boolean(),
  documents_only: z.boolean(),
} as const;

export type Limits = { [K in keyof typeof FIELDS]: z.output<(typeof FIELDS)[K]> };
export type LimitKey = keyof Limits;

/** The free plan's limits, for an organization whose limits an instance owner has not changed. */
export const FREE_LIMITS: Limits = {
  requests_per_minute: 120,
  writes_per_minute: 30,
  writes_per_day: 500,
  sources_per_day: 25,
  exports_per_day: 5,
  org_writes_per_day: 2_000,
  file_max_bytes: 10 * MiB,
  bytes_per_day: 100 * MiB,
  org_bytes_per_day: 250 * MiB,
  text_max_chars: 200_000,
  batch_max: 25,
  fetch_url: true,
  documents_only: true,
};

/** What `products.set_limits` accepts: any of the limits, and nothing else. */
export const limitsPatch = z.strictObject(FIELDS).partial();

/** Stored limits as the application reads them: a missing or unreadable value is the free plan's. */
export function readLimits(stored: unknown): Limits {
  const given = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...FREE_LIMITS };
  for (const key of Object.keys(FIELDS) as LimitKey[]) {
    if (given[key] === undefined) continue;
    const parsed = FIELDS[key].safeParse(given[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Limits;
}

/** Only the limits that differ from the free plan's: what is stored. */
export function changedFromFree(limits: Limits): Partial<Limits> {
  return Object.fromEntries((Object.keys(FIELDS) as LimitKey[]).filter((k) => limits[k] !== FREE_LIMITS[k]).map((k) => [k, limits[k]])) as Partial<Limits>;
}

export interface LimitInfo {
  key: LimitKey;
  group: "frequency" | "size" | "switch";
  label: string;
  /** What one unit is, for a person: "calls", "bytes". */
  unit: string;
  /** What the limit is counted over. */
  per: "Each person, each minute" | "Each person, each day" | "Everyone together, each day" | "Each file" | "Each text field" | "Each call" | "Each person";
  /** The error a caller over the limit receives. */
  refusal: string;
  help: string;
}

/** Every limit, in the order the control panel shows them. */
export const LIMITS: LimitInfo[] = [
  { key: "requests_per_minute", group: "frequency", label: "Calls", unit: "calls", per: "Each person, each minute", refusal: "429 rate_limited", help: "Every call a person or their agent makes, reads included." },
  { key: "writes_per_minute", group: "frequency", label: "Writes", unit: "writes", per: "Each person, each minute", refusal: "429 rate_limited", help: "Calls that change something." },
  { key: "writes_per_day", group: "frequency", label: "Writes", unit: "writes", per: "Each person, each day", refusal: "409 quota_exceeded", help: "A day runs from midnight to midnight UTC. 0 switches writing off." },
  { key: "sources_per_day", group: "frequency", label: "Sources added", unit: "sources", per: "Each person, each day", refusal: "409 quota_exceeded", help: "Sources created or copied in, a batch counted source by source. 0 switches it off." },
  { key: "exports_per_day", group: "frequency", label: "Exports", unit: "exports", per: "Each person, each day", refusal: "409 quota_exceeded", help: "0 switches exports off." },
  { key: "org_writes_per_day", group: "frequency", label: "Writes", unit: "writes", per: "Everyone together, each day", refusal: "409 quota_exceeded", help: "Everyone's writes added up. 0 switches writing off." },
  { key: "file_max_bytes", group: "size", label: "File size", unit: "bytes", per: "Each file", refusal: "413 too_large", help: "Checked as the file uploads." },
  { key: "bytes_per_day", group: "size", label: "Uploads", unit: "bytes", per: "Each person, each day", refusal: "409 quota_exceeded", help: "Counted when a file is attached. 0 switches uploads off." },
  { key: "org_bytes_per_day", group: "size", label: "Uploads", unit: "bytes", per: "Everyone together, each day", refusal: "409 quota_exceeded", help: "Everyone's uploads added up. 0 switches uploads off." },
  { key: "text_max_chars", group: "size", label: "Text in one field", unit: "characters", per: "Each text field", refusal: "413 too_large", help: "The longest body, note or Story page one call may send." },
  { key: "batch_max", group: "size", label: "Sources in one call", unit: "sources", per: "Each call", refusal: "413 too_large", help: "How many sources one archive or restore call may name." },
  { key: "fetch_url", group: "switch", label: "Fetching a file from a URL", unit: "", per: "Each person", refusal: "403 plan_restricted", help: "Off stops the server fetching links." },
  { key: "documents_only", group: "switch", label: "Uploads limited to formats the parsers read", unit: "", per: "Each person", refusal: "403 plan_restricted", help: "On allows only text, Markdown, transcripts, HTML, Word, PDF, spreadsheets and XML." },
];

// ---- The organization a call is in --------------------------------------------------------------

/** A day, for the daily limits: from midnight UTC to the next. */
export function dayOf(now: Date): { day_start: string; day_end: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { day_start: new Date(start).toISOString(), day_end: new Date(start + 86_400_000).toISOString() };
}

export interface LimitState {
  tenant_id: string;
  plan: Plan;
  limits: Limits;
  /** Guards `products.set_limits`; null until an instance owner first changes the limits. */
  etag: string | null;
  updated_at: string | null;
  updated_by: ActorSnapshot | null;
  /** Midnight UTC today: where the day's allowances began. */
  day_start: string;
  /** Midnight UTC tomorrow: when they start again. */
  day_end: string;
}

export interface LimitContext extends LimitState {
  /** A guest of the example organization, who meets only the limit on calls a minute. */
  guest: boolean;
}

export async function loadLimits(db: Db, tenantId: string, now = new Date()): Promise<LimitState> {
  const row = await db
    .selectFrom("tenants")
    .select(["tenant_id", "plan", "limits", "limits_etag", "limits_updated_at", "limits_updated_by"])
    .where("tenant_id", "=", tenantId)
    .executeTakeFirstOrThrow();
  return {
    tenant_id: row.tenant_id,
    plan: row.plan as Plan,
    limits: readLimits(row.limits),
    etag: row.limits_etag,
    updated_at: row.limits_updated_at,
    updated_by: row.limits_updated_by,
    ...dayOf(now),
  };
}

/** The limits a call meets, if any: everyone's in a free organization, and a guest's in the example. */
export async function limitsFor(db: Db, scope: Pick<Scope, "tenant" | "tenantRole">): Promise<LimitContext | null> {
  if (!scope.tenant) return null;
  const guest = scope.tenantRole === "guest";
  if (!guest && scope.tenant.plan !== "free") return null;
  return { ...(await loadLimits(db, scope.tenant.tenant_id)), guest };
}

/** The limits an account meets in an organization: for work done outside `execute`, on a grant's authority. */
export async function limitsForAccount(db: Db, tenantId: string): Promise<LimitContext | null> {
  const state = await loadLimits(db, tenantId);
  return state.plan === "free" ? { ...state, guest: false } : null;
}

// ---- Counters -----------------------------------------------------------------------------------

/** The organization's own counters sit under this account id. */
const ORG = "";

type Counter = "requests" | "writes" | "sources" | "exports" | "bytes";

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
 * that fails, takes nothing from them. `input` is the call's validated input, for an operation that
 * adds several of what an allowance counts.
 */
export async function countWrite(trx: Db, lc: LimitContext, principal: Principal, op: Pick<OperationDef, "name" | "mutates">, input?: unknown): Promise<void> {
  if (lc.guest || !op.mutates) return;
  const s = lc.limits;
  const me = principal.account_id;
  const daily = DAILY[op.name];
  const takes = daily?.takes ? daily.takes(input) : 1;
  const n = await bump(trx, lc.tenant_id, "day", lc.day_start, [
    { account_id: me, counter: "writes", by: 1 },
    { account_id: ORG, counter: "writes", by: 1 },
    ...(daily ? [{ account_id: me, counter: daily.counter, by: takes }] : []),
  ]);
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
  if (used.bytes >= s.bytes_per_day) throw quota(lc, "bytes_per_day", used.bytes, "bytes", `each person ${s.bytes_per_day} bytes of uploads a day`);
  if (used.org_bytes >= s.org_bytes_per_day) throw quota(lc, "org_bytes_per_day", used.org_bytes, "bytes", `${s.org_bytes_per_day} bytes of uploads a day from everyone together`);
  const limit = Math.min(fileMaxBytes, s.file_max_bytes, s.bytes_per_day - used.bytes, s.org_bytes_per_day - used.org_bytes);
  if (file.size !== undefined && file.size > limit)
    throw tooLarge(
      file.size > Math.min(fileMaxBytes, s.file_max_bytes)
        ? `The file is ${file.size} bytes; this organization's plan takes files of at most ${Math.min(fileMaxBytes, s.file_max_bytes)} bytes.`
        : `The file is ${file.size} bytes, and ${limit} bytes are left in today's upload allowance, which starts again at ${lc.day_end}.`,
      { limit },
    );
  return limit;
}

/** Count an attached file against today's upload allowances. */
export async function countBytes(trx: Db, lc: LimitContext, accountId: string, size: number): Promise<void> {
  await bump(trx, lc.tenant_id, "day", lc.day_start, [
    { account_id: accountId, counter: "bytes", by: size },
    { account_id: ORG, counter: "bytes", by: size },
  ]);
}

export function mayFetchUrl(lc: LimitContext): void {
  if (!lc.limits.fetch_url)
    throw restricted(`Fetching a file from a URL is off on this organization's plan. Download the file yourself and upload it with attachments(action="request_upload").`);
}
