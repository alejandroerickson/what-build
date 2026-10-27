import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createBlobStore, createMailer, createPorts } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb, migrate } from "./database.ts";
import { addHarborLabs, SYNTHETIC } from "./dataset.ts";
import { copyTenant, keepOnlyTenants } from "./e2e-golden.ts";
import { addSamplePeople, readPull, restorePull } from "./fixture.ts";
import { APP_ROLE, connectOrStartLocalPg, type LocalPg } from "./testing/pg.ts";
import { Worker } from "./worker.ts";

/**
 * Agent-driven end-to-end tests (okf/operations/end-to-end-tests.md). An agent follows a plan in
 * e2e/plans/, driving the web app with `pnpm e2e browser` and the MCP server with `pnpm e2e mcp`,
 * on an instance of its own that starts every time from the same golden master.
 *
 *   pnpm e2e golden [pull] [--org s] build the golden master from a pulled copy of production: its
 *                                    example organization, a copy that is not the example, and a
 *                                    synthetic organization with people of its own
 *   pnpm e2e export [dir]            the golden master as a dump and its files, with the sample
 *                                    people given their roles, for an instance on a Docker host
 *                                    (deploy/docker/, okf/operations/end-to-end-on-a-docker-host.md)
 *   pnpm dev:e2e                     reset the instance's database and files to the golden master
 *                                    and serve them on :5283, beside any pnpm dev
 *   pnpm e2e plans                   list the plans
 *   pnpm e2e run [plan]              start a run: a folder for its log, screenshots and report
 *   pnpm e2e stop                    stop this checkout's browser and pnpm dev:e2e
 *   pnpm e2e browser <command>       drive a real browser (pnpm e2e browser help)
 *   pnpm e2e mcp <command>           call the MCP server as an agent (pnpm e2e mcp help)
 *
 * Everything it writes is under .what-build/e2e/, which git ignores. The golden master is real
 * people's data, with every rule of a copy of production.
 */
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const E2E_DIR = resolve(root, ".what-build/e2e");
export const E2E = {
  pgDir: join(E2E_DIR, "pg"),
  pgPort: Number(process.env["WHATBUILD_E2E_PG_PORT"] ?? 54339),
  apiPort: Number(process.env["WHATBUILD_E2E_API_PORT"] ?? 8797),
  webPort: Number(process.env["WHATBUILD_E2E_WEB_PORT"] ?? 5283),
  golden: "golden",
  database: "e2e",
  goldenBlobs: join(E2E_DIR, "golden-blobs"),
  blobs: join(E2E_DIR, "blobs"),
  goldenRecord: join(E2E_DIR, "golden.json"),
  runs: join(E2E_DIR, "runs"),
  currentRun: join(E2E_DIR, "current-run"),
  /** The process id of this checkout's pnpm dev:e2e while it runs, so pnpm e2e stop stops it and no other checkout's. */
  pidFile: join(E2E_DIR, "dev.pid"),
};
export const e2eBaseUrl = () => process.env["WHATBUILD_E2E_URL"] ?? `http://localhost:${E2E.webPort}`;
export const PLANS = resolve(root, "e2e/plans");

/** What golden.json says: the pull it came from, the two organizations, and their products' paths. */
/**
 * `sandbox` names the example organization in a golden master built before it replaced the public
 * sandbox; `synthetic` is absent from one built before it had a synthetic organization;
 * `owned_by_instance_owners` from one built before pulls checked who owns each organization, which no
 * copy outside production may hold. `synthetic_organizations` names every synthetic organization,
 * `synthetic` among them, when it was built from a dataset that has more.
 */
export type GoldenRecord = {
  built_at: string;
  pull: string;
  migration: string;
  commit: string;
  example?: string;
  sandbox?: string;
  standard: string;
  synthetic?: string;
  synthetic_organizations?: string[];
  products: string[];
  owned_by_instance_owners?: true;
};

/** The golden master's organizations whose people are their own, whom the development sign-in's people are not added to. */
export function ownPeopleOf(golden: GoldenRecord): string[] {
  return golden.synthetic_organizations ?? (golden.synthetic ? [golden.synthetic] : []);
}

