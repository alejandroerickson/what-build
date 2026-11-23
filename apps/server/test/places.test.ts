import { forgetSettings, givePlaces } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

/**
 * New organizations a day (`packages/core/src/places.ts`): Start using WhatBuild on the public site, and asking
 * for an organization in the app, give one of the day's places while one is left, else the
 * waitlist, whose people get the next places first, earliest first, by email.
 */
describe("new organizations a day", () => {
  let h: Harness;
  let owner: Browser;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000);
  const me = async (b: Browser) => (await b.api<{ tenant_allowance: { remaining: number | null }; asked_for_organization_at: string | null }>("GET", "/api/v1/me")).body;
  const setDaily = async (n: number) => {
    const read = await owner.api<{ etag: string | null }>("GET", "/api/v1/guests");
    expect((await owner.api("PATCH", "/api/v1/guests", { organizations_per_day: n, ...(read.body.etag ? { expected_etag: read.body.etag } : {}) })).status).toBe(200);
    forgetSettings();
  };

  beforeAll(async () => {
    h = await startHarness({ signupAllowlist: ["@staff.example"], instanceOwners: ["owen@staff.example"], defaultTenantAllowance: 0 });
    owner = await h.signIn("owen@staff.example", "Owen Owner");
  });
  afterAll(() => h.close());

  it("lets nobody new sign up until the deployment gives places a day, and says so to the sign-in page", async () => {
    expect(((await (await fetch(`${h.baseUrl}/auth/methods`)).json()) as { open: boolean }).open).toBe(false);
    const before = h.mailer.sent.length;
    await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email: "early@example.com" }) });
    expect(h.mailer.sent.length).toBe(before);
    await setDaily(2);
    expect(((await (await fetch(`${h.baseUrl}/auth/methods`)).json()) as { open: boolean }).open).toBe(true);
    await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email: "early@example.com" }) });
    expect(h.mailer.sent.length).toBe(before + 1);
  });

  it("gives the day's places to the first to start, then the waitlist, which gets the next day's first", async () => {
    await setDaily(2);
    const ann = await h.signIn("ann@example.com", "Ann");
    const ben = await h.signIn("ben@example.com", "Ben");
    const cam = await h.signIn("cam@example.com", "Cam");
    expect((await ann.api("POST", "/api/v1/me/start", {})).body).toMatchObject({ next: "start", tenant_allowance: { remaining: 1 } });
    // Asking twice gives no second place.
    expect((await ann.api("POST", "/api/v1/me/start", {})).body).toMatchObject({ next: "start" });
    expect((await ben.api("POST", "/api/v1/me/start", {})).body).toMatchObject({ next: "start" });
    const third = await cam.api<{ next: string; asked_for_organization_at: string | null }>("POST", "/api/v1/me/start", {});
    expect(third.body.next).toBe("waitlist");
    expect(third.body.asked_for_organization_at).toBeTruthy();
    // Someone who started one is in it from then on.
    expect((await ann.api("POST", "/api/v1/tenants", { name: "Ann's" })).status).toBe(201);
    expect((await ann.api("POST", "/api/v1/me/start", {})).body).toMatchObject({ next: "in" });

    // The next day the waitlist is let in first, by email, before anyone new.
    const sent = h.mailer.sent.length;
    const { released } = await givePlaces(h.db, h.ports, undefined, day(1));
    expect(released).toEqual(["cam@example.com"]);
    expect(h.mailer.sent.slice(sent)).toEqual([expect.objectContaining({ to: "cam@example.com", subject: "Your place on WhatBuild is ready" })]);
    expect((await me(cam)).tenant_allowance.remaining).toBe(1);
  });

  it("puts in line, and never lets in, an address an owner gave no allowance", async () => {
    await setDaily(50);
    expect((await owner.api("PUT", "/api/v1/tenant-allowances", { email: "kept@example.com", allowed: 0 })).status).toBe(200);
    const kept = await h.signIn("kept@example.com", "Kept Out");
    expect((await kept.api("POST", "/api/v1/me/start", {})).body).toMatchObject({ next: "waitlist", tenant_allowance: { remaining: 0 } });
    expect((await givePlaces(h.db, h.ports, undefined, day(2))).released).not.toContain("kept@example.com");
  });

  it("gives a place from the app's Ask for your own organization too, and nothing while the deployment gives none", async () => {
    await setDaily(50);
    const dee = await h.signIn("dee@example.com", "Dee");
    expect((await dee.api("POST", "/api/v1/me/ask-for-organization", {})).body).toMatchObject({ tenant_allowance: { remaining: 1 } });
    await setDaily(0);
    // Sign-up is closed again, so only someone who already has an account is asked about.
    const eve = await h.signIn("eve@staff.example", "Eve");
    expect((await eve.api("POST", "/api/v1/me/ask-for-organization", {})).body).toMatchObject({ tenant_allowance: { remaining: 0 } });
    expect((await givePlaces(h.db, h.ports, undefined, day(3))).released).toEqual([]);
  });

  it("never says on the public site how many organizations a day it gives", async () => {
    await setDaily(7);
    const plans = await (await fetch(`${h.baseUrl}/api/v1/plans`)).text();
    expect(plans).not.toContain("organizations_per_day");
    expect(JSON.parse(plans).sign_up).toBe(true);
  });

  it("keeps which landing page a new account came from, once", async () => {
    await setDaily(50);
    const fay = await h.signIn("fay@example.com", "Fay");
    expect((await fay.api("POST", "/api/v1/me/came-from", { page: "javascript:alert(1)" })).status).toBe(422);
    expect((await fay.api("POST", "/api/v1/me/came-from", { page: "/what-to-build/" })).status).toBe(200);
    expect((await fay.api("POST", "/api/v1/me/came-from", { page: "/" })).status).toBe(200);
    const row = await h.db.selectFrom("accounts").select("came_from").where("email", "=", "fay@example.com").executeTakeFirstOrThrow();
    expect(row.came_from).toBe("/what-to-build/");
  });
});
