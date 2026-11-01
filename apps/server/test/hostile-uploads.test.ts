import { request } from "node:http";
import { connect, type Socket } from "node:net";
import { constants, deflateRawSync, deflateSync } from "node:zlib";
import { MAX_PDF_PAGES, MAX_SEGMENTS } from "@whatbuild/parsers";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../src/config.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Hostile files through the server's own upload path: the relay's limits, the worker that parses
// what arrives in a process of its own held to a memory and a time limit, and the Story and mockup HTML a
// request parses. The parsers' own hostile cases are in packages/parsers/test/hostile.test.ts;
// these show the server stays up, keeps answering, and says what happened.

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

/** A source with an upload grant for its first attachment. */
async function grant(path: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { title: `Upload of ${path}`, path });
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

/** The status of each whole HTTP response to arrive on a raw connection, in order; `nth` rejects if the connection closes first. */
function statuses(socket: Socket) {
  let pending = Buffer.alloc(0);
  const seen: number[] = [];
  let closed = false;
  const waiters: (() => void)[] = [];
  const wake = () => waiters.splice(0).forEach((w) => w());
  socket.on("data", (d: Buffer) => {
    pending = Buffer.concat([pending, d]);
    for (let end = pending.indexOf("\r\n\r\n"); end >= 0; end = pending.indexOf("\r\n\r\n")) {
      const head = pending.subarray(0, end).toString();
      const length = Number(/^content-length: *(\d+)/im.exec(head)?.[1] ?? 0);
      if (pending.length < end + 4 + length) break;
      seen.push(Number(head.slice(9, 12)));
      pending = pending.subarray(end + 4 + length);
    }
    wake();
  });
  socket.on("error", () => {});
  socket.on("close", () => {
    closed = true;
    wake();
  });
  return {
    async nth(n: number) {
      while (seen.length <= n) {
        if (closed) throw new Error(`The connection closed after ${seen.length} responses.`);
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      return seen[n];
    },
  };
}

async function derivation(recordId: string, as = alice, product = P) {
  const list = await as.api("GET", `${product}/sources/${recordId}/derivations`);
  return list.body.items[0] as { status: string; status_detail: string | null; parser: string; parser_version: string };
}

/** A PDF of these objects, each a dictionary or a dictionary with a stream. */
function pdf(objects: (string | [string, Buffer])[]): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(length);
    const part = typeof o === "string" ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`) : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o[0]}\nstream\n`), o[1], Buffer.from("\nendstream\nendobj\n")]);
    parts.push(part);
    length += part.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

