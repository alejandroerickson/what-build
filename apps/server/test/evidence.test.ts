import { connect, createServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeWordDoc } from "../../../packages/parsers/test/word-fixtures.ts";
import { publicOnlyLookup } from "../src/adapters/misc.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let P: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Research" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Scheduling" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

/** Create a source, PUT its primary through the relay, and complete the upload. */
async function upload(tag: string, path: string, body: string | Uint8Array) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path, role: "primary" });
  expect(created.status).toBe(201);
  const recordId: string = created.body.record.record_id;
  const put = await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body });
  expect(put.status).toBe(201);
  const putBody = (await put.json()) as { next: string };
  const completed = await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path });
  expect(completed.status).toBe(200);
  return { recordId, putNext: putBody.next, completed: completed.body };
}

describe("what upload, read and search say about a source", () => {
  it("tells the truth about a primary before and after parsing", async () => {
    const { putNext, completed } = await upload("notes", "visit.md", "# Visit\n\n- Crews text the office.\n- Nobody called it a crisis.\n");
    expect(putNext).toMatch(/^Received\. Now call files\(action="complete_upload"\)/);
    expect(completed).toMatchObject({ search_status: "pending", searchable: false });
    expect(completed.note).toMatch(/being parsed/);
    await h.worker.drain();
    const again = await alice.api("POST", `${P}/sources/${completed.record_id}/uploads/complete`, { record_id: completed.record_id, path: "visit.md" });
    expect(again.body).toMatchObject({ search_status: "ready", searchable: true });
    expect(again.body.note).toMatch(/ready to search/);
  });

  it("says a recording and an unreadable format will never be parsed, even before the worker runs", async () => {
    const rec = await upload("recording", "call.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    expect(rec.completed.note).toMatch(/recording/);
    expect(rec.completed.note).toMatch(/never transcribes/);
    expect(rec.completed.note).not.toMatch(/once derived_status is ready/);
    const deck = await upload("document", "readout.pptx", new Uint8Array([80, 75, 3, 4]));
    expect(deck.completed.note).toMatch(/no parser reads \.pptx files/);
    expect(deck.completed.note).toMatch(/\.docx/);
    await h.worker.drain();
    const done = await alice.api("POST", `${P}/sources/${deck.recordId}/uploads/complete`, { record_id: deck.recordId, path: "readout.pptx" });
    expect(done.body.search_status).toBe("unsupported");
    expect(done.body.note).toMatch(/will not be parsed or searched/);
  });

  it("counts sources without passages by reason, with correct plurals", async () => {
    const s = await alice.api("GET", `${P}/search?query=crisis`);
    expect(s.status).toBe(200);
    expect(s.body.hits).toHaveLength(1);
    expect(s.body.coverage.statement).toBe(
      "Searched the primary text of 1 source. Not searched: 1 is a recording with no transcript (add the transcript as its own source); 1 has a primary that could not be parsed (unsupported, too large or failed).",
    );
    const empty = await alice.api("POST", `${P}/sources`, { tags: ["document"], title: "Sample source with no file yet" });
    expect(empty.status).toBe(201);
    const withEmpty = await alice.api("GET", `${P}/search?query=crisis&tags=document`);
    expect(withEmpty.body.coverage.statement).toBe(
      "Searched the primary text of 0 sources. Not searched: 1 has no primary file yet; 1 has a primary that could not be parsed (unsupported, too large or failed).",
    );
    const recordings = await alice.api("GET", `${P}/search?query=crisis&tags=recording`);
    expect(recordings.body.coverage.statement).toBe("Searched the primary text of 0 sources. Not searched: 1 is a recording with no transcript (add the transcript as its own source).");
  });

  it("warns when a speaker filter meets a source with no speakers, or a name nobody uses", async () => {
    const notes = await upload("notes", "notes.txt", "We met the ops lead.\n\nShe plans by the week.\n");
    const call = await upload("interview", "call.txt", "Interviewer: How do you plan?\nDana: By the week.\nInterviewer: Who decides?\nDana: The ops lead.\n");
    await h.worker.drain();
    const none = await alice.api("GET", `${P}/sources/${notes.recordId}/passage?start=0&end=1&unit=seq&speaker=Dana`);
    expect(none.status).toBe(200);
    expect(none.body.segments).toHaveLength(0);
    expect(none.body.warning).toMatch(/no speaker data/);
    const stranger = await alice.api("GET", `${P}/sources/${call.recordId}/passage?start=0&end=3&unit=seq&speaker=Sam`);
    expect(stranger.body.warning).toBe('No passage in this source is by "Sam". Its speakers are: Dana, Interviewer.');
    const dana = await alice.api("GET", `${P}/sources/${call.recordId}/passage?start=0&end=3&unit=seq&speaker=dana`);
    expect(dana.body.segments.map((s: { text: string }) => s.text)).toEqual(["By the week.", "The ops lead."]);
    expect(dana.body.warning).toBeNull();
    const gap = await alice.api("GET", `${P}/sources/${call.recordId}/passage?start=0&end=0&unit=seq&speaker=Dana`);
    expect(gap.body.warning).toBe("No segments in this range.");
  });

  it("cuts a long note anchor on a word boundary, with an ellipsis", async () => {
    const words = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} says the crews plan their week on Friday afternoons, by hand.`);
    const { recordId } = await upload("notes", "long.txt", words.join("\n\n") + "\n");
    await h.worker.drain();
    const a = await alice.api("POST", `${P}/sources/${recordId}/annotations`, { record_id: recordId, note: "Planning happens by hand.", seq_start: 0, seq_end: 11 });
    expect(a.status).toBe(201);
    const quote: string = a.body.anchor.quote;
    expect(Array.from(quote).length).toBeLessThanOrEqual(500);
    expect(quote.endsWith("…")).toBe(true);
    const full = words.join("\n\n");
    expect(full.startsWith(quote.slice(0, -1))).toBe(true);
    // The cut falls between words.
    expect(full[quote.length - 1]).toMatch(/\s/);
  });

  it("names a note's passages in activity as the app does: ¶N for one, ¶N–M for a range", async () => {
    const { recordId } = await upload("notes", "three.txt", "One.\n\nTwo.\n\nThree.\n");
    await h.worker.drain();
    expect((await alice.api("POST", `${P}/sources/${recordId}/annotations`, { record_id: recordId, note: "One passage.", seq_start: 1, seq_end: 1 })).status).toBe(201);
    expect((await alice.api("POST", `${P}/sources/${recordId}/annotations`, { record_id: recordId, note: "A range.", seq_start: 0, seq_end: 2 })).status).toBe(201);
    expect((await alice.api("POST", `${P}/sources/${recordId}/annotations`, { record_id: recordId, note: "The whole source." })).status).toBe(201);
    const log = await alice.api("GET", `${P}/activity?entity_id=${recordId}`);
    const notes = log.body.items.filter((i: { action: string }) => i.action === "note_added").map((i: { summary: string }) => i.summary);
    expect(notes).toEqual(["Added a note", "Added a note on ¶0–2", "Added a note on ¶1"]);
  });
});

describe("listing sources in order", () => {
  it("sorts by date (undated last), last update or title, either way round, pages without skipping, and names each primary file", async () => {
    const make = async (title: string, date: string | null) => {
      const r = await alice.api("POST", `${P}/sources`, { title, ...(date ? { date } : {}) });
      expect(r.status).toBe(201);
      return r.body.record_id as string;
    };
    const june = await make("Sortable delta", "2026-06-05");
    const sept = await make("sortable Alpha", "2026-09-27");
    const undated = await make("Sortable charlie", null);
    const aug = await make("Sortable bravo", "2026-08-01");
    const sameDay = await make("Sortable echo", "2026-08-01");
    const walk = async (sort: string) => {
      const ids: string[] = [];
      let cursor = "";
      for (let i = 0; i < 5; i++) {
        const r = await alice.api("GET", `${P}/sources?query=Sortable&sort=${sort}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        expect(r.status).toBe(200);
        ids.push(...r.body.records.map((x: { record_id: string }) => x.record_id));
        if (!r.body.next_cursor) break;
        cursor = r.body.next_cursor;
      }
      return ids;
    };
    expect(await walk("date")).toEqual([sept, sameDay, aug, june, undated]);
    expect(await walk("title")).toEqual([sept, aug, undated, june, sameDay]);
    expect(await walk("added")).toEqual([sameDay, aug, undated, sept, june]);
    // order reverses a sort; undated sources stay last.
    expect(await walk("date&order=asc")).toEqual([june, aug, sameDay, sept, undated]);
    expect(await walk("title&order=desc")).toEqual([sameDay, june, undated, aug, sept]);
    expect(await walk("added&order=asc")).toEqual([june, sept, undated, aug, sameDay]);
    // Editing a source's details moves it to the top of "updated", and its summary says when.
    const got = await alice.api("GET", `${P}/sources/${june}`);
    const edited = await alice.api("PATCH", `${P}/sources/${june}`, { expected_etag: got.body.etag, tags: ["sortable co"] });
    expect(edited.status).toBe(200);
    expect(await walk("updated")).toEqual([june, sameDay, aug, undated, sept]);
    expect(await walk("updated&order=asc")).toEqual([sept, undated, aug, sameDay, june]);
    const first = await alice.api("GET", `${P}/sources?query=Sortable&sort=updated&limit=1`);
    expect(first.body.records[0].updated_at).toBe(edited.body.updated_at);

    const { recordId } = await upload("document", "sortable-deck.pptx", new Uint8Array([80, 75, 3, 4]));
    const listed = await alice.api("GET", `${P}/sources?query=sortable-deck`);
    expect(listed.body.records).toEqual([expect.objectContaining({ record_id: recordId, primary_file: "sortable-deck.pptx" })]);
    const none = await alice.api("GET", `${P}/sources?query=Sortable%20delta`);
    expect(none.body.records[0].primary_file).toBeNull();

    const bad = await alice.api("GET", `${P}/sources?sort=date&cursor=${june}`);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("invalid_cursor");
    const notATime = Buffer.from(JSON.stringify({ v: "2026-06-05", id: june })).toString("base64url");
    const badUpdated = await alice.api("GET", `${P}/sources?sort=updated&cursor=${notATime}`);
    expect(badUpdated.status).toBe(422);
    expect(badUpdated.body.error.code).toBe("invalid_cursor");
  });
});

