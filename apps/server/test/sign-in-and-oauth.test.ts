import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore } from "../src/adapters/blobs.ts";
import { MemoryMailer } from "../src/adapters/misc.ts";
import { createApp, createPorts } from "../src/app.ts";
import { safeNext } from "../src/auth/routes.ts";
import { loadConfig, type ServerConfig } from "../src/config.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice");
});
afterAll(async () => h?.close());

const post = (path: string, body: Record<string, string>) =>
  fetch(`${h.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
const postJson = (path: string, body: unknown) => fetch(`${h.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function register(redirect: string, name = "Test agent"): Promise<string> {
  const r = await postJson("/oauth/register", { client_name: name, redirect_uris: [redirect] });
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}

function authorizeUrl(clientId: string, redirect: string, challenge: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s", resource: `${h.baseUrl}/mcp`, ...extra });
  return `${h.baseUrl}/oauth/authorize?${q}`;
}

/** Consent as `browser`, choosing `decision`; the response to the form. */
async function decide(browser: Browser, clientId: string, redirect: string, challenge: string, decision: "allow" | "deny") {
  const page = await fetch(authorizeUrl(clientId, redirect, challenge), { headers: { cookie: browser.cookie } });
  const html = await page.text();
  const consent = (page.headers.get("set-cookie") ?? "").split(";")[0]!;
  const fields = Object.fromEntries([...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&")]));
  return fetch(`${h.baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: `${browser.cookie}; ${consent}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, decision }),
  });
}

/** A client approved by `browser`: its id, redirect URI, and the code and verifier to exchange. */
async function approve(browser: Browser, redirect = "http://127.0.0.1:9999/callback", name = "Test agent") {
  const clientId = await register(redirect, name);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const allowed = await decide(browser, clientId, redirect, challenge, "allow");
  const code = new URL(allowed.headers.get("location")!).searchParams.get("code")!;
  return { clientId, redirect, code, verifier };
}

async function connect(browser: Browser, redirect?: string, name?: string) {
  const a = await approve(browser, redirect, name);
  const r = await post("/oauth/token", { grant_type: "authorization_code", code: a.code, client_id: a.clientId, redirect_uri: a.redirect, code_verifier: a.verifier });
  expect(r.status).toBe(200);
  return { clientId: a.clientId, ...((await r.json()) as { access_token: string; refresh_token: string }) };
}

const mcpStatus = async (token: string) =>
  (
    await fetch(`${h.baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  ).status;

/** `n` requests at once, each on a connection already open; each answer with its body read. */
async function together(n: number, request: () => Promise<Response>) {
  await Promise.all(Array.from({ length: n }, async () => (await fetch(`${h.baseUrl}/auth/methods`)).text()));
  return Promise.all(Array.from({ length: n }, async () => {
    const r = await request();
    return { status: r.status, location: r.headers.get("location"), cookie: r.headers.get("set-cookie") ?? "", body: await r.text() };
  }));
}

/** A form POST on a connection of its own, since the server may answer and close it before reading the whole body. */
function postAlone(path: string, chunks: string[], sendLength: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    const length = chunks.reduce((n, c) => n + Buffer.byteLength(c), 0);
    const headers = { "content-type": "application/x-www-form-urlencoded", ...(sendLength ? { "content-length": String(length) } : {}) };
    let answered = false;
    const req = httpRequest(`${h.baseUrl}${path}`, { method: "POST", agent: false, headers }, (res) => {
      answered = true;
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", (e) => (answered ? undefined : reject(e)));
    for (const c of chunks) req.write(c);
    req.end();
  });
}

describe("request bodies on sign-in and OAuth", () => {
  const big = `a=${"x".repeat(100 * 1024)}`;

  it("refuses a body over 64 KB on every OAuth and sign-in endpoint", async () => {
    for (const path of ["/oauth/register", "/oauth/token", "/oauth/revoke", "/oauth/authorize", "/auth/email", "/auth/dev-sign-in", "/auth/sign-out"])
      expect(await postAlone(path, [big], true), path).toBe(413);
  });

  it("counts a body sent without a length too", async () => {
    expect(await postAlone("/oauth/token", [big, big, big, big], false)).toBe(413);
  });
});

describe("client registration", () => {
  it("refuses a redirect URI over 500 characters, and keeps a name to 100 printable characters", async () => {
    const long = `https://agent.example/${"a".repeat(500)}`;
    const refused = await postJson("/oauth/register", { client_name: "Long", redirect_uris: [long] });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("invalid_redirect_uri");
    const r = await postJson("/oauth/register", { client_name: `Cla‮ude\u0000​ ${"n".repeat(300)}`, redirect_uris: ["https://agent.example/cb"] });
    expect(r.status).toBe(201);
    const name = ((await r.json()) as { client_name: string }).client_name;
    expect(name).toMatch(/^Claude n+$/);
    expect(name).toHaveLength(100);
  });

  it("takes at most 50 registrations an hour that have not led to a connection", async () => {
    const pending = async () =>
      Number(
        (await sql<{ n: string }>`select count(*) as n from oauth_clients c where c.created_at > now() - interval '1 hour' and not exists (select 1 from oauth_tokens t where t.client_id = c.client_id)`.execute(h.db))
          .rows[0]!.n,
      );
    const flood = Array.from({ length: 50 - (await pending()) }, (_, i) => `wbc_flood_${i}`);
    await h.db.insertInto("oauth_clients").values(flood.map((client_id) => ({ client_id, client_name: "Flood", redirect_uris: JSON.stringify(["https://flood.example/cb"]) }))).execute();
    try {
      const refused = await postJson("/oauth/register", { client_name: "One too many", redirect_uris: ["https://agent.example/cb"] });
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(((await refused.json()) as { error: string }).error).toBe("rate_limited");
      // A registration that led to a connection no longer counts.
      const account = (await h.db.selectFrom("accounts").select("account_id").where("email", "=", "alice@example.com").executeTakeFirstOrThrow()).account_id;
      await h.db
        .insertInto("oauth_tokens")
        .values({ token_hash: "flood-token", kind: "access", client_id: flood[0]!, account_id: account, resource: `${h.baseUrl}/mcp`, scope: "whatbuild", family_id: "flood", expires_at: new Date(Date.now() + 3600_000).toISOString() })
        .execute();
      expect((await postJson("/oauth/register", { client_name: "Room again", redirect_uris: ["https://agent.example/cb"] })).status).toBe(201);
    } finally {
      await h.db.deleteFrom("oauth_tokens").where("token_hash", "=", "flood-token").execute();
      await h.db.deleteFrom("oauth_clients").where("client_id", "in", flood).execute();
    }
  });

  it("forgets a registration that never led to a connection after seven days", async () => {
    const days = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
    const account = (await h.db.selectFrom("accounts").select("account_id").where("email", "=", "alice@example.com").executeTakeFirstOrThrow()).account_id;
    const row = (client_id: string, created_at: string) => ({ client_id, client_name: "Old", redirect_uris: JSON.stringify(["https://old.example/cb"]), created_at });
    await h.db.insertInto("oauth_clients").values([row("wbc_old_unused", days(8)), row("wbc_old_code", days(8)), row("wbc_old_used", days(8)), row("wbc_recent_unused", days(6))]).execute();
    // An authorization nobody exchanged is not a connection.
    await h.db
      .insertInto("oauth_codes")
      .values({ code_hash: "old-code", client_id: "wbc_old_code", account_id: account, redirect_uri: "https://old.example/cb", code_challenge: "x", resource: `${h.baseUrl}/mcp`, scope: "whatbuild", expires_at: days(8) })
      .execute();
    // A connection long expired still is one: its client keeps its registration.
    await h.db
      .insertInto("oauth_tokens")
      .values({ token_hash: "old-token", kind: "refresh", client_id: "wbc_old_used", account_id: account, resource: `${h.baseUrl}/mcp`, scope: "whatbuild", family_id: "old", expires_at: days(1), created_at: days(8) })
      .execute();
    await h.worker.drain();
    const left = (await h.db.selectFrom("oauth_clients").select("client_id").where("client_id", "in", ["wbc_old_unused", "wbc_old_code", "wbc_old_used", "wbc_recent_unused"]).execute()).map((r) => r.client_id);
    expect(left.sort()).toEqual(["wbc_old_used", "wbc_recent_unused"]);
  });
});

