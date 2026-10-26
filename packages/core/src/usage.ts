import { createHmac } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import type { Db } from "./db.ts";
import type { Ports } from "./ports.ts";
import type { OperationDef, Principal } from "./registry.ts";
import { isInstanceOwner } from "./tenant-allowance.ts";

/**
 * How the service is used, counted on the server for every call to an operation, whichever door it
 * came through: which operation, from the web app or which kind of agent, in the example
 * organization or not, and how it ended. Nothing names an organization, a product, a record, an
 * address or anything anyone wrote. People are counted under a pseudonym, a keyed hash of their account that only this
 * deployment can compute, so a report says how many came back without saying who. A person's days
 * are kept for 14 months, as long as Google Analytics keeps an event; the counts of calls, which
 * name nobody, are kept.
 */

export const USAGE_PEOPLE_MONTHS = 14;

/** An agent client's family, from the name it registered with. The name is the client's own choice, often with the person's label for the connection in it, so only the family is kept. */
const CLIENT_FAMILIES: [RegExp, string][] = [
  [/claude[\s_-]*code/i, "Claude Code"],
  [/claude/i, "Claude"],
  [/codex/i, "Codex"],
  [/chatgpt|openai/i, "ChatGPT"],
  [/cursor/i, "Cursor"],
  [/copilot|visual studio code|vs ?code/i, "VS Code"],
  [/windsurf|codeium/i, "Windsurf"],
  [/gemini/i, "Gemini"],
  [/\bzed\b/i, "Zed"],
  [/goose/i, "Goose"],
  [/inspector/i, "MCP Inspector"],
];

export function clientFamily(principal: Pick<Principal, "surface" | "client">): string {
  if (principal.surface !== "mcp") return "";
  const name = principal.client ?? "";
  return CLIENT_FAMILIES.find(([pattern]) => pattern.test(name))?.[1] ?? "other";
}

/** The pseudonym a person's use is counted under. Without the deployment's key it names nobody. */
export function personOf(key: string, accountId: string): string {
  return createHmac("sha256", key).update(accountId).digest("base64url").slice(0, 22);
}

export interface UsageCall {
  /** The operation's name; `<tool>.(unknown)` for an MCP call to an action that does not exist, `(unknown tool)` for a tool that does not. */
  operation: string;
  /** The part of WhatBuild: the operation's MCP tool. Null for a call that reached no operation, which counts no person. */
  feature: string | null;
  /** `ok`, or the error's code. */
  outcome: string;
  example: boolean;
}

interface CallRow {
  day: string;
  operation: string;
  surface: string;
  client: string;
  example: boolean;
  owner: boolean;
  outcome: string;
  calls: number;
}
type PersonRow = Omit<CallRow, "operation" | "outcome" | "calls"> & { person: string; feature: string };

/** Counts not yet written, per database: added up here and written together, so a burst of calls is one write. */
const buffers = new Map<Db, { calls: Map<string, CallRow>; people: Map<string, PersonRow> }>();
const writing = new Set<Promise<void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWarned = 0;
/** How long counts wait before they are written, and how many rows make a write at once. */
const FLUSH_MS = 10_000;
const FLUSH_ROWS = 500;

/**
 * Counts one call. It never delays or fails the call: counts are added up in memory and written
 * every ten seconds, and a failed write is logged at most once a minute. Seeding and the server's
 * own work are not counted.
 */
