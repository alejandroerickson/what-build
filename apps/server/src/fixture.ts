import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { json, newId, type Db } from "@whatbuild/core";
import pg from "pg";
import { findOrCreateAccount } from "./auth/identity.ts";
import { SEED_ACCOUNTS } from "./seed.ts";
import { APP_ROLE, connectOrStartLocalPg, type LocalPg } from "./testing/pg.ts";

/**
 * A copy of a deployment, for manual QA and agent-driven end-to-end tests
 * (okf/operations/a-copy-of-production.md). It holds real people's data, so it lives under
 * .what-build/, which git ignores, and goes nowhere else.
 *
 *   pnpm fixture pull         dump the deployment's database and copy its files into
 *                             .what-build/fixtures/<UTC time>/
 *   pnpm fixture load [name]  put a pulled copy (the newest by default) into the embedded Postgres as
 *                             the database "fixture", with a working copy of its files
 *   pnpm dev:fixture          serve it: pending migrations run and the worker does their jobs, as
 *                             they would after a release; the development sign-in's sample people
 *                             are given a place in every organization
 *
 * pull reads WHATBUILD_FIXTURE_DATABASE_URL (a role that reads everything and bypasses row-level
 * security) and WHATBUILD_FIXTURE_BUCKET (gs://…); with GCP_PROJECT instead (from the environment
 * or .env), the Cloud Run deployment's backup role and files bucket.
 */
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const FIXTURES = resolve(root, process.env["WHATBUILD_FIXTURE_DIR"] ?? ".what-build/fixtures");

/** Where pulls are read from: this checkout's, or, in a git worktree that has none, the main checkout's. */
function pullsDir() {
  if (process.env["WHATBUILD_FIXTURE_DIR"] || existsSync(FIXTURES)) return FIXTURES;
  try {
    const common = resolve(root, run("git", ["-C", root, "rev-parse", "--git-common-dir"]));
    const main = resolve(common, "..", ".what-build/fixtures");
    return existsSync(main) ? main : FIXTURES;
  } catch {
    return FIXTURES;
  }
}
const PG_PORT = Number(process.env["WHATBUILD_PG_PORT"] ?? 54329);
export const FIXTURE_DATABASE = "fixture";
export const FIXTURE_BLOBS = resolve(root, ".what-build/fixture-blobs");

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
const show = (path: string) => relative(root, path) || ".";

