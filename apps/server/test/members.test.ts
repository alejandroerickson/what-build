import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

/**
 * Acme Labs has two teams. Planning holds Planner, which Pat views and Pam administers; Research
 * holds Secret Bets, which only Hal and the organization's owners and admins can open.
 */
let h: Harness;
let alice: Browser; // owner
let olga: Browser; // a second owner
let adam: Browser; // organization admin
let pat: Browser; // viewer of Planner
let pam: Browser; // admin of Planner
let hal: Browser; // editor of Secret Bets
let T: string;
let planning: string;
let ids: Record<string, string>;

const grant = (who: Browser, body: Record<string, string>) => who.api("POST", `/api/v1/tenants/${T}/members`, body);
const list = (who: Browser, query = "") => who.api("GET", `/api/v1/tenants/${T}/members${query}`);
const emails = (r: { body: { members: { email: string }[] } }) => r.body.members.map((m) => m.email).sort();

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Owner");
  olga = await h.signIn("olga@example.com", "Olga Owner");
  adam = await h.signIn("adam@example.com", "Adam Admin");
  pat = await h.signIn("pat@example.com", "Pat Viewer");
  pam = await h.signIn("pam@example.com", "Pam Product-Admin");
  hal = await h.signIn("hal@example.com", "Hal Hidden");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Acme Labs" });
  T = t.body.tenant.slug;
  planning = t.body.team.slug;
  await alice.api("POST", `/api/v1/teams/${T}/${planning}/products`, { name: "Planner" });
  const research = await alice.api("POST", `/api/v1/tenants/${T}/teams`, { name: "Research" });
  await alice.api("POST", `/api/v1/teams/${T}/${research.body.slug}/products`, { name: "Secret Bets" });
  await grant(alice, { email: "olga@example.com", role: "owner" });
  await grant(alice, { email: "adam@example.com", role: "admin" });
  await grant(alice, { team: planning, product: "planner", email: "pat@example.com", role: "viewer" });
  await grant(alice, { team: planning, product: "planner", email: "pam@example.com", role: "admin" });
  await grant(alice, { team: research.body.slug, product: "secret-bets", email: "hal@example.com", role: "editor" });
  await grant(alice, { team: planning, product: "planner", email: "planner-invitee@example.com", role: "viewer" });
  await grant(alice, { team: research.body.slug, product: "secret-bets", email: "secret-invitee@example.com", role: "editor" });
  await grant(alice, { email: "org-invitee@example.com", role: "member" });
  ids = Object.fromEntries((await list(alice)).body.members.map((m: { email: string; account_id: string }) => [m.email, m.account_id]));
});
afterAll(async () => h?.close());

describe("owners", () => {
  it("can be demoted only by an owner", async () => {
    for (const role of ["member", "admin"]) {
      const r = await grant(adam, { email: "olga@example.com", role });
      expect(r.status, role).toBe(403);
      expect(r.body.error.details).toMatchObject({ needed: "owner" });
    }
    const removed = await adam.api("POST", `/api/v1/tenants/${T}/members/revoke`, { account_id: ids["olga@example.com"] });
    expect(removed.status).toBe(403);
    const olgaNow = (await list(alice)).body.members.find((m: { email: string }) => m.email === "olga@example.com");
    expect(olgaNow.grants).toMatchObject([{ scope_type: "tenant", role: "owner" }]);
    // An owner may, while another owner remains.
    expect((await grant(alice, { email: "olga@example.com", role: "admin" })).status).toBe(201);
    expect((await grant(alice, { email: "olga@example.com", role: "owner" })).status).toBe(201);
  });
});

describe("who sees the organization's people", () => {
  it("shows owners and admins everyone, with every grant and invitation", async () => {
    const r = await list(adam);
    expect(emails(r)).toEqual(["adam@example.com", "alice@example.com", "hal@example.com", "olga@example.com", "pam@example.com", "pat@example.com"]);
    expect(r.body.invitations.map((i: { email: string }) => i.email).sort()).toEqual(["org-invitee@example.com", "planner-invitee@example.com", "secret-invitee@example.com"]);
    expect(r.body.partial).toBeUndefined();
  });

  it("shows anyone else only the people on the teams and products they can read, and nothing of the rest", async () => {
    const r = await list(pat);
    expect(r.status).toBe(200);
    expect(r.body.partial).toBe(true);
    expect(emails(r)).toEqual(["adam@example.com", "alice@example.com", "olga@example.com", "pam@example.com", "pat@example.com"]);
    expect(r.body.invitations).toEqual([]);
    const text = JSON.stringify(r.body);
    for (const hidden of ["Secret Bets", "secret-bets", "Research", "research", "hal@", "invitee"]) expect(text, hidden).not.toContain(hidden);
    const halSees = await list(hal);
    expect(emails(halSees)).toEqual(["adam@example.com", "alice@example.com", "hal@example.com", "olga@example.com"]);
    expect(JSON.stringify(halSees.body)).not.toMatch(/Planner|pat@|pam@/);
  });

  it("shows an admin of a product the invitations they can cancel, and no others", async () => {
    const r = await list(pam);
    expect(r.body.invitations.map((i: { email: string }) => i.email)).toEqual(["planner-invitee@example.com"]);
    expect(JSON.stringify(r.body)).not.toMatch(/Secret Bets|hal@|secret-invitee|org-invitee/);
  });

  it("answers a product the caller cannot open as if it did not exist", async () => {
    const hidden = await list(pat, "?team=research&product=secret-bets");
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain("Secret Bets");
    const own = await list(pat, `?team=${planning}&product=planner`);
    expect(own.status).toBe(200);
    expect(emails(own)).toEqual(["adam@example.com", "alice@example.com", "olga@example.com", "pam@example.com", "pat@example.com"]);
    const granting = await grant(pam, { team: "research", product: "secret-bets", email: "pat@example.com", role: "viewer" });
    expect(granting.status).toBe(404);
    expect(JSON.stringify(granting.body)).not.toContain("Secret Bets");
  });
});

