// Stands in for apps/server/src/parse-worker.ts, inside the real child process, to show what a parse
// can reach and how that process ends. The file's name says what to do.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

const job = workerData as { bytes: Uint8Array; fileName: string };
const answer = (body: string) => {
  const text_md = new TextEncoder().encode(body);
  parentPort!.postMessage({ status: "ready", parser: "plain", parser_version: "1", status_detail: null, duration_ms: null, facts: {}, char_count: body.length, text_md }, [text_md.buffer]);
};
const acts: Record<string, () => void> = {
  reports: () =>
    answer(
      JSON.stringify({
        env: process.env,
        execArgv: process.execArgv,
        oomScoreAdj: process.platform === "linux" ? readFileSync("/proc/self/oom_score_adj", "utf8").trim() : null,
        bytes: job.bytes.length,
      }),
    ),
  aborts: () => process.kill(process.pid, "SIGABRT"),
  segfaults: () => process.kill(process.pid, "SIGSEGV"),
  spins: () => {
    for (;;);
  },
  "throws": () => {
    throw new TypeError("a parser fell over");
  },
  "ends-silently": () => process.exit(0),
  "starts-a-process-and-spins": () => {
    spawn(process.execPath, ["-e", "setInterval(() => undefined, 60000)"], { stdio: "ignore" });
    // Long enough for the process to start, on a thread that goes on being busy after.
    const started = Date.now();
    for (;;) if (Date.now() - started > 60_000) break;
  },
};
// A real parse loads its parsers first, so the process knows the thread is running before any file is read.
await new Promise((resolve) => setTimeout(resolve, 100));
acts[job.fileName.replace(/\.txt$/, "")]!();