describe("the fetch lookup", () => {
  const resolver = (addrs: { address: string; family: number }[]) => async () => addrs;
  const call = (lookup: ReturnType<typeof publicOnlyLookup>, options: object) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
      lookup("docs.example", options as never, (err, address, family) => resolve({ err, address, family })),
    );

  it("answers both shapes Node asks for, with only public addresses", async () => {
    const lookup = publicOnlyLookup(resolver([{ address: "93.184.215.14", family: 4 }, { address: "2606:2800:21f:cb07::1", family: 6 }]));
    expect(await call(lookup, { all: true })).toMatchObject({ err: null, address: [{ address: "93.184.215.14", family: 4 }, { address: "2606:2800:21f:cb07::1", family: 6 }] });
    expect(await call(lookup, {})).toMatchObject({ err: null, address: "93.184.215.14", family: 4 });
    expect(await call(lookup, { family: 6 })).toMatchObject({ err: null, address: "2606:2800:21f:cb07::1", family: 6 });
  });

  it("refuses a name with any private address, in either shape", async () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) {
      const lookup = publicOnlyLookup(resolver([{ address: "93.184.215.14", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }]));
      for (const options of [{ all: true }, {}]) {
        const r = await call(lookup, options);
        expect(r.err?.message, address).toMatch(/non-public address/);
      }
    }
  });

  it("works for a real connection, where Node asks for every address", async () => {
    const server = createServer((socket) => socket.end("hello"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    // Treat loopback as public for this test only, to reach the local server through the lookup.
    const lookup = publicOnlyLookup(resolver([{ address: "127.0.0.1", family: 4 }]), () => true);
    const text = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: "docs.example", port, lookup, autoSelectFamily: true });
      let data = "";
      socket.on("data", (d) => (data += d));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
    server.close();
    expect(text).toBe("hello");
  });
});

