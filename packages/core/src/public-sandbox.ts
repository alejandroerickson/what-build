import { createHash } from "node:crypto";
import { parserFor } from "@whatbuild/parsers";
import { sql } from "kysely";
import { z } from "zod";
import type { ActorSnapshot, Db } from "./db.ts";
import { AppError, conflict, rateLimited, tooLarge } from "./errors.ts";
import { mediaTypeFor } from "./media.ts";
import { isSandboxStaff } from "./policy.ts";
import type { OperationDef, Principal, Scope } from "./registry.ts";
import { newEtag } from "./util.ts";

/**
 * The public sandbox: one organization, named by the deployment, that invited visitors work in.
 *
 * - Its owners and admins are its staff. Everyone else there is a visitor: they edit content,
 *   administer nothing, write under a made-up name, and never see another person.
 * - What a visitor does is limited in how often and how much. The limits are settings, read here
 *   and enforced in `execute`, so REST and MCP cannot differ.
 * - Staff save the organization's content as a baseline, and a reset puts it back
 *   (`public-sandbox-baseline.ts`).
 */

const MiB = 1024 * 1024;

// ---- Settings -----------------------------------------------------------------------------------

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const count = (max: number) => z.number().int().min(0).max(max);

/** Every setting, without its default, so an update changes only what it names. */
const FIELDS = {
  visitor_access: z.enum(["write", "read", "closed"]).describe("write: visitors edit. read: they read only, and export as far as exports_per_day allows. closed: they are refused everything."),
  visitor_agents: z.boolean().describe("Whether a visitor's agent may work here over MCP."),
  reset_enabled: z.boolean().describe("Whether the sandbox resets itself every day at reset_time."),
  reset_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time as HH:MM, 24-hour").describe("The local time of the daily reset, HH:MM."),
  reset_timezone: z.string().min(1).max(64).refine(validTimeZone, "an IANA time zone such as America/Los_Angeles").describe("The IANA time zone reset_time is in."),
  max_visitors: count(10_000_000).describe("Seats: how many visitors the sandbox holds at once."),
  visitor_idle_days: count(3650).describe("A visitor who has not signed in or used an agent for this many days gives up their seat at the next reset; 0 keeps every seat."),
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

export type SandboxSettings = { [K in keyof typeof FIELDS]: z.output<(typeof FIELDS)[K]> };
export type SandboxSettingKey = keyof SandboxSettings;

export const SANDBOX_DEFAULTS: SandboxSettings = {
  visitor_access: "write",
  visitor_agents: true,
  reset_enabled: true,
  reset_time: "02:00",
  reset_timezone: "America/Los_Angeles",
  max_visitors: 200,
  visitor_idle_days: 30,
  requests_per_minute: 120,
  writes_per_minute: 30,
  writes_per_day: 300,
  sources_per_day: 10,
  // Off: the sandbox's content is a demonstration, not the visitor's to take away.
  exports_per_day: 0,
  org_writes_per_day: 20_000,
  file_max_bytes: 5 * MiB,
  bytes_per_day: 50 * MiB,
  org_bytes_per_day: 2048 * MiB,
  text_max_chars: 200_000,
  batch_max: 25,
  fetch_url: false,
  documents_only: true,
};

/** What `sandbox.update_settings` accepts: any of the settings, and nothing else. */
export const sandboxSettingsPatch = z.strictObject(FIELDS).partial();

/** Stored settings as the application reads them: a missing or unreadable value is its default. */
export function readSettings(stored: unknown): SandboxSettings {
  const given = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...SANDBOX_DEFAULTS };
  for (const key of Object.keys(FIELDS) as SandboxSettingKey[]) {
    if (given[key] === undefined) continue;
    const parsed = FIELDS[key].safeParse(given[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as SandboxSettings;
}

export interface LimitInfo {
  key: SandboxSettingKey;
  group: "frequency" | "size" | "switch";
  label: string;
  /** What one unit is, for a person: "calls", "bytes". */
  unit: string;
  /** What the limit is counted over. */
  per: "Each visitor, each minute" | "Each visitor, each day" | "All visitors together, each day" | "Each file" | "Each text field" | "Each call" | "Each visitor";
  /** The error a caller over the limit receives. */
  refusal: string;
  help: string;
}

/** Every limit on what a visitor does, in the order the control panel shows them. */
export const SANDBOX_LIMITS: LimitInfo[] = [
  { key: "requests_per_minute", group: "frequency", label: "Calls", unit: "calls", per: "Each visitor, each minute", refusal: "429 rate_limited", help: "Every call a visitor or their agent makes, reads included." },
  { key: "writes_per_minute", group: "frequency", label: "Writes", unit: "writes", per: "Each visitor, each minute", refusal: "429 rate_limited", help: "Calls that change something." },
  { key: "writes_per_day", group: "frequency", label: "Writes", unit: "writes", per: "Each visitor, each day", refusal: "409 quota_exceeded", help: "A day runs from one scheduled reset to the next." },
  { key: "sources_per_day", group: "frequency", label: "Sources added", unit: "sources", per: "Each visitor, each day", refusal: "409 quota_exceeded", help: "Sources created or copied in." },
  { key: "exports_per_day", group: "frequency", label: "Exports", unit: "exports", per: "Each visitor, each day", refusal: "409 quota_exceeded", help: "Product exports a visitor asks for. 0, the default, keeps the sandbox's content in the sandbox." },
  { key: "org_writes_per_day", group: "frequency", label: "Writes", unit: "writes", per: "All visitors together, each day", refusal: "409 quota_exceeded", help: "A ceiling on every visitor's writes added up." },
  { key: "file_max_bytes", group: "size", label: "File size", unit: "bytes", per: "Each file", refusal: "413 too_large", help: "Checked as the file uploads." },
  { key: "bytes_per_day", group: "size", label: "Uploads", unit: "bytes", per: "Each visitor, each day", refusal: "409 quota_exceeded", help: "Counted when a file is attached to a source." },
  { key: "org_bytes_per_day", group: "size", label: "Uploads", unit: "bytes", per: "All visitors together, each day", refusal: "409 quota_exceeded", help: "A ceiling on every visitor's uploads added up." },
  { key: "text_max_chars", group: "size", label: "Text in one field", unit: "characters", per: "Each text field", refusal: "413 too_large", help: "The longest body, note or Story page a visitor may send." },
  { key: "batch_max", group: "size", label: "Sources in one call", unit: "sources", per: "Each call", refusal: "413 too_large", help: "How many sources one archive or restore call may name." },
  { key: "fetch_url", group: "switch", label: "Fetching a file from a URL", unit: "", per: "Each visitor", refusal: "403 sandbox_restricted", help: "Off stops the server fetching links a visitor names." },
  { key: "documents_only", group: "switch", label: "Uploads limited to formats the parsers read", unit: "", per: "Each visitor", refusal: "403 sandbox_restricted", help: "On refuses recordings, archives and images, and allows text, Markdown, transcripts, HTML, Word (DOC, DOCX), PDF, spreadsheets and XML." },
];

// ---- The schedule -------------------------------------------------------------------------------

function wallClock(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: n("year"), month: n("month"), day: n("day"), hour: n("hour"), minute: n("minute"), second: n("second") };
}

/** The instant a wall-clock time names in a time zone. A time the clocks skip lands just after the skip. */
function instantOf(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(guess, timeZone);
    const diff = target - Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    if (!diff) break;
    guess += diff;
  }
  return guess;
}

/**
 * The scheduled reset at or before `now`, and the one after it. A sandbox's day, for its daily
 * allowances, runs from one to the other whether or not resets are turned on.
 */
export function resetSchedule(settings: Pick<SandboxSettings, "reset_time" | "reset_timezone">, now: Date): { due_at: string; next_at: string } {
  const tz = settings.reset_timezone;
  const [hour, minute] = settings.reset_time.split(":").map(Number) as [number, number];
  const w = wallClock(now.getTime(), tz);
  const on = (offsetDays: number) => {
    // Calendar arithmetic on the date alone, so a month's end and a leap day come out right.
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + offsetDays));
    return instantOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, tz);
  };
  const today = on(0);
  const due = today <= now.getTime() ? today : on(-1);
  const next = today <= now.getTime() ? on(1) : today;
  return { due_at: new Date(due).toISOString(), next_at: new Date(next).toISOString() };
}

