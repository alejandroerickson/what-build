import { serve } from "@hono/node-server";
import { usageSettled } from "@whatbuild/core";
import { createApp, createBlobStore, createMailer, createPorts, SERVER_VERSION } from "./app.ts";
import { loadConfig } from "./config.ts";
import { checkRowSecurity, createDb, migrate, watchPool } from "./database.ts";
import { syncExampleTenant } from "./example-organization.ts";
import { checkParsing } from "./parse-process.ts";
import { seed } from "./seed.ts";
import { startTracing } from "./telemetry.ts";
import { Worker } from "./worker.ts";

/**
 * How long the service's worker keeps looking at the queue after the last request or job before it
 * sleeps: longer than a failed job's first three waits before it is tried again (10, 20 and 40
 * seconds), and far shorter than the five idle minutes after which Neon suspends the database.
 */
const WORKER_IDLE_MS = 60_000;

/**
 * whatbuild <command>
 *   serve     HTTP (web app, REST, MCP) plus the job worker unless WHATBUILD_WORKER=0
 *   worker    the job worker only
 *   migrate   apply database migrations, then exit
 *   seed      create the synthetic sample product and three accounts, then exit
 *   check-parsing   parse a small file of each kind a package is needed for, then exit; needs no database
 */
async function main() {
  const command = process.argv[2] ?? "serve";
  if (command === "check-parsing") return checkParsing();
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not set. For local development run `pnpm dev`, which starts a database for you.");
  const { db, pool } = createDb(config.databaseUrl);

  if (command === "migrate") {
    const ran = await migrate(db);
    console.log(ran.length ? `applied ${ran.length} migration(s)` : "database is up to date");
    await pool.end();
    return;
  }

  const rls = await checkRowSecurity(db);
  if (!rls.enforced) {
    const msg = `Database role "${rls.role}" bypasses row-level security, so tenant isolation rests on the application alone. Connect as a role without SUPERUSER or BYPASSRLS.`;
    if (config.env === "production") throw new Error(msg);
    console.warn(`warning: ${msg}`);
  }

  if (config.feedbackEmail && config.mailer === "none") console.warn("warning: WHATBUILD_FEEDBACK_EMAIL is set, but this deployment sends no mail, so feedback stays in the database. Configure the smtp or acs mailer to send the digest.");

  // Traces go where the deployment says, if anywhere (telemetry.ts); the server runs the same without.
  const tracing = command === "serve" || command === "worker" ? await startTracing(SERVER_VERSION) : null;

  const blobs = await createBlobStore(config);
  const mailer = createMailer(config);
  let worker: Worker | null = null;
  const ports = createPorts(config, blobs, mailer, () => worker?.wake());
  worker = new Worker({ db, ports });

  if (command === "seed") {
    await seed({ db, ports }, worker);
    await pool.end();
    return;
  }
  if (command === "worker") {
    worker.start();
    console.log("worker running");
    return;
  }
  if (command !== "serve") throw new Error(`Unknown command ${command}. Use serve, worker, migrate, seed or check-parsing.`);

  await syncExampleTenant(db, config.exampleTenant);
  if (process.env["WHATBUILD_SANDBOX_TENANT"] && !config.exampleTenant)
    console.log("warning: WHATBUILD_SANDBOX_TENANT is no longer read. The public sandbox became the example organization: name it with WHATBUILD_EXAMPLE_TENANT.");

  if (config.runWorker) worker.start({ idleMs: WORKER_IDLE_MS });
  watchPool(pool, ports.searches);
  const app = createApp({ db, ports, config, onRequest: config.runWorker ? () => worker?.nudge() : undefined });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
    console.log(`WhatBuild listening on :${info.port} (public URL ${config.publicBaseUrl})`);
  });
  const shutdown = () => {
    worker?.stop();
    // Its job goes back in the queue, for the next instance, without waiting for the parse.
    ports.parser.stop();
    // The calls already answered are counted before the database goes.
    server.close(() => void usageSettled().then(() => tracing?.shutdown()).then(() => pool.end()).then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
