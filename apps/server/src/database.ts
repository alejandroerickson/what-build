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

export function createDb(databaseUrl: string, max = 10): { db: Kysely<DB>; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    types: { getTypeParser: typeParser as never },
    idleTimeoutMillis: 30_000,
  });
  // Each statement inside a traced request or job is a span of its own (telemetry.ts).
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), log: querySpan });
  return { db, pool };
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
