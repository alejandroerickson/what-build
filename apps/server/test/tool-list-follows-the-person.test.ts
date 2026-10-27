import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connectorOffers, levelAllows, OPERATIONS, reachesAnywhere, roleReaches, type ConnectionLevel, type ConnectorScope, type OperationDef, type Standing } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { toolDefinitions } from "../src/mcp.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An agent is offered what the person could do, as the web app shows them only that. The instance
// owners' actions are listed to them alone. A connector scoped to an organization or a product
// lists only what its fence answers and what the person's roles inside it reach; the unscoped one,
// what their roles in any organization they are in reach, unless they may start an organization.
// A call to what a connection is not offered is still answered with what it needs, never as
// unknown, and no tool's description speaks of what it does not offer.

let h: Harness;
let root: Browser; // owns this WhatBuild
let olive: Browser; // owns the organization
let vic: Browser; // a viewer of one product
let rita: Browser; // a reader of one product
let eddie: Browser; // an editor of the team
let paula: Browser; // an admin of one product, and nothing more
let org: string;
let path: string;

const INSTANCE_ACTIONS = ["usage", "organizations", "set_plan", "set_plan_limits", "guests", "set_guests", "accounts", "tenant_allowances", "set_tenant_allowance", "remove_tenant_allowance"];

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

/** Every action the connection is offered, as noun.action (`sources.list`, in sources_read), and each tool's description. */
async function offered(client: Client): Promise<{ actions: string[]; descriptions: Record<string, string> }> {
  const { tools } = await client.listTools();
  const actions = tools.flatMap((t) => {
    const action = t.inputSchema.properties?.["action"] as { enum?: string[] } | undefined;
    return action?.enum ? action.enum.map((a) => `${t.name.replace(/_(read|write|delete)$/, "")}.${a}`) : [t.name];
  });
  return { actions, descriptions: Object.fromEntries(tools.map((t) => [t.name, t.description ?? ""])) };
}

async function offeredAt(browser: Browser, at: string, level: "viewer" | "editor" | "admin" = "admin") {
  return (await offeredWith(browser, at, level)).actions;
}

async function offeredWith(browser: Browser, at: string, level: "viewer" | "editor" | "admin" = "admin") {
  const client = await connect(await h.connectAgent(browser, `Agent at ${at} (${level})`, at, level), at);
  const list = await offered(client);
  await client.close();
  return list;
}

/** The operation an offered `tool.action`, or a standalone tool, is. */
function operationOf(action: string): OperationDef {
  const [tool, name] = action.split(".");
  return OPERATIONS.find((o) => o.mcp.tool === tool && o.mcp.action === name)!;
}

/** Every action a connection at this level is offered when nothing but its level and the instance owners' own actions narrow it. */
const everythingAt = (level: ConnectionLevel) =>
  OPERATIONS.filter((o) => !o.webOnly && !o.instanceOwnersOnly && levelAllows(level, o)).map((o) => (o.mcp.action ? `${o.mcp.tool}.${o.mcp.action}` : o.mcp.tool)).sort();

/** Let the person start no organization, whatever the default. */
async function noAllowance(email: string) {
  expect((await root.api("PUT", "/api/v1/tenant-allowances", { email, allowed: 0, notify: false })).status).toBe(200);
}

/** What a tool's description says it does: before the pointer to describe and the list of actions. */
const said = (description: string) => description.slice(0, description.indexOf("\nActions:")).split(" Pick an action;")[0]!;

/** Each of a tool's actions its description speaks of by name (`set_style`, or `set style`), though the connection is not offered it. */
function unofferedNamed(tool: string, description: string, offeredActions: string[]): string[] {
  const prose = said(description);
  const all = toolDefinitions().groups.get(tool)!.map((o) => o.mcp.action!);
  return all
    .filter((a) => !offeredActions.includes(a))
    .filter((a) => new RegExp(`\\b(${a}|${a.replace(/_/g, " ")})\\b`, "i").test(prose));
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
    expect(descriptions["products_read"]).toContain("As an owner of this WhatBuild");
    expect(descriptions["products_write"]).toContain("As an owner of this WhatBuild");
    expect(result(await client.callTool({ name: "products_read", arguments: { action: "usage", params: { days: 1 } } })).status).toBe(200);
    await client.close();
    const editing = await offeredAt(root, "/mcp", "editor");
    expect(editing).toContain("products.organizations");
    for (const a of ["set_plan", "set_tenant_allowance", "remove_tenant_allowance"]) expect(editing, a).not.toContain(`products.${a}`);
  });

  it("are neither listed nor named to anyone else, whose call is refused as before", async () => {
    const client = await connect(await h.connectAgent(olive, "Olive's agent"));
    const { actions, descriptions } = await offered(client);
    for (const a of INSTANCE_ACTIONS) expect(actions, a).not.toContain(`products.${a}`);
    expect(actions).toContain("products.limits");
    expect(said(descriptions["products_read"]!) + said(descriptions["products_write"]!)).not.toMatch(/allowances|every account|how it is used/);
    // Called anyway, from what the guide says, it is refused for what it needs: an unknown action would mean an old tool list.
    const usage = result(await client.callTool({ name: "products_read", arguments: { action: "usage", params: { days: 1 } } }));
    expect(usage.status).toBe(403);
    expect(usage.json.error.message).toContain("Only an owner of this WhatBuild instance");
    expect(result(await client.callTool({ name: "products_read", arguments: { action: "organizations", describe: true } })).json.action).toBe("organizations");
    const unknown = result(await client.callTool({ name: "products_read", arguments: { action: "explode" } }));
    expect(unknown.json.error.code).toBe("unknown_action");
    for (const a of INSTANCE_ACTIONS) expect(unknown.json.error.details.actions, a).not.toContain(a);
    await client.close();
  });
});

