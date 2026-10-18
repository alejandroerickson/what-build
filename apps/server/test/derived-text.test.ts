import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A source's words are one derived text: Markdown taken from the first attachment read, following
// that attachment's new versions until someone writes or edits it. People and agents read it in
// windows by code point, write it whole or by exact edits, take it from another attachment, or
// remove it.

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;
let annex: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Text Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
  const a = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Annex" });
  annex = `/api/v1/p/${a.body.path}`;
  await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email: "vic@example.com", role: "viewer" });
});
afterAll(async () => h?.close());

async function source(title: string) {
  const r = await alice.api("POST", `${P}/sources`, { title });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.record_id as string;
}

/** Add an attachment, or a new version of one, through a grant and the upload relay; the attachment as the relay reports it. */
async function attach(recordId: string, path: string, body: string | Uint8Array) {
  const grant = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { record_id: recordId, path });
  expect(grant.status, JSON.stringify(grant.body)).toBe(201);
  const put = await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body });
  expect(put.status).toBe(201);
  return ((await put.json()) as { attachment: { file_version_id: string } }).attachment;
}

const text = (id: string, query = "", base = P) => alice.api("GET", `${base}/sources/${id}/derived/text${query}`);
const write = (id: string, body: Record<string, unknown>, who = alice) => who.api("PUT", `${P}/sources/${id}/derived/text`, body);
const hits = async (query: string, base = P) => (await alice.api("GET", `${base}/search?query=${encodeURIComponent(query)}`)).body.hits as { record_id: string; field: string }[];
const logOf = async (id: string, action: string) =>
  ((await alice.api("GET", `${P}/activity?entity_id=${id}&limit=100`)).body.items as { action: string; summary: string }[]).filter((i) => i.action === action).map((i) => i.summary);

const WEEK = "# Notes\n\nCrews plan by the week.\n";
const SHIFT = "# Notes\n\nCrews plan by the shift.\n";
const SUMMARY = "Plain words about the visit.\n";

