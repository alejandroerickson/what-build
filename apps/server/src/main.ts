import { serve } from "@hono/node-server";
import { usageSettled } from "@whatbuild/core";
import { createApp, createBlobStore, createMailer, createPorts } from "./app.ts";
import { loadConfig } from "./config.ts";
import { checkRowSecurity, createDb, migrate } from "./database.ts";
import { SandboxClock, syncSandboxTenant } from "./public-sandbox.ts";
import { seed } from "./seed.ts";
import { Worker } from "./worker.ts";

/**
 * whatbuild <command>
 *   serve     HTTP (web app, REST, MCP) plus the job worker unless WHATBUILD_WORKER=0
 *   worker    the job worker only
 *   migrate   apply database migrations, then exit
 *   seed      create the synthetic sample product and two accounts, then exit
 */
async function main() {
  const command = process.argv[2] ?? "serve";
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
  if (command !== "serve") throw new Error(`Unknown command ${command}. Use serve, worker, migrate or seed.`);

  await syncSandboxTenant(db, config.sandboxTenant);
  const clock = new SandboxClock({ db, ports });
  // While an instance is alive it looks every minute; a request looks too, so a sleeping service loses nothing.
  const ticking = setInterval(() => void clock.resetIfDue().catch((e) => console.error("sandbox reset:", e)), 60_000);
  ticking.unref();

  if (config.runWorker) worker.start();
  const app = createApp({ db, ports, config, clock });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
    console.log(`WhatBuild listening on :${info.port} (public URL ${config.publicBaseUrl})`);
  });
  const shutdown = () => {
    worker?.stop();
    clearInterval(ticking);
    // The calls already answered are counted before the database goes.
    server.close(() => void usageSettled().then(() => pool.end()).then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
