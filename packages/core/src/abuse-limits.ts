import { sql } from "kysely";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * Abuse limits: how much anyone can make a deployment do before an instance owner lets them in, or
 * do to strangers through it. They are not a plan's limits, which pace the work people do inside an
 * organization (`limits.ts`); these bound what a script could do with sign-in links, new accounts,
 * the waitlist, agent registrations, invitations, and the mail they send.
 *
 * - A limit is counted per client, per organization, or for the whole deployment, in fixed windows
 *   of an hour or a UTC day (`abuse_counters`). A refused request adds nothing. The hour's mail
 *   counts what is mailed; once it is used, a request that would mail nothing is refused alike.
 * - A client is counted only where the service can trust its address: behind a proxy that names it
 *   with the edge key (`client-address.ts` in the server). Elsewhere only the deployment's ceilings
 *   apply. An IPv4 address is one client. An IPv6 address is counted by its /64 and again, under
 *   limits three times larger, by its /48, since whoever holds one /64 often holds a whole /48.
 * - Agent registrations waiting for their first connection are kept to a number, not counted in a
 *   window: past it the oldest is forgotten (`agent_registrations_waiting`), so a flood of them only
 *   pushes out its own, and nobody is refused for it.
 * - Each deployment sets its own numbers (`WHATBUILD_ABUSE_LIMITS`); `off` turns one off.
 * - A deployment's ceiling logs `abuse_ceiling_reached` once in each window, when it fills, for an alert.
 */

export interface AbuseLimit {
  /** What one window allows, or what is kept at once; null when the deployment turned it off. */
  limit: number | null;
  /** The window it is counted in; null for a number kept at once. */
  window: "hour" | "day" | null;
  /** What it is counted per, as the settings' table says it. */
  per: "client address" | "IPv6 /48" | "organization" | "deployment";
  /** What it counts, in a few words. */
  counts: string;
}

/**
 * Every abuse limit, with what it counts and its default. Each limit per client address has one per
 * IPv6 /48 beside it, three times larger: a few people's /64s in one /48 (a household, an office)
 * share it without meeting it, and one person's /48 acts as three clients, not 65,536.
 */
export const ABUSE_LIMITS = {
  sign_in_links_per_address: { limit: 20, window: "hour", per: "client address", counts: "sign-in links asked for" },
  sign_in_links_per_ipv6_48: { limit: 60, window: "hour", per: "IPv6 /48", counts: "sign-in links asked for" },
  mail_per_hour: { limit: 500, window: "hour", per: "deployment", counts: "sign-in links and invitations emailed" },
  new_accounts_per_address: { limit: 10, window: "hour", per: "client address", counts: "accounts made by people nobody let in" },
  new_accounts_per_ipv6_48: { limit: 30, window: "hour", per: "IPv6 /48", counts: "accounts made by people nobody let in" },
  new_accounts_per_hour: { limit: 100, window: "hour", per: "deployment", counts: "accounts made by people nobody let in" },
  waitlist_per_address: { limit: 5, window: "hour", per: "client address", counts: "requests to join the waitlist" },
  waitlist_per_ipv6_48: { limit: 15, window: "hour", per: "IPv6 /48", counts: "requests to join the waitlist" },
  waitlist_per_hour: { limit: 200, window: "hour", per: "deployment", counts: "requests to join the waitlist" },
  agent_registrations_per_address: { limit: 20, window: "hour", per: "client address", counts: "agents (OAuth clients) registered" },
  agent_registrations_per_ipv6_48: { limit: 60, window: "hour", per: "IPv6 /48", counts: "agents (OAuth clients) registered" },
  agent_registrations_waiting: { limit: 1000, window: null, per: "deployment", counts: "agents registered that have not yet connected, kept at once; past it the oldest is forgotten" },
  invitations_per_organization: { limit: 100, window: "day", per: "organization", counts: "invitations made" },
} as const satisfies Record<string, AbuseLimit>;

export type AbuseLimitName = keyof typeof ABUSE_LIMITS;

/** The limits counted in a window, which `spend` takes from. */
export type WindowedLimitName = { [K in AbuseLimitName]: (typeof ABUSE_LIMITS)[K]["window"] extends null ? never : K }[AbuseLimitName];

/** What a client does that is limited per address and per IPv6 /48. */
export type ClientLimited = "sign_in_links" | "new_accounts" | "waitlist" | "agent_registrations";

