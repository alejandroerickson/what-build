import { makePdfPages, pdfTable, pdfTextWidth, type PdfRun } from "./fixtures.ts";

/**
 * Seeded synthetic pages with a known right reading: tables (their cells), lists and short lines
 * with numbers in them (one line each, no table), and pages that mix them with prose. What a parser
 * reads of them is compared with that reading, and with what an earlier parser read.
 */

/** A small generator of numbers from a seed, so that a failure comes back the same. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const between = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const SOUNDS = ["wat", "we", "nea", "kail", "lfa", "lox", "an", "ia", "ker", "rin", "dol", "mo", "vur", "tan", "as", "ha", "tel", "lu", "mar", "bi", "wen", "pom", "ex", "ox", "al", "in"];
const word = (r: Rand) => Array.from({ length: between(r, 1, 3) }, () => pick(r, SOUNDS)).join("");
const name = (r: Rand) => {
  const w = word(r);
  return w.charAt(0).toUpperCase() + w.slice(1);
};

type ColumnKind = "words" | "number" | "decimal" | "money" | "percent" | "thousands" | "unit" | "labelled" | "same-label";
const COLUMN_KINDS: readonly ColumnKind[] = ["words", "number", "decimal", "money", "percent", "thousands", "unit", "labelled", "same-label"];

const cellOf = (r: Rand, kind: ColumnKind, label: string): string => {
  switch (kind) {
    case "words":
      return Array.from({ length: between(r, 1, 2) }, (_, i) => (i === 0 ? name(r) : word(r))).join(" ");
    case "number":
      return String(between(r, 1, 999));
    case "decimal":
      return `${between(r, 0, 99)}.${between(r, 0, 99)}`;
    case "money":
      return `$${between(r, 1, 99)},${String(between(r, 0, 999)).padStart(3, "0")}`;
    case "percent":
      return `${pick(r, ["+", "-"])}${between(r, 0, 40)}.${between(r, 0, 9)}%`;
    case "thousands":
      return `${between(r, 1, 99)} ${String(between(r, 0, 999)).padStart(3, "0")}`;
    case "unit":
      return `${between(r, 0, 9)}.${between(r, 0, 99)} ${pick(r, ["mg/L", "kg", "km", "days"])}`;
    case "labelled":
      return `${name(r)} ${between(r, 1, 99)}`;
    case "same-label":
      return `${label} ${between(r, 1, 99)}`;
  }
};

/** A table's rows: a first row of headings, then rows of cells of each column's kind. */
function tableRows(r: Rand, columns: number, rows: number, among: readonly ColumnKind[]): string[][] {
  const kinds = Array.from({ length: columns }, (_, j) => (j === 0 ? pick(r, ["words", "labelled", "same-label"] as const) : pick(r, among)));
  const label = name(r);
  return [
    Array.from({ length: columns }, () => name(r)),
    ...Array.from({ length: rows - 1 }, () => kinds.map((kind) => cellOf(r, kind, label))),
  ];
}

/** Courier's width of a text. */
const monoWidth = (text: string, size = 11) => text.length * 0.6 * size;

export interface FuzzTable {
  rows: string[][];
  markdown: string;
  gap: number;
  tagged: boolean;
  mono: boolean;
  right: number[];
  runs: PdfRun[];
}

