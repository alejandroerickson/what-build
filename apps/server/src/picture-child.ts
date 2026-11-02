// The entry of the process one picture is made in (picture-process.ts starts it, and is the only
// thing that talks to it). It reads a job and the file's bytes from fd 0, makes the picture in a
// worker thread (picture-worker.ts) and writes to fd 3 four bytes giving the length of a JSON answer,
// that answer, then the two copies. It imports nothing of the server, and Node loads it as it is,
// stripping its types, so it keeps to syntax that erases. It runs on until the server ends it with
// SIGKILL; it ends itself only if the server is gone or its memory passes the limit.
//
// The thread is what makes the limit hold. Drawing a PDF is one long stretch of work that lets
// nothing else run on its thread, so a check of memory beside it would never get its turn, and a page
// built to be heavy could take the whole instance past its memory. Here the thread's JavaScript heap
// has a hard limit of its own, and this thread stays free to read what the process holds in all,
// Sharp's and the canvas's memory outside the heap included, and to stop it.
import { writeFileSync, writeSync } from "node:fs";
import { Worker } from "node:worker_threads";

const WATCH_MS = 50;
/** How much of the process's memory limit the thread's JavaScript heap may take; the rest is for the bytes, Sharp and the canvas. */
const HEAP_SHARE = 2 / 3;

const THREAD = new URL(import.meta.url.endsWith(".ts") ? "./picture-worker.ts" : "./picture-worker.js", import.meta.url);

interface Job {
  as: "image" | "pdf" | "deck";
  size: number;
  memoryMb: number;
}
interface Copies {
  thumb: Uint8Array;
  preview: Uint8Array;
  width: number;
  height: number;
}

const end = () => process.kill(process.pid, "SIGKILL");
// The server stops this process with SIGKILL; a signal to everything on an instance is the server's to act on.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => undefined);

// Where the kernel ends one process at a time for want of memory, this asks it to choose this one
// before the server. A platform that ends the whole container ends both, which is why the limits below are what count.
if (process.platform === "linux") {
  try {
    writeFileSync("/proc/self/oom_score_adj", "1000");
  } catch {
    // Another way of running Linux may not allow it.
  }
}

let answered = false;
/** Says what came of it, once, and is the last thing said. */
function answer(head: Record<string, unknown>, copies?: Copies) {
  if (answered) return;
  answered = true;
  const json = Buffer.from(JSON.stringify({ ...head, peak_kb: process.resourceUsage().maxRSS, ...(copies ? { width: copies.width, height: copies.height, thumb_bytes: copies.thumb.length, preview_bytes: copies.preview.length } : {}) }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  for (const part of [length, json, ...(copies ? [copies.thumb, copies.preview] : [])]) {
    let at = 0;
    while (at < part.length) at += writeSync(3, part, at);
  }
}

function make(job: Job, bytes: Buffer) {
  const tooMuch = `making its picture needed more than the ${job.memoryMb} MB of memory this server gives one, so it was stopped`;
  setInterval(() => {
    if (process.memoryUsage.rss() <= job.memoryMb * 1024 * 1024) return;
    answer({ status: "failed", detail: tooMuch });
    end();
  }, WATCH_MS);
  const worker = new Worker(THREAD, {
    name: "picture",
    workerData: { as: job.as, bytes },
    transferList: [bytes.buffer as ArrayBuffer],
    resourceLimits: { maxOldGenerationSizeMb: Math.floor(job.memoryMb * HEAP_SHARE) },
    env: {},
  });
  worker.once("message", ({ head, copies }: { head: Record<string, unknown>; copies?: Copies }) => answer(head, copies));
  worker.once("error", (e: Error & { code?: string }) => answer({ status: "failed", detail: e.code === "ERR_WORKER_OUT_OF_MEMORY" ? tooMuch : `${e.name}: ${e.message}`.replace(/\s+/g, " ").slice(0, 200) }));
  worker.once("exit", () => answer({ status: "failed", detail: "the thread making its picture stopped before it finished" }));
}

// A killed server sends no signal, but its end of this pipe closes with it.
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
    if (job.size === 0) return make(job, bytes);
  }
  if (filled === job.size) return;
  filled += rest.copy(bytes, filled);
  if (filled === job.size) make(job, bytes);
});
process.stdin.on("end", end);
process.stdin.on("close", end);
process.stdin.on("error", end);