/** The numbers a deployment set: each limit's, or null where it turned one off. */
export type AbuseLimits = Record<AbuseLimitName, number | null>;

export const DEFAULT_ABUSE_LIMITS: AbuseLimits = Object.fromEntries(Object.entries(ABUSE_LIMITS).map(([k, v]) => [k, v.limit])) as AbuseLimits;

/** The largest number a limit takes: what the count's integer column holds. */
const LIMIT_MAX = 2_147_483_647;

/**
 * `WHATBUILD_ABUSE_LIMITS`: `name=number` or `name=off`, separated by commas, for the limits a
 * deployment changes; the rest keep their defaults. A name it does not know, or a number that is not
 * a whole number from 1 to 2,147,483,647, stops the server, so a typing mistake never leaves a limit unset.
 */
export function abuseLimitsFrom(v: string | undefined): AbuseLimits {
  const limits = { ...DEFAULT_ABUSE_LIMITS };
  for (const part of (v ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf("=");
    const name = (at < 0 ? part : part.slice(0, at)).trim();
    const value = at < 0 ? "" : part.slice(at + 1).trim();
    if (!name || !Object.hasOwn(ABUSE_LIMITS, name))
      throw new Error(`WHATBUILD_ABUSE_LIMITS names "${name}", which is not an abuse limit. The limits are ${Object.keys(ABUSE_LIMITS).join(", ")}.`);
    if (value === "off") limits[name as AbuseLimitName] = null;
    else if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= LIMIT_MAX) limits[name as AbuseLimitName] = Number(value);
    else throw new Error(`WHATBUILD_ABUSE_LIMITS sets ${name} to "${value}": give a whole number from 1 to ${LIMIT_MAX}, or off.`);
  }
  return limits;
}

/** Where a window began, and when the next begins. */
export function windowOf(window: "hour" | "day", now = new Date()): { starts_at: string; resets_at: string } {
  const ms = window === "hour" ? 3_600_000 : 86_400_000;
  const start = Math.floor(now.getTime() / ms) * ms;
  return { starts_at: new Date(start).toISOString(), resets_at: new Date(start + ms).toISOString() };
}

export type Spent = { ok: true; n: number; filled: boolean } | { ok: false; limit: number; resets_at: string };

/**
 * Take `by` from a limit's window for `subject` (a client's keyed hash, an organization's ID, or ""
 * for the deployment), or refuse when that would pass the limit, adding nothing. Run in a
 * transaction, a later refusal in the same transaction gives it back; the row stays locked until
 * that transaction ends, so a deployment's ceiling is taken from in a short transaction of its own,
 * never one that waits for anything else (a mail server). A limit turned off always allows. Taking
 * 0 asks for room for one, as `hasRoom` does.
 */
export async function spend(db: Db, name: WindowedLimitName, subject: string, limits: AbuseLimits, by = 1, now = new Date()): Promise<Spent> {
  const limit = limits[name];
  const { starts_at, resets_at } = windowOf(ABUSE_LIMITS[name].window, now);
  if (limit === null) return { ok: true, n: 0, filled: false };
  const room = Math.max(by, 1);
  if (room > limit) return { ok: false, limit, resets_at };
  // Refused or not, an upsert that meets the row locks it until the transaction ends (Postgres locks
  // a conflicting row even when the update's condition leaves it as it was).
  const row = await db
    .insertInto("abuse_counters")
    .values({ name, subject, starts_at, n: by })
    .onConflict((oc) => oc.columns(["name", "subject", "starts_at"]).doUpdateSet({ n: sql<number>`abuse_counters.n + excluded.n` }).where(sql<boolean>`abuse_counters.n + ${room} <= ${limit}`))
    .returning("n")
    .executeTakeFirst();
  if (!row) return { ok: false, limit, resets_at };
  const n = Number(row.n);
  const filled = n >= limit && n - by < limit;
  if (filled && ABUSE_LIMITS[name].per === "deployment") abuseLog({ event: "abuse_ceiling_reached", limit: name, value: limit, window: ABUSE_LIMITS[name].window, resets_at });
  return { ok: true, n, filled };
}

/**
 * Whether a limit's window has room for one more, adding nothing: for a request a limit counts only
 * when it does what the limit counts (a sign-in link is counted against the hour's mail only when it
 * is mailed), so that once the window is used it is refused alike with the ones counted. It is
 * `spend` taking 0, so it locks the row as `spend` does, until the transaction ends: a request that
 * is counted and one that is not wait alike behind the others, and how long either takes never says
 * which it was.
 */
