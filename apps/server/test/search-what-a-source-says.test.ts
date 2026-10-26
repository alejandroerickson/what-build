import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  const unused = (await alice.api("GET", `${P}/sources/${ids.unused}/derived/text`)).body.etag;
  expect((await alice.api("PUT", `${P}/sources/${ids.unused}/derived/text`, { content: "", expected_etag: unused })).status).toBe(200);
});

/** The etag of a source's summary or notes, which a write over it names. */
const noteEtag = async (base: string, who: Browser, recordId: string, kind: "summary" | "notes") => (await who.api("GET", `${base}/sources/${recordId}/agent-notes/${kind}`)).body.etag as string;
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
    expect((await alice.api("PUT", `${P}/sources/${ids.call}/agent-notes/summary`, { content: "Crews plan by the week.", expected_etag: await noteEtag(P, alice, ids.call, "summary") })).status).toBe(200);
    expect((await alice.api("PUT", `${P}/sources/${ids.call}/agent-notes/notes`, { content: "", expected_etag: await noteEtag(P, alice, ids.call, "notes") })).status).toBe(200);
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
    expect((await alice.api("PUT", `${P}/sources/${ids.call}/agent-notes/notes`, { content: "İzmir depot: Night crews swap trucks." })).status).toBe(200);
    expect(where((await search("NIGHT CREWS")).hits)).toEqual([{ record_id: ids.call, field: "notes", char_start: 13, char_end: 24 }]);
  });
});

/** A text in two pieces: the first says "gate code" three times, past a character outside the basic plane, the second once more. */
const GATE_LOG =
  [
    "Gate code changed on Monday 🚧. The new gate code is on the board, and the lead keeps the GATE CODE card.",
    "Routes are planned the night before. ".repeat(22).trim(),
    "Trucks are loaded in the order of the route. ".repeat(18).trim(),
    "Drivers ask for the gate code at night.",
  ].join("\n\n") + "\n";

const codePoints = (s: string) => Array.from(s).length;

