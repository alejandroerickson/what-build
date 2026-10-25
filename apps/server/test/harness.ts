import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import pg from "pg";
import { usageSettled, type UrlFetcher } from "@whatbuild/core";
import { inject } from "vitest";
import { MemoryBlobStore } from "../src/adapters/blobs.ts";
import { MemoryMailer } from "../src/adapters/misc.ts";
import { createApp, createPorts } from "../src/app.ts";
import { loadConfig, type ServerConfig } from "../src/config.ts";
import { createDb, migrate } from "../src/database.ts";
import { SandboxClock } from "../src/public-sandbox.ts";
import { Worker } from "../src/worker.ts";

export interface Harness {
  baseUrl: string;
  db: ReturnType<typeof createDb>["db"];
  worker: Worker;
  /** The server's own clock for sandbox resets. `touch()` makes it look again at once. */
  clock: SandboxClock;
  mailer: MemoryMailer;
  blobs: MemoryBlobStore;
  config: ServerConfig;
  /** A signed-in browser: fetch with its session cookie and a same-origin Origin header. `next` is where the sign-in was returning to. */
  signIn(email: string, name?: string, next?: string): Promise<Browser>;
  /**
   * Follow the sign-in link in the last email sent, as a person does: open it, then press Sign in on
   * its page. The answer to the press (a 303 to where the sign-in returns, with the session cookie),
   * and that cookie, if one was set.
   */
  followSignInLink(): Promise<{ response: Response; cookie: string | undefined }>;
  /**
   * An access token approved by `browser`, for the MCP endpoint at `resourcePath` (by default `/mcp`),
   * at the connection `level` the person chose (by default admin, so the agent may do all they can;
   * null sends the form without a choice).
   */
  connectAgent(browser: Browser, clientName?: string, resourcePath?: string, level?: "viewer" | "editor" | "admin" | null): Promise<string>;
  /** As connectAgent, with the refresh token and the client it was issued to; `redirect` is where the client receives the code (a loopback address unless given). */
  connectAgentTokens(browser: Browser, clientName?: string, resourcePath?: string, level?: "viewer" | "editor" | "admin" | null, redirect?: string): Promise<{ access_token: string; refresh_token: string; client_id: string }>;
  close(): Promise<void>;
}

export interface Browser {
  email: string;
  cookie: string;
  api<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Headers }>;
}

/** A fresh database, migrated, behind a real HTTP server on a random port. `overrides` may be a function of the server's address, for settings that name it. */
export async function startHarness(overrides: Partial<ServerConfig> | ((baseUrl: string) => Partial<ServerConfig>) = {}, opts: { fetcher?: UrlFetcher } = {}): Promise<Harness> {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: inject("adminUrl") });
  await admin.connect();
  await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
  await admin.end();
  const url = inject("appUrlTemplate").replace("{db}", name);
  const { db, pool } = createDb(url, 5);
  await migrate(db, () => {});

  // The server listens before the app exists, on a port the system picks, so no other test file can
  // take the port between its being chosen and listened on. The app is made once its address is known.
  let app: ReturnType<typeof createApp> | null = null;
  const { server, port } = await new Promise<{ server: ServerType; port: number }>((resolveServer) => {
    const listening: ServerType = serve({ fetch: (req, env) => (app ? app.fetch(req, env) : new Response("Starting", { status: 503 })), port: 0 }, (info: AddressInfo) =>
      resolveServer({ server: listening, port: info.port }),
    );
  });
  const baseUrl = `http://localhost:${port}`;
  const config: ServerConfig = { ...loadConfig({ NODE_ENV: "test", WHATBUILD_PUBLIC_URL: baseUrl, DATABASE_URL: url }), mailer: "memory", blobStore: "memory", defaultTenantAllowance: 100, ...(typeof overrides === "function" ? overrides(baseUrl) : overrides) };
  const blobs = new MemoryBlobStore();
  const mailer = new MemoryMailer();
  let worker: Worker | null = null;
  const ports = createPorts(config, blobs, mailer, () => undefined);
  // A test that fetches URLs stands in for the network.
  if (opts.fetcher) ports.fetcher = opts.fetcher;
  worker = new Worker({ db, ports }, 60_000, () => {});
  const clock = new SandboxClock({ db, ports }, () => {});
  app = createApp({ db, ports, config, clock });

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

  const connectAgentTokens: Harness["connectAgentTokens"] = async (browser, clientName = "test-agent", resourcePath = "/mcp", level = "admin", redirect = "http://127.0.0.1:9999/callback") => {
    const reg = (await (await fetch(`${baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: clientName, redirect_uris: [redirect] }) })).json()) as { client_id: string };
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authUrl = `${baseUrl}/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=s&resource=${encodeURIComponent(`${baseUrl}${resourcePath}`)}`;
    const page = await fetch(authUrl, { headers: { cookie: browser.cookie } });
    const html = await page.text();
    const consent = (page.headers.get("set-cookie") ?? "").split(";")[0]!;
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const fields = Object.fromEntries([...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&")]));
    const decide = await fetch(`${baseUrl}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: `${browser.cookie}; ${consent}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, csrf, decision: "allow", ...(level ? { level } : {}) }),
    });
    const code = new URL(decide.headers.get("location")!).searchParams.get("code")!;
    const tokens = (await (
      await fetch(`${baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: redirect, code_verifier: verifier }),
      })
    ).json()) as { access_token: string; refresh_token: string };
    return { access_token: tokens.access_token, refresh_token: tokens.refresh_token, client_id: reg.client_id };
  };

  return {
    baseUrl,
    db,
    worker: worker!,
    clock,
    mailer,
    blobs,
    config,
    async signIn(email, displayName, next) {
      const res = await fetch(`${baseUrl}/auth/dev-sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ email, display_name: displayName, ...(next ? { next } : {}) }),
      });
      if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
      // The session cookie, by either of its names (__Host-wb_session over HTTPS), never the old name being cleared.
      const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => /^(?:__Host-)?wb_session=./.test(c));
      if (!cookie) throw new Error("sign-in set no session cookie");
      return makeBrowser(email, cookie);
    },
    async followSignInLink() {
      const link = /https?:\/\/\S+\/auth\/verify\?token=\S+/.exec(mailer.sent.at(-1)?.text ?? "")?.[0];
      if (!link) throw new Error("no sign-in link was sent");
      const page = await fetch(link, { redirect: "manual" });
      const html = await page.text();
      const action = /<form method="post" action="([^"]+)">/.exec(html)?.[1];
      if (page.status !== 200 || !action) throw new Error(`the sign-in link opened no page to sign in from: ${page.status} ${page.headers.get("location") ?? ""}`);
      const fields = Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1]!, m[2]!]));
      const response = await fetch(`${baseUrl}${action}`, { method: "POST", redirect: "manual", headers: { origin: baseUrl, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
      const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => /^(?:__Host-)?wb_session=./.test(c));
      return { response, cookie };
    },
    async connectAgent(browser, clientName, resourcePath, level) {
      return (await connectAgentTokens(browser, clientName, resourcePath, level)).access_token;
    },
    connectAgentTokens,
    async close() {
      worker?.stop();
      await new Promise<void>((r) => server.close(() => r()));
      await usageSettled();
      await pool.end();
    },
  };
}
