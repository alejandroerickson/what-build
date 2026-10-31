import { execFileSync, spawn } from "node:child_process";
import { closeSync, fstatSync, openSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { derive, toParsedFile } from "@whatbuild/parsers";
import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processParser } from "../src/parse-process.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// The boundary around a parse (apps/server/src/parse-process.ts, parse-child.ts): whatever becomes
// of the process a file is parsed in, the server keeps answering and the reading says why. The
// stand-ins (test/parse-stand-ins) are processes and threads that really do what each case says.

const MiB = 1024 * 1024;
const CHILD = new URL("./parse-stand-ins/child.ts", import.meta.url);
const THREAD = new URL("./parse-stand-ins/thread.ts", import.meta.url);
const REAL_CHILD = new URL("../src/parse-child.ts", import.meta.url);
const STORED = "the file is stored but not parsed";
const OPTIONS = { mediaType: null, parseCapBytes: 25 * MiB };
const LIMITS = { memoryMb: 128, timeoutSeconds: 20 };

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
/** Runs the stand-in child's act of that name, from a file of these bytes. */
const standIn = (act: string, bytes: Uint8Array = encode("x"), limits = LIMITS) => processParser(limits, { child: CHILD }).parse(bytes, `${act}.txt`, OPTIONS);
/** Runs the real child, with the stand-in thread's act of that name in place of the parse. */
const withThread = (act: string, limits = LIMITS) => processParser(limits, { thread: THREAD }).parse(encode("x"), `${act}.txt`, OPTIONS);

/** A whole answer as a child frames it. */
function framed(head: unknown, text: Uint8Array = new Uint8Array(0), declare?: number): Uint8Array {
  const json = Buffer.from(typeof head === "string" ? head : JSON.stringify(head));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(declare ?? json.length);
  return new Uint8Array(Buffer.concat([length, json, text]));
}

