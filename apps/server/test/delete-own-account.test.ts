import { createHmac } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { personOf, usageSettled } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A person deletes their own account in the web app, never through an agent, from a browser that
// signed in within the last 15 minutes. It does what an instance owner's removal does: signs them
// out everywhere, takes their roles with a record in each organization, cancels what let their
// address in, deletes what is kept about them, forgets the address and mails it a record. What they
// wrote stays, under their name. The only owner of an organization, and an owner of the instance,
// are refused until that changes.

let h: Harness;
let root: Browser; // an instance owner
let owen: Browser; // the only owner of Owen Co, and an owner of Shared Co
let dana: Browser; // an owner of Shared Co with Owen, an editor in Owen Co, with an agent and an allowance
let danaId: string;
let owenOrg: string;
let sharedOrg: string;
let P: string;
let source: string;

const del = (who: Browser, email: string, confirm = "delete permanently") => who.api("POST", "/api/v1/me/delete", { email, confirm });
const impact = (who: Browser) => who.api("GET", "/api/v1/me/delete-impact");
const usageKey = () => createHmac("sha256", h.config.grantKey).update("whatbuild usage people").digest("base64url");
const idOf = async (email: string) => (await h.db.selectFrom("accounts").select("account_id").where("email", "=", email).where("deleted_at", "is", null).executeTakeFirstOrThrow()).account_id;
/** A browser holding another session cookie, as after signing in again. */
const browserWith = (email: string, cookie: string): Browser => ({
  email,
  cookie,
  async api(method, path, body) {
    const res = await fetch(`${h.baseUrl}${path}`, { method, headers: { cookie, origin: h.baseUrl, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: (await res.json()) as never, headers: res.headers };
  },
});
/** Make every session of an account older than a recent sign-in. */
const ageSessions = (accountId: string) => h.db.updateTable("sessions").set({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() }).where("account_id", "=", accountId).execute();

beforeAll(async () => {
  h = await startHarness({ signupAllowlist: ["root@example.com"], instanceOwners: ["root@example.com"], defaultTenantAllowance: 0, privacyContact: "privacy@example.com" });
  root = await h.signIn("root@example.com", "Root Owner");
  for (const email of ["owen@example.com", "dana@example.com"]) expect((await root.api("PUT", "/api/v1/tenant-allowances", { email, allowed: 2, notify: false })).status).toBeLessThan(300);
  owen = await h.signIn("owen@example.com", "Owen Owner");
  const t = await owen.api("POST", "/api/v1/tenants", { name: "Owen Co" });
  owenOrg = t.body.tenant.slug;
  P = `/api/v1/p/${(await owen.api("POST", `/api/v1/teams/${owenOrg}/${t.body.team.slug}/products`, { name: "Orchard" })).body.path}`;
  expect((await owen.api("POST", `/api/v1/tenants/${owenOrg}/members`, { email: "dana@example.com", role: "editor", team: t.body.team.slug })).status).toBe(201);
  dana = await h.signIn("dana@example.com", "Dana Editor");
  danaId = await idOf("dana@example.com");
  const shared = await dana.api("POST", "/api/v1/tenants", { name: "Shared Co" });
  sharedOrg = shared.body.tenant.slug;
  expect((await dana.api("POST", `/api/v1/tenants/${sharedOrg}/members`, { email: "owen@example.com", role: "owner" })).status).toBe(201);
  source = (await dana.api("POST", `${P}/sources`, { title: "Dana's interview notes", tags: ["notes"] })).body.record_id;
}, 120_000);
afterAll(async () => h?.close());

describe("what deleting your account would do", () => {
  it("names your organizations, what ends, and that this browser signed in recently", async () => {
    const r = await impact(dana);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ email: "dana@example.com", display_name: "Dana Editor", instance_owner: false, only_owner_of: [], allowance: true, recent_sign_in_minutes: 15, record_mailed: true });
    expect(r.body.organizations).toEqual([
      { slug: owenOrg, name: "Owen Co", role: null, roles: 1, only_owner: false },
      { slug: sharedOrg, name: "Shared Co", role: "owner", roles: 0, only_owner: false },
    ]);
    expect(r.body.sessions).toBeGreaterThan(0);
    expect(Date.parse(r.body.recent_until)).toBeGreaterThan(Date.now());
  });

  it("names each organization you are the only owner of, and says when you own the instance", async () => {
    expect((await impact(owen)).body.only_owner_of).toEqual([{ slug: owenOrg, name: "Owen Co" }]);
    expect((await impact(root)).body.instance_owner).toBe(true);
  });

  it("asks to sign in again once the sign-in is no longer recent", async () => {
    const before = (await impact(owen)).body.recent_until;
    expect(before).toBeTruthy();
    await ageSessions(await idOf("owen@example.com"));
    expect((await impact(owen)).body.recent_until).toBeNull();
  });
});

