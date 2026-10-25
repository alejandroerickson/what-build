import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OPERATIONS } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncSandboxTenant } from "../src/public-sandbox.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A scoped connector is a fence: calls outside its organization or product are refused, and its
// token serves no wider endpoint.

let h: Harness;
let alice: Browser;
let token: string;
let acme: string;
let globex: string;
let onboarding: string;
let billing: string;
let payroll: string;

function body(r: unknown): { status: number; json: any } {
  const t = (r as { content: { text: string }[] }).content[0]!.text;
  if (t.startsWith("{")) return { status: 200, json: JSON.parse(t) };
  return { status: Number(t.slice(0, 3)), json: JSON.parse(t.slice(t.indexOf("\n") + 1)) };
}

async function connect(path: string, bearer = token) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}${path}`), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } }));
  return client;
}

async function post(path: string, bearer: string) {
  return fetch(`${h.baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["alice@example.com"] });
  alice = await h.signIn("alice@example.com", "Alice");
  const a = await alice.api("POST", "/api/v1/tenants", { name: "Acme" });
  acme = a.body.tenant.slug;
  onboarding = (await alice.api("POST", `/api/v1/teams/${acme}/${a.body.team.slug}/products`, { name: "Onboarding" })).body.path;
  billing = (await alice.api("POST", `/api/v1/teams/${acme}/${a.body.team.slug}/products`, { name: "Billing" })).body.path;
  const g = await alice.api("POST", "/api/v1/tenants", { name: "Globex" });
  globex = g.body.tenant.slug;
  payroll = (await alice.api("POST", `/api/v1/teams/${globex}/${g.body.team.slug}/products`, { name: "Payroll" })).body.path;
  token = await h.connectAgent(alice);
});
afterAll(async () => h?.close());

