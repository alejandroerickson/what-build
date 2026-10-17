import { RESET_CONFIRMATION } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncSandboxTenant } from "../src/public-sandbox.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Search reads a source's title, tags, summary, derived text, notes and comments, through a search
// index of their pieces, and never its attachments. A hit names the field it is in, and where:
// code points into that field, so the derived text around it reads back exactly.

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Dana>We export everything to a spreadsheet every Friday 📊.

00:00:05.000 --> 00:00:09.000
<v Sam>Why Friday?

00:00:09.000 --> 00:00:14.000
<v Dana>Because that is when the numbers close and the pricing review happens.
`;

/** A text long enough to be searched in two pieces, with characters outside the basic plane before its words. */
const LONG =
  [
    `Trucks 🚚🚚🚚 leave the yard at six, and every crew lead checks the roster first. ${"The yard is busy before dawn. ".repeat(20)}`,
    "Second paragraph about routes. ".repeat(25).trim(),
    "Third paragraph about the yard. ".repeat(25).trim(),
    "At the end of the day, drivers fill in the loading dock sign-in sheet before they go home.",
  ].join("\n\n") + "\n";

let h: Harness;
let alice: Browser;
let P: string;
const ids: Record<"call" | "recording" | "arriving" | "unused" | "empty" | "long", string> = { call: "", recording: "", arriving: "", unused: "", empty: "", long: "" };
let dispatch: string; // a comment on the call
let overtime: string; // an archived comment on the call

type Hit = { record_id: string; field: string; annotation_id?: string; char_start: number; char_end: number; snippet: string; score?: number };

async function search(query: string, extra = "", base = P, who = alice) {
  const r = await who.api("GET", `${base}/search?query=${encodeURIComponent(query)}${extra}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { hits: Hit[]; records: Record<string, { title: string }>; coverage: { searched: string[]; records_considered: number; records_without_text: number; statement: string } };
}

const where = (hits: Hit[]) => hits.map((x) => ({ record_id: x.record_id, field: x.field, ...(x.annotation_id ? { annotation_id: x.annotation_id } : {}), char_start: x.char_start, char_end: x.char_end }));

async function attach(base: string, who: Browser, recordId: string, path: string, body: string | Uint8Array) {
  const grant = await who.api("POST", `${base}/sources/${recordId}/uploads`, { record_id: recordId, path });
  expect(grant.status, JSON.stringify(grant.body)).toBe(201);
  expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body })).status).toBe(201);
}

async function source(base: string, who: Browser, title: string, tags: string[] = []) {
  const r = await who.api("POST", `${base}/sources`, { title, tags });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.record_id as string;
}

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Search Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;

  // A call with a second attachment, a summary, notes and two comments, one of them archived.
  ids.call = await source(P, alice, "Crew lead interview — Example Co, Sep 2026", ["interview", "scheduling"]);
  await attach(P, alice, ids.call, "call.vtt", VTT);
  await attach(P, alice, ids.call, "recorder-export.txt", "Zebrafish notes from the recorder.\n");
  expect((await alice.api("PUT", `${P}/sources/${ids.call}/agent-notes/summary`, { content: "Crews plan by the job, never by the hour." })).status).toBe(200);
  expect((await alice.api("PUT", `${P}/sources/${ids.call}/agent-notes/notes`, { content: "Follow up about the dispatch board." })).status).toBe(200);
  dispatch = (await alice.api("POST", `${P}/sources/${ids.call}/annotations`, { note: "The dispatch board came up twice." })).body.annotation_id;
  const archived = await alice.api("POST", `${P}/sources/${ids.call}/annotations`, { note: "Mentions overtime rules." });
  overtime = archived.body.annotation_id;
  expect((await alice.api("PATCH", `${P}/annotations/${overtime}`, { expected_etag: archived.body.etag, archived: true })).status).toBe(200);

  // Sources without a derived text, each for its own reason.
  ids.recording = await source(P, alice, "Site visit recording — Example Co");
  await attach(P, alice, ids.recording, "visit.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
  const arriving = await alice.api("POST", `${P}/sources/with-upload`, { title: "Planning survey export — Example Co", path: "survey.csv" });
  ids.arriving = arriving.body.record.record_id;
  ids.unused = await source(P, alice, "Exported notes — Example Co");
  await attach(P, alice, ids.unused, "notes.md", "# Notes\n\nKept, but not the source's text.\n");
  ids.empty = await source(P, alice, "Placeholder — Example Co");
  ids.long = await source(P, alice, "Yard routine — Example Co");
  expect((await alice.api("PUT", `${P}/sources/${ids.long}/derived/text`, { content: LONG })).status).toBe(200);
  await h.worker.drain();
  expect((await alice.api("PUT", `${P}/sources/${ids.unused}/derived/text`, { content: "" })).status).toBe(200);
});
afterAll(async () => h?.close());

