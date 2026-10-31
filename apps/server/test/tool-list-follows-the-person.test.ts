import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connectorOffers, levelAllows, OPERATIONS, reachesAnywhere, roleReaches, type ConnectionLevel, type ConnectorScope, type OperationDef, type Standing } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { toolDefinitions } from "../src/mcp.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An agent is offered what the person could do, as the web app shows them only that. Running the
// instance is the web app's alone, so no connection lists the instance owners' actions, theirs
// included. A connector scoped to an organization or a product lists only what its fence answers
// and what the person's roles inside it reach; the unscoped one, what their roles in any
// organization they are in reach, unless they may start an organization. A call to what a
// connection is not offered is still answered with what it needs, or where a person does it, never
// as unknown, and no tool's description speaks of what it does not offer.

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
    return action?.enum ? action.enum.map((a) => `${t.name.replace(/_(read|write|delete|export)$/, "")}.${a}`) : [t.name];
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

/** Every action a connection at this level is offered when nothing but its level narrows it. */
const everythingAt = (level: ConnectionLevel) =>
  OPERATIONS.filter((o) => !o.webOnly && levelAllows(level, o)).map((o) => (o.mcp.action ? `${o.mcp.tool}.${o.mcp.action}` : o.mcp.tool)).sort();

/** Let the person start no organization, whatever the default. */
async function noAllowance(email: string) {
  expect((await root.api("PUT", "/api/v1/tenant-allowances", { email, allowed: 0, notify: false })).status).toBe(200);
}

/** What a tool's description says it does: before the pointer to describe and the list of actions. */
const said = (description: string) => description.slice(0, description.indexOf("\nActions:")).split(" Pick an action;")[0]!;

const EVERY_TOOL = toolDefinitions();

