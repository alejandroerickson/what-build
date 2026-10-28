import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let owner: Browser;
let bob: Browser;
let org: string;

const A = "/api/v1/tenant-allowances";

beforeAll(async () => {
  // As a deployment that is not open to everyone: sign-up limited, and only its owner creates organizations.
  h = await startHarness({ signupAllowlist: ["@staff.example"], instanceOwners: ["owen@staff.example"], defaultTenantAllowance: 0 });
  owner = await h.signIn("owen@staff.example", "Owen Owner");
  bob = await h.signIn("bob@staff.example", "Bob Member");
  const t = await owner.api("POST", "/api/v1/tenants", { name: "Owner's first" });
  org = t.body.tenant.slug;
  // Bob is in an organization, as an admin.
  expect((await owner.api("POST", `/api/v1/tenants/${org}/members`, { email: "bob@staff.example", role: "admin" })).status).toBe(201);
});
afterAll(async () => h?.close());

const allowanceOf = async (b: Browser) => (await b.api("GET", "/api/v1/me")).body.tenant_allowance;

describe("who may create an organization", () => {
  it("lets an instance owner create any number", async () => {
    for (const name of ["Owner's second", "Owner's third"]) expect((await owner.api("POST", "/api/v1/tenants", { name })).status).toBe(201);
    expect(await allowanceOf(owner)).toMatchObject({ instance_owner: true, allowed: null, created: 3, remaining: null, source: "instance_owner" });
  });

  it("never lets belonging to an organization create one", async () => {
    const refused = await bob.api("POST", "/api/v1/tenants", { name: "Bob's own" });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({ code: "tenant_allowance", details: { allowed: 0, created: 0 } });
    expect(await allowanceOf(bob)).toMatchObject({ instance_owner: false, allowed: 0, created: 0, remaining: 0, source: "default" });
  });

  it("keeps the allowances to the instance's owners", async () => {
    expect((await bob.api("GET", A)).status).toBe(403);
    expect((await bob.api("PUT", A, { email: "bob@staff.example", allowed: 5 })).status).toBe(403);
    // A tenant owner is not an instance owner.
    const ownerOfOrg = await h.signIn("tess@staff.example", "Tess");
    await owner.api("POST", `/api/v1/tenants/${org}/members`, { email: "tess@staff.example", role: "owner" });
    expect((await ownerOfOrg.api("PUT", A, { email: "tess@staff.example", allowed: 1 })).status).toBe(403);
    expect((await ownerOfOrg.api("POST", "/api/v1/tenants", { name: "Tess's own" })).body.error.code).toBe("tenant_allowance");
  });

  it("counts only the organizations an account created, not the ones it is in", async () => {
    const given = await owner.api("PUT", A, { email: "Bob@Staff.example", allowed: 2, note: "Runs the second team" });
    expect(given.status, JSON.stringify(given.body)).toBe(200);
    expect(given.body).toMatchObject({ email: "bob@staff.example", allowed: 2, created: 0, remaining: 2, account: { display_name: "Bob Member" }, notified: true });
    expect(h.mailer.sent.at(-1)).toMatchObject({ to: "bob@staff.example" });
    expect(h.mailer.sent.at(-1)!.text).toContain("/welcome");
    for (const name of ["Bob's first", "Bob's second"]) expect((await bob.api("POST", "/api/v1/tenants", { name })).status).toBe(201);
    const third = await bob.api("POST", "/api/v1/tenants", { name: "Bob's third" });
    expect(third.status).toBe(403);
    expect(third.body.error).toMatchObject({ code: "tenant_allowance", details: { allowed: 2, created: 2 } });
    expect(await allowanceOf(bob)).toMatchObject({ allowed: 2, created: 2, remaining: 0, source: "given" });
    const list = (await owner.api("GET", A)).body;
    expect(list).toMatchObject({ instance_owners: ["owen@staff.example"], default_allowed: 0 });
    expect(list.items.find((i: { email: string }) => i.email === "bob@staff.example")).toMatchObject({ allowed: 2, created: 2, remaining: 0, note: "Runs the second team" });
  });

  it("guards a change with the allowance's etag", async () => {
    const current = (await owner.api("GET", A)).body.items.find((i: { email: string }) => i.email === "bob@staff.example");
    const blind = await owner.api("PUT", A, { email: "bob@staff.example", allowed: 3 });
    expect(blind.status).toBe(409);
    expect(blind.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: current.etag } });
    expect((await owner.api("PUT", A, { email: "bob@staff.example", allowed: 3, expected_etag: '"stale"' })).status).toBe(409);
    const raised = await owner.api("PUT", A, { email: "bob@staff.example", allowed: 3, expected_etag: current.etag, notify: false });
    expect(raised.status).toBe(200);
    expect(raised.body).toMatchObject({ allowed: 3, remaining: 1, notified: false });
    expect(raised.body.etag).not.toBe(current.etag);
  });

  it("lets an address that has no account sign up while sign-up is limited, and start its organization", async () => {
    // Every address is answered alike; what tells them apart is whether a link is sent.
    const ask = async (email: string) => {
      const before = h.mailer.sent.length;
      const r = await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email, next: "/welcome" }) });
      expect(r.status).toBe(200);
      return h.mailer.sent.slice(before).some((m) => m.to === email && m.subject === "Your WhatBuild sign-in link");
    };
    expect(await ask("nina@elsewhere.example")).toBe(false);
    const given = await owner.api("PUT", A, { email: "nina@elsewhere.example", allowed: 1 });
    expect(given.body).toMatchObject({ account: null, created: 0, remaining: 1, notified: true });
    // The owner's name is quoted, and the mail says whose words those are, as an invitation does.
    const notice = h.mailer.sent.find((m) => m.to === "nina@elsewhere.example")!;
    expect(notice.subject).toMatch(/^".+" let you start an organization on WhatBuild$/);
    expect(notice.text).toContain("The name in quotation marks is the one they gave WhatBuild.");
    expect(await ask("nina@elsewhere.example")).toBe(true);
    const { response: verified } = await h.followSignInLink();
    expect(verified.headers.get("location")).toBe("/welcome");
    const nina = await h.signIn("nina@elsewhere.example");
    expect((await nina.api("POST", "/api/v1/tenants", { name: "Nina's" })).status).toBe(201);
    expect((await nina.api("POST", "/api/v1/tenants", { name: "Nina's second" })).status).toBe(403);
    // An allowance of 0 lets nobody in.
    await owner.api("PUT", A, { email: "zero@elsewhere.example", allowed: 0, notify: true });
    expect(await ask("zero@elsewhere.example")).toBe(false);
  });

  it("takes only one place when two creations race for the last one", async () => {
    const current = (await owner.api("GET", A)).body.items.find((i: { email: string }) => i.email === "bob@staff.example");
    expect(current.remaining).toBe(1);
    const results = await Promise.all(["Race one", "Race two", "Race three"].map((name) => bob.api("POST", "/api/v1/tenants", { name })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 403, 403]);
  });

  it("returns an address to the default, leaving what it created", async () => {
    const current = (await owner.api("GET", A)).body.items.find((i: { email: string }) => i.email === "bob@staff.example");
    expect((await owner.api("POST", `${A}/remove`, { email: "bob@staff.example", expected_etag: '"stale"' })).status).toBe(409);
    const removed = await owner.api("POST", `${A}/remove`, { email: "bob@staff.example", expected_etag: current.etag });
    expect(removed.body).toMatchObject({ removed: true, default_allowed: 0 });
    expect(await allowanceOf(bob)).toMatchObject({ allowed: 0, created: 3, remaining: 0, source: "default" });
    expect((await bob.api("GET", "/api/v1/me/products")).body.tenants.filter((t: { name: string }) => t.name.startsWith("Bob's") || t.name.startsWith("Race"))).toHaveLength(3);
    expect((await owner.api("POST", `${A}/remove`, { email: "bob@staff.example", expected_etag: current.etag })).status).toBe(404);
  });

  it("refuses an allowance for an instance owner, who needs none", async () => {
    const r = await owner.api("PUT", A, { email: "owen@staff.example", allowed: 1 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("instance_owner");
  });
});

describe("a deployment's default allowance", () => {
  it("lets every address create that many when no instance owner has said otherwise", async () => {
    const open = await startHarness({ defaultTenantAllowance: 1 });
    try {
      const someone = await open.signIn("someone@example.com");
      expect(await allowanceOf(someone)).toMatchObject({ allowed: 1, remaining: 1, source: "default" });
      expect((await someone.api("POST", "/api/v1/tenants", { name: "One" })).status).toBe(201);
      expect((await someone.api("POST", "/api/v1/tenants", { name: "Two" })).status).toBe(403);
    } finally {
      await open.close();
    }
  });
});
