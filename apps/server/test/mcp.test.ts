import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OPERATIONS, SKILL_VERSION } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toolDefinitions } from "../src/mcp.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let agentToken: string;
let path: string;

function text(r: unknown): any {
  const content = (r as { content: { text: string }[] }).content;
  const t = content[0]!.text;
  return JSON.parse(t.startsWith("{") ? t : t.slice(t.indexOf("\n") + 1));
}

async function connect(token: string, url = `${h.baseUrl}/mcp`) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Acme" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Onboarding" });
  path = p.body.path;
  agentToken = await h.connectAgent(alice);
});
afterAll(async () => h?.close());

describe("adapter parity", () => {
  it("reaches every operation from both REST and MCP, and nothing else", () => {
    const { tools, groups, standalone } = toolDefinitions();
    const viaMcp = new Set<string>();
    for (const [, ops] of groups) for (const o of ops) viaMcp.add(o.name);
    for (const [, o] of standalone) viaMcp.add(o.name);
    expect([...viaMcp].sort()).toEqual(OPERATIONS.map((o) => o.name).sort());
    const restKeys = OPERATIONS.map((o) => `${o.rest.method} ${o.scope} ${o.rest.path}`);
    expect(new Set(restKeys).size).toBe(restKeys.length);
    expect(tools.length).toBeLessThanOrEqual(18);
  });
});

describe("MCP", () => {
  it("requires a bearer token and points clients at OAuth discovery", async () => {
    const r = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${h.baseUrl}/.well-known/oauth-protected-resource/mcp"`);
    const meta = (await (await fetch(`${h.baseUrl}/.well-known/oauth-protected-resource/mcp`)).json()) as any;
    expect(meta.resource).toBe(`${h.baseUrl}/mcp`);
    const as = (await (await fetch(`${h.baseUrl}/.well-known/oauth-authorization-server`)).json()) as any;
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("advertises the skill version and a small grouped tool list", async () => {
    const client = await connect(agentToken);
    expect(client.getServerVersion()?.version).toBe(SKILL_VERSION);
    expect(client.getInstructions()).toContain(`version ${SKILL_VERSION}`);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["sources", "files", "search", "read_passage", "get_skill", "story"]));
    const skill = text(await client.callTool({ name: "get_skill", arguments: {} }));
    expect(skill.content).toContain(`version: "${SKILL_VERSION}"`);
    await client.close();
  });

  it("describes an action without running it, and refuses unknown actions and fields", async () => {
    const client = await connect(agentToken);
    const d = text(await client.callTool({ name: "insights", arguments: { action: "create", describe: true } }));
    expect(d.input_schema.properties.title).toBeDefined();
    expect(d.input_schema.additionalProperties).toBe(false);
    const bad = await client.callTool({ name: "insights", arguments: { action: "explode" } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown insights action/);
    const field = await client.callTool({ name: "outcomes", arguments: { action: "create", product: path, params: { title: "x", colour: "red" } } });
    expect((field.content as { text: string }[])[0]!.text).toMatch(/^422: .*unknown field/);
    await client.close();
  });

  it("runs the agent path: create with upload, PUT, complete, derive, search, read, cite", async () => {
    const client = await connect(agentToken);
    // Only one product is reachable, so `product` may be omitted.
    const created = text(await client.callTool({
      name: "files",
      arguments: { action: "create_upload", params: { kind: "interview_transcript", title: "Buyer interview — Example Co, Sep 2026", date: "2026-09-01", path: "notes.txt", role: "primary" } },
    }));
    expect(created.scope?.product.path, JSON.stringify(created)).toBe(path);
    const put = await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: "Interviewer: What slows you down?\nBuyer: Approvals. Every purchase over a thousand dollars waits a week.\nInterviewer: Who approves?\nBuyer: Finance, once a week on Mondays.\n" });
    expect(put.status).toBe(201);
    const done = text(await client.callTool({ name: "files", arguments: { action: "complete_upload", product: path, params: { record_id: created.record.record_id, path: "notes.txt" } } }));
    expect(done.role).toBe("primary");
    await h.worker.drain();
    const hits = text(await client.callTool({ name: "search", arguments: { product: path, query: "approvals" } }));
    expect(hits.hits[0].speaker).toBe("Buyer");
    const passage = text(await client.callTool({ name: "read_passage", arguments: { product: path, record_id: created.record.record_id, start: 0, end: 3 } }));
    expect(passage.unit).toBe("seq");
    expect(passage.segments).toHaveLength(4);
    const a = text(await client.callTool({
      name: "assumptions",
      arguments: { action: "create", product: path, params: { statement: "Approvals, not budgets, set the buying pace.", citations: [{ record_id: created.record.record_id, seq_start: 1, seq_end: 1 }] } },
    }));
    expect(a.author_type).toBe("agent");
    expect(a.author.surface).toBe("mcp");
    const act = await alice.api("GET", `/api/v1/p/${path}/activity`);
    expect(act.body.items.find((i: { entity_type: string }) => i.entity_type === "assumption").through_agent).toBe(true);
    await client.close();
  });

  it("asks which product when more than one is reachable", async () => {
    const t = await alice.api("GET", "/api/v1/me/products");
    const tenant = t.body.items[0].tenant.slug;
    const team = t.body.items[0].team.slug;
    await alice.api("POST", `/api/v1/teams/${tenant}/${team}/products`, { name: "Second" });
    const client = await connect(agentToken);
    const r = await client.callTool({ name: "outcomes", arguments: { action: "list", params: {} } });
    expect(r.isError).toBe(true);
    const body = (r.content as { text: string }[])[0]!.text;
    expect(body).toMatch(/^422: Say which product/);
    expect(body).toContain(path);
    // A connector bound to one product needs no `product`.
    const bound = await connect(agentToken, `${h.baseUrl}/mcp/t/${path}`);
    const ok = await bound.callTool({ name: "outcomes", arguments: { action: "list", params: {} } });
    expect(ok.isError).toBeFalsy();
    await client.close();
    await bound.close();
  });
});

