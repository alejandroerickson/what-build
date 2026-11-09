import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectorBound, resourceCovers } from "../src/auth/connector-reach.ts";
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
  onboarding = (await alice.api("POST", `/api/v1/tenants/${acme}/products`, { name: "Onboarding" })).body.path;
  billing = (await alice.api("POST", `/api/v1/tenants/${acme}/products`, { name: "Billing" })).body.path;
  const g = await alice.api("POST", "/api/v1/tenants", { name: "Globex" });
  globex = g.body.tenant.slug;
  payroll = (await alice.api("POST", `/api/v1/tenants/${globex}/products`, { name: "Payroll" })).body.path;
  token = await h.connectAgent(alice);
});
afterAll(async () => h?.close());

describe("a connector scoped to an organization", () => {
  it("sees only that organization and says so in its instructions", async () => {
    const c = await connect(`/mcp/t/${acme}`);
    expect(c.getInstructions()).toContain(`scoped to the organization ${acme}`);
    const list = body(await c.callTool({ name: "products_read", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path).sort()).toEqual([billing, onboarding].sort());
    expect(list.tenants.map((t: { slug: string }) => t.slug)).toEqual([acme]);
    // Two products inside: it asks which, and lists only those.
    const ask = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } }));
    expect(ask.status).toBe(422);
    expect(JSON.stringify(ask.json)).not.toContain(payroll);
    await c.close();
  });

  it("works anywhere inside it", async () => {
    const c = await connect(`/mcp/t/${acme}`);
    const made = body(await c.callTool({ name: "outcomes_write", arguments: { action: "create", product: billing, params: { title: "Invoices go out on time" } } }));
    expect(made.status).toBe(200);
    expect(made.json.scope.product.path).toBe(billing);
    const members = body(await c.callTool({ name: "members_read", arguments: { action: "list", params: {} } }));
    expect(members.status).toBe(200);
    await c.close();
  });

  it("refuses another organization's product, its tenant calls and account-wide writes, and changes nothing", async () => {
    const c = await connect(`/mcp/t/${acme}`);
    const write = body(await c.callTool({ name: "outcomes_write", arguments: { action: "create", product: payroll, params: { title: "Payslips are right" } } }));
    expect(write.status).toBe(403);
    expect(write.json.error.code).toBe("outside_connector_scope");
    expect(write.json.error.message).toContain(`organization Acme (${acme})`);
    expect((await alice.api("GET", `/api/v1/p/${payroll}/outcomes`)).body.items).toHaveLength(0);
    const read = body(await c.callTool({ name: "search", arguments: { product: payroll, query: "pay" } }));
    expect(read.json.error.code).toBe("outside_connector_scope");
    const tenantCall = body(await c.callTool({ name: "members_read", arguments: { action: "list", params: { tenant: globex } } }));
    expect(tenantCall.json.error.code).toBe("outside_connector_scope");
    const newOrg = body(await c.callTool({ name: "products_write", arguments: { action: "create_tenant", params: { name: "Initech" } } }));
    expect(newOrg.json.error.code).toBe("outside_connector_scope");
    expect((await alice.api("GET", "/api/v1/me/products")).body.tenants).toHaveLength(2);
    await c.close();
  });

  it("answers 404 when the person cannot reach the organization", async () => {
    const bob = await h.signIn("bob@example.com", "Bob");
    const c = await connect(`/mcp/t/${acme}`, await h.connectAgent(bob));
    const r = body(await c.callTool({ name: "products_read", arguments: { action: "list" } }));
    expect(r.status).toBe(404);
    expect(r.json.error.message).toContain(`organization ${acme}`);
    await c.close();
  });
});

