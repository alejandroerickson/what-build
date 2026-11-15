import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// One link in: the mail that lets someone start an organization, and an invitation's, each carry a
// link of their own that signs in an address with no account yet, from one page with one button.

let h: Harness;
let owner: Browser;
let org: string;

const A = "/api/v1/tenant-allowances";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

beforeAll(async () => {
  // As a deployment that is not open to everyone: only listed addresses, invitations and allowances get in.
  h = await startHarness({ signupAllowlist: ["@staff.example"], instanceOwners: ["owen@staff.example"], defaultTenantAllowance: 0 });
  // An account invited here answers its invitations itself, as a person would.
  h.acceptsInvitations = false;
  owner = await h.signIn("owen@staff.example", "Owen Owner");
  org = (await owner.api("POST", "/api/v1/tenants", { name: "Acme Labs" })).body.tenant.slug;
});
afterAll(async () => h?.close());

/** The entry link in the last mail sent to `to`. */
const linkTo = (to: string) => {
  const mail = [...h.mailer.sent].reverse().find((m) => m.to === to)!;
  return /https?:\/\/\S+\/auth\/start\?token=\S+/.exec(mail.text)![0];
};
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
const open = (link: string) => fetch(link, { redirect: "manual" });
/** What pressing Continue on the link's page sends: a form POST, from this origin unless `origin` says otherwise. */
const press = (link: string, origin = h.baseUrl) =>
  fetch(`${h.baseUrl}/auth/start`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams({ token: tokenOf(link) }) });
const sessionOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => /^(?:__Host-)?wb_session=./.test(c));
const me = async (cookie: string) => (await (await fetch(`${h.baseUrl}/api/v1/me`, { headers: { cookie } })).json()) as { email: string; tenant_allowance: { remaining: number | null } };
const accountOf = (email: string) => h.db.selectFrom("accounts").select(["account_id", "created_at"]).where("email", "=", email).executeTakeFirst();
const linkRow = (link: string) => h.db.selectFrom("email_tokens").selectAll().where("token_hash", "=", hash(tokenOf(link))).executeTakeFirstOrThrow();
const allow = async (email: string, allowed = 1) => {
  const r = await owner.api("PUT", A, { email, allowed });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return linkTo(email);
};
const invite = async (email: string, role = "editor") => {
  const r = await owner.api("POST", `/api/v1/tenants/${org}/members`, { email, role, all_products: true });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: String(r.body.invitation_id), inviteLink: String(r.body.invite_link), link: linkTo(email) };
};