/** A PDF of `pages` pages that all draw one compressed content stream of `text`. */
function pdfDrawing(pages: number, text: string): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 5} 0 R`).join(" ");
  const stream = deflateSync(Buffer.from(`BT /F1 12 Tf 72 720 Td 14 TL\n${text}ET`), { level: 9 });
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    [`<< /Length ${stream.length} /Filter /FlateDecode >>`, stream],
    ...Array<string>(pages).fill("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"),
  ]);
}

/** Runs the worker until the queue is empty while asking the server something every 50 ms. */
async function drainWhileAsking(harness: Harness, who: Browser) {
  let draining = true;
  const answers: { status: number; ms: number }[] = [];
  const asking = (async () => {
    while (draining) {
      const started = performance.now();
      const r = await who.api("GET", "/api/v1/me/products");
      answers.push({ status: r.status, ms: performance.now() - started });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  const started = performance.now();
  await harness.worker.drain();
  const ms = performance.now() - started;
  draining = false;
  await asking;
  return { ms, answers: answers.length, slowest: Math.max(...answers.map((a) => a.ms)), refused: answers.filter((a) => a.status !== 200).length };
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

  it("reads and drops the rest of a body it refused partway, so the sender's connection takes the next request", async () => {
    const { upload } = await grant("long.txt");
    const url = new URL(upload.url);
    const socket = connect(Number(url.port), url.hostname);
    const seen = statuses(socket);
    const put = (fields: string) => `PUT ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n${Object.entries(upload.headers).map(([k, v]) => `${k}: ${v}\r\n`).join("")}${fields}\r\n`;
    // Chunked, so the relay counts what arrives: 2 MiB against a limit of 1 MiB, all sent before the answer is read.
    socket.write(put("Transfer-Encoding: chunked\r\n"));
    for (let sent = 0; sent < 2 * MiB; sent += 64 * 1024) socket.write(Buffer.concat([Buffer.from("10000\r\n"), Buffer.alloc(64 * 1024), Buffer.from("\r\n")]));
    socket.write("0\r\n\r\n");
    expect(await seen.nth(0)).toBe(413);
    socket.write(`${put("Content-Length: 14\r\n")}Small enough.\n`);
    expect(await seen.nth(1)).toBe(201);
    socket.destroy();
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

  it("keeps nothing from a sender who hangs up partway, keeps answering, and still takes the file under the grant", async () => {
    const { upload } = await grant("cut.txt");
    const stored = h.blobs.blobs.size;
    const url = new URL(upload.url);
    await new Promise<void>((resolve) => {
      const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: "PUT", headers: { ...upload.headers, "content-length": String(512 * 1024) } });
      req.on("error", () => resolve());
      req.on("close", () => resolve());
      req.write(new Uint8Array(64 * 1024), () => setTimeout(() => req.destroy(), 50));
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.blobs.blobs.size).toBe(stored);
    expect((await alice.api("GET", "/api/v1/me/products")).status).toBe(200);
    const fine = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: "Whole this time.\n" });
    expect(fine.status).toBe(201);
  });
});

describe("downloads", () => {
  it("serves a file whole and by a byte range, refuses a range past its end, and keeps answering after a reader hangs up partway", async () => {
    const { recordId, upload } = await grant("notes.txt");
    const bytes = new Uint8Array(512 * 1024).map((_, i) => 97 + (i % 26));
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes })).status).toBe(201);
    const fileUrl = `${h.baseUrl}${P}/sources/${recordId}/attachment?path=notes.txt`;
    const get = (headers: Record<string, string> = {}) => fetch(fileUrl, { headers: { cookie: alice.cookie, ...headers } });

    const whole = await get();
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-length")).toBe(String(bytes.length));
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);

    const part = await get({ range: "bytes=100-199" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${bytes.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(100, 200));

    const past = await get({ range: `bytes=${bytes.length}-` });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe(`bytes */${bytes.length}`);

    const url = new URL(fileUrl);
    await new Promise<void>((resolve, reject) => {
      const req = request({ host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, headers: { cookie: alice.cookie } }, (res) => {
        res.once("data", () => req.destroy());
        res.on("close", () => resolve());
      });
      req.on("error", (e) => (req.destroyed ? resolve() : reject(e)));
      req.end();
    });
    expect((await get()).status).toBe(200);
  });
});

describe("an uploaded HTML page", () => {
  it("is shown only by its view route, as a page in a sandbox that runs no script, and its bytes are only ever an attachment", async () => {
    const html = '<!doctype html><title>Upload</title><p style="color:red">Hi</p><img src="/api/v1/me"><script>parent.postMessage(document.cookie, "*")</script>';
    const { recordId, upload } = await grant("page.html");
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: html })).status).toBe(201);
    const view = await fetch(`${h.baseUrl}${P}/sources/${recordId}/attachment/view?path=page.html`, { headers: { cookie: alice.cookie } });
    expect(view.status).toBe(200);
    expect(view.headers.get("content-type")).toMatch(/^text\/html/);
    const csp = view.headers.get("content-security-policy")!;
    expect(csp).toBe("sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
    expect(csp).not.toContain("allow-scripts");
    expect(view.headers.get("cache-control")).toBe("private, no-store");
    expect(await view.text()).toBe(html);
    // Its bytes, through the attachment route, are a file to save, never a page.
    const bytes = await fetch(`${h.baseUrl}${P}/sources/${recordId}/attachment?path=page.html`, { headers: { cookie: alice.cookie } });
    expect(bytes.headers.get("content-type")).toBe("application/octet-stream");
    expect(bytes.headers.get("content-disposition")).toMatch(/^attachment;/);
    // Any other attachment is refused by the view route, and so is a session that is not one.
    const other = await grant("notes.txt");
    expect((await fetch(other.upload.url, { method: "PUT", headers: other.upload.headers, body: "<p>Text, not a page.</p>" })).status).toBe(201);
    const refused = await fetch(`${h.baseUrl}${P}/sources/${other.recordId}/attachment/view?path=notes.txt`, { headers: { cookie: alice.cookie } });
    expect(refused.status).toBe(415);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("not_html");
    expect((await fetch(`${h.baseUrl}${P}/sources/${recordId}/attachment/view?path=page.html`)).status).toBe(401);
    expect((await fetch(`${h.baseUrl}${P}/sources/${recordId}/attachment/view?path=missing.html`, { headers: { cookie: alice.cookie } })).status).toBe(404);
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

/** A harness of its own, with these parse limits, and a signed-in owner's product in it. */
function withLimits(limits: Partial<ServerConfig>) {
  const at = { h: null as unknown as Harness, owner: null as unknown as Browser, product: "" };
  beforeAll(async () => {
    at.h = await startHarness({ relayMaxBytes: 8 * MiB, ...limits });
    at.owner = await at.h.signIn("dana@example.com", "Dana Example");
    const t = await at.owner.api("POST", "/api/v1/tenants", { name: "Limits Co" });
    at.product = `/api/v1/p/${(await at.owner.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Intake" })).body.path}`;
  });
  afterAll(async () => at.h?.close());
  /** Uploads each file as the first attachment of a new source; their ids, in order. */
  const upload = async (files: { path: string; body: Uint8Array | string }[]) => {
    const ids: string[] = [];
    for (const f of files) {
      const created = await at.owner.api("POST", `${at.product}/sources/with-upload`, { title: `Upload of ${f.path}`, path: f.path });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body: f.body })).status).toBe(201);
      ids.push(created.body.record.record_id);
    }
    return ids;
  };
  return { at, upload };
}

