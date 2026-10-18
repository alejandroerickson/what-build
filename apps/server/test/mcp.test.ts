import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OPERATIONS, REST_BODY_MAX_BYTES, SKILL_VERSION } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_BODY_MAX_BYTES, toolDefinitions } from "../src/mcp.ts";
import { syncSandboxTenant } from "../src/public-sandbox.ts";
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
  it("reaches every operation from both REST and MCP, and nothing else, but what only a person does in the web app", () => {
    const { tools, groups, standalone } = toolDefinitions();
    const viaMcp = new Set<string>();
    for (const [, ops] of groups) for (const o of ops) viaMcp.add(o.name);
    for (const [, o] of standalone) viaMcp.add(o.name);
    expect([...viaMcp].sort()).toEqual(OPERATIONS.filter((o) => !o.webOnly).map((o) => o.name).sort());
    // Closing an organization is the only thing an agent is never offered.
    expect(OPERATIONS.filter((o) => o.webOnly).map((o) => o.name).sort()).toEqual(["products.delete_tenant", "products.delete_tenant_impact"]);
    const restKeys = OPERATIONS.map((o) => `${o.rest.method} ${o.scope} ${o.rest.path}`);
    expect(new Set(restKeys).size).toBe(restKeys.length);
    expect(tools.length).toBeLessThanOrEqual(15);
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
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["sources", "attachments", "derived", "search", "get_skill", "story"]));
    // Files are attachments, and there are no passages to read.
    expect(tools.map((t) => t.name)).not.toContain("files");
    expect(tools.map((t) => t.name)).not.toContain("read_passage");
    expect(tools).toHaveLength(14);
    // The client keeps the list it connected with, so the instructions say what a missing tool means.
    expect(client.getInstructions()).toMatch(/start a new session/);
    // With several copies of the skill installed, the one at the server's version is the one to follow.
    expect(client.getInstructions()).toContain("If more than one copy is installed (in different places, or under different names), the one at this version is the one to follow");
    // Agents write links with the deployment's own address, never another name it answers on.
    expect(client.getInstructions()).toContain(`This deployment's address is ${h.baseUrl}.`);
    const skill = text(await client.callTool({ name: "get_skill", arguments: {} }));
    expect(skill.content).toContain(`version: "${SKILL_VERSION}"`);
    await client.close();
  });

  it("describes an action without running it, and refuses unknown actions and fields", async () => {
    const client = await connect(agentToken);
    const d = text(await client.callTool({ name: "assumptions", arguments: { action: "create", describe: true } }));
    expect(d.input_schema.properties.statement).toBeDefined();
    expect(d.input_schema.additionalProperties).toBe(false);
    const bad = await client.callTool({ name: "assumptions", arguments: { action: "explode" } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown assumptions action: explode\. This server, version [\d.]+, offers this connection these assumptions actions: list,/);
    expect(text(bad).error.details).toMatchObject({ server_version: SKILL_VERSION, actions: expect.arrayContaining(["create", "review"]) });
    const field = await client.callTool({ name: "outcomes", arguments: { action: "create", product: path, params: { title: "x", colour: "red" } } });
    expect((field.content as { text: string }[])[0]!.text).toMatch(/^422: `colour` is not a field of this action\./);
    // A tool the server does not have: the refusal lists the server's tools and says the client's list may be out of date.
    const tool = await client.callTool({ name: "insights", arguments: { action: "list" } });
    expect((tool.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown tool insights\. This server, version [\d.]+, has these tools: .*story.*start a new session/s);
    expect(text(tool).error).toMatchObject({ code: "unknown_tool", details: { server_version: SKILL_VERSION, tools: expect.arrayContaining(["story", "mockups"]) } });
    await client.close();
  });

  it("says an action is missing, and lists the tool's actions, when a grouped tool is called without one", async () => {
    const client = await connect(agentToken);
    for (const args of [{ params: {} }, { describe: true }, { action: "" }, { action: null }]) {
      const r = await client.callTool({ name: "sources", arguments: args });
      expect(r.isError).toBe(true);
      const t = (r.content as { text: string }[])[0]!.text;
      expect(t, JSON.stringify(args)).toMatch(/^422: `action` is missing: sources needs one of its actions \(facets, list, get, [a-z_, ]+\), with the action's fields in params\. Call it with an action and describe=true to see that action's fields\. Nothing was changed\./);
      expect(t).not.toContain("undefined");
      expect(text(r).error).toMatchObject({ code: "invalid_input", details: { actions: expect.arrayContaining(["list", "get", "create"]) } });
    }
    await client.close();
  });

  it("runs the agent path: create with upload, PUT, complete, read, search, read the text around a hit, record", async () => {
    const client = await connect(agentToken);
    // Only one product is reachable, so `product` may be omitted.
    const created = text(await client.callTool({
      name: "attachments",
      arguments: { action: "create_upload", params: { tags: ["interview"], title: "Buyer interview — Example Co, Sep 2026", date: "2026-09-01", path: "notes.txt" } },
    }));
    expect(created.scope?.product.path, JSON.stringify(created)).toBe(path);
    const put = await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: "Interviewer: What slows you down?\nBuyer: Approvals. Every purchase over a thousand dollars waits a week.\nInterviewer: Who approves?\nBuyer: Finance, once a week on Mondays.\n" });
    expect(put.status).toBe(201);
    const done = text(await client.callTool({ name: "attachments", arguments: { action: "complete_upload", product: path, params: { record_id: created.record.record_id, path: "notes.txt" } } }));
    expect(done).toMatchObject({ path: "notes.txt", text: { status: "pending" } });
    expect(done).not.toHaveProperty("role");
    expect(done.note).toMatch(/its text becomes the source's derived text/);
    await h.worker.drain();
    const hits = text(await client.callTool({ name: "search", arguments: { product: path, query: "approvals" } }));
    expect(hits.hits[0]).toMatchObject({ record_id: created.record.record_id, field: "text" });
    // A hit is read in the derived text by the offsets it carries.
    const hit = hits.hits[0];
    const around = text(await client.callTool({ name: "derived", arguments: { action: "text", product: path, params: { record_id: hit.record_id, offset: hit.char_start, limit: hit.char_end - hit.char_start } } }));
    expect(around).toMatchObject({ of: "derived_text", text: "Approvals" });
    const whole = text(await client.callTool({ name: "derived", arguments: { action: "text", product: path, params: { record_id: created.record.record_id } } }));
    expect(whole.text).toContain("Finance, once a week on Mondays.");
    expect(whole.taken_from).toMatchObject({ path: "notes.txt" });
    // The old tool is gone; the refusal names the tools there are.
    const old = await client.callTool({ name: "read_passage", arguments: { product: path, record_id: created.record.record_id, seq: 0 } });
    expect(text(old).error).toMatchObject({ code: "unknown_tool", details: { tools: expect.arrayContaining(["attachments", "derived"]) } });
    const a = text(await client.callTool({
      name: "assumptions",
      arguments: { action: "create", product: path, params: { statement: "Approvals, not budgets, set the buying pace.", body: "The buyer says approvals come first." } },
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

  it("answers a non-member 404 before looking at the input, as REST does, and a member's malformed call 422 as before", async () => {
    const [tenant, team] = path.split("/");
    const mallory = await h.signIn("mallory@example.com", "Mallory");
    const outsider = await connect(await h.connectAgent(mallory));
    const member = await connect(agentToken);
    const message = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
    const calls = [
      { name: "outcomes", arguments: { action: "create", product: path, params: { title: "x", colour: "red" } } },
      { name: "outcomes", arguments: { action: "create", product: path, params: { title: 7 } } },
      { name: "search", arguments: { product: path, colour: "red" } },
      { name: "members", arguments: { action: "list", params: { tenant, colour: "red" } } },
      { name: "products", arguments: { action: "create", params: { tenant, team, name: "" } } },
    ];
    for (const call of calls) {
      const r = await outsider.callTool(call);
      expect(r.isError, JSON.stringify(call)).toBe(true);
      expect(message(r), JSON.stringify(call)).toMatch(/^404: /);
      const mine = await member.callTool(call);
      expect(message(mine), JSON.stringify(call)).toMatch(/^422: .*Nothing was changed/s);
      expect(text(mine).error.code).toBe("invalid_input");
    }
    const rest = await mallory.api("POST", `/api/v1/p/${path}/outcomes`, { title: "x", colour: "red" });
    expect(rest.status).toBe(404);
    // A call that names no product or organization addresses nothing to hide: a malformed one still says so.
    expect(text(await member.callTool({ name: "outcomes", arguments: { action: "create", params: { title: "x", colour: "red" } } })).error.code).toBe("invalid_input");
    expect(text(await member.callTool({ name: "members", arguments: { action: "list", params: {} } })).error.code).toBe("invalid_input");
    await outsider.close();
    await member.close();
  });

  it("reads a body up to the REST limit, and refuses a larger one, declared or streamed, read only once the caller is known", async () => {
    expect(MCP_BODY_MAX_BYTES).toBe(REST_BODY_MAX_BYTES);
    const headers = { authorization: `Bearer ${agentToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    /** A tools/call whose JSON is `bytes` long, padded with an argument the tool refuses. */
    const call = (bytes: number) => {
      const shell = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "products", arguments: { action: "list", padding: "" } } });
      return shell.replace('"padding":""', `"padding":"${"x".repeat(bytes - shell.length)}"`);
    };
    // Past the transport's own default of 4 MiB, under the limit: read, and answered by the tool.
    const under = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers, body: call(MCP_BODY_MAX_BYTES - 1024) });
    expect(under.status).toBe(200);
    expect(JSON.stringify(await under.json())).toContain("unknown_field");
    const over = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers, body: call(MCP_BODY_MAX_BYTES + 1) });
    expect(over.status).toBe(413);
    expect(((await over.json()) as { error: { message: string } }).error.message).toContain(`${MCP_BODY_MAX_BYTES} bytes`);
    // No Content-Length: the transport counts what arrives and stops past the limit.
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 2 * MCP_BODY_MAX_BYTES) return c.close();
        sent += 64 * 1024;
        c.enqueue(new Uint8Array(64 * 1024).fill(0x20));
      },
    });
    const streamed = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
    // Without a token nothing is read: the answer is 401 whatever the body.
    const anonymous = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers: { ...headers, authorization: "" }, body: call(MCP_BODY_MAX_BYTES + 1) });
    expect(anonymous.status).toBe(401);
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
    // The code is spent; using it again is refused (and revokes its connection: sign-in-and-oauth.test.ts).
    const reuse = await fetch(`${h.baseUrl}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id, redirect_uri: "http://127.0.0.1:9999/callback", code_verifier: verifier }) });
    expect(reuse.status).toBe(400);
  });

  it("refuses redirect URIs that could leak a code", async () => {
    for (const uri of ["javascript:alert(1)", "http://example.com/cb", "https://x.test/cb#frag"]) {
      const r = await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [uri] }) });
      expect(r.status, uri).toBe(400);
    }
  });
});

