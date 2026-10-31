import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DB } from "@whatbuild/core";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { querySpan } from "./telemetry.ts";

const TIMESTAMPTZ = 1184;
const TIMESTAMP = 1114;
const DATE = 1082;
const INT8 = 20;

/** Connections return ISO strings for timestamps, plain strings for dates, and numbers for counts. */
function typeParser(oid: number, format?: string): (v: string) => unknown {
  if (oid === TIMESTAMPTZ || oid === TIMESTAMP) return (v) => new Date(v.includes("+") || v.endsWith("Z") || /-\d\d$/.test(v) ? v : v + "Z").toISOString();
  if (oid === DATE) return (v) => v;
  if (oid === INT8) return (v) => Number(v);
  return pg.types.getTypeParser(oid, format as "text");
}

/**
 * How long a request waits for a connection before it is answered that the server is busy, rather
 * than hanging for as long as whatever holds them all does. It is ample for a Postgres that suspends
 * when idle to wake.
 */
const CONNECTION_WAIT_MS = 15_000;

export function createDb(databaseUrl: string, max = 10, connectionWaitMs = CONNECTION_WAIT_MS): { db: Kysely<DB>; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    types: { getTypeParser: typeParser as never },
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: connectionWaitMs,
  });
  // A connection the database drops (a hosted Postgres restarting its compute, say) is an 'error'
  // event on its client, and one nothing listens for stops the process with every request it was
  // serving. The pool listens while a client is idle and re-emits on itself; while a client is
  // checked out nothing does, so every client gets a listener of its own. A statement the connection
  // was running fails as any other would, and the pool replaces the connection.
  pool.on("connect", (client) =>
    client.on("error", (e) => console.warn(JSON.stringify({ at: new Date().toISOString(), severity: "WARNING", event: "database_connection_lost", message: e.message.slice(0, 300) }))),
  );
  pool.on("error", () => {
    // An idle client's error, which its own listener above has logged.
  });
  // Each statement inside a traced request or job is a span of its own (telemetry.ts).
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), log: querySpan });
  return { db, pool };
}

/**
 * Say so when requests have been waiting for a connection across two looks at the pool. Severity
 * ERROR, so the log's alert mails it: every connection is held, and the service's health check,
 * which reads no database, still answers. It says how many, and how many searches, and nothing else.
 */
export function watchPool(pool: Pick<pg.Pool, "totalCount" | "idleCount" | "waitingCount">, searches: { running: number; waiting: number }, everyMs = 10_000, log: (line: string) => void = console.error): () => void {
  let waited = false;
  const timer = setInterval(() => {
    const waiting = pool.waitingCount > 0;
    if (waiting && waited)
      log(JSON.stringify({ at: new Date().toISOString(), severity: "ERROR", event: "database_pool_saturated", connections: pool.totalCount, idle: pool.idleCount, requests_waiting: pool.waitingCount, searches_running: searches.running, searches_waiting: searches.waiting }));
    waited = waiting;
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

const MIGRATIONS = fileURLToPath(new URL("./migrations/", import.meta.url));

/** The migrations this version carries, by file name, in the order they run. */
export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
}

/**
 * Forward-only migrations: numbered SQL files next to this module (and next to the bundle in
 * production), each applied once in its own transaction and recorded in the same one.
 */
export async function migrate(db: Kysely<DB>, log: (msg: string) => void = console.log): Promise<string[]> {
  const files = migrationNames();
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`.execute(db);
  const applied = new Set((await sql<{ name: string }>`select name from schema_migrations`.execute(db)).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const text = readFileSync(`${MIGRATIONS}${f}`, "utf8");
    await db.transaction().execute(async (trx) => {
      await sql.raw(text).execute(trx);
      await sql`insert into schema_migrations (name) values (${f})`.execute(trx);
    });
    log(`migrated ${f}`);
    ran.push(f);
  }
  return ran;
}

/** Row-level security is not enforced for superusers or roles with BYPASSRLS. Say so loudly. */
export async function checkRowSecurity(db: Kysely<DB>): Promise<{ enforced: boolean; role: string }> {
  const r = await sql<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>`
    select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`.execute(db);
  const row = r.rows[0];
  return { enforced: Boolean(row && !row.rolsuper && !row.rolbypassrls), role: row?.rolname ?? "unknown" };
}