/** The processes whose parent is `parent`, and what each runs. */
function childrenOf(parent: number): { pid: number; command: string }[] {
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,stat=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m && Number(m[2]) === parent && !m[3]!.startsWith("Z"))
    .map((m) => ({ pid: Number(m[1]), command: m[4]! }));
}
const parseChildren = (parent = process.pid) => childrenOf(parent).filter((c) => c.command.includes("parse-child"));
/** Whether a process is running: not gone, and not a zombie waiting for its parent. */
function alive(pid: number): boolean {
  try {
    const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return stat !== "" && !stat.startsWith("Z");
  } catch {
    return false;
  }
}
async function until(check: () => boolean, ms = 15_000, what = "the condition") {
  for (const started = performance.now(); performance.now() - started < ms; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  throw new Error(`Waited ${ms} ms for ${what}.`);
}

beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("a parse that ends in a fatal error", () => {
  it("ends only itself, and V8's fatal error for want of heap reads as the memory limit", async () => {
    const r = await standIn("fatal-heap", encode("x"), { memoryMb: 128, timeoutSeconds: 60 });
    expect(r).toMatchObject({ status: "failed", status_detail: `parsing it needed more than the 128 MB of memory this server gives one file, so it was stopped; ${STORED}`, char_count: 0 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("SIGABRT"));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("FATAL ERROR"));
  });

  it("says what ended it, whichever way that was", async () => {
    for (const [act, detail] of [
      ["abort", `parsing it ended in a fatal error (SIGABRT), so it was stopped; ${STORED}`],
      ["segfault", `parsing it ended in a fatal error (SIGSEGV), so it was stopped; ${STORED}`],
      ["killed", `the system stopped the process parsing it, most likely for lack of memory; ${STORED}`],
      ["exit-3", `the process parsing it exited with code 3 before it finished; ${STORED}`],
      ["exit-0", "the parser stopped before it finished"],
      ["cut-short", `parsing it ended in a fatal error (SIGABRT), so it was stopped; ${STORED}`],
    ] as const) expect(await standIn(act), act).toMatchObject({ status: "failed", status_detail: detail, text_md: new Uint8Array(0) });
    expect(parseChildren()).toEqual([]);
  });

  it("says the same when the thread doing the parse brings the real process down", async () => {
    expect((await withThread("aborts")).status_detail).toBe(`parsing it ended in a fatal error (SIGABRT), so it was stopped; ${STORED}`);
    expect((await withThread("segfaults")).status_detail).toBe(`parsing it ended in a fatal error (SIGSEGV), so it was stopped; ${STORED}`);
  });

  it("keeps a thread's own failures as they were: its error, or its ending without an answer", async () => {
    expect(await withThread("throws")).toMatchObject({ status: "failed", status_detail: "TypeError: a parser fell over" });
    expect(await withThread("ends-silently")).toMatchObject({ status: "failed", status_detail: "the parser stopped before it finished" });
  });

  it("names the file's parser in the failed reading", async () => {
    const r = await processParser(LIMITS, { child: CHILD }).parse(encode("x"), "abort.txt", { mediaType: "text/plain", parseCapBytes: MiB });
    expect(r.parser).toBe("plaintext");
    expect(r.parser_version).not.toBe("0");
  });
});

describe("what a child writes", () => {
  const unreadable = `the process parsing it gave an answer that could not be read, so it was stopped; ${STORED}`;
  const says = (bytes: Uint8Array, limits = LIMITS) => standIn("says", bytes, limits);
  const parsed = { status: "ready", parser: "plain", parser_version: "1", status_detail: null, duration_ms: null, facts: {}, char_count: 2 };

  it("is taken when it is the shape of an answer", async () => {
    const r = await says(framed({ parsed: { ...parsed, facts: { pages: 2, name: "x", ok: true, names: ["a"] } }, text_bytes: 2 }, encode("hi")));
    expect(r).toMatchObject({ status: "ready", parser: "plain", char_count: 2, facts: { pages: 2, name: "x", ok: true, names: ["a"] } });
    expect(decode(r.text_md)).toBe("hi");
  });

  it("is refused when it is not, each of these as an answer that could not be read", async () => {
    const answers: [string, Uint8Array][] = [
      ["no JSON", framed("{{{{")],
      ["no answer at all", framed("null")],
      ["a length of nothing", framed("", new Uint8Array(0), 0)],
      ["a status there is none of", framed({ parsed: { ...parsed, status: "fine" }, text_bytes: 2 }, encode("hi"))],
      ["a field missing", framed({ parsed: { ...parsed, parser: undefined }, text_bytes: 2 }, encode("hi"))],
      ["a field too many", framed({ parsed: { ...parsed, extra: 1 }, text_bytes: 2 }, encode("hi"))],
      ["a fact that is an object", framed({ parsed: { ...parsed, facts: { a: { b: 1 } } }, text_bytes: 2 }, encode("hi"))],
      ["a null character in a field", framed({ parsed: { ...parsed, parser: "pl\u0000ain" }, text_bytes: 2 }, encode("hi"))],
      ["a null character in the text", framed({ parsed, text_bytes: 2 }, Buffer.from([0x61, 0]))],
      ["more characters than bytes", framed({ parsed: { ...parsed, char_count: 3 }, text_bytes: 2 }, encode("hi"))],
      ["a negative length", framed({ parsed, text_bytes: -1 }, encode("hi"))],
      ["a fractional length", framed({ parsed, text_bytes: 1.5 }, encode("hi"))],
      ["more text than it said", framed({ parsed, text_bytes: 2 }, encode("hi and more"))],
      ["more after saying it stopped", framed({ stopped: "memory" }, encode("and more"))],
      ["a stop of another kind", framed({ stopped: "for lunch" })],
    ];
    for (const [what, bytes] of answers) expect((await says(bytes)).status_detail, what).toBe(unreadable);
  });

  it("is not allocated for, or waited on, when it claims more than it may", async () => {
    const rss = process.memoryUsage().rss;
    const started = performance.now();
    expect((await says(framed("", new Uint8Array(0), 0xffffffff))).status_detail).toBe(unreadable);
    // Half of the parse's memory is what its buffers may take, so more text than that needed too much.
    expect((await says(framed({ parsed, text_bytes: 64 * MiB + 1 }))).status_detail).toBe(`parsing it needed more than the 128 MB of memory this server gives one file, so it was stopped; ${STORED}`);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect((process.memoryUsage().rss - rss) / MiB).toBeLessThan(40);
  });

  it("is stopped at once, whatever the flood, and costs the server next to nothing", async () => {
    const rss = process.memoryUsage().rss;
    const started = performance.now();
    expect((await standIn("floods-its-answer")).status_detail).toBe(unreadable);
    // What it said it would send and not a byte more, or, if the rest came along with it, nothing.
    expect((await standIn("floods-its-text")).text_md.length).toBeLessThanOrEqual(1024);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect((process.memoryUsage().rss - rss) / MiB).toBeLessThan(40);
  });

  it("on stderr is kept to a bounded tail, and is not an answer", async () => {
    const rss = process.memoryUsage().rss;
    const r = await standIn("floods-stderr", encode("x"), { memoryMb: 128, timeoutSeconds: 2 });
    // It wrote until the pipe closed, and that ended it, or it was still at it when the time was up.
    expect(r.status).toBe("failed");
    expect((process.memoryUsage().rss - rss) / MiB).toBeLessThan(40);
  });

  it("ends at the time limit, with SIGKILL, even if it answers nothing and ignores every other signal", async () => {
    for (const act of ["hangs", "ignores-being-asked"]) {
      const started = performance.now();
      expect((await standIn(act, encode("x"), { memoryMb: 64, timeoutSeconds: 1 })).status_detail).toBe(`parsing it took longer than the 1 second this server gives one file, so it was stopped; ${STORED}`);
      expect(performance.now() - started).toBeLessThan(5000);
    }
    await until(() => parseChildren().length === 0, 5000, "the children to end");
    expect(childrenOf(process.pid).filter((c) => c.command.includes("stand-ins"))).toEqual([]);
  });
});

describe("what a parse has of the server", () => {
  const SECRET = "WHATBUILD_TEST_SERVER_SECRET";
  let file: string;
  let fd: number;
  const listening = createServer();
  beforeAll(async () => {
    file = join(tmpdir(), `parse-process-${process.pid}-${Date.now()}.txt`);
    writeFileSync(file, "held open by the server");
    fd = openSync(file, "r");
    await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
    process.env[SECRET] = "from the server";
    process.env["NODE_OPTIONS"] = "--max-old-space-size=1";
    process.execArgv.push("--title=from-the-server");
  });
  afterAll(async () => {
    delete process.env[SECRET];
    delete process.env["NODE_OPTIONS"];
    process.execArgv.pop();
    closeSync(fd);
    rmSync(file);
  });
  /** Less what Node passes to any child, for collecting coverage, and what macOS itself sets in every process, even one started with none. */
  const without = (env: Record<string, string>) => Object.keys(env).filter((k) => k !== "NODE_V8_COVERAGE" && k !== "__CF_USER_TEXT_ENCODING");

  it("is nothing: a parse cannot read a variable the server has, and its thread starts with none of the server's flags", async () => {
    const seen = JSON.parse(decode((await withThread("reports")).text_md)) as { env: Record<string, string>; execArgv: string[]; bytes: number };
    expect(without(seen.env)).toEqual([]);
    expect(seen.execArgv).toEqual([]);
    expect(seen.bytes).toBe(1);
  });

  it("is nothing for the process it runs in either: no variables, no flags, no open files", async () => {
    const seen = JSON.parse(decode((await standIn("reports")).text_md)) as { env: Record<string, string>; execArgv: string[]; argv: string[]; cwd: string; descriptors: { fd: number; ino: number; socket: boolean }[] };
    expect(without(seen.env)).toEqual([]);
    expect(seen.execArgv).toEqual([]);
    // Its time limit and nothing else. The file's name goes on the pipe, not where anything on the instance can list it.
    expect(seen.argv).toEqual([String(LIMITS.timeoutSeconds)]);
    expect(seen.cwd).not.toBe(process.cwd());
    expect(seen.descriptors.map((d) => d.ino)).not.toContain(fstatSync(fd).ino);
    // Its pipes, in the places the real child reads and writes them.
    expect(seen.descriptors.filter((d) => d.fd <= 3 && d.socket).map((d) => d.fd)).toEqual([0, 2, 3]);
  });

  it("does not keep a port the server has let go of, while a parse runs", async () => {
    const port = (listening.address() as AddressInfo).port;
    const parser = processParser(LIMITS, { child: CHILD });
    // Started while the server listens, as a parse always is.
    const parsing = parser.parse(encode("x"), "hangs.txt", OPTIONS);
    await new Promise((resolve) => listening.close(resolve));
    const again = createServer();
    await new Promise<void>((resolve, reject) => {
      again.once("error", reject);
      again.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => again.close(resolve));
    parser.stop();
    await expect(parsing).rejects.toThrow("the server is stopping");
  });

  it.runIf(process.platform === "linux")("is told to the kernel: a parse is what ends first if the instance runs out of memory", async () => {
    const seen = JSON.parse(decode((await withThread("reports")).text_md)) as { oomScoreAdj: string };
    expect(seen.oomScoreAdj).toBe("1000");
  });
});

describe("a child and the server", () => {
  it("outlives neither its parse nor the server", async () => {
    await processParser(LIMITS).parse(encode("Crews.\n"), "a.txt", OPTIONS);
    await until(() => parseChildren().length === 0, 5000, "the child to end when its parse did");
  });

  it("ends when the server is killed, which sends it no signal, even with its thread busy", async () => {
    const server = spawn(process.execPath, [fileURLToPath(new URL("./parse-stand-ins/server.ts", import.meta.url))], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      await new Promise<void>((resolve, reject) => {
        server.stdout.once("data", () => resolve());
        server.once("exit", (code) => reject(new Error(`The stand-in for the server exited with ${code}.`)));
      });
      await until(() => parseChildren(server.pid!).length === 1, 15_000, "the parse to start");
      const [child] = parseChildren(server.pid!);
      expect(alive(child!.pid)).toBe(true);
      server.kill("SIGKILL");
      await until(() => !alive(child!.pid), 10_000, "the child to end after the server was killed");
    } finally {
      server.kill("SIGKILL");
    }
  });

  it("ends by itself a little past its time limit, should a server that is still there not have ended it", async () => {
    const child = spawn(process.execPath, [fileURLToPath(REAL_CHILD), "1"], { env: {}, stdio: ["pipe", "ignore", "ignore", "pipe"] });
    const signal = await new Promise<string | null>((resolve) => child.once("exit", (_code, s) => resolve(s)));
    expect(signal).toBe("SIGKILL");
    child.stdin!.destroy();
  });

  it("is ended by the server's shutdown: what was running rejects, for its job to be tried again, and nothing more starts", async () => {
    const parser = processParser(LIMITS, { thread: THREAD });
    const parsing = parser.parse(encode("x"), "spins.txt", OPTIONS);
    await until(() => parseChildren().length === 1, 15_000, "the parse to start");
    const [child] = parseChildren();
    parser.stop();
    await expect(parsing).rejects.toThrow("the server is stopping");
    await until(() => !alive(child!.pid), 5000, "the child to end");
    await expect(parser.parse(encode("x"), "a.txt", OPTIONS)).rejects.toThrow("the server is stopping");
    expect(parseChildren()).toEqual([]);
  });

  it("is ended at the time limit, on the server's clock, with its thread busy", async () => {
    const started = performance.now();
    const r = await withThread("spins", { memoryMb: 64, timeoutSeconds: 1 });
    expect(r.status_detail).toBe(`parsing it took longer than the 1 second this server gives one file, so it was stopped; ${STORED}`);
    expect(performance.now() - started).toBeLessThan(5000);
    await until(() => parseChildren().length === 0, 5000, "the child to end");
  });

  it("is tried again, by a parse that rejects, when it cannot be started at all", async () => {
    const execPath = process.execPath;
    process.execPath = "/nonexistent/node";
    try {
      await expect(processParser(LIMITS).parse(encode("x"), "a.txt", OPTIONS)).rejects.toThrow("ENOENT");
    } finally {
      process.execPath = execPath;
    }
  });
});

describe("the bytes on their way", () => {
  const parser = processParser({ memoryMb: 384, timeoutSeconds: 60 });

  it("arrive and return whole, as the parse in this process would read them, at the parse cap", async () => {
    // Characters of each width, so that nothing is lost where a pipe's chunks divide them.
    const line = `${"Crews plan the week: é, 東京, 😀. ".repeat(4)}\n\n`;
    const bytes = encode(line.repeat(Math.floor((24 * MiB) / Buffer.byteLength(line))));
    const { text_md, ...read } = await parser.parse(bytes, "long.txt", OPTIONS);
    const { text_md: expected, ...same } = toParsedFile(await derive(bytes, "long.txt", OPTIONS));
    expect(read).toEqual(same);
    expect(read.status).toBe("ready");
    expect(text_md.length).toBeGreaterThan(20 * MiB);
    expect(Buffer.compare(text_md, expected)).toBe(0);
  });

  it("are the view they are given, not the buffer behind it, and come back as a whole", async () => {
    const text = "Crews plan the week: é, 東京, 😀.\n\n".repeat(200_000);
    const whole = encode(`padding before${text}padding after`);
    const start = Buffer.byteLength("padding before");
    const view = whole.subarray(start, start + Buffer.byteLength(text));
    const { text_md, ...read } = await parser.parse(view, "long.md", OPTIONS);
    const { text_md: expected, ...same } = toParsedFile(await derive(encode(text), "long.md", OPTIONS));
    expect(read).toEqual(same);
    expect(read.status).toBe("ready");
    expect(text_md.length).toBeGreaterThan(4 * MiB);
    expect(Buffer.compare(text_md, expected)).toBe(0);
  });

  it("may be none at all", async () => {
    const { text_md, ...read } = await parser.parse(new Uint8Array(0), "empty.md", OPTIONS);
    expect(text_md.length).toBe(0);
    const { text_md: _, ...same } = toParsedFile(await derive(new Uint8Array(0), "empty.md", OPTIONS));
    expect(read).toEqual(same);
  });

  it("carry a name of any kind", async () => {
    const name = 'a "quoted" nàme\nwith 東京 😀 and\ttabs.txt';
    const r = await parser.parse(encode("Crews.\n"), name, OPTIONS);
    expect(r.status).toBe("ready");
    expect(decode(r.text_md)).toBe("Crews.\n");
  });
});

describe("through the server", () => {
  let h: Harness;
  let owner: Browser;
  let P: string;
  beforeAll(async () => {
    h = await startHarness({ relayMaxBytes: 2 * MiB });
    owner = await h.signIn("dana@example.com", "Dana Example");
    const t = await owner.api("POST", "/api/v1/tenants", { name: "Boundary Co" });
    P = `/api/v1/p/${(await owner.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Intake" })).body.path}`;
  });
  afterAll(async () => h?.close());

  async function upload(path: string, body = "Crews text the office.\n") {
    const created = await owner.api("POST", `${P}/sources/with-upload`, { title: `Upload of ${path}`, path });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body })).status).toBe(201);
    return created.body.record.record_id as string;
  }
  const reading = async (recordId: string) => (await owner.api("GET", `${P}/sources/${recordId}/derivations`)).body.items[0] as { status: string; status_detail: string | null };
  const job = async (recordId: string) =>
    (await sql<{ attempts: number; done_at: string | null; locked_at: string | null; error: string | null }>`select attempts, done_at, locked_at, error from jobs where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db)).rows[0]!;

  it("a parse that aborts is a failed reading with its reason, the server answers throughout, and the next file is read", async () => {
    const real = h.ports.parser;
    const aborting = await upload("abort.txt");
    const killed = await upload("killed.txt");
    const fatal = await upload("fatal-heap.txt");
    h.ports.parser = processParser({ memoryMb: 128, timeoutSeconds: 60 }, { child: CHILD });
    let draining = true;
    const answers: number[] = [];
    const asking = (async () => {
      while (draining) {
        answers.push((await owner.api("GET", "/api/v1/me/products")).status);
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    try {
      await h.worker.drain();
    } finally {
      draining = false;
      await asking;
      h.ports.parser = real;
    }
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((s) => s === 200)).toBe(true);
    expect(await reading(aborting)).toMatchObject({ status: "failed", status_detail: `parsing it ended in a fatal error (SIGABRT), so it was stopped; ${STORED}` });
    expect(await reading(killed)).toMatchObject({ status: "failed", status_detail: `the system stopped the process parsing it, most likely for lack of memory; ${STORED}` });
    expect(await reading(fatal)).toMatchObject({ status: "failed", status_detail: `parsing it needed more than the 128 MB of memory this server gives one file, so it was stopped; ${STORED}` });
    // Each job is done, with no attempt left over: the failure is the reading's, not the worker's.
    expect(await job(aborting)).toMatchObject({ attempts: 1, done_at: expect.any(String) });
    expect((await owner.api("GET", `${P}/sources/${aborting}`)).body).toMatchObject({ derived_status: "failed" });

    const next = await upload("notes.md", "# Notes\n\nCrews text the office.\n");
    await h.worker.drain();
    expect(await reading(next)).toMatchObject({ status: "ready" });
  });

  it("a shutdown records nothing false: the job running goes back in the queue, and no other is taken", async () => {
    const real = h.ports.parser;
    const running = await upload("spins.txt");
    const waiting = await upload("waiting.txt");
    const parser = processParser(LIMITS, { thread: THREAD });
    h.ports.parser = parser;
    const worker = h.worker;
    const drained = worker.drain();
    try {
      await until(() => parseChildren().length === 1, 15_000, "the parse to start");
      worker.stop();
      parser.stop();
      await drained;
    } finally {
      h.ports.parser = real;
    }
    expect((await owner.api("GET", `${P}/sources/${running}/derivations`)).body.items).toEqual([]);
    expect(await job(running)).toMatchObject({ attempts: 1, done_at: null, locked_at: null, error: expect.stringContaining("the server is stopping") });
    expect(await job(waiting)).toMatchObject({ attempts: 0, done_at: null, locked_at: null });
    expect(parseChildren()).toEqual([]);
    worker.start();
    worker.stop();
  });
});
