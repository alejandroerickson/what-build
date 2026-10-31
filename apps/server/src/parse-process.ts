import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { FileParser } from "@whatbuild/core";
import { ParseInterrupted, parserFor, ParseStopped, READING_LIMITS, toParsedFile, type DerivationStatus, type ParsedFile } from "@whatbuild/parsers";
import { z } from "zod";

/** What one parse may use. */
export interface ParseLimits {
  /** The JavaScript heap of the parse's thread, in MB; the buffers it holds outside the heap may take half as much again. */
  memoryMb: number;
  /** How long one parse may run, in seconds. */
  timeoutSeconds: number;
}

const MiB = 1024 * 1024;
/**
 * The longest JSON frame read from a child. What a parse records beside its text comes to far less
 * (`READING_LIMITS`, the longest being a workbook's lists of sheets), and this holds what a broken
 * child can make the server parse in one go to some milliseconds and some MiB.
 */
const ANSWER_MAX_BYTES = 256 * 1024;
/** The frames a child may say ahead of its answer, per second of the time limit: it says its peak five times a second. */
const NOTES_PER_SECOND = 8;
/** How much of what a child says on stderr is kept, for how it ended. */
const SAID_KEPT_BYTES = 16 * 1024;
/** How much of it is read at all. Past this, the pipe is closed. */
const SAID_READ_BYTES = MiB;
/** How long after a child ends the last of its output may take to arrive. */
const LAST_OUTPUT_MS = 500;
/** What a child sends itself a little past its time limit, should the server not have ended it by then (parse-child.ts). */
const LAST_RESORT = "SIGALRM";

/**
 * The child's entry file: beside this module when the server runs from its source (development and
 * tests, where Node strips the types itself), and beside main.js in the bundle, where build.mjs writes it.
 */
const ENTRY = new URL(import.meta.url.endsWith(".ts") ? "./parse-child.ts" : "./parse-child.js", import.meta.url);

const STATUSES = Object.keys({ ready: 1, needs_transcript: 1, unsupported: 1, too_large: 1, failed: 1 } satisfies Record<DerivationStatus, 1>) as [DerivationStatus, ...DerivationStatus[]];
/** A string the store can hold: within its limit, with no U+0000 and no half of a surrogate pair. */
const held = (chars: number) => z.string().max(chars).refine((t) => !t.includes("\u0000") && !/\p{Cs}/u.test(t));
const INT4_MAX = 2 ** 31 - 1;
/** A child's answer, and what it may say ahead of it. A child is not believed: anything else is an answer that could not be read. */
const Frame = z.union([
  z.strictObject({ began: z.literal(true) }),
  z.strictObject({ peak_kb: z.int().nonnegative() }),
  z.strictObject({ stopped: z.enum(["memory", "ended"]) }),
  z.strictObject({ stopped: z.literal("error"), detail: held(200) }),
  z.strictObject({
    text_bytes: z.int().nonnegative(),
    parsed: z.strictObject({
      status: z.enum(STATUSES),
      parser: held(READING_LIMITS.parserChars),
      parser_version: held(READING_LIMITS.parserChars),
      status_detail: held(READING_LIMITS.detailChars).nullable(),
      duration_ms: z.int().nonnegative().nullable(),
      // A null is how JSON writes a number that is not one, as the stored facts do too.
      facts: z
        .record(held(READING_LIMITS.factKeyChars), z.union([z.number(), held(READING_LIMITS.factChars), z.boolean(), z.array(held(READING_LIMITS.factChars)).max(READING_LIMITS.factItems), z.null()]))
        .refine((facts) => Object.keys(facts).length <= READING_LIMITS.factKeys),
      char_count: z.int().nonnegative().max(INT4_MAX),
    }),
  }),
]);
type FrameRead = z.infer<typeof Frame>;
type Answer = Exclude<FrameRead, { began: true } | { peak_kb: number }>;

const asMiB = (bytes: number) => Math.round(bytes / MiB);

/**
 * How many other processes run beside the server, less the parses it has going: on an instance of
 * the image, normally none, and the rehearsal reads it for a process left behind. Null where it
 * cannot be told without running something (`/proc` is Linux's).
 */
