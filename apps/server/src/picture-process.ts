import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { MadePicture, PictureMaker, PictureSource } from "@whatbuild/core";
import { ParseInterrupted, ParseStopped } from "@whatbuild/parsers";
import { z } from "zod";
import { otherProcesses } from "./parse-process.ts";

/** What one picture may use. */
export interface PictureLimits {
  memoryMb: number;
  timeoutSeconds: number;
}

/**
 * What a deployment gives one picture. A 48-megapixel photo takes about 120 MB and half a second, a
 * heavy PDF page more; a parse may use about this much too, and the worker runs one job at a time.
 */
export const PICTURE_LIMITS: PictureLimits = { memoryMb: 384, timeoutSeconds: 20 };

const MiB = 1024 * 1024;
/** The largest a child may say its copies are, and all it may write. Far past what the sizes it makes come to. */
const THUMB_MAX_BYTES = 512 * 1024;
const PREVIEW_MAX_BYTES = 8 * MiB;
const HEAD_MAX_BYTES = 16 * 1024;
/** How long after a child ends the last of its output may take to arrive. */
const LAST_OUTPUT_MS = 500;

const ENTRY = new URL(import.meta.url.endsWith(".ts") ? "./picture-child.ts" : "./picture-child.js", import.meta.url);

/** A child is not believed: anything else is an answer that could not be read. */
const Head = z.strictObject({
  status: z.enum(["ready", "none", "failed"]),
  detail: z.string().max(300).nullable(),
  pages: z.int().min(0).max(1_000_000).optional(),
  card: z.strictObject({ title: z.string().min(1).max(300), colour: z.string().regex(/^[0-9a-fA-F]{6}$/).nullable() }).nullable().optional(),
  width: z.int().min(1).max(4000).optional(),
  height: z.int().min(1).max(4000).optional(),
  thumb_bytes: z.int().min(1).max(THUMB_MAX_BYTES).optional(),
  preview_bytes: z.int().min(1).max(PREVIEW_MAX_BYTES).optional(),
  peak_kb: z.int().nonnegative().optional(),
});

const nothing = { thumb: null, preview: null, width: null, height: null, pages: null, card: null };
const failed = (detail: string): MadePicture => ({ status: "failed", detail, ...nothing });

/**
 * Makes each picture in a child process of its own (picture-child.ts), in a worker thread there
 * (picture-worker.ts), as `processParser` parses each file and for the same reasons: an image, a PDF
 * or a deck is whatever someone uploaded, and one that ends the process, or takes too long, ends only
 * that. The child starts with none of the server's variables or flags. The thread's heap has a hard
 * limit, and the child's other thread, which the work never holds up, reads all the process holds
 * every 50 ms and stops it past the limit. A boundary for crashes and not for privilege. One line in
 * the log says how each ended and its peak, which a rehearsal reads (okf/operations/dev-deployment.md).
 */