/** Each of a tool's actions its description speaks of by name (`set_style`, or `set style`), though the connection is not offered it. */
function unofferedNamed(tool: string, description: string, offeredActions: string[]): string[] {
  const prose = said(description);
  const all = EVERY_TOOL.groups.get(tool)!.map((o) => o.mcp.action!);
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
  it("are listed to no connection, an owner of this WhatBuild's included, at any level", async () => {
    for (const level of ["viewer", "editor", "admin"] as const) {
      const { actions, descriptions } = await offeredWith(root, "/mcp", level);
      for (const a of [...INSTANCE_ACTIONS, "remove_account"]) expect(actions, `${level} ${a}`).not.toContain(`products.${a}`);
      expect(said(descriptions["products_read"]!) + said(descriptions["products_write"] ?? ""), level).not.toMatch(/owner of this WhatBuild|allowances|every account|how it is used/);
    }
    // What the person's roles reach is not narrowed: an instance owner may start an organization.
    expect((await offeredAt(root, "/mcp")).sort()).toEqual(everythingAt("admin"));
  });

  it("are refused, called anyway, with where a person does them, never as unknown", async () => {
    for (const who of [root, olive]) {
      const client = await connect(await h.connectAgent(who, "An agent told of the instance's actions"));
      const usage = result(await client.callTool({ name: "products_read", arguments: { action: "usage", params: { days: 1 } } }));
      expect(usage.status).toBe(403);
      expect(usage.json.error).toMatchObject({ code: "web_only", details: { operation: "products.usage" } });
      expect(usage.json.error.message).toContain("usage report, `pnpm usage`");
      const move = result(await client.callTool({ name: "products_write", arguments: { action: "set_plan", params: { tenant: org, plan: "unlimited" } } }));
      expect(move.json.error.code).toBe("web_only");
      expect(move.json.error.message).toMatch(/^No agent is offered products_write\(action="set_plan"\): a person does it in the web app, on Organizations \(`\/instance`\), Change plan on the organization's row\. .*Nothing was changed\.$/);
      // Not a sign of an older tool list, so nothing sends the person to start a new session.
      expect(move.json.error.message).not.toMatch(/new session|restart/);
      // Nor described, nor told to move to another tool.
      expect(result(await client.callTool({ name: "products_read", arguments: { action: "organizations", describe: true } })).json.error.code).toBe("web_only");
      const elsewhere = result(await client.callTool({ name: "products_read", arguments: { action: "set_guests", params: {} } }));
      expect(elsewhere.json.error.code).toBe("web_only");
      // It names the call as it was made: no tool holds the action, so another tool's name would mislead.
      expect(elsewhere.json.error.message).toMatch(/^No agent is offered products_read\(action="set_guests"\): /);
      expect(elsewhere.json.error.message).not.toContain("products_write");
      const readInWrite = result(await client.callTool({ name: "products_write", arguments: { action: "usage", params: { days: 1 } } }));
      expect(readInWrite.json.error.message).toMatch(/^No agent is offered products_write\(action="usage"\): /);
      const deleteInExport = result(await client.callTool({ name: "products_export", arguments: { action: "delete_tenant", params: {} } }));
      expect(deleteInExport.json.error.code).toBe("web_only");
      expect(deleteInExport.json.error.message).toMatch(/^No agent is offered products_export\(action="delete_tenant"\): /);
      const unknown = result(await client.callTool({ name: "products_read", arguments: { action: "explode" } }));
      expect(unknown.json.error.code).toBe("unknown_action");
      for (const a of INSTANCE_ACTIONS) expect(unknown.json.error.details.actions, a).not.toContain(a);
      await client.close();
    }
    // The web app still does all of it.
    expect((await root.api("GET", "/api/v1/organizations")).status).toBe(200);
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
    // Search is listed: for a reader it reads only the Story.
    expect(actions).toContain("search");
    for (const a of ["sources.list", "outcomes.list", "assumptions.list", "mockups.list", "story.guidance", "activity.list"]) expect(actions, a).not.toContain(a);
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
    for (const a of ["sources.delete", "members.grant", "members.grant_many", "members.revoke", "members.cancel_invitation", "members.activity", "products.create", "products.create_team"]) expect(actions, a).not.toContain(a);
    const owner = await offeredAt(olive, `/mcp/t/${org}`);
    expect(owner).toEqual(expect.arrayContaining(["sources.delete", "members.activity", "members.grant", "products.create", "products.create_team"]));
    // Renaming the organization is its owners', in the web app.
    for (const a of ["products.rename_tenant", "products.update"]) expect(owner, a).not.toContain(a);
  });

  it("lists a product's admin its people to manage, but no product of their own to make", async () => {
    const actions = await offeredAt(paula, `/mcp/t/${org}`);
    expect(actions).toEqual(expect.arrayContaining(["sources.delete", "members.list", "members.grant", "members.grant_many", "members.revoke"]));
    // A team's admin creates its products; a product's grant reaches no team.
    for (const a of ["products.create", "products.create_team", "members.activity"]) expect(actions, a).not.toContain(a);
  });

  it("lists a reader none of the organization's people", async () => {
    const actions = await offeredAt(rita, `/mcp/t/${org}`);
    expect(actions).toEqual(expect.arrayContaining(["story.list_pages", "products.limits"]));
    for (const a of ["members.list", "sources.list"]) expect(actions, a).not.toContain(a);
  });

  it("lists an instance owner none of their own actions, and refuses them with where they are", async () => {
    const t = await root.api("POST", "/api/v1/tenants", { name: "Root's own" });
    const at = `/mcp/t/${t.body.tenant.slug}`;
    const client = await connect(await h.connectAgent(root, "Root's scoped agent", at), at);
    const { actions } = await offered(client);
    for (const a of INSTANCE_ACTIONS) expect(actions, a).not.toContain(`products.${a}`);
    const r = result(await client.callTool({ name: "products_read", arguments: { action: "usage", params: { days: 1 } } }));
    expect(r.json.error.code).toBe("web_only");
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
    for (const a of ["sources.list", "outcomes.list", "mockups.list", "members.list", "story.guidance", "products.update_concept", "products.create_tenant", "products.create", "sources.create"])
      expect(actions, a).not.toContain(a);
    // Only the Story's reads, the account's own reads (and its feedback), and the organization's limits.
    for (const a of actions) {
      const op = operationOf(a);
      expect(op.access === "story" || (op.scope === "account" && (!op.mutates || op.name === "submit_feedback")) || op.name === "products.limits", a).toBe(true);
    }
  });

  it("tells a reader everywhere, with nothing but the Story to read, what search reads for them", async () => {
    const at = "/mcp";
    const client = await connect(await h.connectAgent(rita, "Rita's agent, unscoped", at), at);
    const tool = (await client.listTools()).tools.find((t) => t.name === "search")!;
    expect(tool.description).toMatch(/^Search this product's Story pages\./);
    await client.close();
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
    for (const a of ["sources.create", "sources.annotate", "outcomes.create", "story.publish", "products.export"]) expect(actions, a).not.toContain(a);
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

describe("an export, on a Read only connection", () => {
  it("is in a tool of its own that says it destroys nothing, with no write tool beside it", async () => {
    const at = `/mcp/t/${path}`;
    const client = await connect(await h.connectAgent(vic, "Vic's read-only agent", at, "viewer"), at);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("products_export");
    expect(names.filter((n) => n.endsWith("_write") || n.endsWith("_delete"))).toEqual([]);
    const tool = tools.find((t) => t.name === "products_export")!;
    expect(tool.annotations).toMatchObject({ title: "Export a product", readOnlyHint: false, destructiveHint: false });
    expect(said(tool.description!)).toMatch(/changes nothing in the product/);
    // The one tool on this list that is marked destructive is the person's own report to the developer.
    expect(tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name)).toEqual(["submit_feedback"]);
    const made = result(await client.callTool({ name: "products_export", arguments: { action: "export" } }));
    expect(made.json).toMatchObject({ status: "pending", scope: { connection_level: "viewer", your_role: "viewer" } });
    const listed = result(await client.callTool({ name: "products_read", arguments: { action: "exports" } }));
    expect(listed.json.items.map((i: { export_id: string }) => i.export_id)).toContain(made.json.export_id);
    expect(result(await client.callTool({ name: "products_export", arguments: { action: "export", describe: true } })).json).toMatchObject({ tool: "products_export", action: "export", mutates: true });
    await client.close();
  });

  it("is offered at every level to someone who may make one, and not to a reader", async () => {
    for (const level of ["viewer", "editor", "admin"] as const) expect((await offeredAt(vic, `/mcp/t/${path}`, level)), level).toContain("products.export");
    expect((await offeredWith(olive, `/mcp/t/${path}`, "editor")).descriptions["products_export"]).toBeDefined();
    expect((await offeredWith(rita, `/mcp/t/${path}`)).descriptions["products_export"]).toBeUndefined();
  });
});

describe("search, for someone who reads only the Story", () => {
  async function searchTool(browser: Browser, at: string) {
    const client = await connect(await h.connectAgent(browser, `Search at ${at}`, at), at);
    const tool = (await client.listTools()).tools.find((t) => t.name === "search")!;
    await client.close();
    return tool;
  }

  it("says what it reads for them, the Story, and nothing of sources or anything else they cannot search", async () => {
    const tool = await searchTool(rita, `/mcp/t/${path}`);
    expect(tool.description).toMatch(/^Search this product's Story pages\./);
    expect(tool.description).toMatch(/It takes mode "plain".*any other is refused with 403/);
    expect(tool.description).not.toMatch(/what a product's sources say|derived|record_id|attachment|assumptions come/i);
    // Its schema is what a call that works takes, so mode is asked for rather than left to a default it would refuse.
    const fields = tool.inputSchema.properties as Record<string, { const?: string }>;
    expect(Object.keys(fields).sort()).toEqual(["kind", "limit", "mode", "product", "query", "strict"]);
    expect(fields["mode"]!.const).toBe("plain");
    expect(tool.inputSchema.required).toEqual(expect.arrayContaining(["query", "mode"]));
    expect(JSON.stringify(fields)).not.toMatch(/source|substring|ranked/i);
  });

  it("reads the same on a connector scoped to the organization", async () => {
    expect((await searchTool(rita, `/mcp/t/${org}`)).description).toMatch(/^Search this product's Story pages\./);
  });

  it("says all of it on the unscoped connector once they read more somewhere: a guest of the example organization reads sources there", async () => {
    // The example organization exists by now, and every account is its guest, a viewer.
    expect((await searchTool(rita, "/mcp")).description).toMatch(/^Search what a product's sources say.*A reader searches only the Story, in plain mode\./s);
  });

  it("still says what it reads for sources to anyone who may read them", async () => {
    const tool = await searchTool(vic, `/mcp/t/${path}`);
    expect(tool.description).toMatch(/^Search what a product's sources say/);
    expect(Object.keys(tool.inputSchema.properties as object)).toEqual(expect.arrayContaining(["record_id", "scope", "date_from"]));
  });

  it("answers what its schema asks for, and refuses what it leaves out, as it always did", async () => {
    const at = `/mcp/t/${path}`;
    const client = await connect(await h.connectAgent(rita, "Rita's searching agent", at), at);
    expect(result(await client.callTool({ name: "search", arguments: { query: "harvest", mode: "plain" } })).json).toMatchObject({ mode: "plain" });
    const refused = result(await client.callTool({ name: "search", arguments: { query: "harvest" } }));
    expect(refused.status).toBe(403);
    expect(refused.json.error.message).toMatch(/send mode "plain"/);
    await client.close();
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
      const allowed = (op: OperationDef) => levelAllows(level, op);
      lists.push([`${level}, unnarrowed`, allowed]);
      for (const [who, standing] of Object.entries(standings)) {
        lists.push([`${level}, ${who}, unscoped`, (op) => allowed(op) && reachesAnywhere(op, [standing])]);
        for (const product of [true, false]) {
          const f = fence(product, standing);
          lists.push([`${level}, ${who}, scoped to ${product ? "a product" : "an organization"}`, (op) => allowed(op) && connectorOffers(f, op) && roleReaches(op, standing)]);
        }
      }
    }
    for (const [what, keep] of lists) {
      const definitions = toolDefinitions(keep);
      for (const [tool, ops] of definitions.groups) {
        const description = definitions.tools.find((t) => t.name === tool)!.description;
        expect(unofferedNamed(tool, description, ops.map((o) => o.mcp.action!)), `${tool}, ${what}`).toEqual([]);
      }
    }
  });

  it("speaks of starting an organization only to someone offered it, and opens with the work on a product", async () => {
    // Olive owns an organization: a connector scoped to it reaches no other, so she starts none there.
    const scoped = await offeredWith(olive, `/mcp/t/${org}`);
    expect(scoped.actions).toEqual(expect.arrayContaining(["products.create", "products.create_team"]));
    expect(scoped.actions).not.toContain("products.create_tenant");
    expect(said(scoped.descriptions["products_write"]!)).not.toMatch(/organization/i);
    expect(said(scoped.descriptions["products_write"]!)).toMatch(/Start a product or a team/);
    // An editor writes the concept, and is told of nothing else.
    const editing = (await offeredWith(eddie, "/mcp", "editor")).descriptions["products_write"]!;
    expect(said(editing)).toBe("Write the product concept and its card.");
    // Someone with room in an allowance, at Admin, is told of it, and after what they do most.
    const able = await offeredWith(vic, "/mcp", "admin");
    expect(able.actions).toContain("products.create_tenant");
    expect(said(able.descriptions["products_write"]!)).toMatch(/^Write the product concept and its card\..*Start an organization of your own\.$/);
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