/** One value from the root .env, where the maintainer's deployment names live; never the whole file. */
function fromDotEnv(name: string) {
  const file = resolve(root, ".env");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

/**
 * pg_dump's arguments and environment for a database URL. The password, from the URL's user part
 * or its query, travels in PGPASSWORD: a command line is visible to every user of the machine.
 */
export function pgDumpCommand(url: string, file: string): { args: string[]; env: NodeJS.ProcessEnv } {
  let password: string | undefined;
  let rest = url;
  const user = /^(postgres(?:ql)?:\/\/)([^@/?#]*)@/.exec(rest);
  const colon = user?.[2]!.indexOf(":") ?? -1;
  if (user && colon >= 0) {
    password = decodeURIComponent(user[2]!.slice(colon + 1));
    rest = `${user[1]}${user[2]!.slice(0, colon)}@${rest.slice(user[0].length)}`;
  }
  const q = rest.indexOf("?");
  if (q >= 0) {
    const params = new URLSearchParams(rest.slice(q + 1));
    if (params.has("password")) {
      password = params.get("password")!;
      params.delete("password");
      rest = rest.slice(0, q) + (params.size ? `?${params}` : "");
    }
  }
  return { args: ["--format=custom", `--file=${file}`, `--dbname=${rest}`], env: { ...process.env, ...(password !== undefined ? { PGPASSWORD: password } : {}) } };
}

async function pull() {
  const project = process.env["GCP_PROJECT"] ?? fromDotEnv("GCP_PROJECT");
  const url =
    process.env["WHATBUILD_FIXTURE_DATABASE_URL"] ??
    (project ? run("gcloud", ["secrets", "versions", "access", "latest", "--secret=whatbuild-backup-database-url", `--project=${project}`]) : undefined);
  if (!url) throw new Error("Set WHATBUILD_FIXTURE_DATABASE_URL to a role that reads everything and bypasses row-level security, or GCP_PROJECT to the Cloud Run deployment's project.");
  const bucket = process.env["WHATBUILD_FIXTURE_BUCKET"] ?? (project ? `gs://${project}-whatbuild-files` : undefined);

  const name = new Date().toISOString().slice(0, 16).replace(":", "") + "Z";
  const dir = join(FIXTURES, name);
  mkdirSync(dir, { recursive: true });
  console.log(`Dumping the database into ${show(dir)}/database.dump…`);
  const dump = pgDumpCommand(url, join(dir, "database.dump"));
  execFileSync("pg_dump", dump.args, { stdio: "inherit", env: dump.env });

  if (bucket) {
    // Passages and outlines are files too, so a copy without them opens every source empty.
    const files = join(dir, "files");
    console.log(`Copying ${bucket} into ${show(files)}…`);
    mkdirSync(files);
    execFileSync("gcloud", ["storage", "rsync", "--recursive", "--no-user-output-enabled", bucket, files], { stdio: "inherit" });
    // The local file store keeps each file's type and hash beside it.
    const listing = JSON.parse(run("gcloud", ["storage", "objects", "list", `${bucket}/**`, "--format=json"])) as { name: string; content_type?: string }[];
    const types = new Map(listing.map((o) => [o.name, o.content_type]));
    for (const path of readdirSync(files, { recursive: true, encoding: "utf8" }).map((p) => join(files, p))) {
      if (!statSync(path).isFile()) continue;
      const data = readFileSync(path);
      const key = relative(files, path).split(sep).join("/");
      writeFileSync(`${path}.meta.json`, JSON.stringify({ contentType: types.get(key) ?? "application/octet-stream", sha256: createHash("sha256").update(data).digest("hex"), size: data.byteLength }));
    }
  } else {
    console.log("No bucket: this copy has no files, so its sources open without passages.");
  }
  // Written last: a pull that stopped part-way has no pulled.json and is never loaded.
  writeFileSync(join(dir, "pulled.json"), JSON.stringify({ pulled_at: new Date().toISOString(), files: Boolean(bucket) }, null, 2) + "\n");
  console.log(`Pulled ${name}. Load it with: pnpm fixture load`);
}

/** The pulls that finished, oldest first. */
export function completePulls() {
  const dir = pullsDir();
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, "pulled.json"))).sort() : [];
}

/**
 * Replace `database` in a local Postgres with a pulled copy (the newest by default), restored as the
 * application's role, and `blobs` with a working copy of its files. Refuses while the database is in use.
 */