describe("a source's derived text", () => {
  let id: string;

  it("is taken from the first attachment read, and follows that attachment's new versions", async () => {
    id = await source("Visit notes — Example Co, Sep 2026");
    const first = (await attach(id, "notes.md", WEEK)).file_version_id;
    expect((await alice.api("GET", `${P}/sources/${id}`)).body.derived_status).toBe("pending");
    expect((await text(id)).status).toBe(404);
    await h.worker.drain();
    const read = await text(id);
    expect(read.body).toMatchObject({
      of: "derived_text",
      text: WEEK,
      total_chars: WEEK.length,
      taken_from: { path: "notes.md", file_version_id: first },
      updated_by: { display_name: "WhatBuild", client: "parser" },
    });

    // A second attachment is read and kept beside it, and never takes its place.
    await attach(id, "summary.txt", SUMMARY);
    await h.worker.drain();
    expect((await text(id)).body).toMatchObject({ text: WEEK, etag: read.body.etag });
    const full = await alice.api("GET", `${P}/sources/${id}?detail=full`);
    expect(full.body.attachments.map((a: { path: string; is_text_source: boolean; text: { status: string } }) => [a.path, a.is_text_source, a.text.status])).toEqual([
      ["notes.md", true, "ready"],
      ["summary.txt", false, "ready"],
    ]);
    expect(full.body.text).toMatchObject({ chars: WEEK.length, etag: read.body.etag, taken_from: { path: "notes.md" } });

    // A new version of the attachment it was taken from replaces it.
    const second = (await attach(id, "notes.md", "# Notes\n\nCrews plan by the day.\n")).file_version_id;
    await h.worker.drain();
    const followed = await text(id);
    expect(followed.body).toMatchObject({ text: "# Notes\n\nCrews plan by the day.\n", taken_from: { path: "notes.md", file_version_id: second } });
    expect(followed.body.etag).not.toBe(read.body.etag);
    expect(await logOf(id, "derived")).toEqual([
      "Read the text of notes.md; it is the source’s derived text",
      "Read the text of summary.txt",
      "Read the text of notes.md; it is the source’s derived text",
    ]);
    // Search reads the text as it is now.
    expect(await hits("by the day")).toEqual([expect.objectContaining({ record_id: id, field: "text" })]);
    expect(await hits("by the week")).toEqual([]);
  });

  it("is never replaced by a reading once someone edits it", async () => {
    const before = await text(id);
    const edited = await write(id, { edits: [{ old_text: "by the day", new_text: "by the shift" }], expected_etag: before.body.etag });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ record_id: id, chars: SHIFT.length, taken_from: null, diff: [{ field: "text", removed: "day", added: "shift", after: ".\n" }] });
    expect(edited.body.etag).not.toBe(before.body.etag);

    // A new version of the attachment is read and kept with it; the text stays as edited.
    await attach(id, "notes.md", "# Notes\n\nCrews plan by the month.\n");
    await h.worker.drain();
    expect((await text(id)).body).toMatchObject({ text: SHIFT, etag: edited.body.etag, taken_from: null, updated_by: { display_name: "Alice Example" } });
    expect((await text(id, "?path=notes.md")).body).toMatchObject({ of: "attachment", path: "notes.md", status: "ready", text: "# Notes\n\nCrews plan by the month.\n" });
    // Read again, it still leaves the text alone.
    expect((await alice.api("POST", `${P}/sources/${id}/rederive`, { path: "notes.md" })).status).toBe(200);
    await h.worker.drain();
    expect((await text(id)).body.text).toBe(SHIFT);
    expect((await alice.api("GET", `${P}/sources/${id}`)).body).toMatchObject({ derived_status: "ready", text_from: null, text_chars: SHIFT.length });
    expect(await hits("by the shift")).toEqual([expect.objectContaining({ record_id: id, field: "text" })]);
  });

  it("is written whole, taken from an attachment, or removed, and each is logged", async () => {
    const cur = await text(id);
    const written = "# Written\n\nBy hand.\n";
    const whole = await write(id, { content: written, expected_etag: cur.body.etag });
    expect(whole.status, JSON.stringify(whole.body)).toBe(200);
    expect(whole.body).toMatchObject({ chars: written.length, taken_from: null });
    expect(whole.body).not.toHaveProperty("diff");

    const took = await write(id, { from_attachment: "summary.txt" });
    expect(took.body).toMatchObject({ chars: SUMMARY.length, taken_from: { path: "summary.txt" } });
    expect((await text(id)).body).toMatchObject({ text: SUMMARY, taken_from: { path: "summary.txt" } });
    // Taken from an attachment, it follows that attachment.
    await attach(id, "summary.txt", "Plainer words about the visit.\n");
    await h.worker.drain();
    expect((await text(id)).body.text).toBe("Plainer words about the visit.\n");

    // Removed, the source has attachments with text it does not use, and says so.
    const removed = await write(id, { content: "" });
    expect(removed.body).toMatchObject({ record_id: id, chars: 0, etag: null, taken_from: null });
    expect((await text(id)).status).toBe(404);
    expect((await alice.api("GET", `${P}/sources/${id}/text`)).status).toBe(404);
    const brief = await alice.api("GET", `${P}/sources/${id}`);
    expect(brief.body).toMatchObject({ derived_status: "awaiting_text", text_chars: 0, text_from: null });
    expect(brief.body.warnings).toEqual([expect.stringMatching(/^This source has an attachment with text but no derived text of its own/)]);
    expect(await hits("Plainer words")).toEqual([]);
    expect((await alice.api("GET", `${P}/sources/${id}?detail=full`)).body.text).toBeNull();

    const back = await write(id, { from_attachment: "notes.md" });
    expect(back.body.taken_from).toMatchObject({ path: "notes.md" });
    // Its text taken from one attachment, the source says which other has text that search never reads.
    expect((await alice.api("GET", `${P}/sources/${id}`)).body).toMatchObject({
      derived_status: "ready",
      text_from: "notes.md",
      warnings: [
        "This source's derived text is taken from notes.md, so the text read from summary.txt is kept but never searched. If its words should be found, write them into the derived text, the summary or the notes, or add it as a source of its own.",
      ],
    });
    expect((await text(id)).body.text).toBe("# Notes\n\nCrews plan by the month.\n");
    expect(await logOf(id, "text_written")).toEqual([
      "Took the derived text from notes.md",
      "Removed the derived text",
      "Took the derived text from summary.txt",
      "Rewrote the derived text",
      "Edited the derived text",
    ]);
  });

  it("refuses a stale etag, an attachment with no text to take, and anything but one way to write it", async () => {
    const cur = await text(id);
    const stale = await write(id, { content: "Changed.\n", expected_etag: "stale" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: cur.body.etag } });

    // An attachment still being read has no text yet, and a recording has none, read or not.
    await attach(id, "minutes-late.md", "# Late minutes\n\nRead after the rest.\n");
    await attach(id, "call.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    const reading = await write(id, { from_attachment: "minutes-late.md" });
    expect(reading.status).toBe(409);
    expect(reading.body.error.code).toBe("no_text");
    expect(reading.body.error.message).toMatch(/still being read/);
    const unread = await write(id, { from_attachment: "call.m4a" });
    expect(unread.body.error).toMatchObject({ code: "no_text", message: expect.stringMatching(/^call\.m4a has no text to take: it is needs_transcript/) });
    await h.worker.drain();
    const recording = await write(id, { from_attachment: "call.m4a" });
    expect(recording.status).toBe(409);
    expect(recording.body.error.code).toBe("no_text");
    expect(recording.body.error.message).toMatch(/was read as needs_transcript/);
    expect((await write(id, { from_attachment: "minutes.md" })).status).toBe(404);

    // Exactly one of content, edits and from_attachment.
    const two = await write(id, { content: "Two ways.\n", from_attachment: "notes.md" });
    expect(two.status).toBe(422);
    expect(two.body.error.message).toMatch(/^Send exactly one of content, edits and from_attachment, not content and from_attachment\. Nothing was changed\./);
    const three = await write(id, { content: "Three ways.\n", edits: [{ old_text: "month", new_text: "year" }], from_attachment: "notes.md" });
    expect(three.status).toBe(422);
    expect((await write(id, {})).status).toBe(422);
    // An edit that matches nothing changes nothing.
    expect((await write(id, { edits: [{ old_text: "by the fortnight", new_text: "by the year" }] })).body.error.code).toBe("edit_not_found");
    // Only editors write it.
    const viewer = await write(id, { content: "A viewer's words.\n" }, vic);
    expect(viewer.status).toBe(403);
    expect((await text(id)).body).toMatchObject({ etag: cur.body.etag, text: cur.body.text });

    // A source with no text has none to edit, and no etag to match.
    const bare = await source("Placeholder — Example Co");
    expect((await write(bare, { edits: [{ old_text: "a", new_text: "b" }] })).status).toBe(404);
    const noText = await write(bare, { content: "Words.\n", expected_etag: cur.body.etag });
    expect(noText.status).toBe(409);
    expect(noText.body.error.code).toBe("stale_etag");
    const tooLong = await write(bare, { content: "x".repeat(2_000_001) });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.code).toBe("too_long");
    expect((await write(bare, { content: "Words.\n" })).status).toBe(200);
    expect(await logOf(bare, "text_written")).toEqual(["Wrote the derived text"]);
    // An archived source is read, not written.
    await alice.api("POST", `${P}/sources/archive`, { record_ids: [bare] });
    expect((await write(bare, { content: "More words.\n" })).body.error.code).toBe("record_archived");
  });

  it("is read in windows by code point, and an attachment's own text by its path or a reading's id", async () => {
    const s = await source("Board photo notes — Example Co");
    const words = "Plan 📅 the week, then the day.\n";
    const cps = Array.from(words);
    expect((await write(s, { content: words })).body.chars).toBe(cps.length);
    const at = (offset: number, limit: number, extra = "") => text(s, `?offset=${offset}&limit=${limit}${extra}`);
    expect((await at(cps.indexOf("📅"), 1)).body).toMatchObject({ text: "📅", total_chars: cps.length, truncated: true });
    expect((await at(cps.indexOf("📅") + 2, 8)).body.text).toBe("the week");
    expect((await at(cps.length - 5, 100)).body).toMatchObject({ text: "day.\n", truncated: false });

    const note = "Monday column is full 📌.\n";
    await attach(s, "photo.txt", note);
    await h.worker.drain();
    const pin = Array.from(note).indexOf("📌");
    const own = await at(pin, 1, "&path=photo.txt");
    expect(own.body).toMatchObject({ record_id: s, of: "attachment", path: "photo.txt", status: "ready", text: "📌", total_chars: Array.from(note).length, truncated: true });
    // Written by hand, the derived text is no attachment's, so that reading left it alone.
    expect((await text(s)).body).toMatchObject({ text: words, taken_from: null });
    const reading = (await alice.api("GET", `${P}/sources/${s}/derivations`)).body.items[0];
    expect(reading).toMatchObject({ path: "photo.txt", status: "ready", is_current: true });
    expect((await text(s, `?derivation_id=${reading.derivation_id}`)).body).toMatchObject({ of: "attachment", derivation_id: reading.derivation_id, text: note });
    expect((await text(s, "?path=nothing.txt")).status).toBe(404);
    // A recording's own text is empty: it was never transcribed.
    await attach(s, "call.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    await h.worker.drain();
    expect((await text(s, "?path=call.m4a")).body).toMatchObject({ status: "needs_transcript", text: "", total_chars: 0 });
  });

  it("names an attachment by path for its manifest and to read it again, and asks which when a source has two", async () => {
    const s = await source("Two exports — Example Co");
    await attach(s, "a.md", "# A\n\nFirst export.\n");
    await attach(s, "b.md", "# B\n\nSecond export.\n");
    await h.worker.drain();
    // Without a path: the attachment the text was taken from, the first one read.
    const a = await alice.api("GET", `${P}/sources/${s}/derived/manifest`);
    expect(a.body).toMatchObject({ record_id: s, path: "a.md", status: "ready", parser: "markdown", text_chars: "# A\n\nFirst export.\n".length, duration_ms: null });
    expect(a.body).not.toHaveProperty("segment_count");
    const b = await alice.api("GET", `${P}/sources/${s}/derived/manifest?path=b.md`);
    expect(b.body).toMatchObject({ path: "b.md", status: "ready", text_chars: "# B\n\nSecond export.\n".length });

    // Written by hand, the text is no attachment's: a call must name one.
    await write(s, { content: "Both exports agree.\n" });
    const which = await alice.api("GET", `${P}/sources/${s}/derived/manifest`);
    expect(which.status).toBe(422);
    expect(which.body.error.message).toBe("Name the attachment with path: this source has 2 (a.md, b.md).");
    expect((await alice.api("POST", `${P}/sources/${s}/rederive`, {})).status).toBe(422);
    expect((await alice.api("POST", `${P}/sources/${s}/rederive`, { path: "c.md" })).status).toBe(404);
    expect((await alice.api("GET", `${P}/sources/${s}/derived/manifest?path=c.md`)).status).toBe(404);

    const queued = await alice.api("POST", `${P}/sources/${s}/rederive`, { path: "b.md" });
    expect(queued.body).toMatchObject({ record_id: s, path: "b.md", queued: true, previous_derivation_id: b.body.derivation_id });
    await h.worker.drain();
    const again = await alice.api("GET", `${P}/sources/${s}/derived/manifest?path=b.md`);
    expect(again.body.derivation_id).not.toBe(b.body.derivation_id);
    const list = (await alice.api("GET", `${P}/sources/${s}/derivations`)).body.items as { derivation_id: string; path: string; is_current: boolean }[];
    expect(list[0]).toMatchObject({ derivation_id: again.body.derivation_id, path: "b.md", is_current: true });
    expect(list.map((d) => [d.path, d.is_current]).sort()).toEqual([["a.md", true], ["b.md", false], ["b.md", true]]);
    expect((await text(s)).body.text).toBe("Both exports agree.\n");
    // With one attachment, it needs no path.
    const one = await source("One export — Example Co");
    await attach(one, "only.md", "# Only\n");
    await h.worker.drain();
    await write(one, { content: "Rewritten.\n" });
    expect((await alice.api("GET", `${P}/sources/${one}/derived/manifest`)).body).toMatchObject({ path: "only.md", status: "ready" });
  });
});