describe("the link in the mail that lets someone start an organization", () => {
  it("opens a page that changes nothing, however often it is opened, naming who invited whom", async () => {
    const link = await allow("maya@elsewhere.example");
    for (let i = 0; i < 3; i++) {
      const page = await open(link);
      expect(page.status).toBe(200);
      expect(page.headers.get("set-cookie")).toBeNull();
      expect(page.headers.get("cache-control")).toBe("no-store");
      expect(page.headers.get("referrer-policy")).toBe("same-origin");
      expect(page.headers.get("x-frame-options")).toBe("DENY");
      const html = await page.text();
      expect(html).toContain("<h1>Start on WhatBuild</h1>");
      expect(html).toContain("<p>Owen Owner (owen@staff.example) invited <strong>maya@elsewhere.example</strong> to start an organization.</p>");
      expect(html).toContain('<form method="post" action="/auth/start">');
      expect(html).toMatch(/<button type="submit" class="primary">Continue as maya@elsewhere\.example<\/button>/);
      expect(html).toContain('<p class="muted after">Continuing signs you in as maya@elsewhere.example. Not you? Close this tab and nothing happens.</p>');
      // It stands on its own; and with no public site here, there is nowhere to send someone to look first.
      expect(html).not.toMatch(/this link|this email|What is WhatBuild/i);
    }
    expect(await accountOf("maya@elsewhere.example")).toBeUndefined();
    expect((await linkRow(link)).used_at).toBeNull();
  });

  it("makes the account and its session when its button is pressed, opens Welcome, and works once", async () => {
    const link = linkTo("maya@elsewhere.example");
    const r = await press(link);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/welcome");
    const cookie = sessionOf(r)!;
    expect(cookie).toBeTruthy();
    expect(await me(cookie)).toMatchObject({ email: "maya@elsewhere.example", tenant_allowance: { remaining: 1 } });
    // Spent, whether opened or pressed again.
    expect((await open(link)).headers.get("location")).toBe("/signin?error=link_expired");
    const again = await press(link);
    expect(again.headers.get("location")).toBe("/signin?error=link_expired");
    expect(sessionOf(again)).toBeUndefined();
  });

  it("says, from the waitlist, only that the address can now start an organization", async () => {
    await h.db.insertInto("interest").values({ interest_id: "01M5TINTEREST0000000000ENT", email: "wren@elsewhere.example", name: null, organization: null, note: null }).execute();
    const html = await (await open(await allow("wren@elsewhere.example"))).text();
    expect(html).toContain("<p><strong>wren@elsewhere.example</strong> can now start an organization on WhatBuild.</p>");
    expect(html).not.toContain("Owen");
  });

  it("is revoked when the allowance is taken away or lowered to none", async () => {
    const removed = await allow("rhea@elsewhere.example");
    const current = (await owner.api("GET", A)).body.items.find((i: { email: string }) => i.email === "rhea@elsewhere.example");
    expect((await owner.api("POST", `${A}/remove`, { email: "rhea@elsewhere.example", expected_etag: current.etag })).status).toBe(200);
    expect((await open(removed)).headers.get("location")).toBe("/signin?error=link_expired");
    const pressed = await press(removed);
    expect(pressed.headers.get("location")).toBe("/signin?error=link_expired");
    expect(sessionOf(pressed)).toBeUndefined();
    expect(await accountOf("rhea@elsewhere.example")).toBeUndefined();

    const lowered = await allow("ravi@elsewhere.example");
    const row = (await owner.api("GET", A)).body.items.find((i: { email: string }) => i.email === "ravi@elsewhere.example");
    await owner.api("PUT", A, { email: "ravi@elsewhere.example", allowed: 0, expected_etag: row.etag });
    expect((await press(lowered)).headers.get("location")).toBe("/signin?error=link_expired");
    expect(await accountOf("ravi@elsewhere.example")).toBeUndefined();
  });
});

