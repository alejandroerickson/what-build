import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An agent is offered what the person could do, as the web app shows them only that. The instance
// owners' actions are listed to them alone, and called by anyone else are unknown. A connector
// scoped to an organization or a product lists only what its fence answers and what the person's
// role inside it reaches, capped by the connection's level.

let h: Harness;
let root: Browser; // owns this WhatBuild
let olive: Browser; // owns the organization
let vic: Browser; // a viewer of one product
let rita: Browser; // a reader of one product
let eddie: Browser; // an editor of the team
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
  vic = await h.signIn("vic@example.com", "Vic");
  rita = await h.signIn("rita@example.com", "Rita");
  eddie = await h.signIn("eddie@example.com", "Eddie");
});
afterAll(async () => h?.close());

describe("the instance owners' actions", () => {
  it("are listed to an owner of this WhatBuild", async () => {
    const client = await connect(await h.connectAgent(root, "Root's agent"));
    const { actions, descriptions } = await offered(client);
    for (const a of INSTANCE_ACTIONS) expect(actions, a).toContain(`products.${a}`);
    // Removing an account is done in the web app, by anyone.
    expect(actions).not.toContain("products.remove_account");
    expect(descriptions["products"]).toContain("as an owner of this WhatBuild");
    expect(result(await client.callTool({ name: "products", arguments: { action: "usage", params: { days: 1 } } })).status).toBe(200);
    await client.close();
  });

  it("are neither listed, described nor known to an organization's owner", async () => {
    const client = await connect(await h.connectAgent(olive, "Olive's agent"));
    const { actions, descriptions } = await offered(client);
    for (const a of INSTANCE_ACTIONS) expect(actions, a).not.toContain(`products.${a}`);
    expect(actions).toContain("products.limits");
    expect(descriptions["products"]).not.toMatch(/allowances|every account|how it is used/);
    for (const args of [{ action: "usage", params: { days: 1 } }, { action: "organizations", describe: true }]) {
      const r = result(await client.callTool({ name: "products", arguments: args }));
      expect(r.json.error.code, args.action).toBe("unknown_action");
      expect(r.json.error.details.actions).not.toContain(args.action);
    }
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
    for (const a of ["sources.list", "search", "outcomes.list", "assumptions.list", "mockups.list", "story.guidance"]) expect(actions, a).not.toContain(a);
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
    // An editor deletes nothing, and the organization's own administration is its admins'.
    for (const a of ["sources.delete", "members.activity", "products.create_tenant"]) expect(actions, a).not.toContain(a);
    const owner = await offeredAt(olive, `/mcp/t/${org}`);
    expect(owner).toEqual(expect.arrayContaining(["sources.delete", "members.activity", "members.grant"]));
  });

  it("lists an instance owner none of their own actions, which it refuses", async () => {
    const t = await root.api("POST", "/api/v1/tenants", { name: "Root's own" });
    const actions = await offeredAt(root, `/mcp/t/${t.body.tenant.slug}`);
    for (const a of INSTANCE_ACTIONS) expect(actions, a).not.toContain(`products.${a}`);
  });
});
