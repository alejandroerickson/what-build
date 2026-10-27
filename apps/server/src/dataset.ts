import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { actorOf, configurePlans, definedPlans, type Env, type Limits, type PlanDefinition, type Principal } from "@whatbuild/core";
import pg from "pg";
import { createApp, createBlobStore, createMailer, createPorts } from "./app.ts";
import { findOrCreateAccount } from "./auth/identity.ts";
import { loadConfig } from "./config.ts";
import { createDb, migrate, migrationNames } from "./database.ts";
import { adminUrlOf, dropDatabase, LOCAL_PG, PG_PORT, pgDumpCommand, pull, pullsDir, readPull, refusalOf, restorePull, type PullRecord } from "./fixture.ts";
import { DEPLOYMENT_TABLES } from "./organization-copy.ts";
import { addPeople, DEFAULT_COUNT, planPeople, type Plan } from "./people.ts";
import { call, SEED_ACCOUNTS, seed, upload, type SeedPeople } from "./seed.ts";
import { connectOrStartLocalPg } from "./testing/pg.ts";
import { Worker } from "./worker.ts";

/**
 * `pnpm dataset`: the non-production dataset every copy outside production can start from
 * (okf/operations/the-non-production-dataset.md). It is a pull of the deployment's example
 * organization, or of other organizations its instance owners own, with synthetic organizations
 * made beside them through the operations: the development sample, Harbor Labs, with people of its
 * own, and the organizations of `pnpm people`, with many members, pending invitations, a waitlist,
 * allowances, and products and sources sized to each one's plan. It is written as a pull is, so
 * `pnpm fixture load`, `pnpm e2e golden` and the dev deployment's refresh take it as they take any.
 *
 *   pnpm dataset [--org <slug>]… [--all] [--no-files] [--people 100] [--production-schema]
 *                                     pull afresh, as pnpm fixture pull does, then build from it
 *   pnpm dataset --from <pull> [--people 100] [--production-schema]
 *                                     build from a pull already taken
 *
 * It is built in a scratch database of the embedded Postgres, at this code's schema: the pull is
 * migrated first. `--production-schema` refuses to migrate it, for a copy that must start at the
 * deployment's own schema, such as the dev deployment's.
 */
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const EXAMPLE_PLANS = resolve(root, "deploy/plans.example.json");

/**
 * The synthetic organization of the end-to-end golden master and of every dataset: the development
 * sample (`seed.ts`), made by people who belong to it alone, so plans can check that one
 * organization's people see nothing of another's. Sam, who edits the example's teams, only reads
 * its Story: one person with a different role in each.
 */
export const SYNTHETIC = "harbor-labs";
export const SYNTHETIC_PEOPLE: SeedPeople = [
  { email: "morgan@example.com", display_name: "Morgan Reyes" },
  { email: "casey@example.com", display_name: "Casey Lindqvist" },
  { email: "avery@example.com", display_name: "Avery Nakamura" },
];

/**
 * Make the synthetic organization unless it is there: the sample, then Sam made a reader of its
 * Story by its owner, so the grant is in its access changes as any other. `admin` reads past
 * row-level security, as the embedded server's superuser does.
 */
export async function addHarborLabs(env: Env, worker: Worker, admin: pg.Client, log: (line: string) => void = () => {}) {
  if ((await admin.query("select 1 from tenants where slug = $1", [SYNTHETIC])).rowCount) return false;
  await seed(env, worker, log, SYNTHETIC_PEOPLE);
  while ((await worker.drain()) > 0);
  const [riley, sam] = SEED_ACCOUNTS;
  const owner = (await findOrCreateAccount(env.db, SYNTHETIC_PEOPLE[0].email, SYNTHETIC_PEOPLE[0].display_name)).account;
  await findOrCreateAccount(env.db, sam.email, sam.display_name);
  const team = (await admin.query<{ slug: string }>("select m.slug from teams m join tenants t using (tenant_id) where t.slug = $1", [SYNTHETIC])).rows[0]!.slug;
  await call(env, { ...owner, auth_kind: "dev", surface: "web", client: null }, "members.grant", { tenant: SYNTHETIC, team, product: "crewboard", email: sam.email, role: "reader" });
  // The editor's allowance to start an organization comes from the instance's owner, Riley, as in
  // development, not from the organization's owner.
  const instanceOwner = (await findOrCreateAccount(env.db, riley.email, riley.display_name)).account;
  const by = JSON.stringify(actorOf({ ...instanceOwner, auth_kind: "dev", surface: "web", client: null }));
  await admin.query("update tenant_allowances set created_by = $1, updated_by = $1 where lower(email) = $2", [by, SYNTHETIC_PEOPLE[1].email]);
  return true;
}

