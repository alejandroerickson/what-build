import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inspectMockupHtml, inspectStoryHtml, MOCKUP_PAGE_RULES, MOCKUP_PAGE_SANDBOX, MOCKUP_RESPONSE_HEADERS, pageResponseHeaders, prototypeSandbox, STORY_PAGE_RULES, STORY_PAGE_SANDBOX, STORY_RESPONSE_HEADERS } from "@whatbuild/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let vic: Browser;
let rita: Browser;
let P: string;
let tenantSlug: string;
let tenantId: string;
let teamSlug: string;

const page = (heading: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title><style>body{font:16px system-ui}</style></head><body><h1>${heading}</h1></body></html>`;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Canvas Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner", concept: "A planner for finance teams." });
  P = `/api/v1/p/${p.body.path}`;
  tenantSlug = t.body.tenant.slug;
  tenantId = t.body.tenant.tenant_id ?? t.body.tenant.id;
  teamSlug = t.body.team.slug;
  for (const [email, role] of [["vic@example.com", "viewer"], ["rita@example.com", "reader"]])
    expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email, role })).status).toBe(201);
});
afterAll(async () => h?.close());

async function raw(b: Browser, path: string, headers: Record<string, string> = {}) {
  return fetch(`${h.baseUrl}${path}`, { headers: { cookie: b.cookie, ...headers } });
}

/** A mockup's current version as get reads it; publish answers with what comes next, never the canvas. */
async function canvasOf(base: string, mockupId: string, query = "") {
  const r = await alice.api("GET", `${base}/mockups/${mockupId}${query}`);
  expect(r.status).toBe(200);
  return r.body.current;
}

describe("mockups", () => {
  let id: string;
  let etag: string;

  it("creates a mockup with its first version: the brief, the pages in order and what it explores", async () => {
    const r = await alice.api("POST", `${P}/mockups`, {
      title: "Close dashboard",
      summary: "Three ways to show the close on one screen.",
      brief: "# Close dashboard\n\nWhich layout lets a finance lead see the close at a glance?",
      columns: 3,
      pages: [
        { page_id: "grid", title: "Grid", notes: "Dense, for experts.", html: page("Grid") },
        { page_id: "timeline", title: "Timeline", html: page("Timeline"), width: 390, height: 844 },
      ],
    });
    expect(r.status).toBe(201);
    id = r.body.mockup_id;
    etag = r.body.etag;
    // The answer is what a caller needs next (ids, the version, the etag, the canvas's address), not
    // the canvas it just sent.
    expect(r.body).toEqual({
      mockup_id: id,
      title: "Close dashboard",
      current_version: 1,
      current_version_id: expect.any(String),
      etag: expect.any(String),
      based_on_version: null,
      page_ids: ["grid", "timeline"],
      url: `${h.baseUrl}/t/${P.replace("/api/v1/p/", "")}/exploration/mockups/${id}`,
      next: expect.stringContaining('mockups_read(action="get")'),
    });
    expect(r.headers.get("etag")).toBe(`"${etag}"`);
    const v = await canvasOf(P, id);
    expect(v.version_id).toBe(r.body.current_version_id);
    expect(v.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["grid", "timeline"]);
    expect(v.pages[0]).toMatchObject({ width: 1280, height: 800, notes: "Dense, for experts." });
    expect(v.pages[1]).toMatchObject({ width: 390, height: 844 });
    const list = await alice.api("GET", `${P}/mockups`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ mockup_id: id, page_count: 2 });
  });

  it("publishes the next version, carrying forward every page and field the call leaves out", async () => {
    const r = await alice.api("POST", `${P}/mockups`, {
      mockup_id: id,
      expected_etag: etag,
      pages: [{ page_id: "timeline" }, { page_id: "cards", title: "Cards", html: page("Cards") }, { page_id: "grid", notes: "Too dense in testing." }],
    });
    expect(r.status).toBe(201);
    etag = r.body.etag;
    expect(r.body).toMatchObject({ current_version: 2, based_on_version: 1, page_ids: ["timeline", "cards", "grid"] });
    expect(r.body).not.toHaveProperty("current");
    const v = await canvasOf(P, id);
    expect(v.brief).toContain("at a glance");
    expect(v.columns).toBe(3);
    expect(v.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["timeline", "cards", "grid"]);
    expect(v.pages[0]).toMatchObject({ title: "Timeline", width: 390 });
    expect(v.pages[2]).toMatchObject({ title: "Grid", notes: "Too dense in testing." });
    const versions = await alice.api("GET", `${P}/mockups/${id}/versions`);
    expect(versions.body.items.map((x: { version: number; page_count: number }) => [x.version, x.page_count])).toEqual([[2, 3], [1, 2]]);
    const one = await alice.api("GET", `${P}/mockups/${id}/versions/1`);
    expect(one.body).toMatchObject({ version: 1, is_current: false });
  });

  it("refuses a stale etag, a new page without html, and HTML that loads remote resources", async () => {
    const stale = await alice.api("POST", `${P}/mockups`, { mockup_id: id, expected_etag: "nope", title: "Renamed" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
    const bare = await alice.api("POST", `${P}/mockups`, { mockup_id: id, expected_etag: etag, pages: [{ page_id: "new-one", title: "New" }] });
    expect(bare.status).toBe(422);
    const remote = await alice.api("POST", `${P}/mockups`, {
      mockup_id: id,
      expected_etag: etag,
      pages: [{ page_id: "grid", html: '<!doctype html><html><body><img src="https://example.com/x.png"><script src="https://example.com/a.js"></script></body></html>' }],
    });
    expect(remote.status).toBe(422);
    expect(remote.body.error.code).toBe("invalid_html");
    expect(remote.body.error.details.problems.length).toBeGreaterThanOrEqual(2);
  });

  it("serves a page's HTML in the sandbox, with the frame script only when the app's frame asks", async () => {
    const path = `${P}/mockups/${id}/versions/2/pages/cards/html`;
    const plain = await raw(alice, path);
    expect(plain.status).toBe(200);
    const csp = plain.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/^sandbox allow-scripts/);
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(plain.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await plain.text()).not.toContain("story-key");
    const framed = await raw(alice, `${path}?frame=1`);
    expect(await framed.text()).toContain("story-key");
    expect((await raw(alice, `${P}/mockups/${id}/versions/1/pages/cards/html`)).status).toBe(404);
  });

  it("gives a version as a ZIP through a download grant: the brief, a manifest and each page's HTML and notes", async () => {
    const g = await alice.api("POST", `${P}/mockups/${id}/downloads`, { version: 2 });
    expect(g.status).toBe(200);
    const res = await fetch(g.body.url, { headers: g.body.headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["brief.md", "manifest.json", "pages/cards.html", "pages/cards.notes.md", "pages/grid.html", "pages/grid.notes.md", "pages/timeline.html", "pages/timeline.notes.md"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest).toMatchObject({ format: "whatbuild-mockup", version: 2, columns: 3 });
    expect(manifest.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["timeline", "cards", "grid"]);
    expect(strFromU8(files["pages/grid.notes.md"]!)).toBe("Too dense in testing.");
    expect((await fetch(g.body.url)).status).toBe(401);
  });

  it("lets a viewer read and download but not publish, and keeps a Story reader out", async () => {
    expect((await vic.api("GET", `${P}/mockups/${id}`)).status).toBe(200);
    expect((await vic.api("POST", `${P}/mockups/${id}/downloads`, {})).status).toBe(200);
    expect((await vic.api("POST", `${P}/mockups`, { mockup_id: id, expected_etag: etag, title: "Mine" })).status).toBe(403);
    expect((await rita.api("GET", `${P}/mockups`)).status).toBe(403);
    expect((await rita.api("GET", `${P}/mockups/${id}`)).status).toBe(403);
    expect((await raw(rita, `${P}/mockups/${id}/versions/2/pages/cards/html`)).status).toBe(403);
  });

  it("archives and restores, keeping every version readable", async () => {
    const a = await alice.api("POST", `${P}/mockups/${id}/archive`, { expected_etag: etag });
    expect(a.body.archived_at).toBeTruthy();
    expect((await alice.api("GET", `${P}/mockups`)).body.items).toHaveLength(0);
    expect((await alice.api("GET", `${P}/mockups?include_archived=true`)).body.items).toHaveLength(1);
    const blocked = await alice.api("POST", `${P}/mockups`, { mockup_id: id, expected_etag: a.body.etag, title: "Again" });
    expect(blocked.body.error.code).toBe("mockup_archived");
    const r = await alice.api("POST", `${P}/mockups/${id}/restore`, { expected_etag: a.body.etag });
    expect(r.body.archived_at).toBeNull();
    const activity = await alice.api("GET", `${P}/activity?entity_type=mockup`);
    expect(activity.body.items.map((i: { action: string }) => i.action)).toEqual(["restored", "archived", "updated", "created"]);
  });
});

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Dana>We close the books on the third working day.

00:00:05.000 --> 00:00:09.000
<v Sam>What slows it down?

00:00:09.000 --> 00:00:14.000
<v Dana>Chasing approvals across four spreadsheets.
`;

describe("a mockup beside the product's sources", () => {
  let recordId: string;
  let mockupId: string;

  beforeAll(async () => {
    const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Finance lead interview", date: "2026-09-03", path: "call.vtt" });
    recordId = created.body.record.record_id;
    const up = created.body.upload;
    await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
    await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "call.vtt" });
    await h.worker.drain();
    const m = await alice.api("POST", `${P}/mockups`, {
      title: "Approvals",
      brief: "Where do approvals stall?",
      pages: [{ page_id: "queue", title: "Queue", html: page("Queue") }],
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    mockupId = m.body.mockup_id;
    const v2 = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: m.body.etag, summary: "Where approvals stall, on one screen." });
    expect(v2.status).toBe(201);
  });

  it("lets a source move to another product whatever a mockup was built from", async () => {
    await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Elsewhere" });
    const etag = (await alice.api("GET", `${P}/sources/${recordId}`)).body.etag;
    const moved = await alice.api("POST", `${P}/sources/${recordId}/move`, { record_id: recordId, to_product: "elsewhere", expected_etag: etag });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ record_id: recordId, product: "Elsewhere" });
    expect((await alice.api("GET", `${P}/mockups/${mockupId}`)).body.current_version).toBe(2);
  });

  it("goes into the product export: every version, with its brief, pages and notes", async () => {
    expect((await alice.api("POST", `${P}/exports`, {})).status).toBe(201);
    await h.worker.drain();
    const ex = (await alice.api("GET", `${P}/exports`)).body.items[0];
    const res = await fetch(ex.download.url, { headers: ex.download.headers });
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files);
    expect(names).toContain(`mockups/${mockupId}/mockup.json`);
    expect(names).toContain(`mockups/${mockupId}/v1/brief.md`);
    expect(names).toContain(`mockups/${mockupId}/v2/pages/queue.html`);
    expect(names).toContain(`mockups/${mockupId}/v2/pages/queue.notes.md`);
    const v2 = JSON.parse(strFromU8(files[`mockups/${mockupId}/v2/version.json`]!));
    expect(v2).toMatchObject({ n: 2, summary: "Where approvals stall, on one screen." });
    expect(v2).not.toHaveProperty("refs");
    expect(v2.pages).toEqual([expect.objectContaining({ page_id: "queue", title: "Queue" })]);
    expect(v2.pages[0].html).toBeUndefined();
  });

  it("holds at most 50 mockups in a product, archived ones included", async () => {
    const t = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Crowded" });
    const Q = `/api/v1/p/${t.body.path}`;
    for (let i = 0; i < 50; i++) expect((await alice.api("POST", `${Q}/mockups`, { title: `M${i}`, pages: [{ page_id: "a", title: "A", html: page("A") }] })).status).toBe(201);
    const full = await alice.api("GET", `${Q}/mockups`);
    expect(full.body).toMatchObject({ archived_hidden: 0, quota: { used: 50, limit: 50, unit: "mockups", archived_included: true } });
    expect(full.body.note).toBeUndefined();
    // Archived mockups leave the list and still count.
    for (const m of full.body.items.slice(0, 3)) expect((await alice.api("POST", `${Q}/mockups/${m.mockup_id}/archive`, { expected_etag: m.etag })).status).toBe(200);
    const list = await alice.api("GET", `${Q}/mockups`);
    expect(list.body.items).toHaveLength(47);
    expect(list.body).toMatchObject({ archived_hidden: 3, quota: { used: 50, limit: 50 } });
    expect(list.body.note).toBe("3 archived mockups are not listed; pass include_archived to see them. Archived mockups count toward the product's 50; 50 are used.");
    const all = await alice.api("GET", `${Q}/mockups?include_archived=true`);
    expect(all.body.items).toHaveLength(50);
    expect(all.body).toMatchObject({ archived_hidden: 0, quota: { used: 50 } });
    const over = await alice.api("POST", `${Q}/mockups`, { title: "One more", pages: [{ page_id: "a", title: "A", html: page("A") }] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("quota_exceeded");
    expect(over.body.error.details).toMatchObject({ quota: "mockups", limit: 50, used: 50, archived: 3 });
    expect(over.body.error.message).toMatch(/at most 50 mockups, archived ones included, and this one holds 50 \(3 archived\)/);
    // The product's counts are what the stages show: live mockups only.
    expect((await alice.api("GET", Q)).body.counts.mockups).toBe(47);
  });
});