// ---- Who a visitor is ---------------------------------------------------------------------------

/**
 * The name a visitor writes under: the same in every call, different in every sandbox, and no
 * part of who they are. Attribution is copied, never joined, so a visitor's own name is never
 * written into the organization.
 */
export function visitorName(tenantId: string, accountId: string): string {
  return `Visitor ${visitorCode(tenantId, accountId)}`;
}

function visitorCode(tenantId: string, accountId: string): string {
  return createHash("sha256").update(`${tenantId}:${accountId}`).digest("hex").slice(0, 6).toUpperCase();
}

/** The same code, computed by the database for a grant `m`, so a list of visitors can be searched by it. */
export const VISITOR_CODE_SQL = sql<string>`upper(substr(encode(sha256(convert_to(m.tenant_id || ':' || m.account_id, 'UTF8')), 'hex'), 1, 6))`;

/** In a public sandbox, everyone but its staff. */
export function isVisitor(scope: Pick<Scope, "tenant" | "tenantRole">): boolean {
  return Boolean(scope.tenant?.sandbox) && !isSandboxStaff(scope.tenantRole);
}

export function visitorActor(principal: Principal, tenantId: string): ActorSnapshot {
  return { account_id: principal.account_id, display_name: visitorName(tenantId, principal.account_id), surface: principal.surface, client: principal.client };
}