describe("an invitation's link", () => {
  it("is its own, never the link the inviter is given, which signs nobody in", async () => {
    const { inviteLink, link } = await invite("leo@elsewhere.example");
    expect(link).not.toBe(inviteLink);
    expect(new URL(inviteLink).pathname).toMatch(/^\/invite\//);
    // The inviter's link names only the invitation: the entry link's routes don't take its token.
    const token = inviteLink.split("/invite/")[1]!;
    expect((await open(`${h.baseUrl}/auth/start?token=${token}`)).headers.get("location")).toBe("/signin?error=link_expired");
    expect((await fetch(`${h.baseUrl}/auth/verify?token=${token}`, { redirect: "manual" })).headers.get("location")).toBe("/signin?error=link_expired");
  });

  it("opens a page naming who invited whom where, and pressing it signs in and opens the invitation, still to answer", async () => {
    const id = (await h.db.selectFrom("invitations").select("invitation_id").where("email", "=", "leo@elsewhere.example").executeTakeFirstOrThrow()).invitation_id;
    const link = linkTo("leo@elsewhere.example");
    const page = await open(link);
    expect(page.headers.get("set-cookie")).toBeNull();
    const html = await page.text();
    expect(html).toContain("<title>Join Acme Labs · WhatBuild</title>");
    expect(html).toContain("<h1>Join Acme Labs on WhatBuild</h1>");
    expect(html).toContain("<p>Owen Owner (owen@staff.example) invited <strong>leo@elsewhere.example</strong> to Acme Labs, as an editor.</p>");
    expect(html).toMatch(/<button type="submit" class="primary">Continue as leo@elsewhere\.example<\/button>/);
    expect(html).toContain("Continuing signs you in as leo@elsewhere.example, and you can still decline. Not you? Close this tab and nothing happens.");
    const r = await press(link);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`/invitations/${id}`);
    const cookie = sessionOf(r)!;
    // Signed in, not joined: the invitation waits for their answer, which the page by its id gives.
    const read = await fetch(`${h.baseUrl}/api/v1/invitations/read`, { method: "POST", headers: { cookie, origin: h.baseUrl, "content-type": "application/json" }, body: JSON.stringify({ invitation_id: id }) });
    expect(await read.json()).toMatchObject({ invitation_id: id, accepted: false, role: "editor" });
    const declined = await fetch(`${h.baseUrl}/api/v1/invitations/decline`, { method: "POST", headers: { cookie, origin: h.baseUrl, "content-type": "application/json" }, body: JSON.stringify({ invitation_id: id }) });
    expect(declined.status).toBe(200);
    expect((await open(link)).headers.get("location")).toBe("/signin?error=link_expired");
  });

  it("is revoked when the invitation is cancelled, replaced or past its time", async () => {
    const cancelled = await invite("cara@elsewhere.example");
    expect((await owner.api("POST", `/api/v1/tenants/${org}/invitations/cancel`, { invitation_id: cancelled.id })).status).toBe(200);
    expect((await open(cancelled.link)).headers.get("location")).toBe("/signin?error=link_expired");
    expect((await press(cancelled.link)).headers.get("location")).toBe("/signin?error=link_expired");
    expect(await accountOf("cara@elsewhere.example")).toBeUndefined();

    const first = await invite("remy@elsewhere.example", "viewer");
    const second = await invite("remy@elsewhere.example", "editor");
    expect((await press(first.link)).headers.get("location")).toBe("/signin?error=link_expired");
    expect((await open(second.link)).status).toBe(200);

    const late = await invite("lena@elsewhere.example");
    await h.db.updateTable("invitations").set({ expires_at: new Date(Date.now() - 1000).toISOString() }).where("invitation_id", "=", late.id).execute();
    expect((await press(late.link)).headers.get("location")).toBe("/signin?error=link_expired");
    expect(await accountOf("lena@elsewhere.example")).toBeUndefined();
  });

  it("is never needed: signed in the usual way, the invitation is there, and answering it there ends the link", async () => {
    const { id, link } = await invite("ana@elsewhere.example");
    const ana = await h.signIn("ana@elsewhere.example");
    const listed = (await ana.api("GET", "/api/v1/me/invitations")).body.items as { invitation_id: string }[];
    expect(listed.map((i) => i.invitation_id)).toEqual([id]);
    expect((await ana.api("POST", "/api/v1/invitations/accept", { invitation_id: id })).status).toBe(200);
    // The address has an account now, so the link leads only to Sign in, and signs nobody in.
    for (const r of [await open(link), await press(link)]) {
      expect(r.headers.get("location")).toMatch(/^\/signin/);
      expect(sessionOf(r)).toBeUndefined();
    }
  });
});

describe("an address that already has an account", () => {
  it("is never signed in by a link: it goes to Sign in, and on to Welcome or the invitation", async () => {
    const kim = await h.signIn("kim@staff.example", "Kim");
    const allowance = await allow("kim@staff.example");
    expect((await open(allowance)).headers.get("location")).toBe("/signin?next=%2Fwelcome");
    const pressed = await press(allowance);
    expect(pressed.status).toBe(303);
    expect(pressed.headers.get("location")).toBe("/signin?next=%2Fwelcome");
    expect(sessionOf(pressed)).toBeUndefined();

    const { id, link } = await invite("kim@staff.example");
    expect((await open(link)).headers.get("location")).toBe(`/signin?next=${encodeURIComponent(`/invitations/${id}`)}`);
    const again = await press(link);
    expect(again.headers.get("location")).toBe(`/signin?next=${encodeURIComponent(`/invitations/${id}`)}`);
    expect(sessionOf(again)).toBeUndefined();
    // Signed in the usual way, the invitation is there.
    expect(((await kim.api("GET", "/api/v1/me/invitations")).body.items as { invitation_id: string }[]).map((i) => i.invitation_id)).toContain(id);
  });

  it("is not signed in even when its account is made between opening the page and pressing it", async () => {
    const { link } = await invite("tess@elsewhere.example");
    expect((await open(link)).status).toBe(200);
    await h.signIn("tess@elsewhere.example");
    const r = await press(link);
    expect(r.headers.get("location")).toMatch(/^\/signin\?next=%2Finvitations%2F/);
    expect(sessionOf(r)).toBeUndefined();
  });
});