// ---- What the synthetic organizations hold ----------------------------------------------------

/** Products each organization has, biggest organization first, within what its plan allows. */
const PRODUCTS_BY_RANK = [6, 3, 2, 2, 2];
const PRODUCT_NAMES = [
  "Route planner", "Supplier portal", "Field checklist", "Booking flow", "Returns desk", "Shift swap",
  "Invoice review", "Onboarding guide", "Stock counts", "Member renewals", "Repair tracker", "Event check-in",
];
const OUTCOMES = [
  "Finish the weekly plan in half the time", "Fewer mistakes at the hand-off", "New staff productive in their first week",
  "Customers find answers without calling", "Every job has what it needs before it starts", "Nobody rekeys the same order twice",
];
const ROLES = ["dispatcher", "store manager", "field technician", "office lead", "new hire", "account manager"];
const TOPICS: { tag: string; lines: string[] }[] = [
  {
    tag: "scheduling",
    lines: [
      "Most of Monday goes on moving the same jobs around the board.",
      "When one person is off sick the whole week has to be rebuilt.",
      "We keep the real plan in a spreadsheet because the system is too slow to change.",
      "Repeat jobs should just be there, and they never are.",
      "I would trade every report for a view of who is free tomorrow.",
      "Changes made after lunch never reach the people already out.",
    ],
  },
  {
    tag: "hand-off",
    lines: [
      "The notes from the first visit rarely reach whoever goes second.",
      "We phone each other to find out what was promised.",
      "Half the questions at the door are answered in an email nobody forwarded.",
      "A photo of the paper form is how most hand-offs happen.",
      "When the customer repeats themselves, we have already lost them.",
      "The night shift starts by reading the day's messages from the top.",
    ],
  },
  {
    tag: "onboarding",
    lines: [
      "The first week was mostly finding out where things live.",
      "Nobody wrote down which screens actually matter.",
      "I shadowed someone for three days and still missed the exceptions.",
      "The checklist is from two systems ago.",
      "New people ask the same five questions, every time.",
      "It took a month before I trusted the numbers on the dashboard.",
    ],
  },
  {
    tag: "pricing",
    lines: [
      "Quotes take a day because someone has to check the old ones.",
      "Customers ask why the price changed and we cannot say.",
      "Discounts are agreed on the phone and forgotten by invoice time.",
      "The price list has three versions and each team uses its own.",
      "Small jobs cost us more to quote than they earn.",
      "A clear minimum charge would end most of the arguments.",
    ],
  },
  {
    tag: "reporting",
    lines: [
      "The weekly report is built by hand from four exports.",
      "Nobody reads past the first page, so the first page has to be right.",
      "Numbers differ depending on who ran them and when.",
      "We want to see trouble on Tuesday, not in the monthly review.",
      "The report answers last quarter's questions.",
      "Managers copy the charts into slides and the slides go stale.",
    ],
  },
  {
    tag: "mobile",
    lines: [
      "Out on site the signal comes and goes, so the app has to wait for it.",
      "Gloves make the small buttons impossible.",
      "People take photos with their own phones and send them later.",
      "Typing a long note on a phone at a customer's door feels rude.",
      "The offline mode loses what was entered when the battery dies.",
      "If it took one tap to mark a job done, people would do it on time.",
    ],
  },
];

/** A synthetic source: what it is called, when, its tags, and its one attachment. */
export type SyntheticSource = { title: string; date: string; tags: string[]; path: string; text: string; summary?: string; archived?: boolean };
/** A synthetic product, with its outcomes and sources. */
export type SyntheticProduct = { name: string; slug: string; concept: string; outcomes: string[]; sources: SyntheticSource[] };