// ---- The sandbox a call is in -------------------------------------------------------------------

export interface SandboxState {
  tenant_id: string;
  settings: SandboxSettings;
  etag: string;
  baseline_id: string | null;
  last_reset_at: string | null;
  last_reset: Record<string, unknown> | null;
  updated_at: string | null;
  updated_by: ActorSnapshot | null;
  /** The scheduled reset at or before now: where the sandbox's day began. */
  day_start: string;
  /** The scheduled reset after now, whether or not resets are on. */
  day_end: string;
}

export interface SandboxContext extends SandboxState {
  /** Whether the caller is a visitor: anyone but the organization's owners and admins. */
  visitor: boolean;
  /** The name the caller writes under, when they are a visitor. */
  appears_as: string | null;
}

export async function loadSandbox(db: Db, tenantId: string, now = new Date()): Promise<SandboxState> {
  const row = await db.selectFrom("sandbox_settings").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  const settings = readSettings(row?.settings);
  const { due_at, next_at } = resetSchedule(settings, now);
  return {
    tenant_id: tenantId,
    settings,
    etag: row?.etag ?? "unset",
    baseline_id: row?.baseline_id ?? null,
    last_reset_at: row?.last_reset_at ?? null,
    last_reset: row?.last_reset ?? null,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
    day_start: due_at,
    day_end: next_at,
  };
}

/** Whether the scheduled reset has come and the sandbox has not yet been put back. */
export function resetIsDue(state: Pick<SandboxState, "settings" | "baseline_id" | "last_reset_at" | "day_start">): boolean {
  if (!state.settings.reset_enabled || !state.baseline_id) return false;
  return !state.last_reset_at || Date.parse(state.last_reset_at) < Date.parse(state.day_start);
}

/** The sandbox as it concerns one account: for work done outside `execute`, on a grant's authority. */
export async function sandboxForAccount(db: Db, tenantId: string, accountId: string): Promise<SandboxContext | null> {
  const tenant = await db.selectFrom("tenants").select("sandbox").where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!tenant?.sandbox) return null;
  const grant = await db
    .selectFrom("memberships")
    .select("role")
    .where("tenant_id", "=", tenantId)
    .where("scope_type", "=", "tenant")
    .where("account_id", "=", accountId)
    .executeTakeFirst();
  const visitor = !(grant?.role === "owner" || grant?.role === "admin");
  return { ...(await loadSandbox(db, tenantId)), visitor, appears_as: visitor ? visitorName(tenantId, accountId) : null };
}

