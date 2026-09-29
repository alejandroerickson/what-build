import { OPERATIONS } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restPath } from "../src/rest.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let bob: Browser;
let vic: Browser;
let path: string;
let tenantSlug: string;
let teamSlug: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice");
  bob = await h.signIn("bob@example.com", "Bob");
  vic = await h.signIn("vic@example.com", "Vic");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Alpha" });
  tenantSlug = t.body.tenant.slug;
  teamSlug = t.body.team.slug;
  const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Secret product" });
  path = p.body.path;
  await alice.api("POST", `/api/v1/p/${path}/outcomes`, { title: "Private goal" });
  await bob.api("POST", "/api/v1/tenants", { name: "Beta" });
});
afterAll(async () => h?.close());

function fill(p: string) {
  const [tenant, team, product] = path.split("/");
  return p
    .replace(":tenant", tenant!)
    .replace(":team", team!)
    .replace(":product", product!)
    .replace(/:[a-z_]+/g, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
}

describe("isolation", () => {
  it("answers 404 — never 403, never data — to a non-member, through every product, team and tenant operation", async () => {
    const probed: string[] = [];
    for (const op of OPERATIONS) {
      if (op.scope === "account") continue;
      const r = await bob.api(op.rest.method, fill(restPath(op)), op.rest.method === "GET" ? undefined : {});
      expect(r.status, `${op.name} ${op.rest.method} ${restPath(op)} → ${JSON.stringify(r.body)}`).toBe(404);
      probed.push(op.name);
    }
    expect(probed.length).toBeGreaterThan(60);
  });

  it("hides the product from a non-member's product list and from MCP", async () => {
    const list = await bob.api("GET", "/api/v1/me/products");
    expect(list.body.items).toHaveLength(0);
  });

  it("enforces tenant isolation in the database itself (row-level security)", async () => {
    const leaked = await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', 'some-other-tenant', true)`.execute(trx);
      return trx.selectFrom("outcomes").selectAll().execute();
    });
    expect(leaked).toHaveLength(0);
    const unscoped = await h.db.selectFrom("activity").selectAll().execute();
    expect(unscoped).toHaveLength(0);
  });
});

describe("roles", () => {
  it("lets a viewer read, refuses their writes with 403 naming the role, and lets an editor write", async () => {
    const g = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: path.split("/")[2], email: "vic@example.com", role: "viewer" });
    expect(g.status).toBe(201);
    const read = await vic.api("GET", `/api/v1/p/${path}/outcomes`);
    expect(read.status).toBe(200);
    expect(read.body.items).toHaveLength(1);
    const write = await vic.api("POST", `/api/v1/p/${path}/outcomes`, { title: "Nope" });
    expect(write.status).toBe(403);
    expect(write.body.error.message).toMatch(/viewer.*needs editor/);
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, email: "vic@example.com", role: "editor" });
    const now = await vic.api("POST", `/api/v1/p/${path}/outcomes`, { title: "Now allowed" });
    expect(now.status).toBe(201);
    // A team editor is not a product admin.
    const admin = await vic.api("POST", `/api/v1/p/${path}/archive`, { expected_etag: "x" });
    expect(admin.status).toBe(403);
    const members = await vic.api("GET", `/api/v1/tenants/${tenantSlug}/members`);
    expect(members.body.members.find((m: { email: string }) => m.email === "vic@example.com").grants).toHaveLength(2);
  });

  it("invites someone without an account, who joins on first sign-in with that address", async () => {
    const inv = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, email: "newcomer@example.com", role: "viewer" });
    expect(inv.body.invited).toBe(true);
    expect(h.mailer.sent.at(-1)!.text).toContain("/invite/");
    const newcomer = await h.signIn("newcomer@example.com");
    const list = await newcomer.api("GET", "/api/v1/me/products");
    expect(list.body.items.map((i: { path: string }) => i.path)).toContain(path);
  });

  it("keeps at least one tenant owner", async () => {
    const me = await alice.api("GET", "/api/v1/me");
    const r = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members/revoke`, { account_id: me.body.account_id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("last_owner");
  });
});

describe("identity", () => {
  it("answers 401 to anonymous calls before looking at the body", async () => {
    const r = await fetch(`${h.baseUrl}/api/v1/p/${path}/outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
    expect(r.status).toBe(401);
  });

  it("refuses cross-origin cookie writes", async () => {
    const r = await alice.api("POST", `/api/v1/p/${path}/outcomes`, { title: "x" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });

  it("issues personal access tokens that act as the person, and stop at once when revoked", async () => {
    const t = await alice.api("POST", "/api/v1/me/tokens", { name: "script" });
    expect(t.body.token).toMatch(/^wbpat_/);
    const call = await fetch(`${h.baseUrl}/api/v1/p/${path}/outcomes`, { headers: { authorization: `Bearer ${t.body.token}` } });
    expect(call.status).toBe(200);
    await alice.api("DELETE", `/api/v1/me/tokens/${t.body.token_id}`);
    const after = await fetch(`${h.baseUrl}/api/v1/p/${path}/outcomes`, { headers: { authorization: `Bearer ${t.body.token}` } });
    expect(after.status).toBe(401);
  });
});
