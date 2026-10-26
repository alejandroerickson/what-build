import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An agent is offered what the person could do, as the web app shows them only that. The instance
// owners' actions are listed to them alone. A connector scoped to an organization or a product
// lists only what its fence answers and what the person's roles inside it reach. A call to what a
// connection is not offered is still answered with what it needs, never as unknown.

let h: Harness;
let root: Browser; // owns this WhatBuild
let olive: Browser; // owns the organization
let vic: Browser; // a viewer of one product
let rita: Browser; // a reader of one product
let eddie: Browser; // an editor of the team
let paula: Browser; // an admin of one product, and nothing more
let org: string;
let path: string;

const INSTANCE_ACTIONS = ["usage", "organizations", "set_limits", "accounts", "tenant_allowances", "set_tenant_allowance", "remove_tenant_allowance"];

function result(r: unknown): { status: number; json: any } {
  const t = (r as { content: { text: string }[] }).content[0]!.text;
  if (t.startsWith("{")) return { status: 200, json: JSON.parse(t) };
  return { status: Number(t.slice(0, 3)), json: JSON.parse(t.slice(t.indexOf("\n") + 1)) };
}

async function connect(token: string, at = "/mcp") {
  const client = new Client({ name: "tool-list-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}${at}`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

/** Every action the connection is offered, as tool.action, and each tool's description. */
async function offered(client: Client): Promise<{ actions: string[]; descriptions: Record<string, string> }> {
  const { tools } = await client.listTools();
  const actions = tools.flatMap((t) => {
    const action = t.inputSchema.properties?.["action"] as { enum?: string[] } | undefined;
    return action?.enum ? action.enum.map((a) => `${t.name}.${a}`) : [t.name];
  });
  return { actions, descriptions: Object.fromEntries(tools.map((t) => [t.name, t.description ?? ""])) };
}

async function offeredAt(browser: Browser, at: string, level: "viewer" | "editor" | "admin" = "admin") {
  const client = await connect(await h.connectAgent(browser, `Agent at ${at} (${level})`, at, level), at);
  const list = await offered(client);
  await client.close();
  return list.actions;
}

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["root@example.com"] });
  root = await h.signIn("root@example.com", "Root");
  olive = await h.signIn("olive@example.com", "Olive");
  const t = await olive.api("POST", "/api/v1/tenants", { name: "Orchard" });
  org = t.body.tenant.slug;
  const made = await olive.api("POST", `/api/v1/teams/${org}/${t.body.team.slug}/products`, { name: "Harvest" });
  path = made.body.path;
  const product = path.split("/")[2]!;
  await olive.api("POST", `/api/v1/tenants/${org}/members`, { team: t.body.team.slug, product, email: "vic@example.com", role: "viewer" });
  await olive.api("POST", `/api/v1/tenants/${org}/members`, { team: t.body.team.slug, product, email: "rita@example.com", role: "reader" });
  await olive.api("POST", `/api/v1/tenants/${org}/members`, { team: t.body.team.slug, email: "eddie@example.com", role: "editor" });
  await olive.api("POST", `/api/v1/tenants/${org}/members`, { team: t.body.team.slug, product, email: "paula@example.com", role: "admin" });
  vic = await h.signIn("vic@example.com", "Vic");
  rita = await h.signIn("rita@example.com", "Rita");
  eddie = await h.signIn("eddie@example.com", "Eddie");
  paula = await h.signIn("paula@example.com", "Paula");
});
afterAll(async () => h?.close());

describe("the instance owners' actions", () => {
  it("are listed to an owner of this WhatBuild, as far as the connection's level allows", async () => {
    const client = await connect(await h.connectAgent(root, "Root's agent"));
    const { actions, descriptions } = await offered(client);
    for (const a of INSTANCE_ACTIONS) expect(actions, a).toContain(`products.${a}`);
    // Removing an account is done only in the web app.
    expect(actions).not.toContain("products.remove_account");
    expect(descriptions["products"]).toContain("As an owner of this WhatBuild");
    expect(result(await client.callTool({ name: "products", arguments: { action: "usage", params: { days: 1 } } })).status).toBe(200);
    await client.close();
    const editing = await offeredAt(root, "/mcp", "editor");
    expect(editing).toContain("products.organizations");
    for (const a of ["set_limits", "set_tenant_allowance", "remove_tenant_allowance"]) expect(editing, a).not.toContain(`products.${a}`);
  });

  it("are neither listed nor named to anyone else, whose call is refused as before", async () => {
    const client = await connect(await h.connectAgent(olive, "Olive's agent"));
    const { actions, descriptions } = await offered(client);
    for (const a of INSTANCE_ACTIONS) expect(actions, a).not.toContain(`products.${a}`);
    expect(actions).toContain("products.limits");
    expect(descriptions["products"]).not.toMatch(/allowances|every account|how it is used/);
    // Called anyway, from what the skill says, it is refused for what it needs: an unknown action would mean an old tool list.
    const usage = result(await client.callTool({ name: "products", arguments: { action: "usage", params: { days: 1 } } }));
    expect(usage.status).toBe(403);
    expect(usage.json.error.message).toContain("Only an owner of this WhatBuild instance");
    expect(result(await client.callTool({ name: "products", arguments: { action: "organizations", describe: true } })).json.action).toBe("organizations");
    const unknown = result(await client.callTool({ name: "products", arguments: { action: "explode" } }));
    expect(unknown.json.error.code).toBe("unknown_action");
    for (const a of INSTANCE_ACTIONS) expect(unknown.json.error.details.actions, a).not.toContain(a);
    await client.close();
  });
});

