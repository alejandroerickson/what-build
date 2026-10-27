import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBlobStore, createMailer, createPorts } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb, migrate } from "./database.ts";
import { E2E, goldenRefusal, holdInstancePid, instancePid, resetToGolden } from "./e2e.ts";
import { addSamplePeople, FIXTURE_BLOBS, FIXTURE_DATABASE } from "./fixture.ts";
import { addPeople, DEFAULT_COUNT, describePlan, planPeople } from "./people.ts";
import { SEED_ACCOUNTS, seed } from "./seed.ts";
import { connectOrStartLocalPg, startLocalPg, type LocalPg } from "./testing/pg.ts";
import { Worker } from "./worker.ts";

/**
 * `pnpm dev`: a running, signed-in WhatBuild with sample data, from a fresh clone, with nothing
 * installed but Node. Postgres comes from an npm package (no Docker, no account, no API key);
 * files go to ./.what-build/blobs; sign-in links print here.
 *
 *   pnpm dev                 embedded Postgres on :54329, API on :8787, web app on :5273
 *   DATABASE_URL=… pnpm dev  use your own Postgres instead
 *   WHATBUILD_EXAMPLE_TENANT=<slug> pnpm dev
 *                            another organization as the example every account reads; by default
 *                            the sample organization is, and an empty value turns it off
 *   pnpm dev:fixture         the copy of a deployment that `pnpm fixture load` put in place, with the
 *                            sample people added to it and no sample data; mail only prints here
 *                            (okf/operations/a-copy-of-production.md)
 *   pnpm dev:e2e             the end-to-end instance: its own Postgres and files, reset to the golden
 *                            master that `pnpm e2e golden` built, on :5283 and :8797, beside any
 *                            pnpm dev; mail only prints here (okf/operations/end-to-end-tests.md)
 *   pnpm dev:people [--count N]
 *                            the sample, and a hundred synthetic people (or N) in organizations, invited,
 *                            allowed and on the waitlist, in a database of their own, invite-only as a
 *                            deployment taking sign-ups is (okf/operations/local-development.md)
 */
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** Said once at start, when the development cluster was made before local clusters were made in UTF-8. */
const OLD_CLUSTER = (encoding: string) => `
  The local Postgres in .what-build/pg was made in ${encoding}, before local clusters were made in
  UTF-8, so its text functions count bytes where production counts characters. It holds your local
  work, so it is left as it is. For one in UTF-8: stop pnpm dev, move the old one aside
  (mv .what-build/pg .what-build/pg-${encoding.toLowerCase()}), and start pnpm dev again, which makes a
  new one and seeds it; pnpm fixture load puts a copy of production into it again.
`;
const FIXTURE = process.argv.includes("--fixture");
const END_TO_END = process.argv.includes("--e2e");
const PEOPLE = process.argv.includes("--people");
const PEOPLE_COUNT = process.argv.includes("--count") ? Number(process.argv[process.argv.indexOf("--count") + 1]) : DEFAULT_COUNT;
const API_PORT = END_TO_END ? E2E.apiPort : Number(process.env["PORT"] ?? 8787);
const WEB_PORT = END_TO_END ? E2E.webPort : Number(process.env["WHATBUILD_WEB_PORT"] ?? 5273);

