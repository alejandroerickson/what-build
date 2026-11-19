import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Deleting every archived mockup, or every archived Story page, at once: an admin's, after its
// preview, guarded as any delete is, with an etag that stands for exactly the set the preview
// showed. A mockup a Story page shows stays, as it does when deleted alone.

let h: Harness;
let admin: Browser;
let editor: Browser;
let P: string;

const html = (heading: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title></head><body><h1>${heading}</h1></body></html>`;
const guards = (etag: string, reason = "Clearing out the archive") => ({ expected_etag: etag, reason, confirm: "delete permanently" });

async function mockup(title: string) {
  const r = await admin.api("POST", `${P}/mockups`, { title, pages: [{ page_id: "screen", title: `${title} screen`, html: html(title) }] });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.mockup_id as string;
}

async function archiveMockup(id: string) {
  const now = await admin.api("GET", `${P}/mockups/${id}`);
  expect((await admin.api("POST", `${P}/mockups/${id}/archive`, { expected_etag: now.body.etag })).status).toBe(200);
}

async function page(id: string, title: string) {
  const r = await admin.api("POST", `${P}/story/pages/${id}/versions`, { title, body: `<h1>${title}</h1>` });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

async function archivePage(id: string) {
  const now = await admin.api("GET", `${P}/story/pages/${id}?include_html=false`);
  expect((await admin.api("POST", `${P}/story/pages/${id}/archive`, { expected_etag: now.body.etag })).status).toBe(200);
}

beforeAll(async () => {
  h = await startHarness();
  admin = await h.signIn("ada@archive.example", "Ada Admin");
  editor = await h.signIn("eli@archive.example", "Eli Editor");
  const t = await admin.api("POST", "/api/v1/tenants", { name: "Archive Co" });
  const p = await admin.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/products`, { name: "Ledger", concept: "A ledger for small teams." });
  P = `/api/v1/p/${p.body.path}`;
  expect((await admin.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { product: "ledger", email: "eli@archive.example", role: "editor" })).status).toBe(201);
}, 120_000);
afterAll(async () => h?.close());