export async function hasRoom(db: Db, name: WindowedLimitName, subject: string, limits: AbuseLimits, now = new Date()): Promise<Spent> {
  return spend(db, name, subject, limits, 0, now);
}

/** A client, as the limits per client count it: its address's keyed hash, and, for an IPv6 address, its /48's. */
export interface ClientKeys {
  address: string;
  ipv6_48: string | null;
}

export type ClientSpent = { ok: true } | { ok: false; name: WindowedLimitName; limit: number; resets_at: string };

/**
 * Take one from what a client may do in the hour: under the limit per address and, for an IPv6
 * address, the one per /48. Run it in the transaction that also takes from the deployment's
 * ceiling, so that a refusal by any of them gives back what the others took. Null keys (an address
 * the service cannot trust) count nothing.
 */
export async function spendPerClient(db: Db, what: ClientLimited, keys: ClientKeys | null, limits: AbuseLimits, now = new Date()): Promise<ClientSpent> {
  if (!keys) return { ok: true };
  const tiers: [WindowedLimitName, string | null][] = [
    [`${what}_per_address`, keys.address],
    [`${what}_per_ipv6_48`, keys.ipv6_48],
  ];
  for (const [name, subject] of tiers) {
    if (subject === null) continue;
    const spent = await spend(db, name, subject, limits, 1, now);
    if (!spent.ok) return { ok: false, name, limit: spent.limit, resets_at: spent.resets_at };
  }
  return { ok: true };
}

/** Who hears the abuse log besides the server's own log: tests. */
const listeners = new Set<(line: Record<string, unknown>) => void>();

/**
 * A structured line in the server's log, as the rest of the server writes them; never an address or
 * an email. Tests hear it only when they listen (`listenToAbuseLog`), so their output stays quiet.
 */
export function abuseLog(fields: Record<string, unknown>): void {
  const line = { at: new Date().toISOString(), severity: "WARNING", ...fields };
  for (const hear of listeners) hear(line);
  if (process.env["NODE_ENV"] === "test") return;
  console.warn(JSON.stringify(line));
}

/** For tests: hear every line `abuseLog` writes, until the returned function is called. */
export function listenToAbuseLog(hear: (line: Record<string, unknown>) => void): () => void {
  listeners.add(hear);
  return () => void listeners.delete(hear);
}

/** Seconds until a window starts again, for Retry-After. */
export function retryAfter(resetsAt: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((Date.parse(resetsAt) - now) / 1000));
}

/**
 * A refusal under an abuse limit: `429 rate_limited`, whose details name the limit (`abuse_limit`),
 * give its number and its window (`limit` and `per`, an hour or a day, as a plan's refusals give
 * them; not what ABUSE_LIMITS calls `per`, what it is counted per) and say when its window starts again.
 */
export function abuseRefusal(message: string, name: WindowedLimitName, limit: number, resetsAt: string, now = Date.now(), details: Record<string, unknown> = {}) {
  return new AppError(429, "rate_limited", message, { abuse_limit: name, limit, per: ABUSE_LIMITS[name].window, resets_at: resetsAt, retry_after_seconds: retryAfter(resetsAt, now), ...details });
}

/**
 * The refusal for an organization's invitations a day. `room` is how many more it could have made
 * when a call asking for several (members.grant_many) passed the day's limit: that many can still be
 * sent today. A single invitation is refused only when there is no room left.
 */
export function invitationsUsedUp(limit: number, resetsAt: string, room = 0) {
  const now = room
    ? `This organization can make ${room} more invitation${room === 1 ? "" : "s"} today, of the ${limit} this WhatBuild takes from one organization in a UTC day: send at most ${room}, or invite more from ${resetsAt}, midnight UTC.`
    : `This organization has made ${limit} invitations today, the most this WhatBuild takes from one organization in a UTC day. Invite more from ${resetsAt}, midnight UTC.`;
  return abuseRefusal(`${now} Someone already in the organization can be given a role at once.`, "invitations_per_organization", limit, resetsAt, Date.now(), { room_for: room });
}

/** Housekeeping, from the worker: windows that began over two days ago are done with. */
export async function pruneAbuseCounters(db: Db): Promise<void> {
  await sql`delete from abuse_counters where starts_at < now() - interval '2 days'`.execute(db);
}