const pad = (n: number) => String(n).padStart(2, "0");
const slugOf = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The `i`th source of a product, of one of four kinds in turn: an interview, a call, a survey and support tickets. Pure. */
export function syntheticSource(i: number, seed: number): SyntheticSource {
  const topic = TOPICS[(i + seed) % TOPICS.length]!;
  const role = ROLES[(i * 5 + seed) % ROLES.length]!;
  const line = (n: number) => topic.lines[(i + n * 7 + seed) % topic.lines.length]!;
  const who = `P${pad(1 + ((i * 3 + seed) % 40))}`;
  const date = `2026-${pad(1 + ((i + seed) % 9))}-${pad(1 + ((i * 7 + seed) % 27))}`;
  const tags = [topic.tag, "synthetic"];
  switch (i % 4) {
    case 0:
      return {
        title: `Interview with ${who}, ${role}: ${topic.tag}`,
        date,
        tags: ["interview", ...tags],
        path: "interview.md",
        text: [`# Interview with ${who}`, "", `Role: ${role}. A synthetic interview, made for testing.`, "", "## What they said", "", ...[0, 1, 2, 3].map((n) => `- ${line(n)}`), "", "## To follow up", "", `- ${line(4)}`, ""].join("\n"),
      };
    case 1:
      return {
        title: `Call with ${who} about ${topic.tag}`,
        date,
        tags: ["call", ...tags],
        path: "call.vtt",
        text: ["WEBVTT", "", "00:00:01.000 --> 00:00:05.000", `<v Interviewer>How does ${topic.tag} go for you today?`, "", ...[0, 1, 2].flatMap((n) => [`00:00:${pad(6 + n * 9)}.000 --> 00:00:${pad(14 + n * 9)}.000`, `<v ${who}>${line(n)}`, ""])].join("\n"),
      };
    case 2:
      return {
        title: `Survey on ${topic.tag}, ${6 + (i % 9)} responses`,
        date,
        tags: ["survey", ...tags],
        path: "survey.csv",
        text: ["respondent,role,score,comment", ...Array.from({ length: 6 + (i % 9) }, (_, r) => `R${pad(r + 1)},${ROLES[(r + seed) % ROLES.length]},${1 + ((r * 3 + i) % 5)},"${line(r)}"`), ""].join("\n"),
      };
    default:
      return {
        title: `Support tickets about ${topic.tag}, week ${1 + ((i * 3 + seed) % 52)}`,
        date,
        tags: ["support", ...tags],
        path: "tickets.txt",
        text: [0, 1, 2, 3, 4].map((n) => `Ticket ${1000 + i * 10 + n}: ${line(n)}`).join("\n") + "\n",
      };
  }
}

/**
 * What the organization ranked `rank` (0 the biggest) holds: products, each with two outcomes and
 * sources of four kinds, a summary on every third source and, in a product with eight or more, the
 * last one archived. Sized down the ranks, and never past its plan's totals. Pure.
 */
export function syntheticProducts(rank: number, limits: Pick<Limits, "products_max" | "sources_max"> | null): SyntheticProduct[] {
  const products = Math.min(PRODUCTS_BY_RANK[rank] ?? 1, limits?.products_max ?? Infinity);
  const perProduct = Math.max(4, Math.round(24 / (rank + 1)));
  let left = limits?.sources_max ?? Infinity;
  return Array.from({ length: products }, (_, j) => {
    const name = PRODUCT_NAMES[(rank * 3 + j) % PRODUCT_NAMES.length]!;
    const n = Math.max(0, Math.min(perProduct, left));
    left -= n;
    const sources = Array.from({ length: n }, (_, i) => ({ ...syntheticSource(i, rank * 11 + j), ...(i % 3 === 2 ? { summary: `A synthetic summary of source ${i + 1} of ${name}.` } : {}), ...(n >= 8 && i === n - 1 ? { archived: true } : {}) }));
    return { name, slug: slugOf(name), concept: `${name}: a synthetic product, made for testing.`, outcomes: [0, 1].map((o) => OUTCOMES[(rank + j * 2 + o) % OUTCOMES.length]!), sources };
  });
}

