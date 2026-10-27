import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Each person has one Free organization: an allowance counts the ones they started that are still on
// the plan new organizations start on and not read-only, so one moved to Pro frees its place. A Pro
// organization moved back to Free while its creator already has their Free one is read-only instead,
// kept for a year: its people read, export, delete and take people out, and add nothing. Someone who
// may not start one asks, and joins the waitlist an instance owner reads.

let h: Harness;
let root: Browser; // an instance owner
let ana: Browser; // allowed one organization
let ned: Browser; // an editor in Ana's first
let first: { slug: string; team: string; P: string; source: string };
let second: { slug: string };
const etags = new Map<string, string>();

const L = "/api/v1/organizations/plan";

/** Move an organization to a plan as the instance owner, from the etag of the moment. */
async function move(slug: string, plan: "free" | "pro" | "unlimited") {
  const r = await root.api("PATCH", L, { tenant: slug, plan, ...(etags.has(slug) ? { expected_etag: etags.get(slug) } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  if (r.body.etag) etags.set(slug, r.body.etag);
  return r.body;
}

const orgOf = async (slug: string) => (await root.api("GET", "/api/v1/organizations")).body.items.find((o: { slug: string }) => o.slug === slug);
const start = (who: Browser, name: string) => who.api("POST", "/api/v1/tenants", { name });

beforeAll(async () => {
  h = await startHarness({ signupAllowlist: ["@example.com"], instanceOwners: ["root@example.com"], defaultTenantAllowance: 0, newOrganizationPlan: "free" });
  root = await h.signIn("root@example.com", "Root Owner");
  expect((await root.api("PUT", "/api/v1/tenant-allowances", { email: "ana@example.com", allowed: 1, notify: false })).status).toBe(200);
  ana = await h.signIn("ana@example.com", "Ana Owner");
  const t = await start(ana, "Ana Works");
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  const P = `/api/v1/p/${(await ana.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Field Notes" })).body.path}`;
  const source = (await ana.api("POST", `${P}/sources`, { title: "Sample interview", tags: ["notes"] })).body.record_id;
  first = { slug: t.body.tenant.slug, team: t.body.team.slug, P, source };
  expect((await ana.api("POST", `/api/v1/tenants/${first.slug}/members`, { email: "ned@example.com", role: "editor", team: first.team })).status).toBe(201);
  ned = await h.signIn("ned@example.com", "Ned Editor");
}, 120_000);
afterAll(async () => h?.close());

describe("one Free organization each", () => {
  it("lets someone with an allowance of one start one Free organization, and no second", async () => {
    expect((await ana.api("GET", "/api/v1/me")).body.tenant_allowance).toMatchObject({ allowed: 1, created: 1, remaining: 0 });
    const refused = await start(ana, "Ana Two");
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({ code: "tenant_allowance", details: { allowed: 1, created: 1 } });
    expect(refused.body.error.message).toBe(
      "This account already has a Free organization, all it may have. Ask the people who run this WhatBuild to move it to another plan, which frees its place, or to let you have more.",
    );
  });

  it("frees the place when that organization moves to Pro, so its owner may start another", async () => {
    await move(first.slug, "pro");
    expect((await ana.api("GET", "/api/v1/me")).body.tenant_allowance).toMatchObject({ created: 0, remaining: 1 });
    const allowances = (await root.api("GET", "/api/v1/tenant-allowances")).body;
    expect(allowances.new_organization_plan).toBe("free");
    expect(allowances.items.find((a: { email: string }) => a.email === "ana@example.com")).toMatchObject({ allowed: 1, created: 0, remaining: 1 });
    const t = await start(ana, "Ana Two");
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.tenant.plan).toBe("free");
    second = { slug: t.body.tenant.slug };
  });
});

describe("a Pro organization no longer paid for", () => {
  it("is marked beforehand as one that Free would make read-only, when its creator has their Free one", async () => {
    expect(await orgOf(first.slug)).toMatchObject({ plan: "pro", starting_plan_is_read_only: true });
    expect((await orgOf(first.slug)).read_only).toBeUndefined();
    // Their Free one is counted, so nothing marks it.
    expect((await orgOf(second.slug)).starting_plan_is_read_only).toBeUndefined();
  });

  it("goes read-only rather than Free, kept for a year, and still frees its creator's place", async () => {
    const before = Date.now();
    const moved = await move(first.slug, "free");
    expect(moved).toMatchObject({ plan: "free", read_only: { since: expect.any(String), kept_until: expect.any(String) } });
    const kept = Date.parse(moved.read_only.kept_until) - Date.parse(moved.read_only.since);
    expect(kept).toBe(365 * 86_400_000);
    expect(Date.parse(moved.read_only.since)).toBeGreaterThanOrEqual(before - 1000);
    // Not counted: Ana still has her one Free organization, the second.
    expect((await ana.api("GET", "/api/v1/me")).body.tenant_allowance).toMatchObject({ created: 1, remaining: 0 });
    expect(await orgOf(first.slug)).toMatchObject({ plan: "free", read_only: moved.read_only });
    // Everyone in it reads that it is read-only, and until when.
    const listed = (await ned.api("GET", "/api/v1/me/products")).body.tenants.find((t: { slug: string }) => t.slug === first.slug);
    expect(listed).toMatchObject({ plan: "free", read_only: moved.read_only });
    expect((await ned.api("GET", `/api/v1/tenants/${first.slug}/limits`)).body).toMatchObject({ plan: "free", read_only: moved.read_only });
    expect((await ned.api("GET", first.P)).body.tenant).toMatchObject({ read_only: moved.read_only });
  });

  it("is read and exported by its people, and added to by nobody", async () => {
    expect((await ned.api("GET", `${first.P}/sources`)).status).toBe(200);
    const write = await ned.api("POST", `${first.P}/sources`, { title: "Another interview", tags: ["notes"] });
    expect(write.status).toBe(409);
    expect(write.body.error.code).toBe("organization_read_only");
    expect(write.body.error.message).toMatch(/^Ana Works is read-only: it went back to the Free plan while whoever started it already has a Free organization\. Everyone in it can still read and export it\. It is kept until \d{1,2} [A-Z][a-z]{2} \d{4}\. Nothing was changed\./);
    expect(write.body.error.details).toMatchObject({ read_only_since: expect.any(String), kept_until: expect.any(String) });
    // An owner meets it too: nobody adds to it.
    expect((await ana.api("PATCH", `${first.P}/sources/${first.source}`, { title: "Renamed" })).body.error?.code).toBe("organization_read_only");
    expect((await ana.api("POST", `/api/v1/tenants/${first.slug}/members`, { email: "new@example.com", role: "editor", team: first.team })).body.error?.code).toBe("organization_read_only");
    const exported = await ned.api("POST", `${first.P}/exports`, {});
    expect(exported.status, JSON.stringify(exported.body)).toBeLessThan(300);
  });

  it("still lets its people delete, and take people out", async () => {
    const impact = await ana.api("GET", `${first.P}/sources/${first.source}/delete-impact`);
    const del = await ana.api("DELETE", `${first.P}/sources/${first.source}`, { expected_etag: impact.body.etag, reason: "No longer needed", confirm: "delete permanently" });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const nedId = (await ned.api("GET", "/api/v1/me")).body.account_id;
    const out = await ana.api("POST", `/api/v1/tenants/${first.slug}/members/revoke`, { account_id: nedId, whole_tenant: true });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
  });

  it("is writable again on Pro", async () => {
    const back = await move(first.slug, "pro");
    expect(back.plan).toBe("pro");
    expect(back.read_only).toBeUndefined();
    expect((await orgOf(first.slug)).read_only).toBeUndefined();
    expect((await ana.api("POST", `${first.P}/sources`, { title: "A new interview", tags: ["notes"] })).status).toBe(201);
  });

  it("goes back to plain Free once its creator has room for it", async () => {
    await move(first.slug, "free");
    expect((await orgOf(first.slug)).read_only).toBeDefined();
    // Ana's other Free organization moves to Pro: now there is room, and Free means Free.
    await move(second.slug, "pro");
    expect((await orgOf(first.slug)).starting_plan_is_read_only).toBeUndefined();
    const writable = await move(first.slug, "free");
    expect(writable.plan).toBe("free");
    expect(writable.read_only).toBeUndefined();
    expect((await ana.api("GET", "/api/v1/me")).body.tenant_allowance).toMatchObject({ created: 1, remaining: 0 });
    expect((await ana.api("POST", `${first.P}/sources`, { title: "Back at work", tags: ["notes"] })).status).toBe(201);
  });

  it("goes back to plain Free when its creator has no other there, even with no allowance to start one", async () => {
    expect((await root.api("PUT", "/api/v1/tenant-allowances", { email: "zed@example.com", allowed: 1, notify: false })).status).toBe(200);
    const zed = await h.signIn("zed@example.com", "Zed Owner");
    const t = await start(zed, "Zed Works");
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    await move(t.body.tenant.slug, "pro");
    // Their allowance is taken away: they may start none, but the one they have still has its place.
    const etag = (await root.api("GET", "/api/v1/tenant-allowances")).body.items.find((a: { email: string }) => a.email === "zed@example.com").etag;
    expect((await root.api("PUT", "/api/v1/tenant-allowances", { email: "zed@example.com", allowed: 0, notify: false, expected_etag: etag })).status).toBe(200);
    expect((await zed.api("GET", "/api/v1/me")).body.tenant_allowance).toMatchObject({ allowed: 0, created: 0, remaining: 0 });
    expect((await orgOf(t.body.tenant.slug)).starting_plan_is_read_only).toBeUndefined();
    const back = await move(t.body.tenant.slug, "free");
    expect(back.plan).toBe("free");
    expect(back.read_only).toBeUndefined();
    // Now it has its one: a second organization of theirs coming back would be read-only.
    expect((await start(zed, "Zed Two")).status).toBe(403);
  });
});

describe("the waitlist", () => {
  it("takes someone who may not start an organization, once, and tells them they are on it", async () => {
    const gil = await h.signIn("gil@example.com", "Gil Guest");
    expect((await gil.api("GET", "/api/v1/me")).body).toMatchObject({ guest: true, asked_for_organization_at: null });
    const asked = await gil.api("POST", "/api/v1/me/ask-for-organization", { organization: "Gil Labs", note: "A team of four." });
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    expect(asked.body.asked_for_organization_at).toEqual(expect.any(String));
    // Asking again keeps their place.
    const again = await gil.api("POST", "/api/v1/me/ask-for-organization", {});
    expect(again.body.asked_for_organization_at).toBe(asked.body.asked_for_organization_at);
    expect((await gil.api("GET", "/api/v1/me")).body.asked_for_organization_at).toBe(asked.body.asked_for_organization_at);
  });

  it("is not for someone who may already start one", async () => {
    expect((await root.api("PUT", "/api/v1/tenant-allowances", { email: "flo@example.com", allowed: 1, notify: false })).status).toBe(200);
    const flo = await h.signIn("flo@example.com", "Flo Free");
    const r = await flo.api("POST", "/api/v1/me/ask-for-organization", {});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("may_start_one");
  });

  it("is read by an instance owner alone, who lets someone start one and so takes them off it", async () => {
    const gil = await h.signIn("gil@example.com");
    expect((await gil.api("GET", "/api/v1/tenant-allowances")).status).toBe(403);
    const before = (await root.api("GET", "/api/v1/tenant-allowances")).body;
    expect(before.waitlist).toEqual([
      expect.objectContaining({ email: "gil@example.com", name: "Gil Guest", organization: "Gil Labs", note: "A team of four.", asked_at: expect.any(String), account: expect.objectContaining({ display_name: "Gil Guest" }) }),
    ]);
    expect((await root.api("PUT", "/api/v1/tenant-allowances", { email: "gil@example.com", allowed: 1, notify: false })).status).toBe(200);
    expect((await root.api("GET", "/api/v1/tenant-allowances")).body.waitlist).toEqual([]);
    expect((await gil.api("GET", "/api/v1/me")).body).toMatchObject({ guest: false, tenant_allowance: { remaining: 1 } });
  });
});

describe("the development sign-in page", () => {
  it("lists every account, newest first, with what each is here", async () => {
    const r = await fetch(`${h.baseUrl}/auth/dev-accounts`);
    expect(r.status).toBe(200);
    const { items, more } = (await r.json()) as { items: { email: string; display_name: string; about: string }[]; more: number };
    expect(more).toBe(0);
    const about = Object.fromEntries(items.map((i) => [i.email, i.about]));
    expect(items.map((i) => i.email).slice(0, 2)).toEqual(["flo@example.com", "gil@example.com"]);
    expect(about["root@example.com"]).toBe("Runs this instance");
    expect(about["ana@example.com"]).toMatch(/^Owns (Ana Works, Ana Two \(Pro\)|Ana Two \(Pro\), Ana Works)$/);
    expect(about["gil@example.com"]).toBe("May start an organization");
    // Taken out of Ana's organization, with no allowance: a guest again.
    expect(about["ned@example.com"]).toBe("Guest");
  });
});
