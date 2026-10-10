import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let vic: Browser;
let rita: Browser;
let P: string;
let tenantSlug: string;
let teamSlug: string;
let assumptionId: string;

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
  teamSlug = t.body.team.slug;
  const a = await alice.api("POST", `${P}/assumptions`, { statement: "Finance leads want the close on one screen." });
  assumptionId = a.body.id;
  for (const [email, role] of [["vic@example.com", "viewer"], ["rita@example.com", "reader"]])
    expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email, role })).status).toBe(201);
});
afterAll(async () => h?.close());

async function raw(b: Browser, path: string, headers: Record<string, string> = {}) {
  return fetch(`${h.baseUrl}${path}`, { headers: { cookie: b.cookie, ...headers } });
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
      refs: { assumptions: [assumptionId] },
    });
    expect(r.status).toBe(201);
    id = r.body.mockup_id;
    etag = r.body.etag;
    expect(r.body).toMatchObject({ title: "Close dashboard", current_version: 1, based_on_version: null });
    expect(r.body.current.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["grid", "timeline"]);
    expect(r.body.current.pages[0]).toMatchObject({ width: 1280, height: 800, notes: "Dense, for experts." });
    expect(r.body.current.pages[1]).toMatchObject({ width: 390, height: 844 });
    expect(r.body.current.resolved_refs.assumptions[0]).toMatchObject({ id: assumptionId, missing: false });
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
    expect(r.body).toMatchObject({ current_version: 2, based_on_version: 1 });
    const v = r.body.current;
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

describe("what a mockup draws on", () => {
  let recordId: string;
  let mockupId: string;

  beforeAll(async () => {
    const created = await alice.api("POST", `${P}/sources/with-upload`, { kind: "interview_transcript", title: "Finance lead interview", date: "2026-09-03", path: "call.vtt", role: "primary" });
    recordId = created.body.record.record_id;
    const up = created.body.upload;
    await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
    await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "call.vtt" });
    await h.worker.drain();
    const m = await alice.api("POST", `${P}/mockups`, {
      title: "Approvals",
      brief: "Where do approvals stall?",
      pages: [{ page_id: "queue", title: "Queue", html: page("Queue") }],
      citations: [{ record_id: recordId, seq_start: 2, seq_end: 2 }],
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    mockupId = m.body.mockup_id;
    const v2 = await alice.api("POST", `${P}/mockups`, { mockup_id: mockupId, expected_etag: m.body.etag, refs: { sources: [recordId] }, citations: [] });
    expect(v2.status).toBe(201);
  });

  it("is listed among what a source is used in, and in its delete impact, earlier versions included", async () => {
    const using = await alice.api("GET", `${P}/sources/${recordId}/insights`);
    expect(using.body.mockups).toEqual([{ mockup_id: mockupId, title: "Approvals", version: 2, referenced: true, citations: [] }]);
    const impact = await alice.api("GET", `${P}/sources/${recordId}/delete-impact`);
    expect(impact.body.mockup_versions_citing).toEqual([{ mockup_id: mockupId, title: "Approvals", version: 1, count: 1, is_current: false }]);
    expect(impact.body.after_delete).toMatch(/1 mockup version/);
  });

  it("checks a version's citations against the source as it is now", async () => {
    const v1 = await alice.api("GET", `${P}/mockups/${mockupId}/check-citations?version=1`);
    expect(v1.status).toBe(200);
    expect(v1.body).toMatchObject({ mockup_id: mockupId, version: 1 });
    expect(v1.body.citations).toEqual([expect.objectContaining({ index: 0, status: "ok" })]);
    const current = await alice.api("GET", `${P}/mockups/${mockupId}/check-citations`);
    expect(current.body).toMatchObject({ version: 2, citations: [] });
  });

  it("keeps the source from moving to another product while the mockup uses it", async () => {
    await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Elsewhere" });
    const etag = (await alice.api("GET", `${P}/sources/${recordId}`)).body.etag;
    const moved = await alice.api("POST", `${P}/sources/${recordId}/move`, { record_id: recordId, to_product: "elsewhere", expected_etag: etag });
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe("source_in_use");
    expect(moved.body.error.details.mockups).toEqual([{ mockup_id: mockupId, title: "Approvals" }]);
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
    expect(v2).toMatchObject({ n: 2, refs: { sources: [recordId] } });
    expect(v2.pages).toEqual([expect.objectContaining({ page_id: "queue", title: "Queue" })]);
    expect(v2.pages[0].html).toBeUndefined();
  });

  it("holds at most 50 mockups in a product, archived ones included", async () => {
    const t = await alice.api("POST", `/api/v1/teams/${tenantSlug}/${teamSlug}/products`, { name: "Crowded" });
    const Q = `/api/v1/p/${t.body.path}`;
    for (let i = 0; i < 50; i++) expect((await alice.api("POST", `${Q}/mockups`, { title: `M${i}`, pages: [{ page_id: "a", title: "A", html: page("A") }] })).status).toBe(201);
    const over = await alice.api("POST", `${Q}/mockups`, { title: "One more", pages: [{ page_id: "a", title: "A", html: page("A") }] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("quota_exceeded");
    expect(over.body.error.details).toMatchObject({ quota: "mockups", limit: 50, used: 50 });
  });
});
