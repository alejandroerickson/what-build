import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { json, newId, type Db } from "@whatbuild/core";
import pg from "pg";
import { findOrCreateAccount } from "./auth/identity.ts";
import { instanceOwnersFrom } from "./config.ts";
import { copyOrganizations, organizationsToPull, type Organization } from "./organization-copy.ts";
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
 * A pull holds the deployment's example organization, or the organizations named with --org, and only
 * their rows and files ever leave the deployment (organization-copy.ts). It is for a copy outside
 * production, so it refuses an organization an instance owner does not own; --all takes every one
 * they do. --for-another-deployment takes the organizations named to move them into another
 * production deployment, and no copy outside production loads it.
 *
 *   pnpm fixture pull [--org <slug>]… [--all] [--no-files | --files-into gs://<bucket>]
 *   pnpm fixture pull --org <slug>… --for-another-deployment [--files-into gs://<bucket>]
 *   pnpm fixture list         the pulls and what each holds
 *
 * pull reads WHATBUILD_FIXTURE_DATABASE_URL (a role that reads everything and bypasses row-level
 * security), WHATBUILD_FIXTURE_BUCKET (gs://…) and WHATBUILD_FIXTURE_INSTANCE_OWNERS (the
 * deployment's WHATBUILD_INSTANCE_OWNERS); with GCP_PROJECT instead (from the environment or .env),
 * the Cloud Run deployment's backup role, files bucket and service's instance owners. In a git
 * worktree without a .env or pulls of its own, the main checkout's are used, so every checkout shares them.
 */
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const FIXTURES = resolve(root, process.env["WHATBUILD_FIXTURE_DIR"] ?? ".what-build/fixtures");

/** A path in the main checkout, as seen from a git worktree (or the checkout itself), when it is there. */
function inMainCheckout(path: string) {
  try {
    const main = resolve(root, run("git", ["-C", root, "rev-parse", "--git-common-dir"]), "..", path);
    return existsSync(main) ? main : undefined;
  } catch {
    return undefined;
  }
}

/** Where pulls are kept: this checkout's, or, in a git worktree that has none, the main checkout's. */
export function pullsDir() {
  if (process.env["WHATBUILD_FIXTURE_DIR"] || existsSync(FIXTURES)) return FIXTURES;
  return inMainCheckout(".what-build/fixtures") ?? FIXTURES;
}
export const PG_PORT = Number(process.env["WHATBUILD_PG_PORT"] ?? 54329);
/** The embedded Postgres that `pnpm dev` runs, where pulls are shaped and loaded. */
export const LOCAL_PG = resolve(root, ".what-build/pg");
export const FIXTURE_DATABASE = "fixture";
export const FIXTURE_BLOBS = resolve(root, ".what-build/fixture-blobs");

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
const show = (path: string) => (relative(root, path).startsWith("..") ? path : relative(root, path) || ".");

/** One value from the root .env (the main checkout's, from a git worktree without one), where the maintainer's deployment names live; never the whole file. */
function fromDotEnv(name: string) {
  const own = resolve(root, ".env");
  const file = existsSync(own) ? own : inMainCheckout(".env");
  if (!file) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

/**
 * pg_dump's arguments and environment for a database URL. The password, from the URL's user part
 * or its query, travels in PGPASSWORD: a command line is visible to every user of the machine.
 */
export function pgDumpCommand(url: string, file: string, extra: string[] = []): { args: string[]; env: NodeJS.ProcessEnv } {
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
  return { args: ["--format=custom", ...extra, `--file=${file}`, `--dbname=${rest}`], env: { ...process.env, ...(password !== undefined ? { PGPASSWORD: password } : {}) } };
}

/**
 * A database URL for node's Postgres client. `sslrootcert=system` asks libpq for the system's
 * certificate authorities, but node's client takes it for a file; Node verifies against its own
 * trusted authorities without it.
 */
export function nodePgUrl(url: string) {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  if (params.get("sslrootcert") !== "system") return url;
  params.delete("sslrootcert");
  return url.slice(0, q) + (params.size ? `?${params}` : "");
}

/** What pulled.json says: when, which organizations (or, in a pull from before pulls were limited, all of them), and where the files went. */
export type PullRecord = {
  pulled_at: string;
  organizations?: Omit<Organization, "example">[] | "all";
  /** The rows of each table in the dump, to check a restore of it against. */
  rows?: Record<string, number>;
  files: boolean;
  files_into?: string;
  /** The pull checked that an instance owner owns every organization in it, so a copy outside production may hold it. */
  owned_by_instance_owners?: true;
  /** Taken to move its organizations into another production deployment: no copy outside production loads it. */
  for_another_deployment?: true;
  /** A dataset (`pnpm dataset`): the pull it was built from, with synthetic organizations beside the pulled ones. */
  dataset?: DatasetRecord;
};

/** What a dataset adds to its pull's record. */
export type DatasetRecord = {
  built_at: string;
  /** The pull it was built from. */
  from: string;
  commit: string;
  /** The last migration it has: the code's that built it. */
  migration: string;
  /** How many synthetic people (`pnpm people`) it was built with. */
  people: number;
  /** The synthetic organizations, made through the operations: no production data. */
  synthetic: { slug: string; name: string }[];
};

/** Whether a copy outside production may hold the pull: one that checked who owns each of its organizations. */
export function mayLeaveProduction(r: PullRecord) {
  return r.owned_by_instance_owners === true && !r.for_another_deployment && Array.isArray(r.organizations);
}

/** Why a copy outside production refuses a pull, or nothing when it may hold it. */
export function refusalOf(name: string, r: PullRecord): string | undefined {
  if (mayLeaveProduction(r)) return undefined;
  if (r.for_another_deployment) return `The pull ${name} was taken to move its organizations into another production deployment, and goes only there: no copy outside production loads it. Delete it once it is restored there.`;
  return `The pull ${name} was taken before pulls checked who owns each organization, so it may hold one no instance owner owns, which no copy outside production holds. Delete it (rm -r ${show(join(pullsDir(), name))}) and pull again: pnpm fixture pull.`;
}

/**
 * The deployment's instance owners, as its server reads them: WHATBUILD_FIXTURE_INSTANCE_OWNERS, or,
 * for the Cloud Run deployment, its service's WHATBUILD_INSTANCE_OWNERS. A pull for a copy outside
 * production takes only the organizations they own, so it never guesses them.
 */
function deploymentInstanceOwners(project: string | undefined) {
  let value = process.env["WHATBUILD_FIXTURE_INSTANCE_OWNERS"];
  if (value === undefined && project && !process.env["WHATBUILD_FIXTURE_DATABASE_URL"]) {
    const region = process.env["GCP_REGION"] ?? fromDotEnv("GCP_REGION");
    if (!region) throw new Error("Set GCP_REGION to the Cloud Run deployment's region, so that the pull reads who its instance owners are.");
    type Service = { spec?: { template?: { spec?: { containers?: { env?: { name: string; value?: string }[] }[] } } } };
    const service = JSON.parse(run("gcloud", ["run", "services", "describe", "whatbuild", `--project=${project}`, `--region=${region}`, "--format=json"])) as Service;
    value = service.spec?.template?.spec?.containers?.flatMap((c) => c.env ?? []).find((e) => e.name === "WHATBUILD_INSTANCE_OWNERS")?.value ?? "";
  }
  if (value === undefined) throw new Error("Set WHATBUILD_FIXTURE_INSTANCE_OWNERS to the deployment's WHATBUILD_INSTANCE_OWNERS: a copy outside production holds only the organizations its instance owners own.");
  const owners = instanceOwnersFrom(value);
  if (!owners.length) throw new Error("The deployment names no instance owners (WHATBUILD_INSTANCE_OWNERS), so none of its organizations may go to a copy outside production.");
  return owners;
}

/** Take a pull, as `pnpm fixture pull` does, and return its name. */
export async function pull(args: string[]): Promise<string> {
  const everything = args.includes("--all");
  const elsewhere = args.includes("--for-another-deployment");
  const slugs = args.filter((_, i) => args[i - 1] === "--org").flatMap((a) => a.split(",")).filter(Boolean);
  const into = args[args.indexOf("--files-into") + 1];
  const filesInto = args.includes("--files-into") ? into?.replace(/\/+$/, "") : undefined;
  if (everything && slugs.length) throw new Error("Name organizations with --org, or take every organization the instance owners own with --all, not both.");
  if (elsewhere && (everything || !slugs.length)) throw new Error("--for-another-deployment moves the organizations named with --org, and only those.");
  if (elsewhere && !process.env["WHATBUILD_FIXTURE_DIR"])
    throw new Error("A copy for another deployment goes through a directory only you can read, never .what-build/fixtures: set WHATBUILD_FIXTURE_DIR to one (umask 077; D=$(mktemp -d)).");
  if (args.includes("--files-into") && !/^gs:\/\/[^/]+$/.test(filesInto ?? "")) throw new Error("--files-into takes a bucket: gs://<name>.");

  const project = process.env["GCP_PROJECT"] ?? fromDotEnv("GCP_PROJECT");
  const url =
    process.env["WHATBUILD_FIXTURE_DATABASE_URL"] ??
    (project ? run("gcloud", ["secrets", "versions", "access", "latest", "--secret=whatbuild-backup-database-url", `--project=${project}`]) : undefined);
  if (!url) throw new Error("Set WHATBUILD_FIXTURE_DATABASE_URL to a role that reads everything and bypasses row-level security, or GCP_PROJECT to the Cloud Run deployment's project.");
  const bucket = args.includes("--no-files") ? undefined : (process.env["WHATBUILD_FIXTURE_BUCKET"] ?? (project ? `gs://${project}-whatbuild-files` : undefined))?.replace(/\/+$/, "");
  if (filesInto && !bucket) throw new Error("--files-into needs the deployment's bucket: set WHATBUILD_FIXTURE_BUCKET or GCP_PROJECT.");
  if (filesInto && filesInto === bucket) throw new Error("--files-into names the deployment's own bucket, which a pull only reads.");
  // Who runs the deployment: a copy outside production holds only the organizations they own.
  const instanceOwners = elsewhere ? null : deploymentInstanceOwners(project);

  const name = new Date().toISOString().slice(0, 16).replace(":", "") + "Z";
  const dir = join(pullsDir(), name);
  if (existsSync(dir)) throw new Error(`There is already a pull named ${name}: wait a minute and pull again.`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let organizations: Organization[];
  let rows: Record<string, number>;
  try {
    ({ organizations, rows } = await dumpOrganizations(url, { slugs, all: everything, instanceOwners }, join(dir, "database.dump")));
    if (bucket) copyFiles(bucket, organizations.map((o) => o.tenant_id), filesInto ?? join(dir, "files"));
    else console.log("No bucket: this copy has no files, so its sources open without their attachments.");
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  // Written last: a pull that stopped part-way has no pulled.json and is never loaded.
  const record: PullRecord = {
    pulled_at: new Date().toISOString(),
    organizations: organizations.map(({ tenant_id, slug, name }) => ({ tenant_id, slug, name })),
    rows: Object.fromEntries(Object.entries(rows).sort(([a], [b]) => (a < b ? -1 : 1))),
    files: Boolean(bucket) && !filesInto,
    ...(filesInto ? { files_into: filesInto } : {}),
    ...(elsewhere ? { for_another_deployment: true } : { owned_by_instance_owners: true }),
  };
  writeFileSync(join(dir, "pulled.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(elsewhere ? `Pulled ${name} to move into another deployment: restore it there, then delete ${show(dir)}.` : `Pulled ${name}. Load it with: pnpm fixture load`);
  return name;
}

/**
 * Dump only the organizations' rows. The deployment's schema goes into a scratch database in the
 * embedded Postgres, the organizations' rows are copied into it from one snapshot of the
 * deployment, and the scratch database is dumped, so the pull is an ordinary dump that every
 * consumer of a pull restores as it is. The scratch database is dropped.
 */
async function dumpOrganizations(url: string, choice: Parameters<typeof organizationsToPull>[1], file: string) {
  const source = new pg.Client({ connectionString: nodePgUrl(url) });
  await source.connect();
  const local = await connectOrStartLocalPg(LOCAL_PG, PG_PORT, { portVariable: "WHATBUILD_PG_PORT" });
  const scratch = `pull_${randomBytes(4).toString("hex")}`;
  const tmp = mkdtempSync(join(tmpdir(), "whatbuild-pull-"));
  try {
    const { organizations, others } = await organizationsToPull(source, choice);
    console.log(`Copying ${organizations.map((o) => `${o.slug}${o.example ? " (the example organization)" : ""}`).join(", ")} into ${show(file)}…`);
    if (others) console.log(`  ${others} other organization${others === 1 ? " stays" : "s stay"} behind: an instance owner does not own ${others === 1 ? "it" : "them"}.`);
    const schema = pgDumpCommand(url, join(tmp, "schema.dump"), ["--schema-only"]);
    execFileSync("pg_dump", schema.args, { stdio: "inherit", env: schema.env });
    await createDatabase(local, scratch);
    restoreDump(local, scratch, join(tmp, "schema.dump"));
    const target = new pg.Client({ connectionString: adminUrlOf(local, scratch) });
    await target.connect();
    let rows: Record<string, number>;
    try {
      rows = await copyOrganizations(source, target, organizations.map((o) => o.tenant_id));
      console.log(`  ${rows["accounts"]} accounts, ${rows["products"] ?? 0} products, ${Object.values(rows).reduce((a, b) => a + b, 0)} rows in all`);
    } finally {
      await target.end();
    }
    const dump = pgDumpCommand(adminUrlOf(local, scratch), file);
    execFileSync("pg_dump", dump.args, { stdio: "inherit", env: dump.env });
    return { organizations, rows };
  } finally {
    await source.end();
    await dropDatabase(local, scratch).catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
    await local.stop();
  }
}

/**
 * Copy the files of the organizations (each one's folder t/<tenant_id>/) into a local folder, with
 * the type and hash the local file store keeps beside each file, or into another bucket, which is
 * left holding those files and no other organization's.
 */
function copyFiles(bucket: string, tenantIds: string[], into: string) {
  const toBucket = into.startsWith("gs://");
  console.log(`Copying the organizations' files from ${bucket} into ${toBucket ? into : show(into)}…`);
  const folders = (b: string) => {
    try {
      return run("gcloud", ["storage", "ls", `${b}/t/`]).split("\n").map((l) => /\/t\/([^/]+)\/$/.exec(l.trim())?.[1]).filter((t): t is string => Boolean(t));
    } catch {
      return []; // nothing stored yet
    }
  };
  const rsync = (from: string, to: string) =>
    execFileSync("gcloud", ["storage", "rsync", "--recursive", "--no-user-output-enabled", ...(toBucket ? ["--delete-unmatched-destination-objects"] : []), from, to], { stdio: "inherit" });
  const stored = new Set(folders(bucket));
  const prefixes = tenantIds.filter((t) => stored.has(t)).map((t) => `t/${t}`);
  if (!toBucket) mkdirSync(into, { recursive: true });
  for (const p of prefixes) {
    if (!toBucket) mkdirSync(join(into, p), { recursive: true });
    rsync(`${bucket}/${p}`, `${into}/${p}`);
  }
  if (toBucket) {
    // What other organizations left in the bucket goes: it holds what the copy holds.
    for (const t of folders(into).filter((t) => !tenantIds.includes(t))) execFileSync("gcloud", ["storage", "rm", "--recursive", "--no-user-output-enabled", `${into}/t/${t}`], { stdio: "inherit" });
    return;
  }
  // The local file store keeps each file's type and hash beside it.
  const types = new Map<string, string | undefined>();
  for (const p of prefixes) {
    const listing = JSON.parse(run("gcloud", ["storage", "objects", "list", `${bucket}/${p}/**`, "--format=json"])) as { name: string; content_type?: string }[];
    for (const o of listing) types.set(o.name, o.content_type);
  }
  for (const entry of readdirSync(into, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const data = readFileSync(path);
    const key = relative(into, path).split(sep).join("/");
    writeFileSync(`${path}.meta.json`, JSON.stringify({ contentType: types.get(key) ?? "application/octet-stream", sha256: createHash("sha256").update(data).digest("hex"), size: data.byteLength }));
  }
}

/** What a pull holds, as pulled.json says; a pull from before pulls could be limited holds everything. */
export function readPull(name: string): PullRecord {
  const r = JSON.parse(readFileSync(join(pullsDir(), name, "pulled.json"), "utf8")) as PullRecord;
  return { ...r, organizations: r.organizations ?? "all" };
}

export function describePull(r: PullRecord) {
  const pulled = r.organizations === "all" || !r.organizations ? "every organization" : r.organizations.map((o) => o.slug).join(", ");
  const synthetic = r.dataset?.synthetic.length;
  return synthetic ? `${pulled}, and ${synthetic} synthetic organization${synthetic === 1 ? "" : "s"} (a dataset)` : pulled;
}

function list() {
  const pulls = completePulls();
  if (!pulls.length) return console.log(`No pulls in ${show(pullsDir())}: run pnpm fixture pull.`);
  for (const name of pulls) {
    const r = readPull(name);
    const kept = r.for_another_deployment ? "; to move into another deployment, not to load here" : mayLeaveProduction(r) ? "" : "; from before pulls checked owners: delete it";
    console.log(`${name}  ${describePull(r)}${r.files ? "" : ", without files"}${kept}`);
  }
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

  const r = readPull(name);
  const refused = refusalOf(name, r);
  if (refused) throw new Error(refused);
  await createDatabase(local, database);
  console.log(`Restoring ${name} (${describePull(r)}) into the database "${database}"…`);
  restoreDump(local, database, join(dir, "database.dump"));

  rmSync(blobs, { recursive: true, force: true });
  if (existsSync(join(dir, "files"))) cpSync(join(dir, "files"), blobs, { recursive: true });
  else mkdirSync(blobs, { recursive: true });

  const check = new pg.Client({ connectionString: adminUrlOf(local, database) });
  await check.connect();
  const counts = await check.query<{ migration: string; tenants: number; products: number; accounts: number }>(
    "select (select max(name) from schema_migrations) as migration, (select count(*)::int from tenants) as tenants, (select count(*)::int from products) as products, (select count(*)::int from accounts) as accounts",
  );
  await check.end();
  return { name, ...counts.rows[0]! };
}

export const adminUrlOf = (local: LocalPg, database: string) => local.adminUrl.replace(/\/postgres$/, `/${database}`);

/** A new, empty `database`, owned by the application's role, in place of any there was. Refuses while it is in use. */
async function createDatabase(local: LocalPg, database: string) {
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
  const ext = new pg.Client({ connectionString: adminUrlOf(local, database) });
  await ext.connect();
  await ext.query("create extension pg_trgm");
  await ext.end();
}

export async function dropDatabase(local: LocalPg, database: string) {
  const admin = new pg.Client({ connectionString: local.adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${database}`).finally(() => admin.end());
}

/**
 * Restore a dump into `database` as the application's own role, as cloud-run.md restores a backup.
 * The extension's comment needs its owner, and statistics from a newer server do not load into an older one.
 */
function restoreDump(local: LocalPg, database: string, dump: string) {
  const list = run("pg_restore", ["--list", dump])
    .split("\n")
    .filter((l) => !/COMMENT - EXTENSION|STATISTICS DATA/.test(l))
    .join("\n");
  const tmp = mkdtempSync(join(tmpdir(), "whatbuild-fixture-"));
  writeFileSync(join(tmp, "restore.list"), list);
  try {
    execFileSync("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--use-list=${join(tmp, "restore.list")}`, `--dbname=${local.appUrl(database)}`, dump], { stdio: "inherit" });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function load(requested?: string) {
  const local = await connectOrStartLocalPg(LOCAL_PG, PG_PORT, { portVariable: "WHATBUILD_PG_PORT" });
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
 * what is missing, and records nothing in the activity log. The organizations `except` names (by
 * slug) are left as they are: the end-to-end golden master's synthetic one has people of its own.
 */
export async function addSamplePeople(db: Db, except: readonly string[] = []) {
  const [riley, sam, jordan] = SEED_ACCOUNTS;
  const id = async (a: (typeof SEED_ACCOUNTS)[number]) => (await findOrCreateAccount(db, a.email, a.display_name)).account.account_id;
  const owner = await id(riley);
  const editor = await id(sam);
  const reader = await id(jordan);
  const by = json({ account_id: "system", display_name: "WhatBuild", surface: null, client: null });
  const tenants = (await db.selectFrom("tenants").select(["tenant_id", "slug"]).execute()).filter((t) => !except.includes(t.slug));
  const kept = new Set(tenants.map((t) => t.tenant_id));
  const teams = (await db.selectFrom("teams").select(["team_id", "tenant_id"]).execute()).filter((t) => kept.has(t.tenant_id));
  const products = (await db.selectFrom("products").select(["product_id", "tenant_id"]).execute()).filter((p) => kept.has(p.tenant_id));
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
  const [command, ...args] = process.argv.slice(2);
  if (command === "pull") return pull(args);
  if (command === "load") return load(args[0]);
  if (command === "list") return list();
  console.log(`Usage:
  pnpm fixture pull                   the deployment's example organization
  pnpm fixture pull --org <slug>[,<slug>…]  the organizations named, each one an instance owner owns
  pnpm fixture pull --all             every organization the instance owners own
    --no-files                        without the files
    --files-into gs://<bucket>        the files into that bucket instead, which then holds them alone
    --for-another-deployment          with --org, to move them into another production deployment
                                      (WHATBUILD_FIXTURE_DIR names a directory only you can read)
  pnpm fixture list                   the pulls, and what each holds
  pnpm fixture load [name]            the newest pull, or the one named (then pnpm dev:fixture)`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