/** Plans' limits on how often and how much, lifted: a build makes in minutes what people make over weeks. What a plan holds in total stays. */
const RATES: (keyof Limits)[] = ["requests_per_minute", "writes_per_minute", "writes_per_day", "sources_per_day", "exports_per_day", "org_writes_per_day", "bytes_per_day", "org_bytes_per_day", "sent_bytes_per_day"];
function liftRates(plans: PlanDefinition[]): PlanDefinition[] {
  return plans.map((p) => ({ ...p, limits: { ...p.limits, ...Object.fromEntries(RATES.map((k) => [k, Number.MAX_SAFE_INTEGER])) } }));
}

export interface SyntheticOrganizations {
  plan: Plan;
  organizations: { slug: string; name: string }[];
  products: number;
  sources: number;
}

/**
 * The organizations of `pnpm people` (`count` people) on the instance at `url`, through its own
 * routes as their people would make them, then their products, outcomes and sources through the
 * operations, by each organization's owners and admins and their agents. `env` is that instance's;
 * `admin` reads past row-level security.
 */
export async function addSyntheticOrganizations(opts: { env: Env; worker: Worker; admin: pg.Client; url: string; count: number; log?: (line: string) => void }): Promise<SyntheticOrganizations> {
  const log = opts.log ?? (() => {});
  const configured = definedPlans();
  configurePlans(liftRates(configured));
  try {
    const { plan } = await addPeople({ url: opts.url, count: opts.count, owner: SEED_ACCOUNTS[0].email, log, sleep: async () => {} });
    let products = 0;
    let sources = 0;
    for (const [rank, org] of plan.organizations.entries()) {
      const limits = configured.find((p) => p.id === org.plan)?.limits ?? null;
      const tenant = (await opts.admin.query<{ tenant_id: string; team: string }>("select t.tenant_id, m.slug as team from tenants t join teams m using (tenant_id) where t.slug = $1 order by m.created_at limit 1", [org.slug])).rows[0]!;
      const writers: Principal[] = [];
      for (const p of plan.people.filter((p) => p.kind !== "invited" && p.organizations.some((o) => o.slug === org.slug && o.role !== "member"))) {
        const account = (await findOrCreateAccount(opts.env.db, p.email, p.name)).account;
        writers.push({ ...account, auth_kind: "dev", surface: "web", client: null }, { ...account, auth_kind: "dev", surface: "mcp", client: "claude-code" });
      }
      const owner = writers[0]!;
      for (const product of syntheticProducts(rank, limits)) {
        const made = (await call(opts.env, owner, "products.create", { tenant: org.slug, team: tenant.team, name: product.name, slug: product.slug, concept: product.concept })) as { product_id: string };
        const ref = { product: made.product_id };
        for (const title of product.outcomes) await call(opts.env, owner, "outcomes.create", { title }, ref);
        for (const [i, s] of product.sources.entries()) {
          const who = writers[i % writers.length]!;
          const r = await call(opts.env, who, "sources.create", { title: s.title, date: s.date, tags: s.tags }, ref);
          const id = String(r["record_id"]);
          await upload(opts.env, who, ref, tenant.tenant_id, id, s.path, s.text);
          if (s.summary) await call(opts.env, who, "derived.write_note", { record_id: id, note_kind: "summary", content: s.summary }, ref);
          if (s.archived) await call(opts.env, who, "sources.archive", { record_ids: [id] }, ref);
          sources++;
        }
        products++;
      }
      log(`  ${org.slug}: ${plan.people.filter((p) => p.organizations.some((o) => o.slug === org.slug)).length} people, on ${org.plan}`);
    }
    // Every attachment read as it would be on a deployment, and the search index built.
    while ((await opts.worker.drain()) > 0);
    return { plan, organizations: plan.organizations.map((o) => ({ slug: o.slug, name: o.name })), products, sources };
  } finally {
    configurePlans(configured);
  }
}

