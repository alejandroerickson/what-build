import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, withPlanLimits, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let owner: Browser;
let tenant: string;
let team: string;
let path: string;

/** Whoever is invited here answers for themselves: nothing is accepted on their behalf. */
beforeAll(async () => {
  h = await startHarness();
  h.acceptsInvitations = false;
  owner = await h.signIn("owner@example.com", "Olive Owner");
  const t = await owner.api("POST", "/api/v1/tenants", { name: "Acme Labs" });
  tenant = t.body.tenant.slug;
  team = t.body.team.slug;
  path = (await owner.api("POST", `/api/v1/teams/${tenant}/${team}/products`, { name: "Crewboard" })).body.path;
});
afterAll(async () => h?.close());

const invite = async (email: string, role = "editor", where: Record<string, string> = { team }) => {
  const r = await owner.api("POST", `/api/v1/tenants/${tenant}/members`, { ...where, email, role });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: String(r.body.invitation_id), token: String(r.body.invite_link).split("/invite/")[1]!, link: String(r.body.invite_link) };
};
const pending = async (who: Browser) => (await who.api("GET", "/api/v1/me/invitations")).body.items as { invitation_id: string; tenant: { slug: string; name: string }; scope_type: string; scope: string; role: string; invited_by: string; expires_at: string }[];
const reaches = async (who: Browser) => ((await who.api("GET", "/api/v1/me/products")).body.items as { path: string }[]).some((p) => p.path === path);
const log = async () => (await owner.api("GET", `/api/v1/tenants/${tenant}/members/activity?limit=200`)).body.items as { action: string; entity_id: string; entity_title: string | null; summary: string; actor: { account_id: string; display_name: string } }[];
const row = (id: string) => h.db.selectFrom("invitations").selectAll().where("invitation_id", "=", id).executeTakeFirstOrThrow();