describe("promoting a mockup page to the Story", () => {
  let mockupId: string;
  let mockupEtag: string;
  let pageEtag: string;

  beforeAll(async () => {
    const m = await alice.api("POST", `${P}/mockups`, {
      title: "Month-end",
      brief: "Two ways to see the close.",
      pages: [
        { page_id: "board", title: "Board", html: page("Board v1") },
        { page_id: "phone", title: "Phone view", width: 390, height: 760, html: page("Phone v1") },
      ],
    });
    mockupId = m.body.mockup_id;
    mockupEtag = m.body.etag;
  });

  it("makes a Story page that shows one mockup page as it is in that version, without a copy", async () => {
    const r = await alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "phone" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    pageEtag = r.body.etag;
    expect(r.body).toMatchObject({ page_id: "phone", title: "Phone view", current_version: 1, placed: false });
    expect(r.body.current.mockup).toMatchObject({ mockup_id: mockupId, version: 1, page_id: "phone", page_title: "Phone view", width: 390, height: 760, current_version: 1 });
    const got = await alice.api("GET", `${P}/story/pages/phone`);
    expect(got.body.current.html).toContain("Phone v1");
    const html = await raw(alice, `${P}/story/pages/phone/versions/1/html?theme=dark&frame=1`);
    const text = await html.text();
    expect(text).toContain("Phone v1");
    expect(text).not.toContain("data-wb-theme");
    expect(html.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts/);
    const m = await alice.api("GET", `${P}/mockups/${mockupId}`);
    expect(m.body.story_pages).toEqual([expect.objectContaining({ page_id: "phone", mockup_page_id: "phone", version: 1 })]);
  });

  it("lets a Story reader see the promoted page and nothing else of the mockup", async () => {
    const got = await rita.api("GET", `${P}/story/pages/phone`);
    expect(got.status).toBe(200);
    expect(got.body.current.mockup).toEqual({ width: 390, height: 760 });
    expect((await raw(rita, `${P}/story/pages/phone/versions/1/html`)).status).toBe(200);
    expect((await raw(rita, `${P}/mockups/${mockupId}/versions/1/pages/phone/html`)).status).toBe(403);
    expect((await raw(rita, `${P}/mockups/${mockupId}/versions/1/pages/board/html`)).status).toBe(403);
  });

  it("stays on its mockup version until it is promoted again", async () => {
    const v2 = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: mockupEtag, pages: [{ page_id: "board" }, { page_id: "phone", html: page("Phone v2") }] });
    expect(v2.status).toBe(201);
    expect(await (await raw(alice, `${P}/story/pages/phone/versions/1/html`)).text()).toContain("Phone v1");
    expect((await alice.api("GET", `${P}/story/pages/phone`)).body.current.mockup).toMatchObject({ version: 1, current_version: 2 });
    const again = await alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "phone", page_id: "phone", expected_etag: pageEtag });
    expect(again.status).toBe(201);
    pageEtag = again.body.etag;
    expect(again.body).toMatchObject({ current_version: 2, based_on_version: 1 });
    expect(await (await raw(alice, `${P}/story/pages/phone/versions/2/html`)).text()).toContain("Phone v2");
    expect(await (await raw(alice, `${P}/story/pages/phone/versions/1/html`)).text()).toContain("Phone v1");
    const versions = await alice.api("GET", `${P}/story/pages/phone/versions`);
    expect(versions.body.items[0].html_sha256).not.toBe(versions.body.items[1].html_sha256);
  });

  it("keeps showing the mockup page through a later publish, until html replaces it", async () => {
    const renamed = await alice.api("POST", `${P}/story/pages/phone/versions`, { title: "The phone view", expected_etag: pageEtag });
    expect(renamed.status).toBe(201);
    pageEtag = renamed.body.etag;
    expect(renamed.body.current.mockup).toMatchObject({ version: 2, page_id: "phone" });
    const patch = await alice.api("POST", `${P}/story/pages/phone/versions`, { patch_html: [{ find: "Phone", replace: "Mobile" }], expected_etag: pageEtag });
    expect(patch.status).toBe(422);
    expect(patch.body.error.message).toMatch(/shows page "phone" of a mockup/);
    const own = await alice.api("POST", `${P}/story/pages/phone/versions`, { html: page("Our own page"), expected_etag: pageEtag });
    expect(own.status).toBe(201);
    expect(own.body.current.mockup).toBeUndefined();
    expect(await (await raw(alice, `${P}/story/pages/phone/versions/4/html`)).text()).toContain("Our own page");
  });

  it("names a new page apart from one that has the slug, refuses a page the version lacks, and keeps out a viewer", async () => {
    const second = await alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "phone", version: 1, title: "Phone, first take" });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ page_id: "phone-2", title: "Phone, first take" });
    const missing = await alice.api("POST", `${P}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "tablet" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.details.pages).toEqual(["board", "phone"]);
    expect((await vic.api("POST", `${P}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "board" })).status).toBe(403);
  });

  it("exports the version's reference, not a copy, and prints the mockup page", async () => {
    expect((await alice.api("POST", `${P}/exports`, {})).status).toBe(201);
    await h.worker.drain();
    const ex = (await alice.api("GET", `${P}/exports`)).body.items[0];
    const files = unzipSync(new Uint8Array(await (await fetch(ex.download.url, { headers: ex.download.headers })).arrayBuffer()));
    const v1 = JSON.parse(strFromU8(files["story/pages/phone-2/v1.json"]!));
    expect(v1.mockup).toMatchObject({ mockup_id: mockupId, version: 1, page_id: "phone" });
    expect(files["story/pages/phone-2/v1.html"]).toBeUndefined();
    const plan = await alice.api("GET", `${P}/story/print-view?page_ids=phone-2`);
    expect(plan.body.pages[0].html_chars).toBeGreaterThan(0);
    expect(await (await raw(alice, `${P}/story/print?page_ids=phone-2`)).text()).toMatch(/<div class="print-frame" data-print-frame="\d+" style="width:\d+px;min-height:\d+px;--print-fit:[\d.]+"><div data-print-page="phone-2"/);
  });
});

