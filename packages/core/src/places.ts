import { sql } from "kysely";
import type { ActorSnapshot, Db } from "./db.ts";
import { json } from "./db.ts";
import type { CoreConfig, Mailer } from "./ports.ts";
import { readGuests } from "./settings.ts";
import { newEtag, newId, utcDay } from "./util.ts";

/**
 * New organizations a day: someone who signs up starts an organization of their own without
 * waiting for an instance owner, up to `organizations_per_day` (the guests' settings) each UTC day.
 * A place is an allowance of 1 that WhatBuild gives, marked as such in `created_by`, and counted on
 * the day it was given.
 *
 * Nobody holds a place by asking for one. Start using WhatBuild only says whether one is open
 * (`placeOpen`), and the place is given in the transaction that creates the organization
 * (`takePlace`), under one lock across the deployment: the day's number holds however many start at
 * once, and someone who opens the Welcome form and leaves uses none. Past the day's places, people
 * join the waitlist (`interest`), and the places still free go to the waitlist first, earliest
 * first: each is held for its person, who is told by email, and counts on the day it was given.
 * They are given when someone asks and, while the service is awake, every few minutes (the
 * worker). Nothing here wakes the service.
 *
 * The number is the deployment's: nothing tells a visitor how many places there are.
 */

/** Who gives a place: WhatBuild itself, so the instance's page shows no owner gave it. */
const GIVER_CLIENT = "whatbuild:organizations-a-day";
const giver: ActorSnapshot = { account_id: "", display_name: "New organizations a day", surface: null, client: GIVER_CLIENT };

/** The ports a place needs: who runs the instance, where to send people, and the mail. */
export interface PlacePorts {
  config: { publicBaseUrl: string; instanceOwners?: string[] };
  mailer?: Mailer;
}

/** Someone who may take a place: their account, and the address its allowance would be given to. */
export interface PlaceTaker {
  account_id: string;
  email: string;
}

const dayStart = (now: Date) => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
const ownersOf = (config: Pick<CoreConfig, "instanceOwners">) => new Set((config.instanceOwners ?? []).map((e) => e.toLowerCase()));
const taker = (who: PlaceTaker): PlaceTaker => ({ account_id: who.account_id, email: who.email.trim().toLowerCase() });

/** One at a time across the deployment, so no place is given twice and the day's number holds. */
const lockPlaces = (db: Db) => sql`SELECT pg_advisory_xact_lock(hashtext('whatbuild organizations a day'))`.execute(db);

/** The mail to someone on the waitlist whose place is ready, since the day they asked. */
export function placeReadyMail(publicBaseUrl: string, to: string, askedAt: string | null) {
  const joined = askedAt && /^\d{4}-\d{2}-\d{2}/.test(askedAt) ? ` on ${utcDay(askedAt)} (UTC)` : "";
  return {
    to,
    subject: "Your place on WhatBuild is ready",
    text: `You joined the WhatBuild waitlist${joined}. Your place is ready.\n\n` + `Start your organization, signing in as ${to}:\n${publicBaseUrl}/welcome\n`,
  };
}

/**
 * Places given today, and how many are left of the day's: those organizations were started on, and
 * those held for people let in from the waitlist.
 */
export async function placesToday(db: Db, perDay: number, now = new Date()): Promise<{ given: number; left: number }> {
  const row = await db
    .selectFrom("tenant_allowances")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where(sql<string>`created_by->>'client'`, "=", GIVER_CLIENT)
    .where("created_at", ">=", dayStart(now))
    .executeTakeFirst();
  const given = Number(row?.n ?? 0);
  return { given, left: Math.max(0, perDay - given) };
}

/** Give an address a place, unless an instance owner already set its allowance (0 included, which keeps it out). */
async function give(db: Db, email: string, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const made = await db
    .insertInto("tenant_allowances")
    .values({ email, allowed: 1, note: "", etag: newEtag(), created_at: at, created_by: json(giver), updated_at: at, updated_by: json(giver) })
    .onConflict((oc) => oc.column("email").doNothing())
    .returning("email")
    .executeTakeFirst();
  return Boolean(made);
}

/** The people waiting: asked for an organization, have no allowance, are not an owner; earliest first. */
async function waiting(db: Db, owners: Set<string>, n: number) {
  if (n <= 0) return [];
  const rows = await db
    .selectFrom("interest as i")
    .leftJoin("tenant_allowances as a", (j) => j.on(sql`a.email`, "=", sql`lower(i.email)`))
    .select([sql<string>`lower(i.email)`.as("email"), "i.created_at"])
    .where("a.email", "is", null)
    .orderBy("i.created_at")
    .limit(n + owners.size)
    .execute();
  return rows.filter((r) => !owners.has(r.email)).slice(0, n);
}

/**
 * Whether an account may take a place at all: it is no instance owner, its address has no allowance
 * of its own (an owner's 0 keeps it out), and it is in no organization yet.
 */