describe("search over what a source says", () => {
  it("finds a source by its title and its tags, and says where in each", async () => {
    const title = await search("lead interview");
    expect(where(title.hits)).toEqual([{ record_id: ids.call, field: "title", char_start: 5, char_end: 19 }]);
    expect(title.records[ids.call]).toMatchObject({ title: "Crew lead interview — Example Co, Sep 2026", tags: ["interview", "scheduling"] });
    // The tags are searched as one text: "interview, scheduling".
    expect(where((await search("scheduling")).hits)).toEqual([{ record_id: ids.call, field: "tags", char_start: 11, char_end: 21 }]);
  });

  it("finds its summary, notes and comments, naming the comment, and leaves an archived comment out unless asked", async () => {
    expect(where((await search("by the job")).hits)).toEqual([{ record_id: ids.call, field: "summary", char_start: 11, char_end: 21 }]);
    expect(where((await search("dispatch board")).hits)).toEqual([
      { record_id: ids.call, field: "notes", char_start: 20, char_end: 34 },
      { record_id: ids.call, field: "comment", annotation_id: dispatch, char_start: 4, char_end: 18 },
    ]);
    const ranked = await search("dispatch AND board", "&mode=ranked");
    expect(ranked.hits.map((x) => [x.field, x.annotation_id ?? null]).sort()).toEqual([["comment", dispatch], ["notes", null]]);
    for (const x of ranked.hits) expect(x.score).toBeGreaterThan(0);
    expect((await search("overtime")).hits).toEqual([]);
    expect(where((await search("overtime", "&include_archived=true")).hits)).toEqual([
      { record_id: ids.call, field: "comment", annotation_id: overtime, char_start: 9, char_end: 17 },
    ]);
  });

  it("reads a hit's offsets back exactly through the derived text, counting code points", async () => {
    const found = await search("numbers close");
    expect(where(found.hits)).toEqual([expect.objectContaining({ record_id: ids.call, field: "text" })]);
    const hit = found.hits[0]!;
    const read = async (id: string, from: number, to: number) => (await alice.api("GET", `${P}/sources/${id}/derived/text?offset=${from}&limit=${to - from}`)).body.text as string;
    expect(await read(ids.call, hit.char_start, hit.char_end)).toBe("numbers close");
    expect(hit.snippet).toContain("numbers close");

    // In a longer text, a hit in its second piece reads back as exactly, past characters outside the basic plane.
    const phrase = "loading dock sign-in sheet";
    const late = (await search(phrase)).hits;
    expect(where(late)).toEqual([{ record_id: ids.long, field: "text", char_start: Array.from(LONG.slice(0, LONG.indexOf(phrase))).length, char_end: Array.from(LONG.slice(0, LONG.indexOf(phrase))).length + phrase.length }]);
    expect(await read(ids.long, late[0]!.char_start, late[0]!.char_end)).toBe(phrase);
    // A ranked hit is the piece the words are in: from the paragraph where it starts to where it ends.
    const piece = (await search("loading AND dock", "&mode=ranked")).hits;
    expect(piece).toHaveLength(1);
    expect(piece[0]!.char_end).toBe(Array.from(LONG).length);
    expect(await read(ids.long, piece[0]!.char_start, piece[0]!.char_end)).toBe(LONG.slice(LONG.indexOf("Third paragraph")));
    // Each piece is matched alone: words in two pieces do not meet.
    expect((await search("trucks AND drivers", "&mode=ranked")).hits).toEqual([]);
  });

  it("never finds what an attachment says, though its text is read and kept", async () => {
    expect((await search("zebrafish")).hits).toEqual([]);
    expect((await search("zebrafish", "&mode=ranked")).hits).toEqual([]);
    expect((await alice.api("GET", `${P}/search?mode=plain&strict=true&query=zebrafish`)).body.results).toEqual([]);
    const kept = await alice.api("GET", `${P}/sources/${ids.call}/derived/text?path=recorder-export.txt`);
    expect(kept.body).toMatchObject({ of: "attachment", status: "ready", text: "Zebrafish notes from the recorder.\n" });
    // Nor the text an attachment holds that its source does not use.
    expect((await search("not the source's text")).hits).toEqual([]);
  });

  it("says what it covered, and why each source without a derived text has none", async () => {
    const statuses = await Promise.all((["recording", "arriving", "unused", "empty"] as const).map(async (k) => (await alice.api("GET", `${P}/sources/${ids[k]}`)).body.derived_status));
    expect(statuses).toEqual(["needs_transcript", "pending", "awaiting_text", "awaiting_file"]);
    const { coverage } = await search("crews");
    expect(coverage).toEqual({
      searched: ["title", "tags", "summary", "text", "notes", "comments"],
      records_considered: 6,
      records_without_text: 4,
      statement:
        "Searched the title, tags, summary, notes and comments of 6 sources, and the derived text of the 2 that have one. " +
        "No derived text: 1 is still being read; 1 has no attachment yet; 1 has an attachment whose text it does not use; 1 is a recording with no transcript (add the transcript as an attachment). " +
        "Attachments are never searched.",
    });
    // The filters narrow what it covered.
    expect((await search("crews", `&record_id=${ids.long}`)).coverage).toMatchObject({ records_considered: 1, records_without_text: 0 });
  });

  it("in plain mode, gives each source once, with the places it says the words and the field of each", async () => {
    const r = await alice.api("GET", `${P}/search?mode=plain&query=${encodeURIComponent("dispatch board")}`);
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty("passages_matched");
    expect(r.body.counts).not.toHaveProperty("passage");
    expect(r.body.hits_matched).toBe(2);
    const call = r.body.results.find((x: { kind: string; id: string }) => x.kind === "source" && x.id === ids.call);
    expect(call.hit_count).toBe(2);
    expect(call.hits.map((x: { field: string; annotation_id: string | null; char_start: number }) => [x.field, x.annotation_id, x.char_start])).toEqual([
      ["notes", null, 0],
      ["comment", dispatch, 0],
    ]);
    // A hit in the derived text gives the words as a reader sees them, and where its piece starts.
    const said = await alice.api("GET", `${P}/search?mode=plain&query=${encodeURIComponent("numbers close")}`);
    const hit = said.body.results.find((x: { id: string }) => x.id === ids.call).hits[0];
    expect(hit).toMatchObject({ field: "text", annotation_id: null, char_start: 0 });
    expect(hit.text).toContain("Dana (0:09): Because that is when the numbers close");
    expect(hit.marks.map(([a, b]: [number, number]) => hit.text.slice(a, b))).toEqual(["numbers", "close"]);
    // An archived comment is not found here either.
    expect((await alice.api("GET", `${P}/search?mode=plain&strict=true&query=overtime`)).body.results).toEqual([]);
  });

  it("follows every change to those texts in the same write", async () => {
    // A comment rewritten, then deleted.
    const c = (await alice.api("GET", `${P}/sources/${ids.call}/annotations`)).body.items.find((x: { annotation_id: string }) => x.annotation_id === dispatch);
    const edited = await alice.api("PATCH", `${P}/annotations/${dispatch}`, { expected_etag: c.etag, note: "The planning wall came up twice." });
    expect(edited.status).toBe(200);
    expect(where((await search("dispatch board")).hits)).toEqual([{ record_id: ids.call, field: "notes", char_start: 20, char_end: 34 }]);
    expect((await search("planning wall")).hits.map((x) => x.annotation_id)).toEqual([dispatch]);
    const gone = await alice.api("DELETE", `${P}/annotations/${dispatch}`, { expected_etag: edited.body.etag, reason: "Duplicate", confirm: "delete permanently" });
    expect(gone.status).toBe(200);
    expect((await search("planning wall")).hits).toEqual([]);
    // A comment restored is found again.
    const archived = (await alice.api("GET", `${P}/sources/${ids.call}/annotations?include_archived=true`)).body.items.find((x: { annotation_id: string }) => x.annotation_id === overtime);
    expect((await alice.api("PATCH", `${P}/annotations/${overtime}`, { expected_etag: archived.etag, archived: false })).status).toBe(200);
    expect((await search("overtime")).hits.map((x) => x.annotation_id)).toEqual([overtime]);

    // The summary rewritten and the notes cleared.
    await alice.api("PUT", `${P}/sources/${ids.call}/agent-notes/summary`, { content: "Crews plan by the week." });
    await alice.api("PUT", `${P}/sources/${ids.call}/agent-notes/notes`, { content: "" });
    expect((await search("by the job")).hits).toEqual([]);
    expect((await search("dispatch board")).hits).toEqual([]);
    expect((await search("plan by the week")).hits.map((x) => x.field)).toEqual(["summary"]);

    // The title and tags changed.
    const got = await alice.api("GET", `${P}/sources/${ids.call}`);
    expect((await alice.api("PATCH", `${P}/sources/${ids.call}`, { expected_etag: got.body.etag, title: "Dispatcher interview — Example Co, Sep 2026", tags: ["interview", "routing"] })).status).toBe(200);
    expect((await search("lead interview")).hits).toEqual([]);
    expect((await search("Dispatcher interview")).hits.map((x) => x.field)).toEqual(["title"]);
    expect((await search("scheduling")).hits).toEqual([]);
    expect((await search("routing")).hits.map((x) => x.field)).toEqual(["tags"]);

    // Archived, a source is out of search; restored, it is back.
    await alice.api("POST", `${P}/sources/archive`, { record_ids: [ids.long] });
    expect((await search("loading dock")).hits).toEqual([]);
    expect((await search("loading dock", "&include_archived=true")).hits).toHaveLength(1);
    await alice.api("POST", `${P}/sources/restore`, { record_ids: [ids.long] });
    expect((await search("loading dock")).hits).toHaveLength(1);
  });

  it("places a match in the words as written, whatever the case of the query", async () => {
    // İ lowercases to two code units; the match is still placed by the words as written.
    await alice.api("PUT", `${P}/sources/${ids.call}/agent-notes/notes`, { content: "İzmir depot: Night crews swap trucks." });
    expect(where((await search("NIGHT CREWS")).hits)).toEqual([{ record_id: ids.call, field: "notes", char_start: 13, char_end: 24 }]);
  });
});

