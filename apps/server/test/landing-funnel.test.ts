import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { noteReturn, returnsSettled } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

/**
 * The landing pages' funnel (okf/operations/analytics.md#the-landing-page-funnel): the presses of
 * each page's buttons, the page and button a new account came by, when an account first came back,
 * and the guide's own queries, run as the guide writes them.
 */

const guide = readFileSync(resolve(fileURLToPath(new URL("../../../okf/operations/analytics.md", import.meta.url))), "utf8");

/** The guide's SQL block that starts with `lead`, its first day set to `firstDay`. */
function guideQuery(lead: string, firstDay: string): string {
  const block = [...guide.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]!).find((b) => b.startsWith(lead));
  if (!block) throw new Error(`okf/operations/analytics.md has no query starting "${lead}"`);
  expect(block).toContain("date '2026-12-01' as first_day");
  return block.replace("date '2026-12-01' as first_day", `date '${firstDay}' as first_day`);
}

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

let h: Harness;
const press = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${h.baseUrl}/api/v1/pressed`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const account = (email: string) => h.db.selectFrom("accounts").select(["account_id", "came_from", "came_via", "returned_at", "created_at"]).where("email", "=", email).executeTakeFirstOrThrow();
/** A new account from a landing page, as the web app tells the server once it is signed in. */
async function from(email: string, page: string, button?: string): Promise<Browser> {
  const b = await h.signIn(email, email.split("@")[0]);
  expect((await b.api("POST", "/api/v1/me/came-from", { page, ...(button ? { button } : {}) })).status).toBe(200);
  return b;
}

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());

describe("the landing pages' buttons", () => {
  it("counts each press by day, page and button, and keeps nothing else", async () => {
    for (const body of [{ page: "/", button: "explore" }, { page: "/", button: "explore" }, { page: "/what-to-build/", button: "start" }]) expect((await press(body)).status).toBe(200);
    const rows = await h.db.selectFrom("landing_presses").selectAll().orderBy("page").orderBy("button").execute();
    expect(rows).toEqual([
      expect.objectContaining({ page: "/", button: "explore", presses: 2 }),
      expect.objectContaining({ page: "/what-to-build/", button: "start", presses: 1 }),
    ]);
  });

  it("refuses a page that is not a landing page, a button it does not have, and anything more", async () => {
    for (const body of [{ page: "/plans/", button: "start" }, { page: "/", button: "sign-in" }, { page: "/", button: "start", email: "pat@example.com" }, {}]) {
      const res = await press(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect((await h.db.selectFrom("landing_presses").select("page").where("page", "=", "/plans/").execute()).length).toBe(0);
  });
});

describe("where a new account came from", () => {
  it("keeps the page and the button once, and takes no other button", async () => {
    const b = await from("gil@example.com", "/what-to-build/", "explore");
    expect((await b.api("POST", "/api/v1/me/came-from", { page: "/", button: "start" })).status).toBe(200);
    expect((await b.api("POST", "/api/v1/me/came-from", { page: "/", button: "demo" })).status).toBe(422);
    expect(await account("gil@example.com")).toMatchObject({ came_from: "/what-to-build/", came_via: "explore" });
    // A link from before the button was kept says only the page.
    await from("hal@example.com", "/");
    expect(await account("hal@example.com")).toMatchObject({ came_from: "/", came_via: null });
  });
});

describe("coming back", () => {
  it("keeps an account's first call on a later UTC day than the one it was made, once", async () => {
    const back = await h.signIn("ivy@example.com", "Ivy");
    await sql`update accounts set created_at = ${ago(2)} where email = 'ivy@example.com'`.execute(h.db);
    const today = await h.signIn("jon@example.com", "Jon");
    expect((await back.api("GET", "/api/v1/me/products")).headers.get("X-WhatBuild-Operation")).toBe("products.list");
    expect((await today.api("GET", "/api/v1/me/products")).status).toBe(200);
    await returnsSettled();
    const ivy = await account("ivy@example.com");
    expect(ivy.returned_at).not.toBeNull();
    expect((await account("jon@example.com")).returned_at).toBeNull();
    // The next day, the account made today has come back, and the other's first return stays.
    const tomorrow = new Date(Date.now() + 86_400_000);
    for (const email of ["ivy@example.com", "jon@example.com"]) noteReturn(h.db, { account_id: (await account(email)).account_id, auth_kind: "session" }, tomorrow);
    await returnsSettled();
    expect((await account("ivy@example.com")).returned_at).toEqual(ivy.returned_at);
    expect((await account("jon@example.com")).returned_at).toEqual(tomorrow.toISOString());
  });

  it("forgets where an account came from, and when it came back, when it is deleted", async () => {
    const kim = await from("kim@example.com", "/", "start");
    await sql`update accounts set returned_at = now() where email = 'kim@example.com'`.execute(h.db);
    const { account_id } = await account("kim@example.com");
    expect((await kim.api("POST", "/api/v1/me/delete", { email: "kim@example.com", confirm: "delete permanently" })).status).toBe(200);
    const row = await h.db.selectFrom("accounts").select(["came_from", "came_via", "returned_at", "deleted_at"]).where("account_id", "=", account_id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ came_from: null, came_via: null, returned_at: null, deleted_at: expect.anything() });
  });
});

describe("the guide's queries", () => {
  it("follow each page and button from presses to people coming back", async () => {
    await h.db.deleteFrom("landing_presses").execute();
    await sql`update accounts set came_from = null, came_via = null`.execute(h.db);
    await press({ page: "/", button: "explore" });
    await press({ page: "/", button: "explore" });
    await press({ page: "/", button: "start" });
    await press({ page: "/what-to-build/", button: "explore" });
    // Before the period: not counted.
    await h.db.insertInto("landing_presses").values({ day: day(40), page: "/", button: "start", presses: 9 }).execute();

    // From /, by Explore the demo: a guest let into the demo, who came back within the week.
    await from("lea@example.com", "/", "explore");
    await h.db.insertInto("guest_passes").values({ account_id: (await account("lea@example.com")).account_id, first_in_at: ago(0), day: day(0), last_active_at: ago(0) }).execute();
    await sql`update accounts set created_at = ${ago(10)}, returned_at = ${ago(8)} where email = 'lea@example.com'`.execute(h.db);
    // From /, by Explore the demo, made ten days ago, back only after its week.
    await from("max@example.com", "/", "explore");
    await sql`update accounts set created_at = ${ago(10)}, returned_at = ${ago(1)} where email = 'max@example.com'`.execute(h.db);
    // From /, by Start using WhatBuild: started an organization and connected an agent, today.
    const ned = await from("ned@example.com", "/", "start");
    expect((await ned.api("POST", "/api/v1/tenants", { name: "Ned's" })).status).toBe(201);
    await h.connectAgent(ned, "Claude Code");
    // From /what-to-build/, by Start using WhatBuild: joined the waitlist.
    await from("ona@example.com", "/what-to-build/", "start");
    expect((await fetch(`${h.baseUrl}/api/v1/interest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ona@example.com" }) })).status).toBe(200);
    // Made before the period: not counted.
    await from("pia@example.com", "/what-to-build/", "explore");
    await sql`update accounts set created_at = ${ago(40)} where email = 'pia@example.com'`.execute(h.db);
    // A request to hear from us, sent from the dark page's form.
    await fetch(`${h.baseUrl}/api/v1/interest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "quinn@example.com", page: "/what-to-build/" }) });

    const funnel = (await sql.raw(guideQuery("-- The landing-page funnel", day(30))).execute(h.db)).rows;
    expect(funnel).toEqual([
      { page: "/", button: "explore", presses: 2, accounts: 2, into_demo: 1, joined_waitlist: 0, organizations: 0, agents: 0, week_old: 2, back_within_week: 1 },
      { page: "/", button: "start", presses: 1, accounts: 1, into_demo: 0, joined_waitlist: 0, organizations: 1, agents: 1, week_old: 0, back_within_week: 0 },
      { page: "/what-to-build/", button: "explore", presses: 1, accounts: 0, into_demo: 0, joined_waitlist: 0, organizations: 0, agents: 0, week_old: 0, back_within_week: 0 },
      { page: "/what-to-build/", button: "start", presses: 0, accounts: 1, into_demo: 0, joined_waitlist: 1, organizations: 0, agents: 0, week_old: 0, back_within_week: 0 },
    ]);
    const requests = (await sql.raw(guideQuery("-- Requests to hear from us", day(30))).execute(h.db)).rows;
    expect(requests).toEqual([{ page: "/what-to-build/", requests: 1 }]);
  });
});