describe("a parse that needs more memory than the server gives one file", () => {
  const { at, upload } = withLimits({ parseMemoryMb: 128, parseTimeoutSeconds: 60 });

  it("stops it in its own process, records it as failed with the reason, and keeps answering", async () => {
    // A 190 KB PDF whose one content stream unpacks to 64 MB of text took 7.8 seconds and 1.4 GB
    // inside the server; dense HTML near the sandbox's file limit took 1 GB.
    const ops = "(ab) Tj T* ".repeat(Math.ceil((64 * MiB) / 11));
    const bomb = pdfDrawing(1, ops);
    expect(bomb.length).toBeLessThan(256 * 1024);
    const ids = await upload([
      { path: "unpacks.pdf", body: bomb },
      { path: "dense.html", body: "<li>a".repeat((2 * MiB) / 5) },
    ]);
    const run = await drainWhileAsking(at.h, at.owner);
    expect(run.ms).toBeLessThan(20_000);
    expect(run.refused).toBe(0);
    expect(run.answers).toBeGreaterThan(0);
    expect(run.slowest).toBeLessThan(1000);
    for (const [i, parser] of [[0, "pdf"], [1, "html"]] as const) {
      const d = await derivation(ids[i]!, at.owner, at.product);
      expect(d.status, parser).toBe("failed");
      // A stop has more than one way to read, and a slow machine can see either.
      expect(d.status_detail).toMatch(/^parsing it .*, so it was stopped; the file is stored but not parsed$/);
      expect(d.parser).toBe(parser);
    }
  });

  it(`records a file of more than ${MAX_SEGMENTS} paragraphs, or a PDF of more than ${MAX_PDF_PAGES} pages, as too large`, async () => {
    const ids = await upload([
      { path: "letters.txt", body: "a\n\n".repeat(MAX_SEGMENTS + 50_000) },
      { path: "blank.pdf", body: pdfDrawing(20_000, "") },
    ]);
    const run = await drainWhileAsking(at.h, at.owner);
    expect(run.ms).toBeLessThan(10_000);
    expect(run.slowest).toBeLessThan(1000);
    expect(await derivation(ids[0]!, at.owner, at.product)).toMatchObject({ status: "too_large", status_detail: `the file makes more than ${MAX_SEGMENTS} paragraphs; files that make more are stored but not read` });
    expect(await derivation(ids[1]!, at.owner, at.product)).toMatchObject({ status: "too_large", parser: "pdf", parser_version: "6", status_detail: `the PDF has 20000 pages; PDFs over ${MAX_PDF_PAGES} pages are stored but not parsed` });
  });

  it("goes on parsing ordinary files in a new process each time", async () => {
    const ids = await upload([
      { path: "notes.md", body: "# Visit\n\nCrews text the office every Friday.\n" },
      { path: "plan.pdf", body: pdfDrawing(2, "(Crews plan the week on Friday.) Tj T*\n") },
    ]);
    await at.h.worker.drain();
    for (const id of ids) expect((await derivation(id, at.owner, at.product)).status).toBe("ready");
    const text = await at.owner.api("GET", `${at.product}/sources/${ids[1]}/derived/text`);
    expect(text.body.text).toBe("# Page 1\n\nCrews plan the week on Friday.\n\n# Page 2\n\nCrews plan the week on Friday.\n");
  });
});

