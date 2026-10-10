import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

/**
 * A real Postgres for development and tests, with nothing to install: the embedded-postgres
 * package ships the server binaries as an npm dependency. The application connects as a role that
 * owns its tables but is not a superuser, so row-level security is enforced exactly as in production.
 */
export interface LocalPg {
  adminUrl: string;
  appUrl(database: string): string;
  createDatabase(name: string): Promise<string>;
  hasDatabase(name: string): Promise<boolean>;
  stop(): Promise<void>;
}

export const APP_ROLE = "whatbuild";

export async function startLocalPg(dir: string, port: number): Promise<LocalPg> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dataDir = resolve(dir);
  const fresh = !existsSync(`${dataDir}/PG_VERSION`);
  mkdirSync(dataDir, { recursive: true });
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: true, onLog: () => {}, onError: () => {} });
  if (fresh) await server.initialise();
  await server.start();
  const local = localPg(port, () => server.stop());
  const admin = new pg.Client({ connectionString: local.adminUrl });
  await admin.connect();
  const role = await admin.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);
  if (!role.rowCount) await admin.query(`create role ${APP_ROLE} login password '${APP_ROLE}' nosuperuser nobypassrls createdb`);
  await admin.end();
  return local;
}

/** The embedded Postgres in `dir` on `port`: the one already running there, which stop() then leaves running, or one started now. */
export async function connectOrStartLocalPg(dir: string, port: number): Promise<LocalPg> {
  const probe = new pg.Client({ connectionString: `postgres://postgres:postgres@localhost:${port}/postgres`, connectionTimeoutMillis: 2000 });
  try {
    await probe.connect();
    await probe.end();
    return localPg(port, async () => {});
  } catch {
    return startLocalPg(dir, port);
  }
}

function localPg(port: number, stop: () => Promise<void>): LocalPg {
  const adminUrl = `postgres://postgres:postgres@localhost:${port}/postgres`;
  const appUrl = (database: string) => `postgres://${APP_ROLE}:${APP_ROLE}@localhost:${port}/${database}`;
  const hasDatabase = async (name: string) => {
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    const exists = await c.query("select 1 from pg_database where datname = $1", [name]);
    await c.end();
    return Boolean(exists.rowCount);
  };
  return {
    adminUrl,
    appUrl,
    hasDatabase,
    async createDatabase(name: string) {
      if (!(await hasDatabase(name))) {
        const c = new pg.Client({ connectionString: adminUrl });
        await c.connect();
        await c.query(`create database "${name}" owner ${APP_ROLE}`);
        await c.end();
      }
      return appUrl(name);
    },
    stop,
  };
}
