import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

// The web app's tutorial, remembered on the account: whether it was offered, the stop it was left at,
// and whether it was finished. The person's own state, kept by `PATCH /api/v1/me` for a session in
// the web app, whatever roles they hold, and reached by nothing an agent can call.

let h: Harness;
let ex: Organization;
let ed: Browser; // an editor in an organization of their own
let gus: Browser; // in no organization: a guest of the example

const NEW = { offered: false, stop: null, finished: false };

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["olive@example.com"] });
  const olive = await h.signIn("olive@example.com", "Olive Owner");
  ex = await buildOrganization(h, olive, "Example Works", "TUTORIAL1");
  await syncExampleTenant(h.db, ex.tenant.slug, () => {});
  ed = await h.signIn("eddie@example.com", "Eddie Editor");
  gus = await h.signIn("gus@guest.example", "Gus Guest");
}, 120_000);
afterAll(async () => h?.close());

describe("the tutorial on the account", () => {
  it("starts as never offered, nowhere part-way and not finished, in the session the app reads and in /me", async () => {
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual(NEW);
    expect((await ed.api("GET", "/auth/session")).body.tutorial).toEqual(NEW);
  });

  it("keeps what each request names, and leaves the rest as it was", async () => {
    const offered = await ed.api("PATCH", "/api/v1/me", { tutorial: { offered: true } });
    expect(offered.status).toBe(200);
    expect(offered.body).toMatchObject({ tutorial: { offered: true, stop: null, finished: false }, display_name: "Eddie Editor", hide_example: false });
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { stop: 4 } })).body.tutorial).toEqual({ offered: true, stop: 4, finished: false });
    // Another field alone leaves the tutorial where it was.
    expect((await ed.api("PATCH", "/api/v1/me", { hide_example: true })).body.tutorial).toEqual({ offered: true, stop: 4, finished: false });
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { stop: null, finished: true } })).body.tutorial).toEqual({ offered: true, stop: null, finished: true });
    // Taken again, it is part-way once more; that it was finished before stays.
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { stop: 0 } })).body.tutorial).toEqual({ offered: true, stop: 0, finished: true });
  });

  it("keeps when it was first offered and last finished while they stay true", async () => {
    const before = await h.db.selectFrom("accounts").select(["tutorial_offered_at", "tutorial_finished_at"]).where("email", "=", "eddie@example.com").executeTakeFirstOrThrow();
    expect(before.tutorial_offered_at).toBeTruthy();
    await ed.api("PATCH", "/api/v1/me", { tutorial: { offered: true, finished: true } });
    const after = await h.db.selectFrom("accounts").select(["tutorial_offered_at", "tutorial_finished_at"]).where("email", "=", "eddie@example.com").executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    // Set back, as a reset does, it is offered again on the next product.
    expect((await ed.api("PATCH", "/api/v1/me", { tutorial: { offered: false, stop: null, finished: false } })).body.tutorial).toEqual(NEW);
  });

  it("follows the person to another browser, and survives signing out", async () => {
    await ed.api("PATCH", "/api/v1/me", { tutorial: { offered: true, stop: 7 } });
    await ed.api("POST", "/auth/sign-out");
    expect((await ed.api("GET", "/api/v1/me")).status).toBe(401);
    ed = await h.signIn("eddie@example.com");
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual({ offered: true, stop: 7, finished: false });
  });

  it("refuses what it does not keep: a stop out of range, a fraction, an unknown field, an empty tutorial", async () => {
    for (const tutorial of [{ stop: -1 }, { stop: 64 }, { stop: 2.5 }, { stop: "3" }, { offered: "yes" }, { running: true }, {}]) {
      const r = await ed.api("PATCH", "/api/v1/me", { tutorial });
      expect(r.status, JSON.stringify(tutorial)).toBe(422);
      expect(r.body.error.code).toBe("invalid_input");
    }
    // No other account's state can be named.
    expect((await ed.api("PATCH", "/api/v1/me", { account_id: "someone-else", tutorial: { stop: 1 } })).status).toBe(422);
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual({ offered: true, stop: 7, finished: false });
  });

  it("is a guest account's too, which holds no role in any organization", async () => {
    const me = (await gus.api("GET", "/api/v1/me")).body;
    expect(me.guest).toBe(true);
    expect(me.tutorial).toEqual(NEW);
    const r = await gus.api("PATCH", "/api/v1/me", { tutorial: { offered: true, stop: 2 } });
    expect(r.status).toBe(200);
    expect(r.body.tutorial).toEqual({ offered: true, stop: 2, finished: false });
    // One person's tutorial is never another's.
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual({ offered: true, stop: 7, finished: false });
  });

  it("is reached by no agent: a bearer token neither reads nor changes it", async () => {
    const token = await h.connectAgent(ed);
    const bearer = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${h.baseUrl}/api/v1/me`, { headers: bearer })).status).toBe(401);
    const patched = await fetch(`${h.baseUrl}/api/v1/me`, { method: "PATCH", headers: { ...bearer, "Content-Type": "application/json", Origin: h.baseUrl }, body: JSON.stringify({ tutorial: { stop: 1 } }) });
    expect(patched.status).toBe(401);
    expect((await ed.api("GET", "/api/v1/me")).body.tutorial).toEqual({ offered: true, stop: 7, finished: false });
  });

  it("goes with the account when it is deleted", async () => {
    const del = await h.signIn("dora@example.com", "Dora Deleted");
    await del.api("PATCH", "/api/v1/me", { tutorial: { offered: true, stop: 3, finished: true } });
    const id = (await del.api("GET", "/api/v1/me")).body.account_id;
    const r = await del.api("POST", "/api/v1/me/delete", { email: "dora@example.com", confirm: "delete permanently" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await h.db.selectFrom("accounts").select(["tutorial_offered_at", "tutorial_stop", "tutorial_finished_at"]).where("account_id", "=", id).executeTakeFirstOrThrow();
    expect(row).toEqual({ tutorial_offered_at: null, tutorial_stop: null, tutorial_finished_at: null });
  });
});