describe("the consent page", () => {
  it("says where Allow hands the connection, and that the agent chose its own name", async () => {
    const web = await register("https://attacker.example/cb", "Claude");
    const page = await (await fetch(authorizeUrl(web, "https://attacker.example/cb", "x"), { headers: { cookie: alice.cookie } })).text();
    expect(page).toContain("Let “Claude” work in WhatBuild as you?");
    expect(page).toContain("“Claude” is the name the agent gave itself. WhatBuild hasn’t verified it.");
    expect(page).toContain("Allow hands this connection to <strong>attacker.example</strong>.");
    for (const local of ["http://127.0.0.1:9999/callback", "http://localhost:33418/", "cursor://anysphere.cursor-mcp/oauth/callback"]) {
      const id = await register(local, "Local agent");
      const html = await (await fetch(authorizeUrl(id, local, "x"), { headers: { cookie: alice.cookie } })).text();
      expect(html, local).toContain("Allow hands this connection to <strong>an app on this computer</strong>.");
    }
  });

  it("lists where each connected agent's connection is held", async () => {
    await connect(alice, "https://agent.example/oauth/callback", "Web agent");
    await connect(alice, "http://127.0.0.1:9999/callback", "Desktop agent");
    const items = (await alice.api("GET", "/api/v1/me/agents")).body.items as { client_name: string; returns_to: unknown }[];
    expect(items.find((a) => a.client_name === "Web agent")!.returns_to).toEqual({ hosts: ["agent.example"], local: false });
    expect(items.find((a) => a.client_name === "Desktop agent")!.returns_to).toEqual({ hosts: [], local: true });
  });
});