describe("signing in", () => {
  it("accepts nothing, and the invitation waits", async () => {
    const { id } = await invite("dev-newcomer@example.com");
    const newcomer = await h.signIn("dev-newcomer@example.com", "Nia Newcomer");
    expect(await reaches(newcomer)).toBe(false);
    expect((await row(id)).accepted_at).toBeNull();
    expect((await pending(newcomer)).map((i) => i.invitation_id)).toEqual([id]);
    // Signing in again changes nothing either: someone with an account must not find a new organization in their panel.
    const again = await h.signIn("dev-newcomer@example.com");
    expect(await reaches(again)).toBe(false);
    expect((await row(id)).accepted_at).toBeNull();
  });

  it("by an email link accepts nothing either", async () => {
    const { id } = await invite("linked@example.com");
    await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "linked@example.com" }) });
    await expect.poll(() => h.mailer.sent.at(-1)?.subject).toBe("Your WhatBuild sign-in link");
    const { response, cookie } = await h.followSignInLink();
    expect(response.status).toBe(303);
    expect(cookie).toBeTruthy();
    expect((await row(id)).accepted_at).toBeNull();
  });

  it("is still open to an invited address the allowlist would stop, and it may then decline", async () => {
    const closed = await startHarness({ signupAllowlist: ["@listed.example"] });
    try {
      closed.acceptsInvitations = false;
      const inviter = await closed.signIn("olga@listed.example", "Olga");
      const t = await inviter.api("POST", "/api/v1/tenants", { name: "Closed" });
      await inviter.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { email: "outsider@elsewhere.example", role: "member" });
      await fetch(`${closed.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "outsider@elsewhere.example" }) });
      await expect.poll(() => closed.mailer.sent.at(-1)?.subject).toBe("Your WhatBuild sign-in link");
      const { cookie } = await closed.followSignInLink();
      expect(cookie).toBeTruthy();
      const me = await fetch(`${closed.baseUrl}/api/v1/me/invitations`, { headers: { cookie: cookie! } });
      expect(((await me.json()) as { items: unknown[] }).items).toHaveLength(1);
    } finally {
      await closed.close();
    }
  });
});

describe("the person's list", () => {
  it("names the organization, the place, the role and who invited them, and never the token", async () => {
    const { id, token } = await invite("Listed@Example.com", "viewer", { team, product: "crewboard" });
    const listed = await h.signIn("listed@example.com");
    const [i] = await pending(listed);
    expect(i).toMatchObject({ invitation_id: id, tenant: { slug: tenant, name: "Acme Labs" }, scope_type: "product", scope: "Crewboard", role: "viewer", invited_by: '"Olive Owner"' });
    expect(JSON.stringify(i)).not.toContain(token);
  });

  it("holds an inviter's chosen name to one line in quotation marks it can't close", async () => {
    await owner.api("PATCH", "/api/v1/me", { display_name: 'Eve" invited\u202e you' });
    await invite("quoted@example.com");
    await owner.api("PATCH", "/api/v1/me", { display_name: "Olive Owner" });
    const quoted = await h.signIn("quoted@example.com");
    expect((await pending(quoted))[0]!.invited_by).toBe(`"Eve' invited you"`);
  });

  it("leaves out what is cancelled, past its time, accepted or sent to someone else", async () => {
    const seer = await h.signIn("seer@example.com");
    const cancelled = await invite("seer@example.com", "editor", { team });
    expect((await owner.api("POST", `/api/v1/tenants/${tenant}/invitations/cancel`, { invitation_id: cancelled.id })).status).toBe(200);
    expect(await pending(seer)).toEqual([]);
    const lapsed = await invite("seer@example.com", "viewer", { team });
    await h.db.updateTable("invitations").set({ expires_at: new Date(Date.now() - 1000).toISOString() }).where("invitation_id", "=", lapsed.id).execute();
    expect(await pending(seer)).toEqual([]);
    await invite("someone-else@example.com");
    expect(await pending(seer)).toEqual([]);
    const open = await invite("seer@example.com", "viewer", { team });
    expect((await seer.api("POST", "/api/v1/invitations/accept", { invitation_id: open.id })).status).toBe(200);
    expect(await pending(seer)).toEqual([]);
  });
});

describe("opening the link", () => {
  it("changes nothing, and shows the same choice", async () => {
    const { id, token } = await invite("opener@example.com");
    const opener = await h.signIn("opener@example.com");
    const before = (await log()).length;
    const opened = await opener.api("POST", "/api/v1/invitations/read", { token });
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ accepted: false, invitation_id: id, tenant: { name: "Acme Labs" }, scope_type: "team", role: "editor", invited_by: '"Olive Owner"' });
    expect((await row(id)).accepted_at).toBeNull();
    expect(await reaches(opener)).toBe(false);
    expect((await log()).length).toBe(before);
  });

  it("tells another address only that it is for someone else, masked", async () => {
    const { id, token } = await invite("Intended@Example.com");
    const other = await h.signIn("other@example.com");
    const opened = await other.api("POST", "/api/v1/invitations/read", { token });
    expect(opened.status).toBe(403);
    expect(opened.body.error.code).toBe("invitation_wrong_address");
    expect(opened.body.error.details.invited).toBe("I••••@Example.com");
    const text = JSON.stringify(opened.body);
    for (const secret of ["Intended@", "Acme Labs", "Olive Owner"]) expect(text).not.toContain(secret);
    expect((await row(id)).accepted_at).toBeNull();
  });

  it("answers a token nobody holds with 404", async () => {
    const who = await h.signIn("guesser@example.com");
    expect((await who.api("POST", "/api/v1/invitations/read", { token: "not-a-real-token" })).status).toBe(404);
  });
});

describe("accepting", () => {
  it("from the list gives the role, once, with one entry in the log", async () => {
    const { id } = await invite("JOINER@example.com", "editor");
    const joiner = await h.signIn("joiner@example.com", "Jo Joiner");
    const me = (await joiner.api("GET", "/api/v1/me")).body;
    const r = await joiner.api("POST", "/api/v1/invitations/accept", { invitation_id: id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: true, already: false, scope_type: "team", role: "editor", tenant: { slug: tenant } });
    expect(await reaches(joiner)).toBe(true);
    expect((await row(id)).accepted_by).toBe(me.account_id);
    expect((await log()).filter((e) => e.action === "joined" && e.entity_id === me.account_id)).toEqual([expect.objectContaining({ entity_title: "Jo Joiner", summary: "Accepted an invitation as editor" })]);
  });

  it("from the link does too, whatever the letter case, and says already once done from either", async () => {
    const { token } = await invite("Cased@Example.COM", "viewer");
    const cased = await h.signIn("cased@example.com");
    const r = await cased.api("POST", "/api/v1/invitations/accept", { token });
    expect(r.body).toMatchObject({ accepted: true, already: false, role: "viewer" });
    const again = await cased.api("POST", "/api/v1/invitations/accept", { token });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ accepted: true, already: true, role: "viewer" });
    expect((await cased.api("POST", "/api/v1/invitations/read", { token })).body).toMatchObject({ accepted: true, role: "viewer" });
  });

  it("is refused to any other account, by the link or its id, and leaves it open", async () => {
    const { id, token } = await invite("rightful@example.com");
    const other = await h.signIn("wrongful@example.com");
    const byLink = await other.api("POST", "/api/v1/invitations/accept", { token });
    expect(byLink.status).toBe(403);
    expect(byLink.body.error.code).toBe("invitation_wrong_address");
    // An id names only the person's own: someone else's is as if it did not exist.
    expect((await other.api("POST", "/api/v1/invitations/accept", { invitation_id: id })).status).toBe(404);
    expect((await row(id)).accepted_at).toBeNull();
    expect(await reaches(other)).toBe(false);
  });

  it("is refused once cancelled or past its time", async () => {
    const taker = await h.signIn("late@example.com");
    const cancelled = await invite("late@example.com");
    await owner.api("POST", `/api/v1/tenants/${tenant}/invitations/cancel`, { invitation_id: cancelled.id });
    for (const named of [{ token: cancelled.token }, { invitation_id: cancelled.id }]) {
      const r = await taker.api("POST", "/api/v1/invitations/accept", named);
      expect(r.status).toBe(410);
      expect(r.body.error.code).toBe("invitation_expired");
    }
    const lapsed = await invite("late@example.com");
    await h.db.updateTable("invitations").set({ expires_at: new Date(Date.now() - 1000).toISOString() }).where("invitation_id", "=", lapsed.id).execute();
    expect((await taker.api("POST", "/api/v1/invitations/accept", { token: lapsed.token })).body.error.code).toBe("invitation_expired");
    expect((await taker.api("POST", "/api/v1/invitations/read", { token: lapsed.token })).body.error.code).toBe("invitation_expired");
    expect(await reaches(taker)).toBe(false);
  });

  it("says used when it was another account's, or the access has gone, so an old link never brings a role back", async () => {
    const { token } = await invite("used@example.com", "editor");
    const used = await h.signIn("used@example.com", "Una Used");
    const me = (await used.api("GET", "/api/v1/me")).body;
    await used.api("POST", "/api/v1/invitations/accept", { token });
    const other = await h.signIn("not-used@example.com");
    expect((await other.api("POST", "/api/v1/invitations/accept", { token })).body.error.code).toBe("invitation_used");
    expect((await owner.api("POST", `/api/v1/tenants/${tenant}/members/revoke`, { account_id: me.account_id, whole_tenant: true })).status).toBe(200);
    const gone = await used.api("POST", "/api/v1/invitations/accept", { token });
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe("invitation_used");
    expect(gone.body.error.message).toContain("Acme Labs");
    expect(await reaches(used)).toBe(false);
  });

  it("happens once when pressed together", async () => {
    const { id, token } = await invite("twice@example.com");
    const twice = await h.signIn("twice@example.com", "Tess Twice");
    const me = (await twice.api("GET", "/api/v1/me")).body;
    const answers = await Promise.all([twice.api("POST", "/api/v1/invitations/accept", { token }), twice.api("POST", "/api/v1/invitations/accept", { invitation_id: id })]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(answers.map((a) => a.body.already).sort()).toEqual([false, true]);
    expect((await log()).filter((e) => e.action === "joined" && e.entity_id === me.account_id)).toHaveLength(1);
  });

  it("and a cancellation sent together: only one of them happens", async () => {
    for (const n of [1, 2, 3, 4]) {
      const email = `raced-${n}@example.com`;
      const { id, token } = await invite(email);
      const raced = await h.signIn(email);
      const [accepted, cancelled] = await Promise.all([raced.api("POST", "/api/v1/invitations/accept", { token }), owner.api("POST", `/api/v1/tenants/${tenant}/invitations/cancel`, { invitation_id: id })]);
      const joined = accepted.status === 200;
      expect(cancelled.status, JSON.stringify([accepted.body, cancelled.body])).toBe(joined ? 404 : 200);
      if (!joined) expect(accepted.body.error.code).toBe("invitation_expired");
      expect(await reaches(raced)).toBe(joined);
    }
  });

  it("can't be undone by cancelling it afterwards", async () => {
    const { id, token } = await invite("settled@example.com");
    const settled = await h.signIn("settled@example.com");
    await settled.api("POST", "/api/v1/invitations/accept", { token });
    expect((await owner.api("POST", `/api/v1/tenants/${tenant}/invitations/cancel`, { invitation_id: id })).status).toBe(404);
    expect(await reaches(settled)).toBe(true);
    expect((await settled.api("POST", "/api/v1/invitations/accept", { token })).body).toMatchObject({ already: true });
  });

  it("leaves a role they already hold there as it is, and answers with it", async () => {
    const { id } = await invite("holder@example.com", "editor");
    const holder = await h.signIn("holder@example.com");
    const me = (await holder.api("GET", "/api/v1/me")).body;
    const place = await row(id);
    await h.db
      .insertInto("memberships")
      .values({ membership_id: `${id}m`, tenant_id: place.tenant_id, scope_type: place.scope_type, scope_id: place.scope_id, account_id: me.account_id, role: "viewer", created_by: sql`${JSON.stringify(place.created_by)}::jsonb` as never })
      .execute();
    const r = await holder.api("POST", "/api/v1/invitations/accept", { invitation_id: id });
    expect(r.body).toMatchObject({ already: false, role: "viewer" });
    const held = await h.db.selectFrom("memberships").select("role").where("scope_id", "=", place.scope_id).where("account_id", "=", me.account_id).execute();
    expect(held).toEqual([{ role: "viewer" }]);
  });
});

describe("declining", () => {
  it("ends it, gives no role, and is logged under nobody's name", async () => {
    const { id, token } = await invite("decliner@example.com", "editor", { team, product: "crewboard" });
    const decliner = await h.signIn("decliner@example.com", "Dee Decliner");
    const r = await decliner.api("POST", "/api/v1/invitations/decline", { invitation_id: id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ declined: true, tenant: { name: "Acme Labs" }, scope: "Crewboard", role: "editor" });
    expect(await pending(decliner)).toEqual([]);
    expect(await reaches(decliner)).toBe(false);
    const stored = await row(id);
    expect(stored.accepted_at).toBeNull();
    expect(stored.accepted_by).toBeNull();
    expect(await h.db.selectFrom("memberships as m").innerJoin("accounts as a", "a.account_id", "m.account_id").select("m.membership_id").where("a.email", "=", "decliner@example.com").execute()).toEqual([]);

    const entries = (await log()).filter((e) => e.action === "invitation_declined" && e.entity_id === id);
    expect(entries).toEqual([expect.objectContaining({ entity_title: "Crewboard", summary: "Declined an invitation as editor", actor: expect.objectContaining({ display_name: "Someone" }) })]);
    const access = JSON.stringify(entries);
    for (const secret of ["Dee Decliner", "decliner@"]) expect(access).not.toContain(secret);
    const me = (await decliner.api("GET", "/api/v1/me")).body;
    expect(access).not.toContain(me.account_id);
    // The inviter's list no longer shows it, and a product's own log never does.
    const listed = (await owner.api("GET", `/api/v1/tenants/${tenant}/members`)).body;
    expect(listed.invitations.map((i: { email: string }) => i.email)).not.toContain("decliner@example.com");
    const productLog = (await owner.api("GET", `/api/v1/p/${path}/activity?limit=200`)).body.items as { action: string }[];
    expect(productLog.some((e) => e.action === "invitation_declined")).toBe(false);

    // Its link is done; the words say so without saying who.
    for (const send of ["read", "accept", "decline"]) {
      const done = await decliner.api("POST", `/api/v1/invitations/${send}`, { token });
      expect(done.status).toBe(410);
      expect(done.body.error.code).toBe("invitation_expired");
    }
  });

  it("frees its place among the people a plan allows", async () => {
    const planned = await startHarness({ newOrganizationPlan: "free" });
    try {
      planned.acceptsInvitations = false;
      await withPlanLimits("free", { members_max: 2 }, async () => {
        const founder = await planned.signIn("founder@example.com");
        const t = await founder.api("POST", "/api/v1/tenants", { name: "Tiny" });
        const add = (email: string) => founder.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { email, role: "member" });
        const first = await add("first-pick@example.com");
        expect(first.status).toBe(201);
        const full = await add("second-pick@example.com");
        expect(full.status).toBe(409);
        expect(full.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "members_max" } });
        const pick = await planned.signIn("first-pick@example.com");
        expect((await pick.api("POST", "/api/v1/invitations/decline", { invitation_id: first.body.invitation_id })).status).toBe(200);
        expect((await add("second-pick@example.com")).status).toBe(201);
      });
    } finally {
      await planned.close();
    }
  });

  it("is refused to any other account, and to whoever has already accepted", async () => {
    const { id, token } = await invite("kept@example.com");
    const other = await h.signIn("not-kept@example.com");
    const byLink = await other.api("POST", "/api/v1/invitations/decline", { token });
    expect(byLink.status).toBe(403);
    expect(byLink.body.error.code).toBe("invitation_wrong_address");
    expect((await other.api("POST", "/api/v1/invitations/decline", { invitation_id: id })).status).toBe(404);
    expect(Date.parse((await row(id)).expires_at)).toBeGreaterThan(Date.now());
    const kept = await h.signIn("kept@example.com");
    await kept.api("POST", "/api/v1/invitations/accept", { token });
    const late = await kept.api("POST", "/api/v1/invitations/decline", { token });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe("invitation_used");
    expect(await reaches(kept)).toBe(true);
  });

  it("settles with an acceptance sent at the same time: one wins, and the other says so", async () => {
    const { token } = await invite("torn@example.com");
    const torn = await h.signIn("torn@example.com");
    const [accept, decline] = await Promise.all([torn.api("POST", "/api/v1/invitations/accept", { token }), torn.api("POST", "/api/v1/invitations/decline", { token })]);
    const acceptWon = accept.status === 200;
    expect(acceptWon ? decline.status : accept.status).toBe(410);
    expect(acceptWon ? decline.body.error.code : accept.body.error.code).toBe(acceptWon ? "invitation_used" : "invitation_expired");
    expect(await reaches(torn)).toBe(acceptWon);
  });
});

describe("an address's invitation to one place", () => {
  it("is one at a time: a new one replaces it, and the old link says it is over", async () => {
    const old = await invite("again@example.com", "admin");
    const fresh = await invite("again@example.com", "viewer");
    const again = await h.signIn("again@example.com");
    expect((await pending(again)).map((i) => i.invitation_id)).toEqual([fresh.id]);
    expect((await again.api("POST", "/api/v1/invitations/accept", { token: old.token })).body.error.code).toBe("invitation_expired");
    expect((await again.api("POST", "/api/v1/invitations/accept", { token: fresh.token })).body).toMatchObject({ already: false, role: "viewer" });
  });

  it("ends when the role is given at once", async () => {
    const onProduct = await invite("seen-later@example.com", "reader", { team, product: "crewboard" });
    const onTeam = await invite("seen-later@example.com", "viewer", { team });
    const seen = await h.signIn("seen-later@example.com");
    expect((await seen.api("POST", "/api/v1/invitations/accept", { invitation_id: onTeam.id })).status).toBe(200);
    expect((await pending(seen)).map((i) => i.invitation_id)).toEqual([onProduct.id]);
    // Now in the organization, the owner sees them, so a role on the product is given at once and the invitation there is moot.
    expect((await owner.api("POST", `/api/v1/tenants/${tenant}/members`, { team, product: "crewboard", email: "seen-later@example.com", role: "editor" })).body).toMatchObject({ invited: false, role: "editor" });
    expect(await pending(seen)).toEqual([]);
    expect((await seen.api("POST", "/api/v1/invitations/accept", { token: onProduct.token })).body.error.code).toBe("invitation_expired");
  });

  it("is settled by one answer, even with an older one still open, as a deployment may hold from an earlier release", async () => {
    const newer = await invite("doubled@example.com", "editor");
    const doubled = await h.signIn("doubled@example.com");
    const older = await h.db.selectFrom("invitations").selectAll().where("invitation_id", "=", newer.id).executeTakeFirstOrThrow();
    await h.db
      .insertInto("invitations")
      .values({ invitation_id: `${newer.id}x`, tenant_id: older.tenant_id, scope_type: older.scope_type, scope_id: older.scope_id, email: older.email, role: "admin", token_hash: "older", expires_at: older.expires_at, created_by: sql`${JSON.stringify(older.created_by)}::jsonb` as never })
      .execute();
    expect(await pending(doubled)).toHaveLength(2);
    expect((await doubled.api("POST", "/api/v1/invitations/decline", { invitation_id: newer.id })).status).toBe(200);
    expect(await pending(doubled)).toEqual([]);
  });
});

describe("who may answer", () => {
  it("is a browser's session alone: an agent's token reaches none of these, and no tool offers them", async () => {
    const { id } = await invite("agent-owner@example.com");
    const person = await h.signIn("agent-owner@example.com");
    const token = await h.connectAgent(person);
    for (const [method, route, body] of [
      ["GET", "/api/v1/me/invitations", undefined],
      ["POST", "/api/v1/invitations/read", { invitation_id: id }],
      ["POST", "/api/v1/invitations/accept", { invitation_id: id }],
      ["POST", "/api/v1/invitations/decline", { invitation_id: id }],
    ] as const) {
      const r = await fetch(`${h.baseUrl}${route}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      expect(r.status, route).toBe(401);
    }
    const tools = await fetch(`${h.baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(await tools.text()).not.toMatch(/accept_invitation|decline_invitation|invitations\/accept/);
    expect((await row(id)).accepted_at).toBeNull();
  });

  it("is never another site", async () => {
    const { id } = await invite("cross-site@example.com");
    const person = await h.signIn("cross-site@example.com");
    for (const send of ["accept", "decline"]) {
      const r = await person.api("POST", `/api/v1/invitations/${send}`, { invitation_id: id }, { origin: "https://evil.example" });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("forbidden_origin");
    }
    expect((await pending(person)).map((i) => i.invitation_id)).toEqual([id]);
  });

  it("must name the invitation one way or the other", async () => {
    const person = await h.signIn("unnamed@example.com");
    for (const body of [{}, { token: "short" }, { token: "long-enough-token", invitation_id: "x" }]) {
      const r = await person.api("POST", "/api/v1/invitations/accept", body);
      expect(r.status).toBe(422);
    }
  });

  it("is told by the email that joining takes accepting", async () => {
    await invite("mailed@example.com", "editor");
    const mail = h.mailer.sent.at(-1)!;
    expect(mail.text).toMatch(/You join only if you accept/);
    expect(mail.text).toMatch(/Accept or decline/);
    expect(mail.text).not.toMatch(/joins? (on|by|when) sign/i);
  });
});