describe("every place, as typed", () => {
  let D: string;
  const src: Record<"log" | "roster" | "fuel" | "route" | "planB" | "planXB" | "crane" | "invoices" | "quarter", string> = {
    log: "", roster: "", fuel: "", route: "", planB: "", planXB: "", crane: "", invoices: "", quarter: "",
  };
  let roll: string; // a comment on the roster

  beforeAll(async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Depot Co" });
    const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Depot" });
    D = `/api/v1/p/${p.body.path}`;
    src.log = await source(D, alice, "Depot log — Example Co");
    expect((await alice.api("PUT", `${D}/sources/${src.log}/derived/text`, { content: GATE_LOG })).status).toBe(200);
    src.roster = await source(D, alice, "Crew roster — Example Co");
    expect((await alice.api("PUT", `${D}/sources/${src.roster}/derived/text`, { content: "The vanguard crew leaves first.\n" })).status).toBe(200);
    expect((await alice.api("PUT", `${D}/sources/${src.roster}/agent-notes/notes`, { content: "Postcodes are on the label." })).status).toBe(200);
    roll = (await alice.api("POST", `${D}/sources/${src.roster}/annotations`, { note: "The code is on the roll call." })).body.annotation_id;
    src.fuel = await source(D, alice, "Fuel report — Example Co");
    expect((await alice.api("PUT", `${D}/sources/${src.fuel}/agent-notes/notes`, { content: "Fuel use is down 10% since May." })).status).toBe(200);
    src.route = await source(D, alice, "Route survey — Example Co");
    expect((await alice.api("PUT", `${D}/sources/${src.route}/agent-notes/notes`, { content: "Route 105 is closed for repairs." })).status).toBe(200);
    src.planB = await source(D, alice, "Plan_B rollout — Example Co");
    src.planXB = await source(D, alice, "PlanXB rollout — Example Co");
    src.crane = await source(D, alice, "Crane ticket — Example Co");
    expect((await alice.api("PUT", `${D}/sources/${src.crane}/derived/text`, { content: "Ticket CB26-20734 is open for the crane. Ticket CB26-20733 was the pump.\n" })).status).toBe(200);
    src.invoices = await source(D, alice, "Depot ledger — Example Co");
    expect((await alice.api("PUT", `${D}/sources/${src.invoices}/derived/text`, { content: "The invoices for the crane were logged 2026-05-01T10:00 by the depot.\n" })).status).toBe(200);
    src.quarter = await source(D, alice, "Quarter review — Example Co");
    expect((await alice.api("PUT", `${D}/sources/${src.quarter}/derived/text`, { content: "The Q3 planning call moved to mid 2026, once the COVID 19 rules ended. It was noted 2026 05 01.\n" })).status).toBe(200);
  });

  it("gives every place a source says the words as a hit of its own, each read back exactly", async () => {
    const { hits } = await search("gate code", `&record_id=${src.log}`, D);
    const places = [...GATE_LOG.matchAll(/gate code/gi)].map((m) => ({ start: codePoints(GATE_LOG.slice(0, m.index)), words: m[0] }));
    expect(places.map((x) => x.words)).toEqual(["Gate code", "gate code", "GATE CODE", "gate code"]);
    expect(where(hits)).toEqual(places.map((x) => ({ record_id: src.log, field: "text", char_start: x.start, char_end: x.start + 9 })));
    for (const [k, hit] of hits.entries()) {
      const read = await alice.api("GET", `${D}/sources/${src.log}/derived/text?offset=${hit.char_start}&limit=${hit.char_end - hit.char_start}`);
      expect(read.body.text).toBe(places[k]!.words);
      // Each snippet is around its own place.
      expect(hit.snippet).toContain(places[k]!.words);
    }
    expect(hits[3]!.snippet).toContain("Drivers ask for the gate code at night.");
  });

  it("never cuts a character in two at a snippet's edge", async () => {
    // The window around these words starts in the middle of the run of 🚧, each two code units.
    const signs = await source(D, alice, "Site signs — Example Co");
    expect((await alice.api("PUT", `${D}/sources/${signs}/derived/text`, { content: `${"🚧".repeat(100)}  gate code${" is on the board".repeat(12)}\n` })).status).toBe(200);
    const [hit] = (await search("gate code", `&record_id=${signs}`, D)).hits;
    expect(hit!.char_start).toBe(102);
    expect(hit!.snippet.startsWith("…🚧")).toBe(true);
    expect(hit!.snippet).toContain("🚧  gate code is on the board");
    expect(Buffer.from(hit!.snippet, "utf8").toString("utf8")).toBe(hit!.snippet);
  });

  it("counts hits against the limit and pages through them, inside a piece and across pieces, without repeating or skipping one", async () => {
    const all = (await search("gate code", `&record_id=${src.log}`, D)).hits;
    for (const limit of [1, 2, 3]) {
      const paged: Hit[] = [];
      let cursor: string | null = null;
      do {
        const page = (await search("gate code", `&record_id=${src.log}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`, D)) as Awaited<ReturnType<typeof search>> & { next_cursor: string | null };
        expect(page.hits.length).toBeLessThanOrEqual(limit);
        paged.push(...page.hits);
        cursor = page.next_cursor;
      } while (cursor);
      expect(paged, `limit ${limit}`).toEqual(all);
    }
    // A cursor from before every place was a hit names a piece, and resumes after it.
    const old = Buffer.from(JSON.stringify([src.log, 4, "", 0])).toString("base64url");
    expect(where((await search("gate code", `&record_id=${src.log}&cursor=${old}`, D)).hits)).toEqual(where(all.slice(3)));
    const wrong = await alice.api("GET", `${D}/search?query=gate&cursor=${Buffer.from(JSON.stringify(["x", 1])).toString("base64url")}`);
    expect(wrong.body.error).toMatchObject({ code: "invalid_cursor" });
  });

  it("refuses a cursor changed by hand as not this search's, before it reaches the database", async () => {
    const cursor = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const tampered: [string, unknown][] = [
      ["substring", [src.log, 4.5, "", 0, 3]],
      ["substring", [src.log, 4, "", 3e9, 3]],
      ["substring", [`${src.log}\u0000`, 4, "", 0, 3]],
      ["substring", [src.log, 4, "\u0000", 0]],
      ["substring", [src.log, 4, "", 0, -1]],
      ["substring", [src.log, 7, "", 0]],
      ["ranked", -1],
      ["ranked", 1.5],
      ["ranked", 3e9],
    ];
    for (const [mode, c] of tampered) {
      const r = await alice.api("GET", `${D}/search?mode=${mode}&query=gate&cursor=${cursor(c)}`);
      expect(r.status, `${mode} ${JSON.stringify(c)}`).toBe(422);
      expect(r.body.error.code).toBe("invalid_cursor");
    }
    // A cursor as search writes it still pages.
    expect((await alice.api("GET", `${D}/search?mode=ranked&query=gate&cursor=${cursor(1)}`)).status).toBe(200);
  });

  it("matches the query as sent, spaces included, and refuses one that is only spaces", async () => {
    expect(where((await search("code", `&record_id=${src.roster}`, D)).hits)).toEqual([
      { record_id: src.roster, field: "notes", char_start: 4, char_end: 8 },
      { record_id: src.roster, field: "comment", annotation_id: roll, char_start: 4, char_end: 8 },
    ]);
    // " code" is not in "Postcodes".
    expect(where((await search(" code", `&record_id=${src.roster}`, D)).hits)).toEqual([{ record_id: src.roster, field: "comment", annotation_id: roll, char_start: 3, char_end: 8 }]);
    // Ranked mode reads terms, so spaces around them change nothing.
    expect((await search("  gate AND code  ", `&mode=ranked&record_id=${src.log}`, D)).hits).toHaveLength(2);
    for (const mode of ["substring", "ranked", "plain"]) {
      const r = await alice.api("GET", `${D}/search?mode=${mode}&query=${encodeURIComponent("   ")}`);
      expect(r.status, mode).toBe(422);
      expect(r.body.error).toMatchObject({ code: "invalid_input", message: expect.stringContaining("holds only spaces") });
    }
  });

  it("in plain mode, takes a space after the last word to say it is finished", async () => {
    const plain = async (q: string) => (await alice.api("GET", `${D}/search?mode=plain&strict=true&query=${encodeURIComponent(q)}`)).body;
    // Still being typed, a short word matches the start of a longer one; finished, only itself.
    expect((await plain("van")).results.map((x: { id: string }) => x.id)).toEqual([src.roster]);
    expect(await plain("van ")).toMatchObject({ query: "van ", results: [] });
  });

  it("finds %, _ and \\ as typed, in search and in every list's query", async () => {
    expect((await search("10%", "", D)).hits.map((x) => x.record_id)).toEqual([src.fuel]);
    const a = await alice.api("POST", `${D}/assumptions`, { statement: "Idle time falls 10% when crews start at the yard.", body: "The fuel report says so." });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect((await alice.api("POST", `${D}/assumptions`, { statement: "Route 105 stays closed until spring.", body: "The route survey says so." })).status).toBe(201);
    const found = await alice.api("GET", `${D}/search?scope=assumptions&query=${encodeURIComponent("10%")}`);
    expect(found.body.assumptions.map((x: { id: string }) => x.id)).toEqual([a.body.id]);
    const listed = await alice.api("GET", `${D}/assumptions?query=${encodeURIComponent("10%")}`);
    expect(listed.body.items.map((x: { id: string }) => x.id)).toEqual([a.body.id]);
    const sources = await alice.api("GET", `${D}/sources?query=${encodeURIComponent("plan_b")}`);
    expect(sources.body.records.map((x: { record_id: string }) => x.record_id)).toEqual([src.planB]);
    const o = await alice.api("POST", `${D}/outcomes`, { title: "Crews spend 50% less time waiting at the gate" });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect((await alice.api("POST", `${D}/outcomes`, { title: "Leads plan 500 jobs a week without overtime" })).status).toBe(201);
    const outcomes = await alice.api("GET", `${D}/outcomes?query=${encodeURIComponent("50%")}`);
    expect(outcomes.body.items.map((x: { outcome_id: string }) => x.outcome_id)).toEqual([o.body.outcome_id]);
    // A backslash is a character too, not an escape.
    expect((await alice.api("GET", `${D}/outcomes?query=${encodeURIComponent("5\\0")}`)).body.items).toEqual([]);
  });

  it("over MCP, says what it searched in search_scope beside the scope every answer carries", async () => {
    const token = await h.connectAgent(alice, "search-agent");
    const client = new Client({ name: "search-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const path = D.replace("/api/v1/p/", "");
    const call = async (args: Record<string, unknown>) => {
      const r = await client.callTool({ name: "search", arguments: { product: path, ...args } });
      expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0]!.text);
    };
    const all = await call({ query: "10%", scope: "all" });
    expect(all).toMatchObject({ search_scope: "all", scope: { product: { path } } });
    expect(all.hits.map((x: Hit) => x.record_id)).toEqual([src.fuel]);
    expect(all.assumptions).toHaveLength(1);
    expect(await call({ query: "gate code" })).toMatchObject({ search_scope: "sources", scope: { product: { path } } });
    // Over REST there is no such echo, and search's own scope keeps its name there too.
    expect((await alice.api("GET", `${D}/search?scope=all&query=gate`)).body).toMatchObject({ scope: "all", search_scope: "all" });
    await client.close();
  });

  it("in plain mode, reads an id as one word, finds it whole, and never corrects it into another", async () => {
    const plain = async (q: string) => (await alice.api("GET", `${D}/search?mode=plain&query=${encodeURIComponent(q)}`)).body;
    const r = await plain("CB26-20734");
    expect(r).toMatchObject({ terms: [{ text: "cb26-20734", phrase: false }], corrections: [], partial: false });
    expect(r.results.map((x: { id: string }) => x.id)).toEqual([src.crane]);
    const hit = r.results[0].hits[0];
    expect(hit.marks.map(([a, b]: [number, number]) => hit.text.slice(a, b))).toEqual(["CB26-20734"]);
    // An id nothing holds is missing, not replaced by its neighbour.
    expect(await plain("CB26-20735 ")).toMatchObject({ corrections: [], results: [] });
    // The number alone is found where a hyphen joins it to the rest of the id.
    expect((await plain("20734")).results.map((x: { id: string }) => x.id)).toEqual([src.crane]);
    // Still being typed, an id matches as a prefix; finished, only as itself.
    expect((await plain("CB26-2073")).results.map((x: { id: string }) => x.id)).toEqual([src.crane]);
    expect(await plain("CB26-2073 ")).toMatchObject({ corrections: [], results: [] });
    // A phrase may hold an id.
    expect((await plain('"ticket CB26-20733" pump')).results.map((x: { id: string }) => x.id)).toEqual([src.crane]);
    // The database ends the number after a hyphen before a letter, and so does marking: the date in
    // a timestamp is found, held and marked, not missing.
    const logged = await plain("invoices 2026-05-01 crane");
    expect(logged).toMatchObject({ partial: false, corrections: [] });
    expect(logged.results.map((x: { id: string; missing: string[] }) => [x.id, x.missing])).toEqual([[src.invoices, []]]);
    const at = logged.results[0].hits[0];
    expect(at.marks.map(([a, b]: [number, number]) => at.text.slice(a, b))).toEqual(["invoices", "crane", "2026-05-01"]);
  });

  it("in plain mode, finds a hyphenated word with a letter in it written as its words too, and a date only as written", async () => {
    const plain = async (q: string) => (await alice.api("GET", `${D}/search?mode=plain&query=${encodeURIComponent(q)}`)).body;
    for (const [q, words] of [["q3-planning", "Q3 planning"], ["covid-19 ", "COVID 19"], ["mid-2026 ", "mid 2026"]] as const) {
      const r = await plain(q);
      expect(r.results.map((x: { id: string }) => x.id), q).toEqual([src.quarter]);
      const hit = r.results[0].hits[0];
      expect(hit.marks.map(([a, b]: [number, number]) => hit.text.slice(a, b)), q).toEqual([words]);
    }
    // Its words in another order are not it.
    expect((await plain("planning-q3 ")).results).toEqual([]);
    // A date is found only as written, never as numbers that happen to stand side by side.
    expect((await plain("2026-05-01 ")).results.map((x: { id: string }) => x.id)).toEqual([src.invoices]);
  });
});

