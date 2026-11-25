import { sql } from "kysely";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * Abuse limits: how much anyone can make a deployment do before an instance owner lets them in, or
 * do to strangers through it. They are not a plan's limits, which pace the work people do inside an
 * organization (`limits.ts`); these bound what a script could do with sign-in links, new accounts,
 * the waitlist, agent registrations, invitations, and the mail they send.
 *
 * - A limit is counted per client address, per organization, or for the whole deployment, in
 *   fixed windows of an hour or a UTC day (`abuse_counters`). A refused request adds nothing.
 * - A client address is counted only where the service can trust it: behind a proxy that names it
 *   with the edge key (`client-address.ts` in the server). Elsewhere only the deployment's ceilings apply.
 * - Each deployment sets its own numbers (`WHATBUILD_ABUSE_LIMITS`); `off` turns one off.
 * - A deployment's ceiling logs `abuse_ceiling_reached` once in each window, when it fills, for an alert.
 */

export interface AbuseLimit {
  /** What one window allows; null when the deployment turned it off. */
  limit: number | null;
  window: "hour" | "day";
  /** What it is counted per, as the settings' table says it. */
  per: "client address" | "organization" | "deployment";
  /** What it counts, in a few words. */
  counts: string;
}

/** Every abuse limit, with what it counts and its default. */
export const ABUSE_LIMITS = {
  sign_in_links_per_address: { limit: 20, window: "hour", per: "client address", counts: "sign-in links asked for" },
  mail_per_hour: { limit: 500, window: "hour", per: "deployment", counts: "sign-in links and invitations emailed" },
  new_accounts_per_address: { limit: 10, window: "hour", per: "client address", counts: "accounts made by people nobody let in" },
  new_accounts_per_hour: { limit: 100, window: "hour", per: "deployment", counts: "accounts made by people nobody let in" },
  waitlist_per_address: { limit: 5, window: "hour", per: "client address", counts: "requests to join the waitlist" },
  waitlist_per_hour: { limit: 200, window: "hour", per: "deployment", counts: "requests to join the waitlist" },
  agent_registrations_per_address: { limit: 20, window: "hour", per: "client address", counts: "agents (OAuth clients) registered" },
  agent_registrations_per_hour: { limit: 200, window: "hour", per: "deployment", counts: "agents registered that have not yet connected" },
  invitations_per_organization: { limit: 100, window: "day", per: "organization", counts: "invitations made" },
} as const satisfies Record<string, AbuseLimit>;

export type AbuseLimitName = keyof typeof ABUSE_LIMITS;

/** The numbers a deployment set: each limit's, or null where it turned one off. */
export type AbuseLimits = Record<AbuseLimitName, number | null>;

export const DEFAULT_ABUSE_LIMITS: AbuseLimits = Object.fromEntries(Object.entries(ABUSE_LIMITS).map(([k, v]) => [k, v.limit])) as AbuseLimits;

/**
 * `WHATBUILD_ABUSE_LIMITS`: `name=number` or `name=off`, separated by commas, for the limits a
 * deployment changes; the rest keep their defaults. A name it does not know, or a number that is not
 * a whole number of at least 1, stops the server, so a typing mistake never leaves a limit unset.
 */
export function abuseLimitsFrom(v: string | undefined): AbuseLimits {
  const limits = { ...DEFAULT_ABUSE_LIMITS };
  for (const part of (v ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const [name, value] = part.split("=").map((s) => s?.trim() ?? "");
    if (!name || !Object.hasOwn(ABUSE_LIMITS, name))
      throw new Error(`WHATBUILD_ABUSE_LIMITS names "${name}", which is not an abuse limit. The limits are ${Object.keys(ABUSE_LIMITS).join(", ")}.`);
    if (value === "off") limits[name as AbuseLimitName] = null;
    else if (value && /^\d+$/.test(value) && Number(value) >= 1) limits[name as AbuseLimitName] = Number(value);
    else throw new Error(`WHATBUILD_ABUSE_LIMITS sets ${name} to "${value ?? ""}": give a whole number of at least 1, or off.`);
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
 * Take `by` from a limit's window for `subject` (a client address's key, an organization's ID, or
 * "" for the deployment), or refuse when that would pass the limit, adding nothing. Run in a
 * transaction, a later refusal in the same transaction gives it back. A limit turned off always allows.
 */
export async function spend(db: Db, name: AbuseLimitName, subject: string, limits: AbuseLimits, by = 1, now = new Date()): Promise<Spent> {
  const limit = limits[name];
  const { starts_at, resets_at } = windowOf(ABUSE_LIMITS[name].window, now);
  if (limit === null) return { ok: true, n: 0, filled: false };
  if (by > limit) return { ok: false, limit, resets_at };
  const row = await db
    .insertInto("abuse_counters")
    .values({ name, subject, starts_at, n: by })
    .onConflict((oc) => oc.columns(["name", "subject", "starts_at"]).doUpdateSet({ n: sql<number>`abuse_counters.n + excluded.n` }).where(sql<boolean>`abuse_counters.n + excluded.n <= ${limit}`))
    .returning("n")
    .executeTakeFirst();
  if (!row) return { ok: false, limit, resets_at };
  const n = Number(row.n);
  const filled = n >= limit && n - by < limit;
  if (filled && ABUSE_LIMITS[name].per === "deployment") abuseLog({ event: "abuse_ceiling_reached", limit: name, value: limit, window: ABUSE_LIMITS[name].window, resets_at });
  return { ok: true, n, filled };
}

/** A structured line in the server's log, as the rest of the server writes them; never an address or an email. */
export function abuseLog(fields: Record<string, unknown>): void {
  if (process.env["NODE_ENV"] === "test") return;
  console.warn(JSON.stringify({ at: new Date().toISOString(), severity: "WARNING", ...fields }));
}

/** Seconds until a window starts again, for Retry-After. */
export function retryAfter(resetsAt: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((Date.parse(resetsAt) - now) / 1000));
}

/**
 * A refusal under an abuse limit: `429 rate_limited`, whose details name the limit (`abuse_limit`),
 * give its number (`limit`, as a plan's refusals do) and say when its window starts again.
 */
export function abuseRefusal(message: string, name: AbuseLimitName, limit: number, resetsAt: string, now = Date.now()) {
  return new AppError(429, "rate_limited", message, { abuse_limit: name, limit, per: ABUSE_LIMITS[name].window, resets_at: resetsAt, retry_after_seconds: retryAfter(resetsAt, now) });
}

/** The refusal for an organization's invitations a day. */
export function invitationsUsedUp(limit: number, resetsAt: string) {
  return abuseRefusal(
    `This organization has made ${limit} invitations today, the most this WhatBuild takes from one organization in a UTC day. Invite more from ${resetsAt}, midnight UTC. Someone already in the organization can be given a role at once.`,
    "invitations_per_organization",
    limit,
    resetsAt,
  );
}

/** Housekeeping, from the worker: windows over a day ago are done with. */
export async function pruneAbuseCounters(db: Db): Promise<void> {
  await sql`delete from abuse_counters where starts_at < now() - interval '2 days'`.execute(db);
}