async function main() {
  let pg: LocalPg | null = null;
  let databaseUrl = END_TO_END ? undefined : process.env["DATABASE_URL"];
  let exampleTenant: string | undefined;
  let ownPeople: string[] = [];
  if (END_TO_END) {
    const running = instancePid();
    if (running !== null) throw new Error(`This checkout's end-to-end instance is already running (process ${running}). Stop it with pnpm e2e stop first.`);
    // Another server on these ports would answer the tests in its place, with other code and data.
    for (const [name, port, variable] of [["API", API_PORT, "WHATBUILD_E2E_API_PORT"], ["web", WEB_PORT, "WHATBUILD_E2E_WEB_PORT"]] as const)
      if (!(await portFree(port))) throw new Error(`The end-to-end instance's ${name} port ${port} is taken by another process. Stop it, or choose another port with ${variable}.`);
    // So that pnpm e2e stop stops this instance, and no other checkout's.
    holdInstancePid();
    console.log("Starting the end-to-end instance's Postgres (embedded, in .what-build/e2e/pg)…");
    pg = await connectOrStartLocalPg(E2E.pgDir, E2E.pgPort, { portVariable: "WHATBUILD_E2E_PG_PORT" });
    if (pg.encoding !== "UTF8") console.log(`  The golden master was built in ${pg.encoding}, before local clusters were made in UTF-8: build it again with pnpm e2e golden.`);
    const reset = await resetToGolden(pg).catch(async (e: unknown) => {
      await pg!.stop();
      throw e;
    });
    databaseUrl = reset.url;
    exampleTenant = reset.golden.example ?? reset.golden.sandbox;
    ownPeople = reset.golden.synthetic ? [reset.golden.synthetic] : [];
    console.log(`Reset to the golden master (from the pull ${reset.golden.pull}, built ${reset.golden.built_at}).`);
    const refused = goldenRefusal(reset.golden);
    if (refused) console.log(`  ${refused}`);
  } else if (!databaseUrl) {
    console.log("Starting Postgres (embedded, in .what-build/pg)…");
    pg = await startLocalPg(resolve(root, ".what-build/pg"), Number(process.env["WHATBUILD_PG_PORT"] ?? 54329), { portVariable: "WHATBUILD_PG_PORT" });
    if (pg.encoding !== "UTF8") console.log(OLD_CLUSTER(pg.encoding));
    if (FIXTURE && !(await pg.hasDatabase(FIXTURE_DATABASE))) {
      await pg.stop();
      throw new Error("No copy is loaded: run pnpm fixture pull, then pnpm fixture load.");
    }
    databaseUrl = FIXTURE ? pg.appUrl(FIXTURE_DATABASE) : await pg.createDatabase(PEOPLE ? "people" : "whatbuild");
  }
  const env = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: databaseUrl,
    PORT: String(API_PORT),
    WHATBUILD_PUBLIC_URL: process.env["WHATBUILD_PUBLIC_URL"] ?? `http://localhost:${WEB_PORT}`,
    // Vite proxies the API here, so a second instance on other ports talks to its own API.
    WHATBUILD_API: process.env["WHATBUILD_API"] ?? `http://localhost:${API_PORT}`,
    WHATBUILD_BLOB_DIR: END_TO_END ? E2E.blobs : FIXTURE ? FIXTURE_BLOBS : (process.env["WHATBUILD_BLOB_DIR"] ?? resolve(root, PEOPLE ? ".what-build/people-blobs" : ".what-build/blobs")),
    // A copy of a deployment holds real people's addresses and files: its mail only prints here,
    // and its files are the local copy, never the deployment's bucket. The end-to-end instance
    // may hold one, and a test never mails anyone either.
    ...(FIXTURE || END_TO_END ? { WHATBUILD_MAILER: "console", WHATBUILD_BLOB_STORE: "fs" } : {}),
    // The sample owner runs this instance, so the instance owner's page has someone to show it to.
    WHATBUILD_INSTANCE_OWNERS: process.env["WHATBUILD_INSTANCE_OWNERS"] ?? SEED_ACCOUNTS[0].email,
    // As on a deployment that offers plans: the example plans file's, and someone else's new organization is on its free plan.
    WHATBUILD_PLANS: process.env["WHATBUILD_PLANS"] ?? resolve(root, "deploy/plans.example.json"),
    WHATBUILD_NEW_ORGANIZATION_PLAN: process.env["WHATBUILD_NEW_ORGANIZATION_PLAN"] ?? "free",
    // Many people try to get in as on a deployment taking sign-ups: let in by the allowlist (one of
    // the synthetic organizations' domain), an invitation or an allowance, and otherwise refused.
    ...(PEOPLE ? { WHATBUILD_SIGNUP_ALLOWLIST: process.env["WHATBUILD_SIGNUP_ALLOWLIST"] ?? planPeople(PEOPLE_COUNT).allowlist } : {}),
    // The golden master's example stays the example; the server reads this at start-up.
    ...(exampleTenant ? { WHATBUILD_EXAMPLE_TENANT: exampleTenant } : {}),
  } as Record<string, string | undefined>;
  const config = loadConfig(env);
  const { db, pool } = createDb(databaseUrl, 3);
  await migrate(db);
  const ports = createPorts(config, await createBlobStore(config), createMailer(config));
  if (FIXTURE || END_TO_END) await addSamplePeople(db, ownPeople);
  else if (!END_TO_END) {
    const worker = new Worker({ db, ports }, 60_000, () => {});
    await seed({ db, ports }, worker);
  }
  // As on a deployment, every account reads an example organization: by default the sample one, and
  // in a copy of a deployment the one it was copied with.
  if (env["WHATBUILD_EXAMPLE_TENANT"] === undefined) {
    const copied = await db.selectFrom("tenants").select("slug").where("example", "=", true).executeTakeFirst();
    env["WHATBUILD_EXAMPLE_TENANT"] = copied?.slug ?? (FIXTURE || END_TO_END ? "" : "harbor-labs");
  }
  await pool.end();

  const children: ChildProcess[] = [];
  const run = (name: string, cmd: string, args: string[], cwd: string) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const prefix = (line: string) => `${name.padEnd(4)} │ ${line}`;
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (buf: Buffer) => {
        for (const line of buf.toString().split("\n")) if (line.trim()) console.log(prefix(line));
      });
    children.push(child);
  };
  run("api", resolve(root, "apps/server/node_modules/.bin/tsx"), ["watch", "--clear-screen=false", "src/main.ts", "serve"], resolve(root, "apps/server"));
  run("web", resolve(root, "apps/web/node_modules/.bin/vite"), ["--port", String(WEB_PORT), "--strictPort"], resolve(root, "apps/web"));

  console.log(PEOPLE ? `
  WhatBuild is starting with the sample and ${PEOPLE_COUNT} synthetic people, invite-only.

    App            http://localhost:${WEB_PORT}
    Sign in as     riley@example.com (owner of this instance: People, Organization creators,
                   Organizations) — one click on the sign-in page — or any of the people listed
                   once they are added, with "As the email above"
    Let in         by ${env["WHATBUILD_SIGNUP_ALLOWLIST"]}, an invitation or an allowance; anyone else is
                   refused. Sign-in links and invitations are printed below.
    Database       embedded Postgres in .what-build/pg, database "people"
    Files          .what-build/people-blobs

  Ctrl-C stops everything; the people stay for the next start.
` : END_TO_END ? `
  WhatBuild's end-to-end instance is starting, reset to the golden master.

    App            http://localhost:${WEB_PORT}
    Sign in as     riley@example.com (owns the example and its copy), sam@example.com (edits
                   their teams, reads the synthetic organization's Story) or jordan@example.com
                   (reads their Stories); the synthetic organization's own morgan@, casey@ and
                   avery@example.com; pnpm e2e browser signin <name> does it in the test browser
    MCP endpoint   http://localhost:${WEB_PORT}/mcp   (pnpm e2e mcp connects to it as an agent)
    Database       embedded Postgres in .what-build/e2e/pg, database "${E2E.database}"
    Files          .what-build/e2e/blobs

  Stop and start again to go back to the golden master. Ctrl-C stops everything.
` : FIXTURE ? `
  WhatBuild is starting on the copy loaded by pnpm fixture load.

    App            http://localhost:${WEB_PORT}
    Sign in as     riley@example.com (owner of every organization), sam@example.com (editor of
                   every team) or jordan@example.com (reads every Story) — one click on the
                   sign-in page — or "As the email above" with an account in the copy; nothing
                   is sent to anyone
    MCP endpoint   http://localhost:${WEB_PORT}/mcp
    Database      embedded Postgres, database "${FIXTURE_DATABASE}"
    Files          .what-build/fixture-blobs

  Pending migrations have run; the worker is doing the jobs they queued. Ctrl-C stops everything.
` : `
  WhatBuild is starting.

    App            http://localhost:${WEB_PORT}
    Sign in as     riley@example.com (owner, and owner of this instance), sam@example.com (editor,
                   who may start one organization) or jordan@example.com (reads only the Story)
                   — one click on the sign-in page
    MCP endpoint   http://localhost:${WEB_PORT}/mcp   (claude mcp add --transport http whatbuild-dev http://localhost:${WEB_PORT}/mcp)
    Database       ${pg ? "embedded Postgres in .what-build/pg" : "DATABASE_URL"}
    Files          .what-build/blobs

  Sign-in links and invitation emails are printed below. Ctrl-C stops everything.
`);

  if (PEOPLE) {
    const url = env["WHATBUILD_PUBLIC_URL"]!;
    const owner = config.instanceOwners[0] ?? SEED_ACCOUNTS[0].email;
    void (async () => {
      // The web app's address, once it answers and its API behind it does.
      for (let i = 0; ; i++) {
        const up = await fetch(`${url}/auth/methods`).then((r) => r.ok, () => false);
        if (up) break;
        if (i > 120) throw new Error(`${url} did not answer within two minutes.`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      const log = (line: string) => console.log(`ppl  │ ${line}`);
      log(`Adding ${PEOPLE_COUNT} synthetic people…`);
      const { plan, added } = await addPeople({ url, count: PEOPLE_COUNT, owner, log });
      for (const line of describePlan(plan).split("\n")) log(line);
      log(`Added ${added.allowances} allowances, ${added.organizations} organizations, ${added.grants} roles and ${added.invitations} invitations; the rest was there already.`);
    })().catch((e: unknown) => console.error(`ppl  │ ${e instanceof Error ? e.message : String(e)}`));
  }

  const stop = async () => {
    for (const c of children) c.kill("SIGTERM");
    await pg?.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

function portFree(port: number) {
  return new Promise<boolean>((done) => {
    const probe = createServer()
      .once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true)))
      .listen(port, "0.0.0.0");
  });
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