describe("errors before consent", () => {
  it("are shown on WhatBuild's own page, never redirected to the client", async () => {
    const id = await register("https://attacker.example/cb", "Claude");
    const asks: Record<string, string>[] = [{ response_type: "token" }, { code_challenge_method: "plain" }, { code_challenge: "" }, { resource: `${h.baseUrl}/elsewhere` }];
    for (const extra of asks) {
      for (const headers of [{}, { cookie: alice.cookie }]) {
        const r = await fetch(authorizeUrl(id, "https://attacker.example/cb", "x", extra), { redirect: "manual", headers });
        expect(r.status, JSON.stringify(extra)).toBe(400);
        expect(r.headers.get("location")).toBeNull();
      }
    }
  });

  it("still returns Deny to the client once the person chose it", async () => {
    const id = await register("http://127.0.0.1:9999/callback");
    const denied = await decide(alice, id, "http://127.0.0.1:9999/callback", "x", "deny");
    expect(denied.status).toBe(302);
    const back = new URL(denied.headers.get("location")!);
    expect(back.origin).toBe("http://127.0.0.1:9999");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("s");
  });
});

describe("where sign-in returns to", () => {
  it("keeps a path on this origin as it is", () => {
    for (const p of [
      "/",
      "/welcome",
      "/join/AbC-123_x",
      "/invite/AbC-123_x",
      "/t/acme/core/onboarding/story?page=intro#top",
      "/oauth/authorize?response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A9999%2Fcallback&state=a%2Fb",
    ])
      expect(safeNext(p)).toBe(p);
  });

  it("goes home instead of anywhere a browser could read as another origin", () => {
    for (const p of [
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\/evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r\n/evil.example",
      "/\u0000/evil.example",
      "/ /evil.example",
      "/　/evil.example",
      "/ /evil.example",
      " //evil.example",
      "/%09/evil.example",
      "/%0a/evil.example",
      "/%0D%0A/evil.example",
      "/%00/evil.example",
      "/%2F/evil.example",
      "/%2f%2fevil.example",
      "/%5C/evil.example",
      "/%5cevil.example",
      "/%252f%252fevil.example",
      "/.//evil.example",
      "/..//evil.example",
      "/%2e%2e//evil.example",
      "/./%2F/evil.example",
      "https://evil.example",
      "http:evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
    ])
      expect(safeNext(p), JSON.stringify(p)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(`/${"a".repeat(2001)}`)).toBe("/");
  });

  it("returns home after an email link that was asked for with a way out", async () => {
    await h.signIn("nora@example.com", "Nora");
    expect((await postJson("/auth/email", { email: "nora@example.com", next: "/\t/evil.example" })).status).toBe(200);
    const link = /https?:\/\/\S+\/auth\/verify\?token=\S+/.exec(h.mailer.sent.at(-1)!.text)![0];
    const r = await fetch(link, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
  });
});

describe("once only, under concurrent use", () => {
  it("lets one of several concurrent uses of a sign-in link in", async () => {
    await h.signIn("racer@example.com", "Racer");
    expect((await postJson("/auth/email", { email: "racer@example.com", next: "/welcome" })).status).toBe(200);
    const link = /https?:\/\/\S+\/auth\/verify\?token=\S+/.exec(h.mailer.sent.at(-1)!.text)![0];
    const results = await together(6, () => fetch(link, { redirect: "manual" }));
    expect(results.filter((r) => r.cookie.includes("wb_session=") && r.location === "/welcome")).toHaveLength(1);
    expect(results.filter((r) => r.location === "/signin?error=link_expired")).toHaveLength(5);
  });

  it("exchanges an authorization code once, however many ask at once", async () => {
    const a = await approve(alice);
    const results = await together(6, () => post("/oauth/token", { grant_type: "authorization_code", code: a.code, client_id: a.clientId, redirect_uri: a.redirect, code_verifier: a.verifier }));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400, 400]);
  });

  it("rotates a refresh token once, and takes a concurrent second use as reuse", async () => {
    const t = await connect(alice);
    const results = await together(6, () => post("/oauth/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId }));
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    // The reuse revoked the whole connection, including what the one rotation issued.
    const issued = JSON.parse(ok[0]!.body) as { access_token: string };
    expect(await mcpStatus(issued.access_token)).toBe(401);
    expect(await mcpStatus(t.access_token)).toBe(401);
  });
});

/** The same app as the harness's, with some of its configuration changed, answering in-process. */
function appWith(config: Partial<ServerConfig>) {
  const merged = { ...h.config, ...config };
  return createApp({ db: h.db, ports: createPorts(merged, new MemoryBlobStore(), new MemoryMailer()), config: merged });
}

describe("request logs", () => {
  it("mask invitation links and sandbox invitation codes, like ids", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      const app = appWith({ env: "development" });
      await app.request("/invite/Inv1tati0n-Secret_Token");
      await app.request("/join/Sandb0x-Secret_Code");
      await app.request("/api/v1/p/01J0ABCDEFGHJKMNPQRSTVWXYZ/anything");
    } finally {
      spy.mockRestore();
    }
    const paths = lines.flatMap((l) => {
      try {
        const path = (JSON.parse(l) as { path?: string }).path;
        return path ? [path] : [];
      } catch {
        return [];
      }
    });
    expect(paths).toEqual(["/invite/:token", "/join/:code", "/api/v1/p/:id/anything"]);
    expect(lines.join("\n")).not.toMatch(/Secret/);
  });
});