/** The sandbox's settings row, made if it is missing, and held until the transaction ends. */
export async function lockSettings(trx: Db, tenantId: string) {
  await trx
    .insertInto("sandbox_settings")
    .values({ tenant_id: tenantId, settings: JSON.stringify({}), etag: newEtag() })
    .onConflict((oc) => oc.column("tenant_id").doNothing())
    .execute();
  return trx.selectFrom("sandbox_settings").selectAll().where("tenant_id", "=", tenantId).forUpdate().executeTakeFirstOrThrow();
}

// ---- Counters -----------------------------------------------------------------------------------

/** The organization's own counters sit under this account id. */
const ORG = "";

type Counter = "requests" | "writes" | "sources" | "exports" | "bytes";

/** Add to counters and return their new values, keyed `<account>:<counter>`. */
async function bump(db: Db, tenantId: string, bucket: "minute" | "day", startsAt: string, adds: { account_id: string; counter: Counter; by: number }[]): Promise<Map<string, number>> {
  if (!adds.length) return new Map();
  const rows = await db
    .insertInto("sandbox_usage")
    .values(adds.map((a) => ({ tenant_id: tenantId, account_id: a.account_id, bucket, starts_at: startsAt, counter: a.counter, n: a.by })))
    .onConflict((oc) => oc.columns(["tenant_id", "account_id", "bucket", "starts_at", "counter"]).doUpdateSet({ n: sql<number>`sandbox_usage.n + excluded.n` }))
    .returning(["account_id", "counter", "n"])
    .execute();
  return new Map(rows.map((r) => [`${r.account_id}:${r.counter}`, Number(r.n)]));
}