describe("a connector scoped to an organization", () => {
  it("sees only that organization and says so in its instructions", async () => {
    const c = await connect(`/mcp/t/${acme}`);
    expect(c.getInstructions()).toContain(`scoped to the organization ${acme}`);
    const list = body(await c.callTool({ name: "products", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path).sort()).toEqual([billing, onboarding].sort());
    expect(list.tenants.map((t: { slug: string }) => t.slug)).toEqual([acme]);
    // Two products inside: it asks which, and lists only those.
    const ask = body(await c.callTool({ name: "outcomes", arguments: { action: "list", params: {} } }));
    expect(ask.status).toBe(422);
    expect(JSON.stringify(ask.json)).not.toContain(payroll);
    await c.close();
  });

  it("works anywhere inside it", async () => {
    const c = await connect(`/mcp/t/${acme}`);
    const made = body(await c.callTool({ name: "outcomes", arguments: { action: "create", product: billing, params: { title: "Invoices go out on time" } } }));
    expect(made.status).toBe(200);
    expect(made.json.scope.product.path).toBe(billing);
    const members = body(await c.callTool({ name: "members", arguments: { action: "list", params: {} } }));
    expect(members.status).toBe(200);
    await c.close();
  });

  it("refuses another organization's product, its tenant calls and account-wide writes, and changes nothing", async () => {
    const c = await connect(`/mcp/t/${acme}`);
    const write = body(await c.callTool({ name: "outcomes", arguments: { action: "create", product: payroll, params: { title: "Payslips are right" } } }));
    expect(write.status).toBe(403);
    expect(write.json.error.code).toBe("outside_connector_scope");
    expect(write.json.error.message).toContain(`organization Acme (${acme})`);
    expect((await alice.api("GET", `/api/v1/p/${payroll}/outcomes`)).body.items).toHaveLength(0);
    const read = body(await c.callTool({ name: "search", arguments: { product: payroll, query: "pay" } }));
    expect(read.json.error.code).toBe("outside_connector_scope");
    const tenantCall = body(await c.callTool({ name: "members", arguments: { action: "list", params: { tenant: globex } } }));
    expect(tenantCall.json.error.code).toBe("outside_connector_scope");
    const newOrg = body(await c.callTool({ name: "products", arguments: { action: "create_tenant", params: { name: "Initech" } } }));
    expect(newOrg.json.error.code).toBe("outside_connector_scope");
    expect((await alice.api("GET", "/api/v1/me/products")).body.tenants).toHaveLength(2);
    await c.close();
  });

  it("answers 404 when the person cannot reach the organization", async () => {
    const bob = await h.signIn("bob@example.com", "Bob");
    const c = await connect(`/mcp/t/${acme}`, await h.connectAgent(bob));
    const r = body(await c.callTool({ name: "products", arguments: { action: "list" } }));
    expect(r.status).toBe(404);
    expect(r.json.error.message).toContain(`organization ${acme}`);
    await c.close();
  });
});

describe("a connector scoped to a product", () => {
  it("sees only that product, needs no product argument, and refuses every other", async () => {
    const c = await connect(`/mcp/t/${onboarding}`);
    expect(c.getInstructions()).toContain(`scoped to the product ${onboarding}`);
    const list = body(await c.callTool({ name: "products", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path)).toEqual([onboarding]);
    expect(body(await c.callTool({ name: "outcomes", arguments: { action: "list", params: {} } })).status).toBe(200);
    for (const other of [billing, payroll]) {
      const r = body(await c.callTool({ name: "outcomes", arguments: { action: "list", product: other, params: {} } }));
      expect(r.json.error?.code, other).toBe("outside_connector_scope");
    }
    await c.close();
  });

  it("refuses organization and team calls and moving work to another product, but answers sandbox status", async () => {
    const c = await connect(`/mcp/t/${onboarding}`);
    expect(body(await c.callTool({ name: "members", arguments: { action: "list", params: {} } })).json.error.code).toBe("outside_connector_scope");
    expect(body(await c.callTool({ name: "products", arguments: { action: "create", params: { name: "Third" } } })).json.error.code).toBe("outside_connector_scope");
    const src = body(await c.callTool({ name: "sources", arguments: { action: "create", params: { tags: ["interview"], title: "Interview", date: "2026-09-01" } } }));
    expect(src.status).toBe(200);
    const copy = body(await c.callTool({ name: "sources", arguments: { action: "copy_to_product", params: { record_id: src.json.record_id, to_product: billing.split("/")[2] } } }));
    expect(copy.json.error.code).toBe("outside_connector_scope");
    // Acme is no sandbox, so status answers 404: the fence let the call through.
    expect(body(await c.callTool({ name: "sandbox", arguments: { action: "status", params: {} } })).status).toBe(404);
    await c.close();
  });
});

describe("a token approved for a scoped connector", () => {
  it("serves its endpoint and the ones inside it, never a wider one", async () => {
    const scoped = await h.connectAgent(alice, "Org agent", `/mcp/t/${acme}`);
    expect((await post(`/mcp/t/${acme}`, scoped)).status).toBe(200);
    expect((await post(`/mcp/t/${onboarding}`, scoped)).status).toBe(200);
    expect((await post("/mcp", scoped)).status).toBe(401);
    expect((await post(`/mcp/t/${globex}`, scoped)).status).toBe(401);
    expect((await post(`/mcp/t/${payroll}`, scoped)).status).toBe(401);
    // The unscoped token still reaches every endpoint.
    expect((await post(`/mcp/t/${acme}`, token)).status).toBe(200);
  });

  it("names its scope on the consent page and in the connected agents", async () => {
    const authorize = (resource: string) =>
      `${h.baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&code_challenge=x&code_challenge_method=S256&resource=${encodeURIComponent(`${h.baseUrl}${resource}`)}`;
    const reg = await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Consent check", redirect_uris: ["http://127.0.0.1:9999/callback"] }) });
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    const org = await (await fetch(authorize(`/mcp/t/${acme}`), { headers: { cookie: alice.cookie } })).text();
    expect(org).toContain("reaches the organization <strong>Acme</strong>, and nothing outside it");
    const product = await (await fetch(authorize(`/mcp/t/${onboarding}`), { headers: { cookie: alice.cookie } })).text();
    expect(product).toContain("reaches the product <strong>Onboarding</strong> (Acme), and nothing outside it");
    const all = await (await fetch(authorize("/mcp"), { headers: { cookie: alice.cookie } })).text();
    expect(all).toContain("reaches every product you can open");
    // Said on WhatBuild's page: nothing goes back to a client before the person decides.
    const bad = await fetch(authorize("/mcp/elsewhere"), { headers: { cookie: alice.cookie }, redirect: "manual" });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("location")).toBeNull();
    expect(await bad.text()).toContain("invalid_target");

    await h.connectAgent(alice, "Product agent", `/mcp/t/${onboarding}`);
    const agents = (await alice.api("GET", "/api/v1/me/agents")).body.items as { client_name: string; reach: Record<string, unknown> }[];
    expect(agents.find((a) => a.client_name === "Org agent")!.reach).toEqual({ kind: "tenant", path: acme, name: "Acme" });
    expect(agents.find((a) => a.client_name === "Product agent")!.reach).toEqual({ kind: "product", path: onboarding, name: "Onboarding", tenant_name: "Acme" });
    expect(agents.find((a) => a.client_name === "test-agent")!.reach).toEqual({ kind: "all" });
  });
});

describe("a public sandbox", () => {
  // Alice owns it and Acme; Vic came in by an invitation; Mel was given a role by its staff, and is treated as a visitor is.
  let commons: string;
  let showcase: string;
  let team: string;
  let vic: Browser;
  let mel: Browser;
  const agents: Record<"staff" | "visitor" | "member", string> = { staff: "", visitor: "", member: "" };

  /** A call over MCP as the person's agent, with an operation's place filled in and no fields of its own. */
  async function call(c: Client, op: (typeof OPERATIONS)[number]) {
    const params: Record<string, unknown> = op.scope === "tenant" || op.scope === "team" ? { tenant: commons, ...(op.scope === "team" ? { team } : {}) } : {};
    const where = op.scope === "product" ? { product: showcase } : {};
    return body(await c.callTool({ name: op.mcp.tool, arguments: op.mcp.action ? { action: op.mcp.action, params, ...where } : { ...params, ...where } }));
  }

  beforeAll(async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Commons" });
    commons = t.body.tenant.slug;
    team = t.body.team.slug;
    showcase = (await alice.api("POST", `/api/v1/teams/${commons}/${team}/products`, { name: "Showcase" })).body.path;
    expect(await syncSandboxTenant(h.db, commons, () => {})).toBe(t.body.tenant.tenant_id);
    const T = `/api/v1/tenants/${commons}`;
    const settings = (await alice.api("GET", `${T}/sandbox/settings`)).body;
    expect((await alice.api("PATCH", `${T}/sandbox/settings`, { expected_etag: settings.etag, visitor_access: "write" })).status).toBe(200);
    const invite = await alice.api("POST", `${T}/sandbox/invites`, { label: "Launch", places: 5 });
    vic = await h.signIn("vic@visitor.example", "Vic Visitor");
    expect((await vic.api("POST", "/api/v1/sandbox/join", { code: String(invite.body.invite_link).split("/join/")[1] })).status).toBe(200);
    expect((await alice.api("POST", `${T}/members`, { email: "mel@staff.example", role: "admin", team })).status).toBeLessThan(300);
    mel = await h.signIn("mel@staff.example", "Mel Member");
    agents.staff = token;
    agents.visitor = await h.connectAgent(vic, "Visitor agent");
    agents.member = await h.connectAgent(mel, "Member agent");
  });

  it("is reached by no call through the unscoped connector, staff included, and the refusal names its connector", async () => {
    const scoped = OPERATIONS.filter((o) => o.scope !== "account" && !o.webOnly);
    const activity = async () => JSON.stringify((await alice.api("GET", `/api/v1/p/${showcase}/activity`)).body.items);
    const before = await activity();
    expect(before).toMatch(/^\[/);
    const failures: string[] = [];
    for (const [who, bearer] of Object.entries(agents)) {
      const c = await connect("/mcp", bearer);
      for (const op of scoped) {
        const r = await call(c, op);
        // Staff hold every role, so each call reaches the fence; a visitor's may be refused for their role first. Either way, nothing is read or written.
        const ok = who === "staff" ? r.json.error?.code === "sandbox_needs_its_own_connector" : r.status === 403 && ["sandbox_needs_its_own_connector", "forbidden"].includes(r.json.error?.code);
        if (!ok) failures.push(`${who} ${op.name} → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
      }
      for (const name of ["outcomes.list", "sources.list", "search", "outcomes.create", "story.list_pages", "sandbox.status"]) {
        const r = await call(c, OPERATIONS.find((o) => o.name === name)!);
        expect(r.status, `${who} ${name}`).toBe(403);
        expect(r.json.error, `${who} ${name}`).toMatchObject({ code: "sandbox_needs_its_own_connector", details: { connect_at: `${h.baseUrl}/mcp/t/${commons}`, tenant: commons } });
        expect(r.json.error.message).toContain("Nothing was changed");
      }
      await c.close();
    }
    expect(failures).toEqual([]);
    expect(await activity()).toBe(before);
  });

  it("works through its own connector and its products' connectors", async () => {
    for (const [who, browser] of [["staff", alice], ["visitor", vic], ["member", mel]] as const) {
      for (const path of [`/mcp/t/${commons}`, `/mcp/t/${showcase}`]) {
        const c = await connect(path, await h.connectAgent(browser, `${who} sandbox agent`, path));
        const listed = body(await c.callTool({ name: "outcomes", arguments: { action: "list", product: showcase, params: {} } }));
        expect(listed.status, `${who} ${path} ${JSON.stringify(listed.json)}`).toBe(200);
        expect(listed.json.scope).toMatchObject({ public_sandbox: true });
        const status = body(await c.callTool({ name: "sandbox", arguments: { action: "status", params: { tenant: commons } } }));
        expect(status.status, `${who} ${path}`).toBe(200);
        expect(status.json.connect_at).toBe(`${h.baseUrl}/mcp/t/${commons}`);
        await c.close();
      }
    }
  });

  it("is left out of the unscoped connector's product list, which gives its address instead", async () => {
    const c = await connect("/mcp", agents.staff);
    const list = body(await c.callTool({ name: "products", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path)).not.toContain(showcase);
    expect(list.items.map((i: { path: string }) => i.path)).toContain(onboarding);
    expect(list.tenants.map((t: { slug: string }) => t.slug)).not.toContain(commons);
    expect(list.public_sandboxes).toEqual([{ organization: { slug: commons, name: "Commons" }, connect_at: `${h.baseUrl}/mcp/t/${commons}`, connect_why: expect.stringContaining("strangers") }]);
    expect(JSON.stringify(list)).not.toContain(showcase);
    await c.close();
    // Someone who is only in the sandbox lists nothing, and a call that names no product is told where to connect.
    const v = await connect("/mcp", agents.visitor);
    const theirs = body(await v.callTool({ name: "products", arguments: { action: "list" } })).json;
    expect(theirs.items).toEqual([]);
    expect(theirs.public_sandboxes.map((p: { organization: { slug: string } }) => p.organization.slug)).toEqual([commons]);
    const unnamed = body(await v.callTool({ name: "outcomes", arguments: { action: "list", params: {} } }));
    expect(unnamed.json.error.code).toBe("sandbox_needs_its_own_connector");
    await v.close();
    // Its own connector lists it, as the web app does.
    const own = await connect(`/mcp/t/${commons}`, await h.connectAgent(vic, "Visitor sandbox agent", `/mcp/t/${commons}`));
    expect(body(await own.callTool({ name: "products", arguments: { action: "list" } })).json.items.map((i: { path: string }) => i.path)).toEqual([showcase]);
    await own.close();
    expect((await vic.api("GET", "/api/v1/me/products")).body.items.map((i: { path: string }) => i.path)).toEqual([showcase]);
  });

  it("is still entered through the unscoped connector, whose answer gives the connector to add", async () => {
    const invite = await alice.api("POST", `/api/v1/tenants/${commons}/sandbox/invites`, { label: "By an agent", places: 1 });
    const newcomer = await h.signIn("nia@visitor.example", "Nia Newcomer");
    const c = await connect("/mcp", await h.connectAgent(newcomer, "Newcomer agent"));
    const joined = body(await c.callTool({ name: "sandbox", arguments: { action: "join", params: { code: String(invite.body.invite_link).split("/join/")[1] } } }));
    expect(joined.status, JSON.stringify(joined.json)).toBe(200);
    expect(joined.json).toMatchObject({ joined: true, role: "visitor", connect_at: `${h.baseUrl}/mcp/t/${commons}`, connect_why: expect.stringContaining("no other WhatBuild connector") });
    expect(body(await c.callTool({ name: "outcomes", arguments: { action: "list", product: showcase, params: {} } })).json.error.code).toBe("sandbox_needs_its_own_connector");
    await c.close();
  });

  it("gives no connector to add while visitors' agents are off, except to its staff", async () => {
    const T = `/api/v1/tenants/${commons}`;
    const etag = (await alice.api("GET", `${T}/sandbox/settings`)).body.etag;
    expect((await alice.api("PATCH", `${T}/sandbox/settings`, { expected_etag: etag, visitor_agents: false })).status).toBe(200);
    try {
      expect((await vic.api("GET", `${T}/sandbox`)).body.connect_at).toBeUndefined();
      expect((await alice.api("GET", `${T}/sandbox`)).body.connect_at).toBe(`${h.baseUrl}/mcp/t/${commons}`);
    } finally {
      const now = (await alice.api("GET", `${T}/sandbox/settings`)).body.etag;
      await alice.api("PATCH", `${T}/sandbox/settings`, { expected_etag: now, visitor_agents: true });
    }
  });

  it("is refused to a connector scoped to another organization", async () => {
    const c = await connect(`/mcp/t/${acme}`);
    expect(body(await c.callTool({ name: "outcomes", arguments: { action: "list", product: showcase, params: {} } })).json.error.code).toBe("outside_connector_scope");
    expect(body(await c.callTool({ name: "sandbox", arguments: { action: "status", params: { tenant: commons } } })).json.error.code).toBe("outside_connector_scope");
    await c.close();
  });

  it("is named on the consent page and in the connected agents as outside the unscoped connector's reach", async () => {
    const agents = (await vic.api("GET", "/api/v1/me/agents")).body.items as { client_name: string; reach: Record<string, unknown> }[];
    expect(agents.find((a) => a.client_name === "Visitor agent")!.reach).toEqual({ kind: "all", except_sandboxes: true });
    const reg = await fetch(`${h.baseUrl}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Consent check", redirect_uris: ["http://127.0.0.1:9999/callback"] }) });
    const clientId = ((await reg.json()) as { client_id: string }).client_id;
    const page = await fetch(
      `${h.baseUrl}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:9999/callback")}&code_challenge=x&code_challenge_method=S256&resource=${encodeURIComponent(`${h.baseUrl}/mcp`)}`,
      { headers: { cookie: vic.cookie } },
    );
    expect(await page.text()).toContain("except in a public sandbox, which only a connector of its own reaches");
  });

  it("gives its address on the page behind an invitation link", async () => {
    const invite = await alice.api("POST", `/api/v1/tenants/${commons}/sandbox/invites`, { label: "For the page", places: 1 });
    const info = (await (await fetch(`${h.baseUrl}/api/v1/sandbox/invite?code=${String(invite.body.invite_link).split("/join/")[1]}`)).json()) as Record<string, unknown>;
    expect(info["connect_at"]).toBe(`${h.baseUrl}/mcp/t/${commons}`);
  });
});
