import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An organization's owners rename it, and so does an owner of the instance, member or not. Only
// the name changes: the slug, in every address, stays.

let h: Harness;
let root: Browser; // an instance owner, in no organization but the ones they start
let olga: Browser; // owns Acme
let adam: Browser; // an admin of Acme
let mia: Browser; // a member of Acme, with a role on its team
let bob: Browser; // in no organization
let acme: string; // Acme's slug
let team: string;
let product: string; // a product's path in Acme

const T = () => `/api/v1/tenants/${acme}`;

/** Acme as one of its people sees it in their product list. */
async function acmeOf(who: Browser) {
  return (await who.api("GET", "/api/v1/me/products")).body.tenants.find((t: { slug: string }) => t.slug === acme);
}

async function renamed(who: Browser, name: string) {
  const r = await who.api("PATCH", T(), { name, expected_etag: (await acmeOf(olga)).name_etag });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

function body(r: unknown): { status: number; json: any } {
  const t = (r as { content: { text: string }[] }).content[0]!.text;
  if (t.startsWith("{")) return { status: 200, json: JSON.parse(t) };
  return { status: Number(t.slice(0, 3)), json: JSON.parse(t.slice(t.indexOf("\n") + 1)) };
}

async function connect(who: Browser, path = "/mcp", level: "viewer" | "editor" | "admin" = "admin") {
  const token = await h.connectAgent(who, "Naming agent", "/mcp", level);
  const client = new Client({ name: "naming-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}${path}`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["root@example.com"] });
  root = await h.signIn("root@example.com", "Root Owner");
  olga = await h.signIn("olga@example.com", "Olga Owner");
  const t = await olga.api("POST", "/api/v1/tenants", { name: "Acme" });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  expect(t.body.tenant.name_etag).toEqual(expect.any(String));
  acme = t.body.tenant.slug;
  team = t.body.team.slug;
  product = (await olga.api("POST", `/api/v1/teams/${acme}/${team}/products`, { name: "Onboarding" })).body.path;
  expect((await olga.api("POST", `${T()}/members`, { email: "adam@example.com", role: "admin" })).status).toBe(201);
  expect((await olga.api("POST", `${T()}/members`, { email: "mia@example.com", role: "editor", team })).status).toBe(201);
  adam = await h.signIn("adam@example.com", "Adam Admin");
  mia = await h.signIn("mia@example.com", "Mia Member");
  bob = await h.signIn("bob@example.com", "Bob Outsider");
}, 120_000);
afterAll(async () => h?.close());

describe("an owner renaming the organization", () => {
  it("changes its name for everyone in it, and nothing else: its slug and every address stay", async () => {
    const before = await acmeOf(olga);
    const r = await renamed(olga, "  Acme Labs ");
    expect(r).toEqual({ tenant_id: before.tenant_id, slug: acme, name: "Acme Labs", name_etag: expect.any(String), previous_name: "Acme" });
    expect(r.name_etag).not.toBe(before.name_etag);
    for (const who of [olga, adam, mia]) expect(await acmeOf(who)).toMatchObject({ slug: acme, name: "Acme Labs", name_etag: r.name_etag });
    const p = await mia.api("GET", `/api/v1/p/${product}`);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ path: product, tenant: { slug: acme, name: "Acme Labs" } });
  });

  it("records the rename in the organization's access log, and not in a product's activity", async () => {
    const log = (await adam.api("GET", `${T()}/members/activity`)).body.items;
    expect(log[0]).toMatchObject({ action: "renamed", entity_type: "tenant", entity_title: "Acme Labs", summary: "Formerly Acme", actor: { display_name: "Olga Owner" }, through_agent: false });
    // The organization's creation is not access, and stays out of it.
    expect(log.filter((i: { entity_type: string }) => i.entity_type === "tenant")).toHaveLength(1);
    const activity = (await olga.api("GET", `/api/v1/p/${product}/activity`)).body.items;
    expect(activity.some((i: { action: string }) => i.action === "renamed")).toBe(false);
  });

  it("refuses a rename over one made since the name was read, with 409 stale_etag, and changes nothing", async () => {
    const stale = (await acmeOf(olga)).name_etag;
    await renamed(olga, "Acme Research");
    const r = await olga.api("PATCH", T(), { name: "Acme Again", expected_etag: stale });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: (await acmeOf(olga)).name_etag } });
    expect(r.body.error.message).toMatch(/organization's name changed since you read it/);
    expect((await acmeOf(olga)).name).toBe("Acme Research");
  });

  it("writes nothing when the name is the one it has", async () => {
    const before = await acmeOf(olga);
    const entries = (await olga.api("GET", `${T()}/members/activity`)).body.items.length;
    const r = await olga.api("PATCH", T(), { name: before.name, expected_etag: before.name_etag });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ tenant_id: before.tenant_id, slug: acme, name: before.name, name_etag: before.name_etag });
    expect((await olga.api("GET", `${T()}/members/activity`)).body.items).toHaveLength(entries);
  });

  it("refuses an empty name or one over 100 characters", async () => {
    const etag = (await acmeOf(olga)).name_etag;
    for (const name of ["", "   ", "x".repeat(101)]) {
      const r = await olga.api("PATCH", T(), { name, expected_etag: etag });
      expect(r.status, name).toBe(422);
      expect(r.body.error.code).toBe("invalid_input");
    }
    expect((await olga.api("PATCH", T(), { name: "Acme Research" })).status).toBe(422);
  });
});

