// The entry of the process one file is parsed in (parse-process.ts starts it, and is the only thing
// that talks to it). It reads the file's bytes from fd 0, parses them in a worker thread held to a
// memory limit (parse-worker.ts), and writes to fd 3, each as four bytes giving the length of a JSON
// frame and that frame: that the parse has begun, how much memory this process has used at most, and
// last what came of it, followed by the text's bytes. It imports nothing of the server, and Node
// loads it as it is, stripping its types, so it keeps to syntax that erases. It runs on until the
// server ends it with SIGKILL; it ends itself only if the server is gone or past all reason late.
import { writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { Worker } from "node:worker_threads";
import type { ParsedFile } from "@whatbuild/parsers";

const MiB = 1024 * 1024;
/** How often the thread's memory is read. */
const WATCH_MS = 50;
/** How often this process says the most memory it has used; a parse's peak may last little more than a second. */
const PEAK_EVERY_MS = 200;
/** How long after its time limit this process ends itself, should the server not have ended it by then. */
const LAST_RESORT_SECONDS = 5;

/**
 * The thread's entry file, beside this one: as it is when the server runs from its source
 * (development and tests, where Node strips the types itself), and in the bundle as build.mjs writes it.
 */
const THREAD = new URL(import.meta.url.endsWith(".ts") ? "./parse-worker.ts" : "./parse-worker.js", import.meta.url);

/** What the server sends ahead of the file's bytes. `thread` names another entry for the thread, which only tests do. */
interface Job {
  fileName: string;
  mediaType: string | null;
  parseCapBytes: number;
  memoryMb: number;
  size: number;
  thread?: string;
}

/**
 * Ends this process at once, whatever its thread is doing, for a server that is gone. The server
 * starts it as the leader of a process group, so anything a parse started ends with it; started
 * any other way, there is no such group, and it ends alone.
 */
const end = () => {
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {
    // No group of its own.
  }
  process.kill(process.pid, "SIGKILL");
};

// The server stops this process with SIGKILL. A signal sent to everything on an instance as it shuts
// down is the server's to act on, so that a parse stopped by it is not taken for one that died.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => undefined);

// A killed server sends no signal, but its end of this pipe closes with it. The event loop is free
// to notice, since the parse runs in the thread.
process.stdin.on("end", end);
process.stdin.on("close", end);
process.stdin.on("error", end);
// Nothing else sends this signal, so that a server that was held up past the time limit reads it as
// that limit, and not as something outside the parse having ended it.
setTimeout(() => process.kill(process.pid, "SIGALRM"), (Number(process.argv[2]) + LAST_RESORT_SECONDS) * 1000);

// Where the kernel ends one process at a time for want of memory (plain Docker on Linux, say), this
// asks it to choose this process before the server. A platform that ends the whole container ends
// both, whatever this says; okf/operations/dev-deployment.md has the test that shows which one a
// deployment is on.
if (process.platform === "linux") {
  try {
    writeFileSync("/proc/self/oom_score_adj", "1000");
  } catch {
    // Another way of running Linux may not allow it; the kernel then chooses by size alone.
  }
}

const out = new Socket({ fd: 3, readable: false, writable: true });
out.on("error", end);

/** Writes one frame: its length, then its JSON. */
function say(head: object) {
  const json = Buffer.from(JSON.stringify(head));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  out.write(length);
  out.write(json);
}
const sayPeak = () => say({ peak_kb: process.resourceUsage().maxRSS });

let peakEvery: NodeJS.Timeout | undefined;
let answered = false;
/** Says what came of the parse, once, and is the last thing said. The server ends this process when it has read it all. */
function answer(head: object, text?: Uint8Array) {
  if (answered) return;
  answered = true;
  clearInterval(peakEvery);
  sayPeak();
  say(head);
  if (text?.length) out.write(text);
}

function parse(job: Job, bytes: Buffer) {
  const worker = new Worker(job.thread ? new URL(job.thread) : THREAD, {
    name: "parse",
    workerData: { bytes, fileName: job.fileName, mediaType: job.mediaType, parseCapBytes: job.parseCapBytes },
    transferList: [bytes.buffer as ArrayBuffer],
    resourceLimits: { maxOldGenerationSizeMb: job.memoryMb },
    env: {},
  });
  let began = false;
  worker.once("online", () => {
    began = true;
    say({ began: true });
    peakEvery = setInterval(sayPeak, PEAK_EVERY_MS);
  });
  worker.once("message", ({ text_md, ...parsed }: ParsedFile) => answer({ parsed, text_bytes: text_md.byteLength }, text_md));
  worker.once("error", (e: Error & { code?: string }) => {
    // The thread never ran, for want of memory or threads, say: nothing of the file's doing, and the server tries again.
    if (!began) {
      console.error(`${e.name}: ${e.message}`);
      process.exit(1);
    }
    answer(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? { stopped: "memory" } : { stopped: "error", detail: `${e.name}: ${e.message}`.replaceAll("\u0000", "").slice(0, 200).replace(/\p{Cs}/gu, "�") });
  });
  worker.once("exit", () => answer({ stopped: "ended" }));
  const watch = setInterval(() => {
    // Node 22.16 and later (the engines in package.json ask for later); on an older Node the heap limit alone holds.
    if (typeof worker.getHeapStatistics !== "function") return clearInterval(watch);
    worker.getHeapStatistics().then(
      (s) => {
        if (s.external_memory > (job.memoryMb / 2) * MiB) answer({ stopped: "memory" });
      },
      () => undefined,
    );
  }, WATCH_MS);
}

let head: Buffer = Buffer.alloc(0);
let job: Job | null = null;
let bytes: Buffer = head;
let filled = 0;
process.stdin.on("data", (chunk: Buffer) => {
  let rest = chunk;
  if (!job) {
    head = Buffer.concat([head, chunk]);
    if (head.length < 4 || head.length < 4 + head.readUInt32LE(0)) return;
    const headEnd = 4 + head.readUInt32LE(0);
    job = JSON.parse(head.toString("utf8", 4, headEnd)) as Job;
    // A buffer of its own, not one of the pool's, so the thread takes it without a copy.
    bytes = Buffer.allocUnsafeSlow(job.size);
    rest = head.subarray(headEnd);
    if (job.size === 0) return parse(job, bytes);
  }
  if (filled === job.size) return;
  filled += rest.copy(bytes, filled);
  if (filled === job.size) parse(job, bytes);
});
