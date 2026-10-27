import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// The instance's owners see every account and may remove any but an instance owner's. Removing one
// signs it out everywhere, takes its roles (each organization's access log records it), cancels its
// invitations and allowance, forgets its address and mails it a record; its name stays on what it
// wrote. A person deleting their own account does the same (delete-own-account.test.ts).

let h: Harness;
let root: Browser; // an instance owner
let olive: Browser; // owns Olive Co alone
let pete: Browser; // an editor in Olive Co, with an allowance, and an agent
let peteId: string;
let oliveId: string;
let org: string;
let P: string;
let source: string;

const remove = (who: Browser, account_id: string, email: string, confirm = "delete permanently", delete_organizations?: string[]) =>
  who.api("POST", "/api/v1/accounts/remove", { account_id, email, confirm, ...(delete_organizations ? { delete_organizations } : {}) });

beforeAll(async () => {
  h = await startHarness({ signupAllowlist: ["root@example.com"], instanceOwners: ["root@example.com"], defaultTenantAllowance: 0 });
  root = await h.signIn("root@example.com", "Root Owner");
  for (const email of ["olive@example.com", "pete@example.com"]) expect((await root.api("PUT", "/api/v1/tenant-allowances", { email, allowed: 1, notify: false })).status).toBeLessThan(300);
  olive = await h.signIn("olive@example.com", "Olive Owner");
  const t = await olive.api("POST", "/api/v1/tenants", { name: "Olive Co" });
  org = t.body.tenant.slug;
  P = `/api/v1/p/${(await olive.api("POST", `/api/v1/teams/${org}/${t.body.team.slug}/products`, { name: "Grove" })).body.path}`;
  expect((await olive.api("POST", `/api/v1/tenants/${org}/members`, { email: "pete@example.com", role: "editor", team: t.body.team.slug })).status).toBe(201);
  pete = await h.signIn("pete@example.com", "Pete Editor");
  source = (await pete.api("POST", `${P}/sources`, { title: "Pete's notes", tags: ["notes"] })).body.record_id;
  // Someone not yet signed up is invited to Olive Co at an address that is never Pete's, and Pete is invited elsewhere too.
  const ids = await h.db.selectFrom("accounts").select(["account_id", "email"]).execute();
  peteId = ids.find((a) => a.email === "pete@example.com")!.account_id;
  oliveId = ids.find((a) => a.email === "olive@example.com")!.account_id;
}, 120_000);
afterAll(async () => h?.close());

describe("listing accounts", () => {
  it("is for the instance's owners alone", async () => {
    expect((await olive.api("GET", "/api/v1/accounts")).status).toBe(403);
    const r = await root.api("GET", "/api/v1/accounts");
    expect(r.status).toBe(200);
    const byEmail = (e: string) => r.body.items.find((a: { email: string }) => a.email === e);
    expect(byEmail("root@example.com")).toMatchObject({ instance_owner: true, you: true });
    expect(byEmail("olive@example.com")).toMatchObject({ instance_owner: false, organizations: [{ slug: org, role: "owner", roles: 0, only_owner: true }], allowance: { allowed: 1, created: 1 } });
    expect(byEmail("pete@example.com").organizations[0].only_owner).toBeUndefined();
    expect(byEmail("pete@example.com")).toMatchObject({ organizations: [{ slug: org, role: null, roles: 1 }], allowance: { allowed: 1, created: 0 } });
    expect(byEmail("pete@example.com").sessions).toBeGreaterThan(0);
    expect(byEmail("pete@example.com").last_seen_at).toBeTruthy();
  });

  it("finds people by name or address", async () => {
    const r = await root.api("GET", "/api/v1/accounts?query=PETE");
    expect(r.body.items.map((a: { email: string }) => a.email)).toEqual(["pete@example.com"]);
  });
});

