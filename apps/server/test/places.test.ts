import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { forgetSettings, givePlaces } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

/**
 * New organizations a day (`packages/core/src/places.ts`): Start using WhatBuild on the public site,
 * and asking for an organization in the app, say whether one of the day's places is open, and use
 * none; a place is used when someone starts an organization on it, in one transaction under one
 * lock, so the day's number holds however many start at once. Past the day's places people join the
 * waitlist, whose people get the next places first, earliest first, each held for them and told by
 * email.
 */
describe("new organizations a day", () => {
  let h: Harness;
  let owner: Browser;
  let ann: Browser;
  let ben: Browser;
  let cam: Browser;
  let dee: Browser;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000);
  type Me = { tenant_allowance: { remaining: number | null; source: string }; asked_for_organization_at: string | null; place_open: boolean; guest: boolean };
  const me = async (b: Browser) => (await b.api<Me>("GET", "/api/v1/me")).body;
  const setDaily = async (n: number) => {
    const read = await owner.api<{ etag: string | null }>("GET", "/api/v1/guests");
    expect((await owner.api("PATCH", "/api/v1/guests", { organizations_per_day: n, ...(read.body.etag ? { expected_etag: read.body.etag } : {}) })).status).toBe(200);
    forgetSettings();
  };
  /** The day's places used so far, as the instance's owners read it. */
  const usedToday = async () => (await owner.api<{ now: { organizations_today: number } }>("GET", "/api/v1/guests")).body.now.organizations_today;
  /** Leave exactly `n` of today's places open. */
  const openPlaces = async (n: number) => setDaily((await usedToday()) + n);
  const allowanceOf = (email: string) => h.db.selectFrom("tenant_allowances").select(["allowed", "created_by"]).where("email", "=", email).executeTakeFirst();
  const startOrganization = (b: Browser, name: string) => b.api<{ error?: { code: string; message: string } }>("POST", "/api/v1/tenants", { name });
  const pressStart = (b: Browser) => b.api<Me & { next: string }>("POST", "/api/v1/me/start", {});

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

  it("uses no place for someone who presses Start using WhatBuild and leaves", async () => {
    ann = await h.signIn("ann@example.com", "Ann");
    ben = await h.signIn("ben@example.com", "Ben");
    await openPlaces(1);
    const before = await usedToday();
    expect((await pressStart(ann)).body).toMatchObject({ next: "start", place_open: true, guest: true, tenant_allowance: { remaining: 0, source: "default" } });
    // Pressing it again changes nothing either.
    expect((await pressStart(ann)).body).toMatchObject({ next: "start", place_open: true });
    expect(await allowanceOf("ann@example.com")).toBeUndefined();
    expect(await usedToday()).toBe(before);
    // The place is still open to the next person, who uses it by starting an organization.
    expect((await pressStart(ben)).body).toMatchObject({ next: "start", place_open: true });
    expect((await startOrganization(ben, "Ben's")).status).toBe(201);
    expect(await usedToday()).toBe(before + 1);
    expect(await allowanceOf("ben@example.com")).toMatchObject({ allowed: 1, created_by: expect.objectContaining({ client: "whatbuild:organizations-a-day" }) });
    expect((await me(ben)).tenant_allowance).toMatchObject({ remaining: 0, source: "given" });
    expect((await pressStart(ben)).body).toMatchObject({ next: "in" });
  });

  it("refuses the last place to whoever presses Start organization after it went, starts nothing, and puts them on the waitlist when they ask", async () => {
    // Ann opened the Welcome form above while the place was open; Ben started his first.
    expect((await me(ann)).place_open).toBe(false);
    const refused = await startOrganization(ann, "Ann's");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "places_taken", message: expect.stringContaining("nothing was started") });
    expect(await allowanceOf("ann@example.com")).toBeUndefined();
    expect((await ann.api<{ tenants: { example?: boolean }[] }>("GET", "/api/v1/me/products")).body.tenants.filter((t) => !t.example)).toEqual([]);
    // The web app then asks for her, with the name she typed, and she is on the waitlist.
    const asked = await ann.api<Me>("POST", "/api/v1/me/ask-for-organization", { organization: "Ann's" });
    expect(asked.body).toMatchObject({ place_open: false, tenant_allowance: { remaining: 0 } });
    expect(asked.body.asked_for_organization_at).toBeTruthy();
    const line = await h.db.selectFrom("interest").select(["organization"]).where("email", "=", "ann@example.com").executeTakeFirstOrThrow();
    expect(line.organization).toBe("Ann's");
  });

  it("gives the waitlist the next places first, each held for its person: told by email, or there and then when they ask", async () => {
    cam = await h.signIn("cam@example.com", "Cam");
    dee = await h.signIn("dee@example.com", "Dee");
    // Ann waits. A new place today goes to her before anyone new: nobody else sees it open, nor can start on it.
    await openPlaces(1);
    expect((await me(cam)).place_open).toBe(false);
    expect((await startOrganization(cam, "Cam's")).body.error?.code).toBe("places_taken");
    const sent = h.mailer.sent.length;
    expect((await pressStart(cam)).body).toMatchObject({ next: "waitlist", place_open: false });
    expect(h.mailer.sent.slice(sent)).toEqual([expect.objectContaining({ to: "ann@example.com", subject: "Your place on WhatBuild is ready" })]);
    // Hers is held for her, used today whether or not she starts on it.
    expect((await me(ann)).tenant_allowance).toMatchObject({ remaining: 1, source: "given" });
    expect((await pressStart(dee)).body).toMatchObject({ next: "waitlist" });

    // Someone in line who asks when a place comes is answered there and then, with no mail.
    await openPlaces(1);
    const mailed = h.mailer.sent.length;
    expect((await pressStart(cam)).body).toMatchObject({ next: "start", tenant_allowance: { remaining: 1 } });
    expect(h.mailer.sent.length).toBe(mailed);

    // The next day the waitlist is let in first, by email, before anyone new.
    const { released } = await givePlaces(h.db, h.ports, undefined, day(1));
    expect(released).toEqual(["dee@example.com"]);
    expect(h.mailer.sent.slice(mailed)).toEqual([expect.objectContaining({ to: "dee@example.com", subject: "Your place on WhatBuild is ready" })]);
    expect((await me(dee)).tenant_allowance.remaining).toBe(1);
    // A held place waits for its person.
    expect((await startOrganization(ann, "Ann's")).status).toBe(201);
    expect((await pressStart(ann)).body).toMatchObject({ next: "in" });
  });

  it("holds the day's number when several press Start organization at once for the last place", async () => {
    const racers = await Promise.all(["rae", "rob", "roz", "rui"].map((n) => h.signIn(`${n}@example.com`, n)));
    await openPlaces(1);
    for (const r of racers) expect((await me(r)).place_open).toBe(true);
    const before = await usedToday();
    const answers = await Promise.all(racers.map((r) => startOrganization(r, `${r.email}'s`)));
    expect(answers.map((a) => a.status).sort()).toEqual([201, 409, 409, 409]);
    for (const a of answers.filter((x) => x.status === 409)) expect(a.body.error?.code).toBe("places_taken");
    expect(await usedToday()).toBe(before + 1);
    const given = await Promise.all(racers.map((r) => allowanceOf(r.email)));
    expect(given.filter(Boolean)).toHaveLength(1);
    const own = await Promise.all(racers.map(async (r) => (await r.api<{ tenants: { example?: boolean }[] }>("GET", "/api/v1/me/products")).body.tenants.filter((t) => !t.example).length));
    expect(own.sort()).toEqual([0, 0, 0, 1]);
  });

  it("gives no place to an agent: a person starts their own organization in the web app", async () => {
    const gus = await h.signIn("gus@example.com", "Gus");
    await openPlaces(1);
    const token = await h.connectAgent(gus);
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const answer = (await client.callTool({ name: "products_write", arguments: { action: "create_tenant", params: { name: "Gus's" } } })) as { content: { text: string }[]; isError?: boolean };
    await client.close();
    expect(answer.isError).toBe(true);
    expect(answer.content[0]!.text).toMatch(/^403\b[\s\S]*"tenant_allowance"/);
    expect(await allowanceOf("gus@example.com")).toBeUndefined();
    expect((await me(gus)).place_open).toBe(true);
  });

  it("puts in line, and never lets in, an address an owner gave no allowance", async () => {
    await setDaily(50);
    expect((await owner.api("PUT", "/api/v1/tenant-allowances", { email: "kept@example.com", allowed: 0 })).status).toBe(200);
    const kept = await h.signIn("kept@example.com", "Kept Out");
    expect((await pressStart(kept)).body).toMatchObject({ next: "waitlist", place_open: false, tenant_allowance: { remaining: 0 } });
    expect((await startOrganization(kept, "Kept's")).status).toBe(403);
    expect((await givePlaces(h.db, h.ports, undefined, day(2))).released).not.toContain("kept@example.com");
  });

  it("says from the app's Ask for your own organization that a place is open, gives nobody in an organization one, and nothing while the deployment gives none", async () => {
    await setDaily(50);
    const fran = await h.signIn("fran@example.com", "Fran");
    expect((await fran.api("POST", "/api/v1/me/ask-for-organization", {})).body).toMatchObject({ place_open: true, asked_for_organization_at: null, tenant_allowance: { remaining: 0 } });
    // Someone already in an organization, with no allowance of their own, is not offered one.
    const fay = await h.signIn("fay@example.com", "Fay");
    expect((await owner.api("POST", "/api/v1/tenants", { name: "Owen's" })).status).toBe(201);
    const owens = (await owner.api<{ tenants: { slug: string; example?: boolean }[] }>("GET", "/api/v1/me/products")).body.tenants.find((t) => !t.example)!;
    expect((await owner.api("POST", `/api/v1/tenants/${owens.slug}/members`, { email: "fay@example.com", role: "editor", all_products: true })).status).toBe(201);
    expect((await me(fay)).place_open).toBe(false);
    expect((await startOrganization(fay, "Fay's")).status).toBe(403);
    await setDaily(0);
    expect((await me(fran)).place_open).toBe(false);
    // Sign-up is closed again, so only someone who already has an account is asked about.
    const eve = await h.signIn("eve@staff.example", "Eve");
    expect((await eve.api("POST", "/api/v1/me/ask-for-organization", {})).body).toMatchObject({ place_open: false, tenant_allowance: { remaining: 0 } });
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
    const flo = await h.signIn("flo@example.com", "Flo");
    expect((await flo.api("POST", "/api/v1/me/came-from", { page: "javascript:alert(1)" })).status).toBe(422);
    expect((await flo.api("POST", "/api/v1/me/came-from", { page: "/what-to-build/" })).status).toBe(200);
    expect((await flo.api("POST", "/api/v1/me/came-from", { page: "/" })).status).toBe(200);
    const row = await h.db.selectFrom("accounts").select("came_from").where("email", "=", "flo@example.com").executeTakeFirstOrThrow();
    expect(row.came_from).toBe("/what-to-build/");
  });
});