describe("anyone but an owner", () => {
  it("is refused: an admin or a member with 403, someone outside with 404, and nothing changes", async () => {
    const before = await acmeOf(olga);
    for (const who of [adam, mia]) {
      const r = await who.api("PATCH", T(), { name: "Taken Over", expected_etag: before.name_etag });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.message).toMatch(/Only an owner of Acme Research/);
    }
    const out = await bob.api("PATCH", T(), { name: "Taken Over", expected_etag: before.name_etag });
    expect(out.status).toBe(404);
    expect(JSON.stringify(out.body)).not.toContain("Acme");
    expect(await acmeOf(olga)).toMatchObject({ name: "Acme Research", name_etag: before.name_etag });
  });
});

describe("an agent", () => {
  it("renames the organization for an owner through a connection that may manage it, and is recorded as an agent", async () => {
    const c = await connect(olga);
    const etag = (await acmeOf(olga)).name_etag;
    const r = body(await c.callTool({ name: "products", arguments: { action: "rename_tenant", params: { tenant: acme, name: "Acme Works", expected_etag: etag } } }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ slug: acme, name: "Acme Works", previous_name: "Acme Research" });
    const log = (await olga.api("GET", `${T()}/members/activity`)).body.items;
    expect(log[0]).toMatchObject({ action: "renamed", entity_title: "Acme Works", through_agent: true });
    await c.close();
  });

  it("is refused on a connection set to Edit, which manages no organization", async () => {
    const c = await connect(olga, "/mcp", "editor");
    const r = body(await c.callTool({ name: "products", arguments: { action: "rename_tenant", params: { tenant: acme, name: "Acme Edited", expected_etag: (await acmeOf(olga)).name_etag } } }));
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("connection_level");
    await c.close();
  });

  it("renames it through a connector scoped to the organization, and not through one scoped to a product in it", async () => {
    const org = await connect(olga, `/mcp/t/${acme}`);
    const r = body(await org.callTool({ name: "products", arguments: { action: "rename_tenant", params: { name: "Acme", expected_etag: (await acmeOf(olga)).name_etag } } }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.name).toBe("Acme");
    await org.close();
    const one = await connect(olga, `/mcp/t/${product}`);
    const refused = body(await one.callTool({ name: "products", arguments: { action: "rename_tenant", params: { tenant: acme, name: "Acme Narrow", expected_etag: (await acmeOf(olga)).name_etag } } }));
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("outside_connector_scope");
    await one.close();
    expect((await acmeOf(olga)).name).toBe("Acme");
  });
});

describe("an instance owner", () => {
  it("renames any organization from the instance's list, member or not, with its name_etag", async () => {
    const list = (await root.api("GET", "/api/v1/organizations")).body.items;
    const item = list.find((o: { slug: string }) => o.slug === acme);
    expect(item).toMatchObject({ name: "Acme", name_etag: (await acmeOf(olga)).name_etag });
    const r = await root.api("PATCH", T(), { name: "Acme Company", expected_etag: item.name_etag });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await acmeOf(olga)).toMatchObject({ name: "Acme Company" });
    // Their rename is recorded under their own name; it gives them no place in the organization.
    expect((await olga.api("GET", `${T()}/members/activity`)).body.items[0]).toMatchObject({ action: "renamed", actor: { display_name: "Root Owner" }, summary: "Formerly Acme" });
    expect((await root.api("GET", "/api/v1/me/products")).body.tenants.some((t: { slug: string }) => t.slug === acme)).toBe(false);
    expect((await root.api("GET", `${T()}/members`)).status).toBe(404);
  });

  it("still meets the stale etag, and names an organization that does not exist as missing", async () => {
    const r = await root.api("PATCH", T(), { name: "Acme Stale", expected_etag: "not-the-etag" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("stale_etag");
    expect((await root.api("PATCH", "/api/v1/tenants/no-such-organization", { name: "Nowhere", expected_etag: "x" })).status).toBe(404);
  });
});

describe("the example organization", () => {
  let example: string;
  let gus: Browser; // its guest, as every account without a grant there is

  beforeAll(async () => {
    const e = await olga.api("POST", "/api/v1/tenants", { name: "WB Enterprises" });
    example = e.body.tenant.slug;
    await syncExampleTenant(h.db, example, () => {});
    gus = await h.signIn("gus@example.com", "Gus Guest");
  });
  afterAll(async () => {
    await syncExampleTenant(h.db, null, () => {});
  });

  const etagOf = async () => (await olga.api("GET", "/api/v1/me/products")).body.tenants.find((t: { slug: string }) => t.slug === example).name_etag;

  it("is renamed by its owners, as any organization is", async () => {
    const r = await olga.api("PATCH", `/api/v1/tenants/${example}`, { name: "Crewboard Worked Example", expected_etag: await etagOf() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await gus.api("GET", "/api/v1/me/products")).body.tenants).toEqual([expect.objectContaining({ slug: example, name: "Crewboard Worked Example", example: true })]);
  });

  it("refuses its guests with 403 example_read_only, and lets an instance owner rename it", async () => {
    const refused = await gus.api("PATCH", `/api/v1/tenants/${example}`, { name: "Gus's Now", expected_etag: await etagOf() });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("example_read_only");
    const r = await root.api("PATCH", `/api/v1/tenants/${example}`, { name: "The Example Organization", expected_etag: await etagOf() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await gus.api("GET", "/api/v1/me/products")).body.tenants[0].name).toBe("The Example Organization");
  });
});
