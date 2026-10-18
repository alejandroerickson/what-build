import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

/**
 * A real Postgres for development and tests, with nothing to install: the embedded-postgres
 * package ships the server binaries as an npm dependency. The application connects as a role that
 * owns its tables but is not a superuser, so row-level security is enforced exactly as in production.
 */
export interface LocalPg {
  adminUrl: string;
  /**
   * The cluster's encoding, as its template database has it: `UTF8` for every cluster made since
   * local clusters are made in UTF-8, `SQL_ASCII` for one made before.
   */
  encoding: string;
  appUrl(database: string): string;
  createDatabase(name: string): Promise<string>;
  hasDatabase(name: string): Promise<boolean>;
  stop(): Promise<void>;
}

export const APP_ROLE = "whatbuild";

/**
 * How a new cluster is made: in UTF-8, with the C.UTF-8 locale that Neon's databases use by
 * default, so text functions count characters, text sorts by code point, and full-text search and
 * trigrams read letters beyond ASCII as production does. Left to itself, embedded-postgres runs
 * initdb with only LC_MESSAGES set, which makes a SQL_ASCII cluster in the C locale, where text
 * functions count bytes. A system without a C.UTF-8 locale gets PostgreSQL's own (`builtin`)
 * C.UTF-8 instead, which sorts and changes case as it does, but whose full-text search and
 * trigrams take only ASCII letters for letters.
 */
export const UTF8_CLUSTER = ["--encoding=UTF8", "--locale=C.UTF-8"];
export const UTF8_CLUSTER_BUILTIN = ["--encoding=UTF8", "--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--locale=C"];

export interface LocalPgOptions {
  /**
   * The cluster holds nothing to keep (the tests', the end-to-end instance's), so one made before
   * local clusters were UTF-8 is made again in its place.
   */
  disposable?: boolean;
  /** The environment variable that moves the cluster's port, which a refusal names when another server holds it. */
  portVariable?: string;
}

const adminUrlOf = (port: number) => `postgres://postgres:postgres@localhost:${port}/postgres`;

/**
 * What answers on `port`: null when nothing does; the data directory of a cluster that answers as
 * this repository's clusters do (user and password `postgres`); undefined for any other server.
 */
async function serverOn(port: number): Promise<string | null | undefined> {
  const c = new pg.Client({ connectionString: adminUrlOf(port), connectionTimeoutMillis: 2000 });
  c.on("error", () => {});
  try {
    await c.connect();
  } catch (e) {
    return (e as { code?: string }).code === "ECONNREFUSED" ? null : undefined;
  }
  try {
    return (await c.query<{ data_directory: string }>("show data_directory")).rows[0]?.data_directory;
  } catch {
    return undefined;
  } finally {
    await c.end().catch(() => {});
  }
}

const samePath = (a: string, b: string) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
};

/**
 * A checkout uses only its own clusters, so that no tool of one drops or makes a database in
 * another's: a server on the port that is not this checkout's cluster is refused, named.
 */
function notOurs(port: number, dataDir: string, found: string | undefined, variable: string | undefined): Error {
  const move = `choose another port for this checkout's${variable ? ` with ${variable}` : ""}`;
  return new Error(
    found
      ? `Port ${port} is taken by another checkout's Postgres, whose data directory is ${found}; this checkout's is ${dataDir}. Stop the other one, or ${move}.`
      : `Port ${port} is taken by a server that is not this checkout's Postgres, whose data directory is ${dataDir}. Stop that server, or ${move}.`,
  );
}

/** The encoding the cluster on `port` makes databases in: its template database's. */
async function clusterEncoding(port: number): Promise<string> {
  const c = new pg.Client({ connectionString: adminUrlOf(port) });
  await c.connect();
  try {
    const r = await c.query<{ encoding: string }>("select pg_encoding_to_char(encoding) as encoding from pg_database where datname = 'template1'");
    return r.rows[0]?.encoding ?? "";
  } finally {
    await c.end();
  }
}

/**
 * Start the cluster in `dir` on `port`, making it first if it does not exist, or again if it is
 * disposable and was made before local clusters were UTF-8. Refused, before anything is made or
 * started, when a server already answers on the port: this checkout's cluster already running, or
 * another's.
 */
export async function startLocalPg(dir: string, port: number, options: LocalPgOptions = {}): Promise<LocalPg> {
  const dataDir = resolve(dir);
  const found = await serverOn(port);
  if (found !== null) {
    if (found !== undefined && samePath(found, dataDir)) throw new Error(`This checkout's Postgres, in ${dataDir}, is already running on port ${port}: stop what runs it, then try again.`);
    throw notOurs(port, dataDir, found, options.portVariable);
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const server = (initdbFlags: string[]) =>
    new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: true, initdbFlags, onLog: () => {}, onError: () => {} });
  let running = server(UTF8_CLUSTER);
  const make = async () => {
    mkdirSync(dataDir, { recursive: true });
    try {
      await running.initialise();
    } catch {
      // initdb refuses a locale the system does not have, and leaves the directory empty.
      rmSync(dataDir, { recursive: true, force: true });
      mkdirSync(dataDir, { recursive: true });
      running = server(UTF8_CLUSTER_BUILTIN);
      await running.initialise();
    }
  };
  if (!existsSync(`${dataDir}/PG_VERSION`)) await make();
  await running.start();
  let encoding = await clusterEncoding(port);
  if (encoding !== "UTF8" && options.disposable) {
    await running.stop();
    rmSync(dataDir, { recursive: true, force: true });
    running = server(UTF8_CLUSTER);
    await make();
    await running.start();
    encoding = await clusterEncoding(port);
  }
  const local = localPg(port, encoding, () => running.stop());
  const admin = new pg.Client({ connectionString: local.adminUrl });
  await admin.connect();
  const role = await admin.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);
  if (!role.rowCount) await admin.query(`create role ${APP_ROLE} login password '${APP_ROLE}' nosuperuser nobypassrls createdb`);
  await admin.end();
  return local;
}

/**
 * The embedded Postgres in `dir` on `port`: the one already running there, which stop() then leaves
 * running, or one started now. A server on the port is used only when it is that cluster, this
 * checkout's (its `data_directory` is `dir`); another checkout's, or any other server, is refused.
 * A disposable cluster already running that was made before local clusters were UTF-8 cannot be made
 * again while it runs, so it is refused too.
 */
export async function connectOrStartLocalPg(dir: string, port: number, options: LocalPgOptions = {}): Promise<LocalPg> {
  const dataDir = resolve(dir);
  const found = await serverOn(port);
  if (found === null) return startLocalPg(dir, port, options);
  if (found === undefined || !samePath(found, dataDir)) throw notOurs(port, dataDir, found, options.portVariable);
  const encoding = await clusterEncoding(port);
  if (encoding !== "UTF8" && options.disposable) {
    throw new Error(
      `The Postgres running on port ${port} was made in ${encoding}, before local clusters were made in UTF-8. It holds nothing to keep, but it cannot be made again while it runs: stop what runs it, then try again.`,
    );
  }
  return localPg(port, encoding, async () => {});
}

function localPg(port: number, encoding: string, stop: () => Promise<void>): LocalPg {
  const adminUrl = adminUrlOf(port);
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
    encoding,
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
