import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import pg from "pg";
import type { UrlFetcher } from "@whatbuild/core";
import { inject } from "vitest";
import { MemoryBlobStore } from "../src/adapters/blobs.ts";
import { MemoryMailer } from "../src/adapters/misc.ts";
import { createApp, createPorts } from "../src/app.ts";
import { loadConfig, type ServerConfig } from "../src/config.ts";
import { createDb, migrate } from "../src/database.ts";
import { Worker } from "../src/worker.ts";

export interface Harness {
  baseUrl: string;
  db: ReturnType<typeof createDb>["db"];
  worker: Worker;
  mailer: MemoryMailer;
  blobs: MemoryBlobStore;
  config: ServerConfig;
  /** A signed-in browser: fetch with its session cookie and a same-origin Origin header. */
  signIn(email: string, name?: string): Promise<Browser>;
  close(): Promise<void>;
}

export interface Browser {
  email: string;
  cookie: string;
  api<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Headers }>;
}

/** A fresh database, migrated, behind a real HTTP server on a random port. */
export async function startHarness(overrides: Partial<ServerConfig> = {}, opts: { fetcher?: UrlFetcher } = {}): Promise<Harness> {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: inject("adminUrl") });
  await admin.connect();
  await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
  await admin.end();
  const url = inject("appUrlTemplate").replace("{db}", name);
  const { db, pool } = createDb(url, 5);
  await migrate(db, () => {});

  let server: ServerType | null = null;
  const port = await new Promise<number>((resolvePort) => {
    const probe = serve({ fetch: () => new Response(""), port: 0 }, (info: AddressInfo) => {
      probe.close();
      resolvePort(info.port);
    });
  });
  const baseUrl = `http://localhost:${port}`;
  const config: ServerConfig = { ...loadConfig({ NODE_ENV: "test", WHATBUILD_PUBLIC_URL: baseUrl, DATABASE_URL: url }), mailer: "memory", blobStore: "memory", ...overrides };
  const blobs = new MemoryBlobStore();
  const mailer = new MemoryMailer();
  let worker: Worker | null = null;
  const ports = createPorts(config, blobs, mailer, () => undefined);
  // A test that fetches URLs stands in for the network.
  if (opts.fetcher) ports.fetcher = opts.fetcher;
  worker = new Worker({ db, ports }, 60_000, () => {});
  const app = createApp({ db, ports, config });
  server = serve({ fetch: app.fetch, port });

  const makeBrowser = (email: string, cookie: string): Browser => ({
    email,
    cookie,
    async api(method, path, body, headers = {}) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { cookie, origin: baseUrl, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: res.status, body: parsed as never, headers: res.headers };
    },
  });

  return {
    baseUrl,
    db,
    worker: worker!,
    mailer,
    blobs,
    config,
    async signIn(email, displayName) {
      const res = await fetch(`${baseUrl}/auth/dev-sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ email, display_name: displayName }),
      });
      if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
      const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
      return makeBrowser(email, cookie);
    },
    async close() {
      worker?.stop();
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      await pool.end();
    },
  };
}
