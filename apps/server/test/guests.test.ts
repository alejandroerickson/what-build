import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, withGuestSettings, type Browser, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

// Guests: accounts in no organization, with no allowance, which read the example organization and
// nothing else. Each holds a place while they work; past the places, they wait in line. People in an
// organization never wait. An instance owner sets how many, and may let anyone sign up as one.

let h: Harness;
let ex: Organization;
let olive: Browser; // owns the example, and the instance
let P: string;

const pass = (who: Browser) => who.api("GET", "/api/v1/me/guest-pass");
const read = (who: Browser) => who.api("GET", `${P}/outcomes`);

/** Make a guest's place look idle, as if their last call were long ago. */
async function idle(who: Browser) {
  const me = (await who.api("GET", "/api/v1/me")).body.account_id as string;
  await h.db.updateTable("guest_passes").set({ last_active_at: new Date(Date.now() - 3 * 3600_000).toISOString() }).where("account_id", "=", me).execute();
}

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["olive@example.com"], signupAllowlist: ["@listed.example"] });
  olive = await h.signIn("olive@example.com", "Olive Owner");
  ex = await buildOrganization(h, olive, "Example Works", "EXAMPLE9");
  await h.worker.drain();
  P = `/api/v1/p/${ex.product.path}`;
  expect(await syncExampleTenant(h.db, ex.tenant.slug, () => {})).toBe(ex.tenant.id);
}, 120_000);
afterAll(async () => h?.close());

describe("what the instance's page says of sign-up", () => {
  it("says sign-up is open where no allowlist limits it, whatever self_serve says", async () => {
    expect((await olive.api("GET", "/api/v1/guests")).body).toMatchObject({ open_without_allowlist: false, settings: { self_serve: false } });
    const open = await startHarness({ instanceOwners: ["olive@example.com"] });
    try {
      const owner = await open.signIn("olive@example.com", "Olive Owner");
      expect((await owner.api("GET", "/api/v1/guests")).body).toMatchObject({ open_without_allowlist: true, settings: { self_serve: false } });
    } finally {
      await open.close();
    }
  });
});

describe("a guest account", () => {
  it("is one in no organization and with no allowance, and comes in while there is room", async () => {
    const gil = await h.signIn("gil@listed.example", "Gil Guest");
    expect((await gil.api("GET", "/api/v1/me")).body.guest).toBe(true);
    expect((await pass(gil)).body).toMatchObject({ guest: true, status: "in" });
    expect((await read(gil)).status).toBe(200);
    // Writing is still refused as the example's, not as a place.
    expect((await gil.api("POST", `${P}/outcomes`, { title: "A guest's outcome" })).body.error.code).toBe("example_read_only");
    // The example's owner, in an organization, is no guest and never waits.
    expect((await olive.api("GET", "/api/v1/me")).body.guest).toBe(false);
    expect((await pass(olive)).body).toEqual({ guest: false, status: "in" });
  });

  it("waits in line when every place is taken, and comes in when one frees", async () => {
    await withGuestSettings(h, { at_once: 1 }, async () => {
      const ana = await h.signIn("ana@listed.example", "Ana Guest");
      const bo = await h.signIn("bo@listed.example", "Bo Guest");
      // Make the earlier guests' places free, so Ana takes the one place.
      for (const email of ["gil@listed.example"]) await idle(await h.signIn(email));
      expect((await read(ana)).status).toBe(200);
      const refused = await read(bo);
      expect(refused.status).toBe(429);
      expect(refused.body.error).toMatchObject({ code: "guest_waiting", details: { status: "waiting", reason: "full", position: 1, in_now: 1 } });
      expect(refused.body.error.message).toMatch(/^WhatBuild is full for guests right now/);
      expect((await pass(bo)).body).toMatchObject({ guest: true, status: "waiting", reason: "full", position: 1 });
      // Someone in an organization is never held back by guests.
      expect((await olive.api("GET", `${P}/outcomes`)).status).toBe(200);
      await idle(ana);
      expect((await pass(bo)).body).toMatchObject({ status: "in" });
      expect((await read(bo)).status).toBe(200);
      // Ana, back, now waits behind Bo's place.
      expect((await pass(ana)).body).toMatchObject({ status: "waiting", reason: "full" });
      await idle(bo);
    });
  });

  it("lets a few new guests in each day, and has a while in each day", async () => {
    await withGuestSettings(h, { new_per_day: 0 }, async () => {
      const cy = await h.signIn("cy@listed.example", "Cy Guest");
      expect((await pass(cy)).body).toMatchObject({ status: "waiting", reason: "new_today" });
      expect((await read(cy)).body.error.message).toMatch(/^Today's places for new guests are taken/);
      // A guest who came in before is no new guest.
      expect((await pass(await h.signIn("gil@listed.example"))).body.status).toBe("in");
    });
    const gil = await h.signIn("gil@listed.example");
    const me = (await gil.api("GET", "/api/v1/me")).body.account_id as string;
    await h.db.updateTable("guest_passes").set({ seconds_today: 120 * 60 }).where("account_id", "=", me).execute();
    expect((await pass(gil)).body).toMatchObject({ status: "waiting", reason: "time_today" });
    await h.db.updateTable("guest_passes").set({ seconds_today: 0 }).where("account_id", "=", me).execute();
  });

  it("is let in by nobody while no place is open", async () => {
    await withGuestSettings(h, { at_once: 0 }, async () => {
      const gil = await h.signIn("gil@listed.example");
      expect((await pass(gil)).body).toMatchObject({ status: "closed", reason: "closed" });
      expect((await read(gil)).body.error).toMatchObject({ code: "guest_waiting" });
    });
  });

  it("downloads only so much of the example a day", async () => {
    const s = await olive.api("POST", `${P}/sources`, { title: "Sample notes to download", tags: ["notes"] });
    const grant = await olive.api("POST", `${P}/sources/${s.body.record_id}/uploads`, { path: "notes.md" });
    expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "n".repeat(300) })).status).toBe(201);
    const file = `${P}/sources/${s.body.record_id}/attachment?path=notes.md`;
    await withGuestSettings(h, { sent_bytes_per_day: 500 }, async () => {
      const dee = await h.signIn("dee@listed.example", "Dee Guest");
      expect((await dee.api("GET", file)).status).toBe(200);
      const refused = await dee.api("GET", file);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: "quota_exceeded", details: { quota: "sent_bytes_per_day", limit: 500, used: 300 } });
      // Its staff are not guests there.
      expect((await olive.api("GET", file)).status).toBe(200);
      await idle(dee);
    });
  });
});