describe("a connector scoped to a product", () => {
  it("lists a viewer's reads, and what the fence answers, but no write", async () => {
    const actions = await offeredAt(vic, `/mcp/t/${path}`);
    expect(actions).toEqual(expect.arrayContaining(["sources.list", "search", "story.list_pages", "products.list", "products.limits", "guide"]));
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
    const r = result(await client.callTool({ name: "sources_write", arguments: { action: "create", params: { title: "Not Vic's to add" } } }));
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
    const r = result(await client.callTool({ name: "products_read", arguments: { action: "usage", params: { days: 1 } } }));
    expect(r.json.error.code).toBe("outside_connector_scope");
    await client.close();
  });
});

describe("the unscoped connector, for someone who may start no organization", () => {
  beforeAll(async () => {
    for (const email of ["rita@example.com", "eddie@example.com"]) await noAllowance(email);
  });

  it("lists a reader everywhere the Story and the account's own reads", async () => {
    const actions = await offeredAt(rita, "/mcp");
    expect(actions).toEqual(expect.arrayContaining(["story.list_pages", "story.get_page", "story.get_hierarchy", "products.list", "products.get", "products.limits", "guide"]));
    for (const a of ["sources.list", "search", "outcomes.list", "mockups.list", "members.list", "story.guidance", "products.update_concept", "products.create_tenant", "products.create", "sources.create"])
      expect(actions, a).not.toContain(a);
    // Only the Story's reads, the account's own reads (and its feedback), and the organization's limits.
    for (const a of actions) {
      const op = operationOf(a);
      expect(op.access === "story" || (op.scope === "account" && (!op.mutates || op.name === "submit_feedback")) || op.name === "products.limits", a).toBe(true);
    }
  });

  it("lists an editor somewhere their writes, and no one to manage, no product to make and no organization to start", async () => {
    const actions = await offeredAt(eddie, "/mcp");
    expect(actions).toEqual(expect.arrayContaining(["sources.create", "outcomes.create", "products.update_concept", "story.publish", "members.list"]));
    for (const a of ["members.grant", "members.revoke", "members.activity", "sources.delete", "products.create", "products.create_team", "products.create_tenant"]) expect(actions, a).not.toContain(a);
  });

  it("still tells a call beyond the person's role what it needs, never that it is unknown", async () => {
    const client = await connect(await h.connectAgent(rita, "Rita's agent"));
    const list = result(await client.callTool({ name: "sources_read", arguments: { action: "list", product: path, params: {} } }));
    expect(list.status).toBe(403);
    expect(list.json.error.message).toContain("needs viewer");
    const start = result(await client.callTool({ name: "products_write", arguments: { action: "create_tenant", params: { name: "Not Rita's" } } }));
    expect(start.status).toBe(403);
    expect(start.json.error.code).toBe("tenant_allowance");
    await client.close();
  });
});