/** What a visitor, and the organization, have used since the sandbox's day began. */
export async function usageToday(db: Db, sandbox: Pick<SandboxState, "tenant_id" | "day_start">, accountId: string) {
  const rows = await db
    .selectFrom("sandbox_usage")
    .select(["account_id", "counter", "n"])
    .where("tenant_id", "=", sandbox.tenant_id)
    .where("bucket", "=", "day")
    .where("starts_at", "=", sandbox.day_start)
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

// ---- Enforcement --------------------------------------------------------------------------------

const restricted = (message: string, details?: Record<string, unknown>) => new AppError(403, "sandbox_restricted", message, details);

function quota(sandbox: SandboxState, name: SandboxSettingKey, used: number, unit: string, what: string) {
  const limit = sandbox.settings[name] as number;
  return conflict("quota_exceeded", `This public sandbox allows ${what}. The allowance starts again at ${sandbox.day_end}. Reading, searching and what is already here are unaffected.`, {
    quota: name, limit, used, unit, resets_at: sandbox.day_end,
  });
}

/** Operations a visitor never runs, and what to do instead. */
const VISITOR_REFUSED: Record<string, string> = {
  "sources.delete": "Permanent delete is off for visitors in a public sandbox. Archive the source instead with sources(action=\"archive\"); the next reset puts everything back.",
};

/** Operations counted against a daily allowance beyond the count of writes. */
const DAILY: Record<string, { counter: Counter; setting: SandboxSettingKey; unit: string; what: (n: number) => string }> = {
  "sources.create": { counter: "sources", setting: "sources_per_day", unit: "sources", what: (n) => `each visitor ${n} new sources a day` },
  "files.create_upload": { counter: "sources", setting: "sources_per_day", unit: "sources", what: (n) => `each visitor ${n} new sources a day` },
  "sources.copy_to_product": { counter: "sources", setting: "sources_per_day", unit: "sources", what: (n) => `each visitor ${n} new sources a day` },
  "products.export": { counter: "exports", setting: "exports_per_day", unit: "exports", what: (n) => `each visitor ${n} exports a day` },
};

/** What a visitor may always ask, so that a person and an agent can learn the state they are refused in. */
const ALWAYS_ANSWERED = new Set(["sandbox.status"]);

/**
 * What a visitor's call meets before anything else runs: whether visitors are let in at all, what
 * they may never do, and how often they may call. A refused call still counts as a call. A call
 * that names no organization (`inTenant` false) meets only the limits on how often.
 */
export async function admitVisitor(db: Db, sandbox: SandboxContext, principal: Principal, op: Pick<OperationDef, "name" | "mutates">, inTenant: boolean): Promise<void> {
  const s = sandbox.settings;
  if (inTenant && !ALWAYS_ANSWERED.has(op.name)) {
    if (s.visitor_access === "closed")
      throw new AppError(403, "sandbox_closed", "This public sandbox is closed to visitors for now. Nothing of yours was changed; try again later.");
    if (principal.surface === "mcp" && !s.visitor_agents)
      throw restricted("Agents are turned off for visitors in this public sandbox. Use the web app instead.");
    // Export is never blocked by a read-only state; its own daily allowance still applies.
    if (op.mutates && s.visitor_access === "read" && op.name !== "products.export")
      throw new AppError(403, "sandbox_read_only", `This public sandbox is read-only for visitors for now, so ${op.name} was refused. Reading and searching still work.`);
    const refused = VISITOR_REFUSED[op.name];
    if (refused) throw restricted(refused);
  }

  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const adds: { account_id: string; counter: Counter; by: number }[] = [{ account_id: principal.account_id, counter: "requests", by: 1 }];
  if (op.mutates) adds.push({ account_id: principal.account_id, counter: "writes", by: 1 });
  const n = await bump(db, sandbox.tenant_id, "minute", minute, adds);
  const over = (used: number | undefined, limit: number) => (used ?? 0) > limit;
  if (over(n.get(`${principal.account_id}:requests`), s.requests_per_minute))
    throw rateLimited(`This public sandbox allows each visitor ${s.requests_per_minute} calls a minute. Wait for the next minute, then carry on.`, { limit: s.requests_per_minute, per: "minute", retry_after_seconds: 60 - new Date().getUTCSeconds() });
  if (op.mutates && over(n.get(`${principal.account_id}:writes`), s.writes_per_minute))
    throw rateLimited(`This public sandbox allows each visitor ${s.writes_per_minute} writes a minute. Wait for the next minute, then carry on; reads are unaffected.`, { limit: s.writes_per_minute, per: "minute", retry_after_seconds: 60 - new Date().getUTCSeconds() });
}

/**
 * The limits on how much one call carries, checked on the validated input: the longest text a
 * field may hold, and how many sources one call may name.
 */
export function checkVisitorInput(sandbox: SandboxContext, op: Pick<OperationDef, "name">, input: unknown): void {
  const s = sandbox.settings;
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (value.length > s.text_max_chars)
        throw tooLarge(`${path} holds ${value.length} characters; this public sandbox takes at most ${s.text_max_chars} in one field. Send less, or split it.`, { field: path, limit: s.text_max_chars, unit: "characters" });
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(input, "");
  const ids = (input as { record_ids?: unknown } | null)?.record_ids;
  if (Array.isArray(ids) && ids.length > s.batch_max)
    throw tooLarge(`${op.name} names ${ids.length} sources; this public sandbox takes at most ${s.batch_max} in one call. Send them in smaller groups.`, { field: "record_ids", limit: s.batch_max, unit: "sources" });
}

/**
 * A visitor's daily allowances, counted inside the operation's own transaction: a call that is
 * refused, or that fails, takes nothing from the allowance.
 */
export async function countVisitorWrite(trx: Db, sandbox: SandboxContext, principal: Principal, op: Pick<OperationDef, "name" | "mutates">): Promise<void> {
  if (!op.mutates) return;
  const s = sandbox.settings;
  const me = principal.account_id;
  const daily = DAILY[op.name];
  const n = await bump(trx, sandbox.tenant_id, "day", sandbox.day_start, [
    { account_id: me, counter: "writes", by: 1 },
    { account_id: ORG, counter: "writes", by: 1 },
    ...(daily ? [{ account_id: me, counter: daily.counter, by: 1 }] : []),
  ]);
  // An export is counted, and never stopped by the allowance of writes: it is how someone leaves with their work.
  if (op.name !== "products.export") {
    const mine = n.get(`${me}:writes`) ?? 0;
    if (mine > s.writes_per_day) throw quota(sandbox, "writes_per_day", mine - 1, "writes", `each visitor ${s.writes_per_day} writes a day`);
    const all = n.get(`${ORG}:writes`) ?? 0;
    if (all > s.org_writes_per_day) throw quota(sandbox, "org_writes_per_day", all - 1, "writes", `${s.org_writes_per_day} writes a day from all visitors together`);
  }
  if (daily) {
    const used = n.get(`${me}:${daily.counter}`) ?? 0;
    const limit = s[daily.setting] as number;
    if (used > limit) throw quota(sandbox, daily.setting, used - 1, daily.unit, daily.what(limit));
  }
}

/**
 * What a visitor's upload may be, decided before a grant is issued: the type, the size of the one
 * file, and the bytes left in today's allowances. Returns the most bytes the grant may take.
 */
export async function visitorUploadLimit(trx: Db, sandbox: SandboxContext, accountId: string, file: { path: string; media_type?: string | null | undefined; size?: number | undefined }, fileMaxBytes: number): Promise<number> {
  const s = sandbox.settings;
  if (s.documents_only && !parserFor(file.path, mediaTypeFor(file.path, file.media_type)))
    throw restricted(`This public sandbox takes only files its parsers read: text, Markdown, transcripts (VTT, SRT), HTML, Word (DOC, DOCX), PDF, spreadsheets and XML. ${file.path} is not one of them.`, { path: file.path });
  const used = await usageToday(trx, sandbox, accountId);
  if (used.bytes >= s.bytes_per_day) throw quota(sandbox, "bytes_per_day", used.bytes, "bytes", `each visitor ${s.bytes_per_day} bytes of uploads a day`);
  if (used.org_bytes >= s.org_bytes_per_day) throw quota(sandbox, "org_bytes_per_day", used.org_bytes, "bytes", `${s.org_bytes_per_day} bytes of uploads a day from all visitors together`);
  const limit = Math.min(fileMaxBytes, s.file_max_bytes, s.bytes_per_day - used.bytes, s.org_bytes_per_day - used.org_bytes);
  if (file.size !== undefined && file.size > limit)
    throw tooLarge(
      file.size > Math.min(fileMaxBytes, s.file_max_bytes)
        ? `The file is ${file.size} bytes; this public sandbox takes files of at most ${Math.min(fileMaxBytes, s.file_max_bytes)} bytes.`
        : `The file is ${file.size} bytes, and ${limit} bytes are left in today's upload allowance, which starts again at ${sandbox.day_end}.`,
      { limit },
    );
  return limit;
}

/** Count a visitor's attached file against today's upload allowances. */
export async function countVisitorBytes(trx: Db, sandbox: SandboxContext, accountId: string, size: number): Promise<void> {
  await bump(trx, sandbox.tenant_id, "day", sandbox.day_start, [
    { account_id: accountId, counter: "bytes", by: size },
    { account_id: ORG, counter: "bytes", by: size },
  ]);
}

export function visitorMayFetchUrl(sandbox: SandboxContext): void {
  if (!sandbox.settings.fetch_url) throw restricted("Fetching a file from a URL is off for visitors in this public sandbox. Download the file yourself and upload it with files(action=\"request_upload\").");
}

// ---- Running alone ------------------------------------------------------------------------------

/**
 * Every write in a public sandbox holds this lock shared for its transaction; saving a baseline
 * and resetting hold it alone. So a reset sees no half-finished write, and no write lands in the
 * middle of one.
 */
export async function lockSandbox(trx: Db, tenantId: string, mode: "shared" | "exclusive"): Promise<void> {
  const key = `whatbuild.sandbox.${tenantId}`;
  if (mode === "exclusive") await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
  else await sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`.execute(trx);
}
