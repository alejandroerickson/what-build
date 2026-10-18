import { DELETE_CONFIRMATION } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// An archived source is read-only until it is restored: its title, date and tags, and its comments,
// which are part of it (adding, editing, archiving, restoring and deleting one), are refused any
// change while it is archived, as every other write to it is (409 record_archived), saying how to
// restore it. Reading it is not, and sources.restore brings it back.

let h: Harness;
let alice: Browser;
let P: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@comments.example", "Alice Comments");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Comment Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Yard" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

/** A refusal for the source being archived, saying how to restore it. */
const archivedRefusal = (r: { status: number; body: { error: { code: string; message: string } } }, recordId: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(409);
  expect(r.body.error.code).toBe("record_archived");
  expect(r.body.error.message).toContain(`Source ${recordId} is archived, and an archived source is read-only. Nothing was changed.`);
  expect(r.body.error.message).toContain(`sources(action="restore", params={"record_ids": ["${recordId}"]}) or Restore on the source in the web app`);
};

describe("a comment on an archived source", () => {
  it("is neither added, edited, archived, restored nor deleted until the source is restored", async () => {
    const s = await alice.api("POST", `${P}/sources`, { title: "Gate log — Example Co", tags: [] });
    const id = s.body.record_id as string;
    const kept = await alice.api("POST", `${P}/sources/${id}/annotations`, { note: "The gate sticks in the cold." });
    expect(kept.status).toBe(201);
    const shelved = await alice.api("POST", `${P}/sources/${id}/annotations`, { note: "Ask about the second gate." });
    const shelvedNow = await alice.api("PATCH", `${P}/annotations/${shelved.body.annotation_id}`, { expected_etag: shelved.body.etag, archived: true });
    expect(shelvedNow.status).toBe(200);
    expect((await alice.api("POST", `${P}/sources/archive`, { record_ids: [id] })).status).toBe(200);

    archivedRefusal(await alice.api("POST", `${P}/sources/${id}/annotations`, { note: "One more." }), id);
    archivedRefusal(await alice.api("PATCH", `${P}/annotations/${kept.body.annotation_id}`, { expected_etag: kept.body.etag, note: "The gate sticks." }), id);
    archivedRefusal(await alice.api("PATCH", `${P}/annotations/${kept.body.annotation_id}`, { expected_etag: kept.body.etag, archived: true, archive_reason: "Done." }), id);
    archivedRefusal(await alice.api("PATCH", `${P}/annotations/${shelved.body.annotation_id}`, { expected_etag: shelvedNow.body.etag, archived: false }), id);
    archivedRefusal(await alice.api("DELETE", `${P}/annotations/${kept.body.annotation_id}`, { expected_etag: kept.body.etag, reason: "Not needed.", confirm: DELETE_CONFIRMATION }), id);
    // The source being archived is said first, before an etag that is no longer current.
    archivedRefusal(await alice.api("PATCH", `${P}/annotations/${kept.body.annotation_id}`, { expected_etag: "not-the-etag", note: "Changed." }), id);

    // Nothing changed, and the comments still read.
    const listed = await alice.api("GET", `${P}/sources/${id}/annotations?include_archived=true`);
    expect(listed.body.items.map((a: { note: string; archived_at: string | null }) => [a.note, Boolean(a.archived_at)])).toEqual([
      ["Ask about the second gate.", true],
      ["The gate sticks in the cold.", false],
    ]);

    // Restored, the source takes all of them again.
    expect((await alice.api("POST", `${P}/sources/restore`, { record_ids: [id] })).status).toBe(200);
    const edited = await alice.api("PATCH", `${P}/annotations/${kept.body.annotation_id}`, { expected_etag: kept.body.etag, note: "The gate sticks." });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect((await alice.api("POST", `${P}/sources/${id}/annotations`, { note: "One more." })).status).toBe(201);
    const gone = await alice.api("DELETE", `${P}/annotations/${edited.body.annotation_id}`, { expected_etag: edited.body.etag, reason: "Not needed.", confirm: DELETE_CONFIRMATION });
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
  });
});

describe("an archived source's details", () => {
  it("are not corrected until the source is restored, which sources.restore still does", async () => {
    const s = await alice.api("POST", `${P}/sources`, { title: "Yard survey — Example Co", date: "2026-09-01", tags: ["survey"] });
    const id = s.body.record_id as string;
    expect((await alice.api("POST", `${P}/sources/archive`, { record_ids: [id] })).status).toBe(200);
    const archived = (await alice.api("GET", `${P}/sources/${id}`)).body;
    for (const change of [{ title: "Yard survey, corrected — Example Co" }, { date: "2026-09-02" }, { tags: ["survey", "yard"] }])
      archivedRefusal(await alice.api("PATCH", `${P}/sources/${id}`, { expected_etag: archived.etag, ...change }), id);
    expect((await alice.api("GET", `${P}/sources/${id}`)).body).toMatchObject({ title: "Yard survey — Example Co", date: "2026-09-01", tags: ["survey"], etag: archived.etag });
    const restored = await alice.api("POST", `${P}/sources/restore`, { record_ids: [id] });
    expect(restored.body).toMatchObject({ restored: [{ record_id: id }], failed: [] });
    const live = (await alice.api("GET", `${P}/sources/${id}`)).body;
    const corrected = await alice.api("PATCH", `${P}/sources/${id}`, { expected_etag: live.etag, title: "Yard survey, corrected — Example Co" });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
  });
});
