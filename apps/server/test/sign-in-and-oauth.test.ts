import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { safeNext } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore } from "../src/adapters/blobs.ts";
import { MemoryMailer } from "../src/adapters/misc.ts";
import { createApp, createPorts } from "../src/app.ts";
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

/**
 * Consent as `browser`, choosing `decision`; the response to the form. `extra` goes into the
 * authorization request, and `change` over the form's fields before it is sent.
 */
async function decide(browser: Browser, clientId: string, redirect: string, challenge: string, decision: "allow" | "deny", extra: Record<string, string> = {}, change: Record<string, string> = {}) {
  const page = await fetch(authorizeUrl(clientId, redirect, challenge, extra), { headers: { cookie: browser.cookie } });
  const html = await page.text();
  const consent = (page.headers.get("set-cookie") ?? "").split(";")[0]!;
  const fields = Object.fromEntries([...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&")]));
  return fetch(`${h.baseUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: `${browser.cookie}; ${consent}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, ...change, decision }),
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
    expect(page).toContain("You can change or disconnect it later under Connect an agent in WhatBuild.");
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

describe("what Allow approves", () => {
  it("is what the consent page showed: a form changed in its resource, code challenge, state or client is refused", async () => {
    const redirect = "http://127.0.0.1:9999/callback";
    const id = await register(redirect);
    const shown = { resource: `${h.baseUrl}/mcp/t/acme` };
    const changes: Record<string, string>[] = [{ resource: `${h.baseUrl}/mcp` }, { code_challenge: "another-challenge" }, { state: "another-state" }, { client_id: await register(redirect) }];
    for (const change of changes) {
      const r = await decide(alice, id, redirect, "x", "allow", shown, change);
      expect(r.status, JSON.stringify(change)).toBe(400);
      expect(r.headers.get("location")).toBeNull();
    }
    const allowed = await decide(alice, id, redirect, "x", "allow", shown);
    expect(allowed.status).toBe(302);
    const code = new URL(allowed.headers.get("location")!).searchParams.get("code")!;
    const row = await h.db.selectFrom("oauth_codes").select(["resource", "code_challenge"]).where("code_hash", "=", createHash("sha256").update(code).digest("hex")).executeTakeFirstOrThrow();
    expect(row).toEqual({ resource: shown.resource, code_challenge: "x" });
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
    const r = await press(lastLink());
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/");
  });
});

/** The sign-in link in the last email sent. */
const lastLink = () => /https?:\/\/\S+\/auth\/verify\?token=\S+/.exec(h.mailer.sent.at(-1)!.text)![0];
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
/** What pressing Sign in on a link's page sends: a form POST, from this origin unless `origin` says otherwise. */
const press = (link: string, origin = h.baseUrl) =>
  fetch(`${h.baseUrl}/auth/verify`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams({ token: tokenOf(link) }) });

describe("the email sign-in link", () => {
  it("opens a page that changes nothing, however often it is opened, and signs in when its button is pressed", async () => {
    await h.signIn("lena@example.com", "Lena");
    expect((await postJson("/auth/email", { email: "lena@example.com", next: "/welcome" })).status).toBe(200);
    const link = lastLink();
    // A mail scanner fetches every link in a message, perhaps more than once.
    for (let i = 0; i < 3; i++) {
      const page = await fetch(link, { redirect: "manual" });
      expect(page.status).toBe(200);
      expect(page.headers.get("set-cookie")).toBeNull();
      expect(page.headers.get("cache-control")).toBe("no-store");
      expect(page.headers.get("referrer-policy")).toBe("same-origin");
      expect(page.headers.get("x-frame-options")).toBe("DENY");
      expect(page.headers.get("content-security-policy")).toBe("frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
      const html = await page.text();
      expect(html).toContain('<form method="post" action="/auth/verify">');
      expect(html).toContain(`<input type="hidden" name="token" value="${tokenOf(link)}">`);
      expect(html).toContain("<strong>lena@example.com</strong>");
      expect(html).toMatch(/<button type="submit" class="primary">Sign in<\/button>/);
    }
    const r = await press(link);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/welcome");
    expect(r.headers.get("set-cookie")).toMatch(/^wb_session=[^;]+;/);
    // Spent, whether opened or pressed again.
    expect((await fetch(link, { redirect: "manual" })).headers.get("location")).toBe("/signin?error=link_expired");
    expect((await press(link)).headers.get("location")).toBe("/signin?error=link_expired");
  });

  it("refuses the button pressed from another site, and the link still works from its own page", async () => {
    await h.signIn("omar@example.com", "Omar");
    expect((await postJson("/auth/email", { email: "omar@example.com", next: "/welcome" })).status).toBe(200);
    const link = lastLink();
    for (const origin of ["https://evil.example", "null"]) {
      const r = await press(link, origin);
      expect(r.status, origin).toBe(403);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    expect((await press(link)).headers.get("location")).toBe("/welcome");
  });

  it("goes to sign-in for a link that is unknown or expired", async () => {
    expect((await fetch(`${h.baseUrl}/auth/verify?token=nothing-like-a-token`, { redirect: "manual" })).headers.get("location")).toBe("/signin?error=link_expired");
    await h.signIn("pia@example.com", "Pia");
    expect((await postJson("/auth/email", { email: "pia@example.com" })).status).toBe(200);
    const link = lastLink();
    await h.db.updateTable("email_tokens").set({ expires_at: new Date(Date.now() - 1000).toISOString() }).where("token_hash", "=", createHash("sha256").update(tokenOf(link)).digest("hex")).execute();
    expect((await fetch(link, { redirect: "manual" })).headers.get("location")).toBe("/signin?error=link_expired");
    expect((await press(link)).headers.get("location")).toBe("/signin?error=link_expired");
  });
});

describe("once only, under concurrent use", () => {
  it("lets one of several concurrent uses of a sign-in link in", async () => {
    await h.signIn("racer@example.com", "Racer");
    expect((await postJson("/auth/email", { email: "racer@example.com", next: "/welcome" })).status).toBe(200);
    const link = lastLink();
    const results = await together(6, () => press(link));
    expect(results.filter((r) => r.cookie.includes("wb_session=") && r.location === "/welcome")).toHaveLength(1);
    expect(results.filter((r) => r.location === "/signin?error=link_expired")).toHaveLength(5);
  });

  it("exchanges an authorization code once, however many ask at once, and the others' reuse revokes what it issued", async () => {
    const a = await approve(alice);
    const results = await together(6, () => post("/oauth/token", { grant_type: "authorization_code", code: a.code, client_id: a.clientId, redirect_uri: a.redirect, code_verifier: a.verifier }));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400, 400, 400]);
    const issued = JSON.parse(results.find((r) => r.status === 200)!.body) as { access_token: string };
    expect(await mcpStatus(issued.access_token)).toBe(401);
  });

  it("revokes the connection an authorization code made when the code is used again", async () => {
    const a = await approve(alice);
    const exchange = () => post("/oauth/token", { grant_type: "authorization_code", code: a.code, client_id: a.clientId, redirect_uri: a.redirect, code_verifier: a.verifier });
    const first = await exchange();
    expect(first.status).toBe(200);
    const t = (await first.json()) as { access_token: string; refresh_token: string };
    expect(await mcpStatus(t.access_token)).toBe(200);
    const again = await exchange();
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");
    expect(await mcpStatus(t.access_token)).toBe(401);
    expect((await post("/oauth/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: a.clientId })).status).toBe(400);
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
  it("mask invitation links, sandbox invitation codes, ids, and the names of organizations, teams and products", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      const app = appWith({ env: "development" });
      await app.request("/invite/Inv1tati0n-Secret_Token");
      await app.request("/join/Sandb0x-Secret_Code");
      await app.request("/api/v1/p/secret-org/core/planner/sources/01J0ABCDEFGHJKMNPQRSTVWXYZ");
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
    expect(paths).toEqual(["/invite/:token", "/join/:code", "/api/v1/p/:org/:team/:product/sources/:id"]);
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

describe("the session cookie", () => {
  const HTTPS = "https://app.example.test";
  const asHttps = () => appWith({ publicBaseUrl: HTTPS });
  const cleared = (cookies: string[], name: string) => cookies.some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/i.test(c));
  const tokenIn = (cookies: string[], name: string) => cookies.map((c) => c.split(";")[0]!).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  const signInOver = (app: ReturnType<typeof appWith>, origin: string, email: string) =>
    app.request("/auth/dev-sign-in", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email }) });
  /** A session as one issued before the cookie took its prefix is stored. */
  async function sessionFromBefore(email: string) {
    const { account_id } = await h.db.selectFrom("accounts").select("account_id").where("email", "=", email).executeTakeFirstOrThrow();
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + 10 * 86400_000);
    await h.db.insertInto("sessions").values({ session_hash: createHash("sha256").update(token).digest("hex"), account_id, expires_at: expires.toISOString(), legacy_cookie: true }).execute();
    return token;
  }

  it("is __Host-wb_session over HTTPS, host-only and Secure, and the old name carries no new session", async () => {
    const app = asHttps();
    const r = await signInOver(app, HTTPS, "host@example.com");
    expect(r.status).toBe(200);
    const cookies = r.headers.getSetCookie();
    const set = cookies.find((c) => c.startsWith("__Host-wb_session="))!;
    for (const part of [/; Path=\/(;|$)/, /; Secure(;|$)/, /; HttpOnly(;|$)/, /; SameSite=Lax(;|$)/]) expect(set).toMatch(part);
    expect(set).not.toMatch(/Domain=/i);
    expect(cleared(cookies, "wb_session")).toBe(true);
    const token = tokenIn(cookies, "__Host-wb_session")!;
    expect((await app.request("/api/v1/me", { headers: { cookie: `__Host-wb_session=${token}` } })).status).toBe(200);
    expect((await app.request("/api/v1/me", { headers: { cookie: `wb_session=${token}` } })).status).toBe(401);
  });

  it("is plain wb_session over HTTP, for local development", async () => {
    const r = await signInOver(appWith({}), h.baseUrl, "plain@example.com");
    const cookies = r.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^wb_session=[^;]+;/);
    expect(cookies[0]).not.toMatch(/Secure/);
  });

  it("takes a session from before under its old name over HTTPS, until it expires, and moves it to the new name", async () => {
    const token = await sessionFromBefore("alice@example.com");
    const app = asHttps();
    const r = await app.request("/api/v1/me", { headers: { cookie: `wb_session=${token}` } });
    expect(r.status).toBe(200);
    const cookies = r.headers.getSetCookie();
    const moved = cookies.find((c) => c.startsWith(`__Host-wb_session=${token};`))!;
    expect(moved).toMatch(/; Secure(;|$)/);
    expect(Number(/Max-Age=(\d+)/.exec(moved)![1])).toBeGreaterThan(10 * 86400 - 60);
    expect(Number(/Max-Age=(\d+)/.exec(moved)![1])).toBeLessThanOrEqual(10 * 86400);
    expect(cleared(cookies, "wb_session")).toBe(true);
    expect((await app.request("/api/v1/me", { headers: { cookie: `__Host-wb_session=${token}` } })).status).toBe(200);
  });

  it("prefers the new name when both arrive", async () => {
    const old = await sessionFromBefore("alice@example.com");
    const app = asHttps();
    const fresh = tokenIn((await signInOver(app, HTTPS, "both@example.com")).headers.getSetCookie(), "__Host-wb_session")!;
    const me = await app.request("/api/v1/me", { headers: { cookie: `wb_session=${old}; __Host-wb_session=${fresh}` } });
    expect(((await me.json()) as { email: string }).email).toBe("both@example.com");
  });

  it("signs out under either name, ending both sessions and clearing both cookies", async () => {
    const app = asHttps();
    const old = await sessionFromBefore("alice@example.com");
    const fresh = tokenIn((await signInOver(app, HTTPS, "leaving@example.com")).headers.getSetCookie(), "__Host-wb_session")!;
    const r = await app.request("/auth/sign-out", { method: "POST", headers: { cookie: `wb_session=${old}; __Host-wb_session=${fresh}`, origin: HTTPS } });
    expect(r.status).toBe(200);
    const cookies = r.headers.getSetCookie();
    expect(cleared(cookies, "__Host-wb_session")).toBe(true);
    expect(cleared(cookies, "wb_session")).toBe(true);
    expect((await app.request("/api/v1/me", { headers: { cookie: `__Host-wb_session=${fresh}` } })).status).toBe(401);
    expect((await app.request("/api/v1/me", { headers: { cookie: `wb_session=${old}` } })).status).toBe(401);
  });

  it("makes a write that carries either name come from this origin", async () => {
    for (const cookie of ["__Host-wb_session=x", "wb_session=x"]) {
      const r = await asHttps().request("/auth/sign-out", { method: "POST", headers: { cookie, origin: "https://evil.example" } });
      expect(r.status, cookie).toBe(403);
    }
  });
});

describe("start-up", () => {
  it("runs as production unless NODE_ENV is development or test", () => {
    const key = "k".repeat(32);
    expect(() => loadConfig({})).toThrow(/WHATBUILD_GRANT_KEY/);
    for (const NODE_ENV of [undefined, "", "production", "staging", "dev", "Development"]) {
      const config = loadConfig({ WHATBUILD_GRANT_KEY: key, ...(NODE_ENV === undefined ? {} : { NODE_ENV }) });
      expect(config, String(NODE_ENV)).toMatchObject({ env: "production", devAuth: false, grantKey: key, mailer: "none" });
    }
    expect(loadConfig({ NODE_ENV: "development" })).toMatchObject({ env: "development", devAuth: true });
    expect(loadConfig({ NODE_ENV: "test" })).toMatchObject({ env: "test", devAuth: true });
    expect(loadConfig({ NODE_ENV: "development", WHATBUILD_DEV_AUTH: "0" }).devAuth).toBe(false);
  });

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