describe("which page a result on several pages names", () => {
  let S: string;
  let mockupId: string;
  const page = (words: string) => `<!doctype html><html lang="en"><body><p>${words}</p></body></html>`;
  const named = async (b: Browser, words: string) => {
    const r = await b.api("GET", `${S}/search?mode=plain&strict=true&query=${encodeURIComponent(words)}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body.results as { id: string; meta: { page_id?: string; page_title?: string } }[]).find((x) => x.id === (b === rita ? "whole-yard" : mockupId))?.meta;
  };

  beforeAll(async () => {
    const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Titled pages" });
    S = `/api/v1/p/${p.body.path}`;
    expect((await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "titled-pages", email: "rita@example.com", role: "reader" })).status).toBe(201);
    const m = await alice.api("POST", `${S}/mockups`, {
      title: "Yard planning",
      pages: [
        { page_id: "intro", title: "Introduction", html: page("The rota is agreed on Monday, and then the rota goes up by the gate.") },
        { page_id: "notes", title: "Rota notes", html: page("Who swapped with whom.") },
        { page_id: "rota", title: "Rota", html: page("Who works when.") },
        { page_id: "gate", title: "Gate", html: page("Codes change on Friday.") },
        { page_id: "vans", title: "Vans", html: page("Each of the vans is loaded at seven.") },
      ],
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    mockupId = m.body.mockup_id;
    expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: mockupId, page_id: "whole-yard" })).status).toBe(201);
  });

  it("is the page titled with the words, ahead of the first that says them", async () => {
    expect(await named(alice, "rota")).toMatchObject({ page_id: "rota", page_title: "Rota" });
    expect(await named(alice, "gate")).toMatchObject({ page_id: "gate", page_title: "Gate" });
  });

  it("is the one whose title says them best, of those titled with them", async () => {
    expect(await named(alice, "rota notes")).toMatchObject({ page_id: "notes" });
  });

  it("holds the most of the words, whatever its title", async () => {
    expect(await named(alice, "rota monday")).toMatchObject({ page_id: "intro", page_title: "Introduction" });
  });

  it("is the first that says them when no page is titled with them", async () => {
    expect(await named(alice, "monday")).toMatchObject({ page_id: "intro" });
    expect(await named(alice, "friday")).toMatchObject({ page_id: "gate" });
  });

  it("is no page when the words are only in the mockup's own title", async () => {
    expect(await named(alice, "yard")).toEqual({ pages: 5 });
  });

  it("is the same for a reader on the whole canvas", async () => {
    expect(await named(rita, "rota")).toEqual({ page_id: "rota", page_title: "Rota" });
    expect(await named(rita, "rota monday")).toEqual({ page_id: "intro", page_title: "Introduction" });
  });

  it("quotes that page, not another, and what it says ahead of the title that names it", async () => {
    const hit = async (words: string) => (await alice.api("GET", `${S}/search?mode=plain&strict=true&query=${encodeURIComponent(words)}`)).body.results.find((x: { id: string }) => x.id === mockupId);
    const titled = await hit("rota");
    expect(titled.snippet).toBe("Rota");
    expect((await hit("vans")).snippet).toBe("Each of the vans is loaded at seven.");
  });

  describe("with a Story page standing in for one of its pages", () => {
    const hitOf = async (words: string, id: string) =>
      (await alice.api("GET", `${S}/search?mode=plain&strict=true&query=${encodeURIComponent(words)}`)).body.results.filter((x: { id: string }) => x.id === id) as { id: string; kind: string; score: number; snippet: string | null; meta: { page_id?: string; page_title?: string } }[];
    let titledId: string;
    let briefId: string;

    beforeAll(async () => {
      const titled = await alice.api("POST", `${S}/mockups`, {
        title: "Plain board",
        pages: [
          { page_id: "intro", title: "Introduction", html: page("zebraword is agreed on Monday.") },
          { page_id: "zebraword", title: "Zebraword", html: page("Nothing about it here.") },
        ],
      });
      titledId = titled.body.mockup_id;
      expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: titledId, mockup_page_id: "intro", page_id: "zebra-story", title: "Zebraword" })).status).toBe(201);
      const inBrief = await alice.api("POST", `${S}/mockups`, {
        title: "Other board",
        brief: "This is about quokkaword, on no page.",
        pages: [
          { page_id: "first", title: "First", html: page("Nothing here.") },
          { page_id: "shown", title: "Shown", html: page("Nothing here either.") },
        ],
      });
      briefId = inBrief.body.mockup_id;
      expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: briefId, mockup_page_id: "shown", page_id: "quokka-story", title: "Quokkaword" })).status).toBe(201);
    });

    it("names the mockup's own page for the words, quotes that page, and takes the Story page's score", async () => {
      const [hit, ...rest] = await hitOf("zebraword", titledId);
      expect(rest).toEqual([]);
      expect(hit!.meta).toMatchObject({ page_id: "zebraword", page_title: "Zebraword" });
      expect(hit!.snippet).toBe("Zebraword");
      expect((await hitOf("zebraword", "zebra-story"))).toEqual([]);
      const alone = await alice.api("GET", `${S}/search?mode=plain&strict=true&kind=story&query=zebraword`);
      expect(hit!.score).toBe(alone.body.results.find((x: { id: string }) => x.id === "zebra-story").score);
    });

    it("names the page it shows when no page of the mockup says the words, beside the mockup's own excerpt", async () => {
      const [hit] = await hitOf("quokkaword", briefId);
      expect(hit!.meta).toMatchObject({ page_id: "shown", page_title: "Shown" });
      expect(hit!.snippet).toContain("about quokkaword, on no page.");
    });
  });

  describe("when the mockup's own summary or brief says the words too", () => {
    type Result = { id: string; kind: string; score: number; snippet: string | null; meta: { page_id?: string; page_title?: string; pages?: number } };
    const hitFor = async (b: Browser, words: string, id: string) => {
      const r = await b.api("GET", `${S}/search?mode=plain&strict=true&query=${encodeURIComponent(words)}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body.results as Result[]).find((x) => x.id === id);
    };
    const twoPages = (later: string) => [
      { page_id: "first", title: "First", html: page("Nothing to see.") },
      { page_id: "later", title: "Later", html: page(later) },
    ];
    const publish = async (fields: Record<string, unknown>) => {
      const r = await alice.api("POST", `${S}/mockups`, { title: "A board", ...fields });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.mockup_id as string;
    };

    it("names the later page that says a word the brief says too, and quotes that page", async () => {
      const id = await publish({ brief: "About the bilbyword.", pages: twoPages("The bilbyword runs.") });
      const hit = await hitFor(alice, "bilbyword", id);
      expect(hit!.meta).toEqual({ page_id: "later", page_title: "Later", pages: 2 });
      expect(hit!.snippet).toBe("The bilbyword runs.");
    });

    it("names the later page that says a word the summary says too, and quotes the summary, which says as many", async () => {
      const id = await publish({ summary: "About the dingoword.", pages: twoPages("The dingoword runs.") });
      const hit = await hitFor(alice, "dingoword", id);
      expect(hit!.meta).toEqual({ page_id: "later", page_title: "Later", pages: 2 });
      expect(hit!.snippet).toBe("About the dingoword.");
    });

    it("quotes the page it names, not a brief that holds more of the words", async () => {
      const id = await publish({ brief: "The emuword and the kiwiword.", pages: twoPages("The kiwiword runs.") });
      const hit = await hitFor(alice, "emuword kiwiword", id);
      expect(hit!.meta).toMatchObject({ page_id: "later" });
      expect(hit!.snippet).toBe("The kiwiword runs.");
    });

    it("names the page saying the most of the words, whichever the summary or brief says", async () => {
      const id = await publish({ brief: "The ibisword.", pages: [{ page_id: "first", title: "First", html: page("The ibisword runs.") }, { page_id: "later", title: "Later", html: page("The ibisword and the koalaword run.") }] });
      expect((await hitFor(alice, "ibisword koalaword", id))!.meta).toMatchObject({ page_id: "later" });
    });

    it("quotes the brief and names no page when no page says any of the words", async () => {
      const id = await publish({ brief: "About the numbatword.", pages: twoPages("Nothing here either.") });
      const hit = await hitFor(alice, "numbatword", id);
      expect(hit!.meta).toEqual({ pages: 2 });
      expect(hit!.snippet).toBe("About the numbatword.");
    });

    it("does not let a Story page standing in name its own page when a current page says the word", async () => {
      const id = await publish({ brief: "About the possumword.", pages: twoPages("The possumword runs.") });
      expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: id, mockup_page_id: "first", page_id: "possum-story", title: "Possumword" })).status).toBe(201);
      const hit = await hitFor(alice, "possumword", id);
      expect(hit!.meta).toMatchObject({ page_id: "later", page_title: "Later" });
      expect(hit!.snippet).toBe("The possumword runs.");
      expect(await hitFor(alice, "possumword", "possum-story")).toBeUndefined();
    });

    it("names, for a reader of a whole canvas, the later page saying a word the Story page's summary says too", async () => {
      const id = await publish({ pages: twoPages("The wombatword runs.") });
      expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: id, page_id: "wombat-canvas", summary: "About the wombatword." })).status).toBe(201);
      const hit = await hitFor(rita, "wombatword", "wombat-canvas");
      expect(hit!.meta).toEqual({ page_id: "later", page_title: "Later" });
      expect(hit!.snippet).toBe("About the wombatword.");
    });

    it("names no page, for a reader of a whole canvas, when only the Story page's summary says the word", async () => {
      const id = await publish({ pages: twoPages("Nothing here.") });
      expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: id, page_id: "quoll-canvas", summary: "About the quollword." })).status).toBe(201);
      const hit = await hitFor(rita, "quollword", "quoll-canvas");
      expect(hit!.meta).toEqual({});
      expect(hit!.snippet).toBe("About the quollword.");
    });
  });

  describe("once the mockup's current version has moved on from the page a Story page shows", () => {
    type Result = { id: string; kind: string; snippet: string | null; meta: { page_id?: string; page_title?: string; pages?: number } };
    const results = async (b: Browser, words: string, extra = "") => {
      const r = await b.api("GET", `${S}/search?mode=plain&strict=true&query=${encodeURIComponent(words)}${extra}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.results as Result[];
    };
    const publishTwice = async (brief: string, firstWords: string) => {
      const v1 = await alice.api("POST", `${S}/mockups`, {
        title: "A moving board",
        pages: [
          { page_id: "gone", title: "Gone", html: page(firstWords) },
          { page_id: "stays", title: "Stays", html: page("Nothing to see.") },
        ],
      });
      expect(v1.status, JSON.stringify(v1.body)).toBe(201);
      return {
        id: v1.body.mockup_id as string,
        move: async () => {
          const m = await alice.api("GET", `${S}/mockups/${v1.body.mockup_id}`);
          const v2 = await alice.api("POST", `${S}/mockups`, { mockup_id: v1.body.mockup_id, expected_etag: m.body.etag, brief, pages: [{ page_id: "stays", title: "Stays renamed" }] });
          expect(v2.status, JSON.stringify(v2.body)).toBe(201);
        },
      };
    };

    it("names no page when the page it shows is gone from the current version, and the word is only in the brief", async () => {
      const { id, move } = await publishTwice("About the hakeaword.", "Nothing to see.");
      expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: id, mockup_page_id: "gone", page_id: "hakea-story", title: "Hakeaword" })).status).toBe(201);
      await move();
      const [hit, ...rest] = (await results(alice, "hakeaword")).filter((x) => x.id === id || x.id === "hakea-story");
      expect(rest).toEqual([]);
      expect(hit).toMatchObject({ kind: "mockup", id, snippet: "About the hakeaword." });
      expect(hit!.meta).toEqual({ pages: 1 });
      // Nothing of the brief reaches someone who reads the Story alone.
      expect(await results(rita, "hakeaword")).toEqual([expect.objectContaining({ id: "hakea-story", meta: {} })]);
    });

    it("names the page it shows by its current title when the current version still has it", async () => {
      const { id, move } = await publishTwice("About the banksiaword.", "Nothing to see.");
      expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: id, mockup_page_id: "stays", page_id: "banksia-story", title: "Banksiaword" })).status).toBe(201);
      await move();
      const hit = (await results(alice, "banksiaword")).find((x) => x.id === id);
      expect(hit!.meta).toEqual({ pages: 1, page_id: "stays", page_title: "Stays renamed" });
    });

    it("keeps naming for a reader the page of the version their Story page stays on, which is the one they see", async () => {
      const { id, move } = await publishTwice("About the waratahword.", "The grevilleaword runs.");
      expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: id, page_id: "moving-canvas" })).status).toBe(201);
      await move();
      expect(await results(rita, "grevilleaword")).toEqual([expect.objectContaining({ kind: "story", id: "moving-canvas", snippet: "The grevilleaword runs.", meta: { page_id: "gone", page_title: "Gone" } })]);
      // Whoever may read the mockup is told the same about the Story page, since the mockup no longer says it.
      expect((await results(alice, "grevilleaword")).map((x) => [x.kind, x.id, x.meta])).toEqual([["story", "moving-canvas", { page_id: "gone", page_title: "Gone" }]]);
      // And the reader is told nothing from the version they do not see.
      expect(await results(rita, "waratahword")).toEqual([]);
    });
  });

  it("does not change how the result scores: by the page that scores highest", async () => {
    const r = await alice.api("GET", `${S}/search?mode=plain&strict=true&query=rota`);
    const hit = r.body.results.find((x: { id: string }) => x.id === mockupId);
    // The first page says it twice over and the third is titled with it, each a body to the mockup.
    expect(hit.meta.page_id).toBe("rota");
    expect(hit.score).toBe(108);
  });
});

describe("searching for what a Story page shows of a mockup", () => {
  let S: string;
  let oneId: string;
  let boardId: string;
  type Hit = { kind: string; id: string; meta: { page_id?: string; page_title?: string } };
  const find = async (b: Browser, words: string, extra = "") => {
    const r = await b.api("GET", `${S}/search?mode=plain&query=${encodeURIComponent(words)}${extra}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as { results: Hit[]; corrections: { from: string; to: string }[] };
  };
  const kinds = async (b: Browser, words: string, extra = "") => (await find(b, words, extra)).results.map((x) => `${x.kind}:${x.id}`);

  beforeAll(async () => {
    const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Findable" });
    S = `/api/v1/p/${p.body.path}`;
    for (const [email, role] of [["vic@example.com", "viewer"], ["rita@example.com", "reader"]])
      expect((await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "findable", email, role })).status).toBe(201);
    const one = await alice.api("POST", `${S}/mockups`, {
      title: "Harbour walk",
      brief: "Only the team reads briefword.",
      pages: [
        { page_id: "alpha", title: "Alpha screen", notes: "Only the team reads notesword.", html: page("alphaword") },
        { page_id: "unshown", title: "Unshown screen", html: page("unshownword") },
      ],
    });
    oneId = one.body.mockup_id;
    const board = await alice.api("POST", `${S}/mockups`, {
      title: "Quay board",
      pages: [
        { page_id: "gamma", title: "Gamma screen", html: page("gammaword") },
        { page_id: "delta", title: "Delta screen", html: page("deltaword") },
      ],
    });
    boardId = board.body.mockup_id;
    expect((await alice.api("POST", `${S}/story/pages/overview/versions`, { title: "Overview", html: page("overviewword") })).status).toBe(201);
    expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: oneId, mockup_page_id: "alpha", page_id: "alpha-page", title: "Stakeholder preview" })).status).toBe(201);
    expect((await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: boardId, page_id: "whole-board" })).status).toBe(201);
    expect((await alice.api("POST", `${S}/outcomes`, { title: "Reach outcomeword" })).status).toBeLessThan(300);
    expect((await alice.api("POST", `${S}/assumptions`, { statement: "Crews want assumptionword." })).status).toBeLessThan(300);
  });

  it("lists a page from a mockup once, as the mockup, for whoever may read the mockup", async () => {
    expect(await kinds(alice, "alphaword")).toEqual([`mockup:${oneId}`]);
    expect(await kinds(alice, "gammaword")).toEqual([`mockup:${boardId}`]);
    // The promoted pages' summaries name their mockups, which alone would list each one again.
    expect(await kinds(alice, "harbour")).toEqual([`mockup:${oneId}`]);
    expect(await kinds(alice, "quay")).toEqual([`mockup:${boardId}`]);
    expect(await kinds(vic, "alphaword")).toEqual([`mockup:${oneId}`]);
  });

  it("ranks and opens the mockup as the page it stands in for would have", async () => {
    const promoted = await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: oneId, mockup_page_id: "unshown", page_id: "beacon", title: "Beacon" });
    expect(promoted.status).toBe(201);
    // Harbour walk's first page says the word in its text; the page promoted as Beacon is titled with it.
    const m = await alice.api("GET", `${S}/mockups/${oneId}`);
    const next = await alice.api("POST", `${S}/mockups`, { mockup_id: oneId, expected_etag: m.body.etag, pages: [{ page_id: "alpha", title: "Alpha screen", html: page("alphaword and Unshown words") }, { page_id: "unshown", title: "Unshown screen", html: page("unshownword") }] });
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    const hit = (await find(alice, "unshown screen")).results.find((x) => x.kind === "mockup");
    expect(hit?.meta.page_id).toBe("unshown");
    const now = await alice.api("GET", `${S}/story/pages/beacon?include_html=false`);
    expect((await alice.api("DELETE", `${S}/story/pages/beacon`, { expected_etag: now.body.etag, reason: "Only for this test", confirm: "delete permanently" })).status).toBe(200);
  });

  it("still lists a Story page of its own, and one that holds a word its mockup does not", async () => {
    expect(await kinds(alice, "overviewword")).toEqual(["story:overview"]);
    expect(await kinds(alice, "stakeholder")).toEqual(["story:alpha-page"]);
  });

  it("gives a page from a mockup to whoever asks for the Story alone", async () => {
    expect(await kinds(alice, "alphaword", "&kind=story")).toEqual(["story:alpha-page"]);
    expect(await kinds(alice, "gammaword", "&kind=story")).toEqual(["story:whole-board"]);
  });

  it("finds a Story page by what it stays on, once the mockup has moved on, and when the mockup is archived", async () => {
    const m = await alice.api("GET", `${S}/mockups/${boardId}`);
    const next = await alice.api("POST", `${S}/mockups`, { mockup_id: boardId, expected_etag: m.body.etag, pages: [{ page_id: "gamma", title: "Gamma screen", html: page("rewritten") }, { page_id: "delta" }] });
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(await kinds(alice, "gammaword")).toEqual(["story:whole-board"]);
    expect(await kinds(alice, "rewritten")).toEqual([`mockup:${boardId}`]);
    const o = await alice.api("GET", `${S}/mockups/${oneId}`);
    const gone = await alice.api("POST", `${S}/mockups/${oneId}/archive`, { expected_etag: o.body.etag });
    expect(gone.status).toBe(200);
    expect(await kinds(alice, "alphaword")).toEqual(["story:alpha-page"]);
    expect((await alice.api("POST", `${S}/mockups/${oneId}/restore`, { expected_etag: gone.body.etag })).status).toBe(200);
  });

  it("lets a reader search the Story alone: every page by what it shows, and a canvas's page by its words", async () => {
    expect(await kinds(rita, "overviewword")).toEqual(["story:overview"]);
    expect(await kinds(rita, "alphaword")).toEqual(["story:alpha-page"]);
    const onCanvas = await find(rita, "deltaword");
    expect(onCanvas.results.map((x) => [x.kind, x.id, x.meta])).toEqual([["story", "whole-board", { page_id: "delta", page_title: "Delta screen" }]]);
    expect(await kinds(rita, "gamma")).toEqual(["story:whole-board"]);
    // The canvas's title opens the board, on no page of it.
    expect((await find(rita, "quay")).results[0]?.meta).toEqual({});
  });

  it("gives a reader a mockup page once when a canvas holds it too, unless another page of the canvas holds the words", async () => {
    const promoted = await alice.api("POST", `${S}/story/promote-mockup`, { mockup_id: boardId, mockup_page_id: "delta", version: 1, page_id: "delta-alone", title: "Delta alone" });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(201);
    expect(await kinds(rita, "deltaword")).toEqual(["story:delta-alone"]);
    expect((await find(rita, "gammaword")).results.map((x) => [x.id, x.meta.page_id])).toEqual([["whole-board", "gamma"]]);
    const now = await alice.api("GET", `${S}/story/pages/delta-alone?include_html=false`);
    expect((await alice.api("DELETE", `${S}/story/pages/delta-alone`, { expected_etag: now.body.etag, reason: "Only for this test", confirm: "delete permanently" })).status).toBe(200);
    expect(await kinds(rita, "deltaword")).toEqual(["story:whole-board"]);
  });

  it("gives a reader nothing else of the product, in results or in the words it offers back", async () => {
    for (const word of ["briefword", "notesword", "unshownword", "outcomeword", "assumptionword"]) {
      const got = await find(rita, word);
      expect(got.results, word).toEqual([]);
      expect(got.corrections, word).toEqual([]);
    }
    // One letter away from words only the team holds, as a typo would be.
    for (const word of ["outcomewors", "assumptionwors", "briefwors", "harbous"]) expect((await find(rita, word)).corrections, word).toEqual([]);
    expect((await find(rita, "overvieu ")).corrections).toEqual([{ from: "overvieu", to: "overview" }]);
  });

  it("refuses a reader every other search", async () => {
    for (const q of ["query=alpha", "query=alpha&mode=ranked", "query=alpha&mode=plain&kind=mockup", "query=alpha&mode=plain&kind=source", "query=alpha&mode=plain&record_id=01ARZ3NDEKTSV4RRFFQ69G5FAV"]) {
      const r = await rita.api("GET", `${S}/search?${q}`);
      expect(r.status, q).toBe(403);
      expect(r.body.error.details.role, q).toBe("reader");
    }
    expect((await rita.api("GET", `${S}/search?mode=plain&query=alpha&kind=story`)).status).toBe(200);
  });

  it("leaves an archived page out of a reader's search", async () => {
    const now = await alice.api("GET", `${S}/story/pages/whole-board?include_html=false`);
    expect((await alice.api("POST", `${S}/story/pages/whole-board/archive`, { expected_etag: now.body.etag })).status).toBe(200);
    expect(await kinds(rita, "deltaword")).toEqual([]);
  });
});