export function processPictureMaker(limits: PictureLimits): PictureMaker {
  const running = new Set<() => void>();
  let stopping = false;
  const entry = fileURLToPath(ENTRY);
  return {
    make(bytes: Uint8Array, as: PictureSource) {
      if (stopping) return Promise.reject(new ParseStopped());
      return new Promise<MadePicture>((resolve, reject) => {
        let settled = false;
        const child = spawn(process.execPath, [entry], { env: {}, cwd: dirname(entry), detached: true, stdio: ["pipe", "ignore", "ignore", "pipe"] });
        const settle = (outcome: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          running.delete(stop);
          if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              // Its group has gone already.
            }
          }
          child.kill("SIGKILL");
          for (const stream of child.stdio ?? []) stream?.destroy();
          outcome();
        };
        /** One line per picture, for whoever runs the deployment: without the file's name, and with the memory a rehearsal reads. */
        const report = (how: string, peakKb?: number) => {
          const others = otherProcesses(running.size);
          console.log(`picture: the process making a picture ${how} (its peak ${peakKb === undefined ? "not said" : `${Math.round(peakKb / 1024)} MiB`}, the server now ${Math.round(process.memoryUsage.rss() / MiB)} MiB${others === null ? "" : `, ${others} other processes`})`);
        };
        const stop = () => settle(() => reject(new ParseStopped()));
        running.add(stop);
        const timer = setTimeout(() => {
          report("was stopped at the time limit");
          settle(() => resolve(failed(`making its picture took longer than the ${limits.timeoutSeconds} seconds this server gives one, so it was stopped`)));
        }, limits.timeoutSeconds * 1000);
        child.on("error", (e) => settle(() => reject(e)));
        if (child.pid === undefined) return;

        const received: Buffer[] = [];
        let total = 0;
        const read = (): MadePicture | "more" | "bad" => {
          const all = Buffer.concat(received);
          if (all.length < 4) return "more";
          const n = all.readUInt32LE(0);
          if (n === 0 || n > HEAD_MAX_BYTES) return "bad";
          if (all.length < 4 + n) return "more";
          let head: z.infer<typeof Head>;
          try {
            head = Head.parse(JSON.parse(all.subarray(4, 4 + n).toString()));
          } catch {
            return "bad";
          }
          const thumbBytes = head.thumb_bytes ?? 0;
          const previewBytes = head.preview_bytes ?? 0;
          if (all.length < 4 + n + thumbBytes + previewBytes) return "more";
          if (head.status === "ready" && (!thumbBytes || !previewBytes)) return "bad";
          const at = 4 + n;
          report(`answered ${head.status}`, head.peak_kb);
          return {
            status: head.status,
            detail: head.detail,
            thumb: thumbBytes ? new Uint8Array(all.subarray(at, at + thumbBytes)) : null,
            preview: previewBytes ? new Uint8Array(all.subarray(at + thumbBytes, at + thumbBytes + previewBytes)) : null,
            width: head.width ?? null,
            height: head.height ?? null,
            pages: head.pages ?? null,
            card: head.card ?? null,
          };
        };
        (child.stdio[3] as NodeJS.ReadableStream).on("data", (d: Buffer) => {
          total += d.length;
          if (total > THUMB_MAX_BYTES + PREVIEW_MAX_BYTES + HEAD_MAX_BYTES + 4) return settle(() => resolve(failed("the process making its picture said too much, so it was stopped")));
          received.push(d);
          const got = read();
          if (got === "bad") return settle(() => resolve(failed("the process making its picture gave an answer that could not be read, so it was stopped")));
          if (got !== "more") settle(() => resolve(got));
        });
        const ended = (code: number | null, signal: NodeJS.Signals | null) => {
          if (settled) return;
          // From outside, and it may have been ended for what something else on the instance used.
          report(`ended by ${signal ?? `exit code ${code}`} without an answer`);
          if (signal === "SIGKILL") return settle(() => reject(new ParseInterrupted("the process making its picture was killed, most likely for lack of memory")));
          settle(() => resolve(failed(`the process making its picture ended by ${signal ?? `exit code ${code}`} before it finished`)));
        };
        child.once("exit", (code, signal) => setTimeout(() => ended(code, signal), LAST_OUTPUT_MS));
        for (const stream of child.stdio) stream?.on("error", () => undefined);

        const job = Buffer.from(JSON.stringify({ as, size: bytes.byteLength, memoryMb: limits.memoryMb }));
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

/** Makes a small picture of an image and of a PDF's first page, for the image to do as it is built: one that cannot run these fails there, and not at the first upload. */
export async function checkPictures(): Promise<void> {
  const maker = processPictureMaker({ ...PICTURE_LIMITS, timeoutSeconds: 60 });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
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
  for (const [name, bytes, as] of [["check.png", png, "image"], ["check.pdf", new TextEncoder().encode(pdf), "pdf"]] as const) {
    const made = await maker.make(bytes, as);
    if (made.status !== "ready") throw new Error(`Making a picture of ${name} ended as ${made.status}: ${made.detail}`);
    console.log(`${name}: a picture of ${made.width} by ${made.height}`);
  }
}