/** Why a golden master may not be exported, or nothing: one built before pulls checked who owns each organization. */
export function goldenRefusal(golden: GoldenRecord): string | undefined {
  return golden.owned_by_instance_owners
    ? undefined
    : `The golden master was built from the pull ${golden.pull}, taken before pulls checked who owns each organization, so it may hold one no instance owner owns. Build it again from a new pull: pnpm fixture pull, then pnpm e2e golden.`;
}

/** The synthetic organization every golden master has (dataset.ts), whose people are its own. */
export { SYNTHETIC, SYNTHETIC_PEOPLE } from "./dataset.ts";

export function readGolden(): GoldenRecord | null {
  return existsSync(E2E.goldenRecord) ? (JSON.parse(readFileSync(E2E.goldenRecord, "utf8")) as GoldenRecord) : null;
}

const show = (path: string) => relative(root, path) || ".";

async function admin<T>(local: LocalPg, fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: local.adminUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function inUse(local: LocalPg, database: string) {
  return admin(local, async (c) => (await c.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = $1", [database])).rows[0]!.n > 0);
}

/**
 * Build the golden master from a pulled copy of production (okf/operations/a-copy-of-production.md),
 * or from a dataset (okf/operations/the-non-production-dataset.md): the database "golden" in the
 * instance's own Postgres, and its files. Only the example organization stays, with a dataset's
 * synthetic organizations; it is migrated to this code's schema, a copy of it that is not the
 * example is made beside it, and the synthetic organization is made if the dataset did not bring it.
 * Once built it never changes: migrations added later run on each fresh copy.
 */
async function buildGolden(args: string[]) {
  const org = option(args, "--org");
  const pull = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--org")[0];
  // The instance's cluster holds only what this build makes and the copies made from it, so one
  // made before local clusters were UTF-8 is made again: the golden master is then UTF-8, as production is.
  const local = await connectOrStartLocalPg(E2E.pgDir, E2E.pgPort, { disposable: true, portVariable: "WHATBUILD_E2E_PG_PORT" }).catch((e: unknown) => {
    throw e instanceof Error && e.message.includes("cannot be made again") ? new Error(`${e.message} The end-to-end instance stops with pnpm e2e stop.`) : e;
  });
  try {
    if ((await inUse(local, E2E.golden)) || (await inUse(local, E2E.database))) throw new Error("The end-to-end instance is being served: stop it with pnpm e2e stop, then build again.");
    await admin(local, (c) => c.query(`drop database if exists ${E2E.golden}`));
    const s = await restorePull(local, E2E.golden, E2E.goldenBlobs, pull);
    const brought = readPull(s.name).dataset?.synthetic.map((o) => o.slug) ?? [];
    const c = new pg.Client({ connectionString: local.adminUrl.replace(/\/postgres$/, `/${E2E.golden}`) });
    await c.connect();
    let record: GoldenRecord;
    try {
      // A copy taken before the example organization replaced the public sandbox marks the sandbox instead.
      const flag = (await c.query("select 1 from information_schema.columns where table_name = 'tenants' and column_name = 'example'")).rowCount ? "example" : "sandbox";
      const example = (
        await c.query<{ tenant_id: string; slug: string; name: string }>(
          org ? "select tenant_id, slug, name from tenants where slug = $1" : `select tenant_id, slug, name from tenants where ${flag}`,
          org ? [org] : [],
        )
      ).rows;
      if (example.length !== 1)
        throw new Error(org ? `The copy ${s.name} has no organization ${org}.` : `The copy ${s.name} has ${example.length} example organizations; name the organization with --org <slug>.`);
      const keep = example[0]!;
      const synthetic = (await c.query<{ tenant_id: string }>("select tenant_id from tenants where slug = any($1)", [brought])).rows.map((r) => r.tenant_id);
      await keepOnlyTenants(c, [keep.tenant_id, ...synthetic]);
      // Brought to this code's schema, with the jobs its migrations queue done, before the copy is
      // made: the copy covers every table there is now.
      const config = loadConfig({ ...process.env, NODE_ENV: "development", DATABASE_URL: local.appUrl(E2E.golden), WHATBUILD_PUBLIC_URL: e2eBaseUrl(), WHATBUILD_BLOB_STORE: "fs", WHATBUILD_BLOB_DIR: E2E.goldenBlobs, WHATBUILD_MAILER: "console" });
      const app = createDb(local.appUrl(E2E.golden), 3);
      try {
        await migrate(app.db);
        const worker = new Worker({ db: app.db, ports: createPorts(config, await createBlobStore(config), createMailer(config)) }, 60_000, console.log);
        while ((await worker.drain()) > 0);
      } finally {
        await app.pool.end();
      }
      const standard = { slug: `${keep.slug}-standard`, name: `${keep.name} (standard)` };
      await copyTenant(c, keep.tenant_id, standard.slug, standard.name);
      // Made through the operations, as an organization's people would, unless a dataset brought it.
      const made = createDb(local.appUrl(E2E.golden), 3);
      try {
        const ports = createPorts(config, await createBlobStore(config), createMailer(config));
        await addHarborLabs({ db: made.db, ports }, new Worker({ db: made.db, ports }, 60_000, console.log), c, console.log);
      } finally {
        await made.pool.end();
      }
      const migration = (await c.query<{ name: string }>("select max(name) as name from schema_migrations")).rows[0]!.name;
      const products = (
        await c.query<{ path: string }>("select t.slug || '/' || m.slug || '/' || p.slug as path from products p join teams m using (team_id) join tenants t on t.tenant_id = p.tenant_id order by 1")
      ).rows.map((r) => r.path);
      // restorePull loads only a pull that checked an instance owner owns every organization in it.
      const synthetics = [SYNTHETIC, ...brought.filter((slug) => slug !== SYNTHETIC)];
      record = {
        built_at: new Date().toISOString(),
        pull: s.name,
        migration,
        commit: gitCommit(),
        example: keep.slug,
        standard: standard.slug,
        synthetic: SYNTHETIC,
        ...(synthetics.length > 1 ? { synthetic_organizations: synthetics } : {}),
        products,
        owned_by_instance_owners: true,
      };
      console.log(`The golden master is ${keep.slug}, the example organization in the copy ${s.name}, ${standard.slug}, a copy of it that is not the example, and ${synthetics.length > 1 ? `${synthetics.length} synthetic organizations with people of their own, ${SYNTHETIC} among them` : `${SYNTHETIC}, a synthetic organization with people of its own`}:
  ${products.join("\n  ")}`);
    } finally {
      await c.end();
    }
    writeFileSync(E2E.goldenRecord, JSON.stringify(record, null, 2) + "\n");
    console.log(`Schema at ${record.migration}. Serve a fresh copy of it with: pnpm dev:e2e`);
  } finally {
    await local.stop();
  }
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function option(args: string[], flag: string) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * The golden master as another host loads it (deploy/docker/whatbuild-e2e.sh load): `database.dump`,
 * made from a copy of it in which the development sign-in's people hold the roles `pnpm dev:e2e`
 * gives them each time it serves, `files/` and `golden.json`. The golden master itself is
 * untouched. The export is real people's data, as the golden master is.
 */
async function exportGolden(args: string[]) {
  const golden = readGolden();
  const dir = resolve(args[0] ?? join(E2E_DIR, "export", golden?.built_at.replace(/[:.]/g, "").slice(0, 15) + "Z"));
  const local = await connectOrStartLocalPg(E2E.pgDir, E2E.pgPort, { portVariable: "WHATBUILD_E2E_PG_PORT" });
  const scratch = "golden_export";
  try {
    if (!golden || !(await local.hasDatabase(E2E.golden))) throw new Error("There is no golden master yet: run pnpm e2e golden first.");
    const refused = goldenRefusal(golden);
    if (refused) throw new Error(refused);
    await admin(local, async (c) => {
      await c.query(`drop database if exists ${scratch}`);
      await c.query(`create database ${scratch} template ${E2E.golden} owner ${APP_ROLE}`);
    });
    try {
      const made = createDb(local.appUrl(scratch), 2);
      try {
        await addSamplePeople(made.db, ownPeopleOf(golden));
      } finally {
        await made.pool.end();
      }
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      // As the cluster's superuser: row-level security is forced, so the application's role reads no rows without a tenant.
      execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${join(dir, "database.dump")}`, local.adminUrl.replace(/\/postgres$/, `/${scratch}`)], { stdio: "inherit" });
    } finally {
      await admin(local, (c) => c.query(`drop database if exists ${scratch}`));
    }
    if (existsSync(E2E.goldenBlobs)) cpSync(E2E.goldenBlobs, join(dir, "files"), { recursive: true });
    else mkdirSync(join(dir, "files"));
    writeFileSync(join(dir, "golden.json"), JSON.stringify(golden, null, 2) + "\n");
    console.log(`Exported the golden master built ${golden.built_at} (from the pull ${golden.pull}, schema at ${golden.migration}) to ${show(dir)}.
It is real people's data: copy it only to a host of your own, then load it there with deploy/docker/whatbuild-e2e.sh load.`);
  } finally {
    await local.stop();
  }
}

/** Put the instance's database and files back to the golden master. Called by `pnpm dev:e2e` before it serves. */
export async function resetToGolden(local: LocalPg) {
  const golden = readGolden();
  if (!golden || !(await local.hasDatabase(E2E.golden))) throw new Error("There is no golden master yet: run pnpm e2e golden first.");
  if (await inUse(local, E2E.database)) throw new Error("The end-to-end instance is already being served: stop the other pnpm dev:e2e first.");
  await admin(local, async (c) => {
    await c.query(`drop database if exists ${E2E.database}`);
    await c.query(`create database ${E2E.database} template ${E2E.golden} owner ${APP_ROLE}`);
  });
  rmSync(E2E.blobs, { recursive: true, force: true });
  if (existsSync(E2E.goldenBlobs)) cpSync(E2E.goldenBlobs, E2E.blobs, { recursive: true });
  else mkdirSync(E2E.blobs, { recursive: true });
  return { url: local.appUrl(E2E.database), golden };
}

/** The run that browser and MCP commands record into, if one was started. */
export function currentRunDir() {
  if (!existsSync(E2E.currentRun)) return null;
  const dir = readFileSync(E2E.currentRun, "utf8").trim();
  return existsSync(dir) ? dir : null;
}

/** Append one command and its outcome to the current run's log. */
export function record(entry: Record<string, unknown>) {
  const dir = currentRunDir();
  if (dir) writeFileSync(join(dir, "log.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", { flag: "a" });
}

function planTitle(file: string) {
  return /^title:\s*(.+)$/m.exec(readFileSync(join(PLANS, file), "utf8"))?.[1]?.trim() ?? "";
}

function listPlans() {
  for (const f of readdirSync(PLANS).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) console.log(`${f.replace(/\.md$/, "").padEnd(28)} ${planTitle(f)}`);
}

function startRun(plan: string | undefined) {
  if (!plan) {
    const dir = currentRunDir();
    if (!dir) throw new Error("No run is started. Start one with: pnpm e2e run <plan>   (pnpm e2e plans lists them)");
    return console.log(`The current run is ${dir}`);
  }
  const file = join(PLANS, `${plan.replace(/\.md$/, "")}.md`);
  if (!existsSync(file)) throw new Error(`No plan ${show(file)}. pnpm e2e plans lists them.`);
  const name = `${new Date().toISOString().slice(0, 19).replace(/:/g, "")}Z-${plan.replace(/\.md$/, "")}`;
  const dir = join(E2E.runs, name);
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeFileSync(E2E.currentRun, dir + "\n");
  const golden = readGolden();
  writeFileSync(join(dir, "run.json"), JSON.stringify({ plan: show(file), started_at: new Date().toISOString(), golden, base_url: e2eBaseUrl() }, null, 2) + "\n");
  console.log(`Run ${name}
  Plan        ${show(file)}
  Golden      ${golden ? `from the pull ${golden.pull}, built ${golden.built_at} at ${golden.commit}` : "none yet: run pnpm e2e golden"}
  Example     ${golden?.example ?? golden?.sandbox ?? "?"}   (the example organization)
  Standard    ${golden?.standard ?? "?"}   (the same products, not the example)
  Synthetic   ${golden?.synthetic ?? "none: build the golden master again"}   (its own people: morgan, casey, avery; sam reads its Story)
  Products    ${golden?.products.join("\n              ") ?? "?"}
  Folder      ${dir}
  Recording   log.jsonl, and screenshots in shots/
  Report      write it to ${join(dir, "report.md")}`);
}

/**
 * The command line of a running process, whole, or null when there is none or it cannot be read:
 * from /proc where there is one, else from ps at any width.
 */
function commandOf(pid: number): string | null {
  try {
    if (existsSync("/proc/self/cmdline")) return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim() || null;
    return execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The process id of this checkout's pnpm dev:e2e, from its pid file, or null when none runs. A file
 * left by an instance that is gone is removed, so a process that took its id later is never taken
 * for it: the id must still be running dev.ts in its end-to-end mode.
 */
export function instancePid(pidFile = E2E.pidFile): number | null {
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (Number.isInteger(pid) && pid > 0 && commandOf(pid)?.includes("dev.ts --e2e")) return pid;
  rmSync(pidFile, { force: true });
  return null;
}

/** Record this process as the checkout's end-to-end instance, until it exits. Called by pnpm dev:e2e. */
export function holdInstancePid(pidFile = E2E.pidFile) {
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, `${process.pid}\n`);
  process.on("exit", () => {
    if (existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() === String(process.pid)) rmSync(pidFile, { force: true });
  });
}

/**
 * Stop this checkout's end-to-end instance, and no other checkout's: interrupt the process its pid
 * file names, as Ctrl-C does, and wait for it to stop its servers and its Postgres.
 */
export async function stopInstance(pidFile = E2E.pidFile, waitMs = 30_000): Promise<{ pid: number | null; stopped: boolean }> {
  const pid = instancePid(pidFile);
  if (pid === null) return { pid, stopped: false };
  try {
    process.kill(pid, "SIGINT");
  } catch {
    // It ended by itself just now.
  }
  for (const until = Date.now() + waitMs; Date.now() < until; await new Promise((r) => setTimeout(r, 100)))
    if (!commandOf(pid)?.includes("dev.ts --e2e")) {
      if (existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() === String(pid)) rmSync(pidFile, { force: true });
      return { pid, stopped: true };
    }
  return { pid, stopped: false };
}

/** Stop the browser and the instance (pnpm dev:e2e) this checkout started. */
async function stopAll() {
  await (await import("./e2e-browser.ts")).browserCommand(["stop"]);
  const { pid, stopped } = await stopInstance();
  if (stopped) console.log("Stopped pnpm dev:e2e.");
  else if (pid === null) console.log("pnpm dev:e2e is not running from this checkout.");
  else console.log(`pnpm dev:e2e (process ${pid}) was asked to stop and is still stopping. Run pnpm e2e stop again in a moment.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "golden") return buildGolden(rest);
  if (command === "export") return exportGolden(rest);
  if (command === "plans") return listPlans();
  if (command === "run") return startRun(rest[0]);
  if (command === "stop") return stopAll();
  if (command === "browser") return (await import("./e2e-browser.ts")).browserCommand(rest);
  if (command === "mcp") return (await import("./e2e-mcp.ts")).mcpCommand(rest);
  if (command && command !== "help") process.exitCode = 1;
  console.log(`Usage:
  pnpm e2e golden [pull] [--org s]  build the golden master from a pulled copy of production
  pnpm e2e export [dir]             the golden master as a dump and files, for a Docker host
  pnpm dev:e2e                      reset to the golden master and serve on ${e2eBaseUrl()}
  pnpm e2e plans                    list the plans in e2e/plans
  pnpm e2e run [plan]               start a run of a plan (with none, print the current run)
  pnpm e2e stop                     stop this checkout's browser and pnpm dev:e2e
  pnpm e2e browser <command>        drive the browser (pnpm e2e browser help)
  pnpm e2e mcp <command>            call the MCP server as an agent (pnpm e2e mcp help)`);
  
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