describe("a connector scoped to a product", () => {
  it("sees only that product, needs no product argument, and refuses every other", async () => {
    const c = await connect(`/mcp/t/${onboarding}`);
    expect(c.getInstructions()).toContain(`scoped to the product ${onboarding}`);
    const list = body(await c.callTool({ name: "products_read", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path)).toEqual([onboarding]);
    expect(body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } })).status).toBe(200);
    for (const other of [billing, payroll]) {
      const r = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", product: other, params: {} } }));
      expect(r.json.error?.code, other).toBe("outside_connector_scope");
    }
    await c.close();
  });

  it("refuses the organization's calls, creating a product among them, but answers the organization's limits", async () => {
    const c = await connect(`/mcp/t/${onboarding}`);
    expect(body(await c.callTool({ name: "members_read", arguments: { action: "list", params: {} } })).json.error.code).toBe("outside_connector_scope");
    const made = body(await c.callTool({ name: "products_write", arguments: { action: "create", params: { name: "Third" } } }));
    expect(made.json.error.code).toBe("outside_connector_scope");
    expect((await alice.api("GET", "/api/v1/me/products")).body.items.map((i: { name: string }) => i.name)).not.toContain("Third");
    // A source added here stays here: nothing moves or copies it to another product.
    const src = body(await c.callTool({ name: "sources_write", arguments: { action: "create", params: { tags: ["interview"], title: "Interview", date: "2026-09-01" } } }));
    expect(src.status).toBe(200);
    expect(src.json.scope.product.path).toBe(onboarding);
    // The caller's own standing in the organization: the fence lets it through for the product's organization.
    const limits = body(await c.callTool({ name: "products_read", arguments: { action: "limits", params: {} } }));
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

  it("for a product serves that product's endpoint alone: nothing below it, and not its organization", async () => {
    const scoped = await h.connectAgent(alice, "One product agent", `/mcp/t/${onboarding}`);
    expect((await post(`/mcp/t/${onboarding}`, scoped)).status).toBe(200);
    // Below a product's address is another address, which a product's token never covers.
    expect((await post(`/mcp/t/${onboarding}/x`, scoped)).status).toBe(401);
    // Deeper still is no endpoint at all.
    expect((await post(`/mcp/t/${onboarding}/x/y`, scoped)).status).toBe(404);
    expect((await post(`/mcp/t/${acme}`, scoped)).status).toBe(401);
    expect((await post(`/mcp/t/${billing}`, scoped)).status).toBe(401);
    expect((await post("/mcp", scoped)).status).toBe(401);
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
    const refusal = await bad.text();
    expect(refusal).toContain("invalid_target");
    expect(refusal).toContain("/mcp, /mcp/t/<organization> and /mcp/t/<organization>/<product>.");

    await h.connectAgent(alice, "Product agent", `/mcp/t/${onboarding}`);
    const agents = (await alice.api("GET", "/api/v1/me/agents")).body.items as { client_name: string; reach: Record<string, unknown> }[];
    expect(agents.find((a) => a.client_name === "Org agent")!.reach).toEqual({ kind: "tenant", path: acme, name: "Acme" });
    expect(agents.find((a) => a.client_name === "Product agent")!.reach).toEqual({ kind: "product", path: onboarding, name: "Onboarding", tenant_name: "Acme" });
    expect(agents.find((a) => a.client_name === "test-agent")!.reach).toEqual({ kind: "all" });
  });
});

describe("a token's resource", () => {
  const base = "https://app.example.com";
  it("reads an endpoint's path as the organization, the product, or a product's address from when products were in teams", () => {
    expect(connectorBound("/mcp")).toBeNull();
    expect(connectorBound("/mcp/t/acme")).toEqual({ tenant: "acme" });
    expect(connectorBound("/mcp/t/acme/crew/")).toEqual({ tenant: "acme", product: "crew" });
    expect(connectorBound("/mcp/t/acme/core/crew")).toEqual({ tenant: "acme", formerTeam: "core", product: "crew" });
    for (const path of ["/mcp/t/acme/core/crew/x", "/mcp/t", "/mcp/t//crew", "/mcp/elsewhere", "/api/v1/me"]) expect(connectorBound(path), path).toBeUndefined();
  });

  it("covers its own endpoint, and for an organization or the unscoped connector the endpoints inside it, never a product's sub-path", () => {
    const covers = (resource: string, endpoint: string) => resourceCovers(`${base}${resource}`, `${base}${endpoint}`);
    expect(covers("/mcp", "/mcp/t/acme/crew")).toBe(true);
    expect(covers("/mcp/t/acme", "/mcp/t/acme")).toBe(true);
    expect(covers("/mcp/t/acme", "/mcp/t/acme/crew")).toBe(true);
    expect(covers("/mcp/t/acme", "/mcp/t/acme/core/crew")).toBe(true);
    expect(covers("/mcp/t/acme/crew", "/mcp/t/acme/crew")).toBe(true);
    expect(covers("/mcp/t/acme/crew", "/mcp/t/acme/crew/")).toBe(true);
    expect(covers("/mcp/t/acme/core/crew", "/mcp/t/acme/core/crew")).toBe(true);
    // A product's endpoint has none inside it: below it is another product's address, or nothing.
    expect(covers("/mcp/t/acme/crew", "/mcp/t/acme/crew/x")).toBe(false);
    expect(covers("/mcp/t/acme/core/crew", "/mcp/t/acme/core/crew/x")).toBe(false);
    // Never a wider one, a neighbour, another site, or a path that is no endpoint.
    expect(covers("/mcp/t/acme/crew", "/mcp/t/acme")).toBe(false);
    expect(covers("/mcp/t/acme", "/mcp")).toBe(false);
    expect(covers("/mcp/t/acme", "/mcp/t/acme-labs")).toBe(false);
    expect(covers("/mcp/t/acme/crew", "/mcp/t/acme/crewboard")).toBe(false);
    expect(covers("/mcp/elsewhere", "/mcp/elsewhere/x")).toBe(false);
    expect(resourceCovers(`${base}/mcp/t/acme`, "https://elsewhere.example.com/mcp/t/acme")).toBe(false);
  });

  it("is offered to the web app as organization/product for a product's connector", async () => {
    const r = await alice.api("GET", "/api/v1/connect");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mcp_url: `${h.baseUrl}/mcp`, tenant_url_template: `${h.baseUrl}/mcp/t/{tenant}`, bound_url_template: `${h.baseUrl}/mcp/t/{tenant}/{product}` });
  });
});

