import { connect, createServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
async function upload(kind: string, path: string, body: string | Uint8Array) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { kind, title: `Sample ${path}`, path, role: "primary" });
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
    const { putNext, completed } = await upload("interviewer_notes", "visit.md", "# Visit\n\n- Crews text the office.\n- Nobody called it a crisis.\n");
    expect(putNext).toMatch(/^Received\. Now call files\(action="complete_upload"\)/);
    expect(completed).toMatchObject({ search_status: "pending", searchable: false });
    expect(completed.note).toMatch(/being parsed/);
    await h.worker.drain();
    const again = await alice.api("POST", `${P}/sources/${completed.record_id}/uploads/complete`, { record_id: completed.record_id, path: "visit.md" });
    expect(again.body).toMatchObject({ search_status: "ready", searchable: true });
    expect(again.body.note).toMatch(/ready to search/);
  });

  it("says a recording and an unreadable format will never be parsed, even before the worker runs", async () => {
    const rec = await upload("interview_recording", "call.m4a", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    expect(rec.completed.note).toMatch(/recording/);
    expect(rec.completed.note).toMatch(/never transcribes/);
    expect(rec.completed.note).not.toMatch(/once derived_status is ready/);
    const deck = await upload("other", "readout.pptx", new Uint8Array([80, 75, 3, 4]));
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
    const empty = await alice.api("POST", `${P}/sources`, { kind: "other", title: "Sample source with no file yet" });
    expect(empty.status).toBe(201);
    const withEmpty = await alice.api("GET", `${P}/search?query=crisis&kind=other`);
    expect(withEmpty.body.coverage.statement).toBe(
      "Searched the primary text of 0 sources. Not searched: 1 has no primary file yet; 1 has a primary that could not be parsed (unsupported, too large or failed).",
    );
    const recordings = await alice.api("GET", `${P}/search?query=crisis&kind=interview_recording`);
    expect(recordings.body.coverage.statement).toBe("Searched the primary text of 0 sources. Not searched: 1 is a recording with no transcript (add the transcript as its own source).");
  });

  it("warns when a speaker filter meets a source with no speakers, or a name nobody uses", async () => {
    const notes = await upload("interviewer_notes", "notes.txt", "We met the ops lead.\n\nShe plans by the week.\n");
    const call = await upload("interview_transcript", "call.txt", "Interviewer: How do you plan?\nDana: By the week.\nInterviewer: Who decides?\nDana: The ops lead.\n");
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
    const { recordId } = await upload("interviewer_notes", "long.txt", words.join("\n\n") + "\n");
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