describe("deleting every archived mockup", () => {
  let kept: string;
  let old: string;
  let older: string;
  let shown: string;
  let shownPage: string;

  beforeAll(async () => {
    kept = await mockup("Kept canvas");
    old = await mockup("Old canvas");
    older = await mockup("Older canvas");
    shown = await mockup("Shown canvas");
    const promoted = await admin.api("POST", `${P}/story/promote-mockup`, { mockup_id: shown, mockup_page_id: "screen", title: "Shown on the Story" });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(201);
    shownPage = promoted.body.page_id;
    for (const id of [old, older, shown]) await archiveMockup(id);
  });

  it("previews what goes and what a Story page holds, to an editor too, and refuses the delete to an editor", async () => {
    const impact = await editor.api("GET", `${P}/archived-mockups/delete-impact`);
    expect(impact.status, JSON.stringify(impact.body)).toBe(200);
    expect(impact.body).toMatchObject({ archived_count: 3, deleted_count: 2, held_count: 1, versions: 2 });
    expect(impact.body.mockups.map((m: { mockup_id: string }) => m.mockup_id).sort()).toEqual([old, older].sort());
    expect(impact.body.held).toMatchObject([{ mockup_id: shown, story_pages_showing: [{ page_id: shownPage, archived: false }] }]);
    const refused = await editor.api("DELETE", `${P}/archived-mockups`, guards(impact.body.etag));
    expect(refused.status).toBe(403);
    expect(refused.body.error.details).toMatchObject({ role: "editor", needed: "admin" });
  });

  it("refuses without the exact words, and when the set changed since the preview", async () => {
    const impact = await admin.api("GET", `${P}/archived-mockups/delete-impact`);
    expect((await admin.api("DELETE", `${P}/archived-mockups`, { ...guards(impact.body.etag), confirm: "yes" })).body.error.code).toBe("confirmation_required");
    // Archiving one more changes what the delete would destroy, so the preview no longer stands.
    const extra = await mockup("Late canvas");
    await archiveMockup(extra);
    const stale = await admin.api("DELETE", `${P}/archived-mockups`, guards(impact.body.etag));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
    const now = await admin.api("GET", `${P}/mockups/${extra}`);
    expect((await admin.api("POST", `${P}/mockups/${extra}/restore`, { expected_etag: now.body.etag })).status).toBe(200);
    expect((await admin.api("GET", `${P}/archived-mockups/delete-impact`)).body.etag).toBe(impact.body.etag);
  });

  it("deletes every archived mockup but the one a Story page shows, leaving the live ones and a tombstone for each", async () => {
    const impact = await admin.api("GET", `${P}/archived-mockups/delete-impact`);
    const del = await admin.api("DELETE", `${P}/archived-mockups`, guards(impact.body.etag));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, deleted_count: 2, held_count: 1, reason: "Clearing out the archive" });
    for (const id of [old, older]) {
      const gone = await admin.api("GET", `${P}/mockups/${id}`);
      expect(gone.status).toBe(410);
      expect(gone.body.error.details.tombstone).toMatchObject({ reason: "Clearing out the archive" });
    }
    expect((await admin.api("GET", `${P}/mockups/${kept}`)).status).toBe(200);
    expect((await admin.api("GET", `${P}/mockups/${shown}`)).body.archived_at).toBeTruthy();
    const log = await admin.api("GET", `${P}/activity?limit=20`);
    expect(log.body.items.filter((a: { action: string; entity_type: string }) => a.action === "deleted" && a.entity_type === "mockup")).toHaveLength(2);
  });

  it("refuses when nothing archived can go, and lets the held mockup go once its page is deleted", async () => {
    const impact = await admin.api("GET", `${P}/archived-mockups/delete-impact`);
    expect(impact.body).toMatchObject({ deleted_count: 0, held_count: 1 });
    const none = await admin.api("DELETE", `${P}/archived-mockups`, guards(impact.body.etag));
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe("nothing_archived");
    // Archiving the page that shows it and emptying the Story's archive frees it.
    await archivePage(shownPage);
    const pages = await admin.api("GET", `${P}/story/archived-pages/delete-impact`);
    expect(pages.body).toMatchObject({ deleted_count: 1, mockups_shown: 1 });
    expect((await admin.api("DELETE", `${P}/story/archived-pages`, guards(pages.body.etag))).status).toBe(200);
    const freed = await admin.api("GET", `${P}/archived-mockups/delete-impact`);
    expect(freed.body).toMatchObject({ deleted_count: 1, held_count: 0 });
    expect((await admin.api("DELETE", `${P}/archived-mockups`, guards(freed.body.etag))).status).toBe(200);
    expect((await admin.api("GET", `${P}/mockups/${shown}`)).status).toBe(410);
  });
});

describe("deleting every archived Story page", () => {
  it("deletes only the archived pages, keeps the Story's navigation, and answers 410 for each afterwards", async () => {
    await page("live", "Still on the Story");
    await page("gone-a", "First retired page");
    await page("gone-b", "Second retired page");
    await archivePage("gone-a");
    await archivePage("gone-b");
    const before = await admin.api("GET", `${P}/story/hierarchy`);

    const impact = await editor.api("GET", `${P}/story/archived-pages/delete-impact`);
    expect(impact.status).toBe(200);
    expect(impact.body).toMatchObject({ deleted_count: 2, versions: 2 });
    expect(impact.body.pages.map((p: { page_id: string }) => p.page_id)).toEqual(["gone-a", "gone-b"]);
    expect((await editor.api("DELETE", `${P}/story/archived-pages`, guards(impact.body.etag))).status).toBe(403);
    expect((await admin.api("DELETE", `${P}/story/archived-pages`, guards("set-stale"))).body.error.code).toBe("stale_etag");

    const del = await admin.api("DELETE", `${P}/story/archived-pages`, guards(impact.body.etag, "Retired pages"));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, deleted_count: 2, reason: "Retired pages" });
    for (const id of ["gone-a", "gone-b"]) expect((await admin.api("GET", `${P}/story/pages/${id}`)).status).toBe(410);
    expect((await admin.api("GET", `${P}/story/pages/live?include_html=false`)).status).toBe(200);
    const after = await admin.api("GET", `${P}/story/hierarchy`);
    expect(after.body.items).toEqual(before.body.items);

    const empty = await admin.api("GET", `${P}/story/archived-pages/delete-impact`);
    expect(empty.body).toMatchObject({ deleted_count: 0, pages: [] });
    expect((await admin.api("DELETE", `${P}/story/archived-pages`, guards(empty.body.etag))).body.error.code).toBe("nothing_archived");
  });
});