function otherProcesses(parsesRunning: number): number | null {
  if (process.platform !== "linux") return null;
  try {
    return readdirSync("/proc").filter((name) => /^\d+$/.test(name)).length - 1 - parsesRunning;
  } catch {
    return null;
  }
}

/**
 * Parses each file in a child process of its own, which parses it in a worker thread, so a parse
 * that ends in a fatal error ends only itself and the server keeps answering whatever the file holds.
 *
 * In the child (parse-child.ts), the thread's JavaScript heap is held to `memoryMb`, and its buffers
 * (the file's bytes, a PDF's decoded streams), which that does not count, are read every 50 ms and
 * held to half of `memoryMb`. Here, a parse that runs past `timeoutSeconds` has its child ended with
 * SIGKILL. A parse that ends short of an answer is a `failed` reading with the reason, or, when it
 * may not be the file's doing (a child that never began its work, or was killed from outside),
 * rejects with `ParseInterrupted`, for its job to be tried again.
 *
 * This is a boundary for crashes and not for privilege. The child starts with none of the server's
 * variables or flags, none of its sockets or files, and no shell: `spawn`, unlike `fork`, passes on
 * none of the server's `execArgv`; this `env` replaces its environment; and what Node opens is
 * close-on-exec. But it runs as the same user on the same network, so code that took over a parse
 * could still reach what that user can, as it could from a thread.
 *
 * It has the pipes made here, which are raw pipes, not `fork`'s IPC, whose messages Node would read
 * whole before anything here could see their size: what a child writes is counted as it arrives,
 * held to a limit, and validated. The bytes go to the child without a copy on this side; the text
 * comes back into one buffer of the size the child declared, which the limit on buffers bounds.
 *
 * A child leads a process group of its own (`detached`), and the group ends with its parse, so what
 * a parse started goes with it unless it left the group. A child also ends if the server dies, when
 * its end of a pipe closes (parse-child.ts), and `stop` ends any still running.
 */
