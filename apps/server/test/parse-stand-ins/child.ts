// Stands in for apps/server/src/parse-child.ts, to show what the server does when the process it
// started for a parse misbehaves. It really does each thing: nothing here is a mock of a process
// ending. It reads the job as the real one does; the file's name says what to do. Node loads it as
// it is, as it loads the real one.
import { spawn } from "node:child_process";
import { fstatSync, readdirSync, readSync, writeSync } from "node:fs";

/** Reads exactly `n` bytes from the server's pipe. */
function read(n: number): Buffer {
  const b = Buffer.alloc(n);
  for (let at = 0; at < n; ) {
    const got = readSync(0, b, at, n - at, null);
    if (got === 0) process.exit(9);
    at += got;
  }
  return b;
}

/** Writes all of `b` on the answer's pipe. */
function write(b: Buffer) {
  for (let at = 0; at < b.length; ) at += writeSync(3, b, at);
}

/** An answer as the real child frames it. */
function answer(head: unknown, text = Buffer.alloc(0)) {
  const json = Buffer.from(JSON.stringify(head));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  write(Buffer.concat([length, json, text]));
}

const CHUNK = 64 * 1024;
const parsed = { status: "ready", parser: "plain", parser_version: "1", status_detail: null, duration_ms: null, facts: {}, char_count: 0 };
const heldOpen = () => setInterval(() => undefined, 60_000);

const job = JSON.parse(read(read(4).readUInt32LE(0)).toString()) as { fileName: string; size: number };
const bytes = read(job.size);
const acts: Record<string, () => void> = {
  "runs-out-of-memory": () => {
    writeSync(2, "a stand-in is out of memory\n");
    process.abort();
  },
  abort: () => process.abort(),
  "says-how-it-fell": () => {
    writeSync(2, "lines before it\nFATAL ERROR: a stand-in's words\nlines after it\n");
    process.abort();
  },
  segfault: () => process.kill(process.pid, "SIGSEGV"),
  killed: () => process.kill(process.pid, "SIGKILL"),
  "exit-3": () => process.exit(3),
  "exit-0": () => process.exit(0),
  "runs-out-of-time": () => process.kill(process.pid, "SIGALRM"),
  "aborts-before-it-begins": () => process.abort(),
  "killed-before-it-begins": () => process.kill(process.pid, "SIGKILL"),
  "exits-before-it-begins": () => process.exit(1),
  "cut-short": () => {
    answer({ parsed: { ...parsed, char_count: 5 }, text_bytes: 5 });
    write(Buffer.from("he"));
    process.abort();
  },
  // The whole of the file, as it is, is the answer's bytes.
  says: () => {
    write(bytes);
    heldOpen();
  },
  "floods-its-answer": () => {
    const noise = Buffer.alloc(CHUNK, 0x7b);
    for (;;) write(noise);
  },
  "floods-its-text": () => {
    answer({ parsed: { ...parsed, char_count: 1 }, text_bytes: 1024 }, Buffer.alloc(1024, 0x61));
    const noise = Buffer.alloc(CHUNK, 0x61);
    for (;;) write(noise);
  },
  "floods-stderr": () => {
    const noise = Buffer.alloc(CHUNK, 0x61);
    for (;;) writeSync(2, noise);
  },
  "floods-its-notes": () => {
    for (;;) answer({ peak_kb: 1 });
  },
  "says-it-began-twice": () => {
    answer({ began: true });
    heldOpen();
  },
  "says-its-peak": () => {
    answer({ peak_kb: 123 * 1024 });
    answer({ parsed: { ...parsed, char_count: 0 }, text_bytes: 0 });
    heldOpen();
  },
  // Answers, as a parse that started something and left it running would, and goes on.
  "leaves-a-process": () => {
    const left = spawn(process.execPath, ["-e", "setInterval(() => undefined, 60000)"], { stdio: "ignore" });
    const pid = Buffer.from(String(left.pid));
    answer({ parsed: { ...parsed, char_count: pid.length }, text_bytes: pid.length }, pid);
    heldOpen();
  },
  hangs: () => heldOpen(),
  "ignores-being-asked": () => {
    for (const s of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(s, () => undefined);
    heldOpen();
  },
  // What a process started for a parse has of the server, and of anything else open there.
  reports: () => {
    const descriptors = readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd")
      .map(Number)
      .flatMap((fd) => {
        try {
          const s = fstatSync(fd);
          return [{ fd, ino: s.ino, socket: s.isSocket() }];
        } catch {
          return [];
        }
      });
    const report = Buffer.from(JSON.stringify({ env: process.env, execArgv: process.execArgv, argv: process.argv.slice(2), cwd: process.cwd(), descriptors }));
    answer({ parsed: { ...parsed, char_count: report.length }, text_bytes: report.length }, report);
    heldOpen();
  },
};
const act = job.fileName.replace(/\.txt$/, "");
if (!act.endsWith("-before-it-begins")) answer({ began: true });
acts[act]!();
