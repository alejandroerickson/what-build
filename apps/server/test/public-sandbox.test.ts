import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { BASELINE_TABLES, NOT_IN_BASELINE, resetSchedule, SANDBOX_DEFAULTS, SANDBOX_LIMITS, visitorName } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncSandboxTenant } from "../src/public-sandbox.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let olive: Browser; // the sandbox's owner
let vera: Browser; // a visitor
let viktor: Browser; // another visitor
let other: Browser; // the owner of an organization that is not a sandbox
let org: string;
let team: string;
let tenantId: string;
let T: string; // the sandbox's tenant routes
let P: string; // its product's routes
let otherP: string;
let code: string;
let seededSource: string;

const VISITOR = /^Visitor [0-9A-F]{6}$/;

async function settings() {
  return (await olive.api("GET", `${T}/sandbox/settings`)).body;
}

/** Change settings as the owner, from the etag of the moment. */
async function set(patch: Record<string, unknown>) {
  const r = await olive.api("PATCH", `${T}/sandbox/settings`, { expected_etag: (await settings()).etag, ...patch });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

async function upload(who: Browser, base: string, path: string, body: string, title = `Sample ${path}`) {
  const created = await who.api("POST", `${base}/sources/with-upload`, { tags: ["notes"], title, path, role: "primary" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const put = await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body });
  expect(put.status).toBe(201);
  return created.body.record.record_id as string;
}

/** Every row of content a tenant holds, table by table, in a fixed order. */
async function contentOf(tenant: string): Promise<Record<string, string[]>> {
  return h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`.execute(trx);
    const out: Record<string, string[]> = {};
    for (const table of BASELINE_TABLES) {
      // The organization's own log (people, access, the sandbox's settings and resets) is not content.
      const content = table === "activity" ? sql` and product_id is not null` : sql``;
      const r = await sql<{ row: string }>`select to_jsonb(t)::text as row from ${sql.table(table)} t where tenant_id = ${tenant}${content} order by 1`.execute(trx);
      out[table] = r.rows.map((x) => x.row);
    }
    return out;
  });
}

beforeAll(async () => {
  // Sign-up is limited, as on a deployment that is not open to everyone, and only its owners create organizations.
  h = await startHarness({ signupAllowlist: ["@staff.example"], instanceOwners: ["olive@staff.example", "pat@staff.example"], defaultTenantAllowance: 0 });
  olive = await h.signIn("olive@staff.example", "Olive Owner");
  const t = await olive.api("POST", "/api/v1/tenants", { name: "Sample Sandbox" });
  org = t.body.tenant.slug;
  team = t.body.team.slug;
  tenantId = t.body.tenant.tenant_id;
  T = `/api/v1/tenants/${org}`;
  const p = await olive.api("POST", `/api/v1/teams/${org}/${team}/products`, { name: "Showcase", concept: "A sample product for visitors." });
  P = `/api/v1/p/${p.body.path}`;
  await olive.api("POST", `${P}/outcomes`, { title: "Plan the week in ten minutes" });
  seededSource = await upload(olive, P, "visit.md", "# Visit\n\n- Crews text the office.\n- Nobody called it a crisis.\n", "Sample visit notes");
  await h.worker.drain();
  await olive.api("POST", `${P}/assumptions`, { statement: "Crews read texts before calls.", citations: [{ record_id: seededSource, seq_start: 1, seq_end: 1 }], author_type: "human" });

  other = await h.signIn("pat@staff.example", "Pat Elsewhere");
  const o = await other.api("POST", "/api/v1/tenants", { name: "Elsewhere" });
  const op = await other.api("POST", `/api/v1/teams/${o.body.tenant.slug}/${o.body.team.slug}/products`, { name: "Private work" });
  otherP = `/api/v1/p/${op.body.path}`;
  await other.api("POST", `${otherP}/outcomes`, { title: "Nobody else sees this" });
});
afterAll(async () => h?.close());

describe("the schedule", () => {
  const at = (iso: string) => resetSchedule({ reset_time: "02:00", reset_timezone: "America/Los_Angeles" }, new Date(iso));

  it("finds 2 a.m. Pacific in summer and in winter time", () => {
    expect(at("2026-09-29T10:00:00Z")).toEqual({ due_at: "2026-09-29T09:00:00.000Z", next_at: "2026-09-30T09:00:00.000Z" });
    expect(at("2026-09-29T08:59:00Z")).toEqual({ due_at: "2026-09-28T09:00:00.000Z", next_at: "2026-09-29T09:00:00.000Z" });
    expect(at("2026-12-10T12:00:00Z")).toEqual({ due_at: "2026-12-10T10:00:00.000Z", next_at: "2026-12-11T10:00:00.000Z" });
  });

  it("keeps one reset a day across the clock changes", () => {
    // Clocks go back on 1 November 2026: the day before resets at 09:00 UTC, the day itself at 10:00.
    expect(at("2026-11-01T12:00:00Z")).toEqual({ due_at: "2026-11-01T10:00:00.000Z", next_at: "2026-11-02T10:00:00.000Z" });
    expect(at("2026-11-01T09:30:00Z").due_at).toBe("2026-10-31T09:00:00.000Z");
    // Clocks go forward on 8 March 2026, and 02:00 does not happen: the reset lands when they do.
    expect(at("2026-03-08T12:00:00Z")).toEqual({ due_at: "2026-03-08T10:00:00.000Z", next_at: "2026-03-09T09:00:00.000Z" });
  });

  it("crosses a month's end", () => {
    expect(resetSchedule({ reset_time: "23:30", reset_timezone: "UTC" }, new Date("2026-03-01T00:10:00Z"))).toEqual({ due_at: "2026-02-28T23:30:00.000Z", next_at: "2026-03-01T23:30:00.000Z" });
  });
});

describe("a baseline", () => {
  it("accounts for every table that carries a tenant", async () => {
    const r = await sql<{ table_name: string }>`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id' order by 1`.execute(h.db);
    const known = new Set<string>([...BASELINE_TABLES, ...Object.keys(NOT_IN_BASELINE), "tenants"]);
    expect(r.rows.map((x) => x.table_name).filter((t) => !known.has(t))).toEqual([]);
  });
});

describe("before the deployment names a sandbox", () => {
  it("has none: the operations answer 404, and no invitation can be made", async () => {
    const status = await olive.api("GET", `${T}/sandbox`);
    expect(status.status).toBe(404);
    // Said to a person: what this organization is, never how a deployment is configured.
    expect(status.body.error.message).toMatch(/^Sample Sandbox isn’t a public sandbox/);
    expect(status.body.error.message).not.toMatch(/WHATBUILD|deployment/);
    expect((await olive.api("GET", `${T}/sandbox/settings`)).status).toBe(404);
    expect((await olive.api("POST", `${T}/sandbox/invites`, { label: "Too early", places: 5 })).status).toBe(404);
    expect((await olive.api("GET", "/api/v1/me/products")).body.tenants[0].sandbox).toBeUndefined();
  });
});

