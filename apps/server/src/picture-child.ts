// The entry of the process one picture is made in (picture-process.ts starts it, and is the only
// thing that talks to it). It reads a job and the file's bytes from fd 0 and writes to fd 3 four
// bytes giving the length of a JSON answer, that answer, then the two copies. It imports nothing of
// the server, and Node loads it as it is, stripping its types, so it keeps to syntax that erases.
// It runs on until the server ends it with SIGKILL; it ends itself only if the server is gone or
// its memory passes the limit.
import { writeSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { deckFacts } from "@whatbuild/parsers";
import sharp from "sharp";

const THUMB = { width: 240, height: 180, quality: 62 };
const PREVIEW = { longest: 1600, quality: 75 };
/** A picture past this many pixels is refused unread: decoding one holds it all in memory. */
const MAX_INPUT_PIXELS = 100_000_000;
/** How large a PDF's first page is drawn, at most. */
const PAGE = { width: 1200, height: 2400 };
/** Below this much variation in every channel, a deck's embedded preview is blank: libraries that write decks carry a white one. */
const BLANK_STDEV = 4;
const WATCH_MS = 50;

interface Job {
  as: "image" | "pdf" | "deck";
  size: number;
  memoryMb: number;
}
interface Copies {
  thumb: Buffer;
  preview: Buffer;
  width: number;
  height: number;
}

const end = () => process.kill(process.pid, "SIGKILL");
// The server stops this process with SIGKILL; a signal to everything on an instance is the server's to act on.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => undefined);

let answered = false;
function answer(head: Record<string, unknown>, copies?: Copies) {
  if (answered) return;
  answered = true;
  const json = Buffer.from(JSON.stringify({ ...head, ...(copies ? { width: copies.width, height: copies.height, thumb_bytes: copies.thumb.length, preview_bytes: copies.preview.length } : {}) }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  for (const part of [length, json, ...(copies ? [copies.thumb, copies.preview] : [])]) {
    let at = 0;
    while (at < part.length) at += writeSync(3, part, at);
  }
}
const failed = (detail: string) => answer({ status: "failed", detail });

/** What shows either side of a slide, or above and below it, in a thumbnail. */
const BESIDE_A_SLIDE = { r: 233, g: 233, b: 230 };

async function copiesOf(input: Buffer, opts: { slide?: boolean } = {}): Promise<Copies> {
  const size = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).metadata();
  // An animation often starts on a blank frame, so its middle stands for it.
  const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", page: Math.floor((size.pages ?? 1) / 2) }).rotate();
  const upright = (size.orientation ?? 1) >= 5;
  const w = (upright ? size.height : size.width) ?? 1;
  const h = (upright ? size.width : size.height) ?? 1;
  // A slide is shown whole, since its words run to its edges. A page or a phone's screenshot starts
  // at its top; a photo's subject is usually in its middle.
  const shape = opts.slide && w >= h ? ({ fit: "contain", background: BESIDE_A_SLIDE } as const) : ({ fit: "cover", position: h > w * 1.2 ? "top" : "centre" } as const);
  const thumb = await open().resize({ width: THUMB.width, height: THUMB.height, ...shape }).webp({ quality: THUMB.quality }).toBuffer();
  const { data, info } = await open()
    .resize({ width: PREVIEW.longest, height: PREVIEW.longest, fit: "inside", withoutEnlargement: true })
    .webp({ quality: PREVIEW.quality })
    .toBuffer({ resolveWithObject: true });
  return { thumb, preview: data, width: info.width, height: info.height };
}

async function fromPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs")), "../..");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    maxImageSize: MAX_INPUT_PIXELS,
    standardFontDataUrl: `${join(root, "standard_fonts")}/`,
    cMapUrl: `${join(root, "cmaps")}/`,
    cMapPacked: true,
    wasmUrl: `${join(root, "wasm")}/`,
    verbosity: 0,
  }).promise;
  const page = await doc.getPage(1);
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(PAGE.width / natural.width, PAGE.height / natural.height) });
  type RenderOptions = Parameters<typeof page.render>[0];
  const factory = doc.canvasFactory as { create(width: number, height: number): { canvas: RenderOptions["canvas"] & { toBuffer(type: string): Buffer }; context: RenderOptions["canvasContext"] } };
  const made = factory.create(Math.round(viewport.width), Math.round(viewport.height));
  await page.render({ canvas: made.canvas, canvasContext: made.context, viewport }).promise;
  const png = made.canvas.toBuffer("image/png");
  // A landscape page is a slide, as a deck exported to PDF is.
  return { copies: await copiesOf(png, { slide: true }), pages: doc.numPages };
}

async function isBlank(picture: Uint8Array) {
  const { channels } = await sharp(picture, { limitInputPixels: MAX_INPUT_PIXELS }).stats();
  return channels.slice(0, 3).every((c) => c.stdev < BLANK_STDEV);
}

async function run(job: Job, bytes: Buffer) {
  sharp.concurrency(1);
  sharp.cache(false);
  try {
    if (job.as === "image") return answer({ status: "ready", detail: null }, await copiesOf(bytes));
    if (job.as === "pdf") {
      const { copies, pages } = await fromPdf(bytes);
      return answer({ status: "ready", detail: null, pages }, copies);
    }
    const deck = deckFacts(bytes);
    const card = deck.title ? { title: deck.title, colour: deck.colour } : null;
    const picture = deck.thumbnail && !(await isBlank(deck.thumbnail).catch(() => true)) ? await copiesOf(Buffer.from(deck.thumbnail), { slide: true }) : null;
    if (picture) return answer({ status: "ready", detail: null, pages: deck.slides, card }, picture);
    return answer({ status: "none", detail: "the deck carries no picture of itself", pages: deck.slides, card });
  } catch (e) {
    failed(String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 200));
  }
}

// A killed server sends no signal, but its end of this pipe closes with it.
const chunks: Buffer[] = [];
let held = 0;
let job: Job | null = null;
let started = false;
process.stdin.on("data", (d: Buffer) => {
  chunks.push(d);
  held += d.length;
  if (!job) {
    const all = Buffer.concat(chunks);
    if (all.length < 4) return;
    const n = all.readUInt32LE(0);
    if (all.length < 4 + n) return;
    job = JSON.parse(all.subarray(4, 4 + n).toString()) as Job;
    chunks.length = 0;
    chunks.push(all.subarray(4 + n));
    held = all.length - 4 - n;
    const limit = job.memoryMb * 1024 * 1024;
    setInterval(() => {
      if (process.memoryUsage.rss() <= limit) return;
      answer({ status: "failed", detail: `making its picture needed more than ${job!.memoryMb} MB of memory, so it was stopped` });
      end();
    }, WATCH_MS);
  }
  if (job && !started && held >= job.size) {
    started = true;
    void run(job, Buffer.concat(chunks));
  }
});
process.stdin.on("end", end);
process.stdin.on("close", end);
process.stdin.on("error", end);