describe("pages from a mockup in the Story's tree", () => {
  let Q: string;
  let mockupId: string;
  const ids = (items: { page_id: string }[]) => items.map((x) => x.page_id);
  const tree = async () => (await alice.api("GET", `${Q}/story/hierarchy`)).body;
  const etagOf = async (page: string) => (await alice.api("GET", `${Q}/story/pages/${page}?include_html=false`)).body.etag as string;

  beforeAll(async () => {
    const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Flipbook" });
    Q = `/api/v1/p/${p.body.path}`;
    const m = await alice.api("POST", `${Q}/mockups`, {
      title: "Directions",
      pages: ["p1", "p2", "p3"].map((id) => ({ page_id: id, title: id.toUpperCase(), html: page(id) })),
    });
    mockupId = m.body.mockup_id;
    expect((await alice.api("POST", `${Q}/story/pages/overview/versions`, { title: "Overview", html: page("Overview") })).status).toBe(201);
  });

  it("leaves a promoted page unplaced, at the end of the tree, and says what kind of page it is", async () => {
    for (const id of ["p1", "p2", "p3"]) {
      const r = await alice.api("POST", `${Q}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: id });
      expect(r.status).toBe(201);
      expect(r.body.placed).toBe(false);
    }
    const h = await tree();
    expect(ids(h.items)).toEqual([]);
    expect(ids(h.unplaced)).toEqual(["overview", "p1", "p2", "p3"]);
    expect(h.unplaced[0].kind).toBe("story_page");
    expect(h.unplaced[1]).toEqual({ page_id: "p1", title: "P1", description: expect.stringContaining("Directions"), kind: "mockup_page" });
  });

  it("places and nests a page from a mockup like any other, and sends the tree back as it read it", async () => {
    const set = await alice.api("PUT", `${Q}/story/hierarchy`, {
      items: [{ page_id: "p3", children: [{ page_id: "overview", children: [{ page_id: "p1", children: [] }] }] }],
      expected_etag: (await tree()).etag,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(ids(set.body.items)).toEqual(["p3"]);
    expect(set.body.items[0].kind).toBe("mockup_page");
    expect(set.body.items[0].children[0]).toMatchObject({ page_id: "overview", kind: "story_page", children: [{ page_id: "p1", kind: "mockup_page" }] });
    expect(ids(set.body.unplaced)).toEqual(["p2"]);
    const again = await alice.api("PUT", `${Q}/story/hierarchy`, { items: set.body.items, expected_etag: set.body.etag });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.items).toEqual(set.body.items);
  });

  it("refuses a page twice, and a separate list of mockups, which is gone", async () => {
    const etag = (await tree()).etag;
    const twice = await alice.api("PUT", `${Q}/story/hierarchy`, { items: [{ page_id: "p1", children: [] }, { page_id: "p1", children: [] }], expected_etag: etag });
    expect(twice.status).toBe(422);
    expect(twice.body.error.message).toMatch(/"p1" appears more than once/);
    const old = await alice.api("PUT", `${Q}/story/hierarchy`, { items: [], mockups: ["p1"], expected_etag: etag });
    expect(old.status).toBe(422);
    expect((await vic.api("PUT", `${Q}/story/hierarchy`, { items: [], expected_etag: etag })).status).toBe(404);
  });

  it("keeps a placed page where it stands when it comes to show a mockup page, and when it gets HTML of its own again", async () => {
    const promoted = await alice.api("POST", `${Q}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "p2", page_id: "overview", expected_etag: await etagOf("overview") });
    expect(promoted.status).toBe(201);
    expect(promoted.body.placed).toBe(true);
    let h = await tree();
    expect(h.items[0].children[0]).toMatchObject({ page_id: "overview", kind: "mockup_page" });
    const own = await alice.api("POST", `${Q}/story/pages/overview/versions`, { html: page("Overview again"), expected_etag: promoted.body.etag });
    expect(own.status).toBe(201);
    h = await tree();
    expect(h.items[0].children[0]).toMatchObject({ page_id: "overview", kind: "story_page" });
  });

  it("prints in the Story's order, and drops an archived page from the order it was given", async () => {
    const plan = await alice.api("GET", `${Q}/story/print-view?page_ids=p1,p2,overview,p3`);
    expect(ids(plan.body.pages)).toEqual(["p3", "overview", "p1", "p2"]);
    expect((await alice.api("POST", `${Q}/story/pages/p1/archive`, { expected_etag: await etagOf("p1") })).status).toBe(200);
    expect(ids((await tree()).items[0].children[0].children)).toEqual([]);
    expect((await alice.api("POST", `${Q}/story/pages/p1/restore`, { expected_etag: await etagOf("p1") })).status).toBe(200);
    expect(ids((await tree()).unplaced)).toEqual(["p1", "p2"]);
  });

  describe("a whole canvas on the Story", () => {
    let canvas: { etag: string; page_id: string; current: { mockup: Record<string, unknown> } };

    it("takes one Story page, however many pages the canvas has, and points at one mockup version", async () => {
      const before = (await alice.api("GET", Q)).body.counts.story_pages;
      const r = await alice.api("POST", `${Q}/story/promote-mockup`, { mockup_id: mockupId });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      canvas = r.body;
      expect(r.body.title).toBe("Directions");
      expect(r.body.page_id).toBe("directions");
      expect(r.body.placed).toBe(false);
      expect(r.body.current.mockup).toMatchObject({ canvas: true, mockup_id: mockupId, page_id: null });
      expect(r.body.current.mockup.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["p1", "p2", "p3"]);
      expect((await alice.api("GET", Q)).body.counts.story_pages).toBe(before + 1);
      expect((await tree()).unplaced.find((u: { page_id: string }) => u.page_id === r.body.page_id).kind).toBe("canvas");
      const m = await alice.api("GET", `${Q}/mockups/${mockupId}`);
      expect(m.body.story_pages.find((p: { page_id: string }) => p.page_id === r.body.page_id)).toMatchObject({ mockup_page_id: null });
    });

    it("gives a reader what the canvas draws and each page's HTML, and nothing else of the mockup", async () => {
      expect((await alice.api("POST", `/api/v1/tenants/${tenantSlug}/members`, { team: teamSlug, product: "flipbook", email: "rita@example.com", role: "reader" })).status).toBe(201);
      const read = await rita.api("GET", `${Q}/story/pages/${canvas.page_id}?include_html=false`);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      const m = read.body.current.mockup;
      expect(m.canvas).toBe(true);
      expect(m.pages.map((p: { page_id: string }) => Object.keys(p).sort())).toEqual([["height", "page_id", "title", "width"], ["height", "page_id", "title", "width"], ["height", "page_id", "title", "width"]]);
      for (const secret of ["mockup_id", "mockup_title", "brief", "notes", "files", "current_version"]) expect(m).not.toHaveProperty(secret);
      const shown = await raw(rita, `${Q}/story/pages/${canvas.page_id}/versions/1/pages/p2/html`);
      expect(shown.status).toBe(200);
      expect(await shown.text()).toContain("<h1>p2</h1>");
      expect(shown.headers.get("content-security-policy")).toContain("form-action 'none'");
      // Only this canvas's pages, through this Story page: never the mockup's own routes.
      expect((await raw(rita, `${Q}/story/pages/${canvas.page_id}/versions/1/pages/nope/html`)).status).toBe(404);
      expect((await raw(rita, `${Q}/mockups/${mockupId}/versions/1/pages/p2/html`)).status).toBe(403);
      expect((await rita.api("GET", `${Q}/mockups/${mockupId}`)).status).toBe(403);
    });

    it("finds no canvas page through a Story page that shows one page, or none", async () => {
      expect((await raw(alice, `${Q}/story/pages/p2/versions/1/pages/p1/html`)).status).toBe(404);
      const own = await alice.api("POST", `${Q}/story/pages/plain/versions`, { title: "Plain", html: page("Plain") });
      expect(own.status).toBe(201);
      expect((await raw(alice, `${Q}/story/pages/plain/versions/1/pages/p1/html`)).status).toBe(404);
    });

    it("stays on its mockup version until it is promoted again, and a reader follows only that", async () => {
      const m = await alice.api("GET", `${Q}/mockups/${mockupId}`);
      const next = await alice.api("POST", `${Q}/mockups`, { mockup_id: mockupId, expected_etag: m.body.etag, pages: [{ page_id: "p1" }, { page_id: "added", title: "Added", html: page("Added") }] });
      expect(next.status, JSON.stringify(next.body)).toBe(201);
      const still = await alice.api("GET", `${Q}/story/pages/${canvas.page_id}?include_html=false`);
      expect(still.body.current.mockup.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["p1", "p2", "p3"]);
      expect((await raw(rita, `${Q}/story/pages/${canvas.page_id}/versions/1/pages/added/html`)).status).toBe(404);
      const moved = await alice.api("POST", `${Q}/story/promote-mockup`, { mockup_id: mockupId, page_id: canvas.page_id, expected_etag: still.body.etag });
      expect(moved.status).toBe(201);
      expect(moved.body.current.mockup.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["p1", "added"]);
      expect((await raw(rita, `${Q}/story/pages/${canvas.page_id}/versions/2/pages/added/html`)).status).toBe(200);
      // A later version without html keeps showing the canvas, and versions tell its mockup versions apart.
      const kept = await alice.api("POST", `${Q}/story/pages/${canvas.page_id}/versions`, { title: "Renamed canvas", expected_etag: moved.body.etag });
      expect(kept.status).toBe(201);
      expect(kept.body.current.mockup.canvas).toBe(true);
      const versions = (await alice.api("GET", `${Q}/story/pages/${canvas.page_id}/versions`)).body.items;
      expect(versions[0].html_sha256).toBe(versions[1].html_sha256);
      expect(versions[1].html_sha256).not.toBe(versions[2].html_sha256);
      expect(kept.body.current.html_sha256).toBe(versions[0].html_sha256);
    });

    it("hides an archived canvas from a reader, page by page too", async () => {
      const now = await alice.api("GET", `${Q}/story/pages/${canvas.page_id}?include_html=false`);
      expect((await alice.api("POST", `${Q}/story/pages/${canvas.page_id}/archive`, { expected_etag: now.body.etag })).status).toBe(200);
      expect((await raw(rita, `${Q}/story/pages/${canvas.page_id}/versions/1/pages/p2/html`)).status).toBe(404);
      expect((await raw(alice, `${Q}/story/pages/${canvas.page_id}/versions/1/pages/p2/html`)).status).toBe(200);
      const back = await alice.api("GET", `${Q}/story/pages/${canvas.page_id}?include_html=false`);
      expect((await alice.api("POST", `${Q}/story/pages/${canvas.page_id}/restore`, { expected_etag: back.body.etag })).status).toBe(200);
    });

    it("prints page by page under the canvas's heading", async () => {
      const plan = await alice.api("GET", `${Q}/story/print-view?page_ids=${canvas.page_id}`);
      expect(plan.status).toBe(200);
      expect(plan.body.pages[0].canvas_pages.map((p: { page_id: string }) => p.page_id)).toEqual(["p1", "added"]);
      const doc = await raw(alice, `${Q}/story/print?page_ids=${canvas.page_id}`);
      const html = await doc.text();
      expect(html).toContain(`id="page-${canvas.page_id}.added"`);
      expect(html).toContain("Added");
      expect(html).toContain(`data-print-frame="1280" style="width:1280px;min-height:800px;--print-fit:0.5250"><div data-print-page="${canvas.page_id}.added"`);
    });

    it("holds the mockup back from deletion while it shows it", async () => {
      const impact = await alice.api("GET", `${Q}/mockups/${mockupId}/delete-impact`);
      expect(impact.body.story_pages_showing.some((p: { page_id: string; mockup_page_id: string | null }) => p.page_id === canvas.page_id && p.mockup_page_id === null)).toBe(true);
    });
  });
});

