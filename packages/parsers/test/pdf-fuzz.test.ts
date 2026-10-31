import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { derive } from "../src/index.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { pdfParser } from "../src/pdf.ts";
import type { FormatParser } from "../src/types.ts";
import { fuzzList, fuzzMixed, fuzzPdf, fuzzTable, seeded, tableReading, tablesIn, wordsIn } from "./pdf-fuzz.ts";

// What a PDF's reading must keep to, over pages with a known right reading. PDF text is people's
// evidence: a value in the wrong cell is the worst a reading can do, then a table that read correctly
// and no longer does; a false paragraph break, or a line read plainly, is mild.

/** How many pages of each kind: `PDF_FUZZ_PAGES` runs more, to look harder after a change to the layout. */
const PAGES = Number(process.env["PDF_FUZZ_PAGES"] ?? 150);
const CLEAR_GAPS = [1, 1.5, 2, 3];
const TIGHT_GAPS = [0.2, 0.25, 0.3, 0.35, 0.39, 0.41, 0.45, 0.5, 0.55, 0.59, 0.61, 0.7];

const readBy = async (parser: FormatParser, bytes: Uint8Array) =>
  renderMarkdown((await parser.parse(bytes.slice(), "fuzz.pdf", { maxBytes: Infinity })).blocks)
    .replace(/^# Page \d+\n*/gm, "")
    .trim();

describe("a fuzzed PDF", () => {
  it("reads a table whose columns are plain to see as it is set, and reads no word differently", async () => {
    let read = 0;
    for (let seed = 0; seed < PAGES; seed++) {
      const t = fuzzTable(seeded(seed * 17 + 9), CLEAR_GAPS, 700, true);
      if (!t) continue;
      read++;
      expect(await readBy(pdfParser, fuzzPdf([t.runs], t.tagged)), `seed ${seed}, gap ${t.gap}, tagged ${t.tagged}`).toBe(t.markdown);
    }
    expect(read).toBeGreaterThan(PAGES / 2);
  }, 120_000);

  it("loses no word of a table set tight, and keeps offsets exact", async () => {
    for (let seed = 0; seed < PAGES; seed++) {
      const t = fuzzTable(seeded(seed * 7 + 2), TIGHT_GAPS);
      if (!t) continue;
      const r = await derive(fuzzPdf([t.runs], t.tagged), "fuzz.pdf");
      expect(r.status, `seed ${seed}`).toBe("ready");
      expect(wordsIn(r.markdown), `seed ${seed}`).toEqual(wordsIn(t.markdown));
    }
  }, 120_000);

  it("reads lists and short lines with numbers in them a line each, with no table", async () => {
    for (let seed = 0; seed < PAGES; seed++) {
      const l = fuzzList(seeded(seed * 11 + 3));
      const read = await readBy(pdfParser, fuzzPdf([l.runs]));
      expect(tablesIn(read), `seed ${seed}: ${l.lines[0]}`).toEqual([]);
      expect(read.split("\n\n"), `seed ${seed}`).toEqual(l.lines);
    }
  }, 120_000);

  it("keeps every word of a page that mixes prose, a table and a list", async () => {
    for (let seed = 0; seed < PAGES; seed++) {
      const p = fuzzMixed(seeded(seed * 13 + 5), [...CLEAR_GAPS, ...TIGHT_GAPS]);
      const read = await readBy(pdfParser, fuzzPdf([p.runs]));
      expect(wordsIn(read), `seed ${seed}`).toEqual(wordsIn(p.runs.map((r) => r.text).join(" ")));
    }
  }, 120_000);
});

/**
 * The last commit whose PDF parser is version 5, which reads tables by columns its gaps show alone.
 * Compared with it where history is at hand; a shallow clone, as CI's test job has, skips it.
 */
const PARSER_5 = "112e21b8116c793625096ef2019edc44ebcb0f25";
const PARSER_5_DIR = join(import.meta.dirname, `.parser5-${process.pid}`);

function parser5Sources(): Record<string, string> | null {
  try {
    const show = (file: string) =>
      execFileSync("git", ["show", `${PARSER_5}:packages/parsers/src/${file}`], { cwd: import.meta.dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/"\.\/(tables|text|types)\.ts"/g, '"../../src/$1.ts"');
    return { "pdf-layout.ts": show("pdf-layout.ts"), "pdf.ts": show("pdf.ts") };
  } catch {
    return null;
  }
}

const sources = parser5Sources();

describe.skipIf(!sources)("a fuzzed PDF, against parser 5", () => {
  let parser5: FormatParser;
  beforeAll(async () => {
    mkdirSync(PARSER_5_DIR, { recursive: true });
    for (const [file, text] of Object.entries(sources!)) writeFileSync(join(PARSER_5_DIR, file), text);
    parser5 = (await import(/* @vite-ignore */ join(PARSER_5_DIR, "pdf.ts"))).pdfParser as FormatParser;
  });
  afterAll(() => rmSync(PARSER_5_DIR, { recursive: true, force: true }));

  it("reads as parser 5 did every table it read right, puts no value where parser 5 did not, and loses no word", async () => {
    let kept = 0;
    let gained = 0;
    for (const [gaps, salt] of [[CLEAR_GAPS, 1], [TIGHT_GAPS, 2]] as const) {
      for (let seed = 0; seed < PAGES; seed++) {
        const t = fuzzTable(seeded(seed * 7 + salt), gaps);
        if (!t) continue;
        const bytes = fuzzPdf([t.runs], t.tagged);
        const [before, now] = [await readBy(parser5, bytes), await readBy(pdfParser, bytes)];
        const said = `seed ${seed}, gap ${t.gap}, tagged ${t.tagged}, mono ${t.mono}`;
        expect(wordsIn(now), said).toEqual(wordsIn(t.markdown));
        if (before === t.markdown) {
          kept++;
          expect(now, said).toBe(t.markdown);
        } else if (now === t.markdown) gained++;
        const is = tableReading(now, t.rows);
        if (is === "misplaced" || is === "split" || is === "false row") expect(tableReading(before, t.rows), said).toBe(is);
      }
    }
    expect(kept).toBeGreaterThan(PAGES / 2);
    expect(gained).toBeGreaterThan(0);
  }, 300_000);

  it("reads as parser 5 did the words of lists and pages that mix prose, a table and a list", async () => {
    for (let seed = 0; seed < PAGES; seed++) {
      const l = fuzzList(seeded(seed * 11 + 3));
      const list = fuzzPdf([l.runs]);
      expect(wordsIn(await readBy(pdfParser, list)), `list, seed ${seed}`).toEqual(wordsIn(await readBy(parser5, list)));
      const p = fuzzMixed(seeded(seed * 13 + 5), [...CLEAR_GAPS, ...TIGHT_GAPS]);
      const mixed = fuzzPdf([p.runs]);
      const [before, now] = [await readBy(parser5, mixed), await readBy(pdfParser, mixed)];
      expect(wordsIn(now), `mixed, seed ${seed}`).toEqual(wordsIn(before));
      for (const t of p.tables) if (before.includes(t.markdown)) expect(now, `mixed, seed ${seed}`).toContain(t.markdown);
    }
  }, 300_000);
});
