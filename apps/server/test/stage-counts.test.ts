import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let rita: Browser;
let P: string;
let productId: string;

const page = (heading: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title></head><body><h1>${heading}</h1></body></html>`;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Stage Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Staged", concept: "A product to count." });
  P = `/api/v1/p/${p.body.path}`;
  productId = p.body.product_id;
  expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "staged", email: "rita@example.com", role: "reader" })).status).toBe(201);
});
afterAll(async () => h?.close());

describe("stage counts", () => {
  it("total every item each stage holds, leaving out archived and not-current ones, as products.get and products.list report them", async () => {
    // Idea: outcomes, one of them archived.
    await alice.api("POST", `${P}/outcomes`, { title: "Plan the week" });
    await alice.api("POST", `${P}/outcomes`, { title: "Retired aim", status: "archived" });
    // Evidence: sources.
    for (const n of [1, 2]) expect((await alice.api("POST", `${P}/sources/with-upload`, { tags: ["note"], title: `Note ${n}`, path: `note-${n}.md`, role: "primary" })).status).toBe(201);
    // Exploration: mockups and current assumptions; a superseded one is not counted.
    const m = await alice.api("POST", `${P}/mockups`, { title: "Board", pages: [{ page_id: "phone", title: "Phone", html: page("Phone") }] });
    expect(m.status).toBe(201);
    await alice.api("POST", `${P}/assumptions`, { statement: "Crews plan weekly." });
    const old = await alice.api("POST", `${P}/assumptions`, { statement: "Crews plan daily." });
    expect((await alice.api("POST", `${P}/assumptions/${old.body.id}/supersede`, { expected_etag: old.body.etag, note: "Wrong cadence.", statement: "Crews plan on Mondays." })).status).toBe(200);
    // Story: two pages in the tree, one archived, and a promoted mockup page in the Published mockups.
    for (const id of ["overview", "plan", "gone"]) expect((await alice.api("POST", `${P}/story/pages/${id}/versions`, { title: id, html: page(id) })).status).toBe(201);
    const gone = await alice.api("GET", `${P}/story/pages/gone`);
    expect((await alice.api("POST", `${P}/story/pages/gone/archive`, { expected_etag: gone.body.etag })).status).toBe(200);
    expect((await alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: m.body.mockup_id, mockup_page_id: "phone" })).status).toBe(201);

    // What a reader sees in the Story: the tree, the pages not yet placed at its end, then the Published mockups.
    const tree = await alice.api("GET", `${P}/story/hierarchy`);
    const flat = (nodes: { page_id: string; children: unknown[] }[]): string[] => nodes.flatMap((n) => [n.page_id, ...flat(n.children as never)]);
    const seen = flat(tree.body.items).length + tree.body.unplaced.length + tree.body.mockups.length;
    expect(tree.body.mockups.map((x: { page_id: string }) => x.page_id)).toEqual(["phone"]);
    expect(seen).toBe(3);

    const got = (await alice.api("GET", P)).body;
    expect(got.counts).toEqual({ outcomes: 1, sources: 2, mockups: 1, assumptions: 2, story_pages: 3 });
    expect(got.stage_counts).toEqual({ idea: 1, evidence: 2, exploration: 3, story: seen });
    const listed = (await alice.api("GET", "/api/v1/me/products")).body.items.find((i: { product_id: string }) => i.product_id === productId);
    expect(listed.stage_counts).toEqual(got.stage_counts);
    expect(listed.counts).toEqual(got.counts);

    // A reader gets the Story's count alone.
    const theirs = (await rita.api("GET", P)).body;
    expect(theirs.counts).toEqual({ story_pages: 3 });
    expect(theirs.stage_counts).toEqual({ story: 3 });
  });
});