describe("files a mockup version carries", () => {
  let mockupId: string;
  let etag: string;

  it("stores text files beside the pages, lists them without content, and gives the content when asked", async () => {
    const m = await alice.api("POST", `${P}/mockups`, {
      title: "Ledger",
      pages: [{ page_id: "list", title: "List", html: page("List") }],
      files: [
        { path: "DESIGN.md", content: "# Ledger\n\nDense tables, one accent." },
        { path: "components/row.html", content: '<tr class="row"><td>…</td></tr>' },
      ],
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    mockupId = m.body.mockup_id;
    etag = m.body.etag;
    const created = await canvasOf(P, mockupId);
    expect(created.files).toEqual([
      expect.objectContaining({ path: "DESIGN.md", chars: 35 }),
      expect.objectContaining({ path: "components/row.html" }),
    ]);
    expect(created.files[0].content).toBeUndefined();
    const full = await alice.api("GET", `${P}/mockups/${mockupId}?include_files=true`);
    expect(full.body.current.files[0].content).toBe("# Ledger\n\nDense tables, one accent.");
    const activity = await alice.api("GET", `${P}/activity?entity_type=mockup&entity_id=${mockupId}`);
    expect(activity.body.items[0].summary).toBe("Created the mockup with 1 page and 2 files");
  });

  it("carries files forward, changes one by path, drops one left out, and adds a new one", async () => {
    const kept = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, brief: "Now with a brief." });
    etag = kept.body.etag;
    expect((await canvasOf(P, mockupId)).files.map((x: { path: string }) => x.path)).toEqual(["DESIGN.md", "components/row.html"]);
    const changed = await alice.api("POST", `${P}/mockups`, {
      mockup_id: mockupId,
      expected_etag: etag,
      files: [{ path: "DESIGN.md", content: "# Ledger\n\nTwo accents." }, { path: "tokens.css", content: ":root{--accent:#123456}" }],
    });
    expect(changed.status).toBe(201);
    etag = changed.body.etag;
    const v3 = await alice.api("GET", `${P}/mockups/${mockupId}/versions/3?include_files=true`);
    expect(v3.body.files.map((x: { path: string; content: string }) => [x.path, x.content])).toEqual([
      ["DESIGN.md", "# Ledger\n\nTwo accents."],
      ["tokens.css", ":root{--accent:#123456}"],
    ]);
    const v1 = await alice.api("GET", `${P}/mockups/${mockupId}/versions/1?include_files=true`);
    expect(v1.body.files[0].content).toBe("# Ledger\n\nDense tables, one accent.");
    const list = await alice.api("GET", `${P}/mockups/${mockupId}/versions`);
    expect(list.body.items.map((x: { version: number; file_count: number }) => [x.version, x.file_count])).toEqual([[3, 2], [2, 2], [1, 2]]);
  });

  it("refuses a new path without content, paths that climb out or differ only in case, and too much text", async () => {
    const bad = async (files: unknown) => alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, files });
    const nocontent = await bad([{ path: "notes/new.md" }]);
    expect(nocontent.status).toBe(422);
    expect(nocontent.body.error.details.problems).toEqual(["File notes/new.md is new and needs content."]);
    expect((await bad([{ path: "../escape.md", content: "x" }])).status).toBe(422);
    expect((await bad([{ path: "/abs.md", content: "x" }])).status).toBe(422);
    const twice = await bad([{ path: "design.md", content: "a" }, { path: "DESIGN.md" }]);
    expect(twice.status).toBe(422);
    expect(twice.body.error.message).toMatch(/different capitals/);
    const big = await bad([{ path: "a.txt", content: "x".repeat(1_500_000) }, { path: "b.txt", content: "x".repeat(600_000) }]);
    expect(big.status).toBe(422);
  });

  it("puts the files in the download under files/, and in the product export", async () => {
    const g = await alice.api("POST", `${P}/mockups/${mockupId}/downloads`, {});
    const zip = unzipSync(new Uint8Array(await (await fetch(g.body.url, { headers: g.body.headers })).arrayBuffer()));
    expect(strFromU8(zip["files/DESIGN.md"]!)).toBe("# Ledger\n\nTwo accents.");
    expect(strFromU8(zip["files/tokens.css"]!)).toBe(":root{--accent:#123456}");
    expect(JSON.parse(strFromU8(zip["manifest.json"]!)).files).toEqual([
      expect.objectContaining({ path: "DESIGN.md", file: "files/DESIGN.md" }),
      expect.objectContaining({ path: "tokens.css", file: "files/tokens.css" }),
    ]);
    expect((await alice.api("POST", `${P}/exports`, {})).status).toBe(201);
    await h.worker.drain();
    const ex = (await alice.api("GET", `${P}/exports`)).body.items[0];
    const bundle = unzipSync(new Uint8Array(await (await fetch(ex.download.url, { headers: ex.download.headers })).arrayBuffer()));
    expect(strFromU8(bundle[`mockups/${mockupId}/v1/files/components/row.html`]!)).toContain('class="row"');
  });
});