describe("refusals", () => {
  it("is offered to no agent, and refused to one", async () => {
    const client = new Client({ name: "delete-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(owen, "Owen's agent")}` } } }));
    for (const action of ["delete_account", "delete_account_impact"]) {
      for (const name of ["products_read", "products_write", "products_delete"]) {
        const r = (await client.callTool({ name, arguments: { action, params: { email: "owen@example.com", confirm: "delete permanently" } } })) as { isError?: boolean; content: { text: string }[] };
        expect(r.isError).toBe(true);
        // Whichever of its noun's tools is called, the agent is told where the person does it.
        expect(r.content[0]!.text).toMatch(new RegExp(`^403: No agent is offered products_${action === "delete_account" ? "write" : "read"}\\(action="${action}"\\): a person does it in the web app, in their own Settings \\(\`/settings\`\\), Delete account\\.`));
      }
    }
    await client.close();
    expect(await h.db.selectFrom("accounts").select("deleted_at").where("email", "=", "owen@example.com").executeTakeFirstOrThrow()).toEqual({ deleted_at: null });
  });

  it("needs the confirmation and your address typed exactly", async () => {
    expect((await del(dana, "dana@example.com", "yes")).body.error.code).toBe("confirmation_required");
    const wrong = await del(dana, "dana@example.org");
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe("typed_email");
  });

  it("refuses an owner of the instance", async () => {
    const r = await del(root, "root@example.com");
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("instance_owner");
  });

  it("refuses the only owner of an organization, naming it", async () => {
    owen = await h.signIn("owen@example.com", "Owen Owner");
    const r = await del(owen, "owen@example.com");
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("last_owner");
    expect(r.body.error.details.organizations).toEqual([{ slug: owenOrg, name: "Owen Co" }]);
    expect(r.body.error.message).toMatch(/You’re the only owner of Owen Co/);
  });

  it("refuses a browser that signed in too long ago, until it signs in again", async () => {
    const id = await idOf("dana@example.com");
    await ageSessions(id);
    const r = await del(dana, "dana@example.com");
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("sign_in_again");
    expect(r.body.error.details.minutes).toBe(15);
    // Signing in again with a link mailed to the address makes the sign-in recent.
    const sent = await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email: "dana@example.com", next: "/settings?delete=account" }) });
    expect(sent.status).toBe(200);
    const { response, cookie } = await h.followSignInLink();
    expect(response.headers.get("location")).toBe("/settings?delete=account");
    dana = browserWith("dana@example.com", cookie!);
    expect((await impact(dana)).body.recent_until).toBeTruthy();
  });
});

