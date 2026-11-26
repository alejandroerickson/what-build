import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

// The web app's tutorials, remembered on the account: which of them the person has been shown (the
// welcome and one for each of a product's four pages), and whether they turned tutorials off. The
// person's own state, kept by `PATCH /api/v1/me` for a session in the web app, whatever roles they
// hold, and reached by nothing an agent can call.

let h: Harness;
let ex: Organization;
let ed: Browser; // an editor in an organization of their own
let gus: Browser; // in no organization: a guest of the example

const NEW = { seen: [], off: false };

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["olive@example.com"] });
  const olive = await h.signIn("olive@example.com", "Olive Owner");
  ex = await buildOrganization(h, olive, "Example Works", "TUTORIAL1");
  await syncExampleTenant(h.db, ex.tenant.slug, () => {});
  ed = await h.signIn("eddie@example.com", "Eddie Editor");
  gus = await h.signIn("gus@guest.example", "Gus Guest");
}, 120_000);
afterAll(async () => h?.close());

describe("the tutorials on the account", () => {
  it("start as none shown and tutorials on, in the session the app reads and in /me", async () => {
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual(NEW);
    expect((await ed.api("GET", "/auth/session")).body.tutorial).toEqual(NEW);
  });

  it("add each tutorial named as seen to those seen before, once, and give them in their order", async () => {
    const welcome = await ed.api("PATCH", "/api/v1/me", { tutorial: { seen: ["welcome"] } });
    expect(welcome.status).toBe(200);
    expect(welcome.body).toMatchObject({ tutorial: { seen: ["welcome"], off: false }, display_name: "Eddie Editor", hide_example: false });
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { seen: ["story"] } })).body.tutorial).toEqual({ seen: ["welcome", "story"], off: false });
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { seen: ["evidence", "story", "evidence"] } })).body.tutorial).toEqual({ seen: ["welcome", "evidence", "story"], off: false });
    // Another field alone leaves the tutorials as they were.
    expect((await ed.api("PATCH", "/api/v1/me", { hide_example: true })).body.tutorial).toEqual({ seen: ["welcome", "evidence", "story"], off: false });
    const row = await h.db.selectFrom("accounts").select("tutorials_seen").where("email", "=", "eddie@example.com").executeTakeFirstOrThrow();
    expect([...row.tutorials_seen].sort()).toEqual(["evidence", "story", "welcome"]);
  });

  it("turns tutorials off and on again, keeping those seen", async () => {
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { off: true } })).body.tutorial).toEqual({ seen: ["welcome", "evidence", "story"], off: true });
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { seen: ["idea"], off: false } })).body.tutorial).toEqual({ seen: ["welcome", "idea", "evidence", "story"], off: false });
  });

  it("forget those seen with a reset, as development does to offer them again", async () => {
    const before = (await ed.api("GET", "/api/v1/me")).body.tutorial;
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { reset: true } })).body.tutorial).toEqual({ seen: [], off: false });
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { reset: true, seen: ["welcome"] } })).body.tutorial).toEqual({ seen: ["welcome"], off: false });
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { seen: before.seen } })).body.tutorial).toEqual(before);
  });

  it("follow the person to another browser, and survive signing out", async () => {
    await ed.api("PATCH", "/api/v1/me", { tutorial: { off: true } });
    await ed.api("POST", "/auth/sign-out");
    expect((await ed.api("GET", "/api/v1/me")).status).toBe(401);
    ed = await h.signIn("eddie@example.com");
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual({ seen: ["welcome", "idea", "evidence", "story"], off: true });
  });

  it("refuse what they do not keep: a tutorial there is none of, an empty list, the old fields, an unknown field, an empty tutorial", async () => {
    for (const tutorial of [{ seen: ["tour"] }, { seen: "idea" }, { seen: [] }, { off: "yes" }, { stop: 3 }, { offered: true }, { finished: true }, { reset: false }, { running: true }, {}]) {
      const r = await ed.api("PATCH", "/api/v1/me", { tutorial });
      expect(r.status, JSON.stringify(tutorial)).toBe(422);
      expect(r.body.error.code).toBe("invalid_input");
    }
    // No other account's state can be named.
    expect((await ed.api("PATCH", "/api/v1/me", { account_id: "someone-else", tutorial: { off: false } })).status).toBe(422);
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual({ seen: ["welcome", "idea", "evidence", "story"], off: true });
  });

  it("are a guest account's too, which holds no role in any organization", async () => {
    const me = (await gus.api("GET", "/api/v1/me")).body;
    expect(me.guest).toBe(true);
    expect(me.tutorial).toEqual(NEW);
    const r = await gus.api("PATCH", "/api/v1/me", { tutorial: { seen: ["welcome", "exploration"] } });
    expect(r.status).toBe(200);
    expect(r.body.tutorial).toEqual({ seen: ["welcome", "exploration"], off: false });
    // One person's tutorials are never another's.
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual({ seen: ["welcome", "idea", "evidence", "story"], off: true });
  });

  it("are reached by no agent: a bearer token neither reads nor changes them", async () => {
    const token = await h.connectAgent(ed);
    const bearer = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${h.baseUrl}/api/v1/me`, { headers: bearer })).status).toBe(401);
    const patched = await fetch(`${h.baseUrl}/api/v1/me`, { method: "PATCH", headers: { ...bearer, "Content-Type": "application/json", Origin: h.baseUrl }, body: JSON.stringify({ tutorial: { off: false } }) });
    expect(patched.status).toBe(401);
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual({ seen: ["welcome", "idea", "evidence", "story"], off: true });
  });

  it("go with the account when it is deleted", async () => {
    const del = await h.signIn("dora@example.com", "Dora Deleted");
    await del.api("PATCH", "/api/v1/me", { tutorial: { seen: ["welcome", "idea"], off: true } });
    const id = (await del.api("GET", "/api/v1/me")).body.account_id;
    const r = await del.api("POST", "/api/v1/me/delete", { email: "dora@example.com", confirm: "delete permanently" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await h.db.selectFrom("accounts").select(["tutorials_seen", "tutorials_off"]).where("account_id", "=", id).executeTakeFirstOrThrow();
    expect(row).toEqual({ tutorials_seen: [], tutorials_off: false });
  });

  it("keep the welcome offered on a product of the person's own apart from the welcome offered in the example, in its order", async () => {
    const wren = await h.signIn("wren@guest.example", "Wren Guest");
    // Offered in the example as a guest: the welcome alone.
    expect((await wren.api("PATCH", "/api/v1/me", { tutorial: { seen: ["welcome", "idea"] } })).body.tutorial).toEqual({ seen: ["welcome", "idea"], off: false });
    // Offered once more on a product of their own.
    const own = await wren.api("PATCH", "/api/v1/me", { tutorial: { seen: ["welcome", "welcome-own"] } });
    expect(own.status).toBe(200);
    expect(own.body.tutorial).toEqual({ seen: ["welcome", "welcome-own", "idea"], off: false });
    expect((await wren.api("GET", "/auth/session")).body.tutorial).toEqual({ seen: ["welcome", "welcome-own", "idea"], off: false });
    // Every one of them at once is still a list the account keeps.
    expect((await wren.api("PATCH", "/api/v1/me", { tutorial: { seen: ["welcome", "welcome-own", "idea", "evidence", "exploration", "story"] } })).status).toBe(200);
    for (const seen of [["own"], ["welcome_own"], ["welcome-example"]]) expect((await wren.api("PATCH", "/api/v1/me", { tutorial: { seen } })).status, seen[0]).toBe(422);
  });
});

describe("the migration that offers the welcome once more on a product of the person's own", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const url = inject("appUrlTemplate").replace("{db}", name);
  let client: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0056_welcome_on_own_product.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));
    const actor = JSON.stringify({ account_id: "OWNER", display_name: "Owner", surface: "web", client: null });
    await client.query(`insert into tenants (tenant_id, slug, name, created_by, example) values ('EX', 'example', 'Example', $1, true), ('OWN', 'own', 'Own', $1, false)`, [actor]);
    // Offered the welcome and in an organization of their own; offered it only as a guest of the
    // example; offered it as one of the example's authors only; never offered it, in an organization;
    // and offered it with tutorials turned off since.
    const people: [string, string[], boolean, string[]][] = [
      ["MEMBER", ["welcome", "idea"], false, ["OWN"]],
      ["GUEST", ["welcome", "idea", "evidence", "exploration", "story"], false, []],
      ["AUTHOR", ["welcome"], false, ["EX"]],
      ["NEVER", [], false, ["OWN"]],
      ["OFF", ["welcome"], true, ["OWN", "EX"]],
    ];
    for (const [id, seen, off, tenants] of people) {
      await client.query("insert into accounts (account_id, email, display_name, tutorials_seen, tutorials_off) values ($1, $2, $1, $3, $4)", [id, `${id.toLowerCase()}@example.com`, seen, off]);
      for (const t of tenants)
        await client.query("insert into memberships (membership_id, tenant_id, scope_type, scope_id, account_id, role, created_by) values ($1, $2, 'tenant', $2, $3, 'admin', $4)", [`${id}-${t}`, t, id, actor]);
    }
    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));
  }, 120_000);
  afterAll(async () => client?.end());

  it("counts the welcome offered on a product of their own for whoever was offered it and is in an organization other than the example", async () => {
    const rows = (await client.query<{ account_id: string; tutorials_seen: string[]; tutorials_off: boolean }>("select account_id, tutorials_seen, tutorials_off from accounts order by account_id")).rows;
    expect(Object.fromEntries(rows.map((r) => [r.account_id, r.tutorials_seen]))).toEqual({
      AUTHOR: ["welcome"],
      GUEST: ["welcome", "idea", "evidence", "exploration", "story"],
      MEMBER: ["welcome", "idea", "welcome-own"],
      NEVER: [],
      OFF: ["welcome", "welcome-own"],
    });
    expect(Object.fromEntries(rows.map((r) => [r.account_id, r.tutorials_off]))).toMatchObject({ OFF: true, MEMBER: false });
  });

  it("keeps welcome-own, and still refuses a tutorial there is none of", async () => {
    await client.query("update accounts set tutorials_seen = array['welcome', 'welcome-own'] where account_id = 'GUEST'");
    await expect(client.query("update accounts set tutorials_seen = array['tour'] where account_id = 'NEVER'")).rejects.toThrow(/accounts_tutorials_seen_check/);
  });
});

describe("the migration from the one tutorial of twenty stops", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const url = inject("appUrlTemplate").replace("{db}", name);
  let client: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0049_accounts_tutorials.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));
    // Where each person had left it: never offered; offered and declined; part-way at Idea (stop 3),
    // at Evidence (7), at Exploration (12) and at Story (17); finished; and taken again after finishing.
    const people: [string, string | null, number | null, string | null][] = [
      ["NEVER", null, null, null],
      ["DECLINED", "2026-11-15T00:00:00Z", null, null],
      ["IDEA", "2026-11-15T00:00:00Z", 3, null],
      ["EVIDENCE", "2026-11-15T00:00:00Z", 7, null],
      ["EXPLORATION", "2026-11-15T00:00:00Z", 12, null],
      ["STORY", "2026-11-15T00:00:00Z", 17, null],
      ["FINISHED", "2026-11-15T00:00:00Z", null, "2026-11-16T00:00:00Z"],
      ["AGAIN", "2026-11-15T00:00:00Z", 1, "2026-11-16T00:00:00Z"],
    ];
    for (const [id, offered, stop, finished] of people)
      await client.query("insert into accounts (account_id, email, display_name, tutorial_offered_at, tutorial_stop, tutorial_finished_at) values ($1, $2, $1, $3, $4, $5)", [id, `${id.toLowerCase()}@example.com`, offered, stop, finished]);
    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));
  }, 120_000);
  afterAll(async () => client?.end());

  it("counts the welcome seen for whoever was offered it, each page they got past, and every one for whoever finished", async () => {
    const rows = (await client.query<{ account_id: string; tutorials_seen: string[]; tutorials_off: boolean }>("select account_id, tutorials_seen, tutorials_off from accounts order by account_id")).rows;
    expect(Object.fromEntries(rows.map((r) => [r.account_id, r.tutorials_seen]))).toEqual({
      NEVER: [],
      DECLINED: ["welcome"],
      IDEA: ["welcome"],
      EVIDENCE: ["welcome", "idea"],
      EXPLORATION: ["welcome", "idea", "evidence"],
      STORY: ["welcome", "idea", "evidence", "exploration"],
      FINISHED: ["welcome", "idea", "evidence", "exploration", "story"],
      AGAIN: ["welcome", "idea", "evidence", "exploration", "story"],
    });
    expect(rows.every((r) => r.tutorials_off === false)).toBe(true);
  });

  it("drops the old columns", async () => {
    const cols = (await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'accounts' and column_name like 'tutorial%' order by column_name")).rows;
    expect(cols.map((c) => c.column_name)).toEqual(["tutorials_off", "tutorials_seen"]);
  });

  it("refuses a tutorial there is none of", async () => {
    await expect(client.query("update accounts set tutorials_seen = array['tour'] where account_id = 'NEVER'")).rejects.toThrow(/check/i);
  });
});