describe("the unscoped connector, for someone who may start an organization", () => {
  it("lists everything the connection's level allows, whatever their role", async () => {
    // Vic views one product, and may start an organization and work in it in the same session.
    expect((await offeredAt(vic, "/mcp")).sort()).toEqual(everythingAt("admin"));
    expect((await offeredAt(vic, "/mcp", "editor")).sort()).toEqual(everythingAt("editor"));
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

  it("lists its guest no write on the unscoped connector when they may start no organization", async () => {
    const gail = await h.signIn("gail@guest.example", "Gail Guest");
    await noAllowance("gail@guest.example");
    const actions = await offeredAt(gail, "/mcp");
    expect(actions).toEqual(expect.arrayContaining(["products.list", "sources.list", "search", "story.list_pages", "outcomes.list", "submit_feedback"]));
    for (const a of actions) expect(!operationOf(a).mutates || a === "submit_feedback", a).toBe(true);
    // A guest who may start one is offered it all, to work in the organization they create.
    expect(await offeredAt(gus, "/mcp")).toEqual(expect.arrayContaining(["products.create_tenant", "sources.create"]));
  });

  it("tells its guest their role, and where their own work goes when a write is refused", async () => {
    const gail = await h.signIn("gail@guest.example", "Gail Guest");
    const client = await connect(await h.connectAgent(gail, "Gail's agent"));
    const list = result(await client.callTool({ name: "products_read", arguments: { action: "list" } })).json;
    expect(list.items.find((i: { path: string }) => i.path === example)).toMatchObject({ your_role: "guest", tenant: { example: true } });
    const read = result(await client.callTool({ name: "outcomes_read", arguments: { action: "list", product: example, params: {} } }));
    expect(read.json.scope).toMatchObject({ your_role: "guest", example: true });
    const write = result(await client.callTool({ name: "sources_write", arguments: { action: "create", product: example, params: { title: "Not here" } } }));
    expect(write.status).toBe(403);
    expect(write.json.error.code).toBe("example_read_only");
    expect(write.json.error.message).toMatch(/may not start an organization: for one of your own, ask whoever runs this WhatBuild/);
    expect(write.json.error.message).not.toMatch(/create an organization of your own/);
    await client.close();
    const able = await connect(await h.connectAgent(gus, "Gus's agent"));
    const refused = result(await able.callTool({ name: "sources_write", arguments: { action: "create", product: example, params: { title: "Not here" } } }));
    expect(refused.json.error.message).toMatch(/create an organization of your own: products_write\(action="create_tenant"\)/);
    await able.close();
  });
});

describe("each tool's description", () => {
  const levels: ConnectionLevel[] = ["viewer", "editor", "admin"];
  const standings: Record<string, Standing> = {
    "a product's reader": { role: "reader", teamRole: null, tenantRole: null },
    "a product's viewer": { role: "viewer", teamRole: null, tenantRole: null },
    "a product's editor": { role: "editor", teamRole: null, tenantRole: null },
    "a product's admin": { role: "admin", teamRole: null, tenantRole: null },
    "a team's editor": { role: "editor", teamRole: "editor", tenantRole: null },
    "a team's admin": { role: "admin", teamRole: "admin", tenantRole: null },
    "an organization's admin": { role: "admin", teamRole: "admin", tenantRole: "admin" },
    "an organization's owner": { role: "admin", teamRole: "admin", tenantRole: "owner" },
    "a guest of the example": { role: "viewer", teamRole: "viewer", tenantRole: "guest" },
  };
  const fence = (product: boolean, standing: Standing): ConnectorScope => ({
    tenant: { tenant_id: "t", slug: "acme", name: "Acme" },
    product: product ? { product_id: "p", path: "acme/core/crewboard", name: "Crewboard" } : null,
    standing,
  });

  it("names no action the connection is not offered, for every level and role", () => {
    const lists: [string, (op: OperationDef) => boolean][] = [];
    for (const level of levels) {
      const allowed = (op: OperationDef) => levelAllows(level, op) && !op.instanceOwnersOnly;
      lists.push([`${level}, unnarrowed`, allowed], [`${level}, an instance owner`, (op) => levelAllows(level, op)]);
      for (const [who, standing] of Object.entries(standings)) {
        lists.push([`${level}, ${who}, unscoped`, (op) => allowed(op) && reachesAnywhere(op, [standing])]);
        for (const product of [true, false]) {
          const f = fence(product, standing);
          lists.push([`${level}, ${who}, scoped to ${product ? "a product" : "an organization"}`, (op) => allowed(op) && connectorOffers(f, op) && roleReaches(op, standing)]);
        }
      }
    }
    for (const [what, keep] of lists) {
      for (const [tool, ops] of toolDefinitions(keep).groups) {
        const description = toolDefinitions(keep).tools.find((t) => t.name === tool)!.description;
        expect(unofferedNamed(tool, description, ops.map((o) => o.mcp.action!)), `${tool}, ${what}`).toEqual([]);
      }
    }
  });

  it("says nothing of granting or inviting to an Edit connection, which may only list the people", async () => {
    const { actions, descriptions } = await offeredWith(olive, "/mcp", "editor");
    expect(actions.filter((a) => a.startsWith("members."))).toEqual(["members.list"]);
    expect(said(descriptions["members_read"]!)).not.toMatch(/grant|revoke|invit/i);
    expect(descriptions["members_write"]).toBeUndefined();
    expect((await offeredWith(olive, "/mcp", "admin")).descriptions["members_write"]).toMatch(/Grant or revoke roles/);
  });

  it("says nothing of publishing or the style's guidance to a reader, nor of writing to a viewer", async () => {
    const reader = (await offeredWith(rita, `/mcp/t/${path}`)).descriptions;
    expect(said(reader["story_read"]!)).not.toMatch(/publish|set_style|guidance|notes for agents/i);
    expect(reader["story_write"]).toBeUndefined();
    const viewer = (await offeredWith(vic, `/mcp/t/${path}`)).descriptions;
    for (const tool of ["sources_write", "attachments_write", "story_write"]) expect(viewer[tool], tool).toBeUndefined();
    expect(said(viewer["sources_read"]!)).not.toMatch(/create/i);
    expect(said(viewer["story_read"]!)).toMatch(/get_style/);
    expect(said(viewer["story_read"]!)).not.toMatch(/set_style|publish/);
  });
});