export function countCall(env: { db: Db; ports: Ports }, principal: Principal, call: UsageCall): void {
  if (principal.auth_kind === "system" || principal.auth_kind === "dev") return;
  const day = new Date().toISOString().slice(0, 10);
  const surface = principal.surface ?? "system";
  const client = clientFamily(principal);
  const owner = isInstanceOwner(env.ports.config, principal.email);
  const buffer = buffers.get(env.db) ?? { calls: new Map(), people: new Map() };
  buffers.set(env.db, buffer);
  const key = [day, call.operation, surface, client, call.example, owner, call.outcome].join("\u0000");
  const counted = buffer.calls.get(key);
  if (counted) counted.calls += 1;
  else buffer.calls.set(key, { day, operation: call.operation, surface, client, example: call.example, owner, outcome: call.outcome, calls: 1 });
  const usageKey = env.ports.config.usageKey;
  if (usageKey && call.feature && !forgotten.has(principal.account_id)) {
    const person = personOf(usageKey, principal.account_id);
    buffer.people.set([day, person, call.feature, surface, client, call.example].join("\u0000"), { day, person, feature: call.feature, surface, client, example: call.example, owner });
  }
  if (buffer.calls.size + buffer.people.size >= FLUSH_ROWS) keep(write(env.db));
  else timer ??= setTimeout(writeAll, FLUSH_MS);
  timer?.unref?.();
}

function keep(p: Promise<void>) {
  writing.add(p);
  void p.finally(() => writing.delete(p));
}

function writeAll() {
  timer = null;
  for (const db of [...buffers.keys()]) keep(write(db));
}

async function write(db: Db): Promise<void> {
  const buffer = buffers.get(db);
  buffers.delete(db);
  if (!buffer) return;
  try {
    if (buffer.calls.size)
      await db
        .insertInto("usage_calls")
        .values([...buffer.calls.values()])
        .onConflict((oc) => oc.columns(["day", "operation", "surface", "client", "example", "owner", "outcome"]).doUpdateSet({ calls: sql<number>`usage_calls.calls + excluded.calls` }))
        .execute();
    if (buffer.people.size) await db.insertInto("usage_people").values([...buffer.people.values()]).onConflict((oc) => oc.doNothing()).execute();
  } catch (e) {
    if (Date.now() - lastWarned < 60_000) return;
    lastWarned = Date.now();
    console.error(`usage: ${buffer.calls.size} counts were not written: ${(e as Error).message}`);
  }
}

/** Writes every count made so far, and waits for it: before a test reads the counts, and before shutting down. */
export async function usageSettled(): Promise<void> {
  if (timer) clearTimeout(timer);
  writeAll();
  while (writing.size) await Promise.all([...writing]);
}

/** Accounts deleted in the last minute: a call of theirs still finishing, the delete itself among them, counts no day for them. */
const forgotten = new Map<string, number>();

/**
 * Forget a person's counted days, when their account is deleted: the ones written, in the caller's
 * transaction, and the ones this process holds but has not written yet. The calls stay counted;
 * they name nobody.
 */
export async function forgetPerson(db: Db, key: string | undefined, accountId: string): Promise<number> {
  const now = Date.now();
  for (const [id, at] of forgotten) if (now - at > 60_000) forgotten.delete(id);
  forgotten.set(accountId, now);
  if (!key) return 0;
  const person = personOf(key, accountId);
  for (const buffer of buffers.values()) for (const [k, row] of buffer.people) if (row.person === person) buffer.people.delete(k);
  return Number((await db.deleteFrom("usage_people").where("person", "=", person).executeTakeFirst()).numDeletedRows);
}

/** A person's days older than they are kept. The worker runs it with its housekeeping. */
export async function pruneUsage(db: Db): Promise<void> {
  await sql`delete from usage_people where day < (now() at time zone 'utc')::date - make_interval(months => ${USAGE_PEOPLE_MONTHS})`.execute(db);
}

export interface UsageOptions {
  days: number;
  include_owners: boolean;
  example: "include" | "exclude" | "only";
}

const isFailure = (outcome: string) => outcome !== "ok";
const feature = (operation: string, byName: Map<string, OperationDef>) => byName.get(operation)?.mcp.tool ?? (operation.includes(".") ? operation.split(".")[0]! : "(unknown)");

/**
 * The report the instance's owners read: calls and people over the last `days` days (today, UTC,
 * included), by operation, part of WhatBuild, door and agent client; failures by code; operations
 * nobody called; and people by week, new and returning, with each week's newcomers followed through
 * every week since. Weeks run Monday to Sunday, so the first one may start before the period.
 */
