import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
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

  it("refuses organization and team calls and moving work to another product, but answers the organization's limits", async () => {
    const c = await connect(`/mcp/t/${onboarding}`);
    expect(body(await c.callTool({ name: "members", arguments: { action: "list", params: {} } })).json.error.code).toBe("outside_connector_scope");
    expect(body(await c.callTool({ name: "products", arguments: { action: "create", params: { name: "Third" } } })).json.error.code).toBe("outside_connector_scope");
    const src = body(await c.callTool({ name: "sources", arguments: { action: "create", params: { tags: ["interview"], title: "Interview", date: "2026-09-01" } } }));
    expect(src.status).toBe(200);
    const copy = body(await c.callTool({ name: "sources", arguments: { action: "copy_to_product", params: { record_id: src.json.record_id, to_product: billing.split("/")[2] } } }));
    expect(copy.json.error.code).toBe("outside_connector_scope");
    // The caller's own standing in the organization: the fence lets it through for the product's organization.
    const limits = body(await c.callTool({ name: "products", arguments: { action: "limits", params: {} } }));
    expect(limits.status).toBe(200);
    expect(limits.json).toMatchObject({ organization: { slug: acme }, plan: "unlimited", you_meet_them: false });
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

describe("the example organization", () => {
  // Alice owns it and Acme; Gus holds no grant anywhere, so he is its guest; Dee has one product of her own.
  let commons: string;
  let showcase: string;
  let gus: Browser;
  let dee: Browser;
  let solo: string;

  beforeAll(async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Commons" });
    commons = t.body.tenant.slug;
    showcase = (await alice.api("POST", `/api/v1/teams/${commons}/${t.body.team.slug}/products`, { name: "Showcase" })).body.path;
    expect((await alice.api("POST", `/api/v1/p/${showcase}/outcomes`, { title: "Plan the week in ten minutes" })).status).toBe(201);
    expect(await syncExampleTenant(h.db, commons, () => {})).toBe(t.body.tenant.tenant_id);
    gus = await h.signIn("gus@guest.example", "Gus Guest");
    dee = await h.signIn("dee@own.example", "Dee Own");
    const d = await dee.api("POST", "/api/v1/tenants", { name: "Solo" });
    solo = (await dee.api("POST", `/api/v1/teams/${d.body.tenant.slug}/${d.body.team.slug}/products`, { name: "Only one" })).body.path;
  });
  afterAll(async () => {
    await syncExampleTenant(h.db, null, () => {});
  });

  it("is reached through the unscoped connector, listed and read there, and refuses every write", async () => {
    const c = await connect("/mcp", await h.connectAgent(gus, "Guest agent"));
    expect(c.getInstructions()).toContain("example organization");
    const list = body(await c.callTool({ name: "products", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path)).toEqual([showcase]);
    expect(list.items[0]).toMatchObject({ tenant: { slug: commons, example: true }, your_role: "viewer" });
    expect(list.tenants).toEqual([expect.objectContaining({ slug: commons, example: true, your_role: "guest" })]);
    expect(list.public_sandboxes).toBeUndefined();
    const read = body(await c.callTool({ name: "outcomes", arguments: { action: "list", product: showcase, params: {} } }));
    expect(read.status).toBe(200);
    expect(read.json.scope).toMatchObject({ example: true, your_role: "viewer" });
    const write = body(await c.callTool({ name: "outcomes", arguments: { action: "create", product: showcase, params: { title: "Not here" } } }));
    expect(write.status).toBe(403);
    expect(write.json.error.code).toBe("example_read_only");
    expect(write.json.error.message).toMatch(/create an organization of your own/);
    // Someone with no product of their own is asked which product: the example's are never picked by themselves.
    expect(body(await c.callTool({ name: "outcomes", arguments: { action: "list", params: {} } })).json.error.code).toBe("product_required");
    await c.close();
  });

  it("is never picked as the product a call means when the person has one of their own", async () => {
    const c = await connect("/mcp", await h.connectAgent(dee, "Own agent"));
    const list = body(await c.callTool({ name: "products", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path).sort()).toEqual([showcase, solo].sort());
    const unnamed = body(await c.callTool({ name: "outcomes", arguments: { action: "list", params: {} } }));
    expect(unnamed.status).toBe(200);
    expect(unnamed.json.scope.product.path).toBe(solo);
    await c.close();
  });

  it("works through its own connector, which picks its product by itself", async () => {
    const c = await connect(`/mcp/t/${commons}`, await h.connectAgent(gus, "Guest example agent", `/mcp/t/${commons}`));
    const read = body(await c.callTool({ name: "outcomes", arguments: { action: "list", params: {} } }));
    expect(read.status).toBe(200);
    expect(read.json.scope.product.path).toBe(showcase);
    const limits = body(await c.callTool({ name: "products", arguments: { action: "limits", params: {} } }));
    expect(limits.json).toMatchObject({ organization: { slug: commons }, you_meet_them: "calls_per_minute_only" });
    await c.close();
  });

  it("is named on the consent page and in the connected agents as reached like every other product", async () => {
    const agents = (await gus.api("GET", "/api/v1/me/agents")).body.items as { client_name: string; reach: unknown }[];
    expect(agents.find((a) => a.client_name === "Guest agent")!.reach).toEqual({ kind: "all" });
  });
});