describe("an organization's or a team's action named with a product", () => {
  let sandboxPath: string;
  let tenantSlug: string;
  let token: string;

  beforeAll(async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Try Co" });
    tenantSlug = t.body.tenant.slug;
    const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${t.body.team.slug}/products`, { name: "Showcase" });
    sandboxPath = p.body.path;
    expect(await syncSandboxTenant(h.db, tenantSlug, () => {})).toBe(t.body.tenant.tenant_id);
    // Two products are reachable now, so nothing is guessed.
    token = await h.connectAgent(alice, "Sandbox agent");
  });

  it("acts on the organization the product is in, as the other tools take a product", async () => {
    const client = await connect(token);
    const status = await client.callTool({ name: "sandbox", arguments: { action: "status", product: sandboxPath } });
    expect(status.isError, JSON.stringify(status.content)).toBeFalsy();
    expect(text(status)).toMatchObject({ public_sandbox: true, organization: { slug: tenantSlug }, you: { role: "staff" } });
    // So does any organization's action without a product of its own.
    const log = await client.callTool({ name: "members", arguments: { action: "activity", product: sandboxPath } });
    expect(log.isError, JSON.stringify(log.content)).toBeFalsy();
    // A product the caller cannot see names nothing.
    const other = await client.callTool({ name: "sandbox", arguments: { action: "status", product: "nowhere/team/product" } });
    expect((other.content as { text: string }[])[0]!.text).toMatch(/^404: /);
    await client.close();
  });

  it("says what to pass when the call names neither the organization nor a product, or when product means something else there", async () => {
    const client = await connect(token);
    const none = await client.callTool({ name: "sandbox", arguments: { action: "status" } });
    expect((none.content as { text: string }[])[0]!.text).toMatch(
      /^422: `tenant` is missing: sandbox\(action="status"\) acts on an organization\. Pass params\.tenant, the organization's slug or id: the first part of a product's path .*, or name any product in it with product\. Nothing was changed\./,
    );
    const members = await client.callTool({ name: "members", arguments: { action: "list", product: sandboxPath } });
    expect(text(members).error.code).toBe("invalid_input");
    expect(text(members).error.message).toContain("params.product names a product of its own here");
    // Named in params, the organization is used as it always was.
    const listed = await client.callTool({ name: "members", arguments: { action: "list", params: { tenant: tenantSlug } } });
    expect(listed.isError, JSON.stringify(listed.content)).toBeFalsy();
    await client.close();
  });

  it("on a connector scoped to the product, takes the organization from the connector", async () => {
    const [tn, tm, pr] = sandboxPath.split("/");
    const scoped = await h.connectAgent(alice, "Scoped sandbox agent", `/mcp/t/${tn}/${tm}/${pr}`);
    const client = await connect(scoped, `${h.baseUrl}/mcp/t/${tn}/${tm}/${pr}`);
    const status = await client.callTool({ name: "sandbox", arguments: { action: "status" } });
    expect(status.isError, JSON.stringify(status.content)).toBeFalsy();
    expect(text(status)).toMatchObject({ organization: { slug: tenantSlug } });
    await client.close();
  });
});
