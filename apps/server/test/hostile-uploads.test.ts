import { request } from "node:http";
import { constants, deflateRawSync } from "node:zlib";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Hostile files through the server's own upload path: the relay's limits, the worker that parses
// what arrives, and the Story and mockup HTML a request parses. The parsers' own hostile cases are
// in packages/parsers/test/hostile.test.ts; these show the server stays up and says what happened.

const MiB = 1024 * 1024;

let h: Harness;
let alice: Browser;
let P: string;

beforeAll(async () => {
  h = await startHarness({ relayMaxBytes: MiB });
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Hostile Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Intake" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

/** A source with an upload grant for its primary file. */
async function grant(path: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { title: `Upload of ${path}`, path, role: "primary" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return { recordId: created.body.record.record_id as string, upload: created.body.upload as { url: string; headers: Record<string, string>; max_bytes: number } };
}

/** A DOCX whose document part inflates to `mib` MiB from about 1 KB a MiB, declaring a size of `declared`. */
function docxBomb(mib: number, declared: number): Uint8Array {
  const chunk = deflateRawSync(Buffer.alloc(MiB, 0x20), { level: 9, finishFlush: constants.Z_SYNC_FLUSH });
  const data = Buffer.concat([...Array<Buffer>(mib).fill(chunk), Buffer.from([0x03, 0x00])]);
  const name = Buffer.from("word/document.xml");
  const u16 = (n: number) => Buffer.from([n & 0xff, n >> 8]);
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0);
    return b;
  };
  const head = [u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(data.length), u32(declared), u16(name.length), u16(0)];
  const local = Buffer.concat([u32(0x04034b50), ...head, name, data]);
  const central = Buffer.concat([u32(0x02014b50), u16(20), ...head, u16(0), u16(0), u16(0), u32(0), u32(0), name]);
  return new Uint8Array(Buffer.concat([local, central, u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length), u16(0)]));
}

async function derivation(recordId: string) {
  const list = await alice.api("GET", `${P}/sources/${recordId}/derivations`);
  return list.body.items[0] as { status: string; status_detail: string | null; parser: string };
}

describe("the upload relay", () => {
  it("refuses a body over the grant's limit, whether its length is declared or streamed, and keeps nothing", async () => {
    const { upload } = await grant("big.txt");
    expect(upload.max_bytes).toBe(MiB);
    const stored = h.blobs.blobs.size;
    const declared = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(2 * MiB) });
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { error: { code: string } }).error.code).toBe("too_large");
    // No Content-Length: the relay counts what arrives and stops at the limit.
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 4 * MiB) return c.close();
        sent += 64 * 1024;
        c.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const streamed = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(h.blobs.blobs.size).toBe(stored);
    // The grant was not spent: the right bytes still go through it.
    const fine = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: "Small enough.\n" });
    expect(fine.status).toBe(201);
  });

  it("refuses a length that is not a number", async () => {
    const { upload } = await grant("odd.txt");
    const url = new URL(upload.url);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: "PUT", headers: { ...upload.headers, "content-length": "12abc" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end("hello");
    });
    expect(status).toBe(400);
  });
});

describe("hostile files through the relay and the worker", () => {
  it("records a zip bomb as too large, in bounded time, and keeps answering", async () => {
    // Under 1 MB on the wire, 900 MiB unpacked, declaring a harmless size.
    const { recordId, upload } = await grant("bomb.docx");
    const bytes = docxBomb(900, 4096);
    expect(bytes.length).toBeLessThan(MiB);
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes })).status).toBe(201);
    const rss = process.memoryUsage().rss;
    const started = performance.now();
    await h.worker.drain();
    expect(performance.now() - started).toBeLessThan(10_000);
    expect((process.memoryUsage().rss - rss) / MiB).toBeLessThan(400);
    const d = await derivation(recordId);
    expect(d.status).toBe("too_large");
    expect(d.status_detail).toContain("unpacks to more than");
    expect((await alice.api("GET", "/api/v1/me/products")).status).toBe(200);
  });

  it("records HTML that would multiply its elements, or nest without end, as failed with the reason", async () => {
    const amplified = "<div><p>" + Array.from({ length: 500 }, (_, i) => `<b class=c${i}>`).join("") + "</p></div>" + "<div>x</div>".repeat(4_000);
    const deep = "<div>".repeat(100_000) + "x";
    const cases = [
      { path: "amplified.html", body: amplified, reason: "elements" },
      { path: "deep.html", body: deep, reason: "deep" },
    ];
    const ids: string[] = [];
    for (const c of cases) {
      const { recordId, upload } = await grant(c.path);
      expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: c.body })).status).toBe(201);
      ids.push(recordId);
    }
    const started = performance.now();
    await h.worker.drain();
    expect(performance.now() - started).toBeLessThan(10_000);
    for (const [i, c] of cases.entries()) {
      const d = await derivation(ids[i]!);
      expect(d.status, c.path).toBe("failed");
      expect(d.status_detail, c.path).toContain(c.reason);
    }
  });
});

