import { IMAGE_DETAIL, RECORDING_DETAIL, SCAN_DETAIL } from "@whatbuild/parsers";
import { sql, type Transaction } from "kysely";
import { connect, createServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makePdf, makeXlsx } from "../../../packages/parsers/test/fixtures.ts";
import { makeWordDoc } from "../../../packages/parsers/test/word-fixtures.ts";
import { publicOnlyLookup } from "../src/adapters/misc.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let P: string;
let tenantId: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Research" });
  tenantId = t.body.tenant.tenant_id;
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Scheduling" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

/** Work on the rows of this test's tenant directly, as a migration or a restore would. */
async function inTenant<T>(fn: (trx: Transaction<any>) => Promise<T>): Promise<T> {
  return h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx as Transaction<any>);
  });
}

/** Create a source, PUT its first attachment through the relay, and complete the upload. */
async function upload(tag: string, path: string, body: string | Uint8Array) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path });
  expect(created.status).toBe(201);
  const recordId: string = created.body.record.record_id;
  const put = await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body });
  expect(put.status).toBe(201);
  const putBody = (await put.json()) as { next: string; attachment: Record<string, unknown> };
  const completed = await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path });
  expect(completed.status).toBe(200);
  return { recordId, putNext: putBody.next, putAttachment: putBody.attachment, completed: completed.body };
}