describe("deleting your own account", () => {
  it("ends everything kept about you, and keeps what you wrote under your name", async () => {
    const token = await h.connectAgent(dana, "Dana's agent");
    const owenId = await idOf("owen@example.com");
    const owenTenant = (await h.db.selectFrom("tenants").select("tenant_id").where("slug", "=", owenOrg).executeTakeFirstOrThrow()).tenant_id;
    // What is kept about Dana besides her account: counts against limits and feedback, a reply address, a request to hear from us, and days of use.
    const starts = new Date().toISOString();
    for (const account_id of [danaId, owenId]) await h.db.insertInto("limit_counters").values({ tenant_id: owenTenant, account_id, bucket: "day", starts_at: starts, counter: "kept-by-the-test", n: 3 }).execute();
    const feedback = (await dana.api("POST", "/api/v1/feedback", { category: "improvement", message: "Let me sort by date.", reply: true })).body.feedback_id;
    await h.db.insertInto("interest").values({ interest_id: "01M5TINTEREST0000000000DNA", email: "Dana@example.com", name: "Dana", organization: null, note: null, created_at: starts, updated_at: starts }).execute();
    // An invitation still waiting at her address.
    await h.db
      .insertInto("invitations")
      .values({ invitation_id: "01M5TINV1TAT10N000000000DA", tenant_id: owenTenant, scope_type: "tenant", scope_id: owenTenant, email: "dana@example.com", role: "member", token_hash: "dana-invitation", expires_at: new Date(Date.now() + 86400_000).toISOString(), created_by: JSON.stringify({ account_id: owenId, display_name: "Owen Owner", surface: "web", client: null }) })
      .execute();
    await usageSettled();
    const danaPerson = personOf(usageKey(), danaId);
    const owenPerson = personOf(usageKey(), owenId);
    expect((await h.db.selectFrom("usage_people").select("person").where("person", "=", danaPerson).execute()).length).toBeGreaterThan(0);
    expect((await h.db.selectFrom("oauth_codes").select("code_hash").where("account_id", "=", danaId).execute()).length).toBeGreaterThan(0);
    const sentBefore = h.mailer.sent.length;

    const r = await del(dana, "DANA@example.com");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ deleted: true, account_id: danaId, display_name: "Dana Editor", organizations_left: 2, agents_disconnected: 1, invitations_cancelled: 1, allowance_removed: true, notice_sent: true });
    expect(r.body.sessions_ended).toBeGreaterThan(0);
    expect(r.body.days_of_use_forgotten).toBeGreaterThan(0);

    // Signed out everywhere, this browser too, and the agent with it.
    expect((await dana.api("GET", "/api/v1/me")).status).toBe(401);
    const mcp = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(mcp.status).toBe(401);

    // Nothing kept about her: sign-ins, tokens, codes, roles, what let her in, the counts, her days of use, her address anywhere.
    for (const table of ["sessions", "oauth_tokens", "oauth_codes", "memberships", "limit_counters", "feedback_counts"] as const)
      expect(await h.db.selectFrom(table).selectAll().where("account_id", "=", danaId).execute(), table).toEqual([]);
    expect(await h.db.selectFrom("tenant_allowances").select("email").where("email", "=", "dana@example.com").execute()).toEqual([]);
    expect(await h.db.selectFrom("invitations").select("invitation_id").where(sql<boolean>`lower(email) = 'dana@example.com'`).where("accepted_at", "is", null).execute()).toEqual([]);
    expect(await h.db.selectFrom("interest").select("email").where(sql<boolean>`lower(email) = 'dana@example.com'`).execute()).toEqual([]);
    // Her feedback stays, naming nobody.
    expect(await h.db.selectFrom("feedback").select(["reply_to", "message"]).where("feedback_id", "=", feedback).executeTakeFirstOrThrow()).toEqual({ reply_to: null, message: "Let me sort by date." });
    await usageSettled();
    // The delete itself counts no day for her either; the calls are still counted, naming nobody.
    expect(await h.db.selectFrom("usage_people").select("person").where("person", "=", danaPerson).execute()).toEqual([]);
    expect((await h.db.selectFrom("usage_calls").select("calls").where("operation", "=", "products.delete_account").where("outcome", "=", "ok").execute()).length).toBe(1);
    const row = await h.db.selectFrom("accounts").select(["email", "display_name", "deleted_at", "email_verified_at"]).where("account_id", "=", danaId).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ display_name: "", email_verified_at: null });
    expect(row.deleted_at).toBeTruthy();
    expect(row.email).not.toMatch(/dana/i);

    // Everyone else keeps what is theirs.
    expect((await owen.api("GET", "/api/v1/me")).status).toBe(200);
    expect(await h.db.selectFrom("limit_counters").select("n").where("account_id", "=", owenId).where("counter", "=", "kept-by-the-test").execute()).toEqual([{ n: 3 }]);
    expect((await h.db.selectFrom("usage_people").select("person").where("person", "=", owenPerson).execute()).length).toBeGreaterThan(0);

    // Each organization records that she left, and what she wrote keeps her name.
    for (const org of [owenOrg, sharedOrg]) {
      const log = (await owen.api("GET", `/api/v1/tenants/${org}/members/activity`)).body.items;
      expect(log[0]).toMatchObject({ action: "account_deleted", entity_id: danaId, entity_title: "Dana Editor" });
      expect(log[0].summary).toMatch(/by deleting their account/);
    }
    expect(JSON.stringify((await owen.api("GET", `${P}/sources/${source}`)).body)).toContain("Dana Editor");

    // A record goes to the address she had, saying what went and what stays, and where to turn if it wasn't her.
    expect(h.mailer.sent.length).toBe(sentBefore + 1);
    const record = h.mailer.sent.at(-1)!;
    expect(record).toMatchObject({ to: "dana@example.com", subject: "Your WhatBuild account has been deleted" });
    expect(record.text).toMatch(/You’ve been signed out everywhere/);
    expect(record.text).toMatch(/Anything you added to an organization stays there, with your name on it/);
    // What a deployment's backups keep is the operator's to know, not the person's to be told here.
    expect(record.text).not.toMatch(/backup/i);
    expect(record.text).toMatch(/If this wasn’t you, someone used a browser signed in to your account\. Contact whoever runs this WhatBuild \(privacy@example\.com\)/);
  });

  it("leaves the address free to start again from nothing, once let in", async () => {
    // While sign-up is limited, nothing lets the address in any more: it is sent no link, though answered as any address is.
    const mails = h.mailer.sent.length;
    const again = await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email: "dana@example.com" }) });
    expect(again.status).toBe(200);
    expect(h.mailer.sent.length).toBe(mails);
    expect((await root.api("PUT", "/api/v1/tenant-allowances", { email: "dana@example.com", allowed: 1, notify: false })).status).toBeLessThan(300);
    const back = await h.signIn("dana@example.com");
    const newId = await idOf("dana@example.com");
    expect(newId).not.toBe(danaId);
    const products = (await back.api("GET", "/api/v1/me/products")).body;
    expect(products.tenants.filter((t: { example?: boolean }) => !t.example)).toEqual([]);
  });
});
