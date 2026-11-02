#!/usr/bin/env node
// Real files made by real software, to try attachments' previews on: decks saved by PowerPoint and
// Google Slides, scans, phone photos, recordings, web pages. WhatBuild's tests make their files from
// nothing, and sample content is synthetic, so no file here is committed: e2e/test-attachments.json
// names each one's public address, its checksum and what allows its use.
//
//   node scripts/fetch-test-attachments.mjs [folder] [--only <kind,kind>]
//
// Downloads what the folder lacks (.what-build/test-attachments by default, about 300 MB in all),
// checks each against its checksum, and prints what it could not get: an address can stop working,
// and the plan (e2e/plans/attachment-previews.md) says what each kind should do. They are only ever
// read as data here, and never opened in an application.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf("--only");
const only = at >= 0 ? new Set(args[at + 1].split(",")) : null;
const folder = args.find((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1)) ?? join(here, "../.what-build/test-attachments");
mkdirSync(folder, { recursive: true });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const list = JSON.parse(readFileSync(join(here, "../e2e/test-attachments.json"), "utf8")).filter((f) => !only || only.has(f.kind));
let have = 0;
const missing = [];
for (const f of list) {
  const path = join(folder, f.file);
  if (existsSync(path) && sha256(readFileSync(path)) === f.sha256) {
    have++;
    continue;
  }
  try {
    const res = await fetch(f.from, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`${res.status} from ${f.from}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (sha256(bytes) !== f.sha256) throw new Error(`its bytes have changed at ${f.from}`);
    writeFileSync(`${path}.part`, bytes);
    renameSync(`${path}.part`, path);
    have++;
    console.log(`got ${f.file}`);
  } catch (e) {
    missing.push(`${f.file}: ${e.message}`);
  }
}
console.log(`${have} of ${list.length} files in ${folder}`);
if (missing.length) console.log(`Could not get:\n  ${missing.join("\n  ")}`);
