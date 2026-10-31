import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { FileParser } from "@whatbuild/core";
import { parserFor, toParsedFile, type DerivationStatus, type ParsedFile } from "@whatbuild/parsers";
import { z } from "zod";

/** What one parse may use. */
export interface ParseLimits {
  /** The JavaScript heap of the parse's thread, in MB; the buffers it holds outside the heap may take half as much again. */
  memoryMb: number;
  /** How long one parse may run, in seconds. */
  timeoutSeconds: number;
}

const MiB = 1024 * 1024;
/** The longest JSON answer read from a child: what a parse records beside its text, much less than this. */
const ANSWER_MAX_BYTES = 4 * MiB;
/** How much of what a child says on stderr is kept, for how it ended; the fatal error's line is near its end. */
const SAID_KEPT_BYTES = 16 * 1024;
/** How much of it is read at all. Past this, the pipe is closed. */
const SAID_READ_BYTES = MiB;
/** How long after a child ends the last of its output may take to arrive. */
const LAST_OUTPUT_MS = 500;
/** What V8 writes in its fatal error at a heap's limit: a parse that needed more memory, whichever way it was stopped. */
const HEAP_LIMIT = /Reached heap limit|JavaScript heap out of memory/;

/**
 * The child's entry file: beside this module when the server runs from its source (development and
 * tests, where Node strips the types itself), and beside main.js in the bundle, where build.mjs writes it.
 */
const ENTRY = new URL(import.meta.url.endsWith(".ts") ? "./parse-child.ts" : "./parse-child.js", import.meta.url);

const STATUSES = Object.keys({ ready: 1, needs_transcript: 1, unsupported: 1, too_large: 1, failed: 1 } satisfies Record<DerivationStatus, 1>) as [DerivationStatus, ...DerivationStatus[]];
const noNull = z.string().refine((s) => !s.includes("\u0000"));
/** What a child may answer. A child is not believed: anything else is an answer that could not be read. */
const Answer = z.union([
  z.strictObject({ stopped: z.enum(["memory", "ended"]) }),
  z.strictObject({ stopped: z.literal("error"), detail: noNull }),
  z.strictObject({
    text_bytes: z.number().int().nonnegative(),
    parsed: z.strictObject({
      status: z.enum(STATUSES),
      parser: noNull,
      parser_version: noNull,
      status_detail: noNull.nullable(),
      duration_ms: z.number().nonnegative().nullable(),
      // A null is how JSON writes a number that is not one, as the stored facts do too.
      facts: z.record(z.string(), z.union([z.number(), noNull, z.boolean(), z.array(noNull), z.null()])),
      char_count: z.number().int().nonnegative(),
    }),
  }),
]);

/**
 * Parses each file in a child process of its own, which parses it in a worker thread, so a parse
 * that ends in a fatal error ends only itself and the server keeps answering whatever the file holds.
 *
 * In the child (parse-child.ts), V8 holds the thread's JavaScript heap to `memoryMb`, collecting
 * garbage before it gives up, and the thread's buffers (the file's bytes, a PDF's decoded streams),
 * which the heap limit does not count, are read every 50 ms and held to half of `memoryMb`. Here, a
 * parse that runs past `timeoutSeconds` has its child ended with SIGKILL. Any way a parse ends short
 * of an answer, including the child dying, is a `failed` reading with the reason.
 *
 * The child gets nothing of the server: `spawn`, unlike `fork`, passes on none of the server's
 * `execArgv`; this `env` and `cwd` replace its environment and directory; and what Node opens is
 * close-on-exec, so the server's sockets and files stay here. It has the pipes made here, which are
 * raw pipes, not `fork`'s IPC, whose messages Node would read whole before anything here could see
 * their size: what a child writes is counted as it arrives, held to a limit, and validated. The
 * bytes go to the child without a copy on this side; the text comes back into one buffer of the size
 * the child declared, which the limit on buffers bounds.
 *
 * A child ends when its parse does. It also ends if the server dies, when its end of a pipe closes
 * (parse-child.ts), and `stop` ends any still running.
 */
