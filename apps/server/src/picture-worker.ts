// The entry of the worker thread one picture is made in (picture-child.ts starts it, in the process
// of its own that picture has). It receives the bytes, makes the copies, hands them to that process
// without a copy, and ends. It imports nothing of the server, and Node loads it as it is, stripping
// its types, so it keeps to syntax that erases.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
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
/** What shows either side of a slide, or above and below it, in a thumbnail. */
const BESIDE_A_SLIDE = { r: 233, g: 233, b: 230 };

interface Copies {
  thumb: Uint8Array;
  preview: Uint8Array;
  width: number;
  height: number;
}

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

async function make(as: "image" | "pdf" | "deck", input: Buffer): Promise<{ head: Record<string, unknown>; copies?: Copies }> {
  if (as === "image") return { head: { status: "ready", detail: null }, copies: await copiesOf(input) };
  if (as === "pdf") {
    const { copies, pages } = await fromPdf(input);
    return { head: { status: "ready", detail: null, pages }, copies };
  }
  const deck = deckFacts(input);
  const card = deck.title ? { title: deck.title, colour: deck.colour } : null;
  const picture = deck.thumbnail && !(await isBlank(deck.thumbnail).catch(() => true)) ? await copiesOf(Buffer.from(deck.thumbnail), { slide: true }) : null;
  if (picture) return { head: { status: "ready", detail: null, pages: deck.slides, card }, copies: picture };
  return { head: { status: "none", detail: "the deck carries no picture of itself", pages: deck.slides, card } };
}

sharp.concurrency(1);
sharp.cache(false);
const job = workerData as { as: "image" | "pdf" | "deck"; bytes: Uint8Array };
const input = Buffer.from(job.bytes.buffer, job.bytes.byteOffset, job.bytes.byteLength);
let answer: { head: Record<string, unknown>; copies?: Copies };
try {
  answer = await make(job.as, input);
} catch (e) {
  answer = { head: { status: "failed", detail: String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 200) } };
}
parentPort!.postMessage(answer);
