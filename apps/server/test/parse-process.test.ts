import { execFileSync, spawn } from "node:child_process";
import { closeSync, fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { derive, ParseInterrupted, ParseStopped, READING_LIMITS, toParsedFile } from "@whatbuild/parsers";
import { strToU8, zipSync } from "fflate";
import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createDb } from "../src/database.ts";
import { processParser } from "../src/parse-process.ts";
import { shutDown } from "../src/shutdown.ts";
import { Worker } from "../src/worker.ts";
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

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("a parse that ends in a fatal error", () => {
  it("says what ended it, whichever way that was", async () => {
    for (const [act, detail] of [
      ["abort", `parsing it ended in a fatal error (SIGABRT), so it was stopped; ${STORED}`],
      ["segfault", `parsing it ended in a fatal error (SIGSEGV), so it was stopped; ${STORED}`],
      ["exit-3", `the process parsing it exited with code 3 before it finished; ${STORED}`],
      ["exit-0", "the parser stopped before it finished"],
      ["cut-short", `parsing it ended in a fatal error (SIGABRT), so it was stopped; ${STORED}`],
    ] as const) expect(await standIn(act), act).toMatchObject({ status: "failed", status_detail: detail, text_md: new Uint8Array(0) });
    expect(parseChildren()).toEqual([]);
  });

  it("leaves its own words in the log, without the rest of what it said", async () => {
    await standIn("says-how-it-fell");
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/^parse: the process parsing a file ended by SIGABRT without an answer: FATAL ERROR: a stand-in's words \(/));
  });

  it("reads as the time limit when it is the child's own last resort, whatever else the server was doing", async () => {
    expect((await standIn("runs-out-of-time", encode("x"), { memoryMb: 64, timeoutSeconds: 7 })).status_detail).toBe(`parsing it took longer than the 7 seconds this server gives one file, so it was stopped; ${STORED}`);
  });
});

describe("a parse that may not have ended by the file's doing", () => {
  it("rejects when something outside it kills it, for its job to be tried again, with the reason its reading gives if every attempt ends so", async () => {
    const parsing = standIn("killed");
    await expect(parsing).rejects.toBeInstanceOf(ParseInterrupted);
    await expect(parsing).rejects.toThrow("the process parsing it was killed, most likely for lack of memory");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("ended by SIGKILL"));
  });

  it("rejects when its process ends in any way before it began its work: for want of memory or threads, say, and the file has had no part in it", async () => {
    for (const [act, by] of [
      ["aborts-before-it-begins", "SIGABRT"],
      ["killed-before-it-begins", "SIGKILL"],
      ["exits-before-it-begins", "exit code 1"],
    ] as const) {
      const parsing = standIn(act);
      await expect(parsing, act).rejects.toBeInstanceOf(ParseInterrupted);
      await expect(parsing, act).rejects.toThrow(`the process parsing it ended by ${by} before it could begin`);
    }
    expect(parseChildren()).toEqual([]);
  });
});

describe("a parse's line in the log", () => {
  it("says how it ended, with the peak its process said and what the server holds, and nothing of the file", async () => {
    const r = await standIn("says-its-peak");
    expect(r.status).toBe("ready");
    await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^parse: the process parsing a file answered ready \(its peak 123 MiB, the server now \d+ MiB(, \d+ other processes)?\)$/)));
  });

  it("says the real child's peak, as its process measured it", async () => {
    expect((await processParser(LIMITS).parse(encode("Crews.\n"), "a-private-name.txt", OPTIONS)).status).toBe("ready");
    await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^parse: the process parsing a file answered ready \(its peak [1-9]\d+ MiB, /)));
    expect(vi.mocked(console.log).mock.calls.flat().join()).not.toContain("a-private-name");
  });

  it("is there for a parse stopped at its time limit, and at a shutdown", async () => {
    await standIn("hangs", encode("x"), { memoryMb: 64, timeoutSeconds: 1 });
    await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith(expect.stringContaining("was stopped at the time limit")));
    const parser = processParser(LIMITS, { child: CHILD });
    const parsing = parser.parse(encode("x"), "hangs.txt", OPTIONS);
    await until(() => childrenOf(process.pid).some((c) => c.command.includes("stand-ins")), 15_000, "the parse to start");
    parser.stop();
    await expect(parsing).rejects.toBeInstanceOf(ParseStopped);
    await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith(expect.stringContaining("was stopped as the server shut down")));
  });
});