describe("a job that keeps stopping the worker", () => {
  /** A source whose primary file is queued for parsing but not parsed yet, with its job made to look abandoned `attempts` times. */
  async function abandoned(attempts: number) {
    const src = await alice.api("POST", `${P}/sources`, { title: `Notes tried ${attempts} times` });
    expect(src.status, JSON.stringify(src.body)).toBe(201);
    const note = await alice.api("POST", `${P}/sources/${src.body.record_id}/notes`, { record_id: src.body.record_id, path: "notes.md", text: "# Notes\n\nA plain note.\n", role: "primary" });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    // As if the process had stopped while running it, `attempts` times, the last over ten minutes ago.
    const r = await sql`
      update jobs set attempts = ${attempts}, locked_at = now() - interval '11 minutes', locked_by = 'a stopped process'
      where kind = 'derive' and done_at is null and payload->>'record_id' = ${src.body.record_id}`.execute(h.db);
    expect(Number(r.numAffectedRows)).toBe(1);
    return src.body.record_id as string;
  }
  const job = async (recordId: string) =>
    (await sql<{ done_at: string | null; error: string | null; attempts: number }>`select done_at, error, attempts from jobs where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db)).rows[0]!;

  it("gives it up after five attempts that never finished, records the derivation as failed, and parses nothing", async () => {
    const recordId = await abandoned(5);
    await h.worker.drain();
    const j = await job(recordId);
    expect(j.done_at).not.toBeNull();
    expect(j.attempts).toBe(5);
    expect(j.error).toContain("gave it up");
    const d = await derivation(recordId);
    expect(d.status).toBe("failed");
    expect(d.parser).toBe("none");
    expect(d.status_detail).toContain("stopped the server 5 times");
    // Rederive asks for one more try.
    expect((await alice.api("POST", `${P}/sources/${recordId}/rederive`, {})).status).toBe(200);
    await h.worker.drain();
    expect((await derivation(recordId)).status).toBe("ready");
  });

  it("still runs a job with an attempt left", async () => {
    const recordId = await abandoned(4);
    await h.worker.drain();
    expect((await job(recordId)).error).toBeNull();
    expect((await derivation(recordId)).status).toBe("ready");
  });
});

describe("Story and mockup HTML a request parses", () => {
  const amplified = "<div><p>" + Array.from({ length: 500 }, (_, i) => `<b class=c${i}>`).join("") + "</p></div>" + "<div>x</div>".repeat(4_000);
  // Under the 1,000,000 characters a page may hold, so the parse is what refuses it.
  const deep = `<!doctype html><html><body>${"<div>".repeat(150_000)}</body></html>`;

  it("refuses a page that nests without end or multiplies its elements, at once, and stays up", async () => {
    for (const [html, reason] of [[deep, "deep"], [amplified, "elements"]] as const) {
      const started = performance.now();
      const story = await alice.api("POST", `${P}/story/pages/hostile/versions`, { title: "Hostile", html });
      expect(story.status, JSON.stringify(story.body).slice(0, 300)).toBe(422);
      expect(story.body.error.code).toBe("invalid_html");
      expect(JSON.stringify(story.body.error.details)).toContain(reason);
      const mockup = await alice.api("POST", `${P}/mockups`, { title: "Hostile", brief: "Hostile.", pages: [{ page_id: "p", title: "P", html }] });
      expect(mockup.status).toBe(422);
      expect(JSON.stringify(mockup.body.error.details)).toContain(reason);
      expect(performance.now() - started).toBeLessThan(5_000);
    }
    expect((await alice.api("GET", `${P}/story/pages`)).status).toBe(200);
  });
});
