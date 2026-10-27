import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A deployment that defines no plans, as a self-hosted one does: every organization is unlimited,
// nothing offers or bills a plan, and an organization left on a plan nobody defines meets no limit.

let h: Harness;
let root: Browser; // an instance owner
let ada: Browser; // starts an organization on an allowance
let slug: string;

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["root@example.com"], signupAllowlist: ["@example.com"], defaultTenantAllowance: 0, plans: [], newOrganizationPlan: "unlimited" });
  root = await h.signIn("root@example.com", "Root Owner");
  expect((await root.api("PUT", "/api/v1/tenant-allowances", { email: "ada@example.com", allowed: 1, notify: false })).status).toBe(200);
  ada = await h.signIn("ada@example.com", "Ada Owner");
  const t = await ada.api("POST", "/api/v1/tenants", { name: "Ada Works" });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  slug = t.body.tenant.slug;
}, 120_000);
afterAll(async () => h?.close());

describe("a deployment with no plans", () => {
  it("offers none, and starts every organization unlimited", async () => {
    const catalogue = (await fetch(`${h.baseUrl}/api/v1/plans`).then((r) => r.json())) as { plans: unknown[]; starting_plan: string; example: boolean };
    expect(catalogue).toMatchObject({ plans: [], starting_plan: "unlimited", example: false });
    expect((await ada.api("GET", "/api/v1/me")).body.new_organization_plan).toBe("unlimited");
    const limits = (await ada.api("GET", `/api/v1/tenants/${slug}/limits`)).body;
    expect(limits).toMatchObject({ plan: "unlimited", plan_name: "Unlimited", you_meet_them: false, plans: [] });
    const orgs = (await root.api("GET", "/api/v1/organizations")).body;
    expect(orgs).toMatchObject({ plans: [], new_organization_plan: "unlimited", plan_records: {}, plan_defaults: {} });
  });

  it("refuses a plan it does not define, naming what there is", async () => {
    const r = await root.api("PATCH", "/api/v1/organizations/plan", { tenant: slug, plan: "free" });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: "unknown_plan", details: { plans: ["unlimited"] } });
    expect(r.body.error.message).toMatch(/^free is not a plan this WhatBuild defines\. It has unlimited\./);
    expect((await root.api("PATCH", "/api/v1/plans", { plan: "free", price: "$20 a month" })).body.error.code).toBe("unknown_plan");
  });

  it("lets an organization on a plan nobody defines any longer meet no limit, and says so", async () => {
    await h.db.updateTable("tenants").set({ plan: "gold" }).where("slug", "=", slug).execute();
    const limits = (await ada.api("GET", `/api/v1/tenants/${slug}/limits`)).body;
    expect(limits).toMatchObject({ plan: "gold", plan_name: "gold", undefined_plan: true, you_meet_them: false });
    expect(limits.plan_about).toMatch(/no longer defines/);
    const listed = (await root.api("GET", "/api/v1/organizations")).body.items.find((o: { slug: string }) => o.slug === slug);
    expect(listed).toMatchObject({ plan: "gold", undefined_plan: true });
    // It works as any organization does.
    const team = (await ada.api("GET", "/api/v1/me/products")).body.tenants.find((t: { slug: string }) => t.slug === slug).teams[0].slug;
    expect((await ada.api("POST", `/api/v1/teams/${slug}/${team}/products`, { name: "Goldfinch" })).status).toBe(201);
    // Moving it to unlimited is always possible.
    expect((await root.api("PATCH", "/api/v1/organizations/plan", { tenant: slug, plan: "unlimited" })).status).toBe(200);
  });
});