/**
 * What only a running deployment keeps, which a dataset leaves out as a pull does
 * (`DEPLOYMENT_TABLES`): the sessions and connections signing its synthetic people in made, the
 * guests' places it gave them, and the usage they counted. The waitlist and the allowances its
 * synthetic people were given stay: they are its shape.
 */
const KEPT = ["interest", "tenant_allowances"];
export async function clearDeploymentRows(admin: pg.Client) {
  const present = new Set((await admin.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name));
  for (const t of DEPLOYMENT_TABLES.filter((t) => present.has(t) && !KEPT.includes(t))) await admin.query(`delete from "${t}"`);
}

/** Every table's rows, as a pull records them, to check a restore of the dataset against. */
async function rowsOf(admin: pg.Client) {
  const tables = (await admin.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows;
  const rows: Record<string, number> = {};
  for (const { table_name: t } of tables) rows[t] = (await admin.query<{ n: number }>(`select count(*)::int as n from "${t}"`)).rows[0]!.n;
  return rows;
}

function option(args: string[], flag: string) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** An instance of this code on `database`, listening on this machine only, for the synthetic people to sign in to. */
async function serveOn(url: (port: number) => string, database: string, files: string, example: string | undefined, allowlist: string) {
  let app: ReturnType<typeof createApp> | null = null;
  const { server, port } = await new Promise<{ server: ServerType; port: number }>((done) => {
    const listening: ServerType = serve({ fetch: (req, env) => (app ? app.fetch(req, env) : new Response("Starting", { status: 503 })), port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => done({ server: listening, port: info.port }));
  });
  // Quiet as a test's server: nobody but the build calls it, and its request log would bury the build's.
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: database,
    WHATBUILD_PUBLIC_URL: url(port),
    WHATBUILD_BLOB_STORE: "fs",
    WHATBUILD_BLOB_DIR: files,
    WHATBUILD_MAILER: "memory",
    WHATBUILD_PLANS: EXAMPLE_PLANS,
    WHATBUILD_NEW_ORGANIZATION_PLAN: "free",
    WHATBUILD_INSTANCE_OWNERS: SEED_ACCOUNTS[0].email,
    WHATBUILD_SIGNUP_ALLOWLIST: allowlist,
    WHATBUILD_TENANT_ALLOWANCE: "0",
    WHATBUILD_WORKER: "0",
    ...(example ? { WHATBUILD_EXAMPLE_TENANT: example } : {}),
  });
  const { db, pool } = createDb(database, 5);
  const ports = createPorts(config, await createBlobStore(config), createMailer(config));
  app = createApp({ db, ports, config });
  const close = async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await pool.end();
  };
  return { url: url(port), env: { db, ports } satisfies Env, close };
}

