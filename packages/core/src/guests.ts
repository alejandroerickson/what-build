import { sql } from "kysely";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";
import type { GuestSettings } from "./plans.ts";
import type { CoreConfig } from "./ports.ts";
import type { Principal } from "./registry.ts";
import { readGuests } from "./settings.ts";
import { isInstanceOwner } from "./tenant-allowance.ts";

/**
 * Guests: accounts in no organization, with no allowance to start one, which read the example
 * organization and nothing else. Making an account is free, but coming in is not: each guest holds a
 * place while they work, the places are few (`GuestSettings`), and past them a guest waits in line.
 * People in an organization, people allowed to start one and the instance's owners never wait.
 *
 * A place is held while the guest, or their agent, calls at least every `idle_minutes`; their time
 * in counts towards `minutes_per_day`, which starts again at midnight UTC. Guests coming in for the
 * first time count towards `new_per_day`. Someone waiting keeps their place in line while they ask
 * again at least every two minutes; the web app asks only when they do something, never on a timer.
 */

/** How long someone waiting keeps their place in line without asking again. */
const WAIT_SEEN_MS = 2 * 60_000;
/** How often a guest's time in is written: a call within this of the last one changes nothing. */
const REFRESH_MS = 60_000;

export interface GuestPass {
  status: "in" | "waiting" | "closed";
  /** Why someone is not in: every place is taken, today's new places are taken, their time today is used, or no guest is let in. */
  reason?: "full" | "new_today" | "time_today" | "closed";
  /** Their place in line, while every place is taken. */
  position?: number;
  /** Guests in now. */
  in_now?: number;
  /** When to ask again. */
  retry_after_seconds?: number;
  /** When today's limits start again: midnight UTC. */
  resets_at?: string;
  /** Minutes left today, for a guest who is in. */
  minutes_left?: number;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();

/** Whether the person is a guest account: in no organization, with no allowance, and not an owner of the instance. */
export async function isGuestAccount(db: Db, cfg: Pick<CoreConfig, "instanceOwners">, principal: Pick<Principal, "account_id" | "email">): Promise<boolean> {
  if (isInstanceOwner(cfg as CoreConfig, principal.email)) return false;
  const row = await db
    .selectNoFrom([
      sql<boolean>`EXISTS (SELECT 1 FROM memberships WHERE account_id = ${principal.account_id})`.as("member"),
      sql<boolean>`EXISTS (SELECT 1 FROM tenant_allowances WHERE lower(email) = lower(${principal.email}) AND allowed > 0)`.as("allowed"),
    ])
    .executeTakeFirstOrThrow();
  return !row.member && !row.allowed;
}

/**
 * Let a guest in if there is room, or say why not and how long to wait. In, it keeps their place
 * and counts their time; a guest already in who called within the last minute changes nothing.
 */
export async function enterAsGuest(db: Db, accountId: string, settings?: GuestSettings, now = new Date()): Promise<GuestPass> {
  const s = settings ?? (await readGuests(db));
  const today = ymd(now);
  const resets_at = dayEnd(now);
  const idleMs = s.idle_minutes * 60_000;
  const budget = s.minutes_per_day * 60;
  if (s.at_once <= 0) return { status: "closed", reason: "closed", resets_at };
  const live = (r: { waiting_since: string | null; last_active_at: string | null; day: string }) =>
    r.waiting_since === null && r.last_active_at !== null && r.day === today && now.getTime() - Date.parse(r.last_active_at) < idleMs;
  const left = (seconds: number) => Math.max(0, Math.floor((budget - seconds) / 60));

  // Already in and seen within the minute: nothing to write, no lock to take.
  const mine = await db.selectFrom("guest_passes").selectAll().where("account_id", "=", accountId).executeTakeFirst();
  if (mine && live(mine) && now.getTime() - Date.parse(mine.last_active_at!) < REFRESH_MS && mine.seconds_today < budget)
    return { status: "in", minutes_left: left(mine.seconds_today), resets_at };

  return db.transaction().execute(async (trx) => {
    // One admission at a time, so two guests cannot both take the last place.
    await sql`SELECT pg_advisory_xact_lock(hashtext('whatbuild guest admission'))`.execute(trx);
    const me = await trx.selectFrom("guest_passes").selectAll().where("account_id", "=", accountId).executeTakeFirst();
    const usedToday = me && me.day === today ? me.seconds_today : 0;

    if (me && live(me)) {
      const spent = Math.min(now.getTime() - Date.parse(me.last_active_at!), idleMs) / 1000;
      const seconds = Math.min(budget, Math.round(usedToday + spent));
      await trx.updateTable("guest_passes").set({ seconds_today: seconds, last_active_at: now.toISOString() }).where("account_id", "=", accountId).execute();
      if (seconds >= budget) return { status: "waiting", reason: "time_today", resets_at, retry_after_seconds: Math.ceil((Date.parse(resets_at) - now.getTime()) / 1000) };
      return { status: "in", minutes_left: left(seconds), resets_at };
    }
    if (usedToday >= budget) return { status: "waiting", reason: "time_today", resets_at, retry_after_seconds: Math.ceil((Date.parse(resets_at) - now.getTime()) / 1000) };

    const firstToday = `${today}T00:00:00.000Z`;
    if (!me?.first_in_at) {
      const fresh = await trx.selectFrom("guest_passes").select((eb) => eb.fn.countAll<number>().as("n")).where("first_in_at", ">=", firstToday).executeTakeFirstOrThrow();
      if (Number(fresh.n) >= s.new_per_day) return { status: "waiting", reason: "new_today", resets_at, retry_after_seconds: Math.ceil((Date.parse(resets_at) - now.getTime()) / 1000) };
    }

    const since = new Date(now.getTime() - idleMs).toISOString();
    const inNow = Number(
      (await trx
        .selectFrom("guest_passes")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("waiting_since", "is", null)
        .where("day", "=", today)
        .where("last_active_at", ">", since)
        .where("account_id", "!=", accountId)
        .executeTakeFirstOrThrow()).n,
    );
    const waitingSince = me?.waiting_since ?? now.toISOString();
    const ahead = Number(
      (await trx
        .selectFrom("guest_passes")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("waiting_since", "is not", null)
        .where("waiting_since", "<", waitingSince)
        .where("waiting_seen_at", ">", new Date(now.getTime() - WAIT_SEEN_MS).toISOString())
        .where("account_id", "!=", accountId)
        .executeTakeFirstOrThrow()).n,
    );

    if (s.at_once - inNow > ahead) {
      await trx
        .insertInto("guest_passes")
        .values({ account_id: accountId, first_in_at: now.toISOString(), day: today, seconds_today: usedToday, last_active_at: now.toISOString(), waiting_since: null, waiting_seen_at: null })
        .onConflict((oc) =>
          oc.column("account_id").doUpdateSet({
            first_in_at: sql`coalesce(guest_passes.first_in_at, excluded.first_in_at)`,
            day: today,
            seconds_today: usedToday,
            last_active_at: now.toISOString(),
            waiting_since: null,
            waiting_seen_at: null,
          }),
        )
        .execute();
      return { status: "in", minutes_left: left(usedToday), resets_at };
    }
    await trx
      .insertInto("guest_passes")
      .values({ account_id: accountId, day: today, seconds_today: usedToday, waiting_since: waitingSince, waiting_seen_at: now.toISOString() })
      .onConflict((oc) => oc.column("account_id").doUpdateSet({ waiting_since: waitingSince, waiting_seen_at: now.toISOString() }))
      .execute();
    return { status: "waiting", reason: "full", position: ahead + 1, in_now: inNow, retry_after_seconds: 20, resets_at };
  });
}

/** The refusal a guest's call gets while they are not in: what an agent tells the person, and when to try again. */
export function guestWaiting(pass: GuestPass): AppError {
  const message =
    pass.reason === "full"
      ? `WhatBuild is full for guests right now: ${pass.in_now ?? "every"} ${pass.in_now === 1 ? "guest is" : "guests are"} in, and this person is number ${pass.position} in line. Nothing was done. Wait ${pass.retry_after_seconds} seconds and try again; their place in line is kept while they keep asking.`
      : pass.reason === "new_today"
        ? `Today's places for new guests are taken. Nothing was done. The person can come in after ${pass.resets_at} (midnight UTC); to work in an organization of their own, they can ask whoever runs this WhatBuild.`
        : pass.reason === "time_today"
          ? `This guest has used today's time in WhatBuild. Nothing was done. It starts again at ${pass.resets_at} (midnight UTC).`
          : "WhatBuild is letting no guests in right now. Nothing was done. Ask whoever runs this WhatBuild, or try again later.";
  return new AppError(429, "guest_waiting", message, { ...pass });
}

/** How many guests are in, waiting, and came in for the first time today: for the instance's owners. */
export async function guestCounts(db: Db, settings?: GuestSettings, now = new Date()) {
  const s = settings ?? (await readGuests(db));
  const today = ymd(now);
  const since = new Date(now.getTime() - s.idle_minutes * 60_000).toISOString();
  const row = await db
    .selectNoFrom([
      sql<number>`(SELECT count(*) FROM guest_passes WHERE waiting_since IS NULL AND day = ${today} AND last_active_at > ${since})`.as("in_now"),
      sql<number>`(SELECT count(*) FROM guest_passes WHERE waiting_since IS NOT NULL AND waiting_seen_at > ${new Date(now.getTime() - WAIT_SEEN_MS).toISOString()})`.as("waiting"),
      sql<number>`(SELECT count(*) FROM guest_passes WHERE first_in_at >= ${`${today}T00:00:00.000Z`})`.as("new_today"),
      sql<number>`(SELECT count(*) FROM guest_passes WHERE first_in_at IS NOT NULL)`.as("ever"),
    ])
    .executeTakeFirstOrThrow();
  return { in_now: Number(row.in_now), waiting: Number(row.waiting), new_today: Number(row.new_today), ever: Number(row.ever) };
}