describe("pressing the button", () => {
  it("is refused from another site, and the link still works from its own page", async () => {
    const link = await allow("omar@elsewhere.example");
    for (const origin of ["https://evil.example", "null"]) {
      const r = await press(link, origin);
      expect(r.status, origin).toBe(403);
      expect(sessionOf(r)).toBeUndefined();
    }
    expect((await linkRow(link)).used_at).toBeNull();
    expect(await accountOf("omar@elsewhere.example")).toBeUndefined();
    expect((await press(link)).headers.get("location")).toBe("/welcome");
  });

  it("signs in one of several presses that arrive together", async () => {
    const link = await allow("race@elsewhere.example");
    const results = await Promise.all(Array.from({ length: 6 }, () => press(link)));
    expect(results.filter((r) => sessionOf(r) && r.headers.get("location") === "/welcome")).toHaveLength(1);
    expect(results.filter((r) => r.headers.get("location") === "/signin?error=link_expired")).toHaveLength(5);
  });

  it("goes to Sign in for a link that is unknown or past its time", async () => {
    expect((await open(`${h.baseUrl}/auth/start?token=nothing-like-a-token`)).headers.get("location")).toBe("/signin?error=link_expired");
    const link = await allow("pia@elsewhere.example");
    await h.db.updateTable("email_tokens").set({ expires_at: new Date(Date.now() - 1000).toISOString() }).where("token_hash", "=", hash(tokenOf(link))).execute();
    expect((await open(link)).headers.get("location")).toBe("/signin?error=link_expired");
    expect((await press(link)).headers.get("location")).toBe("/signin?error=link_expired");
    expect(await accountOf("pia@elsewhere.example")).toBeUndefined();
  });
});

describe("kept apart from the ordinary sign-in link", () => {
  it("is good for 7 days, kept by its hash alone", async () => {
    const link = await allow("noor@elsewhere.example");
    const row = await linkRow(link);
    expect(row.purpose).toBe("allowance");
    expect(row.redirect).toBe("/welcome");
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBeGreaterThan(7 * 86400_000 - 60_000);
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBeLessThan(7 * 86400_000 + 60_000);
    expect(JSON.stringify(await h.db.selectFrom("email_tokens").selectAll().execute())).not.toContain(tokenOf(link));
  });

  it("takes neither the other's token, and counts nothing against an address's sign-in links", async () => {
    const link = await allow("ines@elsewhere.example", 2);
    // An entry link on the sign-in link's routes is unknown there.
    expect((await fetch(`${h.baseUrl}/auth/verify?token=${tokenOf(link)}`, { redirect: "manual" })).headers.get("location")).toBe("/signin?error=link_expired");
    const verify = await fetch(`${h.baseUrl}/auth/verify`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: h.baseUrl }, body: new URLSearchParams({ token: tokenOf(link) }) });
    expect(verify.headers.get("location")).toBe("/signin?error=link_expired");
    // Five more entry links for the address still leave its five sign-in links an hour.
    for (let n = 3; n < 8; n++) {
      const row = (await owner.api("GET", A)).body.items.find((i: { email: string }) => i.email === "ines@elsewhere.example");
      await owner.api("PUT", A, { email: "ines@elsewhere.example", allowed: n, expected_etag: row.etag });
    }
    const ask = () => fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email: "ines@elsewhere.example" }) });
    for (let i = 0; i < 5; i++) expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
    // A sign-in link is unknown to the entry link's routes.
    const signIn = /https?:\/\/\S+\/auth\/verify\?token=(\S+)/.exec(h.mailer.sent.at(-1)!.text)?.[1];
    expect(signIn).toBeTruthy();
    expect((await open(`${h.baseUrl}/auth/start?token=${signIn}`)).headers.get("location")).toBe("/signin?error=link_expired");
    // The entry link itself still works.
    expect((await press(link)).headers.get("location")).toBe("/welcome");
  });
});

describe("on a deployment with a public site", () => {
  it("offers a look at the site first", async () => {
    const sited = await startHarness({ siteUrl: "https://site.example", instanceOwners: ["owen@staff.example"], defaultTenantAllowance: 0 });
    try {
      const owen = await sited.signIn("owen@staff.example", "Owen Owner");
      await owen.api("PUT", A, { email: "sol@elsewhere.example", allowed: 1 });
      const link = /https?:\/\/\S+\/auth\/start\?token=\S+/.exec(sited.mailer.sent.at(-1)!.text)![0];
      const html = await (await fetch(link, { redirect: "manual" })).text();
      expect(html).toContain('<p class="muted"><a href="https://site.example" target="_blank" rel="noreferrer">What is WhatBuild?</a></p>');
    } finally {
      await sited.close();
    }
  });
});