describe("an address written when products were in teams", () => {
  // Every organization had a team, named Product team, whose slug sat in every product's address.
  const slugOf = (path: string) => path.split("/")[1]!;

  it("reaches the product through MCP as tenant/<anything>/product, and a slug no product has as nothing", async () => {
    const c = await connect("/mcp");
    for (const middle of ["product-team", "whatever-it-was"]) {
      const r = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", product: `${acme}/${middle}/${slugOf(onboarding)}`, params: {} } }));
      expect(r.status, middle).toBe(200);
      expect(r.json.scope.product.path).toBe(onboarding);
      expect(r.json.connector_address).toBeUndefined();
    }
    const missing = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", product: `${acme}/product-team/no-such-product`, params: {} } }));
    expect(missing.status).toBe(404);
    // Someone outside the organization learns nothing by the old address either.
    const outsider = await connect("/mcp", await h.connectAgent(await h.signIn("olaf@example.com", "Olaf Outside"), "Outside agent"));
    const outside = body(await outsider.callTool({ name: "outcomes_read", arguments: { action: "list", product: `${acme}/product-team/${slugOf(onboarding)}`, params: {} } }));
    expect(outside.status).toBe(404);
    expect(JSON.stringify(outside.json)).not.toContain("Onboarding");
    await outsider.close();
    await c.close();
  });

  it("keeps an old product connector's address working, its token too, and tells its agent the new address", async () => {
    const old = `/mcp/t/${acme}/product-team/${slugOf(onboarding)}`;
    const oldToken = await h.connectAgent(alice, "Old product agent", old);
    const c = await connect(old, oldToken);
    expect(c.getInstructions()).toContain(`scoped to the product ${acme}/product-team/${slugOf(onboarding)}`);
    const r = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.scope.product.path).toBe(onboarding);
    expect(r.json.connector_address).toContain(`by the address it had when products were in teams (${acme}/product-team/${slugOf(onboarding)})`);
    expect(r.json.connector_address).toContain(`its address is now ${h.baseUrl}/mcp/t/${onboarding}.`);
    // Still a fence around that one product.
    const other = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", product: billing, params: {} } }));
    expect(other.json.error.code).toBe("outside_connector_scope");
    const list = body(await c.callTool({ name: "products_read", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path)).toEqual([onboarding]);
    await c.close();
    const agents = (await alice.api("GET", "/api/v1/me/agents")).body.items as { client_name: string; reach: Record<string, unknown> }[];
    expect(agents.find((a) => a.client_name === "Old product agent")!.reach).toEqual({ kind: "product", path: `${acme}/product-team/${slugOf(onboarding)}`, name: "Onboarding", tenant_name: "Acme" });
    // The current address answers without the notice.
    const current = await connect(`/mcp/t/${onboarding}`);
    expect(body(await current.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } })).json.connector_address).toBeUndefined();
    await current.close();
  });

  it("reaches a product whose slug the migration changed by the address it had under its team, which the product lists", async () => {
    const billingId = (await alice.api("GET", `/api/v1/p/${billing}`)).body.product_id as string;
    const tenantId = (await h.db.selectFrom("tenants").select("tenant_id").where("slug", "=", acme).executeTakeFirstOrThrow()).tenant_id;
    // As the migration left it where two teams each had a product of this slug: the later one's slug changed.
    await h.db.insertInto("team_addresses").values({ tenant_id: tenantId, team_slug: "research", product_slug: "ledger", product_id: billingId }).execute();
    const c = await connect("/mcp");
    const r = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", product: `${acme}/research/ledger`, params: {} } }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.scope.product.path).toBe(billing);
    // Only under that team: elsewhere the slug names no product.
    expect(body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", product: `${acme}/product-team/ledger`, params: {} } })).status).toBe(404);
    expect(body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", product: `${acme}/ledger`, params: {} } })).status).toBe(404);
    const listed = body(await c.callTool({ name: "products_read", arguments: { action: "list" } })).json.items.find((i: { path: string }) => i.path === billing);
    expect(listed.former_paths).toEqual([`${acme}/research/ledger`]);
    await c.close();

    const old = `/mcp/t/${acme}/research/ledger`;
    const scoped = await connect(old, await h.connectAgent(alice, "Moved product agent", old));
    const viaConnector = body(await scoped.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } }));
    expect(viaConnector.json.scope.product.path).toBe(billing);
    expect(viaConnector.json.connector_address).toContain(`its address is now ${h.baseUrl}/mcp/t/${billing}.`);
    await scoped.close();
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
    showcase = (await alice.api("POST", `/api/v1/tenants/${commons}/products`, { name: "Showcase" })).body.path;
    expect((await alice.api("POST", `/api/v1/p/${showcase}/outcomes`, { title: "Plan the week in ten minutes" })).status).toBe(201);
    expect(await syncExampleTenant(h.db, commons, () => {})).toBe(t.body.tenant.tenant_id);
    gus = await h.signIn("gus@guest.example", "Gus Guest");
    dee = await h.signIn("dee@own.example", "Dee Own");
    const d = await dee.api("POST", "/api/v1/tenants", { name: "Solo" });
    solo = (await dee.api("POST", `/api/v1/tenants/${d.body.tenant.slug}/products`, { name: "Only one" })).body.path;
  });
  afterAll(async () => {
    await syncExampleTenant(h.db, null, () => {});
  });

  it("is reached through the unscoped connector, listed and read there, and refuses every write", async () => {
    const c = await connect("/mcp", await h.connectAgent(gus, "Guest agent"));
    expect(c.getInstructions()).toContain("example organization");
    const list = body(await c.callTool({ name: "products_read", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path)).toEqual([showcase]);
    expect(list.items[0]).toMatchObject({ tenant: { slug: commons, example: true }, your_role: "guest" });
    expect(list.tenants).toEqual([expect.objectContaining({ slug: commons, example: true, your_role: "guest" })]);
    expect(list.public_sandboxes).toBeUndefined();
    const read = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", product: showcase, params: {} } }));
    expect(read.status).toBe(200);
    expect(read.json.scope).toMatchObject({ example: true, your_role: "guest" });
    const write = body(await c.callTool({ name: "outcomes_write", arguments: { action: "create", product: showcase, params: { title: "Not here" } } }));
    expect(write.status).toBe(403);
    expect(write.json.error.code).toBe("example_read_only");
    expect(write.json.error.message).toMatch(/create an organization of your own/);
    // Someone with no product of their own is asked which product: the example's are never picked by themselves.
    expect(body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } })).json.error.code).toBe("product_required");
    await c.close();
  });

  it("is never picked as the product a call means when the person has one of their own", async () => {
    const c = await connect("/mcp", await h.connectAgent(dee, "Own agent"));
    const list = body(await c.callTool({ name: "products_read", arguments: { action: "list" } })).json;
    expect(list.items.map((i: { path: string }) => i.path).sort()).toEqual([showcase, solo].sort());
    const unnamed = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } }));
    expect(unnamed.status).toBe(200);
    expect(unnamed.json.scope.product.path).toBe(solo);
    await c.close();
  });

  it("works through its own connector, which picks its product by itself", async () => {
    const c = await connect(`/mcp/t/${commons}`, await h.connectAgent(gus, "Guest example agent", `/mcp/t/${commons}`));
    const read = body(await c.callTool({ name: "outcomes_read", arguments: { action: "list", params: {} } }));
    expect(read.status).toBe(200);
    expect(read.json.scope.product.path).toBe(showcase);
    const limits = body(await c.callTool({ name: "products_read", arguments: { action: "limits", params: {} } }));
    expect(limits.json).toMatchObject({ organization: { slug: commons }, you_meet_them: "calls_per_minute_only" });
    await c.close();
  });

  it("is named on the consent page and in the connected agents as reached like every other product", async () => {
    const agents = (await gus.api("GET", "/api/v1/me/agents")).body.items as { client_name: string; reach: unknown }[];
    expect(agents.find((a) => a.client_name === "Guest agent")!.reach).toEqual({ kind: "all" });
  });
});
