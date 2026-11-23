import { sql } from "kysely";
import type { ActorSnapshot, Db } from "./db.ts";
import { json } from "./db.ts";
import type { Mailer } from "./ports.ts";
import { readGuests } from "./settings.ts";
import { isInstanceOwner } from "./tenant-allowance.ts";
import { newEtag, newId, utcDay } from "./util.ts";

/**
 * New organizations a day: someone who signs up starts an organization of their own without
 * waiting for an instance owner, up to `organizations_per_day` (the guests' settings) each UTC day.
 * A place is an allowance of 1 that WhatBuild gives, marked as such in `created_by`, and counted on
 * the day it was given. Past the day's places, people join the waitlist (`interest`), and the
 * places still free go to the waitlist first, earliest first, each told by email: when someone asks
 * and, while the service is awake, every few minutes (the worker). Nothing here wakes the service.
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

const dayStart = (now: Date) => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;

/** The mail to someone on the waitlist whose place is ready, since the day they asked. */
export function placeReadyMail(publicBaseUrl: string, to: string, askedAt: string | null) {
  const joined = askedAt && /^\d{4}-\d{2}-\d{2}/.test(askedAt) ? ` on ${utcDay(askedAt)} (UTC)` : "";
  return {
    to,
    subject: "Your place on WhatBuild is ready",
    text: `You joined the WhatBuild waitlist${joined}. Your place is ready.\n\n` + `Start your organization, signing in as ${to}:\n${publicBaseUrl}/welcome\n`,
  };
}

/** Places given today, and how many are left of the day's. */
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
 * Give the day's places that are left to the people waiting, earliest first, and the next to
 * `claimant` if one is still left. One at a time across the deployment, so no place is given twice.
 * Mail goes out once the places are kept. Returns whether `claimant` got one.
 */
export async function givePlaces(db: Db, ports: PlacePorts, claimant?: string, now = new Date()): Promise<{ claimed: boolean; released: string[] }> {
  const { organizations_per_day: perDay } = await readGuests(db);
  if (perDay <= 0) return { claimed: false, released: [] };
  const owners = new Set((ports.config.instanceOwners ?? []).map((e) => e.toLowerCase()));
  const out = await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('whatbuild organizations a day'))`.execute(trx);
    let { left } = await placesToday(trx, perDay, now);
    const released: { email: string; created_at: string }[] = [];
    for (const w of await waiting(trx, owners, left)) {
      if (w.email === claimant) continue;
      if (await give(trx, w.email, now)) {
        released.push(w);
        left--;
      }
    }
    const claimed = Boolean(claimant) && left > 0 && !owners.has(claimant!) && (await give(trx, claimant!, now));
    return { claimed, released };
  });
  if (ports.mailer) for (const r of out.released) await ports.mailer.send(placeReadyMail(ports.config.publicBaseUrl, r.email, r.created_at)).catch(() => undefined);
  return { claimed: out.claimed, released: out.released.map((r) => r.email) };
}

/**
 * Someone signed in asks for an organization of their own: a place of the day if one is left,
 * else the waitlist, keeping their place in it and adding what they sent.
 */
export async function askForOrganization(
  db: Db,
  ports: PlacePorts,
  person: { email: string; display_name: string | null },
  sent: { organization?: string; note?: string } = {},
  now = new Date(),
): Promise<"place" | "waitlist"> {
  const email = person.email.toLowerCase();
  if (!isInstanceOwner({ instanceOwners: ports.config.instanceOwners ?? [] }, email) && (await givePlaces(db, ports, email, now)).claimed) return "place";
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