describe("the public sandbox", () => {
  beforeAll(async () => {
    expect(await syncSandboxTenant(h.db, org, () => {})).toBe(tenantId);
  });

  it("shows its staff a control panel with every limit at its default", async () => {
    const s = await settings();
    expect(s.settings).toEqual(SANDBOX_DEFAULTS);
    expect(s.settings).toMatchObject({ reset_time: "02:00", reset_timezone: "America/Los_Angeles", visitor_access: "write" });
    expect(s.limits.map((l: { key: string }) => l.key)).toEqual(SANDBOX_LIMITS.map((l) => l.key));
    for (const l of s.limits) expect(l, l.key).toMatchObject({ value: l.default, refusal: expect.stringMatching(/^4\d\d /) });
    expect(s.deployment_limits.find((l: { set_by: string }) => l.set_by === "WHATBUILD_FILE_MAX_BYTES").value).toBe(h.config.fileMaxBytes);
    expect(s.seats).toEqual({ used: 0, limit: 200 });
    expect(s.baseline).toBeNull();
    expect(s.resets).toMatchObject({ enabled: true, next_at: null, due: false });
    expect((await olive.api("GET", `${T}/sandbox`)).body.you).toMatchObject({ role: "staff", appears_as: null });
    const listed = (await olive.api("GET", "/api/v1/me/products")).body;
    expect(listed.tenants.find((x: { slug: string }) => x.slug === org).sandbox).toBe(true);
    expect(listed.items[0].tenant.sandbox).toBe(true);
  });

  it("refuses a setting that is not one, a time that is not a time, and a stale etag", async () => {
    const etag = (await settings()).etag;
    expect((await olive.api("PATCH", `${T}/sandbox/settings`, { expected_etag: etag, colour: "red" })).status).toBe(422);
    expect((await olive.api("PATCH", `${T}/sandbox/settings`, { expected_etag: etag, reset_time: "2am" })).status).toBe(422);
    expect((await olive.api("PATCH", `${T}/sandbox/settings`, { expected_etag: etag, reset_timezone: "Mars/Olympus" })).status).toBe(422);
    const changed = await set({ max_visitors: 3 });
    expect(changed.changed).toEqual(["max_visitors"]);
    const stale = await olive.api("PATCH", `${T}/sandbox/settings`, { expected_etag: etag, max_visitors: 9 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
  });

  it("makes an invitation with a number of places, and says what it is to whoever holds the link", async () => {
    const inv = await olive.api("POST", `${T}/sandbox/invites`, { label: "Sample launch post", places: 2, expires_in_days: 7 });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({ label: "Sample launch post", places: 2, used: 0, status: "open" });
    code = String(inv.body.invite_link).split("/join/")[1]!;
    expect(code.length).toBeGreaterThan(20);
    // The link is given once: nothing that lists invitations holds it.
    expect(JSON.stringify((await olive.api("GET", `${T}/sandbox/invites`)).body)).not.toContain(code);
    const info = await fetch(`${h.baseUrl}/api/v1/sandbox/invite?code=${code}`);
    expect(info.status).toBe(200);
    const body = (await info.json()) as { status: string; organization: string; notice: string };
    expect(body).toMatchObject({ status: "open", organization: "Sample Sandbox" });
    expect(body.notice).toMatch(/public sandbox/);
    expect((await fetch(`${h.baseUrl}/api/v1/sandbox/invite?code=not-a-real-code-at-all`)).status).toBe(404);
  });

  it("lets a stranger sign up on an invitation alone, and only then", async () => {
    const ask = (email: string, next?: string) =>
      fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email, ...(next ? { next } : {}) }) });
    expect((await ask("vera@visitor.example")).status).toBe(403);
    expect((await ask("vera@visitor.example", "/join/not-a-real-code-at-all")).status).toBe(403);
    const sent = await ask("vera@visitor.example", `/join/${code}`);
    expect(sent.status).toBe(200);
    const { response: verified, cookie } = await h.followSignInLink();
    expect(verified.status).toBe(303);
    expect(verified.headers.get("location")).toBe(`/join/${code}`);
    const me = (await (await fetch(`${h.baseUrl}/api/v1/me`, { headers: { cookie: cookie! } })).json()) as { email: string; sandbox_only?: boolean };
    expect(me).toMatchObject({ email: "vera@visitor.example", sandbox_only: true });
    // Let in to the sandbox, not to WhatBuild: no organization of their own.
    vera = await h.signIn("vera@visitor.example");
    const own = await vera.api("POST", "/api/v1/tenants", { name: "Vera's own" });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe("tenant_allowance");
    // Signing in did not put them in the sandbox: that takes the invitation.
    expect((await vera.api("GET", "/api/v1/me/products")).body.items).toHaveLength(0);
    expect((await vera.api("GET", `${T}/sandbox`)).status).toBe(404);
  });

  it("admits the holders of an invitation as visitors until its places are taken", async () => {
    const joined = await vera.api("POST", "/api/v1/sandbox/join", { code });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ joined: true, already: false, role: "visitor", organization: { slug: org } });
    expect(joined.body.appears_as).toMatch(VISITOR);
    expect(joined.body.products[0].path).toBe(`${org}/${team}/showcase`);
    expect((await vera.api("POST", "/api/v1/sandbox/join", { code })).body).toMatchObject({ already: true, role: "visitor" });
    viktor = await h.signIn("viktor@visitor.example", "Viktor Visitor", `/join/${code}`);
    expect((await viktor.api("POST", "/api/v1/sandbox/join", { code })).body.already).toBe(false);
    const late = await h.signIn("late@visitor.example", "Late Comer", `/join/${code}`);
    const full = await late.api("POST", "/api/v1/sandbox/join", { code });
    expect(full.status).toBe(410);
    expect(full.body.error.code).toBe("invite_used_up");
    expect((await fetch(`${h.baseUrl}/api/v1/sandbox/invite?code=${code}`).then((r) => r.json())) as object).toMatchObject({ status: "used_up" });
    // The owner, already in the organization, takes no place and keeps their role.
    expect((await olive.api("POST", "/api/v1/sandbox/join", { code })).body).toMatchObject({ already: true, role: "owner", appears_as: null });
    expect((await settings()).seats).toEqual({ used: 2, limit: 3 });
  });

  it("holds no more visitors than it has seats", async () => {
    await set({ max_visitors: 2 });
    const inv = await olive.api("POST", `${T}/sandbox/invites`, { label: "Sample workshop", places: 50 });
    expect(inv.body.warnings[0]).toMatch(/0 of its 2 seats free/);
    const second = String(inv.body.invite_link).split("/join/")[1]!;
    const extra = await h.signIn("extra@visitor.example", "Extra Person", `/join/${second}`);
    const refused = await extra.api("POST", "/api/v1/sandbox/join", { code: second });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "sandbox_full", details: { quota: "max_visitors", limit: 2, used: 2 } });
    await set({ max_visitors: 200 });
    const revoked = await olive.api("POST", `${T}/sandbox/invites/revoke`, { invite_id: inv.body.invite_id });
    expect(revoked.body.status).toBe("revoked");
    expect((await extra.api("POST", "/api/v1/sandbox/join", { code: second })).body.error.code).toBe("invite_revoked");
  });

  it("lets a visitor read and write content, under a made-up name", async () => {
    const status = (await vera.api("GET", `${T}/sandbox`)).body;
    expect(status.you).toMatchObject({ role: "visitor", appears_as: visitorName(tenantId, (await vera.api("GET", "/api/v1/me")).body.account_id) });
    expect(status.notice).toMatch(/Other visitors see what you add, under a made-up name\..*Don’t add anything private/);
    const product = await vera.api("GET", P);
    expect(product.body).toMatchObject({ your_role: "editor", tenant: { sandbox: true } });
    const made = await vera.api("POST", `${P}/outcomes`, { title: "Try the hand-off" });
    expect(made.status).toBe(201);
    expect(made.body.created_by.display_name).toMatch(VISITOR);
    const record = await upload(vera, P, "mine.md", "# Mine\n\nA visitor's own notes.\n", "Sample notes a visitor added");
    await h.worker.drain();
    const assumption = await vera.api("POST", `${P}/assumptions`, { statement: "Visitors read the notes first.", citations: [{ record_id: record, seq_start: 1, seq_end: 1 }] });
    expect(assumption.status).toBe(201);
    const everything = JSON.stringify([
      (await viktor.api("GET", `${P}/activity`)).body,
      (await viktor.api("GET", `${P}/sources/${record}`)).body,
      (await viktor.api("GET", `${P}/assumptions/${assumption.body.id}`)).body,
      (await viktor.api("GET", `${P}/outcomes`)).body,
    ]);
    expect(everything).toContain(made.body.created_by.display_name);
    expect(everything).not.toMatch(/vera/i);
    // In the rows themselves, too: the name was never written.
    const stored = JSON.stringify(await contentOf(tenantId));
    expect(stored).not.toMatch(/vera/i);
    expect(stored).not.toContain("visitor.example");
  });

  it("shows a visitor no other person, and its staff everyone", async () => {
    const seen = await viktor.api("GET", `${T}/members`);
    expect(seen.status).toBe(200);
    expect(seen.body.members).toHaveLength(1);
    expect(seen.body.members[0]).toMatchObject({ email: "", grants: [{ scope_type: "tenant", role: "visitor" }] });
    expect(seen.body.members[0].display_name).toMatch(VISITOR);
    expect(seen.body.invitations).toEqual([]);
    expect(seen.body.sandbox).toEqual({ only_you: true });
    expect(JSON.stringify(seen.body)).not.toMatch(/olive|vera|staff\.example/i);
    const onProduct = await viktor.api("GET", `${T}/members?team=${team}&product=showcase`);
    expect(onProduct.body.members).toHaveLength(1);
    expect(onProduct.body.members[0].product_access).toEqual({ role: "editor", via: "tenant" });
    expect((await viktor.api("GET", `${T}/sandbox/visitors`)).status).toBe(403);

    const staff = await olive.api("GET", `${T}/members`);
    expect(staff.body.members.map((m: { email: string }) => m.email)).toEqual(["olive@staff.example"]);
    expect(staff.body.sandbox).toEqual({ only_you: false, visitors: 2 });
    const visitors = await olive.api("GET", `${T}/sandbox/visitors`);
    expect(visitors.body.items.map((v: { email: string }) => v.email).sort()).toEqual(["vera@visitor.example", "viktor@visitor.example"]);
    const name = visitors.body.items.find((v: { email: string }) => v.email === "vera@visitor.example").appears_as;
    // A name in the content leads its staff to the person.
    expect((await olive.api("GET", `${T}/sandbox/visitors?query=${encodeURIComponent(name)}`)).body.items.map((v: { email: string }) => v.email)).toEqual(["vera@visitor.example"]);
    expect((await olive.api("GET", `${T}/sandbox/visitors?query=viktor`)).body.items).toHaveLength(1);
    // A visitor given a role on a team as well is still a visitor: counted, not listed.
    const veraId = (await vera.api("GET", "/api/v1/me")).body.account_id;
    expect((await olive.api("POST", `${T}/members`, { email: "vera@visitor.example", role: "viewer", team })).status).toBe(201);
    const withRole = await olive.api("GET", `${T}/members`);
    expect(withRole.body.members.map((m: { email: string }) => m.email)).toEqual(["olive@staff.example"]);
    expect(withRole.body.sandbox).toEqual({ only_you: false, visitors: 2 });
    expect(JSON.stringify((await olive.api("GET", `${T}/members?team=${team}&product=showcase`)).body)).not.toContain(veraId);
    expect((await olive.api("POST", `${T}/members/revoke`, { account_id: veraId, team })).status).toBe(200);
    const paged = await olive.api("GET", `${T}/sandbox/visitors?limit=1`);
    expect(paged.body.items).toHaveLength(1);
    expect((await olive.api("GET", `${T}/sandbox/visitors?limit=1&cursor=${paged.body.next_cursor}`)).body.next_cursor).toBeNull();
  });

  it("lets a visitor administer nothing", async () => {
    const etag = (await vera.api("GET", P)).body.etag;
    const refused: [string, string, unknown][] = [
      ["PATCH", P, { expected_etag: etag, name: "Mine now" }],
      ["POST", `${P}/archive`, { expected_etag: etag }],
      ["POST", `/api/v1/teams/${org}/${team}/products`, { name: "Another" }],
      ["POST", `${T}/teams`, { name: "Another team" }],
      ["POST", `${T}/members`, { email: "friend@visitor.example", role: "viewer", team }],
      ["POST", `${T}/members/revoke`, { account_id: (await olive.api("GET", "/api/v1/me")).body.account_id }],
      ["GET", `${T}/sandbox/settings`, undefined],
      ["PATCH", `${T}/sandbox/settings`, { expected_etag: "x", max_visitors: 9999 }],
      ["POST", `${T}/sandbox/baselines`, {}],
      ["GET", `${T}/sandbox/baselines`, undefined],
      ["POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox" }],
      ["GET", `${T}/sandbox/invites`, undefined],
      ["POST", `${T}/sandbox/invites`, { label: "Mine", places: 100 }],
      ["POST", `${T}/sandbox/visitors/remove`, { account_id: "x" }],
      ["GET", `${T}/members/activity`, undefined],
    ];
    for (const [method, path, body] of refused) {
      const r = await vera.api(method, path, body);
      expect(r.status, `${method} ${path} → ${JSON.stringify(r.body)}`).toBe(403);
    }
    // Permanent delete needs admin, which a visitor never is; archive is what they have.
    const impact = await vera.api("GET", `${P}/sources/${seededSource}/delete-impact`);
    const del = await vera.api("DELETE", `${P}/sources/${seededSource}`, { expected_etag: impact.body.etag, reason: "tidying", confirm: "delete permanently" });
    expect(del.status).toBe(403);
    expect(del.body.error).toMatchObject({ code: "forbidden", details: { role: "editor", needed: "admin" } });
    expect((await vera.api("GET", `${P}/sources/${seededSource}`)).status).toBe(200);
  });

  it("treats anyone but its owners and admins as a visitor, whatever role they were given", async () => {
    await olive.api("POST", `${T}/members`, { email: "colleague@staff.example", role: "admin", team });
    const colleague = await h.signIn("colleague@staff.example", "Casey Colleague");
    expect((await colleague.api("GET", P)).body.your_role).toBe("editor");
    expect((await colleague.api("POST", `${P}/archive`, { expected_etag: "x" })).status).toBe(403);
    expect((await colleague.api("GET", `${T}/members`)).body.members).toHaveLength(1);
    const made = await colleague.api("POST", `${P}/outcomes`, { title: "From a colleague" });
    expect(made.body.created_by.display_name).toMatch(VISITOR);
    // Treated as a visitor is, and told so truthfully: a member, not a visitor.
    const status = (await colleague.api("GET", `${T}/sandbox`)).body;
    expect(status.you).toMatchObject({ role: "member", appears_as: made.body.created_by.display_name });
    expect(status.you.can).toMatch(/made-up name/);
    expect(status.notice).toMatch(/Everyone here sees what you add, under a made-up name/);
    expect(status.notice).not.toMatch(/Other visitors/);
    expect(status.allowances.find((a: { key: string }) => a.key === "writes_per_day").used).toBeGreaterThan(0);
    const viaAgent = new Client({ name: "colleague-agent", version: "1.0.0" });
    await viaAgent.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(colleague, "Colleague Agent")}` } } }));
    const overMcp = await viaAgent.callTool({ name: "sandbox", arguments: { action: "status", params: { tenant: org } } });
    expect(JSON.parse((overMcp as { content: { text: string }[] }).content[0]!.text).you.role).toBe("member");
    await viaAgent.close();
    // Its staff are told what is true for them: their own name, not a made-up one.
    const own = (await olive.api("GET", `${T}/sandbox`)).body;
    expect(own.notice).toMatch(/Visitors see what you add, under your own name/);
    // Made an admin of the organization, they are staff, under their own name.
    await olive.api("POST", `${T}/members`, { email: "colleague@staff.example", role: "admin" });
    expect((await colleague.api("GET", P)).body.your_role).toBe("admin");
    expect((await colleague.api("POST", `${P}/outcomes`, { title: "From staff" })).body.created_by.display_name).toBe("Casey Colleague");
    await olive.api("POST", `${T}/members/revoke`, { account_id: (await colleague.api("GET", "/api/v1/me")).body.account_id, whole_tenant: true });
  });

  it("tells a member who reads only the Story that they read it and write nothing", async () => {
    expect((await olive.api("POST", `${T}/members`, { email: "stakeholder@staff.example", role: "reader", team })).status).toBe(201);
    const reader = await h.signIn("stakeholder@staff.example", "Sam Stakeholder");
    const status = (await reader.api("GET", `${T}/sandbox`)).body;
    expect(status.you).toMatchObject({ role: "member", appears_as: null, story_only: true });
    expect(status.you.can).toMatch(/Read the Story/);
    expect(status.you.can).toMatch(/write nothing/);
    expect(status.notice).toMatch(/You can only read the Story here/);
    expect(status.notice).not.toMatch(/what you add/);
    // Anyone who may write is told what others see of it, as before.
    expect((await vera.api("GET", `${T}/sandbox`)).body.you.story_only).toBeUndefined();
    await olive.api("POST", `${T}/members/revoke`, { account_id: (await reader.api("GET", "/api/v1/me")).body.account_id, whole_tenant: true });
  });
});

describe("limits on what a visitor does", () => {
  it("counts writes by the minute, leaves reads alone, and says when to come back", async () => {
    await set({ writes_per_minute: 2 });
    const statuses: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let last: { status: number; body: any; headers: Headers } | null = null;
    // Viktor has written nothing this minute; a minute may turn over during the run, so a third write is allowed for.
    for (let i = 0; i < 5; i++) {
      last = await viktor.api("POST", `${P}/outcomes`, { title: `Outcome ${i}` });
      statuses.push(last.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    expect(statuses.slice(0, 2)).toEqual([201, 201]);
    expect(last!.status).toBe(429);
    expect(last!.body.error).toMatchObject({ code: "rate_limited", details: { limit: 2, per: "minute" } });
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await viktor.api("GET", `${P}/outcomes`)).status).toBe(200);
    // Its staff are not limited.
    for (let i = 0; i < 4; i++) expect((await olive.api("POST", `${P}/outcomes`, { title: `Staff outcome ${i}` })).status).toBe(201);
    await set({ writes_per_minute: 1000 });
  });

  it("counts calls by the minute, reads included", async () => {
    await set({ requests_per_minute: 0 });
    const r = await viktor.api("GET", `${P}/outcomes`);
    expect(r.status).toBe(429);
    expect(r.body.error.message).toMatch(/0 calls a minute/);
    // A call that names no organization is counted too, for an account the sandbox let in.
    expect((await vera.api("GET", "/api/v1/me/products")).status).toBe(429);
    expect((await olive.api("GET", "/api/v1/me/products")).status).toBe(200);
    await set({ requests_per_minute: 100000 });
    expect((await vera.api("GET", "/api/v1/me/products")).status).toBe(200);
  });

  it("gives each visitor a day's allowance of writes and of sources, and refuses beyond it without touching a read", async () => {
    const before = (await viktor.api("GET", `${T}/sandbox`)).body.allowances.find((a: { key: string }) => a.key === "writes_per_day").used;
    await set({ writes_per_day: before + 1 });
    expect((await viktor.api("POST", `${P}/outcomes`, { title: "The last one today" })).status).toBe(201);
    const over = await viktor.api("POST", `${P}/outcomes`, { title: "One too many" });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "writes_per_day", limit: before + 1, used: before + 1, unit: "writes" } });
    expect(Date.parse(over.body.error.details.resets_at)).toBeGreaterThan(Date.now());
    // A refused write took nothing from the allowance, and reads and search go on.
    expect((await viktor.api("GET", `${T}/sandbox`)).body.allowances.find((a: { key: string }) => a.key === "writes_per_day").used).toBe(before + 1);
    expect((await viktor.api("GET", `${P}/search?query=crews`)).status).toBe(200);
    // Visitors export nothing until staff allow it; then the day's writes do not stop it.
    await set({ exports_per_day: 1 });
    expect((await viktor.api("POST", `${P}/exports`, {})).status).toBe(201);
    await h.worker.drain();
    await set({ writes_per_day: 100000, sources_per_day: 1 });
    const used = (await viktor.api("GET", `${T}/sandbox`)).body.allowances.find((a: { key: string }) => a.key === "sources_per_day").used;
    await set({ sources_per_day: Math.max(used, 1) });
    if (used === 0) expect((await viktor.api("POST", `${P}/sources`, { title: "Sample source within the allowance" })).status).toBe(201);
    const source = await viktor.api("POST", `${P}/sources`, { title: "Sample source over the allowance" });
    expect(source.status).toBe(409);
    expect(source.body.error.details).toMatchObject({ quota: "sources_per_day", limit: Math.max(used, 1), used: Math.max(used, 1) });
    await set({ sources_per_day: 100 });
    const again = await viktor.api("POST", `${P}/exports`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.details).toMatchObject({ quota: "exports_per_day", limit: 1, used: 1 });
    await set({ exports_per_day: 10 });
  });

  it("refuses what a daily allowance of 0 switches off as off, not as an allowance used up", async () => {
    await set({ exports_per_day: 0 });
    const off = await viktor.api("POST", `${P}/exports`, {});
    expect(off.status).toBe(403);
    expect(off.body.error).toMatchObject({ code: "sandbox_restricted", details: { setting: "exports_per_day", limit: 0 } });
    expect(off.body.error.message).toMatch(/Exporting a product is off for visitors/);
    expect(off.body.error.message).not.toMatch(/starts again/);
    expect(off.body.error.message).not.toMatch(/products\.export/);
    // What sandbox.status tells visitors matches: an allowance of 0 is refused as restricted.
    const allowances = (await viktor.api("GET", `${T}/sandbox`)).body.allowances as { key: string; refusal: string }[];
    expect(allowances.find((a) => a.key === "exports_per_day")?.refusal).toBe("403 sandbox_restricted");
    expect(allowances.find((a) => a.key === "sources_per_day")?.refusal).toBe("409 quota_exceeded");
    // Read-only access does not change how a switched-off export is refused.
    await set({ visitor_access: "read" });
    expect((await viktor.api("POST", `${P}/exports`, {})).body.error.code).toBe("sandbox_restricted");
    await set({ visitor_access: "write", sources_per_day: 0 });
    const source = await viktor.api("POST", `${P}/sources`, { title: "Sample source while sources are off" });
    expect(source.status).toBe(403);
    expect(source.body.error).toMatchObject({ code: "sandbox_restricted", details: { setting: "sources_per_day" } });
    await set({ sources_per_day: 100, writes_per_day: 0 });
    const write = await viktor.api("POST", `${P}/outcomes`, { title: "While writing is off" });
    expect(write.status).toBe(403);
    expect(write.body.error.message).toMatch(/Writing is off for visitors/);
    await set({ writes_per_day: 100000, bytes_per_day: 0 });
    const file = await viktor.api("POST", `${P}/sources/${seededSource}/uploads`, { path: "more.md", role: "supplement", size: 10 });
    expect(file.status).toBe(403);
    expect(file.body.error.details).toMatchObject({ setting: "bytes_per_day" });
    // Reads go on, and staff are not visitors.
    expect((await viktor.api("GET", `${P}/outcomes`)).status).toBe(200);
    expect((await olive.api("POST", `${P}/exports`, {})).status).toBe(201);
    await h.worker.drain();
    await set({ bytes_per_day: SANDBOX_DEFAULTS.bytes_per_day, exports_per_day: 10 });
  });

  it("limits how much one call carries", async () => {
    await set({ text_max_chars: 50, batch_max: 1 });
    const long = await viktor.api("POST", `${P}/assumptions`, { statement: "Too long", body: "x".repeat(51) });
    expect(long.status).toBe(413);
    expect(long.body.error.details).toMatchObject({ field: "body", limit: 50, unit: "characters" });
    const batch = await viktor.api("POST", `${P}/sources/archive`, { record_ids: [seededSource, "01ARZ3NDEKTSV4RRFFQ69G5FAV"] });
    expect(batch.status).toBe(413);
    expect(batch.body.error.details).toMatchObject({ field: "record_ids", limit: 1 });
    expect((await olive.api("POST", `${P}/assumptions`, { statement: "Staff write at length", body: "x".repeat(500) })).status).toBe(201);
    await set({ text_max_chars: SANDBOX_DEFAULTS.text_max_chars, batch_max: SANDBOX_DEFAULTS.batch_max });
  });

  it("limits what a visitor uploads: the kind of file, its size, and the day's bytes", async () => {
    const recording = await viktor.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Sample recording", path: "call.m4a", role: "primary" });
    expect(recording.status).toBe(403);
    expect(recording.body.error.code).toBe("sandbox_restricted");
    const fetched = await viktor.api("POST", `${P}/sources/${seededSource}/fetch`, { url: "https://example.com/notes.txt", role: "supplement" });
    expect(fetched.status).toBe(403);
    expect(fetched.body.error.message).toMatch(/Fetching a file from a URL is off/);

    await set({ file_max_bytes: 100 });
    const declared = await viktor.api("POST", `${P}/sources/${seededSource}/uploads`, { path: "big.md", role: "supplement", size: 101 });
    expect(declared.status).toBe(413);
    const grant = await viktor.api("POST", `${P}/sources/${seededSource}/uploads`, { path: "big.md", role: "supplement" });
    expect(grant.status).toBe(201);
    expect(grant.body.max_bytes).toBe(100);
    expect(grant.body.direct).toBeUndefined();
    // The relay enforces the size as the bytes arrive, whatever the caller declared.
    const tooBig = await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "y".repeat(101) });
    expect(tooBig.status).toBe(413);
    const fits = await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "y".repeat(100) });
    expect(fits.status).toBe(201);
    const used = (await viktor.api("GET", `${T}/sandbox`)).body.allowances.find((a: { key: string }) => a.key === "bytes_per_day").used;
    expect(used).toBe(100);

    await set({ file_max_bytes: 1000, bytes_per_day: 150 });
    const rest = await viktor.api("POST", `${P}/sources/${seededSource}/uploads`, { path: "more.md", role: "supplement" });
    expect(rest.body.max_bytes).toBe(50);
    await set({ bytes_per_day: 100 });
    const none = await viktor.api("POST", `${P}/sources/${seededSource}/uploads`, { path: "none.md", role: "supplement" });
    expect(none.status).toBe(409);
    expect(none.body.error.details).toMatchObject({ quota: "bytes_per_day", limit: 100, used: 100, unit: "bytes" });
    await set({ file_max_bytes: SANDBOX_DEFAULTS.file_max_bytes, bytes_per_day: SANDBOX_DEFAULTS.bytes_per_day });
    expect((await settings()).today).toMatchObject({ bytes: 131, visitors_writing: 3 });
  });

  it("applies the same limits to a visitor's agent", async () => {
    const token = await h.connectAgent(viktor, "Sample Agent");
    const client = new Client({ name: "sample-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
    const made = await client.callTool({ name: "outcomes", arguments: { action: "create", params: { title: "From an agent" } } });
    const body = JSON.parse(text(made));
    expect(body.created_by).toMatchObject({ surface: "mcp", client: "Sample Agent" });
    expect(body.created_by.display_name).toMatch(VISITOR);
    expect(body.scope).toMatchObject({ your_role: "editor", public_sandbox: true });
    const status = JSON.parse(text(await client.callTool({ name: "sandbox", arguments: { action: "status", params: { tenant: org } } })));
    expect(status.you.role).toBe("visitor");
    await set({ writes_per_minute: 0 });
    const refused = await client.callTool({ name: "outcomes", arguments: { action: "create", params: { title: "Too fast" } } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/^429: This public sandbox allows each visitor 0 writes a minute/);
    await set({ writes_per_minute: 1000, visitor_agents: false });
    const off = await client.callTool({ name: "outcomes", arguments: { action: "list" } });
    expect(text(off)).toMatch(/^403: Agents are turned off for visitors/);
    expect((await viktor.api("GET", `${P}/outcomes`)).status).toBe(200);
    await set({ visitor_agents: true });
    await client.close();
  });

  it("can leave visitors reading, or close to them, without taking a seat", async () => {
    const file = () => fetch(`${h.baseUrl}${P}/sources/${seededSource}/file?path=visit.md`, { headers: { cookie: vera.cookie } });
    const early = await vera.api("POST", `${P}/sources/${seededSource}/uploads`, { path: "early.md", role: "supplement" });
    expect(early.status).toBe(201);
    await set({ visitor_access: "read" });
    const write = await vera.api("POST", `${P}/outcomes`, { title: "Not now" });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("sandbox_read_only");
    expect((await vera.api("GET", `${P}/outcomes`)).status).toBe(200);
    expect((await file()).status).toBe(200);
    expect((await vera.api("POST", `${P}/exports`, {})).status).toBe(201);
    await h.worker.drain();
    // A grant given before writes stopped takes no bytes after.
    const late = await fetch(early.body.url, { method: "PUT", headers: early.body.headers, body: "too late" });
    expect(late.status).toBe(403);
    expect(((await late.json()) as { error: { code: string } }).error.code).toBe("sandbox_read_only");
    await set({ visitor_access: "closed" });
    const closed = await vera.api("GET", `${P}/outcomes`);
    expect(closed.status).toBe(403);
    expect(closed.body.error.code).toBe("sandbox_closed");
    // The routes that serve bytes are closed with the rest.
    expect((await file()).status).toBe(403);
    expect((await fetch(`${h.baseUrl}${P}/story/print`, { headers: { cookie: vera.cookie } })).status).toBe(403);
    // What the sandbox is can still be asked, and its staff work on.
    expect((await vera.api("GET", `${T}/sandbox`)).body.visitor_access).toBe("closed");
    expect((await olive.api("GET", `${P}/outcomes`)).status).toBe(200);
    expect((await settings()).seats.used).toBe(2);
    await set({ visitor_access: "write" });
  });
});

describe("the baseline and the reset", () => {
  let baseline: Record<string, string[]>;
  let elsewhere: Record<string, string[]>;
  let elsewhereId: string;
  let baselineBlobs: string[];

  it("does nothing on schedule until a baseline is saved", async () => {
    await h.db.updateTable("sandbox_settings").set({ last_reset_at: null }).where("tenant_id", "=", tenantId).execute();
    h.clock.touch();
    const r = await fetch(`${h.baseUrl}/api/v1/sandbox/reset-if-due`, { method: "POST" });
    expect(await r.json()).toEqual({ reset: false, sandboxes: 0 });
    const refused = await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("no_baseline");
  });

  it("saves the organization's content as a baseline", async () => {
    // Start from what its staff made: visitors' additions are archived or left, as the owner chooses.
    await h.worker.drain();
    const saved = await olive.api("POST", `${T}/sandbox/baselines`, { note: "Sample content for visitors" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ in_use: true, note: "Sample content for visitors", holds: { products: 1 } });
    expect(saved.body.holds.sources).toBeGreaterThanOrEqual(2);
    expect(saved.body.holds.passages).toBeGreaterThan(0);
    baseline = await contentOf(tenantId);
    // Every file and parse the baseline refers to. A visitor's export is not among them: it does not outlive a reset.
    baselineBlobs = [...h.blobs.blobs.keys()].filter((k) => k.startsWith(`t/${tenantId}/r/`));
    expect(baselineBlobs.length).toBeGreaterThan(0);
    expect([...h.blobs.blobs.keys()].some((k) => k.startsWith(`t/${tenantId}/exports/`))).toBe(true);
    elsewhereId = (await h.db.selectFrom("tenants").select("tenant_id").where("slug", "=", "elsewhere").executeTakeFirstOrThrow()).tenant_id;
    elsewhere = await contentOf(elsewhereId);
    const panel = await settings();
    expect(panel.baseline).toMatchObject({ baseline_id: saved.body.baseline_id, in_use: true });
    expect(Date.parse(panel.resets.next_at)).toBeGreaterThan(Date.now());
    expect((await olive.api("GET", `${T}/sandbox/baselines`)).body.items).toHaveLength(1);
  });

  it("puts everything back exactly, keeps people where they were, and touches no other organization", async () => {
    // Visitors and staff change things every way they can.
    const added = await vera.api("POST", `${P}/outcomes`, { title: "Added after the baseline" });
    const assumptions = (await vera.api("GET", `${P}/assumptions`)).body.items;
    const edited = await vera.api("PATCH", `${P}/assumptions/${assumptions[0].id}`, { expected_etag: assumptions[0].etag, body: "Rewritten by a visitor." });
    expect(edited.status).toBe(200);
    await vera.api("POST", `${P}/sources/archive`, { record_ids: [seededSource] });
    const mine = await upload(vera, P, "after.md", "# After\n\nUploaded after the baseline.\n", "Sample upload after the baseline");
    await h.worker.drain();
    const product = await olive.api("POST", `/api/v1/teams/${org}/${team}/products`, { name: "Made after the baseline" });
    await olive.api("POST", `${T}/members`, { email: "vera@visitor.example", role: "viewer", team, product: product.body.slug });
    const visitorBlobs = [...h.blobs.blobs.keys()].filter((k) => k.startsWith(`t/${tenantId}/`) && !baselineBlobs.includes(k));
    expect(visitorBlobs.length).toBeGreaterThan(0);
    expect(await contentOf(tenantId)).not.toEqual(baseline);

    expect((await olive.api("POST", `${T}/sandbox/reset`, { confirm: "yes" })).status).toBe(422);
    const reset = await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox" });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(reset.body).toMatchObject({ reset: true, scheduled: false, grants_removed: 1, visitors_removed: 0 });
    expect(reset.body.blobs_dropped).toBeGreaterThan(0);

    expect(await contentOf(tenantId)).toEqual(baseline);
    expect(await contentOf(elsewhereId)).toEqual(elsewhere);
    expect((await vera.api("GET", `${P}/outcomes/${added.body.outcome_id}`)).status).toBe(404);
    expect((await vera.api("GET", `${P}/sources/${mine}`)).status).toBe(404);
    expect((await vera.api("GET", `${P}/sources/${seededSource}`)).body.archived_at).toBeNull();
    expect((await vera.api("GET", `${P}/search?query=crisis`)).body.hits).toHaveLength(1);
    expect((await olive.api("GET", `/api/v1/p/${product.body.path}`)).status).toBe(404);

    // The bytes visitors added go; the baseline's stay, and its files still download.
    await h.worker.drain();
    const left = [...h.blobs.blobs.keys()].filter((k) => k.startsWith(`t/${tenantId}/`));
    expect(left.sort()).toEqual([...baselineBlobs].sort());
    const file = await fetch(`${h.baseUrl}${P}/sources/${seededSource}/file?path=visit.md`, { headers: { cookie: vera.cookie } });
    expect(file.status).toBe(200);
    expect(await file.text()).toContain("Nobody called it a crisis");

    // People are as they were, and the day's allowances start again.
    const panel = await settings();
    expect(panel.seats.used).toBe(2);
    expect(panel.today).toMatchObject({ writes: 0, bytes: 0 });
    expect(panel.resets.last).toMatchObject({ scheduled: false, by: { display_name: "Olive Owner" } });
    expect((await vera.api("GET", `${T}/sandbox`)).body.allowances.find((a: { key: string }) => a.key === "writes_per_day").used).toBe(0);
  });

  it("resets by itself once the hour has passed, before the request that finds it is served", async () => {
    const made = await vera.api("POST", `${P}/outcomes`, { title: "Yesterday's addition" });
    expect(made.status).toBe(201);
    // As if the last reset were two days ago: the scheduled hour has passed since.
    await h.db.updateTable("sandbox_settings").set({ last_reset_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).where("tenant_id", "=", tenantId).execute();
    h.clock.touch();
    expect((await settings()).resets.due).toBe(false); // that very request ran it
    expect((await vera.api("GET", `${P}/outcomes/${made.body.outcome_id}`)).status).toBe(404);
    expect(await contentOf(tenantId)).toEqual(baseline);
    expect((await settings()).resets.last).toMatchObject({ scheduled: true, by: { display_name: "WhatBuild" } });
    // Once a day: nothing more is due.
    await vera.api("POST", `${P}/outcomes`, { title: "Today's addition" });
    h.clock.touch();
    expect(await (await fetch(`${h.baseUrl}/api/v1/sandbox/reset-if-due`, { method: "POST" })).json()).toEqual({ reset: false, sandboxes: 0 });
    expect((await vera.api("GET", `${P}/outcomes`)).body.items.map((o: { title: string }) => o.title)).toContain("Today's addition");
  });

  it("leaves the sandbox alone when resets are turned off", async () => {
    await set({ reset_enabled: false });
    await h.db.updateTable("sandbox_settings").set({ last_reset_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).where("tenant_id", "=", tenantId).execute();
    h.clock.touch();
    expect(await (await fetch(`${h.baseUrl}/api/v1/sandbox/reset-if-due`, { method: "POST" })).json()).toEqual({ reset: false, sandboxes: 0 });
    expect((await vera.api("GET", `${P}/outcomes`)).body.items.map((o: { title: string }) => o.title)).toContain("Today's addition");
    expect((await settings()).resets).toMatchObject({ enabled: false, next_at: null });
    await set({ reset_enabled: true });
    h.clock.touch();
    expect((await vera.api("GET", `${P}/outcomes`)).body.items.map((o: { title: string }) => o.title)).not.toContain("Today's addition");
  });

  it("keeps the bytes of a source its staff deleted while a baseline would bring it back", async () => {
    const impact = await olive.api("GET", `${P}/sources/${seededSource}/delete-impact`);
    const del = await olive.api("DELETE", `${P}/sources/${seededSource}`, { expected_etag: impact.body.etag, reason: "sample", confirm: "delete permanently" });
    expect(del.status).toBe(200);
    await h.worker.drain();
    expect([...h.blobs.blobs.keys()].filter((k) => k.startsWith(`t/${tenantId}/`)).sort()).toEqual([...baselineBlobs].sort());
    await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox" });
    expect(await contentOf(tenantId)).toEqual(baseline);
    expect((await vera.api("GET", `${P}/sources/${seededSource}/passage?start=0&end=1&unit=seq`)).status).toBe(200);
  });

  it("keeps the newest baselines, goes back to an earlier one, and drops bytes only the oldest held", async () => {
    const second = await upload(olive, P, "second.md", "# Second\n\nIn the second baseline only.\n", "Sample source in the second baseline");
    await h.worker.drain();
    const b2 = (await olive.api("POST", `${T}/sandbox/baselines`, { note: "With a second source" })).body;
    const withSecond = await contentOf(tenantId);
    const first = (await olive.api("GET", `${T}/sandbox/baselines`)).body.items.at(-1);
    expect(first.in_use).toBe(false);
    // Back to the first: the second source goes, and its bytes stay because the second baseline holds them.
    const back = await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox", baseline_id: first.baseline_id });
    expect(back.body).toMatchObject({ baseline_id: first.baseline_id, blobs_dropped: 0 });
    expect(await contentOf(tenantId)).toEqual(baseline);
    expect((await olive.api("GET", `${P}/sources/${second}`)).status).toBe(404);
    await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox", baseline_id: b2.baseline_id });
    expect(await contentOf(tenantId)).toEqual(withSecond);
    expect((await olive.api("GET", `${P}/sources/${second}/passage?start=0&end=1&unit=seq`)).status).toBe(200);
    expect((await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox", baseline_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).status).toBe(404);

    // Three are kept. Archiving is content too, so each of these differs from the last.
    await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox", baseline_id: first.baseline_id });
    for (const note of ["third", "fourth", "fifth"]) expect((await olive.api("POST", `${T}/sandbox/baselines`, { note })).status).toBe(200);
    const kept = (await olive.api("GET", `${T}/sandbox/baselines`)).body.items;
    expect(kept.map((b: { note: string }) => b.note)).toEqual(["fifth", "fourth", "third"]);
    await h.worker.drain();
    // The second source's bytes were held only by the baseline that was dropped.
    expect([...h.blobs.blobs.keys()].filter((k) => k.startsWith(`t/${tenantId}/`)).sort()).toEqual([...baselineBlobs].sort());
  });

  it("takes the seat of a visitor who has been away too long, at a reset", async () => {
    const ids = await h.db.selectFrom("accounts").select(["account_id", "email"]).where("email", "in", ["vera@visitor.example", "viktor@visitor.example"]).execute();
    const viktorId = ids.find((a) => a.email === "viktor@visitor.example")!.account_id;
    const long = new Date(Date.now() - 40 * 86400_000).toISOString();
    await h.db.updateTable("memberships").set({ created_at: long }).where("tenant_id", "=", tenantId).where("role", "=", "visitor").execute();
    await h.db.updateTable("sessions").set({ last_seen_at: long }).where("account_id", "=", viktorId).execute();
    await h.db.updateTable("oauth_tokens").set({ last_used_at: long, created_at: long }).where("account_id", "=", viktorId).execute();
    const reset = await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox" });
    expect(reset.body.visitors_removed).toBe(1);
    expect((await settings()).seats.used).toBe(1);
    expect((await olive.api("GET", `${T}/sandbox/visitors`)).body.items.map((v: { email: string }) => v.email)).toEqual(["vera@visitor.example"]);
    expect((await vera.api("GET", P)).status).toBe(200);
  });

  it("lets its staff take a visitor's seat away", async () => {
    const veraId = (await vera.api("GET", "/api/v1/me")).body.account_id;
    const removed = await olive.api("POST", `${T}/sandbox/visitors/remove`, { account_id: veraId });
    expect(removed.body).toMatchObject({ removed: true, seats: { used: 0 } });
    expect(removed.body.appears_as).toMatch(VISITOR);
    expect((await vera.api("GET", P)).status).toBe(404);
    expect((await olive.api("POST", `${T}/sandbox/visitors/remove`, { account_id: veraId })).status).toBe(404);
  });

  it("keeps its staff an access log through every reset, naming a visitor only by their made-up name", async () => {
    const log = await olive.api("GET", `${T}/members/activity?limit=200`);
    expect(log.status, JSON.stringify(log.body)).toBe(200);
    const items: { entity_type: string; action: string; entity_title: string | null; actor: { display_name: string } }[] = log.body.items;
    // The removal above, the invitations made before the resets, and a role given before them.
    expect(items[0]).toMatchObject({ entity_type: "sandbox", action: "revoked", actor: { display_name: "Olive Owner" } });
    expect(items[0]!.entity_title).toMatch(VISITOR);
    expect(items.some((i) => i.entity_type === "sandbox" && i.action === "invited")).toBe(true);
    expect(items.some((i) => i.entity_type === "membership" && i.action === "granted")).toBe(true);
    // Only access: no baseline or reset, and nothing that happened in a product.
    expect(items.every((i) => i.entity_type === "membership" || (i.entity_type === "sandbox" && ["invited", "invitation_cancelled", "revoked", "updated"].includes(i.action)))).toBe(true);
    // A settings change is named as the control panel names it, with its new value, never by its key.
    const changes = items.filter((i) => i.entity_type === "sandbox" && i.action === "updated").map((i) => (i as unknown as { summary: string }).summary);
    expect(changes).toContain("Changed the sandbox's settings: what visitors may do (read only).");
    for (const s of changes) expect(s).not.toMatch(/[a-z]_[a-z]/);
    const text = JSON.stringify(log.body);
    for (const hidden of ["vera@", "viktor@", "Vera", "Viktor"]) expect(text, hidden).not.toContain(hidden);
  });
});

describe("closing the sandbox", () => {
  it("takes every visitor's access with the deployment's setting, and leaves its staff theirs", async () => {
    const inv = await olive.api("POST", `${T}/sandbox/invites`, { label: "Sample last call", places: 5 });
    const last = String(inv.body.invite_link).split("/join/")[1]!;
    const guest = await h.signIn("guest@visitor.example", "Guest Person", `/join/${last}`);
    expect((await guest.api("POST", "/api/v1/sandbox/join", { code: last })).status).toBe(200);
    expect((await guest.api("GET", P)).status).toBe(200);

    expect(await syncSandboxTenant(h.db, null, () => {})).toBeNull();
    expect((await guest.api("GET", P)).status).toBe(404);
    expect((await guest.api("GET", `${T}/members`)).status).toBe(404);
    expect((await guest.api("GET", "/api/v1/me/products")).body.items).toHaveLength(0);
    expect((await fetch(`${h.baseUrl}/api/v1/sandbox/invite?code=${last}`)).status).toBe(404);
    expect((await olive.api("GET", P)).status).toBe(200);
    expect((await olive.api("GET", `${T}/sandbox`)).status).toBe(404);

    // Named again, it is as it was.
    await syncSandboxTenant(h.db, org, () => {});
    expect((await guest.api("GET", P)).body.your_role).toBe("editor");
    // A name that matches no organization makes none a sandbox.
    const warned: string[] = [];
    expect(await syncSandboxTenant(h.db, "no-such-organization", (m) => warned.push(m))).toBeNull();
    expect(warned[0]).toMatch(/no organization has that slug/);
    expect((await guest.api("GET", P)).status).toBe(404);
  });
});
