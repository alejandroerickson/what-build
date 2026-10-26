import { sql, type RawBuilder } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPeople, planPeople, type AddPeopleResult } from "../src/people.ts";
import { startHarness, type Harness } from "./harness.ts";

const OWNER = "riley@example.com";
const COUNT = 40;

describe("the plan of synthetic people", () => {
  it("is the same for the same count, and adds up to it", () => {
    const plan = planPeople(100);
    expect(planPeople(100)).toEqual(plan);
    expect(plan.people).toHaveLength(100);
    expect(new Set(plan.people.map((p) => p.email)).size).toBe(100);
    const kinds = Object.fromEntries(["owner", "member", "signed-in", "invited", "allowed", "waitlist"].map((k) => [k, plan.people.filter((p) => p.kind === k).length]));
    expect(kinds).toEqual({ owner: 8, member: 46, "signed-in": 10, invited: 12, allowed: 6, waitlist: 18 });
  });

  it("uses only synthetic addresses", () => {
    for (const p of planPeople(1000).people) expect(p.email).toMatch(/^[a-z]+\.[a-z]+@(example\.com|[a-z]+\.example)$/);
  });

  it("makes organizations of different sizes, and people in more than one", () => {
    const plan = planPeople(100);
    const size = (slug: string) => plan.people.filter((p) => p.kind !== "invited" && p.organizations.some((o) => o.slug === slug)).length;
    const sizes = plan.organizations.map((o) => size(o.slug));
    expect(sizes[0]).toBeGreaterThan(15);
    expect(Math.min(...sizes)).toBeLessThan(5);
    expect(plan.people.filter((p) => p.organizations.length > 1).length).toBeGreaterThan(5);
    expect(plan.people.filter((p) => p.organizations.some((o) => o.role === "owner")).length).toBe(plan.organizations.length + 1);
  });

  it("refuses a count it cannot make", () => {
    for (const n of [0, 1001, 2.5]) expect(() => planPeople(n)).toThrow(/--count/);
    expect(planPeople(1).people.map((p) => p.kind)).toEqual(["owner"]);
  });
});

describe("pnpm people on an instance", () => {
  let h: Harness;
  let first: AddPeopleResult;

  beforeAll(async () => {
    h = await startHarness({ instanceOwners: [OWNER], signupAllowlist: [planPeople(COUNT).allowlist], newOrganizationPlan: "free", defaultTenantAllowance: 0 });
    first = await addPeople({ url: h.baseUrl, count: COUNT, owner: OWNER });
  });
  afterAll(async () => h?.close());

  const count = async (query: RawBuilder<{ n: number }>) => Number((await query.execute(h.db)).rows[0]!.n);

  it("makes accounts only for the people who signed in", async () => {
    const signedIn = first.plan.people.filter((p) => ["owner", "member", "signed-in"].includes(p.kind)).map((p) => p.email);
    const accounts = (await h.db.selectFrom("accounts").select("email").where("email", "!=", OWNER).execute()).map((a) => a.email);
    expect(accounts.sort()).toEqual(signedIn.sort());
  });

  it("starts each organization on its owner's allowance, on the free plan, with its people", async () => {
    for (const org of first.plan.organizations) {
      const tenant = await h.db.selectFrom("tenants").select(["tenant_id", "plan", "name"]).where("slug", "=", org.slug).executeTakeFirstOrThrow();
      expect([tenant.name, tenant.plan]).toEqual([org.name, "free"]);
      const members = await h.db
        .selectFrom("memberships as m")
        .innerJoin("accounts as a", "a.account_id", "m.account_id")
        .select(["a.email", "m.role"])
        .where("m.scope_type", "=", "tenant")
        .where("m.scope_id", "=", tenant.tenant_id)
        .execute();
      const planned = first.plan.people.filter((p) => p.kind !== "invited").flatMap((p) => p.organizations.filter((o) => o.slug === org.slug).map((o) => ({ email: p.email, role: o.role })));
      expect(members.sort((a, b) => a.email.localeCompare(b.email))).toEqual(planned.sort((a, b) => a.email.localeCompare(b.email)));
    }
  });

  it("leaves invitations waiting, allowances unused and the waitlist in the form's table", async () => {
    const plan = first.plan;
    expect(await count(sql<{ n: number }>`select count(*) as n from invitations where accepted_at is null`)).toBe(plan.people.filter((p) => p.kind === "invited").length);
    expect(await count(sql<{ n: number }>`select count(*) as n from tenant_allowances`)).toBe(plan.people.filter((p) => p.allowance !== undefined).length);
    expect(await count(sql<{ n: number }>`select count(*) as n from interest`)).toBe(plan.people.filter((p) => p.kind === "waitlist").length);
    // Invitations are mailed, as they are to anyone; allowances are given without their notice.
    expect(h.mailer.sent.map((m) => m.to).sort()).toEqual(plan.people.filter((p) => p.kind === "invited").map((p) => p.email).sort());
  });

  it("adds nothing the second time", async () => {
    const mails = h.mailer.sent.length;
    const again = await addPeople({ url: h.baseUrl, count: COUNT, owner: OWNER });
    expect(again.added).toEqual({ waitlist: first.added.waitlist, allowances: 0, organizations: 0, grants: 0, invitations: 0 });
    expect(h.mailer.sent.length).toBe(mails);
    expect(await count(sql<{ n: number }>`select count(*) as n from invitations`)).toBe(first.added.invitations);
  });

  it("lets in, by a sign-in link, the domain on the allowlist and whoever was invited or given an allowance, and no one else", async () => {
    const plan = first.plan;
    const link = async (email: string) => (await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })).status;
    const invited = plan.people.find((p) => p.kind === "invited")!.email;
    const allowed = plan.people.find((p) => p.kind === "allowed")!.email;
    const waitlisted = plan.people.find((p) => p.kind === "waitlist")!.email;
    expect(await link(`new.colleague${plan.allowlist}`)).toBe(200);
    expect(await link(invited)).toBe(200);
    expect(await link(allowed)).toBe(200);
    expect(await link(waitlisted)).toBe(403);
    expect(await link("someone@elsewhere.example")).toBe(403);
  });

  it("refuses an address that is not this machine, and a server without development sign-in", async () => {
    await expect(addPeople({ url: "https://app.example.com", count: 5 })).rejects.toThrow(/not on this machine/);
    const prod = await startHarness({ devAuth: false });
    try {
      await expect(addPeople({ url: prod.baseUrl, count: 5 })).rejects.toThrow(/no development sign-in/);
    } finally {
      await prod.close();
    }
  });

  it("refuses an owner who does not own the instance", async () => {
    await expect(addPeople({ url: h.baseUrl, count: COUNT, owner: "sam@example.com" })).rejects.toThrow(/not an owner of this instance/);
  });
});
