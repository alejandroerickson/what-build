import { json, newId } from "@whatbuild/core";
import { sql } from "kysely";
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

  it("gives someone whose roles are on products only the organization role member, as the Members page does", async () => {
    const tenant = (await pat.api("GET", "/api/v1/me/products")).body.tenants.find((t: { slug: string }) => t.slug === T);
    expect(tenant.your_role).toBe("member");
    expect((await adam.api("GET", "/api/v1/me/products")).body.tenants.find((t: { slug: string }) => t.slug === T).your_role).not.toBe("member");
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

  it("answers someone outside the organization as if it did not exist, calling it an organization", async () => {
    const stranger = await h.signIn("sol@example.com", "Sol Stranger");
    const outside = await list(stranger);
    const madeUp = await stranger.api("GET", "/api/v1/tenants/no-such-organization/members");
    expect(outside.status).toBe(404);
    expect(outside.body.error.message).toBe("No such organization is visible to you. It may not exist, or you may not be a member.");
    expect(madeUp.status).toBe(404);
    expect(madeUp.body.error.message).toBe(outside.body.error.message);
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

  it.each([
    ["Left Acme Labs (2 roles) by deleting their account", "account_deleted"],
    ["Removed from Acme Labs (1 role) with the account, by an owner of this instance", "account_removed"],
    ["Removed from Acme Labs (2 roles)", "revoked"],
    ["Removed editor on product Planner", "revoked"],
    ["Removed editor on product Left by deleting their account", "revoked"],
  ])("reads an entry recorded as revoked, saying %s, as %s", async (summary, action) => {
    const { tenant_id } = await h.db.selectFrom("tenants").select("tenant_id").where("slug", "=", T).executeTakeFirstOrThrow();
    const activityId = newId();
    await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenant_id}, true)`.execute(trx);
      await trx
        .insertInto("activity")
        .values({
          activity_id: activityId, tenant_id, team_id: null, product_id: null,
          actor: json({ account_id: "someone", display_name: "Someone", surface: "web", client: null }),
          actor_account_id: "someone", channel: "web", action: "revoked", entity_type: "membership", entity_id: "someone", entity_title: "Someone", summary,
        })
        .execute();
    });
    const entry = (await alice.api("GET", `/api/v1/tenants/${T}/members/activity?limit=200`)).body.items.find((i: { activity_id: string }) => i.activity_id === activityId);
    expect(entry).toMatchObject({ action, summary });
  });

  it("shows owners and admins every change to who has access, newest first, with no email address", async () => {
    await grant(alice, { team: planning, product: "planner", email: "pat@example.com", role: "editor" });
    const pending = (await list(alice)).body.invitations.find((i: { email: string }) => i.email === "org-invitee@example.com");
    expect((await alice.api("POST", `/api/v1/tenants/${T}/invitations/cancel`, { invitation_id: pending.invitation_id })).status).toBe(200);
    // Hal's only role: taking it takes them out of the organization, which the answer and the log say.
    const revoked = await alice.api("POST", `/api/v1/tenants/${T}/members/revoke`, { account_id: ids["hal@example.com"], team: "research", product: "secret-bets" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.left_organization).toBe(true);

    const r = await log(adam, "?limit=200");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items: { action: string; entity_type: string; entity_title: string | null; summary: string; actor: { display_name: string } }[] = r.body.items;
    expect(items.slice(0, 3).map((i) => i.action)).toEqual(["revoked", "invitation_cancelled", "role_changed"]);
    expect(items[0]).toMatchObject({ entity_title: "Hal Hidden", summary: "Removed from Acme Labs: editor on product Secret Bets was their only role", actor: { display_name: "Alice Owner" } });
    expect(items[2]).toMatchObject({ entity_title: "Pat Viewer", summary: "Changed role to editor on product Planner" });
    // Everyone was invited, accounts or not, and those who accepted joined.
    expect(items.filter((i) => i.action === "invited")).toHaveLength(10);
    expect(items.filter((i) => i.action === "joined").map((i) => i.entity_title).sort()).toEqual(["Adam Admin", "Hal Hidden", expect.stringMatching(/^Mallory/), "Olga Owner", "Pam Product-Admin", "Pat Viewer"]);
    expect(items.every((i) => i.entity_type === "membership")).toBe(true);
    const text = JSON.stringify(r.body);
    for (const address of [...Object.keys(ids), "planner-invitee@", "secret-invitee@", "org-invitee@", "newcomer@"]) expect(text, address).not.toContain(address);

    const page = await log(alice, "?limit=2");
    expect(page.body.items).toHaveLength(2);
    const next = await log(alice, `?limit=2&cursor=${page.body.next_cursor}`);
    expect(next.body.items[0].activity_id < page.body.items[1].activity_id).toBe(true);
  });

  it("is refused to anyone else, an admin of a product included", async () => {
    for (const who of [pat, pam]) {
      const r = await log(who);
      expect(r.status).toBe(403);
      expect(r.body.error.message).toBe("This needs an owner or admin of Acme Labs.");
    }
  });

  it("stays out of a product's own activity, all but someone joining it through an invitation", async () => {
    const product = await pam.api("GET", `/api/v1/p/${T}/${planning}/planner/activity?limit=200`);
    expect(product.status).toBe(200);
    const access = product.body.items.filter((i: { entity_type: string }) => i.entity_type === "membership");
    expect(access.length).toBeGreaterThan(0);
    expect(access.every((i: { action: string }) => i.action === "joined")).toBe(true);
  });
});

describe("giving many people roles at once", () => {
  const many = (who: Browser, body: Record<string, unknown>) => who.api("POST", `/api/v1/tenants/${T}/members/many`, body);
  const onPlanner = { team: planning, product: "planner" };

  it("gives people already in the organization their role at once, and invites everyone else, in one call that sends each invitation", async () => {
    await h.signIn("bea@example.com", "Bea Batch");
    await h.signIn("cy@example.com", "Cy Batch");
    const before = h.mailer.sent.length;
    const r = await many(alice, {
      ...onPlanner,
      people: [
        { email: "bea@example.com", role: "editor" },
        { email: "CY@example.com", role: "reader" },
        { email: "pat@example.com", role: "viewer" },
        { email: "dee-invitee@example.com", role: "viewer" },
        { email: "eli-invitee@example.com", role: "reader" },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Pat is in the organization; Bea and Cy have accounts but aren't, so they are invited like anyone else.
    expect(r.body).toMatchObject({ scope_type: "product", scope: "Planner", granted: 0, invited: 4 });
    expect(r.body.changed + r.body.unchanged).toBe(1);
    const byEmail = Object.fromEntries(r.body.results.map((x: { email: string }) => [x.email, x]));
    expect(byEmail["pat@example.com"]).toMatchObject({ invited: false, display_name: "Pat Viewer", role: "viewer" });
    for (const e of ["bea@example.com", "CY@example.com", "dee-invitee@example.com", "eli-invitee@example.com"]) {
      expect(byEmail[e]).toMatchObject({ invited: true });
      expect(byEmail[e].invite_link).toContain("/invite/");
    }
    expect(h.mailer.sent.slice(before).map((m) => m.to.toLowerCase()).sort()).toEqual(["bea@example.com", "cy@example.com", "dee-invitee@example.com", "eli-invitee@example.com"]);
    // Bea and Cy, signed in here, accepted; the others' invitations wait.
    const people = await list(alice, `?team=${planning}&product=planner`);
    const role = (email: string) => people.body.members.find((m: { email: string }) => m.email === email)?.product_access.role;
    expect([role("bea@example.com"), role("cy@example.com")]).toEqual(["editor", "reader"]);
    expect(people.body.invitations.map((i: { email: string }) => i.email)).toEqual(expect.arrayContaining(["dee-invitee@example.com", "eli-invitee@example.com"]));
  });

  it("says unchanged for a role someone already holds there, and records nothing for it", async () => {
    const log = async () => (await alice.api("GET", `/api/v1/tenants/${T}/members/activity?limit=200`)).body.items.length;
    const was = await log();
    const r = await many(alice, { ...onPlanner, people: [{ email: "bea@example.com", role: "editor" }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ granted: 0, changed: 0, unchanged: 1, invited: 0 });
    expect(r.body.results[0].unchanged).toBe(true);
    expect(await log()).toBe(was);
    const changed = await many(alice, { ...onPlanner, people: [{ email: "bea@example.com", role: "viewer" }] });
    expect(changed.body).toMatchObject({ changed: 1 });
    expect(changed.body.results[0]).toMatchObject({ role: "viewer", previous_role: "editor" });
  });

  it("changes nothing when any one of them is refused, and names that address", async () => {
    const mails = h.mailer.sent.length;
    const cases: [Record<string, unknown>, string][] = [
      // A role that doesn't apply where they land: owner on a product, editor of the organization.
      [{ ...onPlanner, people: [{ email: "fay-invitee@example.com", role: "viewer" }, { email: "gus-invitee@example.com", role: "owner" }] }, "gus-invitee@example.com"],
      [{ people: [{ email: "fay-invitee@example.com", role: "member" }, { email: "gus-invitee@example.com", role: "editor" }] }, "gus-invitee@example.com"],
      // The same address twice, whatever its case.
      [{ ...onPlanner, people: [{ email: "fay-invitee@example.com", role: "viewer" }, { email: "Fay-Invitee@example.com", role: "editor" }] }, "Fay-Invitee@example.com"],
    ];
    for (const [body, named] of cases) {
      const r = await many(alice, body);
      expect(r.status, JSON.stringify(r.body)).toBe(422);
      expect(r.body.error.message).toContain(named);
      expect(r.body.error.message).toContain("Nothing was changed");
    }
    expect(h.mailer.sent.length).toBe(mails);
    const invited = (await list(alice)).body.invitations.map((i: { email: string }) => i.email.toLowerCase());
    for (const e of ["fay-invitee@example.com", "gus-invitee@example.com"]) expect(invited).not.toContain(e);
  });

  it("is refused to someone who doesn't administer the scope, and answers a product they can't see as missing", async () => {
    const own = await many(pat, { ...onPlanner, people: [{ email: "hank-invitee@example.com", role: "viewer" }] });
    expect(own.status).toBe(403);
    const hidden = await many(pam, { team: "research", product: "secret-bets", people: [{ email: "pat@example.com", role: "viewer" }] });
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain("Secret Bets");
    const owners = await many(adam, { people: [{ email: "pat@example.com", role: "owner" }] });
    expect(owners.status).toBe(403);
    expect(owners.body.error.details).toMatchObject({ needed: "owner" });
  });

  it("keeps the last owner, undoing the roles given before it in the same call", async () => {
    const solo = await h.signIn("solo@example.com", "Solo Owner");
    const t = (await solo.api("POST", "/api/v1/tenants", { name: "Solo Works" })).body.tenant.slug;
    await h.signIn("ivy@example.com", "Ivy Batch");
    const r = await solo.api("POST", `/api/v1/tenants/${t}/members/many`, { people: [{ email: "ivy@example.com", role: "admin" }, { email: "solo@example.com", role: "admin" }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("last_owner");
    expect(r.body.error.details).toMatchObject({ email: "solo@example.com" });
    const people = (await solo.api("GET", `/api/v1/tenants/${t}/members`)).body.members.map((m: { email: string }) => m.email);
    expect(people).toEqual(["solo@example.com"]);
  });

  it("takes at most 100 people a call", async () => {
    const people = Array.from({ length: 101 }, (_, i) => ({ email: `many-${i}@example.com`, role: "reader" }));
    expect((await many(alice, { ...onPlanner, people })).status).toBe(422);
    expect((await many(alice, { ...onPlanner, people: [] })).status).toBe(422);
  });
});

describe("an address the giver can't already see in the organization", () => {
  // The answer, the email, the lists and the logs are the same for an address with an account
  // anywhere on this WhatBuild and for one with none, so giving a role never tells anyone outside an
  // organization who is in it, or who has an account at all.
  const shape = (body: Record<string, unknown>) => Object.keys(body).sort();

  it("is invited whether or not it has an account, with the same answer, and joins only by accepting", async () => {
    h.acceptsInvitations = false;
    try {
      const elsewhere = await h.signIn("otto@example.com", "Otto Elsewhere");
      await elsewhere.api("POST", "/api/v1/tenants", { name: "Otto's Own" });
      const known = await grant(alice, { team: planning, product: "planner", email: "otto@example.com", role: "editor" });
      const unknown = await grant(alice, { team: planning, product: "planner", email: "no-account@example.com", role: "editor" });
      expect(known.status).toBe(201);
      expect(unknown.status).toBe(201);
      expect(shape(known.body)).toEqual(shape(unknown.body));
      expect(known.body).toMatchObject({ invited: true, role: "editor" });
      expect(JSON.stringify(known.body)).not.toMatch(/Otto Elsewhere|account_id|display_name/);
      const [toKnown, toUnknown] = h.mailer.sent.slice(-2);
      expect(toKnown!.subject).toBe(toUnknown!.subject);
      expect(toKnown!.text.replace(/\/invite\/\S+/, "")).toBe(toUnknown!.text.replace(/\/invite\/\S+/, ""));

      // Not a member, and not named anywhere, until they accept.
      const listed = await list(alice);
      expect(listed.body.members.some((m: { email: string }) => m.email === "otto@example.com")).toBe(false);
      expect(listed.body.invitations.map((i: { email: string }) => i.email)).toEqual(expect.arrayContaining(["otto@example.com", "no-account@example.com"]));
      const log = await alice.api("GET", `/api/v1/tenants/${T}/members/activity?limit=200`);
      expect(JSON.stringify(log.body)).not.toContain("Otto Elsewhere");

      const many = await alice.api("POST", `/api/v1/tenants/${T}/members/many`, { ...{ team: planning, product: "planner" }, people: [{ email: "otto@example.com", role: "viewer" }, { email: "no-account-2@example.com", role: "viewer" }] });
      expect(many.status).toBe(201);
      expect(many.body).toMatchObject({ granted: 0, invited: 2 });
      expect(shape(many.body.results[0])).toEqual(shape(many.body.results[1]));

      const token = String(known.body.invite_link).split("/invite/")[1];
      expect((await elsewhere.api("POST", "/api/v1/invitations/accept", { token })).status).toBe(200);
      const joined = (await list(alice)).body.members.find((m: { email: string }) => m.email === "otto@example.com");
      expect(joined).toMatchObject({ display_name: "Otto Elsewhere" });
    } finally {
      h.acceptsInvitations = true;
    }
  });

  it("is invited when it is in the organization but not on what the giver reads, so a product's admin learns nothing of who else is in it", async () => {
    h.acceptsInvitations = false;
    try {
      // Hal is on Secret Bets, which Pam, an admin of Planner only, can't see.
      await grant(alice, { team: "research", product: "secret-bets", email: "hal@example.com", role: "editor" });
      const hidden = await grant(pam, { team: planning, product: "planner", email: "hal@example.com", role: "viewer" });
      expect(hidden.status).toBe(201);
      expect(hidden.body).toMatchObject({ invited: true });
      expect(JSON.stringify(hidden.body)).not.toContain("Hal Hidden");
      // Pat, on Planner, Pam sees: the role is given at once.
      const seen = await grant(pam, { team: planning, product: "planner", email: "pat@example.com", role: "viewer" });
      expect(seen.body).toMatchObject({ invited: false, display_name: "Pat Viewer" });
    } finally {
      h.acceptsInvitations = true;
    }
  });
});