async function mayTakePlace(db: Db, owners: Set<string>, who: PlaceTaker): Promise<boolean> {
  if (owners.has(who.email)) return false;
  const row = await db
    .selectNoFrom([
      sql<boolean>`EXISTS (SELECT 1 FROM tenant_allowances WHERE email = ${who.email})`.as("allowance"),
      sql<boolean>`EXISTS (SELECT 1 FROM memberships WHERE account_id = ${who.account_id})`.as("member"),
    ])
    .executeTakeFirstOrThrow();
  return !row.allowance && !row.member;
}

/** Whether one of the day's places is left for an address once the people waiting before it have theirs. */
async function placeLeftFor(db: Db, perDay: number, owners: Set<string>, email: string, now: Date): Promise<boolean> {
  const { left } = await placesToday(db, perDay, now);
  if (left <= 0) return false;
  const ahead = await waiting(db, owners, left);
  return ahead.length < left || ahead.some((w) => w.email === email);
}

/**
 * Whether an account may start an organization now on one of the day's places: the deployment gives
 * them, the account may take one, and one is left after the people waiting. Nothing is held for it,
 * so someone else may take the place first.
 */
export async function placeOpen(db: Db, config: Pick<CoreConfig, "instanceOwners">, who: PlaceTaker, now = new Date()): Promise<boolean> {
  const { organizations_per_day: perDay } = await readGuests(db);
  if (perDay <= 0) return false;
  const owners = ownersOf(config);
  const me = taker(who);
  return (await mayTakePlace(db, owners, me)) && (await placeLeftFor(db, perDay, owners, me.email, now));
}

/**
 * Take one of the day's places, in the transaction that creates the account's organization, under
 * the lock: two people starting at once cannot both take the last place. `taken`: the place is the
 * account's allowance now. `gone`: none is left for it. `none`: the account takes no place, because
 * the deployment gives none or the account may not take one.
 */
export async function takePlace(trx: Db, config: Pick<CoreConfig, "instanceOwners">, who: PlaceTaker, now = new Date()): Promise<"taken" | "gone" | "none"> {
  const { organizations_per_day: perDay } = await readGuests(trx);
  if (perDay <= 0) return "none";
  const owners = ownersOf(config);
  const me = taker(who);
  await lockPlaces(trx);
  if (!(await mayTakePlace(trx, owners, me))) return "none";
  if (!(await placeLeftFor(trx, perDay, owners, me.email, now))) return "gone";
  return (await give(trx, me.email, now)) ? "taken" : "none";
}

/**
 * Give the day's places that are left to the people waiting, earliest first, each held for its
 * person. `claimant`, someone asking now, is answered at once rather than by email when theirs is
 * among them. Mail goes out once the places are kept. Returns whether `claimant` got one.
 */
export async function givePlaces(db: Db, ports: PlacePorts, claimant?: string, now = new Date()): Promise<{ claimed: boolean; released: string[] }> {
  const { organizations_per_day: perDay } = await readGuests(db);
  if (perDay <= 0) return { claimed: false, released: [] };
  const owners = ownersOf(ports.config);
  const out = await db.transaction().execute(async (trx) => {
    await lockPlaces(trx);
    const { left } = await placesToday(trx, perDay, now);
    const released: { email: string; created_at: string }[] = [];
    let claimed = false;
    for (const w of await waiting(trx, owners, left)) {
      if (!(await give(trx, w.email, now))) continue;
      if (w.email === claimant) claimed = true;
      else released.push(w);
    }
    return { claimed, released };
  });
  if (ports.mailer) for (const r of out.released) await ports.mailer.send(placeReadyMail(ports.config.publicBaseUrl, r.email, r.created_at)).catch(() => undefined);
  return { claimed: out.claimed, released: out.released.map((r) => r.email) };
}

/**
 * Someone signed in asks for an organization of their own. `place`: they may start one now, on the
 * place held for them from the waitlist or on one of the day's places that is open, which they take
 * only by starting it. `waitlist`: none is open, so they join the waitlist, keeping their place in
 * it and adding what they sent.
 */
export async function askForOrganization(
  db: Db,
  ports: PlacePorts,
  person: PlaceTaker & { display_name: string | null },
  sent: { organization?: string; note?: string } = {},
  now = new Date(),
): Promise<"place" | "waitlist"> {
  const email = person.email.trim().toLowerCase();
  if (!ownersOf(ports.config).has(email)) {
    if ((await givePlaces(db, ports, email, now)).claimed) return "place";
    if (await placeOpen(db, ports.config, { account_id: person.account_id, email }, now)) return "place";
  }
  await db
    .insertInto("interest")
    .values({ interest_id: newId(), email, name: person.display_name, organization: sent.organization || null, note: sent.note || null })
    .onConflict((oc) =>
      oc.expression(sql`lower(email)`).doUpdateSet({
        name: sql`coalesce(excluded.name, interest.name)`,
        organization: sql`coalesce(excluded.organization, interest.organization)`,
        note: sql`coalesce(excluded.note, interest.note)`,
        updated_at: sql`now()`,
      }),
    )
    .execute();
  return "waitlist";
}