export function processParser(limits: ParseLimits, testOnly: { child?: URL; thread?: URL } = {}): FileParser {
  const running = new Set<() => void>();
  let stopping = false;
  const entry = fileURLToPath(testOnly.child ?? ENTRY);
  const textMaxBytes = (limits.memoryMb / 2) * MiB;

  return {
    parse(bytes, fileName, options) {
      if (stopping) return Promise.reject(new Error(STOPPING));
      const failed = (detail: string): ParsedFile => {
        const parser = parserFor(fileName, options.mediaType);
        return toParsedFile({ status: "failed", parser: parser?.name ?? "none", parser_version: parser?.version ?? "0", segments: [], text: "", markdown: "", duration_ms: null, status_detail: detail, facts: {} });
      };
      const tooMuchMemory = () => failed(`parsing it needed more than the ${limits.memoryMb} MB of memory this server gives one file, so it was stopped; the file is stored but not parsed`);
      const seconds = `${limits.timeoutSeconds} second${limits.timeoutSeconds === 1 ? "" : "s"}`;
      const tooLong = () => failed(`parsing it took longer than the ${seconds} this server gives one file, so it was stopped; the file is stored but not parsed`);
      const unreadable = () => failed("the process parsing it gave an answer that could not be read, so it was stopped; the file is stored but not parsed");

      return new Promise<ParsedFile>((resolve, reject) => {
        let child: ChildProcess;
        try {
          child = spawn(process.execPath, [entry, String(limits.timeoutSeconds)], { env: {}, cwd: dirname(entry), stdio: ["pipe", "ignore", "pipe", "pipe"] });
        } catch (e) {
          // Not this file's doing, and it may pass: the job is tried again.
          return reject(e as Error);
        }

        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        let lastOutput: NodeJS.Timeout | undefined;
        /** Once: ends the child, whatever state it is in, and gives the parse's outcome. */
        const settle = (outcome: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(lastOutput);
          running.delete(stop);
          child.kill("SIGKILL");
          // None at all when it could not start for want of descriptors.
          for (const stream of child.stdio ?? []) stream?.destroy();
          outcome();
        };
        const stop = () => settle(() => reject(new Error(STOPPING)));
        const finish = (result: ParsedFile) => settle(() => resolve(result));

        // A child that could not start says so here; so would a kill that failed.
        child.on("error", (e) => settle(() => reject(e)));
        if (child.pid === undefined) return;
        running.add(stop);
        timer = setTimeout(() => finish(tooLong()), limits.timeoutSeconds * 1000);

        // What a child says is kept only to tell how it ended.
        let said = "";
        let heard = 0;
        child.stderr!.on("data", (d: Buffer) => {
          said = (said + d.toString("latin1")).slice(-SAID_KEPT_BYTES);
          heard += d.length;
          if (heard > SAID_READ_BYTES) child.stderr!.destroy();
        });

        const ended = (code: number | null, signal: NodeJS.Signals | null) => {
          if (settled) return;
          // For whoever runs the deployment, without the file's name; a person is told the reason below.
          const words = (/FATAL ERROR:[^\n]*/.exec(said)?.[0] ?? said).trim().replace(/\s+/g, " ").slice(0, 300);
          console.warn(`parse: the process parsing a file ended by ${signal ?? `exit code ${code}`} without an answer${words ? `: ${words}` : ""}`);
          if (signal && HEAP_LIMIT.test(said)) return finish(tooMuchMemory());
          if (signal === "SIGKILL") return finish(failed("the system stopped the process parsing it, most likely for lack of memory; the file is stored but not parsed"));
          if (signal) return finish(failed(`parsing it ended in a fatal error (${signal}), so it was stopped; the file is stored but not parsed`));
          if (code) return finish(failed(`the process parsing it exited with code ${code} before it finished; the file is stored but not parsed`));
          finish(failed("the parser stopped before it finished"));
        };
        child.once("exit", (code, signal) => {
          // 'close' comes once its pipes have given their last, unless something else holds them open.
          lastOutput = setTimeout(() => ended(code, signal), LAST_OUTPUT_MS);
        });
        child.once("close", ended);

        const read = answerReader(textMaxBytes, (answer, textMd) => {
          if (answer === null) return finish(unreadable());
          if (answer === "too much text") return finish(tooMuchMemory());
          if ("parsed" in answer) {
            // Code points cannot outnumber bytes, and the column and the search index hold no U+0000.
            if (answer.parsed.char_count > textMd.length || textMd.includes(0)) return finish(unreadable());
            return finish({ ...answer.parsed, facts: answer.parsed.facts as ParsedFile["facts"], text_md: textMd });
          }
          if (answer.stopped === "memory") return finish(tooMuchMemory());
          finish(answer.stopped === "error" ? failed(answer.detail.slice(0, 200)) : failed("the parser stopped before it finished"));
        });
        (child.stdio[3] as Readable).on("data", read);

        // A child that dies while being written to, or read from, is told apart above; the pipes' own errors say nothing more.
        for (const stream of child.stdio) stream?.on("error", () => undefined);

        // The file's name goes on the pipe, not in the arguments, which anything on the instance can list.
        const job = Buffer.from(JSON.stringify({ fileName, mediaType: options.mediaType, parseCapBytes: options.parseCapBytes, memoryMb: limits.memoryMb, size: bytes.byteLength, thread: testOnly.thread?.href }));
        const length = Buffer.alloc(4);
        length.writeUInt32LE(job.length);
        child.stdin!.write(length);
        child.stdin!.write(job);
        // Left open: its closing is how the child learns the server is gone.
        if (bytes.byteLength) child.stdin!.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      });
    },
    stop() {
      stopping = true;
      for (const stop of running) stop();
    },
  };
}