describe("copying a source to another product", () => {
  it("carries the derived text, following the copied attachment, and indexes the copy at once", async () => {
    const s = await source("Dispatcher interview — Example Co");
    await attach(s, "call.txt", "We route crews by radio, mostly before seven.\n");
    await h.worker.drain();
    await alice.api("PUT", `${P}/sources/${s}/agent-notes/summary`, { content: "Routing happens by radio." });
    await alice.api("PUT", `${P}/sources/${s}/agent-notes/notes`, { content: "Ask for the dispatch log." });
    await alice.api("POST", `${P}/sources/${s}/annotations`, { note: "Ask about the radio handsets." });
    const original = await text(s);

    const copy = await alice.api("POST", `${P}/sources/${s}/copy`, { to_product: "annex" });
    expect(copy.status, JSON.stringify(copy.body)).toBe(200);
    const c = copy.body.record_id as string;
    const copied = await text(c, "", annex);
    expect(copied.body).toMatchObject({ text: original.body.text, taken_from: { path: "call.txt" } });
    expect(copied.body.taken_from.file_version_id).not.toBe(original.body.taken_from.file_version_id);
    const full = await alice.api("GET", `${annex}/sources/${c}?detail=full`);
    expect(full.body).toMatchObject({ derived_status: "ready", text_from: "call.txt", copied_from: { record_id: s }, annotations: [], agent_notes: [] });
    expect(full.body.attachments).toEqual([expect.objectContaining({ path: "call.txt", is_text_source: true, file_version_id: copied.body.taken_from.file_version_id })]);

    // Search in the other product finds the copy before the worker reads anything.
    expect(await hits("route crews", annex)).toEqual([expect.objectContaining({ record_id: c, field: "text" })]);
    expect((await hits("Dispatcher interview", annex)).map((x) => [x.record_id, x.field])).toEqual([[c, "title"]]);
    // The summary, notes and comments stay with the original.
    for (const words of ["happens by radio", "dispatch log", "radio handsets"]) {
      expect(await hits(words, annex), words).toEqual([]);
      expect((await hits(words)).map((x) => x.record_id), words).toEqual([s]);
    }

    // The copy's attachment is read afresh, and its text follows it; the original's is untouched.
    await h.worker.drain();
    expect((await text(c, "", annex)).body).toMatchObject({
      text: original.body.text,
      taken_from: { path: "call.txt", file_version_id: copied.body.taken_from.file_version_id },
      updated_by: { client: "parser" },
    });
    expect((await text(s)).body.etag).toBe(original.body.etag);
    expect(await hits("route crews", annex)).toEqual([expect.objectContaining({ record_id: c, field: "text" })]);
    // The web app reads each whole under its own product, and neither under the other's.
    expect((await alice.api("GET", `${annex}/sources/${c}/text`)).body).toBe(original.body.text);
    expect((await alice.api("GET", `${annex}/sources/${s}/text`)).status).toBe(404);
    expect((await alice.api("GET", `${P}/sources/${c}/text`)).status).toBe(404);
  });

  it("carries a text someone wrote as they wrote it, and no reading replaces it", async () => {
    const s = await source("Typed-up notes — Example Co");
    await attach(s, "scan.txt", "Scanned words.\n");
    await h.worker.drain();
    await write(s, { content: "Typed up by hand.\n" });
    const copy = await alice.api("POST", `${P}/sources/${s}/copy`, { to_product: "annex" });
    expect(copy.status).toBe(200);
    await h.worker.drain();
    const copied = await text(copy.body.record_id, "", annex);
    expect(copied.body).toMatchObject({ text: "Typed up by hand.\n", taken_from: null, updated_by: { display_name: "Alice Example" } });
    expect((await alice.api("GET", `${annex}/sources/${copy.body.record_id}?detail=full`)).body.attachments).toEqual([
      expect.objectContaining({ path: "scan.txt", is_text_source: false, text: expect.objectContaining({ status: "ready" }) }),
    ]);
  });
});
