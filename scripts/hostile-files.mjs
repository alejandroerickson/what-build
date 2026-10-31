#!/usr/bin/env node
// Hostile upload files, for rehearsing a release on the dev deployment: upload them through the
// app and watch that each ends in its status while the service keeps answering and each parse's peak,
// with what the server holds, stays clear of the instance's limit (okf/operations/dev-deployment.md,
// "Rehearsing a release"). Each is
// made here from nothing; none is committed. They are the cases the parsers' and the server's tests
// make (packages/parsers/test/hostile.test.ts, apps/server/test/hostile-uploads.test.ts), at full size.
//
//   node scripts/hostile-files.mjs <folder>
//
// Writes the files into <folder>, about 47 MB in all, and prints, for each, what it is and what
// WhatBuild should record for it at the default limits (WHATBUILD_PARSE_MEMORY_MB=288,
// WHATBUILD_PARSE_TIMEOUT_SECONDS=120, WHATBUILD_PARSE_CAP_BYTES of 25 MiB). With other limits a
// file may end otherwise: lower memory turns more of them into failures for memory.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { constants, deflateRawSync, deflateSync } from "node:zlib";

const MiB = 1024 * 1024;
const MAX_PDF_PAGES = 2000;
const PARSE_CAP_BYTES = 25 * MiB;

const AT_A_LIMIT = "too large or failed, with its reason";

/** `unit` repeated to `bytes` bytes, whole units only. */
const fill = (unit, bytes) => Buffer.from(unit.repeat(Math.floor(bytes / Buffer.byteLength(unit))));

/** A PDF of these objects, each a dictionary, or a dictionary and the bytes of its stream. */
function pdf(objects) {
  const parts = [Buffer.from("%PDF-1.4\n")];
  let length = parts[0].length;
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(length);
    const part = typeof o === "string" ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`) : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o[0]}\nstream\n`), o[1], Buffer.from("\nendstream\nendobj\n")]);
    parts.push(part);
    length += part.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** One page whose content stream inflates to `mib` MiB of text-drawing operations. */
