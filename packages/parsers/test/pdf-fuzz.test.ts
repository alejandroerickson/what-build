import { describe, expect, it } from "vitest";
import { derive } from "../src/index.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { pdfParser } from "../src/pdf.ts";
import type { FormatParser } from "../src/types.ts";
import { fuzzList, fuzzMixed, fuzzNoted, fuzzPdf, fuzzSpanning, fuzzTable, seeded, tableReadings, tablesIn, wordsIn } from "./pdf-fuzz.ts";

// What a PDF's reading must keep to, over pages with a known right reading. PDF text is people's
// evidence: a value in the wrong cell is the worst a reading can do, then a table that read correctly
// and no longer does; a false paragraph break, or a line read plainly, is mild.

/** How many of each kind of page `pdf-tables.snap` holds the tables of. */
const SNAPPED_PAGES = 60;

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

  it("keeps every word of a heading across two columns and of a note under a table", async () => {
    for (let seed = 0; seed < PAGES; seed++) {
      for (const p of [fuzzSpanning(seeded(seed * 19 + 4), [...CLEAR_GAPS, ...TIGHT_GAPS]), fuzzNoted(seeded(seed * 23 + 6), [...CLEAR_GAPS, ...TIGHT_GAPS])]) {
        const read = await readBy(pdfParser, fuzzPdf([p.runs]));
        expect(wordsIn(read), `seed ${seed}`).toEqual(wordsIn(p.runs.map((r) => r.text).join(" ")));
      }
    }
  }, 120_000);

  it("reads these tables, cell for cell, whatever else a change to the layout does", async () => {
    const readings = await tableReadings((bytes) => readBy(pdfParser, bytes), { clear: CLEAR_GAPS, tight: TIGHT_GAPS }, SNAPPED_PAGES);
    await expect(readings).toMatchFileSnapshot("./pdf-tables.snap");
  }, 120_000);
});