export async function restorePull(local: LocalPg, database: string, blobs: string, requested?: string) {
  const pulled = completePulls();
  const name = requested ?? pulled.at(-1);
  if (!name || !pulled.includes(name)) throw new Error(name ? `No complete copy named ${name} in ${show(pullsDir())}.` : `No copy in ${show(pullsDir())}: run pnpm fixture pull first.`);
  const dir = join(pullsDir(), name);

  const admin = new pg.Client({ connectionString: local.adminUrl });
  await admin.connect();
  try {
    const busy = await admin.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = $1", [database]);
    if (busy.rows[0]!.n) throw new Error(`The database "${database}" is in use: stop the server that serves it, then try again.`);
    await admin.query(`drop database if exists ${database}`);
    await admin.query(`create database ${database} owner ${APP_ROLE}`);
  } finally {
    await admin.end();
  }
  const databaseAdminUrl = local.adminUrl.replace(/\/postgres$/, `/${database}`);
  const ext = new pg.Client({ connectionString: databaseAdminUrl });
  await ext.connect();
  await ext.query("create extension pg_trgm");
  await ext.end();

  // Restored as the application's own role, as cloud-run.md restores a backup. The extension's
  // comment needs its owner, and statistics from a newer server do not load into an older one.
  const dump = join(dir, "database.dump");
  const list = run("pg_restore", ["--list", dump])
    .split("\n")
    .filter((l) => !/COMMENT - EXTENSION|STATISTICS DATA/.test(l))
    .join("\n");
  const listFile = join(mkdtempSync(join(tmpdir(), "whatbuild-fixture-")), "restore.list");
  writeFileSync(listFile, list);
  console.log(`Restoring ${name} into the database "${database}"…`);
  execFileSync("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--use-list=${listFile}`, `--dbname=${local.appUrl(database)}`, dump], { stdio: "inherit" });
  rmSync(listFile, { force: true });

  rmSync(blobs, { recursive: true, force: true });
  if (existsSync(join(dir, "files"))) cpSync(join(dir, "files"), blobs, { recursive: true });
  else mkdirSync(blobs, { recursive: true });

  const check = new pg.Client({ connectionString: databaseAdminUrl });
  await check.connect();
  const r = await check.query<{ migration: string; tenants: number; products: number; accounts: number }>(
    "select (select max(name) from schema_migrations) as migration, (select count(*)::int from tenants) as tenants, (select count(*)::int from products) as products, (select count(*)::int from accounts) as accounts",
  );
  await check.end();
  return { name, ...r.rows[0]! };
}

async function load(requested?: string) {
  const local = await connectOrStartLocalPg(resolve(root, ".what-build/pg"), PG_PORT);
  try {
    const s = await restorePull(local, FIXTURE_DATABASE, FIXTURE_BLOBS, requested).catch((e: unknown) => {
      throw e instanceof Error && e.message.includes("is in use") ? new Error("The copy is being served: stop pnpm dev:fixture, then load again.") : e;
    });
    console.log(`Loaded ${s.name}: ${s.tenants} organizations, ${s.products} products, ${s.accounts} accounts, schema at ${s.migration}.
Serve it with: pnpm dev:fixture   (later migrations run first, and the worker does their jobs)`);
  } finally {
    await local.stop();
  }
}

/**
 * The development sign-in's one-click people, given the place in every organization of the copy
 * that they have in the sample: Riley owns each one, Sam edits every team's products, and Jordan
 * reads every product's Story. Run each time the copy is served, after its migrations; it adds only
 * what is missing, and records nothing in the activity log.
 */
export async function addSamplePeople(db: Db) {
  const [riley, sam, jordan] = SEED_ACCOUNTS;
  const id = async (a: (typeof SEED_ACCOUNTS)[number]) => (await findOrCreateAccount(db, a.email, a.display_name)).account.account_id;
  const owner = await id(riley);
  const editor = await id(sam);
  const reader = await id(jordan);
  const by = json({ account_id: "system", display_name: "WhatBuild", surface: null, client: null });
  const tenants = await db.selectFrom("tenants").select("tenant_id").execute();
  const teams = await db.selectFrom("teams").select(["team_id", "tenant_id"]).execute();
  const products = await db.selectFrom("products").select(["product_id", "tenant_id"]).execute();
  const grants = [
    ...tenants.map((t) => ({ tenant_id: t.tenant_id, scope_type: "tenant" as const, scope_id: t.tenant_id, account_id: owner, role: "owner" })),
    ...teams.map((t) => ({ tenant_id: t.tenant_id, scope_type: "team" as const, scope_id: t.team_id, account_id: editor, role: "editor" })),
    ...products.map((p) => ({ tenant_id: p.tenant_id, scope_type: "product" as const, scope_id: p.product_id, account_id: reader, role: "reader" })),
  ];
  for (const g of grants)
    await db
      .insertInto("memberships")
      .values({ membership_id: newId(), ...g, created_by: by })
      .onConflict((oc) => oc.columns(["scope_type", "scope_id", "account_id"]).doNothing())
      .execute();
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === "pull") return pull();
  if (command === "load") return load(arg);
  console.log("Usage: pnpm fixture pull | pnpm fixture load [name]   (then pnpm dev:fixture)");
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