const tableMarkdownOf = (rows: string[][]) => [`| ${rows[0]!.join(" | ")} |`, `| ${rows[0]!.map(() => "---").join(" | ")} |`, ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`)].join("\n");

/**
 * One fuzzed table at a place on the page, or null when it does not fit its width. `plain` keeps to a
 * table the first search reads as set: Helvetica, its columns of numbers on their left edges or, whole
 * numbers, their right.
 */
export function fuzzTable(r: Rand, gaps: readonly number[], top = 700, plain = false): FuzzTable | null {
  const columns = between(r, 2, 5);
  const count = between(r, 3, 8);
  const rows = tableRows(r, columns, count, plain ? ["words", "number", "decimal", "labelled", "same-label"] : COLUMN_KINDS);
  const gap = pick(r, gaps);
  const tagged = r() < 0.25;
  const mono = !plain && r() < 0.2;
  const right = Array.from({ length: columns }, (_, j) => j).filter((j) => j > 0 && /^[-+$\d]/.test(rows[1]![j]!) && (!plain || /^\d+$/.test(rows[1]![j]!)) && r() < 0.7);
  const size = 11;
  const widthOf = (t: string) => (mono ? monoWidth(t, size) : pdfTextWidth(t, size));
  const widths = rows[0]!.map((_, j) => Math.max(...rows.map((row) => widthOf(row[j]!))));
  const total = widths.reduce((a, b) => a + b, 0) + gap * size * (columns - 1);
  if (72 + total > 590) return null;
  const runs: PdfRun[] = mono
    ? (() => {
        let at = 72;
        const xs = widths.map((w) => {
          const x = at;
          at += w + gap * size;
          return x;
        });
        return rows.flatMap((row, i) => row.map((text, j): PdfRun => ({ text, x: right.includes(j) ? xs[j]! + widths[j]! - widthOf(text) : xs[j]!, y: top - i * 14, mono: true })));
      })()
    : pdfTable(rows, { gap, top, right });
  return { rows, markdown: tableMarkdownOf(rows), gap, tagged, mono, right, runs };
}

/** Lines that hold a number, and that no reading should take for a table. */
const LIST_SHAPES: readonly ((r: Rand) => string[])[] = [
  (r) => {
    const road = name(r);
    return Array.from({ length: between(r, 3, 6) }, () => `Flat ${between(r, 1, 9)} ${road} Road`);
  },
  (r) => Array.from({ length: between(r, 3, 6) }, (_, i) => `Chapter ${i + 1} ${name(r)} ${word(r)}`),
  (r) => Array.from({ length: between(r, 3, 6) }, () => `${pick(r, ["Monday", "Tuesday", "Friday"])} ${between(r, 1, 12)} am ${word(r)}`),
  (r) => Array.from({ length: between(r, 3, 6) }, (_, i) => `In ${2015 + i} the ${word(r)} moved to`),
  (r) => Array.from({ length: between(r, 3, 6) }, () => `${name(r)} ${between(r, 18, 80)}`),
  (r) => Array.from({ length: between(r, 3, 6) }, (_, i) => `Room ${i + 10} ${word(r)} ${word(r)}`),
  (r) => Array.from({ length: between(r, 3, 6) }, () => `${name(r)} ${pick(r, ["Road", "Lane", "Way"])} ${between(r, 1, 300)}`),
];

export interface FuzzList {
  lines: string[];
  mono: boolean;
  runs: PdfRun[];
}

export function fuzzList(r: Rand, top = 700): FuzzList {
  const lines = pick(r, LIST_SHAPES)(r);
  const mono = r() < 0.25;
  return { lines, mono, runs: lines.map((text, i): PdfRun => ({ text, x: 72, y: top - i * 14, ...(mono ? { mono } : {}) })) };
}

const SENTENCE_WORDS = ["the", "crews", "plan", "week", "on", "yard", "with", "paper", "board", "lead", "fills", "office", "copies", "sheet", "hand", "before", "they", "go", "and", "north", "region"];

/** Prose set to a measure, each line about as wide as the text is. */
function prose(r: Rand, lines: number, measure: number): string[] {
  return Array.from({ length: lines }, (_, i) => {
    const out: string[] = i === 0 ? [name(r)] : [pick(r, SENTENCE_WORDS)];
    for (;;) {
      const next = pick(r, SENTENCE_WORDS);
      if (pdfTextWidth([...out, next].join(" ")) > measure) break;
      out.push(next);
    }
    return i === lines - 1 ? `${out.join(" ")}.` : out.join(" ");
  });
}

export interface FuzzPage {
  tables: FuzzTable[];
  lists: FuzzList[];
  runs: PdfRun[];
}

/** A page of prose, a table and a list, one under another. */
export function fuzzMixed(r: Rand, gaps: readonly number[]): FuzzPage {
  const runs: PdfRun[] = [];
  const tables: FuzzTable[] = [];
  const lists: FuzzList[] = [];
  let y = 740;
  const addProse = () => {
    const lines = prose(r, between(r, 2, 5), 440);
    lines.forEach((text, i) => runs.push({ text, x: 72, y: y - i * 14 }));
    y -= lines.length * 14 + 14;
  };
  addProse();
  const t = fuzzTable(r, gaps, y);
  if (t) {
    tables.push(t);
    runs.push(...t.runs);
    y -= t.rows.length * 14 + 16;
  }
  if (r() < 0.5) {
    runs.push({ text: `${pick(r, ["Revised", "Source", "See note", "Based on"])} ${between(r, 1, 2026)}`, x: 72, y });
    y -= 30;
  }
  addProse();
  const l = fuzzList(r, y);
  lists.push(l);
  runs.push(...l.runs);
  y -= l.lines.length * 14 + 14;
  if (y > 60) addProse();
  return { tables, lists, runs };
}

export const fuzzPdf = (pages: PdfRun[][], tagged = false) => makePdfPages(pages, { tagged });

/** A text's words as a sorted list, the marks a table is laid out with left out: what no reading may lose or change. */
export function wordsIn(text: string): string[] {
  return text
    .replace(/^# Page \d+$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(^|\s)---(?=\s|$)/g, " ")
    .replace(/(^|\s)·(?=\s|$)/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

/** The tables a reading's Markdown holds, each as its lines. */
export function tablesIn(markdown: string): string[] {
  const out: string[] = [];
  let open: string[] = [];
  for (const line of [...markdown.split("\n"), ""]) {
    if (line.startsWith("|")) open.push(line);
    else if (open.length) {
      out.push(open.join("\n"));
      open = [];
    }
  }
  return out;
}

/** How a reading's tables stand against a table's right cells, from best to worst. */
export type TableReading = "right" | "none" | "merged" | "split" | "false row" | "misplaced";
const WORSE: readonly TableReading[] = ["right", "none", "merged", "split", "false row", "misplaced"];

/**
 * What a reading made of a table: `right`, its rows and cells as set; `none`, no table; `merged`, cells
 * held in one, or rows that fall out of a table or into another, nothing in a wrong place; `split`, a cell in two; `false row`, a
 * table's row that is none of the rows; `misplaced`, a value in a column other rows hold another's in.
 */
export function tableReading(markdown: string, rows: string[][]): TableReading {
  const tables = tablesIn(markdown);
  if (!tables.length) return "none";
  let worst: TableReading = "right";
  const hit = (r: TableReading) => {
    if (WORSE.indexOf(r) > WORSE.indexOf(worst)) worst = r;
  };
  const keys = rows.map((r) => r.join(" "));
  const used = new Set<number>();
  for (const table of tables) {
    const lines = table.split("\n").filter((l) => !/^\|[\s\-|]+\|$/.test(l));
    const read = lines.map((l) => l.replace(/^\|\s?/, "").replace(/\s?\|$/, "").split(" | ").map((c) => c.trim()));
    const placed = new Map<number, Set<number>>();
    for (const row of read) {
      const key = row.filter(Boolean).join(" ");
      let at = keys.findIndex((k, i) => k === key && !used.has(i));
      if (at < 0) at = keys.indexOf(key);
      if (at < 0) {
        hit("false row");
        continue;
      }
      used.add(at);
      const tokens = rows[at]!.flatMap((cell, column) => cell.split(" ").map((text) => ({ text, column })));
      let next = 0;
      const inCell = new Map<number, number>();
      row.forEach((cell, j) => {
        if (!cell) return;
        for (const text of cell.split(" ")) {
          const token = tokens[next++];
          if (!token || token.text !== text) {
            hit("misplaced");
            return;
          }
          if (inCell.has(token.column) && inCell.get(token.column) !== j) hit("split");
          inCell.set(token.column, j);
          if (!placed.has(token.column)) placed.set(token.column, new Set());
          placed.get(token.column)!.add(j);
        }
      });
    }
    for (const columns of placed.values()) if (columns.size > 1) hit("misplaced");
    if ((read[0]?.length ?? 0) < rows[0]!.length) hit("merged");
  }
  return worst === "right" && (used.size < rows.length || tables.length > 1) ? "merged" : worst;
}
