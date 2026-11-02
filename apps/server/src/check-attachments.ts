// Real files through the real parser and picture processes, at a deployment's limits, compared with
// what e2e/test-attachments.json says each should come to. Run by hand, when a change touches how a
// file is read or pictured: nothing runs it by itself (okf/operations/end-to-end-tests.md).
//
//   corepack pnpm check:attachments [--only <kind,kind>] [--dir <folder>] [--sheet <file.png>] [--record]
//
// --sheet draws every picture made onto one image, to look at. --record writes what it found into
// the list, for a change that alters it on purpose.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaTypeFor, pictureSource } from "@whatbuild/core";
import sharp from "sharp";
import { processParser } from "./parse-process.ts";
import { PICTURE_LIMITS, processPictureMaker } from "./picture-process.ts";

/** A deployment's defaults: `WHATBUILD_PARSE_MEMORY_MB`, `WHATBUILD_PARSE_TIMEOUT_SECONDS` and `WHATBUILD_PARSE_CAP_BYTES`. */
const PARSE_LIMITS = { memoryMb: 288, timeoutSeconds: 120 };
const PARSE_CAP_BYTES = 25 * 1024 * 1024;
const SHEET = { tile: { width: 160, height: 120 }, columns: 10 };

interface Listed {
  file: string;
  kind: string;
  read: string;
  picture?: string;
  [other: string]: unknown;
}

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = option("--only")?.split(",");
const record = args.includes("--record");
const sheetFile = option("--sheet");
const listFile = resolve(here, "../../../e2e/test-attachments.json");
const mainCheckout = resolve(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: here, encoding: "utf8" }).trim(), "..");
const folder = option("--dir") ?? join(mainCheckout, ".what-build/test-attachments");

const everything = JSON.parse(readFileSync(listFile, "utf8")) as Listed[];
const list = everything.filter((f) => !only || only.includes(f.kind));
const parser = processParser(PARSE_LIMITS);
const maker = processPictureMaker(PICTURE_LIMITS);

const different: string[] = [];
const absent: string[] = [];
const thumbs: Buffer[] = [];
let slowest = { ms: 0, file: "" };
const started = performance.now();
for (const f of list) {
  const path = join(folder, f.file);
  if (!existsSync(path)) {
    absent.push(f.file);
    continue;
  }
  const bytes = new Uint8Array(readFileSync(path));
  const media = mediaTypeFor(f.file, null);
  const began = performance.now();
  const read = await parser.parse(bytes, f.file, { mediaType: media, parseCapBytes: PARSE_CAP_BYTES });
  const source = pictureSource(f.file, media);
  const made = source ? await maker.make(bytes, source) : null;
  const ms = Math.round(performance.now() - began);
  if (ms > slowest.ms) slowest = { ms, file: f.file };
  if (made?.thumb) thumbs.push(Buffer.from(made.thumb));
  const said = `${read.status}${made ? `, picture ${made.status}` : ""}`;
  const wanted = `${f.read}${f.picture ? `, picture ${f.picture}` : ""}`;
  if (said !== wanted) different.push(`${f.file}: should be ${wanted}, came to ${said}${made?.detail ? ` (${made.detail})` : read.status_detail ? ` (${read.status_detail})` : ""}`);
  if (record) {
    f.read = read.status;
    if (made) f.picture = made.status;
    else delete f.picture;
  }
}
parser.stop();
maker.stop();

if (sheetFile && thumbs.length) {
  const { tile, columns } = SHEET;
  const composite = await Promise.all(
    thumbs.map(async (t, i) => ({ input: await sharp(t).resize(tile.width - 4, tile.height - 4, { fit: "contain", background: "#777" }).png().toBuffer(), left: (i % columns) * tile.width + 2, top: Math.floor(i / columns) * tile.height + 2 })),
  );
  await sharp({ create: { width: columns * tile.width, height: Math.ceil(thumbs.length / columns) * tile.height, channels: 3, background: "#333" } }).composite(composite).png().toFile(sheetFile);
  console.log(`${thumbs.length} pictures drawn on ${sheetFile}`);
}
if (record) writeFileSync(listFile, `[\n${everything.map((f) => `  ${JSON.stringify(f)}`).join(",\n")}\n]\n`);

const seconds = Math.round((performance.now() - started) / 1000);
console.log(`${list.length - absent.length} of ${list.length} files in ${seconds} s; the slowest took ${slowest.ms} ms (${slowest.file})`);
if (absent.length) console.log(`${absent.length} not here, so not checked: run node scripts/fetch-test-attachments.mjs${absent.length <= 5 ? `\n  ${absent.join("\n  ")}` : ""}`);
if (different.length && !record) {
  console.log(`${different.length} came to something else:\n  ${different.join("\n  ")}`);
  process.exit(1);
}
console.log(record ? `Recorded in ${listFile}.` : "Every file came to what it should.");
process.exit(0);