describe("a public sandbox reset", () => {
  let olive: Browser;
  let T: string;
  let S: string;
  let visit: string;
  let second: string;
  let late: string;

  beforeAll(async () => {
    olive = await h.signIn("olive@example.com", "Olive Owner");
    const t = await olive.api("POST", "/api/v1/tenants", { name: "Reset Sandbox" });
    T = `/api/v1/tenants/${t.body.tenant.slug}`;
    const p = await olive.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Showcase" });
    S = `/api/v1/p/${p.body.path}`;
    expect(await syncSandboxTenant(h.db, t.body.tenant.slug, () => {})).toBe(t.body.tenant.tenant_id);
    // No scheduled reset while the test runs.
    const settings = (await olive.api("GET", `${T}/sandbox/settings`)).body;
    expect((await olive.api("PATCH", `${T}/sandbox/settings`, { expected_etag: settings.etag, reset_enabled: false })).status).toBe(200);

    visit = await source(S, olive, "Baseline visit notes — Example Co");
    await attach(S, olive, visit, "visit.md", "# Visit\n\nCrews text the office every Friday.\n");
    second = await source(S, olive, "Second visit — Example Co");
    await attach(S, olive, second, "second.md", "# Second\n\nCrews swap shifts by text.\n");
    await h.worker.drain();
    expect((await olive.api("PUT", `${S}/sources/${visit}/agent-notes/summary`, { content: "Fridays matter most." })).status).toBe(200);
    // An attachment that arrives just before the baseline is saved, and is not read yet.
    late = await source(S, olive, "Late notes — Example Co");
    await attach(S, olive, late, "late.md", "# Late\n\nThe dispatcher keeps a paper log.\n");
    expect((await olive.api("POST", `${T}/sandbox/baselines`, { note: "Three sources" })).status).toBe(200);
  });

  it("rebuilds the search index, so search finds what it put back at once", async () => {
    // After the baseline: a text rewritten, a summary cleared, a source deleted.
    expect((await olive.api("PUT", `${S}/sources/${visit}/derived/text`, { content: "Replaced after the baseline.\n" })).status).toBe(200);
    expect((await olive.api("PUT", `${S}/sources/${visit}/agent-notes/summary`, { content: "" })).status).toBe(200);
    const impact = await olive.api("GET", `${S}/sources/${second}/delete-impact`);
    expect((await olive.api("DELETE", `${S}/sources/${second}`, { expected_etag: impact.body.etag, reason: "Sample", confirm: "delete permanently" })).status).toBe(200);
    expect((await search("every Friday", "", S, olive)).hits).toEqual([]);
    expect((await search("swap shifts", "", S, olive)).hits).toEqual([]);

    const reset = await olive.api("POST", `${T}/sandbox/reset`, { confirm: RESET_CONFIRMATION });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    // Before the worker runs.
    expect((await search("every Friday", "", S, olive)).hits.map((x) => [x.record_id, x.field])).toEqual([[visit, "text"]]);
    expect((await search("Replaced after the baseline", "", S, olive)).hits).toEqual([]);
    expect((await search("matter most", "", S, olive)).hits.map((x) => [x.record_id, x.field])).toEqual([[visit, "summary"]]);
    expect((await search("swap shifts", "", S, olive)).hits.map((x) => [x.record_id, x.field])).toEqual([[second, "text"]]);
    expect((await search("Second visit", "", S, olive)).hits.map((x) => [x.record_id, x.field])).toEqual([[second, "title"]]);
  });

  it("queues a reading of an attachment the baseline never read, quietly, once", async () => {
    const version = (await olive.api("GET", `${S}/sources/${late}?detail=full`)).body.attachments[0].file_version_id;
    const queued = await sql<{ payload: Record<string, unknown> }>`
      select payload from jobs where kind = 'derive' and done_at is null and payload->>'record_id' = ${late}`.execute(h.db);
    expect(queued.rows.map((j) => j.payload)).toEqual([{ record_id: late, file_version_id: version, quiet: true }]);
    expect((await olive.api("GET", `${S}/sources/${late}`)).body.derived_status).toBe("pending");
    // The others were read before the baseline was saved: nothing reads them again.
    const others = await sql<{ n: number }>`select count(*)::int as n from jobs where kind = 'derive' and done_at is null and payload->>'record_id' in (${visit}, ${second})`.execute(h.db);
    expect(others.rows[0]!.n).toBe(0);

    await h.worker.drain();
    expect((await olive.api("GET", `${S}/sources/${late}/derived/text`)).body).toMatchObject({ text: "# Late\n\nThe dispatcher keeps a paper log.\n", taken_from: { path: "late.md" } });
    expect((await search("paper log", "", S, olive)).hits.map((x) => [x.record_id, x.field])).toEqual([[late, "text"]]);
    // Read for the reset, not by anyone: it leaves no line in the activity log.
    const log = (await olive.api("GET", `${S}/activity?entity_id=${late}`)).body.items as { action: string }[];
    expect(log.map((i) => i.action)).not.toContain("derived");
  });
});