describe("removing an account", () => {
  it("is refused to anyone but an instance owner, and to an agent", async () => {
    expect((await olive.api("POST", "/api/v1/accounts/remove", { account_id: peteId, email: "pete@example.com", confirm: "delete permanently" })).status).toBe(403);
    const client = new Client({ name: "accounts-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(root, "Root's agent")}` } } }));
    const r = (await client.callTool({ name: "products_write", arguments: { action: "remove_account", params: { account_id: peteId, email: "pete@example.com", confirm: "delete permanently" } } })) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    // A person's act in the web app: an agent is not even offered it, and is told where it is.
    expect(r.content[0]!.text).toMatch(/^403: No agent is offered products_write\(action="remove_account"\): a person does it in the web app, on People \(`\/people`\), Remove on the account\./);
    expect(JSON.parse(r.content[0]!.text.slice(r.content[0]!.text.indexOf("\n") + 1)).error.code).toBe("web_only");
    // Nor the list of accounts, which is on People too.
    const listed = (await client.callTool({ name: "products_read", arguments: { action: "accounts" } })) as { isError?: boolean; content: { text: string }[] };
    expect(listed.isError).toBe(true);
    expect(listed.content[0]!.text).toMatch(/^403: No agent is offered products_read\(action="accounts"\): a person does it in the web app, on People/);
    await client.close();
  });

  it("needs the confirmation and the address typed exactly", async () => {
    expect((await remove(root, peteId, "pete@example.com", "yes")).body.error.code).toBe("confirmation_required");
    expect((await remove(root, peteId, "pete@example.org")).body.error.code).toBe("typed_email");
  });

  it("refuses an instance owner's account, and the only owner of an organization unless it is named to go too", async () => {
    const rootId = (await h.db.selectFrom("accounts").select("account_id").where("email", "=", "root@example.com").executeTakeFirstOrThrow()).account_id;
    const own = await remove(root, rootId, "root@example.com");
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe("instance_owner");
    const alone = await remove(root, oliveId, "olive@example.com");
    expect(alone.status).toBe(409);
    expect(alone.body.error.code).toBe("last_owner");
    expect(alone.body.error.details.organizations).toEqual([{ slug: org, name: "Olive Co" }]);
    expect(alone.body.error.message).toMatch(/^Olive Owner is the only owner of Olive Co\. Removing the account deletes it too/);
    // Naming another organization, or none, is no agreement.
    expect((await remove(root, oliveId, "olive@example.com", "delete permanently", ["somewhere-else"])).body.error.code).toBe("last_owner");
    expect((await olive.api("GET", `/api/v1/tenants/${org}/limits`)).status).toBe(200);
  });

  it("signs the account out, takes its roles with a record, cancels what let it in, and forgets its address", async () => {
    const token = await h.connectAgent(pete, "Pete's agent");
    // An invitation still waiting at Pete's address, sent before his account existed.
    const tenantId = (await h.db.selectFrom("tenants").select("tenant_id").where("slug", "=", org).executeTakeFirstOrThrow()).tenant_id;
    await h.db
      .insertInto("invitations")
      .values({ invitation_id: "01M5TINV1TAT10N000000000PE", tenant_id: tenantId, scope_type: "tenant", scope_id: tenantId, email: "Pete@example.com", role: "member", token_hash: "pete-invitation", expires_at: new Date(Date.now() + 86400_000).toISOString(), created_by: JSON.stringify({ account_id: oliveId, display_name: "Olive Owner", surface: "web", client: null }) })
      .execute();
    const r = await remove(root, peteId, "PETE@example.com");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ removed: true, display_name: "Pete Editor", organizations_left: 1, allowance_removed: true, invitations_cancelled: 1 });
    expect(r.body.sessions_ended).toBeGreaterThan(0);
    expect(r.body.agents_disconnected).toBe(1);

    // Signed out everywhere: the browser and the agent are refused.
    expect((await pete.api("GET", "/api/v1/me/products")).status).toBe(401);
    const mcp = await fetch(`${h.baseUrl}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(mcp.status).toBe(401);

    // No role anywhere, recorded in the organization's access log.
    expect(await h.db.selectFrom("memberships").select("membership_id").where("account_id", "=", peteId).execute()).toEqual([]);
    const log = (await olive.api("GET", `/api/v1/tenants/${org}/members/activity`)).body.items;
    expect(log[0]).toMatchObject({ action: "revoked", entity_id: peteId, entity_title: "Pete Editor" });
    expect(log[0].summary).toMatch(/by an owner of this instance/);

    // Nothing left that lets the address in, and the address itself is forgotten.
    expect(await h.db.selectFrom("tenant_allowances").select("email").where("email", "=", "pete@example.com").execute()).toEqual([]);
    expect(await h.db.selectFrom("invitations").select("invitation_id").where(sql<boolean>`lower(email) = 'pete@example.com'`).where("accepted_at", "is", null).execute()).toEqual([]);
    const row = await h.db.selectFrom("accounts").select(["email", "display_name", "deleted_at"]).where("account_id", "=", peteId).executeTakeFirstOrThrow();
    expect(row.deleted_at).toBeTruthy();
    expect(row.email).not.toContain("pete@example.com");
    // The account keeps no name: what he wrote keeps its own copy.
    expect(row.display_name).toBe("");
    expect((await root.api("GET", "/api/v1/accounts")).body.items.map((a: { email: string }) => a.email)).not.toContain("pete@example.com");

    // What he wrote keeps his name.
    const src = (await olive.api("GET", `${P}/sources/${source}`)).body;
    expect(JSON.stringify(src)).toContain("Pete Editor");

    // The address is mailed a record, saying who removed it.
    const record = h.mailer.sent.at(-1)!;
    expect(record).toMatchObject({ to: "pete@example.com", subject: "Your WhatBuild account has been deleted" });
    expect(record.text).toMatch(/by an owner of this WhatBuild/);

    // Signing up again is refused while sign-up is limited and nothing lets the address in.
    const again = await fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email: "pete@example.com" }) });
    expect(again.status).toBe(403);
  });

  it("answers 404 for an account already removed", async () => {
    expect((await remove(root, peteId, "pete@example.com")).status).toBe(404);
  });
});

describe("removing the only owner of an organization", () => {
  it("deletes the organizations they alone own, with everything in them, once each is named", async () => {
    const tenantId = (await h.db.selectFrom("tenants").select("tenant_id").where("slug", "=", org).executeTakeFirstOrThrow()).tenant_id;
    const r = await remove(root, oliveId, "olive@example.com", "delete permanently", [org.toUpperCase()]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ removed: true, display_name: "Olive Owner", organizations_deleted: [{ slug: org, name: "Olive Co" }], organizations_left: 0 });
    expect(await h.db.selectFrom("tenants").select("tenant_id").where("tenant_id", "=", tenantId).execute()).toEqual([]);
    expect(await h.db.selectFrom("memberships").select("membership_id").where("tenant_id", "=", tenantId).execute()).toEqual([]);
    await sql`select set_config('app.tenant_id', ${tenantId}, false)`.execute(h.db);
    expect(await h.db.selectFrom("products").select("product_id").where("tenant_id", "=", tenantId).execute()).toEqual([]);
    await sql`select set_config('app.tenant_id', '', false)`.execute(h.db);
    expect((await olive.api("GET", "/api/v1/me/products")).status).toBe(401);
    // The record names what went with the account, and says what stays only of the others.
    const record = h.mailer.sent.at(-1)!;
    expect(record.to).toBe("olive@example.com");
    expect(record.text).toContain("- Olive Co was deleted too, with everything in it: you were its only owner.");
    expect(record.text).toContain("Anything you added to any other organization stays there");
  });

  it("refuses a list of organizations for someone who is the only owner of none", async () => {
    await root.api("PUT", "/api/v1/tenant-allowances", { email: "rae@example.com", allowed: 1, notify: false });
    await h.signIn("rae@example.com", "Rae Reader");
    const raeId = (await h.db.selectFrom("accounts").select("account_id").where("email", "=", "rae@example.com").executeTakeFirstOrThrow()).account_id;
    expect((await remove(root, raeId, "rae@example.com", "delete permanently", ["anything"])).body.error.code).toBe("invalid_input");
  });
});

describe("an instance owner deleting an organization", () => {
  it("may delete any organization, member or not, with its name typed", async () => {
    await root.api("PUT", "/api/v1/tenant-allowances", { email: "quinn@example.com", allowed: 1, notify: false });
    const quinn = await h.signIn("quinn@example.com", "Quinn Owner");
    const t = await quinn.api("POST", "/api/v1/tenants", { name: "Quinn Co" });
    const slug = t.body.tenant.slug as string;
    await quinn.api("POST", `/api/v1/teams/${slug}/${t.body.team.slug}/products`, { name: "Quay" });
    // Someone else in no role there is refused, as before.
    const rae = await h.signIn("rae@example.com");
    expect((await rae.api("GET", `/api/v1/tenants/${slug}/delete-impact`)).status).toBe(404);
    const impact = await root.api("GET", `/api/v1/tenants/${slug}/delete-impact`);
    expect(impact.status, JSON.stringify(impact.body)).toBe(200);
    expect(impact.body.contents).toMatchObject({ products: [expect.objectContaining({ name: "Quay" })], people: 1 });
    expect((await root.api("DELETE", `/api/v1/tenants/${slug}`, { name: "Quinn", reason: "A test organization", confirm: "delete permanently" })).body.error.code).toBe("name_mismatch");
    const del = await root.api("DELETE", `/api/v1/tenants/${slug}`, { name: "Quinn Co", reason: "A test organization", confirm: "delete permanently" });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, name: "Quinn Co", owners_notified: 1 });
    // Its owner hears of it, since it was deleted from outside: when, by whom, and whom to ask.
    const mail = h.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "quinn@example.com", subject: "Quinn Co was deleted from WhatBuild" });
    expect(mail.text).toMatch(/^Quinn Co, an organization you owned on [^ ]+, was deleted on \d{1,2} [A-Z][a-z]{2} \d{4} \(UTC\) by an owner of this WhatBuild, with everything in it/);
    expect(mail.text).toContain("Your account stays");
    expect((await quinn.api("GET", "/api/v1/me/products")).body.tenants).toEqual([]);
    // Its place is free again: Quinn may start another.
    expect((await quinn.api("GET", "/api/v1/me")).body.tenant_allowance).toMatchObject({ created: 0, remaining: 1 });
  });
});