function inflatingPdf(mib) {
  const ops = fill("(ab) Tj T* ", mib * MiB);
  const stream = deflateSync(Buffer.concat([Buffer.from("BT /F1 12 Tf 72 720 Td 14 TL\n"), ops, Buffer.from("ET")]), { level: 9 });
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    [`<< /Length ${stream.length} /Filter /FlateDecode >>`, stream],
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

/** One page whose content stream draws `count` short lines, set small enough that all of them stand on the page: a paragraph each. */
function shortLinesPdf(count) {
  const leading = 780 / count;
  const ops = fill("(Short) Tj T* ", count * Buffer.byteLength("(Short) Tj T* "));
  const stream = deflateSync(Buffer.concat([Buffer.from(`BT /F1 ${(leading * 0.6).toFixed(6)} Tf 72 785 Td ${leading.toFixed(6)} TL\n`), ops, Buffer.from("ET")]), { level: 9 });
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    [`<< /Length ${stream.length} /Filter /FlateDecode >>`, stream],
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

/** A PDF of `pages` blank pages: a few bytes each, so a small file has very many. */
function blankPdf(pages) {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ");
  return pdf(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`, ...Array(pages).fill("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>")]);
}

/**
 * A DOCX whose document part inflates to `mib` MiB of spaces, about 1 KB on disk for each MiB,
 * declaring a harmless unpacked size: a ZIP built by hand, so it can claim what it likes.
 */
function docxBomb(mib, declared = 4096) {
  const chunk = deflateRawSync(Buffer.alloc(MiB, 0x20), { level: 9, finishFlush: constants.Z_SYNC_FLUSH });
  const data = Buffer.concat([...Array(mib).fill(chunk), Buffer.from([0x03, 0x00])]);
  const name = Buffer.from("word/document.xml");
  const u16 = (n) => Buffer.from([n & 0xff, n >> 8]);
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0);
    return b;
  };
  const head = [u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(data.length), u32(declared), u16(name.length), u16(0)];
  const local = Buffer.concat([u32(0x04034b50), ...head, name, data]);
  const central = Buffer.concat([u32(0x02014b50), u16(20), ...head, u16(0), u16(0), u16(0), u32(0), u32(0), name]);
  return Buffer.concat([local, central, u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length), u16(0)]);
}

/** The files, in the order they are written: a name, what it is, what WhatBuild should record, and the bytes. */
export const HOSTILE_FILES = [
  {
    name: "inflating.pdf",
    what: "a PDF of about 130 KB whose one content stream inflates to 64 MB of text to draw",
    expect: `ready, after some seconds, or ${AT_A_LIMIT}`,
    make: () => inflatingPdf(64),
  },
  {
    name: "short-lines.pdf",
    what: "a PDF of about 6 KB whose one page draws 190,000 short lines with no full stop, each its own paragraph, just under the most a reading may hold",
    // Measured: about 6 seconds.
    expect: "ready, after some seconds: the most paragraphs a PDF's layout makes of one page",
    make: () => shortLinesPdf(190_000),
  },
  {
    name: "blank-pages.pdf",
    what: "a PDF of 20,000 blank pages in about 2 MB",
    expect: `too large: "the PDF has 20000 pages; PDFs over ${MAX_PDF_PAGES} pages are stored but not parsed"`,
    make: () => blankPdf(20_000),
  },
  {
    name: "bomb.docx",
    what: "a DOCX of about 1 MB whose document unpacks to 1 GiB, declaring 4 KB",
    expect: `too large: "the file unpacks to more than ${PARSE_CAP_BYTES} bytes; files over ${PARSE_CAP_BYTES} bytes are stored but not parsed"`,
    make: () => docxBomb(1024),
  },
  {
    name: "dense-5mb.txt",
    what: "5 MB of one-letter paragraphs, at the public sandbox's file limit: 1.7 million would-be paragraphs",
    expect: AT_A_LIMIT,
    make: () => fill("a\n\n", 5 * MiB),
  },
  {
    name: "dense-24mb.txt",
    what: "24 MB of one-letter paragraphs, under the 25 MB relay and parse limits: 8.4 million would-be paragraphs",
    // Splitting it into paragraphs needs more memory than counting the first 200,000 of them.
    expect: AT_A_LIMIT,
    make: () => fill("a\n\n", 24 * MiB),
  },
  {
    name: "dense.html",
    what: "5 MB of unclosed list items: a million elements to build",
    expect: AT_A_LIMIT,
    make: () => fill("<li>a", 5 * MiB),
  },
  {
    name: "emphasis.md",
    what: "a Markdown line of 5 MB of unclosed emphasis markers (*a *a *a …)",
    expect: "ready, in a second or two: 2,625 paragraphs, read in time linear in its length",
    make: () => Buffer.concat([fill("*a ", 5 * MiB), Buffer.from("\n")]),
  },
  {
    name: "voices.vtt",
    what: "a WebVTT transcript of one 5 MB cue of unclosed voice tags (<v <v <v …)",
    expect: "ready, in a second or two: 2,625 paragraphs, read in time linear in its length",
    make: () => Buffer.concat([Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\n"), fill("<v ", 5 * MiB), Buffer.from("\n")]),
  },
];

function main() {
  const folder = process.argv[2];
  if (!folder || process.argv.length > 3) {
    console.error("usage: node scripts/hostile-files.mjs <folder>");
    process.exit(2);
  }
  const out = resolve(folder);
  mkdirSync(out, { recursive: true });
  const size = (n) => (n >= MiB ? `${(n / MiB).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
  console.log(`Writing ${HOSTILE_FILES.length} hostile files to ${out}. At the default limits, WhatBuild should record:\n`);
  for (const f of HOSTILE_FILES) {
    const bytes = f.make();
    writeFileSync(join(out, f.name), bytes);
    console.log(`${f.name} (${size(bytes.length)})\n  ${f.what}\n  → ${f.expect}\n`);
  }
  console.log("Upload each as the only attachment of a source of its own. While they parse, the service should go on answering; afterwards, read each parse's line in the log (okf/operations/dev-deployment.md).");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
