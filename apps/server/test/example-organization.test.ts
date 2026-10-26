import { CONTENT_TABLES } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

// The example organization: one organization the deployment names, which every signed-in account
// reads as its guest and nobody but its members changes.

let h: Harness;
let ex: Organization; // the example, built by its owner
let gus: Browser; // holds no grant anywhere: the example's guest
let gusId: string;
let P: string; // the example's main product's routes
let T: string; // its tenant routes

/** Everything the example holds that a guest's write could change, row by row. */
async function holdings(): Promise<string> {
  return h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${ex.tenant.id}, true)`.execute(trx);
    const parts: string[] = [];
    for (const table of [...CONTENT_TABLES, "memberships", "invitations", "exports", "story_previews", "card_previews", "upload_grants", "mockup_uploads"]) {
      const rows = await sql<{ row: string }>`select to_jsonb(t)::text as row from ${sql.table(table)} t where tenant_id = ${ex.tenant.id} order by 1`.execute(trx);
      parts.push(`${table}: ${rows.rows.map((r) => r.row).join("\n")}`);
    }
    return parts.join("\n");
  });
}

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["olive@example.com"] });
  const olive = await h.signIn("olive@example.com", "Olive Owner");
  ex = await buildOrganization(h, olive, "Example Works", "EXAMPLE3");
  await h.worker.drain();
  P = `/api/v1/p/${ex.product.path}`;
  T = `/api/v1/tenants/${ex.tenant.slug}`;
  gus = await h.signIn("gus@guest.example", "Gus Guest");
  gusId = (await gus.api("GET", "/api/v1/me")).body.account_id;
}, 120_000);
afterAll(async () => h?.close());

describe("naming the example organization", () => {
  it("marks the one the deployment names, clears any other, and warns of a name no organization has", async () => {
    const other = await ex.owner.api("POST", "/api/v1/tenants", { name: "Second Example" });
    const flags = async () => Object.fromEntries((await h.db.selectFrom("tenants").select(["slug", "example"]).execute()).map((t) => [t.slug, t.example]));
    expect(await syncExampleTenant(h.db, ex.tenant.slug, () => {})).toBe(ex.tenant.id);
    expect(await flags()).toEqual({ [ex.tenant.slug]: true, [other.body.tenant.slug]: false });
    expect(await syncExampleTenant(h.db, other.body.tenant.slug, () => {})).toBe(other.body.tenant.tenant_id);
    expect(await flags()).toEqual({ [ex.tenant.slug]: false, [other.body.tenant.slug]: true });
    const said: string[] = [];
    expect(await syncExampleTenant(h.db, "no-such-organization", (m) => said.push(m))).toBeNull();
    expect(said.join("\n")).toMatch(/WHATBUILD_EXAMPLE_TENANT names "no-such-organization"/);
    expect(Object.values(await flags()).every((f) => f === false)).toBe(true);
  });
});

describe("a deployment that names no example organization, as a self-hosted one may not", () => {
  it("makes nobody a guest: the organization is an ordinary one nobody else can see", async () => {
    await syncExampleTenant(h.db, null, () => {});
    expect(h.config.exampleTenant).toBeNull();
    expect(await h.db.selectFrom("tenants").select("slug").where("example", "=", true).execute()).toEqual([]);
    expect((await gus.api("GET", "/api/v1/me/products")).body).toMatchObject({ items: [], tenants: [] });
    expect((await gus.api("GET", `${P}/outcomes`)).status).toBe(404);
  });
});

describe("the example organization, for a guest", () => {
  beforeAll(async () => {
    expect(await syncExampleTenant(h.db, ex.tenant.slug, () => {})).toBe(ex.tenant.id);
  });

  it("lists its products for every account, marked as the example, with the guest's role", async () => {
    const list = (await gus.api("GET", "/api/v1/me/products")).body;
    expect(list.items.map((i: { path: string }) => i.path).sort()).toEqual([ex.product.path, ex.annex.path].sort());
    for (const item of list.items) expect(item).toMatchObject({ tenant: { slug: ex.tenant.slug, example: true }, your_role: "guest" });
    expect(list.tenants).toEqual([expect.objectContaining({ slug: ex.tenant.slug, example: true, your_role: "guest" })]);
    expect(list.tenants[0].teams.length).toBeGreaterThan(0);
    for (const team of list.tenants[0].teams) expect(team.your_role).toBe("guest");
    // A product's own answer says the same; the guest reads it as a viewer, with its concept and every count.
    const product = await gus.api("GET", P);
    expect(product.body).toMatchObject({ your_role: "guest", counts: { sources: expect.any(Number) } });
    expect(product.body.concept).toEqual(expect.any(String));
  });

  it("reads everything a viewer reads: sources, search, the Story and an attachment's bytes", async () => {
    expect((await gus.api("GET", `${P}/sources`)).body.records.map((r: { record_id: string }) => r.record_id)).toContain(ex.source.id);
    const found = await gus.api("GET", `${P}/search?query=${encodeURIComponent("crews text the office")}`);
    expect(found.status).toBe(200);
    expect(JSON.stringify(found.body)).toContain(ex.source.id);
    const pages = await gus.api("GET", `${P}/story/pages`);
    expect(pages.status).toBe(200);
    expect((await gus.api("GET", `${P}/story/pages/${ex.page.id}`)).status).toBe(200);
    const grant = await gus.api("POST", `${P}/sources/${ex.source.id}/downloads`, { path: ex.source.path });
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    const file = await fetch(grant.body.url, { headers: grant.body.headers });
    expect(file.status).toBe(200);
    expect(await file.text()).toContain("crews text the office");
  });

  it("refuses every write as read-only, says how to start an organization of one's own, and changes nothing", async () => {
    const before = await holdings();
    const writes: [string, string, unknown][] = [
      ["POST", `${P}/outcomes`, { title: "A guest's outcome" }],
      ["POST", `${P}/sources`, { title: "A guest's source", tags: ["notes"] }],
      ["POST", `${P}/sources/${ex.source.id}/annotations`, { note: "A guest's comment." }],
      ["POST", `${P}/assumptions`, { statement: "A guest's assumption." }],
      ["POST", `${P}/sources/archive`, { record_ids: [ex.source.id] }],
      ["POST", `${P}/sources/${ex.source.id}/uploads`, { path: "guest.md" }],
      ["POST", `${P}/story/pages/${ex.page.id}/preview`, { body: "<p>A guest's draft.</p>", expected_etag: ex.page.etag }],
      ["POST", `${P}/story/pages/guest-page/versions`, { title: "A guest's page", body: "<p>No.</p>" }],
      ["POST", `${P}/exports`, {}],
      ["POST", `${P}/mockups/uploads`, {}],
      ["POST", `${T}/members`, { email: "gus@guest.example", role: "editor", team: ex.team.slug }],
      ["POST", `${T}/teams`, { name: "A guest's team" }],
    ];
    for (const [method, path, body] of writes) {
      const r = await gus.api(method, path, body);
      expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(403);
      expect(r.body.error.code, path).toBe("example_read_only");
      expect(r.body.error.message).toMatch(/is the example organization/);
      expect(r.body.error.message).toMatch(/create an organization of your own/);
    }
    expect(await holdings()).toBe(before);
  });

  it("tells a guest who may start no organization to ask whoever runs this WhatBuild, and one with an organization to work there", async () => {
    // Refused as a product's write, an organization's admin action and an export: each place a guest's write is refused.
    const writes: [string, string, unknown][] = [
      ["POST", `${P}/sources`, { title: "A guest's source", tags: ["notes"] }],
      ["POST", `${T}/teams`, { name: "A guest's team" }],
      ["POST", `${P}/exports`, {}],
    ];
    const refusals = async (who: Browser) =>
      Promise.all(writes.map(async ([method, path, body]) => {
        const r = await who.api(method, path, body);
        expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(403);
        expect(r.body.error.code, path).toBe("example_read_only");
        return r.body.error.message as string;
      }));
    const olive = await h.signIn("olive@example.com", "Olive Owner");
    expect((await olive.api("PUT", "/api/v1/tenant-allowances", { email: "nell@guest.example", allowed: 0, notify: false })).status).toBe(200);
    const nell = await h.signIn("nell@guest.example", "Nell Guest");
    for (const message of await refusals(nell)) {
      expect(message).toMatch(/is the example organization/);
      expect(message).toMatch(/may not start an organization: for one of your own, ask whoever runs this WhatBuild/);
      expect(message).not.toMatch(/create an organization of your own/);
    }
    const ivy = await h.signIn("ivy@own.example", "Ivy Own");
    expect((await ivy.api("POST", "/api/v1/tenants", { name: "Ivy's own" })).status).toBe(201);
    for (const message of await refusals(ivy)) {
      expect(message).toMatch(/Do your own work in an organization you are in/);
      expect(message).not.toMatch(/create_tenant|ask whoever runs/);
    }
  });

  it("shows a guest none of its people, and lists no guest to its members", async () => {
    const mine = await gus.api("GET", `${T}/members`);
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual({ members: [], invitations: [], guest: true });
    const theirs = await ex.owner.api("GET", `${T}/members`);
    expect(theirs.body.members.map((m: { account_id: string }) => m.account_id)).not.toContain(gusId);
    expect(JSON.stringify(theirs.body)).not.toContain("gus@guest.example");
  });

  it("lets a guest hide it from the panel, and show it again, as their account's own choice", async () => {
    expect((await gus.api("GET", "/api/v1/me")).body.hide_example).toBe(false);
    const hidden = await gus.api("PATCH", "/api/v1/me", { hide_example: true });
    expect(hidden.status).toBe(200);
    expect(hidden.body).toMatchObject({ hide_example: true, display_name: "Gus Guest" });
    expect((await gus.api("GET", "/auth/session")).body.hide_example).toBe(true);
    // Hiding it from the panel changes nothing of what the guest may read.
    expect((await gus.api("GET", "/api/v1/me/products")).body.tenants.some((t: { example?: boolean }) => t.example)).toBe(true);
    expect((await gus.api("PATCH", "/api/v1/me", { hide_example: false })).body.hide_example).toBe(false);
    expect((await gus.api("PATCH", "/api/v1/me", {})).status).toBe(422);
  });

  it("lists a guest none of the exports its members made", async () => {
    expect((await ex.owner.api("POST", `${P}/exports`, {})).status).toBe(201);
    expect((await ex.owner.api("GET", `${P}/exports`)).body.items.length).toBeGreaterThan(0);
    const r = await gus.api("GET", `${P}/exports`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ items: [] });
  });

  it("lets its members write as in any organization, under their own names", async () => {
    const r = await ex.owner.api("POST", `${P}/outcomes`, { title: "Written by the example's owner" });
    expect(r.status).toBe(201);
    expect(r.body.created_by.display_name).toBe("Olive Owner");
    // A guest reads what its members write.
    expect((await gus.api("GET", `${P}/outcomes`)).body.items.map((o: { title: string }) => o.title)).toContain("Written by the example's owner");
  });

  it("holds a guest to the limit on calls a minute, and to no daily allowance", async () => {
    const limits = await gus.api("GET", `${T}/limits`);
    expect(limits.body).toMatchObject({ plan: "unlimited", you_meet_them: "calls_per_minute_only" });
    expect(limits.body.limits.some((l: { used?: number }) => l.used !== undefined)).toBe(false);
    await h.db.updateTable("tenants").set({ limits: JSON.stringify({ requests_per_minute: 0 }) }).where("tenant_id", "=", ex.tenant.id).execute();
    try {
      const r = await gus.api("GET", `${P}/outcomes`);
      expect(r.status).toBe(429);
      expect(r.body.error.message).toMatch(/^The example organization allows each person 0 calls a minute/);
      // Its members are on its plan, which is unlimited.
      expect((await ex.owner.api("GET", `${P}/outcomes`)).status).toBe(200);
    } finally {
      await h.db.updateTable("tenants").set({ limits: "{}" }).where("tenant_id", "=", ex.tenant.id).execute();
    }
    const days = await h.db.selectFrom("limit_counters").select("n").where("account_id", "=", gusId).where("bucket", "=", "day").execute();
    expect(days).toEqual([]);
  });

  it("is closed to every guest once the deployment no longer names it, and its members keep it", async () => {
    await syncExampleTenant(h.db, null, () => {});
    try {
      expect((await gus.api("GET", `${P}/outcomes`)).status).toBe(404);
      expect((await gus.api("GET", "/api/v1/me/products")).body.items).toEqual([]);
      expect((await ex.owner.api("GET", `${P}/outcomes`)).status).toBe(200);
    } finally {
      await syncExampleTenant(h.db, ex.tenant.slug, () => {});
    }
  });
});