describe("signing up as a guest", () => {
  it("is open to anyone only while an instance owner lets guests sign up themselves", async () => {
    const ask = () => fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email: "stranger@unlisted.example" }) });
    const linksTo = () => h.mailer.sent.filter((m) => m.to === "stranger@unlisted.example").length;
    // Answered as any address is, and sent nothing, while guests can't sign up.
    const closed = await ask();
    expect(closed.status).toBe(200);
    expect(await closed.json()).toEqual({ received: true });
    expect(linksTo()).toBe(0);
    await withGuestSettings(h, { self_serve: true }, async () => {
      expect((await ask()).status).toBe(200);
      expect(linksTo()).toBe(1);
      expect((await fetch(`${h.baseUrl}/api/v1/plans`).then((r) => r.json())) as unknown).toMatchObject({ guests: { self_serve: true, open: true } });
    });
  });
});

describe("the sign-in form", () => {
  it("answers an address that may not sign in exactly as one that may, and limits both alike", async () => {
    const ask = (email: string) => fetch(`${h.baseUrl}/auth/email`, { method: "POST", headers: { "content-type": "application/json", origin: h.baseUrl }, body: JSON.stringify({ email }) });
    const answers = async (email: string) => {
      const out: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await ask(email);
        out.push(`${r.status} ${JSON.stringify(await r.json())}`);
      }
      return out;
    };
    // An account here, and an address nothing lets in.
    await h.signIn("gil@listed.example");
    expect(await answers("nobody@unlisted.example")).toEqual(await answers("gil@listed.example"));
  });
});

describe("the guests' settings", () => {
  it("are read and changed by an instance owner alone, under their etag, with how many are in", async () => {
    const gil = await h.signIn("gil@listed.example");
    expect((await gil.api("GET", "/api/v1/guests")).status).toBe(403);
    expect((await gil.api("PATCH", "/api/v1/guests", { at_once: 1000 })).status).toBe(403);
    const before = (await olive.api("GET", "/api/v1/guests")).body;
    expect(before).toMatchObject({ settings: { self_serve: false, at_once: 25, sent_bytes_per_day: 10 * 1024 * 1024 }, etag: null });
    expect(before.now).toMatchObject({ ever: expect.any(Number), new_today: expect.any(Number) });
    const changed = await olive.api("PATCH", "/api/v1/guests", { at_once: 40, self_serve: true });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.settings).toMatchObject({ at_once: 40, self_serve: true });
    expect((await olive.api("PATCH", "/api/v1/guests", { at_once: 50 })).body.error).toMatchObject({ code: "stale_etag", details: { current_etag: changed.body.etag } });
    expect((await olive.api("PATCH", "/api/v1/guests", { at_once: -1, expected_etag: changed.body.etag })).status).toBe(422);
    const back = await olive.api("PATCH", "/api/v1/guests", { at_once: 25, self_serve: false, expected_etag: changed.body.etag });
    expect(back.body.settings).toMatchObject({ at_once: 25, self_serve: false });
  });
});