/** A minimal M4A: `ftyp`, a zeroed `mdat`, then `moov` with a version 0 `mvhd` (not fast-start). */
function m4a(timescale: number, duration: number, mdatBytes: number): Uint8Array {
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const box = (type: string, body: number[]) => [...be32(8 + body.length), ...Array.from(type, (c) => c.charCodeAt(0)), ...body];
  const ftyp = box("ftyp", [77, 52, 65, 32, 0, 0, 0, 0]);
  const mdat = box("mdat", new Array(mdatBytes).fill(0));
  const moov = box("moov", box("mvhd", [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(timescale), ...be32(duration), ...new Array(80).fill(0)]));
  return new Uint8Array([...ftyp, ...mdat, ...moov]);
}

describe("what derivation records beyond passages", () => {
  let h2: Harness;
  let bob: Browser;
  let Q: string;

  beforeAll(async () => {
    h2 = await startHarness({ parseCapBytes: 4000 });
    bob = await h2.signIn("bob@example.com", "Bob Example");
    const t = await bob.api("POST", "/api/v1/tenants", { name: "Example Field Research" });
    const p = await bob.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Dispatch" });
    Q = `/api/v1/p/${p.body.path}`;
  });
  afterAll(async () => h2?.close());

  async function stored(tag: string, path: string, body: string | Uint8Array) {
    const created = await bob.api("POST", `${Q}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path, role: "primary" });
    expect(created.status).toBe(201);
    const recordId: string = created.body.record.record_id;
    expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body })).status).toBe(201);
    expect((await bob.api("POST", `${Q}/sources/${recordId}/uploads/complete`, { record_id: recordId, path })).status).toBe(200);
    return recordId;
  }

  it("reads a recording's duration from its container, even past the parse cap", async () => {
    const small = await stored("recording", "call.m4a", m4a(1000, 147_250, 1000));
    const large = await stored("recording", "site-visit.m4a", m4a(48_000, 48_000 * 3600, 6000));
    await h2.worker.drain();
    const a = await bob.api("GET", `${Q}/sources/${small}`);
    expect(a.body).toMatchObject({ derived_status: "needs_transcript", segment_count: 0, duration_ms: 147_250 });
    const b = await bob.api("GET", `${Q}/sources/${large}?detail=full`);
    expect(b.body).toMatchObject({ derived_status: "too_large", duration_ms: 3_600_000 });
    expect(b.body.manifest.duration_ms).toBe(3_600_000);
  });

  it("fails an HTML page that has no readable text instead of calling it ready", async () => {
    const shell = await stored("document", "manual.html", '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>');
    await h2.worker.drain();
    const s = await bob.api("GET", `${Q}/sources/${shell}`);
    expect(s.body).toMatchObject({ derived_status: "failed", segment_count: 0 });
    expect(s.body.status_detail).toMatch(/no readable text/);
  });

});

describe("Word .doc uploads", () => {
  // A product of its own, so these sources stay out of the counts the other tests check.
  let R: string;

  beforeAll(async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Archive Research" });
    const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Rostering" });
    R = `/api/v1/p/${p.body.path}`;
  });

  async function upload(tag: string, path: string, body: string | Uint8Array) {
    const created = await alice.api("POST", `${R}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path, role: "primary" });
    expect(created.status).toBe(201);
    const recordId: string = created.body.record.record_id;
    expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body })).status).toBe(201);
    expect((await alice.api("POST", `${R}/sources/${recordId}/uploads/complete`, { record_id: recordId, path })).status).toBe(200);
    return recordId;
  }

  it("parses a .doc upload, whether Word 97 or a web page saved under that name", async () => {
    const binary = await upload("document", "crew-notes.doc", makeWordDoc([["Crew notes\rDispatchers replan routes by radio.\r", true]]));
    const mhtml = [
      "MIME-Version: 1.0",
      'Content-Type: multipart/related; boundary="part"',
      "",
      "--part",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<html><body><p>Supervisors print the roster every morning.</p></body></html>",
      "--part--",
      "",
    ].join("\r\n");
    const page = await upload("document", "roster-export.doc", mhtml);
    await h.worker.drain();
    for (const id of [binary, page]) {
      const s = await alice.api("GET", `${R}/sources/${id}`);
      expect(s.body).toMatchObject({ derived_status: "ready", segment_count: id === binary ? 2 : 1 });
    }
    const radio = await alice.api("GET", `${R}/search?query=replan routes`);
    expect(radio.body.hits.map((hit: { record_id: string }) => hit.record_id)).toEqual([binary]);
    const roster = await alice.api("GET", `${R}/search?query=print the roster`);
    expect(roster.body.hits.map((hit: { record_id: string }) => hit.record_id)).toEqual([page]);
  });
});
