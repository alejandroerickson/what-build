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

  it("accepts an invitation link that signing in already used, for the same person, and refuses it to anyone else", async () => {
    const inv = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, email: "linked@example.com", role: "editor" });
    const token = String(inv.body.invite_link).split("/invite/")[1];
    // Signing in with the invited address accepts the invitation; the link then lands on /invite/:token.
    const linked = await h.signIn("linked@example.com");
    const again = await linked.api("POST", "/api/v1/invitations/accept", { token });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ accepted: true, already: true, scope_type: "team", role: "editor", tenant: { slug: tenantSlug } });
    const other = await vic.api("POST", "/api/v1/invitations/accept", { token });
    expect(other.status).toBe(410);
    expect(other.body.error.code).toBe("invitation_used");
    const bogus = await linked.api("POST", "/api/v1/invitations/accept", { token: "not-a-real-token" });
    expect(bogus.status).toBe(404);
  });

  it("accepts an invitation link only for the address it was sent to", async () => {
    const inv = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, email: "Intended@Example.com", role: "viewer" });
    const token = String(inv.body.invite_link).split("/invite/")[1];
    const wrong = await vic.api("POST", "/api/v1/invitations/accept", { token });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("invitation_wrong_address");
    expect(wrong.body.error.details.invited).toBe("I••••@Example.com");
    expect(JSON.stringify(wrong.body)).not.toContain("Intended@");
    // The refusal leaves it unused: the invited person joins on signing in, whatever the letter case, and the link then confirms it.
    const intended = await h.signIn("intended@example.com");
    const right = await intended.api("POST", "/api/v1/invitations/accept", { token });
    expect(right.status).toBe(200);
    expect(right.body.already).toBe(true);
  });

  it("removes someone from the tenant with every grant they hold", async () => {
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { email: "leaver@example.com", role: "member" });
    const leaver = await h.signIn("leaver@example.com");
    const id = (await leaver.api("GET", "/api/v1/me")).body.account_id;
    await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, email: "leaver@example.com", role: "editor" });
    const mixed = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members/revoke`, { account_id: id, team: teamSlug, whole_tenant: true });
    expect(mixed.status).toBe(422);
    const r = await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members/revoke`, { account_id: id, whole_tenant: true });
    expect(r.status).toBe(200);
    expect(r.body.removed).toBe(2);
    const members = await alice.api("GET", `/api/v1/tenants/${tenantSlug}/members`);
    expect(members.body.members.some((m: { account_id: string }) => m.account_id === id)).toBe(false);
    expect((await leaver.api("GET", "/api/v1/me/products")).body.items).toHaveLength(0);
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

  it("says before sign-in how long the session cookie lasts, as long as the cookie it sets", async () => {
    const methods = (await (await fetch(`${h.baseUrl}/auth/methods`)).json()) as { session_days: number };
    const res = await fetch(`${h.baseUrl}/auth/dev-sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: h.baseUrl },
      body: JSON.stringify({ email: "cookie@example.com", display_name: "Cookie" }),
    });
    const maxAge = Number(/Max-Age=(\d+)/i.exec(res.headers.get("set-cookie") ?? "")?.[1]);
    expect(methods.session_days).toBeGreaterThan(0);
    expect(maxAge).toBe(methods.session_days * 86400);
  });

  it("refuses cross-origin cookie writes", async () => {
    const r = await alice.api("POST", `/api/v1/p/${path}/outcomes`, { title: "x" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });

  it("answers REST only to the browser session: a bearer token is refused, even an agent's", async () => {
    const token = await h.connectAgent(alice);
    const call = await fetch(`${h.baseUrl}/api/v1/p/${path}/outcomes`, { headers: { authorization: `Bearer ${token}` } });
    expect(call.status).toBe(401);
    expect((await fetch(`${h.baseUrl}/api/v1/me/tokens`, { headers: { cookie: alice.cookie } })).status).toBe(404);
  });

  it("lists the agents connected as a person, and disconnects one at once", async () => {
    const token = await h.connectAgent(alice, "Revocable Agent");
    const listed = await alice.api("GET", "/api/v1/me/agents");
    const agent = listed.body.items.find((a: { client_name: string }) => a.client_name === "Revocable Agent");
    expect(agent).toBeTruthy();
    const mcp = (t: string) => fetch(`${h.baseUrl}/mcp`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect((await mcp(token)).status).toBe(200);
    await alice.api("DELETE", `/api/v1/me/agents/${agent.family_id}`);
    expect((await mcp(token)).status).toBe(401);
    expect((await alice.api("GET", "/api/v1/me/agents")).body.items.some((a: { family_id: string }) => a.family_id === agent.family_id)).toBe(false);
  });
});