export function processParser(limits: ParseLimits, testOnly: { child?: URL; thread?: URL } = {}): FileParser {
  const running = new Set<() => void>();
  let stopping = false;
  const entry = fileURLToPath(testOnly.child ?? ENTRY);
  const textMaxBytes = (limits.memoryMb / 2) * MiB;

  return {
    parse(bytes, fileName, options) {
      if (stopping) return Promise.reject(new ParseStopped());
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
          child = spawn(process.execPath, [entry, String(limits.timeoutSeconds)], { env: {}, cwd: dirname(entry), detached: true, stdio: ["pipe", "ignore", "pipe", "pipe"] });
        } catch (e) {
          // Not this file's doing, and it may pass: the job is tried again.
          return reject(e as Error);
        }

        let settled = false;
        let exited = false;
        let timer: NodeJS.Timeout | undefined;
        let lastOutput: NodeJS.Timeout | undefined;
        let began = false;
        let peakKb: number | null = null;
        /** How the parse went, for the log line. */
        let how = "was stopped";
        /**
         * One line per parse, once its process is gone, for whoever runs the deployment: without the
         * file's name, and with the memory a rehearsal reads (okf/operations/dev-deployment.md).
         */
        const report = () => {
          if (!settled || !exited) return;
          const others = otherProcesses(running.size);
          console[how.startsWith("ended") ? "warn" : "log"](
            `parse: the process parsing a file ${how} (its peak ${peakKb === null ? "not said" : `${asMiB(peakKb * 1024)} MiB`}, the server now ${asMiB(process.memoryUsage.rss())} MiB${others === null ? "" : `, ${others} other processes`})`,
          );
        };
        /** Once: ends the child and what it started, whatever state they are in, and gives the parse's outcome. */
        const settle = (outcome: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(lastOutput);
          running.delete(stop);
          if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              // Its group has gone already.
            }
          }
          child.kill("SIGKILL");
          // None at all when it could not start for want of descriptors.
          for (const stream of child.stdio ?? []) stream?.destroy();
          report();
          outcome();
        };
        const stop = () => {
          how = "was stopped as the server shut down";
          settle(() => reject(new ParseStopped()));
        };
        const finish = (result: ParsedFile) => settle(() => resolve(result));
        /** Not to be held against the file, as far as anyone can tell: its job is tried again, and this is what its reading says should every attempt end so. */
        const interrupted = (why: string) => settle(() => reject(new ParseInterrupted(why)));

        // A child that could not start says so here; so would a kill that failed.
        child.on("error", (e) => settle(() => reject(e)));
        if (child.pid === undefined) return;
        running.add(stop);
        timer = setTimeout(() => {
          how = "was stopped at the time limit";
          finish(tooLong());
        }, limits.timeoutSeconds * 1000);

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
          const by = signal ?? `exit code ${code}`;
          // Without the file's name; a person is told the reason below.
          const words = (/FATAL ERROR:[^\n]*/.exec(said)?.[0] ?? said).trim().replace(/\s+/g, " ").slice(0, 300);
          how = `ended by ${by} without an answer${words ? `: ${words}` : ""}`;
          // Before it began its work, the file has had no part in it: not enough memory or threads to start, say.
          if (!began) return interrupted(`the process parsing it ended by ${by} before it could begin`);
          if (signal === LAST_RESORT) return finish(tooLong());
          // From outside, and it may have been ended for what something else on the instance used.
          if (signal === "SIGKILL") return interrupted("the process parsing it was killed, most likely for lack of memory");
          if (signal) return finish(failed(`parsing it ended in a fatal error (${signal}), so it was stopped; the file is stored but not parsed`));
          if (code) return finish(failed(`the process parsing it exited with code ${code} before it finished; the file is stored but not parsed`));
          finish(failed("the parser stopped before it finished"));
        };
        child.once("exit", (code, signal) => {
          exited = true;
          report();
          // 'close' comes once its pipes have given their last, unless something else holds them open.
          lastOutput = setTimeout(() => ended(code, signal), LAST_OUTPUT_MS);
        });
        child.once("close", ended);

        const notes = (limits.timeoutSeconds + 10) * NOTES_PER_SECOND;
        const heardNote = (note: { began: true } | { peak_kb: number }) => {
          if ("began" in note) began = true;
          else peakKb = note.peak_kb;
        };
        const read = answerReader(textMaxBytes, notes, heardNote, (answer, textMd) => {
          if (answer === null) {
            how = "gave an answer that could not be read";
            return finish(unreadable());
          }
          if (answer === "too much text") {
            how = "said its text was past the limit";
            return finish(tooMuchMemory());
          }
          if ("parsed" in answer) {
            // Code points cannot outnumber bytes, and the column and the search index hold no U+0000.
            if (answer.parsed.char_count > textMd.length || textMd.includes(0)) {
              how = "gave an answer that could not be read";
              return finish(unreadable());
            }
            how = `answered ${answer.parsed.status}`;
            return finish({ ...answer.parsed, facts: answer.parsed.facts as ParsedFile["facts"], text_md: textMd });
          }
          how = `answered that the parse stopped (${answer.stopped})`;
          if (answer.stopped === "memory") return finish(tooMuchMemory());
          finish(answer.stopped === "error" ? failed(answer.detail) : failed("the parser stopped before it finished"));
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

/**
 * Reads what a child writes as it arrives: frames of a length and JSON, ending in its answer, then
 * the text. Never holds more than the limits say, whatever the child writes. Calls `note` with each
 * frame ahead of the answer, of which `notesMax` may come and one saying it began, and `done` once:
 * with what it read, with "too much text" if that was past `textMaxBytes`, or with null if it could
 * not be read.
 */
function answerReader(textMaxBytes: number, notesMax: number, note: (frame: { began: true } | { peak_kb: number }) => void, done: (answer: Answer | "too much text" | null, text: Uint8Array) => void) {
  const nothing = new Uint8Array(0);
  let target: Uint8Array = new Uint8Array(4);
  let filled = 0;
  let stage: "length" | "json" | "text" | "done" = "length";
  let answer: Answer | null = null;
  let notes = 0;
  let began = false;
  const end = (outcome: Answer | "too much text" | null, text: Uint8Array = nothing) => {
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
        const parsed = Frame.safeParse(json);
        if (!parsed.success) return end(null);
        const frame: FrameRead = parsed.data;
        if ("began" in frame || "peak_kb" in frame) {
          if (++notes > notesMax || ("began" in frame && began)) return end(null);
          if ("began" in frame) began = true;
          note(frame);
          target = new Uint8Array(4);
          filled = 0;
          stage = "length";
          continue;
        }
        answer = frame;
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
