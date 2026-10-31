import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpTool, OPERATIONS, REST_BODY_MAX_BYTES, TOOLS_VERSION } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_BODY_MAX_BYTES, toolDefinitions } from "../src/mcp.ts";
import { syncExampleTenant } from "../src/example-organization.ts";
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
    // Closing an organization or an account, renaming an organization or a product, and running the instance, are what an agent is never offered.
    expect(OPERATIONS.filter((o) => o.webOnly).map((o) => o.name).sort()).toEqual([
      "products.accounts", "products.delete_account", "products.delete_account_impact", "products.delete_tenant", "products.delete_tenant_impact", "products.guests", "products.organizations",
      "products.remove_account", "products.remove_tenant_allowance", "products.rename_tenant", "products.set_guests", "products.set_plan", "products.set_plan_limits", "products.set_tenant_allowance",
      "products.tenant_allowances", "products.update", "products.usage",
    ]);
    // An agent never runs the instance: every operation only its owners have, or that lets them into an organization they are not in, is web-only.
    for (const o of OPERATIONS.filter((o) => o.instanceOwnersOnly || o.allowInstanceOwners)) expect(o.webOnly, o.name).toBeTruthy();
    const restKeys = OPERATIONS.map((o) => `${o.rest.method} ${o.scope} ${o.rest.path}`);
    expect(new Set(restKeys).size).toBe(restKeys.length);
    expect(tools.length).toBeLessThanOrEqual(30);
  });

  it("never mixes reads and writes in one tool, and keeps permanent deletes in tools of their own", () => {
    const { tools, groups } = toolDefinitions();
    for (const [tool, ops] of groups) {
      const kind = tool.slice(tool.lastIndexOf("_") + 1);
      for (const o of ops) {
        expect(mcpTool(o), o.name).toBe(tool);
        if (kind === "read") expect(o.mutates, o.name).toBe(false);
        else expect(o.mutates, o.name).toBe(true);
        expect(o.rest.method === "DELETE", o.name).toBe(kind === "delete");
      }
    }
    expect([...groups.keys()].filter((t) => t.endsWith("_delete")).sort()).toEqual(["assumptions_delete", "mockups_delete", "outcomes_delete", "products_delete", "sources_delete", "story_delete"]);
  });

  it("gives every tool a title and says whether it only reads or changes data", () => {
    for (const t of toolDefinitions().tools) {
      expect(t.title, t.name).toMatch(/^[A-Z]/);
      expect(t.annotations, t.name).toMatchObject({ title: t.title });
      const reads = t.name.endsWith("_read") || t.name === "search" || t.name === "guide";
      // An export changes nothing the team has, though it leaves a record, so it says neither.
      const copies = t.name.endsWith("_export");
      expect(t.annotations, t.name).toMatchObject(reads ? { readOnlyHint: true, destructiveHint: false } : { readOnlyHint: false, destructiveHint: !copies });
      expect(t.name.length, t.name).toBeLessThanOrEqual(64);
    }
    // Fetching a document is the one action that reaches outside WhatBuild.
    expect(toolDefinitions().tools.filter((t) => t.annotations["openWorldHint"]).map((t) => t.name)).toEqual(["attachments_write"]);
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

  it("advertises its tools version, a read, write and delete tool for each kind of object, and a guide", async () => {
    const client = await connect(agentToken);
    expect(client.getServerVersion()?.version).toBe(TOOLS_VERSION);
    expect(client.getInstructions()).toContain(`version ${TOOLS_VERSION}`);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["sources_read", "sources_write", "attachments_write", "derived_read", "search", "guide", "story_read"]));
    // Files are attachments, there are no passages to read, and the skill is retired.
    for (const gone of ["files", "read_passage", "sources", "get_skill", "sandbox"]) expect(tools.map((t) => t.name)).not.toContain(gone);
    // Permanent deletes are tools of their own, which a client asks the person about before each call.
    expect(tools.find((t) => t.name === "sources_delete")).toMatchObject({ annotations: { readOnlyHint: false, destructiveHint: true } });
    // Listed by the kind of object, each kind's read, write and delete together.
    expect(tools.map((t) => t.name).slice(0, 5)).toEqual(["products_read", "products_write", "products_delete", "products_export", "members_read"]);
    expect(tools.find((t) => t.name === "sources_write")).toMatchObject({ title: "Change sources", annotations: { readOnlyHint: false, destructiveHint: true } });
    expect(tools.find((t) => t.name === "sources_read")).toMatchObject({ title: "Read sources", annotations: { readOnlyHint: true } });
    // The client keeps the list it connected with, so the instructions say what a missing tool means.
    expect(client.getInstructions()).toMatch(/a new session/);
    // They describe WhatBuild and its tools, and send the agent to nothing outside them.
    expect(client.getInstructions()).not.toMatch(/skill|install/i);
    // Links use the deployment's own address, never another name it answers on.
    expect(client.getInstructions()).toContain(`This deployment's address is ${h.baseUrl}.`);
    const index = text(await client.callTool({ name: "guide", arguments: {} }));
    expect(index).toMatchObject({ tools_version: TOOLS_VERSION, topic: "start" });
    expect(index.topics.map((t: { topic: string }) => t.topic)).toEqual(expect.arrayContaining(["start", "tools", "evidence", "story"]));
    expect(index.text).toMatch(/^# /);
    const story = text(await client.callTool({ name: "guide", arguments: { topic: "story" } }));
    expect(story).toMatchObject({ topic: "story" });
    expect(story).not.toHaveProperty("topics");
    const unknown = await client.callTool({ name: "guide", arguments: { topic: "philosophy" } });
    expect(text(unknown).error.code).toBe("invalid_input");
    await client.close();
  });

  it("describes an action without running it, and refuses unknown actions and fields", async () => {
    const client = await connect(agentToken);
    const d = text(await client.callTool({ name: "assumptions_write", arguments: { action: "create", describe: true } }));
    expect(d.input_schema.properties.statement).toBeDefined();
    expect(d.input_schema.additionalProperties).toBe(false);
    const bad = await client.callTool({ name: "assumptions_write", arguments: { action: "explode" } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown assumptions_write action: explode\. This server, version [\d.]+, offers this connection these assumptions_write actions: create,/);
    expect(text(bad).error.details).toMatchObject({ tools_version: TOOLS_VERSION, actions: expect.arrayContaining(["create", "review"]) });
    const field = await client.callTool({ name: "outcomes_write", arguments: { action: "create", product: path, params: { title: "x", colour: "red" } } });
    expect((field.content as { text: string }[])[0]!.text).toMatch(/^422: `colour` is not a field of this action\./);
    // A tool the server does not have: the refusal lists the server's tools and says the client's list may be out of date.
    const tool = await client.callTool({ name: "insights", arguments: { action: "list" } });
    expect((tool.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown tool insights\. This server, version [\d.]+, offers this connection these tools: .*story_read.*start a new session/s);
    expect(text(tool).error).toMatchObject({ code: "unknown_tool", details: { tools_version: TOOLS_VERSION, tools: expect.arrayContaining(["story_read", "mockups_read"]) } });
    await client.close();
  });

  it("points an action called in another of its noun's tools to the right one, and changes nothing", async () => {
    const client = await connect(agentToken);
    const r = await client.callTool({ name: "outcomes_read", arguments: { action: "create", product: path, params: { title: "Crew leads plan the week in minutes" } } });
    expect((r.content as { text: string }[])[0]!.text).toMatch(/^422: outcomes_read has no action create: it changes data, so it is in outcomes_write\. Nothing was changed\./);
    expect(text(r).error).toMatchObject({ code: "wrong_tool", details: { tool: "outcomes_write", action: "create" } });
    expect(text(await client.callTool({ name: "outcomes_write", arguments: { action: "list", product: path } })).error.details.tool).toBe("outcomes_read");
    expect(text(await client.callTool({ name: "outcomes_write", arguments: { action: "delete", product: path } })).error.details.tool).toBe("outcomes_delete");
    expect((await alice.api("GET", `/api/v1/p/${path}/outcomes`)).body.items).toEqual([]);
    await client.close();
  });

  it("points an export called where it used to be to its own tool, saying a client that lists none holds an older list", async () => {
    const client = await connect(agentToken);
    const r = await client.callTool({ name: "products_write", arguments: { action: "export", product: path } });
    expect((r.content as { text: string }[])[0]!.text).toMatch(/^422: products_write has no action export: it takes a copy away and changes nothing, so it is in products_export\. Nothing was changed\. A client that does not list products_export holds a tool list from an older version of this server; a new session .*brings the current one\./);
    expect(text(r).error).toMatchObject({ code: "wrong_tool", details: { tool: "products_export", action: "export" } });
    expect((await alice.api("GET", `/api/v1/p/${path}/exports`)).body.items).toEqual([]);
    // A call to the noun's old tool name says where its actions went, the export's among them.
    const old = await client.callTool({ name: "products", arguments: { action: "export", product: path } });
    expect((old.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown tool products\. Its actions are now in products_read, products_write, products_delete, products_export, by whether they read, change, export or permanently delete\./);
    await client.close();
  });

  it("says a write in the example organization is refused to anyone but its authors, who may write there", async () => {
    const client = await connect(agentToken);
    expect(client.getInstructions()).toContain("only its authors change, so a write there by anyone else is refused");
    expect(client.getInstructions()).not.toMatch(/every write there/);
    await client.close();
  });

  it("tells a call to a tool from before the split, or to get_skill, where its actions went", async () => {
    const client = await connect(agentToken);
    const old = await client.callTool({ name: "sources", arguments: { action: "list", product: path } });
    expect((old.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown tool sources\. Its actions are now in sources_read, sources_write, sources_delete, by whether they read, change or permanently delete\. .*start a new session/s);
    const skill = await client.callTool({ name: "get_skill", arguments: {} });
    expect((skill.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown tool get_skill\. The skill is retired: the guide tool describes how WhatBuild works\./);
    await client.close();
  });

  it("says in products list and in every product's answer which tools version it runs now", async () => {
    // A client keeps the tool list it connected with, so an upgrade made since shows only in answers.
    const client = await connect(agentToken);
    expect(client.getInstructions()).toContain("as tools_version");
    const listed = text(await client.callTool({ name: "products_read", arguments: { action: "list" } }));
    expect(listed.tools_version).toBe(TOOLS_VERSION);
    const outcomes = text(await client.callTool({ name: "outcomes_read", arguments: { action: "list", product: path } }));
    expect(outcomes.scope).toMatchObject({ product: { path }, tools_version: TOOLS_VERSION });
    // A refusal names it too.
    const bad = text(await client.callTool({ name: "outcomes_read", arguments: { action: "explode", product: path } }));
    expect(bad.error.details.tools_version).toBe(TOOLS_VERSION);
    await client.close();
  });

  it("says an action is missing, and lists the tool's actions, when a tool with actions is called without one", async () => {
    const client = await connect(agentToken);
    for (const args of [{ params: {} }, { describe: true }, { action: "" }, { action: null }]) {
      const r = await client.callTool({ name: "sources_read", arguments: args });
      expect(r.isError).toBe(true);
      const t = (r.content as { text: string }[])[0]!.text;
      expect(t, JSON.stringify(args)).toMatch(/^422: `action` is missing: sources_read needs one of its actions \(facets, list, get, [a-z_, ]+\), with the action's fields in params\. Call it with an action and describe=true to see that action's fields\. Nothing was changed\./);
      expect(t).not.toContain("undefined");
      expect(text(r).error).toMatchObject({ code: "invalid_input", details: { actions: expect.arrayContaining(["list", "get", "facets"]) } });
    }
    await client.close();
  });

  it("runs the agent path: create with upload, PUT, complete, read, search, read the text around a hit, record", async () => {
    const client = await connect(agentToken);
    // Only one product is reachable, so `product` may be omitted.
    const created = text(await client.callTool({
      name: "attachments_write",
      arguments: { action: "create_upload", params: { tags: ["interview"], title: "Buyer interview — Example Co, Sep 2026", date: "2026-09-01", path: "notes.txt" } },
    }));
    expect(created.scope?.product.path, JSON.stringify(created)).toBe(path);
    const put = await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: "Interviewer: What slows you down?\nBuyer: Approvals. Every purchase over a thousand dollars waits a week.\nInterviewer: Who approves?\nBuyer: Finance, once a week on Mondays.\n" });
    expect(put.status).toBe(201);
    const done = text(await client.callTool({ name: "attachments_write", arguments: { action: "complete_upload", product: path, params: { record_id: created.record.record_id, path: "notes.txt" } } }));
    expect(done).toMatchObject({ path: "notes.txt", text: { status: "pending" } });
    expect(done).not.toHaveProperty("role");
    expect(done.note).toMatch(/its text becomes the source's derived text/);
    await h.worker.drain();
    const hits = text(await client.callTool({ name: "search", arguments: { product: path, query: "approvals" } }));
    expect(hits.hits[0]).toMatchObject({ record_id: created.record.record_id, field: "text" });
    // A hit is read in the derived text by the offsets it carries.
    const hit = hits.hits[0];
    const around = text(await client.callTool({ name: "derived_read", arguments: { action: "text", product: path, params: { record_id: hit.record_id, offset: hit.char_start, limit: hit.char_end - hit.char_start } } }));
    expect(around).toMatchObject({ of: "derived_text", text: "Approvals" });
    const whole = text(await client.callTool({ name: "derived_read", arguments: { action: "text", product: path, params: { record_id: created.record.record_id } } }));
    expect(whole.text).toContain("Finance, once a week on Mondays.");
    expect(whole.taken_from).toMatchObject({ path: "notes.txt" });
    // The old tool is gone; the refusal names the tools there are.
    const old = await client.callTool({ name: "read_passage", arguments: { product: path, record_id: created.record.record_id, seq: 0 } });
    expect(text(old).error).toMatchObject({ code: "unknown_tool", details: { tools: expect.arrayContaining(["attachments_write", "derived_read"]) } });
    const a = text(await client.callTool({
      name: "assumptions_write",
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
    const r = await client.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } });
    expect(r.isError).toBe(true);
    const body = (r.content as { text: string }[])[0]!.text;
    expect(body).toMatch(/^422: Say which product/);
    expect(body).toContain(path);
    // A connector bound to one product needs no `product`.
    const bound = await connect(agentToken, `${h.baseUrl}/mcp/t/${path}`);
    const ok = await bound.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } });
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
      { name: "outcomes_write", arguments: { action: "create", product: path, params: { title: "x", colour: "red" } } },
      { name: "outcomes_write", arguments: { action: "create", product: path, params: { title: 7 } } },
      { name: "search", arguments: { product: path, colour: "red" } },
      { name: "members_read", arguments: { action: "list", params: { tenant, colour: "red" } } },
      { name: "products_write", arguments: { action: "create", params: { tenant, team, name: "" } } },
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
    expect(text(await member.callTool({ name: "outcomes_write", arguments: { action: "create", params: { title: "x", colour: "red" } } })).error.code).toBe("invalid_input");
    expect(text(await member.callTool({ name: "members_read", arguments: { action: "list", params: {} } })).error.code).toBe("invalid_input");
    await outsider.close();
    await member.close();
  });

  it("reads a body up to the REST limit, and refuses a larger one, declared or streamed, read only once the caller is known", async () => {
    expect(MCP_BODY_MAX_BYTES).toBe(REST_BODY_MAX_BYTES);
    const headers = { authorization: `Bearer ${agentToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    /** A tools/call whose JSON is `bytes` long, padded with an argument the tool refuses. */
    const call = (bytes: number) => {
      const shell = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "products_read", arguments: { action: "list", padding: "" } } });
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
    const list = text(await client.callTool({ name: "products_read", arguments: { action: "list" } }));
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
  let examplePath: string;
  let tenantSlug: string;
  let plainPath: string;
  let plainSlug: string;
  let token: string;

  beforeAll(async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Try Co" });
    tenantSlug = t.body.tenant.slug;
    const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${t.body.team.slug}/products`, { name: "Showcase" });
    examplePath = p.body.path;
    expect(await syncExampleTenant(h.db, tenantSlug, () => {})).toBe(t.body.tenant.tenant_id);
    const o = await alice.api("POST", "/api/v1/tenants", { name: "Plain Co" });
    plainSlug = o.body.tenant.slug;
    plainPath = (await alice.api("POST", `/api/v1/teams/${plainSlug}/${o.body.team.slug}/products`, { name: "Workbench" })).body.path;
    // Several products are reachable now, so nothing is guessed.
    token = await h.connectAgent(alice, "Unscoped agent");
  });

  it("acts on the organization the product is in, as the other tools take a product", async () => {
    const client = await connect(token);
    // The product named the organization.
    const limits = await client.callTool({ name: "products_read", arguments: { action: "limits", product: plainPath } });
    expect(text(limits)).toMatchObject({ organization: { slug: plainSlug }, plan: "unlimited" });
    // So does any organization's action without a product of its own.
    const log = await client.callTool({ name: "members_read", arguments: { action: "activity", product: plainPath } });
    expect(log.isError, JSON.stringify(log.content)).toBeFalsy();
    // The example organization's product names its organization too, which the unscoped connector reaches.
    const example = await client.callTool({ name: "products_read", arguments: { action: "limits", product: examplePath } });
    expect(text(example)).toMatchObject({ organization: { slug: tenantSlug } });
    // A product the caller cannot see names nothing.
    const other = await client.callTool({ name: "products_read", arguments: { action: "limits", product: "nowhere/team/product" } });
    expect((other.content as { text: string }[])[0]!.text).toMatch(/^404: /);
    await client.close();
  });

  it("says what to pass when the call names neither the organization nor a product, or when product means something else there", async () => {
    const client = await connect(token);
    const none = await client.callTool({ name: "products_read", arguments: { action: "limits" } });
    expect((none.content as { text: string }[])[0]!.text).toMatch(
      /^422: `tenant` is missing: products_read\(action="limits"\) acts on an organization\. Pass params\.tenant, the organization's slug or id: the first part of a product's path .*, or name any product in it with product\. Nothing was changed\./,
    );
    const members = await client.callTool({ name: "members_read", arguments: { action: "list", product: plainPath } });
    expect(text(members).error.code).toBe("invalid_input");
    expect(text(members).error.message).toContain("params.product names a product of its own here");
    // Named in params, the organization is used as it always was.
    const listed = await client.callTool({ name: "members_read", arguments: { action: "list", params: { tenant: plainSlug } } });
    expect(listed.isError, JSON.stringify(listed.content)).toBeFalsy();
    await client.close();
  });

  it("on a connector scoped to the product, takes the organization from the connector", async () => {
    const [tn, tm, pr] = examplePath.split("/");
    const scoped = await h.connectAgent(alice, "Scoped product agent", `/mcp/t/${tn}/${tm}/${pr}`);
    const client = await connect(scoped, `${h.baseUrl}/mcp/t/${tn}/${tm}/${pr}`);
    const status = await client.callTool({ name: "products_read", arguments: { action: "limits" } });
    expect(status.isError, JSON.stringify(status.content)).toBeFalsy();
    expect(text(status)).toMatchObject({ organization: { slug: tenantSlug } });
    await client.close();
  });
});