describe("a connector scoped to a product", () => {
  it("lists a viewer's reads, and what the fence answers, but no write", async () => {
    const actions = await offeredAt(vic, `/mcp/t/${path}`);
    expect(actions).toEqual(expect.arrayContaining(["sources.list", "search", "story.list_pages", "products.list", "products.limits", "get_skill"]));
    for (const a of ["sources.create", "outcomes.create", "story.publish", "sources.delete", "products.create_tenant", "members.list", "members.grant", "sources.move_to_product"])
      expect(actions, a).not.toContain(a);
  });

  it("lists a reader only the Story", async () => {
    const actions = await offeredAt(rita, `/mcp/t/${path}`);
    expect(actions).toEqual(expect.arrayContaining(["story.list_pages", "story.get_page"]));
    for (const a of ["sources.list", "search", "outcomes.list", "assumptions.list", "mockups.list", "story.guidance", "activity.list"]) expect(actions, a).not.toContain(a);
  });

  it("lists an admin what the connection's level allows", async () => {
    const admin = await offeredAt(olive, `/mcp/t/${path}`);
    expect(admin).toEqual(expect.arrayContaining(["sources.create", "sources.delete"]));
    const editing = await offeredAt(olive, `/mcp/t/${path}`, "editor");
    expect(editing).toContain("sources.create");
    expect(editing).not.toContain("sources.delete");
  });

  it("still tells a call beyond the person's role what it needs", async () => {
    const at = `/mcp/t/${path}`;
    const client = await connect(await h.connectAgent(vic, "Vic's agent", at, "editor"), at);
    const r = result(await client.callTool({ name: "sources", arguments: { action: "create", params: { title: "Not Vic's to add" } } }));
    expect(r.status).toBe(403);
    expect(r.json.error.message).toContain("needs editor");
    await client.close();
  });
});

describe("a connector scoped to an organization", () => {
  it("lists the highest role the person holds anywhere in it", async () => {
    const actions = await offeredAt(eddie, `/mcp/t/${org}`);
    expect(actions).toEqual(expect.arrayContaining(["sources.create", "members.list"]));
    // An editor deletes nothing, manages nobody, and the organization's own administration is its admins'.
    for (const a of ["sources.delete", "members.grant", "members.revoke", "members.cancel_invitation", "members.activity", "products.create", "products.create_team"]) expect(actions, a).not.toContain(a);
    const owner = await offeredAt(olive, `/mcp/t/${org}`);
    expect(owner).toEqual(expect.arrayContaining(["sources.delete", "members.activity", "members.grant", "products.create", "products.create_team", "products.rename_tenant"]));
  });

  it("lists a product's admin its people to manage, but no product of their own to make", async () => {
    const actions = await offeredAt(paula, `/mcp/t/${org}`);
    expect(actions).toEqual(expect.arrayContaining(["sources.delete", "members.list", "members.grant", "members.revoke"]));
    // A team's admin creates its products; a product's grant reaches no team.
    for (const a of ["products.create", "products.create_team", "members.activity"]) expect(actions, a).not.toContain(a);
  });

  it("lists a reader none of the organization's people", async () => {
    const actions = await offeredAt(rita, `/mcp/t/${org}`);
    expect(actions).toEqual(expect.arrayContaining(["story.list_pages", "products.limits"]));
    for (const a of ["members.list", "sources.list", "search"]) expect(actions, a).not.toContain(a);
  });

  it("lists an instance owner none of their own actions, and refuses them", async () => {
    const t = await root.api("POST", "/api/v1/tenants", { name: "Root's own" });
    const at = `/mcp/t/${t.body.tenant.slug}`;
    const client = await connect(await h.connectAgent(root, "Root's scoped agent", at), at);
    const { actions } = await offered(client);
    for (const a of INSTANCE_ACTIONS) expect(actions, a).not.toContain(`products.${a}`);
    const r = result(await client.callTool({ name: "products", arguments: { action: "usage", params: { days: 1 } } }));
    expect(r.json.error.code).toBe("outside_connector_scope");
    await client.close();
  });
});

describe("a connector scoped to a product of the example organization", () => {
  let example: string;
  let gus: Browser; // holds no grant there: its guest
  beforeAll(async () => {
    const t = await root.api("POST", "/api/v1/tenants", { name: "Exemplar" });
    example = (await root.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Showcase" })).body.path;
    await syncExampleTenant(h.db, t.body.tenant.slug, () => {});
    gus = await h.signIn("gus@guest.example", "Gus Guest");
  });

  it("lists its guest every read and no write", async () => {
    const actions = await offeredAt(gus, `/mcp/t/${example}`);
    expect(actions).toEqual(expect.arrayContaining(["sources.list", "search", "story.list_pages", "outcomes.list"]));
    for (const a of ["sources.create", "sources.annotate", "outcomes.create", "story.publish"]) expect(actions, a).not.toContain(a);
    // Feedback is the person's own, whatever their role.
    expect(actions).toContain("submit_feedback");
  });
});
