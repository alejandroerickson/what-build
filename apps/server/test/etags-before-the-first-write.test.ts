import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A write that may create what it writes takes no etag the first time. One sent while there is
// nothing to match is refused, as a source's summary, notes and derived text refuse it: 409
// stale_etag with current_etag null, saying to leave it out. Nothing is written. Without it the
// first write goes through, and from then on the etag is needed.

let h: Harness;
let owen: Browser;
let P: string;

const page = (heading: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title></head><body><h1>${heading}</h1></body></html>`;

/** The refusal of an etag sent when there is nothing to match. */
const nothingToMatch = (r: { status: number; body: { error: { code: string; message: string; details?: Record<string, unknown> } } }, leaveOut: RegExp) => {
  expect(r.status, JSON.stringify(r.body)).toBe(409);
  expect(r.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: null } });
  expect(r.body.error.message).toContain("no etag to match");
  expect(r.body.error.message).toMatch(leaveOut);
};

beforeAll(async () => {
  h = await startHarness({ instanceOwners: ["owen@etags.example"] });
  owen = await h.signIn("owen@etags.example", "Owen Etags");
  const t = await owen.api("POST", "/api/v1/tenants", { name: "Etag Co" });
  const p = await owen.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "First" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

describe("an etag sent before the first write", () => {
  it("is refused by the Story's style, which the first write then sets without one", async () => {
    nothingToMatch(await owen.api("PUT", `${P}/story/style`, { house_style: "clear", expected_etag: "made-up" }), /Leave expected_etag out for the first style/);
    expect((await owen.api("GET", `${P}/story/style`)).body.style).toBeNull();
    const set = await owen.api("PUT", `${P}/story/style`, { house_style: "clear" });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((await owen.api("PUT", `${P}/story/style`, { name: "Clear, ours" })).body.error).toMatchObject({ code: "stale_etag", details: { current_etag: set.body.style.etag } });
  });

  it("is refused by an allowance for an address that has none, which the first write then gives", async () => {
    const A = "/api/v1/tenant-allowances";
    nothingToMatch(await owen.api("PUT", A, { email: "nell@etags.example", allowed: 2, expected_etag: "made-up", notify: false }), /Leave expected_etag out to give it one/);
    expect((await owen.api("GET", A)).body.items).toEqual([]);
    const given = await owen.api("PUT", A, { email: "nell@etags.example", allowed: 2, notify: false });
    expect(given.status, JSON.stringify(given.body)).toBe(200);
    // Once it exists, a change without the etag says which to pass and where to read it.
    const blind = await owen.api("PUT", A, { email: "nell@etags.example", allowed: 3, notify: false });
    expect(blind.status).toBe(409);
    expect(blind.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: given.body.etag } });
    expect(blind.body.error.message).toBe('nell@etags.example already has an allowance; read it with products_read(action="tenant_allowances") and pass its etag as expected_etag.');
  });

  it("is refused by a new mockup, a page's first version, a new page promoted from a mockup and the first hierarchy", async () => {
    const pages = [{ page_id: "plan", title: "Plan", html: page("Plan") }];
    nothingToMatch(await owen.api("POST", `${P}/mockups`, { title: "Week view", brief: "Which screen tells crews the plan.", pages, expected_etag: "made-up" }), /Leave expected_etag out to create it/);
    expect((await owen.api("GET", `${P}/mockups`)).body.items).toEqual([]);
    const m = await owen.api("POST", `${P}/mockups`, { title: "Week view", brief: "Which screen tells crews the plan.", pages });
    expect(m.status, JSON.stringify(m.body)).toBe(201);

    nothingToMatch(await owen.api("POST", `${P}/story/pages/plan/versions`, { title: "The plan", body: "<p>The plan.</p>", expected_etag: "made-up" }), /Leave expected_etag out for its first version/);
    nothingToMatch(await owen.api("POST", `${P}/story/promote-mockup`, { mockup_id: m.body.mockup_id, mockup_page_id: "plan", page_id: "week", expected_etag: "made-up" }), /Leave expected_etag out to create it/);
    expect((await owen.api("GET", `${P}/story/pages`)).body.items).toEqual([]);
    nothingToMatch(await owen.api("PUT", `${P}/story/hierarchy`, { items: [], expected_etag: "made-up" }), /Leave expected_etag out, or pass null, for the first save/);
    expect((await owen.api("PUT", `${P}/story/hierarchy`, { items: [], expected_etag: null })).status).toBe(200);
  });
});