describe("a parse that takes longer than the server gives one file", () => {
  const { at, upload } = withLimits({ parseMemoryMb: 384, parseTimeoutSeconds: 1 });

  it("stops its process at the limit, records it as failed with the reason, and keeps answering", async () => {
    // Two thousand pages drawing one small stream of text: a 300 KB file that takes seconds to read.
    const [id] = await upload([{ path: "slow.pdf", body: pdfDrawing(MAX_PDF_PAGES - 1, "(crews plan the week) Tj T*\n".repeat(730)) }]);
    const run = await drainWhileAsking(at.h, at.owner);
    expect(run.ms).toBeLessThan(5000);
    expect(run.slowest).toBeLessThan(1000);
    expect(await derivation(id!, at.owner, at.product)).toMatchObject({
      status: "failed",
      parser: "pdf",
      status_detail: "parsing it took longer than the 1 second this server gives one file, so it was stopped; the file is stored but not parsed",
    });
  });
});

describe("a job that keeps stopping the worker", () => {
  /** A source whose attachment is queued to be read but not read yet, with its job made to look abandoned `attempts` times. */
  async function abandoned(attempts: number) {
    const src = await alice.api("POST", `${P}/sources`, { title: `Notes tried ${attempts} times` });
    expect(src.status, JSON.stringify(src.body)).toBe(201);
    const g = await alice.api("POST", `${P}/sources/${src.body.record_id}/uploads`, { record_id: src.body.record_id, path: "notes.md" });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect((await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: "# Notes\n\nA plain note.\n" })).status).toBe(201);
    // As if the process had stopped while running it, `attempts` times, the last over ten minutes ago.
    const r = await sql`
      update jobs set attempts = ${attempts}, locked_at = now() - interval '11 minutes', locked_by = 'a stopped process'
      where kind = 'derive' and done_at is null and payload->>'record_id' = ${src.body.record_id}`.execute(h.db);
    expect(Number(r.numAffectedRows)).toBe(1);
    return src.body.record_id as string;
  }
  const job = async (recordId: string) =>
    (await sql<{ done_at: string | null; error: string | null; attempts: number }>`select done_at, error, attempts from jobs where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db)).rows[0]!;

  it("gives up nothing when what records it fails, and tries again once its lock is stale", async () => {
    const recordId = await abandoned(5);
    const put = vi.spyOn(h.ports.blobs, "put").mockRejectedValueOnce(new Error("the store refused it"));
    await h.worker.drain();
    expect(put).toHaveBeenCalled();
    put.mockRestore();
    expect(await job(recordId)).toMatchObject({ done_at: null, attempts: 5 });
    expect((await alice.api("GET", `${P}/sources/${recordId}/derivations`)).body.items).toEqual([]);
    // It waits, rather than failing again each time the worker looks.
    await h.worker.drain();
    expect(await job(recordId)).toMatchObject({ done_at: null, attempts: 5 });
    await sql`update jobs set locked_at = now() - interval '11 minutes' where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db);
    await h.worker.drain();
    expect((await job(recordId)).done_at).not.toBeNull();
    expect(await derivation(recordId)).toMatchObject({ status: "failed", parser: "none" });
  });

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
    expect(d.status_detail).toContain("did not finish in 5 attempts, the last because the server stopped");
    expect((await alice.api("GET", `${P}/sources/${recordId}`)).body).toMatchObject({ derived_status: "failed", status_detail: d.status_detail });
    // Rederive asks for one more try, and the text read becomes the source's.
    expect((await alice.api("POST", `${P}/sources/${recordId}/rederive`, {})).status).toBe(200);
    await h.worker.drain();
    expect((await derivation(recordId)).status).toBe("ready");
    expect((await alice.api("GET", `${P}/sources/${recordId}`)).body).toMatchObject({ derived_status: "ready", text_from: "notes.md" });
  });

  it("still runs a job with an attempt left", async () => {
    const recordId = await abandoned(4);
    await h.worker.drain();
    expect((await job(recordId)).error).toBeNull();
    expect((await derivation(recordId)).status).toBe("ready");
  });
});

