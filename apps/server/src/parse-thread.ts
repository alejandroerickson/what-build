import { Worker } from "node:worker_threads";
import type { FileParser } from "@whatbuild/core";
import { parserFor, toParsedFile, type ParsedFile } from "@whatbuild/parsers";

/** What one parse may use. */
export interface ParseLimits {
  /** The JavaScript heap of the parse's thread, in MB; the buffers it holds outside the heap may take half as much again. */
  memoryMb: number;
  /** How long one parse may run, in seconds. */
  timeoutSeconds: number;
}

const MiB = 1024 * 1024;
/** How often the thread's memory is read. */
const WATCH_MS = 50;

/**
 * The thread's entry file: beside this module when the server runs from its source (development
 * and tests, where Node strips the types itself), and beside main.js in the bundle, where
 * build.mjs writes it.
 */
const ENTRY = new URL(import.meta.url.endsWith(".ts") ? "./parse-worker.ts" : "./parse-worker.js", import.meta.url);

/**
 * Parses each file in a worker thread of its own, so the server keeps answering whatever the file
 * holds. V8 holds the thread's JavaScript heap to `memoryMb`, collecting garbage before it gives
 * up. The heap limit does not count buffers (the file's bytes, a PDF's decoded streams), so the
 * thread's are read every 50 ms and held to half of `memoryMb`. A parse that needs more memory, or
 * runs past `timeoutSeconds`, has its thread stopped and ends as `failed` with the reason. The
 * bytes are copied to the thread, and nothing of the server's environment is; the text comes
 * back as a buffer handed over without a copy.
 */
export function threadParser(limits: ParseLimits): FileParser {
  return {
    parse(bytes, fileName, options) {
      const failed = (detail: string): ParsedFile => {
        const parser = parserFor(fileName, options.mediaType);
        return toParsedFile({ status: "failed", parser: parser?.name ?? "none", parser_version: parser?.version ?? "0", segments: [], text: "", markdown: "", duration_ms: null, status_detail: detail, facts: {} });
      };
      const tooMuchMemory = () => failed(`parsing it needed more than the ${limits.memoryMb} MB of memory this server gives one file, so it was stopped; the file is stored but not parsed`);
      const seconds = `${limits.timeoutSeconds} second${limits.timeoutSeconds === 1 ? "" : "s"}`;
      const tooLong = () => failed(`parsing it took longer than the ${seconds} this server gives one file, so it was stopped; the file is stored but not parsed`);

      const copy = bytes.slice();
      const worker = new Worker(ENTRY, {
        name: "parse",
        workerData: { bytes: copy, fileName, mediaType: options.mediaType, parseCapBytes: options.parseCapBytes },
        transferList: [copy.buffer],
        resourceLimits: { maxOldGenerationSizeMb: limits.memoryMb },
        env: {},
      });
      return new Promise<ParsedFile>((resolve) => {
        let done = false;
        const finish = (result: ParsedFile) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearInterval(watch);
          void worker.terminate();
          resolve(result);
        };
        worker.once("message", (result: ParsedFile) => finish(result));
        worker.once("error", (e: Error & { code?: string }) => finish(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? tooMuchMemory() : failed(`${e.name}: ${e.message}`.slice(0, 200))));
        worker.once("exit", () => finish(failed("the parser stopped before it finished")));
        const timer = setTimeout(() => finish(tooLong()), limits.timeoutSeconds * 1000);
        const watch = setInterval(() => {
          // Node 22.16 and later (the engines in package.json ask for later); on an older Node the heap limit alone holds.
          if (typeof worker.getHeapStatistics !== "function") return clearInterval(watch);
          worker.getHeapStatistics().then(
            (s) => {
              if (s.external_memory > (limits.memoryMb / 2) * MiB) finish(tooMuchMemory());
            },
            () => undefined,
          );
        }, WATCH_MS);
      });
    },
  };
}