describe("publishing a canvas uploaded as a ZIP", () => {
  let mockupId: string;
  let etag: string;

  async function upload(b: Browser, zip: Record<string, string>) {
    const g = await b.api("POST", `${P}/mockups/uploads`, {});
    expect(g.status).toBe(201);
    const bytes = zipSync(Object.fromEntries(Object.entries(zip).map(([k, v]) => [k, strToU8(v)])));
    const put = await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: bytes });
    expect(put.status).toBe(201);
    return g.body.upload_id as string;
  }

  it("creates a mockup from a ZIP in the download's layout, inside one folder, title and pages from its manifest", async () => {
    const manifest = { title: "Upload board", summary: "Uploaded.", columns: 2, pages: [{ page_id: "board", title: "Board" }, { page_id: "phone", title: "Phone", width: 390, height: 844 }] };
    const uploadId = await upload(alice, {
      "canvas/manifest.json": JSON.stringify(manifest),
      "canvas/brief.md": "# Upload board\n\nDoes a board read at a glance?",
      "canvas/pages/board.html": page("Board"),
      "canvas/pages/board.notes.md": "Wide.",
      "canvas/pages/phone.html": page("Phone"),
      "canvas/files/DESIGN.md": "# Board",
    });
    const r = await alice.api("POST", `${P}/mockups`, { upload_id: uploadId });
    expect(r.status).toBe(201);
    mockupId = r.body.mockup_id;
    etag = r.body.etag;
    expect(r.body).toMatchObject({ title: "Upload board", current_version: 1, from_upload: uploadId, page_ids: ["board", "phone"] });
    const got = await alice.api("GET", `${P}/mockups/${mockupId}`);
    expect(got.body.summary).toBe("Uploaded.");
    expect(got.body.current).toMatchObject({ brief: "# Upload board\n\nDoes a board read at a glance?", columns: 2 });
    expect(got.body.current.pages).toEqual([
      expect.objectContaining({ page_id: "board", title: "Board", notes: "Wide.", width: 1280 }),
      expect.objectContaining({ page_id: "phone", title: "Phone", notes: "", width: 390, height: 844 }),
    ]);
    expect(got.body.current.files).toEqual([expect.objectContaining({ path: "DESIGN.md" })]);
    // Read once: the bytes go, and the upload can't make a second version.
    await h.worker.drain();
    const row = await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      return trx.selectFrom("mockup_uploads").selectAll().where("upload_id", "=", uploadId).executeTakeFirstOrThrow();
    });
    expect(row.used_at).not.toBeNull();
    expect(await h.blobs.stat(row.blob_key)).toBeNull();
    const again = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, upload_id: uploadId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("upload_used");
  });

  it("round-trips a download: changes one page, adds one, and carries forward what the ZIP leaves out", async () => {
    const g = await alice.api("POST", `${P}/mockups/${mockupId}/downloads`, {});
    const zip = unzipSync(new Uint8Array(await (await fetch(g.body.url, { headers: g.body.headers })).arrayBuffer()));
    const manifest = JSON.parse(strFromU8(zip["manifest.json"]!));
    manifest.pages.push({ page_id: "list", title: "List" });
    const uploadId = await upload(alice, {
      "manifest.json": JSON.stringify(manifest),
      "pages/board.html": page("Board, denser"),
      "pages/list.html": page("List"),
    });
    const r = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, upload_id: uploadId, summary: "From the call." });
    expect(r.status).toBe(201);
    etag = r.body.etag;
    expect(r.body).toMatchObject({ current_version: 2, based_on_version: 1, page_ids: ["board", "phone", "list"] });
    const got = await alice.api("GET", `${P}/mockups/${mockupId}`);
    expect(got.body.summary).toBe("From the call.");
    expect(got.body.current.brief).toBe("# Upload board\n\nDoes a board read at a glance?");
    expect(got.body.current.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["board", "phone", "list"]);
    expect(got.body.current.pages[0]).toMatchObject({ notes: "Wide." });
    expect(got.body.current.files).toEqual([expect.objectContaining({ path: "DESIGN.md" })]);
    const v = await alice.api("GET", `${P}/mockups/${mockupId}/versions/2?include_html=true`);
    expect(v.body.pages[0].html).toContain("Board, denser");
    expect(v.body.pages[1].html).toContain("Phone");
  });

  it("refuses what is not a canvas, every problem at once, and pages sent beside an upload", async () => {
    const bad = await upload(alice, {
      "manifest.json": JSON.stringify({ pages: [{ page_id: "board" }] }),
      "pages/board.html": page("Board"),
      "pages/ghost.html": page("Ghost"),
      "notes.txt": "stray",
    });
    const r = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, upload_id: bad });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("invalid_upload");
    expect(r.body.error.message).toMatch(/pages\/ghost\.html belongs to page ghost/);
    expect(r.body.error.message).toMatch(/notes\.txt is not part of a canvas/);
    const both = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, upload_id: bad, pages: [{ page_id: "board" }] });
    expect(both.status).toBe(422);
    expect(both.body.error.message).toMatch(/send pages in the ZIP or in the call/);
    // Bad HTML in a ZIP is refused as it is in a call.
    const remote = await upload(alice, { "manifest.json": JSON.stringify({ pages: [{ page_id: "board" }] }), "pages/board.html": page("Board").replace("</head>", '<link rel="stylesheet" href="https://example.com/x.css"></head>') });
    expect((await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, upload_id: remote })).status).toBe(422);

    const g = await alice.api("POST", `${P}/mockups/uploads`, {});
    expect((await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, upload_id: g.body.upload_id })).status).toBe(404);
    expect((await fetch(g.body.url, { method: "PUT", headers: { ...g.body.headers, "X-WhatBuild-Upload-Grant": "x.y" }, body: "x" })).status).toBe(401);
    expect((await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: "not a zip" })).status).toBe(201);
    const notZip = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: etag, upload_id: g.body.upload_id });
    expect(notZip.status).toBe(422);
    expect(notZip.body.error.code).toBe("invalid_upload");
    expect((await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: "again" })).status).toBe(409);
    const v = await alice.api("GET", `${P}/mockups/${mockupId}`);
    expect(v.body.current_version).toBe(2);
  });

  it("gives a viewer no upload grant, and keeps an upload to its product", async () => {
    expect((await vic.api("POST", `${P}/mockups/uploads`, {})).status).toBe(403);
    const other = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Elsewhere", concept: "Another product." });
    const uploadId = await upload(alice, { "manifest.json": JSON.stringify({ title: "X", pages: [{ page_id: "a", title: "A" }] }), "pages/a.html": page("A") });
    const r = await alice.api("POST", `/api/v1/p/${other.body.path}/mockups`, { upload_id: uploadId });
    expect(r.status).toBe(404);
  });
});