describe("a read that keeps failing", () => {
  const LATER = "9999_from_a_later_release.sql";
  /** A source whose attachment is queued to be read, and its stored bytes' key. */
  async function queued(title: string) {
    const src = await alice.api("POST", `${P}/sources`, { title });
    expect(src.status, JSON.stringify(src.body)).toBe(201);
    const recordId = src.body.record_id as string;
    const g = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { record_id: recordId, path: "notes.md" });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect((await fetch(g.body.url, { method: "PUT", headers: g.body.headers, body: "# Notes\n\nCrews meet at the depot.\n" })).status).toBe(201);
    // Read in the source's organization, as row-level security asks; its job names it.
    const key = await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', tenant_id, true) from jobs where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(trx);
      return (await sql<{ blob_key: string }>`select blob_key from file_versions where record_id = ${recordId}`.execute(trx)).rows[0]!.blob_key;
    });
    return { recordId, key };
  }
  const job = async (recordId: string) =>
    (await sql<{ attempts: number; done_at: string | null; locked_at: string | null; error: string | null }>`
      select attempts, done_at, locked_at, error from jobs where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db)).rows[0]!;
  /** One attempt: what the worker claims now, its wait after a failed attempt left out. */
  const attempt = async (recordId: string) => {
    await sql`update jobs set run_after = now() where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db);
    await h.worker.drain();
  };
  /** Each attempt fails as reading the stored bytes throws, rather than stopping the process; `then` runs first. */
  const refuse = (key: string, then: () => Promise<void> = async () => {}) => {
    const get = h.blobs.get;
    h.blobs.get = async (k: string) => {
      if (k !== key) return get.call(h.blobs, k);
      await then();
      throw new Error("the store refused these bytes");
    };
    return () => {
      h.blobs.get = get;
    };
  };
  const reading = async (recordId: string) => (await alice.api("GET", `${P}/sources/${recordId}?detail=full`)).body.attachments[0].text as { status: string; status_detail: string | null };

  it("records the reading as failed when it gives the read up at its last attempt, so Read it again reads it", async () => {
    const { recordId, key } = await queued("Depot notes read five times");
    const serve = refuse(key);
    try {
      for (let n = 1; n < 5; n++) {
        await attempt(recordId);
        // An attempt left: the job waits for the next, and the attachment is still being read.
        expect(await job(recordId)).toMatchObject({ attempts: n, done_at: null, error: "the store refused these bytes" });
        expect((await reading(recordId)).status).toBe("pending");
      }
      await attempt(recordId);
    } finally {
      serve();
    }
    // Given up, with the reading that says so: no longer "Reading" for good.
    expect(await job(recordId)).toMatchObject({ attempts: 5, done_at: expect.any(String), locked_at: null, error: "the store refused these bytes" });
    const d = await derivation(recordId);
    expect(d).toMatchObject({ status: "failed", parser: "none" });
    expect(d.status_detail).toBe(
      'this file could not be read: reading it failed 5 times, so it was given up; the file is stored, and reading it again may help (Read it again in the web app, or derived_write(action="rederive"))',
    );
    expect(await reading(recordId)).toEqual(expect.objectContaining({ status: "failed", status_detail: d.status_detail }));
    expect((await alice.api("GET", `${P}/sources/${recordId}`)).body).toMatchObject({ derived_status: "failed", status_detail: d.status_detail });
    const log = (await alice.api("GET", `${P}/activity?entity_id=${recordId}&limit=20`)).body.items as { action: string; summary: string }[];
    expect(log).toContainEqual(expect.objectContaining({ action: "derivation_failed", summary: "Could not read the text of notes.md: failed" }));

    // Read it again, as the web app asks for it: the text read becomes the source's.
    expect((await alice.api("POST", `${P}/sources/${recordId}/rederive`, { path: "notes.md" })).status).toBe(200);
    await h.worker.drain();
    expect((await derivation(recordId)).status).toBe("ready");
    expect(await reading(recordId)).toMatchObject({ status: "ready" });
    expect((await alice.api("GET", `${P}/sources/${recordId}`)).body).toMatchObject({ derived_status: "ready", text_from: "notes.md" });
  });

  it("gives up nothing while a later version's migration is recorded, leaving the read and its last attempt for that version", async () => {
    const { recordId, key } = await queued("Depot notes read as a release rolls out");
    await sql`update jobs set attempts = 4 where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db);
    // The release's migration job records its migration while this worker's last attempt runs,
    // after the worker and its claim last looked: the give-up looks again itself.
    let serve = refuse(key, async () => {
      await sql`insert into schema_migrations (name) values (${LATER}) on conflict do nothing`.execute(h.db);
    });
    try {
      await attempt(recordId);
      expect(await job(recordId)).toEqual({ attempts: 4, done_at: null, locked_at: null, error: "the store refused these bytes" });
      expect((await alice.api("GET", `${P}/sources/${recordId}/derivations`)).body.items).toEqual([]);
      expect((await reading(recordId)).status).toBe("pending");
    } finally {
      serve();
      await sql`delete from schema_migrations where name = ${LATER}`.execute(h.db);
    }
    // The database holds only migrations this version carries again, as when the version that
    // carries them runs: the read has its last attempt, and is given up when that fails too.
    serve = refuse(key);
    try {
      await attempt(recordId);
    } finally {
      serve();
    }
    expect(await job(recordId)).toMatchObject({ attempts: 5, done_at: expect.any(String) });
    expect(await derivation(recordId)).toMatchObject({ status: "failed", parser: "none", status_detail: expect.stringContaining("could not be read") });
  });

  it("gives up nothing it cannot record, and leaves the job to the give-up of abandoned jobs", async () => {
    const { recordId, key } = await queued("Depot notes read with nowhere to keep the reading");
    await sql`update jobs set attempts = 4 where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db);
    const serve = refuse(key);
    const put = h.blobs.put;
    // The failed reading's own bytes cannot be stored either, so its transaction rolls back, give-up and all.
    h.blobs.put = async (k, data, options) => {
      if (k.includes(`/r/${recordId}/d/`)) throw new Error("the store is full");
      return put.call(h.blobs, k, data, options);
    };
    try {
      await attempt(recordId);
    } finally {
      serve();
      h.blobs.put = put;
    }
    expect(await job(recordId)).toMatchObject({ attempts: 5, done_at: null, locked_at: expect.any(String) });
    expect((await alice.api("GET", `${P}/sources/${recordId}/derivations`)).body.items).toEqual([]);
    // Once its lock is ten minutes old, the give-up of abandoned jobs takes it, and records the reading.
    await sql`update jobs set locked_at = now() - interval '11 minutes' where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db);
    await h.worker.drain();
    expect(await job(recordId)).toMatchObject({ done_at: expect.any(String) });
    expect(await derivation(recordId)).toMatchObject({ status: "failed", parser: "none" });
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