export async function usageReport(db: Db, operations: OperationDef[], opts: UsageOptions, today = new Date()) {
  const to = today.toISOString().slice(0, 10);
  const from = new Date(Date.parse(to) - (opts.days - 1) * 86400_000).toISOString().slice(0, 10);
  const counted: RawBuilder<unknown> = sql`(${opts.include_owners}::boolean or not owner) and ${
    opts.example === "exclude" ? sql`not example` : opts.example === "only" ? sql`example` : sql`true`
  }`;
  const inPeriod = sql`day between ${from}::date and ${to}::date`;
  const byName = new Map(operations.map((o) => [o.name, o]));

  const [callRows, since, peopleRow, returnRow, weekRows, cohortRows, featureRows, clientRows] = await Promise.all([
    sql<{ operation: string; surface: string; client: string; outcome: string; calls: number }>`
      select operation, surface, client, outcome, sum(calls)::int as calls from usage_calls
      where ${inPeriod} and ${counted} group by 1, 2, 3, 4`.execute(db),
    sql<{ calls: string | null; people: string | null }>`
      select (select min(day)::text from usage_calls) as calls, (select min(day)::text from usage_people) as people`.execute(db),
    sql<{ active: number; web: number; agents: number }>`
      select count(distinct person)::int as active,
        count(distinct person) filter (where surface = 'web')::int as web,
        count(distinct person) filter (where surface = 'mcp')::int as agents
      from usage_people where ${inPeriod} and ${counted}`.execute(db),
    sql<{ new: number; returning: number; one: number; two_three: number; four_seven: number; eight: number }>`
      with mine as (select person, day from usage_people where ${counted} group by 1, 2),
        firsts as (select person, min(day) as first_day from mine group by 1),
        period as (select person, count(*)::int as days from mine where ${inPeriod} group by 1)
      select count(*) filter (where f.first_day >= ${from}::date)::int as new,
        count(*) filter (where f.first_day < ${from}::date)::int as returning,
        count(*) filter (where p.days = 1)::int as one,
        count(*) filter (where p.days between 2 and 3)::int as two_three,
        count(*) filter (where p.days between 4 and 7)::int as four_seven,
        count(*) filter (where p.days >= 8)::int as eight
      from period p join firsts f using (person)`.execute(db),
    sql<{ week: string; active: number; new: number }>`
      with mine as (select person, date_trunc('week', day)::date as week from usage_people where ${counted} group by 1, 2),
        firsts as (select person, min(week) as first_week from mine group by 1)
      select m.week::text as week, count(*)::int as active, count(*) filter (where f.first_week = m.week)::int as new
      from mine m join firsts f using (person)
      where m.week >= date_trunc('week', ${from}::date)::date and m.week <= ${to}::date
      group by 1 order by 1`.execute(db),
    sql<{ cohort: string; after: number; people: number }>`
      with mine as (select person, date_trunc('week', day)::date as week from usage_people where ${counted} group by 1, 2),
        firsts as (select person, min(week) as first_week from mine group by 1)
      select f.first_week::text as cohort, ((m.week - f.first_week) / 7)::int as after, count(*)::int as people
      from mine m join firsts f using (person)
      where f.first_week >= date_trunc('week', ${from}::date)::date and m.week <= ${to}::date
      group by 1, 2 order by 1, 2`.execute(db),
    sql<{ feature: string; people: number; web: number; agents: number }>`
      select feature, count(distinct person)::int as people,
        count(distinct person) filter (where surface = 'web')::int as web,
        count(distinct person) filter (where surface = 'mcp')::int as agents
      from usage_people where ${inPeriod} and ${counted} group by 1`.execute(db),
    sql<{ client: string; people: number }>`
      select client, count(distinct person)::int as people from usage_people
      where surface = 'mcp' and ${inPeriod} and ${counted} group by 1`.execute(db),
  ]);

  const calls = { total: 0, web: 0, agents: 0, failed: 0 };
  const ops = new Map<string, { operation: string; calls: number; web: number; agents: number; failed: number }>();
  const featureCalls = new Map<string, number>();
  const clientCalls = new Map<string, number>();
  const failures = new Map<string, { operation: string; outcome: string; calls: number }>();
  for (const r of callRows.rows) {
    const web = r.surface === "web" ? r.calls : 0;
    const agents = r.surface === "mcp" ? r.calls : 0;
    const failed = isFailure(r.outcome) ? r.calls : 0;
    calls.total += r.calls;
    calls.web += web;
    calls.agents += agents;
    calls.failed += failed;
    const o = ops.get(r.operation) ?? { operation: r.operation, calls: 0, web: 0, agents: 0, failed: 0 };
    o.calls += r.calls;
    o.web += web;
    o.agents += agents;
    o.failed += failed;
    ops.set(r.operation, o);
    const f = feature(r.operation, byName);
    featureCalls.set(f, (featureCalls.get(f) ?? 0) + r.calls);
    if (r.surface === "mcp") clientCalls.set(r.client, (clientCalls.get(r.client) ?? 0) + r.calls);
    if (failed) {
      const k = `${r.operation} ${r.outcome}`;
      const e = failures.get(k) ?? { operation: r.operation, outcome: r.outcome, calls: 0 };
      e.calls += r.calls;
      failures.set(k, e);
    }
  }

  const peopleIn = new Map(featureRows.rows.map((r) => [r.feature, r]));
  const features = [...new Set([...featureCalls.keys(), ...peopleIn.keys()])]
    .map((f) => ({ feature: f, people: peopleIn.get(f)?.people ?? 0, web_people: peopleIn.get(f)?.web ?? 0, agent_people: peopleIn.get(f)?.agents ?? 0, calls: featureCalls.get(f) ?? 0 }))
    .sort((a, b) => b.people - a.people || b.calls - a.calls);
  const clientPeople = new Map(clientRows.rows.map((r) => [r.client, r.people]));
  const clients = [...new Set([...clientCalls.keys(), ...clientPeople.keys()])]
    .map((c) => ({ client: c, people: clientPeople.get(c) ?? 0, calls: clientCalls.get(c) ?? 0 }))
    .sort((a, b) => b.people - a.people || b.calls - a.calls);

  // A cohort is followed through every week up to this one, so a week nobody came back in shows as 0.
  const monday = (iso: string) => {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return t - ((new Date(t).getUTCDay() + 6) % 7) * 86400_000;
  };
  const thisWeek = monday(to);
  const cohorts = new Map<string, number[]>();
  for (const r of cohortRows.rows) {
    const weeks = cohorts.get(r.cohort) ?? [];
    weeks[r.after] = r.people;
    cohorts.set(r.cohort, weeks);
  }
  const p = peopleRow.rows[0]!;
  const back = returnRow.rows[0]!;
  return {
    from,
    to,
    days: opts.days,
    owners: opts.include_owners ? "included" : "excluded",
    example: opts.example,
    counting_since: { calls: since.rows[0]?.calls ?? null, people: since.rows[0]?.people ?? null },
    people: {
      active: p.active,
      web: p.web,
      agents: p.agents,
      new: back.new,
      returning: back.returning,
      days_active: { "1": back.one, "2-3": back.two_three, "4-7": back.four_seven, "8+": back.eight },
      weeks: weekRows.rows.map((w) => ({ week: w.week, active: w.active, new: w.new, returning: w.active - w.new })),
      cohorts: [...cohorts].map(([week, weeks]) => ({
        week,
        people: weeks[0] ?? 0,
        weeks_after: Array.from({ length: Math.max(0, Math.round((thisWeek - monday(week)) / (7 * 86400_000))) }, (_, i) => weeks[i + 1] ?? 0),
      })),
    },
    calls,
    features,
    operations: [...ops.values()].sort((a, b) => b.calls - a.calls),
    clients,
    failures: [...failures.values()].sort((a, b) => b.calls - a.calls),
    not_called: operations.map((o) => o.name).filter((n) => !ops.has(n)),
  };
}