describe("OAuth for MCP clients", () => {
  it("registers a client, authorizes with PKCE after consent, issues and rotates tokens", async () => {
    const reg = await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Test Desktop", redirect_uris: ["http://127.0.0.1:9999/callback"] }) });
    expect(reg.status).toBe(201);
    const { client_id } = (await reg.json()) as any;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authUrl = `${h.baseUrl}/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz&resource=${encodeURIComponent(`${h.baseUrl}/mcp`)}`;
    const anon = await fetch(authUrl, { redirect: "manual" });
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toMatch(/^\/signin\?next=/);
    const page = await fetch(authUrl, { headers: { cookie: alice.cookie } });
    const html = await page.text();
    expect(html).toContain("Test Desktop");
    // Browsers hold the redirect after Allow to form-action, so the callback's origin must be allowed.
    expect(page.headers.get("content-security-policy")).toContain("form-action 'self' http://127.0.0.1:9999");
    const consentCookie = (page.headers.get("set-cookie") ?? "").split(";")[0]!;
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const fields = Object.fromEntries([...html.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&")]));
    const decide = await fetch(`${h.baseUrl}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: `${alice.cookie}; ${consentCookie}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, csrf, decision: "allow" }),
    });
    expect(decide.status).toBe(302);
    const back = new URL(decide.headers.get("location")!);
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;
    const tokenRes = await fetch(`${h.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id, redirect_uri: "http://127.0.0.1:9999/callback", code_verifier: verifier }),
    });
    const tokens = (await tokenRes.json()) as any;
    expect(tokens.access_token).toMatch(/^wbat_/);
    const reuse = await fetch(`${h.baseUrl}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id, redirect_uri: "http://127.0.0.1:9999/callback", code_verifier: verifier }) });
    expect(reuse.status).toBe(400);

    const client = await connect(tokens.access_token);
    const list = text(await client.callTool({ name: "products", arguments: { action: "list" } }));
    expect(list.items.length).toBeGreaterThan(0);
    await client.close();

    const refreshed = (await (await fetch(`${h.baseUrl}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id }) })).json()) as any;
    expect(refreshed.access_token).toMatch(/^wbat_/);
    // Reusing a rotated refresh token revokes the whole connection.
    const replay = await fetch(`${h.baseUrl}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id }) });
    expect(replay.status).toBe(400);
    const dead = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers: { authorization: `Bearer ${refreshed.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(dead.status).toBe(401);
  });

  it("refuses redirect URIs that could leak a code", async () => {
    for (const uri of ["javascript:alert(1)", "http://example.com/cb", "https://x.test/cb#frag"]) {
      const r = await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [uri] }) });
      expect(r.status, uri).toBe(400);
    }
  });
});