const STOPPING = "the server is stopping, so reading this file was stopped; it is tried again";

/**
 * Reads a child's answer as it arrives: its length, the JSON, then the text. Never holds more than
 * the limits say, whatever the child writes, and calls `done` once: with what it read, with
 * "too much text" if that was past `textMaxBytes`, or with null if it could not be read.
 */
function answerReader(textMaxBytes: number, done: (answer: z.infer<typeof Answer> | "too much text" | null, text: Uint8Array) => void) {
  const nothing = new Uint8Array(0);
  let target: Uint8Array = new Uint8Array(4);
  let filled = 0;
  let stage: "length" | "json" | "text" | "done" = "length";
  let answer: z.infer<typeof Answer> | null = null;
  const end = (outcome: z.infer<typeof Answer> | "too much text" | null, text: Uint8Array = nothing) => {
    stage = "done";
    done(outcome, text);
  };
  return (chunk: Buffer) => {
    let at = 0;
    while (stage !== "done" && at < chunk.length) {
      const n = Math.min(target.length - filled, chunk.length - at);
      target.set(chunk.subarray(at, at + n), filled);
      filled += n;
      at += n;
      if (filled < target.length) return;
      if (stage === "length") {
        const length = Buffer.from(target).readUInt32LE(0);
        if (length === 0 || length > ANSWER_MAX_BYTES) return end(null);
        target = new Uint8Array(length);
        filled = 0;
        stage = "json";
      } else if (stage === "json") {
        let json: unknown;
        try {
          json = JSON.parse(Buffer.from(target.buffer, target.byteOffset, target.length).toString());
        } catch {
          return end(null);
        }
        const parsed = Answer.safeParse(json);
        if (!parsed.success) return end(null);
        answer = parsed.data;
        if (!("parsed" in answer)) return end(at === chunk.length ? answer : null);
        if (answer.text_bytes > textMaxBytes) return end("too much text");
        if (answer.text_bytes === 0) return end(at === chunk.length ? answer : null);
        target = new Uint8Array(answer.text_bytes);
        filled = 0;
        stage = "text";
      } else {
        // Whole, and nothing past what it said.
        return end(at === chunk.length ? answer : null, target);
      }
    }
  };
}

/**
 * Parses a small Markdown file and a small PDF through everything a file goes through, for the image
 * to do as it is built (`node main.js check-parsing`): a bundle or an image that cannot run a parse
 * fails there, and not at the first upload.
 */
export async function checkParsing(): Promise<void> {
  const parser = processParser({ memoryMb: 128, timeoutSeconds: 60 });
  const stream = "BT /F1 12 Tf 72 720 Td (Crews plan the week on Friday.) Tj ET";
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
trailer << /Root 1 0 R >>
%%EOF
`;
  for (const [name, body] of [["check.md", "Crews plan the week on Friday.\n"], ["check.pdf", pdf]] as const) {
    const parsed = await parser.parse(new TextEncoder().encode(body), name, { mediaType: null, parseCapBytes: MiB });
    const read = new TextDecoder().decode(parsed.text_md);
    if (parsed.status !== "ready" || !read.includes("Crews plan the week on Friday.")) throw new Error(`Parsing ${name} ended as ${parsed.status}: ${parsed.status_detail ?? read}`);
    console.log(`${name}: ${parsed.status}, parsed by ${parsed.parser}`);
  }
}