/** Build a dataset from the pull `from` into the pulls' folder, beside it, and return its name. */
export async function buildDataset(from: string, opts: { count: number; productionSchema: boolean; log?: (line: string) => void }) {
  const log = opts.log ?? console.log;
  const source = readPull(from);
  const refused = refusalOf(from, source);
  if (refused) throw new Error(refused);
  if (source.dataset) throw new Error(`${from} is a dataset already: build from the pull it was built from, ${source.dataset.from}.`);
  const plan = planPeople(opts.count);
  const name = `${new Date().toISOString().slice(0, 16).replace(":", "")}Z-dataset`;
  const dir = join(pullsDir(), name);
  if (existsSync(dir)) throw new Error(`There is already a dataset named ${name}: wait a minute and build again.`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files = join(dir, "files");
  const local = await connectOrStartLocalPg(LOCAL_PG, PG_PORT, { portVariable: "WHATBUILD_PG_PORT" });
  const scratch = `dataset_${randomBytes(4).toString("hex")}`;
  let record: PullRecord;
  try {
    await restorePull(local, scratch, files, from);
    const admin = new pg.Client({ connectionString: adminUrlOf(local, scratch) });
    await admin.connect();
    try {
      const pulled = (await admin.query<{ name: string }>("select max(name) as name from schema_migrations")).rows[0]!.name;
      const code = migrationNames().at(-1)!;
      if (opts.productionSchema && pulled !== code)
        throw new Error(`This code's schema (${code}) is not the pull's (${pulled}), and --production-schema keeps the pull's: build the dataset from a checkout of the release the deployment runs.`);
      const example = (await admin.query<{ slug: string }>("select slug from tenants where example")).rows[0]?.slug;
      const instance = await serveOn((port) => `http://127.0.0.1:${port}`, local.appUrl(scratch), files, example, plan.allowlist);
      try {
        const worker = new Worker(instance.env, 60_000, () => {});
        // At this code's schema, with the jobs its migrations queue done, before anything is added.
        await migrate(instance.env.db, (m) => log(`  ${m}`));
        while ((await worker.drain()) > 0);
        log(`Adding ${SYNTHETIC}, the development sample, with people of its own…`);
        const configured = definedPlans();
        configurePlans(liftRates(configured));
        try {
          await addHarborLabs(instance.env, worker, admin);
        } finally {
          configurePlans(configured);
        }
        log(`Adding the organizations of ${opts.count} synthetic people…`);
        const made = await addSyntheticOrganizations({ env: instance.env, worker, admin, url: instance.url, count: opts.count, log });
        log(`  ${made.products} products and ${made.sources} sources in them`);
        await clearDeploymentRows(admin);
        const migration = (await admin.query<{ name: string }>("select max(name) as name from schema_migrations")).rows[0]!.name;
        const harbor = (await admin.query<{ name: string }>("select name from tenants where slug = $1", [SYNTHETIC])).rows[0]!;
        record = {
          pulled_at: source.pulled_at,
          organizations: source.organizations,
          rows: await rowsOf(admin),
          files: true,
          owned_by_instance_owners: true,
          dataset: { built_at: new Date().toISOString(), from, commit: gitCommit(), migration, people: opts.count, synthetic: [{ slug: SYNTHETIC, name: harbor.name }, ...made.organizations] },
        };
      } finally {
        await instance.close();
      }
    } finally {
      await admin.end();
    }
    const dump = pgDumpCommand(adminUrlOf(local, scratch), join(dir, "database.dump"));
    execFileSync("pg_dump", dump.args, { stdio: "inherit", env: dump.env });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  } finally {
    await dropDatabase(local, scratch).catch(() => {});
    await local.stop();
  }
  // Written last, as a pull's is: a dataset that stopped part-way is never loaded.
  writeFileSync(join(dir, "pulled.json"), JSON.stringify(record, null, 2) + "\n");
  log(`Built the dataset ${name} (${relative(root, dir).startsWith("..") ? dir : relative(root, dir)}): the pull ${from}, ${SYNTHETIC} and ${record.dataset!.synthetic.length - 1} organizations of synthetic people, at ${record.dataset!.migration}.
Load it as any pull: pnpm fixture load, or pnpm e2e golden.`);
  return name;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("help")) {
    console.log(`Usage:
  pnpm dataset [--org <slug>]… [--all] [--no-files]  pull afresh (as pnpm fixture pull), then build from it
  pnpm dataset --from <pull>                         build from a pull already taken
    --people <n>                                     how many synthetic people (${DEFAULT_COUNT})
    --production-schema                              refuse to migrate the pull: for the dev deployment`);
    return;
  }
  const count = option(args, "--people") === undefined ? DEFAULT_COUNT : Number(option(args, "--people"));
  planPeople(count);
  if (args.includes("--for-another-deployment")) throw new Error("A dataset is a copy outside production: it takes only organizations an instance owner owns.");
  if (args.includes("--files-into")) throw new Error("A dataset keeps its files with it, in its files/ folder; copy them where the copy needs them.");
  const from = option(args, "--from");
  const pullArgs = args.filter((a, i) => !["--people", "--from", "--production-schema"].includes(a) && !["--people", "--from"].includes(args[i - 1] ?? ""));
  if (from && pullArgs.length) throw new Error(`--from builds from a pull already taken, which named its organizations: leave out ${pullArgs.join(" ")}.`);
  await buildDataset(from ?? (await pull(pullArgs)), { count, productionSchema: args.includes("--production-schema") });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