describe("a parse in the real child that ends in a fatal error", () => {
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
      ["a null character in a fact's name", framed({ parsed: { ...parsed, facts: { "a\u0000b": 1 } }, text_bytes: 2 }, encode("hi"))],
      ["a null character in a fact", framed({ parsed: { ...parsed, facts: { a: "b\u0000" } }, text_bytes: 2 }, encode("hi"))],
      ["half a surrogate pair in a field", framed({ parsed: { ...parsed, status_detail: "\ud83d" }, text_bytes: 2 }, encode("hi"))],
      ["half a surrogate pair in a fact's name", framed({ parsed: { ...parsed, facts: { "\ude00": 1 } }, text_bytes: 2 }, encode("hi"))],
      ["half a surrogate pair in a fact", framed({ parsed: { ...parsed, facts: { a: ["\ud83d"] } }, text_bytes: 2 }, encode("hi"))],
      ["half a surrogate pair in an error", framed({ stopped: "error", detail: "\ud83d" })],
      ["a fractional duration", framed({ parsed: { ...parsed, duration_ms: 1.5 }, text_bytes: 2 }, encode("hi"))],
      ["a negative duration", framed({ parsed: { ...parsed, duration_ms: -1 }, text_bytes: 2 }, encode("hi"))],
      ["a parser's name past its limit", framed({ parsed: { ...parsed, parser: "p".repeat(READING_LIMITS.parserChars + 1) }, text_bytes: 2 }, encode("hi"))],
      ["a parser's version past its limit", framed({ parsed: { ...parsed, parser_version: "1".repeat(READING_LIMITS.parserChars + 1) }, text_bytes: 2 }, encode("hi"))],
      ["a detail past its limit", framed({ parsed: { ...parsed, status_detail: "d".repeat(READING_LIMITS.detailChars + 1) }, text_bytes: 2 }, encode("hi"))],
      ["an error past its limit", framed({ stopped: "error", detail: "d".repeat(201) })],
      ["a fact's name past its limit", framed({ parsed: { ...parsed, facts: { ["k".repeat(READING_LIMITS.factKeyChars + 1)]: 1 } }, text_bytes: 2 }, encode("hi"))],
      ["a fact past its limit", framed({ parsed: { ...parsed, facts: { a: "f".repeat(READING_LIMITS.factChars + 1) } }, text_bytes: 2 }, encode("hi"))],
      ["a list too long", framed({ parsed: { ...parsed, facts: { a: Array(READING_LIMITS.factItems + 1).fill("x") } }, text_bytes: 2 }, encode("hi"))],
      ["too many facts", framed({ parsed: { ...parsed, facts: Object.fromEntries(Array.from({ length: READING_LIMITS.factKeys + 1 }, (_, i) => [`k${i}`, 1])) }, text_bytes: 2 }, encode("hi"))],
      ["a frame past the longest there may be", framed("", new Uint8Array(0), 256 * 1024 + 1)],
      ["a peak that is no number", framed({ peak_kb: "much" })],
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

  it("takes what is at every limit, which is the most a reading holds", async () => {
    const most = {
      ...parsed,
      parser: "p".repeat(READING_LIMITS.parserChars),
      parser_version: "1".repeat(READING_LIMITS.parserChars),
      status_detail: "😀".repeat(READING_LIMITS.detailChars / 2),
      duration_ms: Number.MAX_SAFE_INTEGER,
      facts: { ["k".repeat(READING_LIMITS.factKeyChars)]: "f".repeat(READING_LIMITS.factChars), list: Array(READING_LIMITS.factItems).fill("x") },
    };
    expect(await says(framed({ parsed: most, text_bytes: 2 }, encode("hi")))).toMatchObject({ status: "ready", status_detail: most.status_detail, facts: most.facts });
  });

  it("ahead of its answer is limited: no more than one saying it began, and no more than the time limit allows of the rest", async () => {
    expect((await standIn("says-it-began-twice")).status_detail).toBe(unreadable);
    const started = performance.now();
    expect((await standIn("floods-its-notes")).status_detail).toBe(unreadable);
    expect(performance.now() - started).toBeLessThan(10_000);
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

describe("what a parse starts with", () => {
  const SECRET = "WHATBUILD_TEST_SERVER_SECRET";
  let folder: string;
  let file: string;
  let fd: number;
  const listening = createServer();
  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), "parse-process-"));
    file = join(folder, "held-open.txt");
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
    rmSync(folder, { recursive: true, force: true });
  });
  /** Less what Node passes to any child, for collecting coverage, and what macOS itself sets in every process, even one started with none. */
  const without = (env: Record<string, string>) => Object.keys(env).filter((k) => k !== "NODE_V8_COVERAGE" && k !== "__CF_USER_TEXT_ENCODING");

  it("holds none of the server's variables or flags, in its thread", async () => {
    const seen = JSON.parse(decode((await withThread("reports")).text_md)) as { env: Record<string, string>; execArgv: string[]; bytes: number };
    expect(without(seen.env)).toEqual([]);
    expect(seen.execArgv).toEqual([]);
    expect(seen.bytes).toBe(1);
  });

  it("holds none of the server's variables, flags or open files, in its process", async () => {
    const seen = JSON.parse(decode((await standIn("reports")).text_md)) as { env: Record<string, string>; execArgv: string[]; argv: string[]; cwd: string; descriptors: { fd: number; ino: number; socket: boolean }[] };
    expect(without(seen.env)).toEqual([]);
    expect(seen.execArgv).toEqual([]);
    // Its time limit and nothing else. The file's name goes on the pipe, not where anything on the instance can list it.
    expect(seen.argv).toEqual([String(LIMITS.timeoutSeconds)]);
    expect(seen.cwd).toBe(dirname(fileURLToPath(CHILD)));
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
    await expect(parsing).rejects.toBeInstanceOf(ParseStopped);
  });

  // That the value was written, and no more: what the kernel or the platform makes of it is for the
  // step test of a rehearsal (okf/operations/dev-deployment.md).
  it.runIf(process.platform === "linux")("writes its oom_score_adj", async () => {
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

  it("ends by itself a little past its time limit, should a server that is still there not have ended it, with the signal that says so", async () => {
    const child = spawn(process.execPath, [fileURLToPath(REAL_CHILD), "1"], { env: {}, stdio: ["pipe", "ignore", "ignore", "pipe"] });
    const signal = await new Promise<string | null>((resolve) => child.once("exit", (_code, s) => resolve(s)));
    expect(signal).toBe("SIGALRM");
    child.stdin!.destroy();
  });

  it("takes with it, when its parse ends, what it started", async () => {
    const { text_md } = await standIn("leaves-a-process");
    const left = Number(decode(text_md));
    expect(left).toBeGreaterThan(0);
    await until(() => !alive(left), 5000, "the process it started to end");
  });

  it("takes with it, when the server is killed, what it started", async () => {
    const server = spawn(process.execPath, [fileURLToPath(new URL("./parse-stand-ins/server.ts", import.meta.url)), "starts-a-process-and-spins.txt"], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      await new Promise<void>((resolve) => server.stdout.once("data", () => resolve()));
      await until(() => parseChildren(server.pid!).length === 1, 15_000, "the parse to start");
      const [child] = parseChildren(server.pid!);
      await until(() => childrenOf(child!.pid).length === 1, 15_000, "the parse to start a process");
      const [left] = childrenOf(child!.pid);
      server.kill("SIGKILL");
      await until(() => !alive(child!.pid) && !alive(left!.pid), 10_000, "the child and what it started to end");
    } finally {
      server.kill("SIGKILL");
    }
  });

  it("runs as a process group of its own, so that a signal to the server's goes no further than the server", async () => {
    const server = spawn(process.execPath, [fileURLToPath(new URL("./parse-stand-ins/server.ts", import.meta.url))], { stdio: ["ignore", "pipe", "inherit"], detached: true });
    try {
      await new Promise<void>((resolve) => server.stdout.once("data", () => resolve()));
      await until(() => parseChildren(server.pid!).length === 1, 15_000, "the parse to start");
      const [child] = parseChildren(server.pid!);
      expect(execFileSync("ps", ["-o", "pgid=", "-p", String(child!.pid)], { encoding: "utf8" }).trim()).toBe(String(child!.pid));
    } finally {
      process.kill(-server.pid!, "SIGKILL");
    }
  });

  it("is ended by the server's shutdown: what was running rejects, for its job to be tried again, and nothing more starts", async () => {
    const parser = processParser(LIMITS, { thread: THREAD });
    const parsing = parser.parse(encode("x"), "spins.txt", OPTIONS);
    await until(() => parseChildren().length === 1, 15_000, "the parse to start");
    const [child] = parseChildren();
    parser.stop();
    await expect(parsing).rejects.toBeInstanceOf(ParseStopped);
    await until(() => !alive(child!.pid), 5000, "the child to end");
    await expect(parser.parse(encode("x"), "a.txt", OPTIONS)).rejects.toBeInstanceOf(ParseStopped);
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
  const parser = processParser({ memoryMb: loadConfig({ NODE_ENV: "test" }).parseMemoryMb, timeoutSeconds: 60 });

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

describe("a workbook that names very many sheets", () => {
  it("is read, with its facts within what an answer may hold", async () => {
    const count = 100_000;
    const workbook = `<?xml version="1.0"?><workbook xmlns:r="r"><sheets>${Array.from({ length: count }, (_, i) => `<sheet name="東京 ${"😀".repeat(15)} ${i}" state="hidden" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}<sheet name="Visible" sheetId="${count + 1}" r:id="rIdV"/></sheets></workbook>`;
    const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rIdV" Target="worksheets/visible.xml" Type="x"/></Relationships>`;
    const sheet = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Crews plan the week.</t></is></c></row></sheetData></worksheet>`;
    const bytes = zipSync({ "xl/workbook.xml": strToU8(workbook), "xl/_rels/workbook.xml.rels": strToU8(rels), "xl/worksheets/visible.xml": strToU8(sheet) });
    const r = await processParser({ memoryMb: 256, timeoutSeconds: 60 }).parse(bytes, "many.xlsx", OPTIONS);
    expect(r).toMatchObject({ status: "ready", facts: { sheet_count: count + 1, hidden_sheets_left_out: count - READING_LIMITS.factItems } });
    expect(r.facts["hidden_sheets"]).toHaveLength(READING_LIMITS.factItems);
    expect(JSON.stringify(r.facts).length).toBeLessThan(64 * 1024);
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

  async function upload(path: string, body: string | Uint8Array = "Crews text the office.\n") {
    const created = await owner.api("POST", `${P}/sources/with-upload`, { title: `Upload of ${path}`, path });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body })).status).toBe(201);
    return created.body.record.record_id as string;
  }
  const reading = async (recordId: string) => (await owner.api("GET", `${P}/sources/${recordId}/derivations`)).body.items[0] as { status: string; status_detail: string | null };
  const job = async (recordId: string) =>
    (await sql<{ attempts: number; done_at: string | null; locked_at: string | null; error: string | null }>`select attempts, done_at, locked_at, error from jobs where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db)).rows[0]!;

  const runnable = (recordId: string) => sql`update jobs set run_after = now() where kind = 'derive' and payload->>'record_id' = ${recordId}`.execute(h.db);
  /** A worker of its own, for a test that stops it; the harness's goes on for the next. */
  const aWorker = (parser: Harness["ports"]["parser"], log: (m: string) => void = () => undefined, db: Harness["db"] = h.db) => new Worker({ db, ports: { ...h.ports, parser } }, 60_000, log);

  it("a parse that aborts is a failed reading with its reason, the server answers throughout, and the next file is read", async () => {
    const real = h.ports.parser;
    const aborting = await upload("abort.txt");
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
    // Each job is done, with no attempt left over: the failure is the reading's, not the worker's.
    expect(await job(aborting)).toMatchObject({ attempts: 1, done_at: expect.any(String) });
    expect((await owner.api("GET", `${P}/sources/${aborting}`)).body).toMatchObject({ derived_status: "failed" });

    const next = await upload("notes.md", "# Notes\n\nCrews text the office.\n");
    await h.worker.drain();
    expect(await reading(next)).toMatchObject({ status: "ready" });
  });

  it("a healthy file whose process is killed from outside is tried again, with nothing against it, and is read", async () => {
    const real = h.ports.parser;
    const id = await upload("killed.txt");
    h.ports.parser = processParser(LIMITS, { child: CHILD });
    await h.worker.drain();
    h.ports.parser = real;
    expect((await owner.api("GET", `${P}/sources/${id}/derivations`)).body.items).toEqual([]);
    expect(await job(id)).toMatchObject({ attempts: 1, done_at: null, locked_at: null, error: expect.stringContaining("was killed") });
    await runnable(id);
    await h.worker.drain();
    expect(await reading(id)).toMatchObject({ status: "ready" });
    expect(await job(id)).toMatchObject({ attempts: 2, done_at: expect.any(String), error: null });
  });

  it("a file whose process is killed every time ends after its attempts, saying so", async () => {
    const real = h.ports.parser;
    const id = await upload("killed.txt");
    h.ports.parser = processParser(LIMITS, { child: CHILD });
    try {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await runnable(id);
        await h.worker.drain();
        expect((await job(id)).attempts).toBe(attempt);
      }
    } finally {
      h.ports.parser = real;
    }
    expect(await reading(id)).toMatchObject({ status: "failed", status_detail: expect.stringContaining("reading it failed 5 times, the last because the process parsing it was killed, most likely for lack of memory, so it was given up") });
    expect(await job(id)).toMatchObject({ attempts: 5, done_at: expect.any(String) });
  });

  it("an answer the store would refuse is a reading that says it could not be read, at its first attempt", async () => {
    const real = h.ports.parser;
    const parsed = { status: "ready", parser: "plain", parser_version: "1", status_detail: null, duration_ms: null, char_count: 2 };
    const ids = [];
    for (const answer of [{ ...parsed, facts: { "a\u0000b": 1 } }, { ...parsed, facts: {}, duration_ms: 1.5 }, { ...parsed, facts: { "\ud83d": 1 } }]) ids.push(await upload("says.txt", framed({ parsed: answer, text_bytes: 2 }, encode("hi"))));
    h.ports.parser = processParser(LIMITS, { child: CHILD });
    await h.worker.drain();
    h.ports.parser = real;
    for (const id of ids) {
      expect(await reading(id)).toMatchObject({ status: "failed", status_detail: `the process parsing it gave an answer that could not be read, so it was stopped; ${STORED}` });
      expect(await job(id)).toMatchObject({ attempts: 1, done_at: expect.any(String) });
    }
  });

  it("an answer at every limit is one the store holds", async () => {
    const real = h.ports.parser;
    const most = {
      status: "ready",
      parser: "p".repeat(READING_LIMITS.parserChars),
      parser_version: "1".repeat(READING_LIMITS.parserChars),
      status_detail: "😀".repeat(READING_LIMITS.detailChars / 2),
      duration_ms: Number.MAX_SAFE_INTEGER,
      char_count: 2,
      facts: { ["😀".repeat(READING_LIMITS.factKeyChars / 2)]: "東".repeat(READING_LIMITS.factChars), big: 1e308, list: Array(READING_LIMITS.factItems).fill("x".repeat(READING_LIMITS.factChars)) },
    };
    const id = await upload("says.txt", framed({ parsed: most, text_bytes: 2 }, encode("hi")));
    h.ports.parser = processParser(LIMITS, { child: CHILD });
    await h.worker.drain();
    h.ports.parser = real;
    expect(await reading(id)).toMatchObject({ status: "ready" });
    expect(await job(id)).toMatchObject({ attempts: 1, done_at: expect.any(String), error: null });
  });

  it("a shutdown waits to put the job running back in the queue before a real pool ends, spends its attempt and takes no other", async () => {
    const running = await upload("spins.txt");
    const waiting = await upload("waiting.txt");
    const { db, pool } = createDb(h.config.databaseUrl!, 5);
    const parser = processParser(LIMITS, { thread: THREAD });
    const logged: string[] = [];
    const worker = aWorker(parser, (m) => logged.push(m), db);
    const drained = worker.drain();
    await until(() => parseChildren().length === 1, 15_000, "the parse to start");
    await shutDown({ worker, parser, pool });
    expect(pool.ended).toBe(true);
    await drained;
    expect(logged.join("\n")).not.toContain("Cannot use a pool");
    expect(logged).toContainEqual(expect.stringContaining("put back in the queue"));
    expect((await owner.api("GET", `${P}/sources/${running}/derivations`)).body.items).toEqual([]);
    expect(await job(running)).toMatchObject({ attempts: 1, done_at: null, locked_at: null, error: null });
    expect(await job(waiting)).toMatchObject({ attempts: 0, done_at: null, locked_at: null });
    expect(parseChildren()).toEqual([]);
    // It waits as a failed attempt does, and what is behind it does not.
    await h.worker.drain();
    expect(await reading(waiting)).toMatchObject({ status: "ready" });
    expect(await job(running)).toMatchObject({ attempts: 1, done_at: null });
    await runnable(running);
    await h.worker.drain();
    expect(await reading(running)).toMatchObject({ status: "ready" });
    expect(await job(running)).toMatchObject({ attempts: 2, done_at: expect.any(String), error: null });
  });

  it("a job that is running each time the server stops is given up at its last attempt, however new it is", async () => {
    const running = await upload("spins.txt");
    for (let attempt = 1; attempt <= 5; attempt++) {
      await runnable(running);
      const parser = processParser(LIMITS, { thread: THREAD });
      const worker = aWorker(parser);
      const drained = worker.drain();
      await until(() => parseChildren().length === 1, 15_000, "the parse to start");
      void worker.stop();
      parser.stop();
      await drained;
      expect(await job(running)).toMatchObject({ attempts: attempt, done_at: null, locked_at: null });
      expect((await owner.api("GET", `${P}/sources/${running}/derivations`)).body.items).toEqual([]);
    }
    await h.worker.drain();
    expect(await job(running)).toMatchObject({ attempts: 5, done_at: expect.any(String) });
    expect(await reading(running)).toMatchObject({ status: "failed", status_detail: expect.stringContaining("stopped the server 5 times") });
  });

  it("a shutdown at a job's last attempt records nothing itself, and the next worker gives it up", async () => {
    const running = await upload("spins.txt");
    await sql`update jobs set attempts = 4 where kind = 'derive' and payload->>'record_id' = ${running}`.execute(h.db);
    const parser = processParser(LIMITS, { thread: THREAD });
    const worker = aWorker(parser);
    const drained = worker.drain();
    await until(() => parseChildren().length === 1, 15_000, "the parse to start");
    void worker.stop();
    parser.stop();
    await drained;
    expect((await owner.api("GET", `${P}/sources/${running}/derivations`)).body.items).toEqual([]);
    expect(await job(running)).toMatchObject({ attempts: 5, done_at: null, locked_at: null });
    await h.worker.drain();
    expect(await reading(running)).toMatchObject({ status: "failed", status_detail: expect.stringContaining("stopped the server 5 times") });
  });

  it("a stop during the housekeeping before a claim claims nothing", async () => {
    const waiting = await upload("waiting.txt");
    const worker = aWorker(h.ports.parser);
    vi.spyOn(worker as unknown as { giveUpAbandoned(): Promise<void> }, "giveUpAbandoned").mockImplementation(async () => {
      void worker.stop();
    });
    await worker.drain();
    expect(await job(waiting)).toMatchObject({ attempts: 0, locked_at: null, done_at: null });
    await h.worker.drain();
  });

  it("a claim that crosses with a stop gives the job back, of whatever kind", async () => {
    const waiting = await upload("waiting.txt");
    const worker = aWorker(h.ports.parser);
    const claiming = worker as unknown as { claim(): Promise<unknown> };
    const claim = claiming.claim.bind(worker);
    vi.spyOn(claiming, "claim").mockImplementation(async () => {
      const claimed = await claim();
      void worker.stop();
      return claimed;
    });
    await worker.drain();
    expect(await job(waiting)).toMatchObject({ attempts: 0, locked_at: null, done_at: null });
    await h.worker.drain();
  });
});