describe("what upload, read and search say about a source", () => {
  it("tells the truth about an attachment before and after it is read", async () => {
    const { putNext, putAttachment, completed } = await upload("notes", "visit.md", "# Visit\n\n- Crews text the office.\n- Nobody called it a crisis.\n");
    // The PUT adds the attachment and says what will become of its text; complete_upload only confirms.
    expect(putNext).toMatch(/^Added: attachment\.note says what becomes of its text\. No complete_upload is needed\./);
    expect(putAttachment).toMatchObject({ path: "visit.md", text: { status: "pending" }, is_text_source: false, note: expect.stringMatching(/being read\. Once it is read, its text becomes the source's derived text/) });
    expect(putAttachment).not.toHaveProperty("role");
    expect(putAttachment).not.toHaveProperty("search_status");
    expect(completed).toMatchObject({ text: { status: "pending" }, is_text_source: false });
    expect(completed.note).toMatch(/never searched/);
    await h.worker.drain();
    const again = await alice.api("POST", `${P}/sources/${completed.record_id}/uploads/complete`, { record_id: completed.record_id, path: "visit.md" });
    expect(again.body).toMatchObject({ text: { status: "ready", parser: "markdown" }, is_text_source: true });
    expect(again.body.note).toBe("visit.md has been read. It is kept with the source and never searched.");
  });

  it("says a recording and an unreadable format have no text the moment they arrive, before the worker runs", async () => {
    const rec = await upload("recording", "call.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    // The name and type settle it, so the upload answers with the status its reading will record, not pending.
    expect(rec.putAttachment).toMatchObject({ text: { status: "needs_transcript", status_detail: RECORDING_DETAIL, derivation_id: null } });
    expect(rec.completed.note).toMatch(/recording/);
    expect(rec.completed.note).toMatch(/never transcribes/);
    expect(rec.completed.note).toMatch(/Add its transcript as another attachment\./);
    expect(rec.completed.note).not.toMatch(/becomes the source's derived text/);
    expect((await alice.api("GET", `${P}/sources/${rec.recordId}`)).body).toMatchObject({ derived_status: "needs_transcript", status_detail: RECORDING_DETAIL });
    const deck = await upload("document", "readout.pptx", new Uint8Array([80, 75, 3, 4]));
    expect(deck.completed.text).toMatchObject({ status: "unsupported", status_detail: "no parser reads .pptx files" });
    expect(deck.completed.note).toMatch(/^No parser reads \.pptx files, so readout\.pptx is stored and downloadable but has no text\./);
    expect(deck.completed.note).toMatch(/\.docx/);
    expect((await alice.api("GET", `${P}/sources/${deck.recordId}`)).body).toMatchObject({ derived_status: "unsupported" });
    await h.worker.drain();
    // Read, it says the same.
    const done = await alice.api("POST", `${P}/sources/${deck.recordId}/uploads/complete`, { record_id: deck.recordId, path: "readout.pptx" });
    expect(done.body.text).toMatchObject({ status: "unsupported", status_detail: "no parser reads .pptx files", derivation_id: expect.any(String) });
    expect(done.body.note).toBe(deck.completed.note);
    const recorded = await alice.api("GET", `${P}/sources/${rec.recordId}`);
    expect(recorded.body).toMatchObject({ derived_status: "needs_transcript", text_chars: 0, status_detail: RECORDING_DETAIL });
  });

  it("counts sources without a derived text by reason, with correct plurals", async () => {
    const s = await alice.api("GET", `${P}/search?query=crisis`);
    expect(s.status).toBe(200);
    expect(s.body.hits).toHaveLength(1);
    expect(s.body.coverage).toMatchObject({ records_considered: 3, records_without_text: 2 });
    expect(s.body.coverage.statement).toBe(
      "Searched the title, tags, summary, notes and comments of 3 sources, and the derived text of the 1 that has one. No derived text: 1 is a recording with no transcript (add the transcript as an attachment); 1 has only attachments that could not be read (unsupported, too large or failed). Attachments are never searched.",
    );
    const empty = await alice.api("POST", `${P}/sources`, { tags: ["document"], title: "Sample source with no attachment yet" });
    expect(empty.status).toBe(201);
    const withEmpty = await alice.api("GET", `${P}/search?query=crisis&tags=document`);
    expect(withEmpty.body.coverage.statement).toBe(
      "Searched the title, tags, summary, notes and comments of 2 sources, and the derived text of the 0 that have one. No derived text: 1 has no attachment yet; 1 has only attachments that could not be read (unsupported, too large or failed). Attachments are never searched.",
    );
    const recordings = await alice.api("GET", `${P}/search?query=crisis&tags=recording`);
    expect(recordings.body.coverage.statement).toBe(
      "Searched the title, tags, summary, notes and comments of 1 source, and the derived text of the 0 that have one. No derived text: 1 is a recording with no transcript (add the transcript as an attachment). Attachments are never searched.",
    );
  });

  it("reads a PDF of pictures as it reads an image: no text, and what an agent that can see it does", async () => {
    const photo = await upload("photo", "board.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(photo.putAttachment).toMatchObject({ text: { status: "unsupported", status_detail: IMAGE_DETAIL, derivation_id: null } });
    expect(photo.completed.note).toBe(`board.png is stored and shown, but ${IMAGE_DETAIL}. It is kept with the source and never searched.`);
    const scan = await upload("document", "signed-contract.pdf", makePdf([]));
    // Only a PDF's bytes say whether it has a text layer, so it is read first.
    expect(scan.completed.text.status).toBe("pending");
    await h.worker.drain();
    for (const [s, detail] of [[photo, IMAGE_DETAIL], [scan, SCAN_DETAIL]] as const) {
      const got = await alice.api("GET", `${P}/sources/${s.recordId}?detail=full`);
      expect(got.body).toMatchObject({ derived_status: "unsupported", status_detail: detail, warnings: [] });
      expect(got.body.attachments[0].text).toMatchObject({ status: "unsupported", status_detail: detail });
    }
    const done = await alice.api("POST", `${P}/sources/${scan.recordId}/uploads/complete`, { record_id: scan.recordId, path: "signed-contract.pdf" });
    expect(done.body.note).toBe(`signed-contract.pdf is stored and downloadable, but ${SCAN_DETAIL}. It is kept with the source and never searched.`);
    expect((await alice.api("GET", `${P}/sources/${scan.recordId}/derived/manifest`)).body).toMatchObject({ status: "unsupported", parser: "pdf", facts: { text_layer_chars: 0 } });
  });

  it("says a reading an earlier version recorded as this version says it", async () => {
    const rec = await upload("recording", "older-call.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    const scan = await upload("document", "older-scan.pdf", makePdf([]));
    await h.worker.drain();
    // Readings as earlier versions recorded them, which a backup or a sandbox's baseline brings back:
    // a recording asked for its transcript as a new source, and a PDF of pictures was a failure.
    await inTenant((trx) => sql`update derivations set status_detail = 'a recording is stored and playable but has no text; add a transcript as a new source' where record_id = ${rec.recordId}`.execute(trx));
    await inTenant((trx) => sql`update derivations set status = 'failed', status_detail = 'the PDF has no text layer (a scan?); no OCR is performed' where record_id = ${scan.recordId}`.execute(trx));
    const r = await alice.api("GET", `${P}/sources/${rec.recordId}?detail=full`);
    expect(r.body).toMatchObject({ derived_status: "needs_transcript", status_detail: RECORDING_DETAIL });
    expect(r.body.attachments[0].text.status_detail).toBe(RECORDING_DETAIL);
    expect((await alice.api("GET", `${P}/sources/${rec.recordId}/derived/manifest`)).body).toMatchObject({ status: "needs_transcript", status_detail: RECORDING_DETAIL });
    const s = await alice.api("GET", `${P}/sources/${scan.recordId}?detail=full`);
    expect(s.body).toMatchObject({ derived_status: "unsupported", status_detail: SCAN_DETAIL });
    expect(s.body.attachments[0].text).toMatchObject({ status: "unsupported", status_detail: SCAN_DETAIL });
    expect((await alice.api("GET", `${P}/sources/${scan.recordId}/derivations`)).body.items[0]).toMatchObject({ status: "unsupported", status_detail: SCAN_DETAIL });
  });

  it("says a recording beside the attachment its source's text comes from needs nothing more", async () => {
    const { recordId } = await upload("interview", "crew-call.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Sam>Crews plan on Fridays.\n");
    await h.worker.drain();
    const grant = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { record_id: recordId, path: "crew-call.m4a" });
    const put = await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) });
    const { attachment } = (await put.json()) as { attachment: Record<string, any> };
    const beside = "a recording is stored and playable but has no text of its own; the source's text is taken from crew-call.vtt";
    expect(attachment.text).toMatchObject({ status: "needs_transcript", status_detail: beside });
    expect(attachment.note).toBe("crew-call.m4a is a recording: it is stored and playable, but WhatBuild never transcribes, so it has no text of its own. The source's text is taken from crew-call.vtt. It is kept with the source and never searched.");
    await h.worker.drain();
    const got = await alice.api("GET", `${P}/sources/${recordId}?detail=full`);
    expect(got.body).toMatchObject({ derived_status: "ready", text_from: "crew-call.vtt", warnings: [] });
    expect(got.body.attachments.find((a: { path: string }) => a.path === "crew-call.m4a").text.status_detail).toBe(beside);
  });

  it("warns of each attachment with text that the derived text does not use, and of none without text", async () => {
    const { recordId } = await upload("analysis", "pipeline-notes.md", "# Pipeline\n\nCrews plan by the week.\n");
    for (const [path, body] of [
      ["pipeline.xlsx", makeXlsx()],
      ["review-call.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])],
      ["whiteboard.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    ] as const) {
      const grant = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { record_id: recordId, path });
      expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body })).status).toBe(201);
    }
    await h.worker.drain();
    const taken = await alice.api("GET", `${P}/sources/${recordId}`);
    expect(taken.body).toMatchObject({ derived_status: "ready", text_from: "pipeline-notes.md" });
    expect(taken.body.warnings).toEqual([
      "This source's derived text is taken from pipeline-notes.md, so the text read from pipeline.xlsx is kept but never searched. If its words should be found, write them into the derived text, the summary or the notes, or add it as a source of its own.",
    ]);
    // Edited, the text follows no attachment, and every attachment with text is named.
    const cur = await alice.api("GET", `${P}/sources/${recordId}/derived/text`);
    const edited = await alice.api("PUT", `${P}/sources/${recordId}/derived/text`, { edits: [{ old_text: "by the week", new_text: "by the fortnight" }], expected_etag: cur.body.etag });
    expect(edited.status).toBe(200);
    expect((await alice.api("GET", `${P}/sources/${recordId}`)).body.warnings).toEqual([
      "This source's derived text was written or edited, so it follows no attachment: the text read from pipeline-notes.md and pipeline.xlsx is kept but never searched, and a new version of one does not change the derived text. Take an attachment's text with derived(action=\"write_text\", from_attachment=…) only if it should replace the derived text.",
    ]);
  });

  it("names each speaker in the derived text, so what someone said is found and read where they said it", async () => {
    const notes = await upload("notes", "notes.txt", "We met the ops lead.\n\nShe plans by the week.\n");
    const call = await upload("interview", "call.txt", "Interviewer: How do you plan?\nDana: By the week.\nInterviewer: Who decides?\nDana: The ops lead.\n");
    await h.worker.drain();
    const plain = await alice.api("GET", `${P}/sources/${notes.recordId}/derived/text`);
    expect(plain.body.text).toBe("We met the ops lead.\n\nShe plans by the week.\n");
    const turns = await alice.api("GET", `${P}/sources/${call.recordId}/derived/text`);
    expect(turns.body.text).toBe("**Interviewer:** How do you plan?\n\n**Dana:** By the week.\n\n**Interviewer:** Who decides?\n\n**Dana:** The ops lead.\n");
    // A speaker's name is part of the text, so it is searched with their words.
    const dana = await alice.api("GET", `${P}/search?query=${encodeURIComponent("dana AND week")}&mode=ranked`);
    expect(dana.body.hits.map((x: { record_id: string; field: string }) => [x.record_id, x.field])).toEqual([[call.recordId, "text"]]);
    const said = await alice.api("GET", `${P}/search?query=${encodeURIComponent("Dana:** The ops lead")}`);
    expect(said.body.hits).toHaveLength(1);
    const at = await alice.api("GET", `${P}/sources/${call.recordId}/derived/text?offset=${said.body.hits[0].char_start}&limit=${said.body.hits[0].char_end - said.body.hits[0].char_start}`);
    expect(at.body.text).toBe("Dana:** The ops lead");
  });

  it("takes a comment on the whole source, refuses a range, and logs comments as comments", async () => {
    const { recordId } = await upload("notes", "three.txt", "One.\n\nTwo.\n\nThree.\n");
    await h.worker.drain();
    const a = await alice.api("POST", `${P}/sources/${recordId}/annotations`, { record_id: recordId, note: "The whole source." });
    expect(a.status).toBe(201);
    expect(a.body).not.toHaveProperty("seq_start");
    expect(a.body).not.toHaveProperty("anchor");
    const ranged = await alice.api("POST", `${P}/sources/${recordId}/annotations`, { record_id: recordId, note: "A range.", seq_start: 0, seq_end: 2 });
    expect(ranged.status).toBe(422);
    expect(ranged.body.error.message).toContain("A comment is on the whole source: it takes no segment range.");
    // A long archive reason is cut on a word boundary, with an ellipsis, in the activity log.
    const reason = "The crews plan by hand on Fridays. ".repeat(10).trim();
    const archived = await alice.api("PATCH", `${P}/annotations/${a.body.annotation_id}`, { expected_etag: a.body.etag, archived: true, archive_reason: reason });
    expect(archived.status).toBe(200);
    const log = await alice.api("GET", `${P}/activity?entity_id=${recordId}`);
    const comments = log.body.items.filter((i: { action: string }) => i.action.startsWith("note_")).map((i: { summary: string }) => i.summary);
    expect(comments[1]).toBe("Added a comment");
    const cut = (comments[0] as string).replace(/^Archived a comment: /, "");
    expect(Array.from(cut).length).toBeLessThanOrEqual(200);
    expect(cut.endsWith("…")).toBe(true);
    expect(reason.startsWith(cut.slice(0, -1))).toBe(true);
    expect(reason[cut.length - 1]).toMatch(/\s/);
  });
});

describe("listing sources in order", () => {
  it("sorts by date (undated last), last update or title, either way round, pages without skipping, and names the attachment each text is from", async () => {
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

    // query matches attachment names; text_from names the attachment the derived text is from.
    const { recordId } = await upload("document", "sortable-deck.pptx", new Uint8Array([80, 75, 3, 4]));
    const notes = await upload("notes", "sortable-notes.md", "# Notes\n\nCrews plan by the week.\n");
    await alice.api("PATCH", `${P}/sources/${notes.recordId}`, { expected_etag: notes.completed.record_etag, title: "Planning notes" });
    await h.worker.drain();
    const listed = await alice.api("GET", `${P}/sources?query=sortable-deck`);
    expect(listed.body.records).toEqual([expect.objectContaining({ record_id: recordId, text_from: null, derived_status: "unsupported", attachment_count: 1 })]);
    expect(listed.body.records[0]).not.toHaveProperty("primary_file");
    const read = await alice.api("GET", `${P}/sources?query=sortable-notes`);
    expect(read.body.records).toEqual([expect.objectContaining({ record_id: notes.recordId, title: "Planning notes", text_from: "sortable-notes.md", derived_status: "ready" })]);
    const none = await alice.api("GET", `${P}/sources?query=Sortable%20delta`);
    expect(none.body.records[0]).toMatchObject({ text_from: null, derived_status: "awaiting_file", attachment_count: 0 });
    expect(none.body.records[0]).not.toHaveProperty("summary");

    // include_summary adds each source's summary, null without one and cut short when long.
    await alice.api("PUT", `${P}/sources/${june}/agent-notes/summary`, { content: "Crews plan the week on **Sunday night**." });
    await alice.api("PUT", `${P}/sources/${sept}/agent-notes/summary`, { content: `${"Crews text the office. ".repeat(60)}` });
    const summed = await alice.api("GET", `${P}/sources?query=Sortable&sort=date&include_summary=true`);
    const summaryOf = (id: string) => summed.body.records.find((x: { record_id: string }) => x.record_id === id).summary;
    expect(summaryOf(june)).toBe("Crews plan the week on **Sunday night**.");
    expect(summaryOf(aug)).toBeNull();
    expect(summaryOf(sept)).toMatch(/^Crews text the office\. .*\S…$/);
    expect(Array.from(summaryOf(sept) as string).length).toBeLessThanOrEqual(1000);

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

describe("what a reading records beyond the text", () => {
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
    const created = await bob.api("POST", `${Q}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path });
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
    expect(a.body).toMatchObject({ derived_status: "needs_transcript", text_chars: 0, duration_ms: 147_250 });
    const b = await bob.api("GET", `${Q}/sources/${large}?detail=full`);
    expect(b.body).toMatchObject({ derived_status: "too_large", duration_ms: 3_600_000, text: null });
    expect(b.body.attachments[0].text).toMatchObject({ status: "too_large", duration_ms: 3_600_000 });
    const manifest = await bob.api("GET", `${Q}/sources/${large}/derived/manifest`);
    expect(manifest.body).toMatchObject({ path: "site-visit.m4a", status: "too_large", duration_ms: 3_600_000 });
  });

  it("fails an HTML page that has no readable text instead of calling it ready", async () => {
    const shell = await stored("document", "manual.html", '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>');
    await h2.worker.drain();
    const s = await bob.api("GET", `${Q}/sources/${shell}`);
    expect(s.body).toMatchObject({ derived_status: "failed", text_chars: 0 });
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
    const created = await alice.api("POST", `${R}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path });
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
    for (const [id, text] of [[binary, "Crew notes\n\nDispatchers replan routes by radio.\n"], [page, "Supervisors print the roster every morning.\n"]] as const) {
      const s = await alice.api("GET", `${R}/sources/${id}`);
      expect(s.body).toMatchObject({ derived_status: "ready", text_chars: text.length });
      expect((await alice.api("GET", `${R}/sources/${id}/derived/text`)).body.text).toBe(text);
    }
    const radio = await alice.api("GET", `${R}/search?query=replan routes`);
    expect(radio.body.hits.map((hit: { record_id: string }) => hit.record_id)).toEqual([binary]);
    const roster = await alice.api("GET", `${R}/search?query=print the roster`);
    expect(roster.body.hits.map((hit: { record_id: string }) => hit.record_id)).toEqual([page]);
  });
});