describe("Strict-Transport-Security", () => {
  it("is sent for a year when the public URL is https, without includeSubDomains or preload", async () => {
    const secure = await appWith({ publicBaseUrl: "https://app.example.test" }).request("/.well-known/oauth-authorization-server");
    expect(secure.headers.get("strict-transport-security")).toBe("max-age=31536000");
    const plain = await appWith({}).request("/.well-known/oauth-authorization-server");
    expect(plain.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("start-up", () => {
  it("refuses a mailer in production that would print sign-in links, or one it does not know", () => {
    const prod = { NODE_ENV: "production", WHATBUILD_GRANT_KEY: "k".repeat(32) };
    for (const mailer of ["console", "memory", "smpt"]) expect(() => loadConfig({ ...prod, WHATBUILD_MAILER: mailer }), mailer).toThrow(/WHATBUILD_MAILER/);
    expect(() => loadConfig({ NODE_ENV: "development", WHATBUILD_MAILER: "smpt" })).toThrow(/WHATBUILD_MAILER/);
    expect(loadConfig(prod).mailer).toBe("none");
    expect(loadConfig({ ...prod, WHATBUILD_MAILER: "" }).mailer).toBe("none");
    expect(loadConfig({ ...prod, WHATBUILD_SMTP_URL: "smtp://mail.example:587" }).mailer).toBe("smtp");
    expect(loadConfig({ ...prod, WHATBUILD_MAILER: "none" }).mailer).toBe("none");
    expect(loadConfig({ NODE_ENV: "development" }).mailer).toBe("console");
  });
});
