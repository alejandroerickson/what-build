import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let P: string;

/** Stands in for the network: every URL returns the same small HTML page. */
const fetched: string[] = [];
const fetcher = {
  async fetch(url: string) {
    fetched.push(url);
    return { bytes: new TextEncoder().encode("<html><body><p>Crews plan by the week.</p></body></html>"), fileName: "manual.html", mediaType: "text/html" };
  },
};

beforeAll(async () => {
  h = await startHarness({}, { fetcher });
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Research" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Scheduling" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

async function put(upload: { url: string; headers: Record<string, string> }, body: string | Uint8Array) {
  const res = await fetch(upload.url, { method: "PUT", headers: upload.headers, body });
  expect(res.status).toBe(201);
  return (await res.json()) as { attachment: Record<string, any> };
}

/** Add an attachment to a source through a grant and the upload relay; the relay's reply. */
async function attach(recordId: string, path: string, body: string | Uint8Array) {
  const grant = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { record_id: recordId, path });
  expect(grant.status).toBe(201);
  return put(grant.body, body);
}

describe("intake warnings", () => {
  it("warns, without refusing, when an attachment's format has no parser", async () => {
    const deck = await alice.api("POST", `${P}/sources/with-upload`, { title: "Quarterly readout deck — Example Co, Sep 2026", path: "readout.pptx" });
    expect(deck.status).toBe(201);
    expect(deck.body.upload.url).toBeTruthy();
    expect(deck.body.warnings).toHaveLength(1);
    expect(deck.body.warnings[0]).toMatch(/No parser reads \.pptx files/);
    expect(deck.body.warnings[0]).toMatch(/cannot become the source's derived text/);
    expect(deck.body.warnings[0]).toMatch(/add an export in a format WhatBuild reads \(.*\.pdf.*\) as well/);

    const pdf = await alice.api("POST", `${P}/sources/with-upload`, { title: "Quarterly readout — Example Co, Sep 2026", path: "readout.pdf" });
    expect(pdf.body.warnings).toEqual([]);
    // A second attachment no parser reads is kept beside it, and says so too.
    const deckBeside = await alice.api("POST", `${P}/sources/${pdf.body.record.record_id}/uploads`, { record_id: pdf.body.record.record_id, path: "readout.pptx" });
    expect(deckBeside.status).toBe(201);
    expect(deckBeside.body.warnings[0]).toMatch(/No parser reads \.pptx files/);

    const empty = await alice.api("POST", `${P}/sources`, { title: "Slide notes — Example Co, Sep 2026" });
    const grant = await alice.api("POST", `${P}/sources/${empty.body.record_id}/uploads`, { record_id: empty.body.record_id, path: "notes.key" });
    expect(grant.status).toBe(201);
    expect(grant.body.warnings[0]).toMatch(/No parser reads \.key files/);

    // A recording is kept and playable; what it says comes from a transcript, so it is not warned about here.
    const call = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Crew lead call — Example Co, Sep 2026", path: "call.m4a" });
    expect(call.body.warnings).toEqual([]);
  });

  it("says what becomes of an attachment no parser reads, and takes the text of the next one that can be read", async () => {
    const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["manual"], title: "Field manual — Example Co, 2026", path: "manual.pptx" });
    expect(created.body.warnings[0]).toMatch(/No parser reads \.pptx files/);
    const recordId: string = created.body.record.record_id;
    await put(created.body.upload, new Uint8Array([80, 75, 3, 4]));
    const done = await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "manual.pptx" });
    expect(done.status).toBe(200);
    expect(done.body.warnings).toEqual([]);
    expect(done.body.note).toMatch(/^No parser reads \.pptx files, so manual\.pptx is stored and downloadable but has no text\./);
    expect(done.body.note).toMatch(/never searched/);
    await h.worker.drain();
    const got = await alice.api("GET", `${P}/sources/${recordId}`);
    expect(got.body).toMatchObject({ derived_status: "unsupported", text_chars: 0, text_from: null, attachment_count: 1, warnings: [] });

    const readable = await attach(recordId, "manual.md", "# Manual\n\nCrews plan by the week.\n");
    expect(readable.attachment.note).toMatch(/^manual\.md is being read\. Once it is read, its text becomes the source's derived text/);
    await h.worker.drain();
    const after = await alice.api("GET", `${P}/sources/${recordId}`);
    expect(after.body).toMatchObject({ derived_status: "ready", text_from: "manual.md", attachment_count: 2, warnings: [] });

    const bare = await alice.api("POST", `${P}/sources`, { title: "Placeholder with no attachments" });
    expect((await alice.api("GET", `${P}/sources/${bare.body.record_id}`)).body).toMatchObject({ derived_status: "awaiting_file", warnings: [] });
  });

  it("warns about a live source with the same title and date, and creates the new one anyway", async () => {
    const meta = { tags: ["notes"], title: "Dispatcher visit — Example Co, Sep 2026", date: "2026-09-10" };
    const first = await alice.api("POST", `${P}/sources`, meta);
    expect(first.body.warnings).toEqual([]);
    const second = await alice.api("POST", `${P}/sources`, { ...meta, title: "  dispatcher visit — example co, sep 2026 " });
    expect(second.status).toBe(201);
    expect(second.body.warnings).toHaveLength(1);
    expect(second.body.warnings[0]).toContain(first.body.record_id);
    const viaUpload = await alice.api("POST", `${P}/sources/with-upload`, { ...meta, path: "visit.md" });
    expect(viaUpload.status).toBe(201);
    expect(viaUpload.body.warnings[0]).toMatch(/same title and date/);
    const otherDate = await alice.api("POST", `${P}/sources`, { ...meta, date: "2026-09-11" });
    expect(otherDate.body.warnings).toEqual([]);
    // Tags say nothing about whether it is the same material.
    const otherTags = await alice.api("POST", `${P}/sources`, { ...meta, tags: ["something else"] });
    expect(otherTags.body.warnings).toHaveLength(1);
    // Archived sources do not count.
    await alice.api("POST", `${P}/sources/archive`, { record_ids: [first.body.record_id, second.body.record_id, viaUpload.body.record.record_id, otherTags.body.record_id] });
    const again = await alice.api("POST", `${P}/sources`, meta);
    expect(again.body.warnings).toEqual([]);
  });

  it("changes a source's etag when an attachment is added", async () => {
    const created = await alice.api("POST", `${P}/sources`, { title: "Planning board photo notes" });
    const recordId: string = created.body.record_id;
    const { attachment } = await attach(recordId, "board.txt", "Monday column is full.\n");
    expect(attachment.record_etag).toBeTruthy();
    expect(attachment.record_etag).not.toBe(created.body.etag);
    const stale = await alice.api("PATCH", `${P}/sources/${recordId}`, { expected_etag: created.body.etag, title: "Planning board notes" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
    expect(stale.body.error.details.current_etag).toBe(attachment.record_etag);
    const ok = await alice.api("PATCH", `${P}/sources/${recordId}`, { expected_etag: attachment.record_etag, title: "Planning board notes" });
    expect(ok.status).toBe(200);
  });

  it("says in fetch_url's result that a URL's fragment was not fetched", async () => {
    const src = await alice.api("POST", `${P}/sources`, { tags: ["wiki"], title: "Crew app manual — Example Co" });
    const recordId: string = src.body.record_id;
    const res = await alice.api("POST", `${P}/sources/${recordId}/fetch`, { record_id: recordId, url: "https://docs.example.com/app/#/manual", path: "manual.html" });
    expect(res.status).toBe(201);
    expect(fetched.at(-1)).toBe("https://docs.example.com/app/#/manual");
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatch(/fragment \(#\/manual\) never reaches the server/);
    const plain = await alice.api("POST", `${P}/sources/${recordId}/fetch`, { record_id: recordId, url: "https://docs.example.com/app/faq", path: "faq.html" });
    expect(plain.body.warnings).toEqual([]);
  });
});

describe("archiving a note with a reason", () => {
  it("keeps the reason beside the note, clears it on restore, and refuses it without archiving", async () => {
    const src = await alice.api("POST", `${P}/sources`, { title: "Note reasons sample" });
    const a = await alice.api("POST", `${P}/sources/${src.body.record_id}/annotations`, { record_id: src.body.record_id, note: "Counts look off." });
    expect(a.status).toBe(201);
    expect(a.body.archive_reason).toBeNull();
    const lone = await alice.api("PATCH", `${P}/annotations/${a.body.annotation_id}`, { expected_etag: a.body.etag, archive_reason: "stale" });
    expect(lone.status).toBe(422);
    const archived = await alice.api("PATCH", `${P}/annotations/${a.body.annotation_id}`, { expected_etag: a.body.etag, archived: true, archive_reason: "Superseded by the corrected export." });
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ note: "Counts look off.", archive_reason: "Superseded by the corrected export." });
    expect(archived.body.archived_at).toBeTruthy();
    const stale = await alice.api("PATCH", `${P}/annotations/${a.body.annotation_id}`, { expected_etag: a.body.etag, archived: false });
    expect(stale.status).toBe(409);
    const listed = await alice.api("GET", `${P}/sources/${src.body.record_id}/annotations?include_archived=true`);
    expect(listed.body.items[0].archive_reason).toBe("Superseded by the corrected export.");
    const restored = await alice.api("PATCH", `${P}/annotations/${a.body.annotation_id}`, { expected_etag: archived.body.etag, archived: false });
    expect(restored.body).toMatchObject({ archived_at: null, archive_reason: null });
  });
});