describe("an invitation email", () => {
  it("shows the inviter's name on one line, quoted and bounded, whatever they chose", async () => {
    const mallory = await h.signIn("mallory@example.com", "Mallory\r\nBcc: everyone@example.com‮ WhatBuild Security: your account is locked, reset it");
    await grant(alice, { email: "mallory@example.com", role: "admin" });
    expect((await grant(mallory, { team: planning, product: "planner", email: "newcomer@example.com", role: "viewer" })).status).toBe(201);
    const mail = h.mailer.sent.at(-1)!;
    expect(mail.to).toBe("newcomer@example.com");
    expect(mail.subject).not.toMatch(/[\r\n‮]/);
    expect(mail.subject).toMatch(/^"Mallory Bcc: everyone@example\.com WhatBuild Secu[^"]*…" invited you to Planner on WhatBuild$/);
    const [first] = mail.text.split("\n");
    expect(first).toMatch(/^"Mallory Bcc: [^"]*…" invited you to Planner on WhatBuild, as a viewer\.$/);
    expect(mail.text).toContain("/invite/");
  });
});

describe("the organization's access log", () => {
  const log = (who: Browser, query = "") => who.api("GET", `/api/v1/tenants/${T}/members/activity${query}`);

  it("shows owners and admins every change to who has access, newest first, with no email address", async () => {
    await grant(alice, { team: planning, product: "planner", email: "pat@example.com", role: "editor" });
    const pending = (await list(alice)).body.invitations.find((i: { email: string }) => i.email === "org-invitee@example.com");
    expect((await alice.api("POST", `/api/v1/tenants/${T}/invitations/cancel`, { invitation_id: pending.invitation_id })).status).toBe(200);
    expect((await alice.api("POST", `/api/v1/tenants/${T}/members/revoke`, { account_id: ids["hal@example.com"], team: "research", product: "secret-bets" })).status).toBe(200);

    const r = await log(adam, "?limit=200");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items: { action: string; entity_type: string; entity_title: string | null; summary: string; actor: { display_name: string } }[] = r.body.items;
    expect(items.slice(0, 3).map((i) => i.action)).toEqual(["revoked", "invitation_cancelled", "role_changed"]);
    expect(items[0]).toMatchObject({ entity_title: "Hal Hidden", summary: "Removed editor on product Secret Bets", actor: { display_name: "Alice Owner" } });
    expect(items[2]).toMatchObject({ entity_title: "Pat Viewer", summary: "Changed role to editor on product Planner" });
    expect(items.filter((i) => i.action === "invited")).toHaveLength(4);
    expect(items.every((i) => i.entity_type === "membership")).toBe(true);
    const text = JSON.stringify(r.body);
    for (const address of [...Object.keys(ids), "planner-invitee@", "secret-invitee@", "org-invitee@", "newcomer@"]) expect(text, address).not.toContain(address);

    const page = await log(alice, "?limit=2");
    expect(page.body.items).toHaveLength(2);
    const next = await log(alice, `?limit=2&cursor=${page.body.next_cursor}`);
    expect(next.body.items[0].activity_id < page.body.items[1].activity_id).toBe(true);
  });

  it("is refused to anyone else, an admin of a product included", async () => {
    for (const who of [pat, pam]) expect((await log(who)).status).toBe(403);
  });

  it("stays out of a product's own activity", async () => {
    const product = await pam.api("GET", `/api/v1/p/${T}/${planning}/planner/activity?limit=200`);
    expect(product.status).toBe(200);
    expect(product.body.items.some((i: { entity_type: string }) => i.entity_type === "membership")).toBe(false);
  });
});
