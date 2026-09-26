import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBlobStore, createMailer, createPorts } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb, migrate } from "./database.ts";
import { seed } from "./seed.ts";
import { startLocalPg, type LocalPg } from "./testing/pg.ts";
import { Worker } from "./worker.ts";

/**
 * `pnpm dev`: a running, signed-in WhatBuild with sample data, from a fresh clone, with nothing
 * installed but Node. Postgres comes from an npm package (no Docker, no account, no API key);
 * files go to ./.what-build/blobs; sign-in links print here.
 *
 *   pnpm dev                 embedded Postgres on :54329, API on :8787, web app on :5273
 *   DATABASE_URL=… pnpm dev  use your own Postgres instead
 */
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const API_PORT = Number(process.env["PORT"] ?? 8787);
const WEB_PORT = Number(process.env["WHATBUILD_WEB_PORT"] ?? 5273);

async function main() {
  let pg: LocalPg | null = null;
  let databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.log("Starting Postgres (embedded, in .what-build/pg)…");
    pg = await startLocalPg(resolve(root, ".what-build/pg"), Number(process.env["WHATBUILD_PG_PORT"] ?? 54329));
    databaseUrl = await pg.createDatabase("whatbuild");
  }
  const env = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: databaseUrl,
    PORT: String(API_PORT),
    WHATBUILD_PUBLIC_URL: process.env["WHATBUILD_PUBLIC_URL"] ?? `http://localhost:${WEB_PORT}`,
    WHATBUILD_BLOB_DIR: process.env["WHATBUILD_BLOB_DIR"] ?? resolve(root, ".what-build/blobs"),
  };
  const config = loadConfig(env);
  const { db, pool } = createDb(databaseUrl, 3);
  await migrate(db);
  const ports = createPorts(config, await createBlobStore(config), createMailer(config));
  const worker = new Worker({ db, ports }, 60_000, () => {});
  await seed({ db, ports }, worker);
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

  console.log(`
  WhatBuild is starting.

    App            http://localhost:${WEB_PORT}
    Sign in as     riley@example.com (owner) or sam@example.com (editor) — one click on the sign-in page
    MCP endpoint   http://localhost:${WEB_PORT}/mcp   (claude mcp add --transport http whatbuild-dev http://localhost:${WEB_PORT}/mcp)
    Database       ${pg ? "embedded Postgres in .what-build/pg" : "DATABASE_URL"}
    Files          .what-build/blobs

  Sign-in links and invitation emails are printed below. Ctrl-C stops everything.
`);

  const stop = async () => {
    for (const c of children) c.kill("SIGTERM");
    await pg?.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