describe("pages of a search of everything, and numbers in ranked mode", () => {
  let Y: string;
  let yard: string;
  let ticket: string;
  let idle: string;

  beforeAll(async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Yard Co" });
    const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Yard" });
    Y = `/api/v1/p/${p.body.path}`;
    yard = await source(Y, alice, "Yard log — Example Co");
    expect((await alice.api("PUT", `${Y}/sources/${yard}/derived/text`, { content: "The gate opens at six. The gate closes at ten. The gate stays shut on Sunday.\n" })).status).toBe(200);
    ticket = await source(Y, alice, "Crane ticket — Example Co");
    expect((await alice.api("PUT", `${Y}/sources/${ticket}/derived/text`, { content: "Ticket CB26-20734 is open for the crane, logged 2026-05-01.\n" })).status).toBe(200);
    idle = (await alice.api("POST", `${Y}/assumptions`, { statement: "Crews wait at the gate before six.", body: "Ticket CB26-20734 shows the wait." })).body.id;
    expect((await alice.api("POST", `${Y}/assumptions`, { statement: "The gate code changes weekly." })).status).toBe(201);
  });

  it("with scope all, gives the assumptions on the first page only, and refuses a cursor for assumptions alone", async () => {
    const first = (await alice.api("GET", `${Y}/search?scope=all&query=gate&limit=1`)).body;
    expect(first.hits).toHaveLength(1);
    // At most limit of them, as of the hits.
    expect(first.assumptions).toHaveLength(1);
    expect((await alice.api("GET", `${Y}/search?scope=all&query=gate&limit=5`)).body.assumptions).toHaveLength(2);
    expect(first.next_cursor).toBeTruthy();
    const seen = [...first.hits];
    let cursor: string | null = first.next_cursor;
    while (cursor) {
      const page = (await alice.api("GET", `${Y}/search?scope=all&query=gate&limit=1&cursor=${cursor}`)).body;
      expect(page.hits).toHaveLength(1);
      // The pages after the first carry source hits alone, never the first page's assumptions again.
      expect(page).not.toHaveProperty("assumptions");
      seen.push(...page.hits);
      cursor = page.next_cursor;
    }
    expect(seen.map((x: Hit) => [x.field, x.char_start])).toEqual([["text", 4], ["text", 27], ["text", 51]]);
    const alone = await alice.api("GET", `${Y}/search?scope=assumptions&query=gate&cursor=${first.next_cursor}`);
    expect(alone.status).toBe(422);
    expect(alone.body.error).toMatchObject({ code: "invalid_cursor", message: expect.stringContaining("answers in one page") });
  });

  it("in ranked mode, finds a bare number where a hyphen joins it to the rest of an id, as plain mode does", async () => {
    const ranked = async (q: string, extra = "") => (await alice.api("GET", `${Y}/search?mode=ranked&query=${encodeURIComponent(q)}${extra}`)).body;
    for (const q of ["20734", "2073*", "CB26-20734", "20734 AND crane", "05"]) expect((await ranked(q)).hits.map((x: Hit) => x.record_id), q).toEqual([ticket]);
    expect((await ranked("20734", "&scope=assumptions")).assumptions.map((x: { id: string }) => x.id)).toEqual([idle]);
    // A number is still matched as a number: one the text does not hold is not found.
    expect((await ranked("20735")).hits).toEqual([]);
    expect((await ranked("NOT 20734 AND open")).hits).toEqual([]);
  });
});