/** A working prototype: fifteen scripts of some 130,000 characters, event handlers and a form. */
const prototype = (() => {
  const script = (i: number) => `<script>/* step ${i} */ const state${i} = ${JSON.stringify({ rows: Array.from({ length: 360 }, (_, n) => `Row ${n} of the board`) })};</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Prototype</title><style>body{font:16px system-ui}</style></head><body>
<h1>Book a crew</h1>
<form id="book" action="https://example.com/collect" method="post"><label>Address <input name="address"></label><select name="crew"><option>North</option></select><textarea name="note"></textarea><button type="submit" onclick="window.picked = true">Book</button></form>
${Array.from({ length: 15 }, (_, i) => script(i)).join("\n")}
</body></html>`;
})();

describe("a page's rules, by the surface that shows it", () => {
  it("lets a mockup page be a working prototype: scripts of any number and length, and forms", () => {
    expect(prototype.length).toBeGreaterThan(120_000);
    expect(inspectMockupHtml(prototype)).toEqual([]);
    expect(MOCKUP_PAGE_RULES).toMatchObject({ surface: "mockup page", maxChars: 1_000_000, maxScripts: null, scriptBudget: null });
  });

  it("keeps a Story page's rules as they were, and says they are the Story's", () => {
    expect(STORY_PAGE_RULES).toMatchObject({ surface: "Story page", maxChars: 1_000_000, maxScripts: 10, scriptBudget: 32_000 });
    const problems = inspectStoryHtml(prototype);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toBe("<form> is not allowed in a Story page: a Story page is for reading, so it holds no forms.");
    expect(problems[1]).toBe("The Story page has 15 inline scripts; a Story page holds at most 10.");
    expect(problems[2]).toMatch(/^Inline scripts and event handlers total [\d,]+ characters; a Story page allows at most 32,000, since the Story is for reading; an interactive prototype belongs on a mockup's canvas/);
  });

  it("refuses in a mockup page what loads from elsewhere, frames, or redirects, naming the surface, the rule and the element", () => {
    const html = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://example.com/"><base href="https://example.com/"><link rel="stylesheet" href="https://example.com/a.css">
<style>@import url(https://example.com/b.css); .hero { background: url(https://example.com/hero.png); }</style>
<script src="https://example.com/app.js"></script></head><body>
<iframe src="https://example.com/embed"></iframe><embed src="data:text/plain,x"><object></object>
<img src="https://example.com/x.png"><div style="background: url('https://example.com/bg.png')">x</div>
</body></html>`;
    const problems = inspectMockupHtml(html);
    for (const p of problems) {
      expect(p, p).toContain("mockup page");
      expect(p, p).not.toMatch(/Story/);
    }
    expect(problems).toEqual(
      expect.arrayContaining([
        '<meta http-equiv="refresh"> is not allowed in a mockup page: no refresh, redirect or policy metadata.',
        "<base> is not allowed in a mockup page: it would change where the page's links and resources point.",
        "<link> is not allowed in a mockup page: it loads a resource from elsewhere; put CSS in a <style> block, and fonts and images in data: URIs.",
        "@import is not allowed in a mockup page's <style> block (@import url(https://example.com/b.css)): keep the page self-contained.",
        "A <style> block loads an external resource with url(https://example.com/b.css), which a mockup page may not: use data: URIs.",
        "<script src> is not allowed in a mockup page: scripts must be inline (this one loads https://example.com/app.js).",
        "<iframe> is not allowed in a mockup page: a page frames and embeds no other document.",
        '<iframe src="https://example.com/embed"> loads an external resource, which a mockup page may not: embed images, fonts and media as data: URIs.',
        "<embed> is not allowed in a mockup page: a page frames and embeds no other document.",
        "<object> is not allowed in a mockup page: a page frames and embeds no other document.",
        '<img src="https://example.com/x.png"> loads an external resource, which a mockup page may not: embed images, fonts and media as data: URIs.',
        "A style attribute on <div> loads an external resource with url('https://example.com/bg.png'), which a mockup page may not: use data: URIs.",
      ]),
    );
    // A frameset is a document of its own; its frames are named too.
    expect(inspectMockupHtml('<!doctype html><html><frameset><frame src="data:text/html,x"></frameset></html>')).toEqual([
      "<frameset> is not allowed in a mockup page: a page frames and embeds no other document.",
      "<frame> is not allowed in a mockup page: a page frames and embeds no other document.",
    ]);
    expect(inspectMockupHtml(`<!doctype html><p>${"x".repeat(1_000_000)}</p>`)[0]).toBe("The mockup page is 1,000,022 characters; a mockup page holds at most 1,000,000.");
    expect(inspectMockupHtml(`${"<div>".repeat(600)}x`)).toEqual(["The mockup page's HTML nests elements more than 512 deep."]);
  });
});

describe("a working prototype on a canvas", () => {
  let Q: string;
  let mockupId: string;

  beforeAll(async () => {
    const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Prototypes" });
    Q = `/api/v1/p/${p.body.path}`;
  });

  it("publishes pages with long scripts and forms", async () => {
    const r = await alice.api("POST", `${Q}/mockups`, { title: "Booking", pages: [{ page_id: "book", title: "Book a crew", html: prototype }] });
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(201);
    mockupId = r.body.mockup_id;
    expect((await canvasOf(Q, mockupId)).pages[0].html_chars).toBe(prototype.length);
  });

  it("serves the page, and the Story's view of it, in a sandbox where a submit handler runs and a submission goes nowhere", async () => {
    const policy = async (path: string) => {
      const res = await raw(alice, path);
      expect(res.status, path).toBe(200);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp, path).not.toContain("allow-same-origin");
      expect(csp, path).toContain("form-action 'none'");
      expect(csp, path).toContain("connect-src 'none'");
      return { csp, html: await res.text() };
    };
    const mockupSandbox = /^sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; /;
    for (const path of [`${Q}/mockups/${mockupId}/versions/1/pages/book/html`, `${Q}/mockups/${mockupId}/versions/1/pages/book/html?frame=1`]) {
      const { csp, html } = await policy(path);
      expect(csp, path).toMatch(mockupSandbox);
      expect(html).toContain('<form id="book"');
    }
    const promoted = await alice.api("POST", `${Q}/story/promote-mockup`, { mockup_id: mockupId, mockup_page_id: "book" });
    expect(promoted.status).toBe(201);
    const story = await policy(`${Q}/story/pages/book/versions/1/html?frame=1`);
    expect(story.csp).toMatch(mockupSandbox);
    expect(story.html).toContain('<form id="book"');
    // A Story page of its own, and a style's specimen, keep the Story's sandbox: no forms.
    expect((await alice.api("POST", `${Q}/story/pages/plan/versions`, { title: "Plan", html: page("Plan") })).status).toBe(201);
    for (const path of [`${Q}/story/pages/plan/versions/1/html?frame=1`, `${Q}/story/house-styles/clear/specimen`]) {
      const { csp } = await policy(path);
      expect(csp, path).toMatch(/^sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; /);
      expect(csp, path).not.toContain("allow-forms");
    }
    // The print view runs no page script and drops the form, under a policy of its own.
    const print = await raw(alice, `${Q}/story/print?page_ids=book`);
    expect(print.status).toBe(200);
    const csp = print.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/^sandbox /);
    expect(csp).not.toContain("allow-forms");
    expect(csp).toContain("form-action 'none'");
    const doc = await print.text();
    expect(doc).toContain("Book a crew");
    expect(doc).not.toContain("<form");
  });

  it("frames a page in the app in the sandbox its responses give it: forms for a mockup page alone, and never the same origin", () => {
    expect(STORY_PAGE_SANDBOX).toBe("allow-scripts allow-popups allow-popups-to-escape-sandbox");
    expect(MOCKUP_PAGE_SANDBOX).toBe("allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
    expect(MOCKUP_RESPONSE_HEADERS["Content-Security-Policy"]).toBe(STORY_RESPONSE_HEADERS["Content-Security-Policy"]!.replace(STORY_PAGE_SANDBOX, MOCKUP_PAGE_SANDBOX));
    // Served from a content site, a page keeps its sandbox, and only the app's origin, by name, may frame it.
    for (const [rules, own] of [[STORY_PAGE_RULES, STORY_RESPONSE_HEADERS], [MOCKUP_PAGE_RULES, MOCKUP_RESPONSE_HEADERS]] as const)
      expect(pageResponseHeaders(rules, "https://app.example.com")["Content-Security-Policy"]).toBe(own["Content-Security-Policy"]!.replace("frame-ancestors 'self'", "frame-ancestors https://app.example.com"));
    // The app's frames take the same constants, never a sandbox written out; a frame that enters a
    // prototype takes the sandbox the server names for it (prototypeSandbox), which its responses carry.
    expect(prototypeSandbox(false)).toBe(MOCKUP_PAGE_SANDBOX);
    expect(prototypeSandbox(true)).toBe(`${MOCKUP_PAGE_SANDBOX} allow-modals`);
    const frames: Record<string, string[]> = {
      "mockup-canvas.tsx": ["sandbox={prototype?.sandbox ?? MOCKUP_PAGE_SANDBOX}"],
      "story.tsx": ["sandbox={prototype?.sandbox ?? (size ? MOCKUP_PAGE_SANDBOX : STORY_PAGE_SANDBOX)}"],
      "story-style.tsx": ["sandbox={STORY_PAGE_SANDBOX}"],
    };
    for (const [file, uses] of Object.entries(frames)) {
      const source = readFileSync(new URL(`../../web/src/routes/${file}`, import.meta.url), "utf8");
      expect([...source.matchAll(/sandbox=\{[^}]*\}/g)].map((m) => m[0]), file).toEqual(uses);
      expect(source, file).not.toMatch(/sandbox="allow/);
    }
  });

  it("refuses, naming the page, the mockup page's rule and the element, and never the Story", async () => {
    const m = await alice.api("GET", `${Q}/mockups/${mockupId}`);
    const bad = await alice.api("POST", `${Q}/mockups`, {
      mockup_id: mockupId,
      expected_etag: m.body.etag,
      pages: [{ page_id: "book" }, { page_id: "embed", title: "Embed", html: page("Embed").replace("</body>", '<iframe src="https://example.com/map"></iframe></body>') }],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("invalid_html");
    expect(bad.body.error.details.problems).toEqual([
      "embed: <iframe> is not allowed in a mockup page: a page frames and embeds no other document.",
      'embed: <iframe src="https://example.com/map"> loads an external resource, which a mockup page may not: embed images, fonts and media as data: URIs.',
    ]);
    expect(bad.body.error.message).not.toMatch(/Story/);
    const big = await alice.api("POST", `${Q}/mockups`, { mockup_id: mockupId, expected_etag: m.body.etag, pages: [{ page_id: "book", html: "x".repeat(1_000_001) }] });
    expect(big.status).toBe(422);
    expect(big.body.error.message).toMatch(/a mockup page holds at most 1,000,000 characters/);
    expect((await alice.api("GET", `${Q}/mockups/${mockupId}`)).body.current_version).toBe(1);
  });
});

describe("what publishing an upload tells and keeps", () => {
  let Q: string;
  const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

  beforeAll(async () => {
    const p = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Uploads" });
    Q = `/api/v1/p/${p.body.path}`;
  });

  /** PUT a ZIP of these entries, raw bytes or text; the grant's id, the ZIP and what the PUT answered. */
  async function put(entries: Record<string, string | Uint8Array>) {
    const g = await alice.api("POST", `${Q}/mockups/uploads`, {});
    const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
    const res = await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: zip });
    expect(res.status).toBe(201);
    return { uploadId: g.body.upload_id as string, zip, answered: (await res.json()) as { size: number; sha256: string } };
  }
  const uploadRow = (uploadId: string) =>
    h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      return trx.selectFrom("mockup_uploads").selectAll().where("upload_id", "=", uploadId).executeTakeFirstOrThrow();
    });

  it("gives the upload's size and sha256, and says what chars and sha256 measure: text, hashed as UTF-8, without a byte-order mark", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const withBom = (text: string) => new Uint8Array([...bom, ...strToU8(text)]);
    const html = page("Café ☕ 🚀");
    const notes = "Crème brûlée 🍮\n";
    const { uploadId, zip, answered } = await put({
      "manifest.json": JSON.stringify({ title: "Hashes", pages: [{ page_id: "menu", title: "Menu" }] }),
      "pages/menu.html": withBom(html),
      "files/notes.md": withBom(notes),
    });
    expect(answered).toMatchObject({ size: zip.length, sha256: sha(zip) });
    const r = await alice.api("POST", `${Q}/mockups`, { upload_id: uploadId });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.from_upload).toBe(uploadId);
    expect(r.body.upload).toEqual({ upload_id: uploadId, size: zip.length, sha256: sha(zip) });
    const v = await canvasOf(Q, r.body.mockup_id);
    const pageView = v.pages[0];
    expect(pageView.html_chars).toBe(html.length);
    expect(Buffer.byteLength(html, "utf8")).toBeGreaterThan(html.length);
    expect(pageView.html_sha256).toBe(sha(strToU8(html)));
    expect(pageView.html_sha256).not.toBe(sha(withBom(html)));
    expect(v.files).toEqual([{ path: "notes.md", chars: notes.length, sha256: sha(strToU8(notes)) }]);
    // A publish without an upload says nothing of one.
    const next = await alice.api("POST", `${Q}/mockups`, { mockup_id: r.body.mockup_id, expected_etag: r.body.etag, title: "Hashes again" });
    expect(next.status).toBe(201);
    expect(next.body.upload).toBeUndefined();
    expect(next.body.from_upload).toBeUndefined();
  });

  it("changes nothing and keeps the upload when publish is refused, so publishing is a safe check", async () => {
    const m = await alice.api("POST", `${Q}/mockups`, { title: "Safe check", pages: [{ page_id: "a", title: "A", html: page("A v1") }] });
    const activity = async () => (await alice.api("GET", `${Q}/activity?entity_type=mockup&entity_id=${m.body.mockup_id}`)).body.items.length;
    const before = await activity();
    // A page the rules refuse: nothing published, and the upload is still unused.
    const bad = await put({ "manifest.json": JSON.stringify({ pages: [{ page_id: "a" }] }), "pages/a.html": page("A v2").replace("</head>", '<base href="https://example.com/"></head>') });
    const refused = await alice.api("POST", `${Q}/mockups`, { mockup_id: m.body.mockup_id, expected_etag: m.body.etag, upload_id: bad.uploadId });
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toMatch(/^Nothing was published: a: <base> is not allowed in a mockup page/);
    expect((await uploadRow(bad.uploadId)).used_at).toBeNull();
    // A call refused for another reason leaves a good upload to publish once the call is right.
    const good = await put({ "manifest.json": JSON.stringify({ pages: [{ page_id: "a" }] }), "pages/a.html": page("A v2") });
    const stale = await alice.api("POST", `${Q}/mockups`, { mockup_id: m.body.mockup_id, expected_etag: "stale", upload_id: good.uploadId });
    expect(stale.status).toBe(409);
    const got = await alice.api("GET", `${Q}/mockups/${m.body.mockup_id}`);
    expect(got.body).toMatchObject({ current_version: 1, etag: m.body.etag });
    expect(await activity()).toBe(before);
    expect((await uploadRow(good.uploadId)).used_at).toBeNull();
    const published = await alice.api("POST", `${Q}/mockups`, { mockup_id: m.body.mockup_id, expected_etag: m.body.etag, upload_id: good.uploadId });
    expect(published.status).toBe(201);
    expect(published.body.upload).toMatchObject({ upload_id: good.uploadId, size: good.zip.length });
  });

  it("holds each uploaded page to its limit and the version to its total", async () => {
    const huge = (n: number) => `<!doctype html><html><head><title>Big</title></head><body><script>/*${"x".repeat(n)}*/</script></body></html>`;
    const over = await put({ "manifest.json": JSON.stringify({ title: "Big", pages: [{ page_id: "big", title: "Big" }] }), "pages/big.html": huge(1_000_000) });
    const one = await alice.api("POST", `${Q}/mockups`, { upload_id: over.uploadId });
    expect(one.status).toBe(422);
    expect(one.body.error.code).toBe("invalid_upload");
    expect(one.body.error.message).toMatch(/pages\/big\.html holds [\d,]+ characters; a mockup page holds at most 1,000,000\./);
    const pages = Array.from({ length: 9 }, (_, i) => `p${i}`);
    const many = await put({
      "manifest.json": JSON.stringify({ title: "Many", pages: pages.map((p) => ({ page_id: p, title: p })) }),
      ...Object.fromEntries(pages.map((p) => [`pages/${p}.html`, huge(950_000)])),
    });
    const total = await alice.api("POST", `${Q}/mockups`, { upload_id: many.uploadId });
    expect(total.status).toBe(422);
    expect(total.body.error.code).toBe("invalid_html");
    expect(total.body.error.details.problems).toEqual([expect.stringMatching(/^The pages total [\d,]+ characters of HTML; a version holds at most 8,000,000\.$/)]);
  });
});
