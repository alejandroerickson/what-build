import { tableBlocks } from "./tables.ts";
import { codePointLength, isSpaceUnit } from "./text.ts";
import type { Block } from "./types.ts";

/**
 * A PDF page laid out as a person reads it, from the runs of text pdf.ts reads from it.
 *
 * A content stream draws a page's text in runs, in an order of its own: usually the reading order
 * of its prose, a column at a time, but a table's or a form's runs come in any order, a label long
 * before its value, a cell after the lines of the cell beside it. So the runs are read in the
 * stream's order and laid out by where they stand:
 *
 * - Runs drawn one after another on a baseline are a line, read across the page, and split into
 *   cells where a gap is wider than a space between words can be.
 * - Lines drawn apart on one baseline are one line, as a form's label and its value are, unless
 *   one of them stands in a column of prose: each column of a page of two is read in turn.
 * - Lines of cells set in the same columns, one under the next, are a table, however close its
 *   columns are set (`findTightTables`): a file may draw two cells as one run.
 * - A line set clearly larger than the page's text is a heading of its own (`pageHeadings`).
 * - Lines of one cell are a paragraph while each wraps onto the next (`paragraphEnds`): a line that
 *   stops short of its column's width, or a line that starts a list, ends what came before it.
 * - A line repeated in the same place on most pages (a running header or footer, a page number)
 *   is read once, where it first appears, or not at all (`repeatedLines`).
 */

/**
 * A run of text in the frame its page's text stands upright in: where its baseline starts, its
 * advance, its font size, and its place in the content stream.
 */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  order: number;
  rtl: boolean;
}

/** A cell of a line: its words, and where they stand across the page. */
export interface Cell {
  text: string;
  x0: number;
  x1: number;
  /** Where it stands is reckoned from the letters of a run that holds more than it (`wordsOf`), not read from the file. */
  rough?: boolean;
}

/**
 * A table: its rows' cells, column by column; whether it is a form of labels and their values;
 * and whether it is columns of prose, drawn a line across them all at a time.
 */
export interface Table {
  rows: string[][];
  form: boolean;
  prose: boolean;
  /** Columns of prose: each column's lines, to read as the paragraphs they make. */
  columnLines?: Line[][];
}

/** A line of a page. */
export interface Line {
  cells: Cell[];
  x0: number;
  x1: number;
  /** The baseline and font size of its largest run, and how far its runs reach below and above. */
  y: number;
  size: number;
  /** The font size of its smallest run, which a gap between its cells is measured by. */
  small: number;
  bottom: number;
  top: number;
  /** Where its first run is in the content stream. */
  order: number;
  /** Its cells parted at gaps of `COLUMN_GAP`, which a table's columns may show to be cells. */
  fine: Cell[];
  table?: Table;
  /** Whether most of its text runs right to left, so that it reads from its right. */
  rtl: boolean;
  /** Its runs, while its page's tables are looked for: a page keeps only its lines. */
  runs?: Run[];
  /** Of the lines at other angles than the page's text, the frame this one stands upright in. */
  frame?: number;
}

/** A page's lines in reading order, its lines at other angles (a note up the margin), and its bottom and top. */
export interface PageLayout {
  lines: Line[];
  turned: Line[];
  bottom: number;
  top: number;
}

/** A gap this many ems wide between two runs on a line sets them in cells of their own. */
const CELL_GAP = 0.8;
/**
 * A gap this many ems wide, wider than a space between words, may part the cells of a table set
 * tight, as the columns its rows share show: the layout looks for tables in cells parted this
 * finely, and reads any other line in cells parted by `CELL_GAP`. Cells set closer than this are
 * looked for by what stands between them across the rows (`findTightTables`).
 */
const COLUMN_GAP = 0.4;
/** A gap this many ems wide between two runs is a space between words. */
const WORD_GAP = 0.15;
/** A table goes on under a row while the next is at most this many ems below it, and at most this many times its rows' widest spacing. */
const ROW_GAP = 2.5;
const ROW_SPREAD = 1.35;
/** The most lines a table is looked for in at once, and the times its last rows are dropped to find its columns aligned. */
const MAX_TABLE_LINES = 400;
const MAX_TABLE_TRIES = 40;
const TABLE_BUDGET = 200_000;
/**
 * What looking for tables set tight may cost a page, in words read and words checked against the
 * stretches so far, and the most runs and characters a line may have to be a table's row: a page
 * that never makes such a table is then read as lines.
 */
const TIGHT_BUDGET = 1_000_000;
const MAX_ROW_PARTS = 96;
const MAX_ROW_CHARS = 1000;
/** How far a word's edge reckoned from its run's letters may be from where it stands, in ems. */
const ROUGH_EDGE = 0.4;
/** The narrowest stretch between two columns, in ems, and how far a cell reckoned may stand from its column's edge. */
const MIN_GUTTER = 0.05;
const ROUGH_COLUMN = 0.6;
/** How many lines above and below a line show the width of its column, and how near their left edges must be, in ems. */
const MEASURE_WINDOW = 12;
const SAME_EDGE = 0.25;
/** Lines no wider than this many ems, in all, are no column: a line of them wraps onto nothing but lower case. */
const NARROWEST_COLUMN = 8;
/** A line that goes on in lower case ends a paragraph only when it stops this far short of its column's width. */
const STOPS_SHORT = 0.6;
/** White space between two lines this many times the page's usual leading parts two paragraphs. */
const PARAGRAPH_GAP = 1.25;

interface Run extends TextRun {
  x1: number;
  bottom: number;
  top: number;
}

const boxed = (r: TextRun): Run => ({ ...r, x1: r.x + Math.max(0, r.width), bottom: r.y - 0.25 * r.size, top: r.y + 0.75 * r.size });

/** Whether two boxes share a line: their heights overlap by half the lower one's at least. */
function level(a: { bottom: number; top: number }, b: { bottom: number; top: number }): boolean {
  return Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) >= 0.5 * Math.min(a.top - a.bottom, b.top - b.bottom);
}

/** Characters that may close a sentence after its last mark: quotes and brackets. */
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "}", "»"]);
const SENTENCE_END = new Set([".", "!", "?", ":", ";", "…", "。", "！", "？", "："]);

/** The last character of a text before any quotes and brackets that close it. */
function lastMark(text: string): string {
  let i = text.length - 1;
  while (i >= 0 && CLOSERS.has(text[i]!)) i--;
  return i >= 0 ? text[i]! : "";
}

/** A line that ends a sentence, or introduces what follows (`Attendees:`), and so ends a paragraph. */
const endsSentence = (text: string) => SENTENCE_END.has(lastMark(text));
const endsInColon = (text: string) => {
  const m = lastMark(text);
  return m === ":" || m === "：";
};
const LOWER_START = /^\p{Ll}/u;
const LETTER = /\p{L}/u;
const HYPHENS = new Set(["-", "‐", "\u00ad"]);

/** A cell that only marks a list item (`•`, `1.`, `(a)`, `iv.`), which a hanging indent sets apart from its words. */
const MARKER = /^(?:[•◦▪▫‣⁃●○■□►▸▹▶➢➤✓✔☐☑–—*·∙-]|\(?\d{1,3}[.)]|\(\d{1,3}\)|\d{1,3}(?:\.\d{1,3}){1,4}\.?|\(?[A-Za-z][.)]|\([A-Za-z]\)|\(?[ivxIVX]{1,5}[.)])$/;

/** Runs drawn one after another on a baseline: a line, or a part of one drawn apart from the rest. */
interface Strip {
  runs: Run[];
  x0: number;
  x1: number;
  y: number;
  size: number;
  bottom: number;
  top: number;
  order: number;
  /** The column of the stream it is part of: the strips drawn one under the next before and after it. */
  flow: number;
  text: string;
  cells: number;
}

function strips(runs: Run[]): Strip[] {
  const out: Strip[] = [];
  let last: Run | null = null;
  for (const r of runs) {
    const cur = out[out.length - 1];
    if (cur && last && level(last, r)) {
      // A run drawn again just beside itself, as a heavier weight is faked, is read once.
      const twice = r.text === last.text && Math.abs(r.x - last.x) < 0.2 * r.size && Math.abs(r.y - last.y) < 0.2 * r.size;
      if (!twice) {
        cur.runs.push(r);
        cur.x0 = Math.min(cur.x0, r.x);
        cur.x1 = Math.max(cur.x1, r.x1);
        if (r.size > cur.size) {
          cur.y = r.y;
          cur.size = r.size;
          cur.bottom = r.bottom;
          cur.top = r.top;
        }
      }
    } else {
      out.push({ runs: [r], x0: r.x, x1: r.x1, y: r.y, size: r.size, bottom: r.bottom, top: r.top, order: r.order, flow: 0, text: "", cells: 0 });
    }
    last = r;
  }
  let flow = 0;
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!;
    const cells = cellsOf(s.runs);
    s.cells = cells.length;
    s.text = cells.map((c) => c.text).join(" ");
    // The stream goes down a column while each strip is just below the one before and beside it.
    const p = out[i - 1];
    if (p && !(s.y < p.y - 0.5 * Math.min(p.size, s.size) && p.y - s.y <= 3 * Math.max(p.size, s.size) && s.x0 < p.x1 && s.x1 > p.x0)) flow++;
    s.flow = flow;
  }
  return out;
}

/** What a column of the stream is: prose that wraps from line to line, or a column of labels (`Client:`). */
interface Flow {
  prose: boolean;
  labels: boolean;
}

/** One line of prose wrapping onto the next: it ends no sentence and the next goes on in lower case, or it breaks a word. */
function wrapsOnto(line: string, next: string): boolean {
  if (codePointLength(line) < 15) return false;
  if (HYPHENS.has(line.charAt(line.length - 1))) return LETTER.test(next.charAt(0));
  return !endsSentence(line) && LOWER_START.test(next);
}

function flows(list: Strip[]): Map<number, Flow> {
  const out = new Map<number, Flow>();
  for (let i = 0; i < list.length; ) {
    let j = i;
    while (j < list.length && list[j]!.flow === list[i]!.flow) j++;
    const f = list.slice(i, j);
    const n = f.length;
    // Prose is lines of one cell each, long ones, or ones that wrap onto the next.
    const single = (s: Strip) => s.cells === 1;
    let wraps = 0;
    for (let k = 1; k < n; k++) if (single(f[k - 1]!) && single(f[k]!) && wrapsOnto(f[k - 1]!.text, f[k]!.text)) wraps++;
    const long = f.filter((s) => single(s) && s.x1 - s.x0 >= 12 * s.size).length;
    const cells = f.filter((s) => s.cells > 1).length;
    out.set(f[0]!.flow, {
      prose: n >= 3 && cells * 3 <= n && (wraps >= Math.max(1, Math.ceil((n - 1) / 4)) || long * 3 >= 2 * n),
      labels: f.filter((s) => endsInColon(s.text)).length * 2 >= n,
    });
    i = j;
  }
  return out;
}

/**
 * The strips that are one line, drawn apart on one baseline: a form's labels drawn before their
 * values, a cell drawn after the lines of the cell beside it. Two strips side by side from
 * different columns of the stream are joined unless either column is prose, as each column of a
 * page of two is; a column of labels is always joined to its values.
 */
function joinStrips(list: Strip[]): Strip[][] {
  const kinds = flows(list);
  const parent = list.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const byHeight = list.map((_, i) => i).sort((a, b) => list[b]!.y - list[a]!.y || list[a]!.x0 - list[b]!.x0);
  let row: number[] = [];
  const join = () => {
    if (row.length < 2) return;
    const across = row.slice().sort((a, b) => list[a]!.x0 - list[b]!.x0);
    for (let k = 1; k < across.length; k++) {
      const a = list[across[k - 1]!]!;
      const b = list[across[k]!]!;
      const fa = kinds.get(a.flow)!;
      const fb = kinds.get(b.flow)!;
      if (a.flow === b.flow || a.x1 > b.x0 + 0.5 * Math.min(a.size, b.size) || fa.labels || (!fa.prose && !fb.prose)) {
        parent[root(across[k]!)] = root(across[k - 1]!);
      }
    }
  };
  for (const i of byHeight) {
    const s = list[i]!;
    if (row.length && level(list[row[0]!]!, s) && level(list[row[row.length - 1]!]!, s)) row.push(i);
    else {
      join();
      row = [i];
    }
  }
  join();
  const groups = new Map<number, Strip[]>();
  for (let i = 0; i < list.length; i++) {
    const r = root(i);
    const g = groups.get(r);
    if (g) g.push(list[i]!);
    else groups.set(r, [list[i]!]);
  }
  return [...groups.values()];
}

/** Whether most of a line's text runs right to left. */
function readsFromRight(runs: Run[]): boolean {
  let rtl = 0;
  for (const r of runs) rtl += r.rtl ? r.text.length : -r.text.length;
  return rtl > 0;
}

/** A line's runs split into cells where a gap between them is `gap` ems wide or more. */
function cellsOf(runs: Run[], gap = CELL_GAP): Cell[] {
  // A line written right to left reads from its right.
  const rtl = readsFromRight(runs);
  const across = runs.slice().sort(rtl ? (a, b) => b.x1 - a.x1 : (a, b) => a.x - b.x);
  // A cell's text in parts, joined once: reading the end of a string built up run by run would
  // flatten it each time, in time quadratic in a line's runs.
  type Open = { parts: string[]; last: number; x0: number; x1: number; size: number };
  const open = (r: Run): Open => ({ parts: [r.text], last: r.text.charCodeAt(r.text.length - 1), x0: r.x, x1: r.x1, size: r.size });
  const cells: Open[] = [];
  let cur: Open | null = null;
  for (const r of across) {
    if (!cur) {
      cur = open(r);
      continue;
    }
    const space = rtl ? cur.x0 - r.x1 : r.x - cur.x1;
    const em = Math.min(cur.size, r.size);
    if (space >= gap * em) {
      cells.push(cur);
      cur = open(r);
      continue;
    }
    if (space >= WORD_GAP * em && !isSpaceUnit(cur.last) && !isSpaceUnit(r.text.charCodeAt(0))) cur.parts.push(" ");
    cur.parts.push(r.text);
    cur.last = r.text.charCodeAt(r.text.length - 1);
    cur.x0 = Math.min(cur.x0, r.x);
    cur.x1 = Math.max(cur.x1, r.x1);
    cur.size = Math.max(cur.size, r.size);
  }
  if (cur) cells.push(cur);
  const out: Cell[] = [];
  for (const c of cells) {
    const text = c.parts.join("").replace(/\s+/g, " ").trim();
    if (text) out.push({ text, x0: c.x0, x1: c.x1 });
  }
  return out;
}

/**
 * Cells whose first only marks a list item or numbers a heading, set apart from its words by a
 * hanging indent: the marker stays with them. A bare number (`1  Introduction`) is one only outside
 * a table, whose first column may be numbers.
 */
function withMarker(cells: Cell[], em: number, bare: boolean): Cell[] {
  const first = cells[0]?.text ?? "";
  if (cells.length > 1 && first.length <= 12 && (MARKER.test(first) || (bare && /^\d{1,3}$/.test(first))) && cells[1]!.x0 - cells[0]!.x1 <= 6 * em) {
    const [marker, words] = cells.splice(0, 2) as [Cell, Cell];
    cells.unshift({ text: `${marker.text} ${words.text}`, x0: Math.min(marker.x0, words.x0), x1: Math.max(marker.x1, words.x1) });
  }
  return cells;
}

function lineOf(group: Strip[]): Line {
  const runs = group.length === 1 ? group[0]!.runs : group.flatMap((s) => s.runs);
  const largest = group.reduce((a, b) => (b.size > a.size ? b : a));
  const cells = withMarker(cellsOf(runs), largest.size, true);
  // Loops, not Math.min(...): a line may have more runs than a call takes arguments.
  let small = Infinity;
  for (const r of runs) small = Math.min(small, r.size);
  const line: Line = {
    cells,
    fine: runs.length > 1 ? withMarker(cellsOf(runs, COLUMN_GAP), largest.size, false) : cells,
    rtl: readsFromRight(runs),
    runs,
    x0: Infinity,
    x1: -Infinity,
    y: largest.y,
    size: largest.size,
    small,
    bottom: Infinity,
    top: -Infinity,
    order: Infinity,
  };
  for (const s of group) {
    line.x0 = Math.min(line.x0, s.x0);
    line.x1 = Math.max(line.x1, s.x1);
    line.bottom = Math.min(line.bottom, s.bottom);
    line.top = Math.max(line.top, s.top);
    line.order = Math.min(line.order, s.order);
  }
  return line;
}

/** A line's text: its cells, a label (`Samples:`) joined to its value by a space, other cells by ` · `. */
export function lineText(cells: readonly { text: string }[]): string {
  let out = "";
  for (const [i, c] of cells.entries()) out += i === 0 ? c.text : (endsInColon(cells[i - 1]!.text) ? " " : " · ") + c.text;
  return out;
}

/**
 * Lay out a page's runs, those standing upright in its frame and those at other angles (each
 * group upright in a frame of its own), between its bottom and top.
 */
export function layoutPage(upright: TextRun[], others: TextRun[][], bottom: number, top: number): PageLayout {
  const lines = linesOf(upright);
  findTables(lines);
  for (const l of lines) l.runs = undefined;
  const turned = others.flatMap((runs, frame) =>
    strips(runs.map(boxed)).map((s) => {
      const l = lineOf([s]);
      l.runs = undefined;
      l.frame = frame;
      return l;
    }),
  );
  return { lines, turned, bottom, top };
}

/** A page's lines, in the order the stream draws their first runs. */
function linesOf(runs: TextRun[]): Line[] {
  const list = strips(runs.filter((r) => r.text.trim()).map(boxed));
  return joinStrips(list)
    .map(lineOf)
    .filter((l) => l.cells.length)
    .sort((a, b) => a.order - b.order);
}

/**
 * A line of words parted by gaps wider than a cell's, between lines of prose, as wide as the one
 * beside it and set as it is: a line of justified prose stretched to its column's width, which
 * reads as prose. Justifying widens every space of a line, so each cell is a word (but one, where
 * a space after a sentence was widened less); a row of a table has more words to a cell, or rows
 * of cells beside it.
 */
function stretched(line: Line, beside: (Line | undefined)[], cellsFor: (l: Line) => Cell[] = (l) => l.cells): boolean {
  const cells = cellsFor(line);
  const n = cells.length;
  if (n < 2 || cells.filter((c) => c.text.includes(" ")).length > (n >= 4 ? 1 : 0)) return false;
  if (beside.some((b) => b !== undefined && cellsFor(b).length > 1)) return false;
  const em = line.size;
  const width = line.x1 - line.x0;
  return beside.some(
    (b) =>
      b !== undefined &&
      Math.abs(b.y - line.y) <= 2.5 * em &&
      Math.abs(b.x0 - line.x0) <= em &&
      Math.abs(b.size - em) <= 0.1 * em &&
      b.x1 - b.x0 >= 12 * em &&
      width >= 0.85 * (b.x1 - b.x0),
  );
}

/** The columns of a table so far: the stretches across the page its cells cover, apart by gutters. */
type Columns = { x0: number; x1: number }[];

/**
 * Where a row's cells fall among the columns: the column each cell is in, opening a column where a
 * cell stands in a gutter; or null when a cell would reach across a gutter, or bring two columns
 * nearer than `COLUMN_GAP`, or share a column with a cell of the row a cell's gap away. Cells of a
 * row nearer than that in one column are parts of one cell, a word set apart in it. In a row of
 * cells, one cell may reach across one gutter (`bridges`): pdf.js reads two cells set close as one
 * run when nothing in the file parts them, and the cell stays in the first of its columns.
 */
function fit(columns: Columns, cells: Cell[], em: number, bridging: boolean): { columns: Columns; bridges: number } | null {
  const next = columns.map((c) => ({ ...c }));
  const last = new Map<{ x0: number; x1: number }, number>();
  let bridges = 0;
  for (const cell of cells) {
    const over = next.filter((c) => cell.x0 < c.x1 && cell.x1 > c.x0);
    if (over.length > 2 || (over.length === 2 && (!bridging || cells.length < 2))) return null;
    if (over.length === 2) {
      if (over.some((c) => last.has(c))) return null;
      for (const c of over) last.set(c, cell.x1);
      bridges++;
      continue;
    }
    const col = over[0];
    if (col) {
      const end = last.get(col);
      if (end !== undefined && cell.x0 - end >= CELL_GAP * em) return null;
      col.x0 = Math.min(col.x0, cell.x0);
      col.x1 = Math.max(col.x1, cell.x1);
      last.set(col, Math.max(end ?? -Infinity, cell.x1));
    } else {
      const c = { x0: cell.x0, x1: cell.x1 };
      next.push(c);
      last.set(c, cell.x1);
    }
  }
  next.sort((a, b) => a.x0 - b.x0);
  for (let k = 1; k < next.length; k++) if (next[k]!.x0 - next[k - 1]!.x1 < COLUMN_GAP * em) return null;
  return { columns: next, bridges };
}

/** The most of `xs` within `tol` of one another. */
function mostWithin(xs: number[], tol: number): number {
  const sorted = xs.slice().sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; j < sorted.length; j++) {
    while (sorted[j]! - sorted[i]! > tol) i++;
    best = Math.max(best, j - i + 1);
  }
  return best;
}

const NUMERIC = /^[-+−(]?[$€£¥]?\s?\d[\d.,\s]*%?\)?$/;

/** Whether cells stand in a column: all on their left edges, their middles, or, numbers, their right edges. */
function inLine(cells: Cell[], em: number): boolean {
  const within = (list: Cell[], tol: number) => {
    const n = list.length;
    if (mostWithin(list.map((c) => c.x0), tol) === n || mostWithin(list.map((c) => (c.x0 + c.x1) / 2), tol) === n) return true;
    return list.every((c) => NUMERIC.test(c.text)) && mostWithin(list.map((c) => c.x1), tol) === n;
  };
  const tol = Math.max(1.5, 0.15 * em);
  // A cell reckoned from a run's letters stands only about where it says.
  const read = cells.filter((c) => !c.rough);
  return read.length === cells.length ? within(cells, tol) : within(read, tol) && within(cells, ROUGH_COLUMN * em);
}

/**
 * Whether a column's cells stand in a column, as a table's do and the words of lines of prose do
 * not: every cell under its first row in line (`inLine`). The first row's may be set otherwise, as
 * a heading centred over a column often is, unless it is the only cell over one other.
 */
function aligned(head: Cell | null, body: Cell[], em: number): boolean {
  if (body.length >= 2) return inLine(body, em);
  return !head || body.length === 0 || inLine([head, ...body], em);
}

/**
 * Find the tables among a page's lines: lines of two cells or more (`Line.fine`), one under the
 * next, whose cells stand in the same columns, aligned (`aligned`), two such rows at least. A line
 * of one cell between two rows, within a column, is a row of the table: a cell's words wrapped
 * onto a second line join the row above. A table of labels and their values (`Client:` beside
 * `Example Co.`) is a form, read a line per row; columns of prose drawn a line across them at a
 * time are read a column at a time.
 */
function findTables(lines: Line[]): void {
  const found = new Map<Table, Found>();
  const fine = (l: Line) => l.fine;
  // A line of more cells than any table has columns is no row: fitting it to columns costs the square of its cells.
  const rowLike = (k: number) => lines[k]!.fine.length > 1 && lines[k]!.fine.length <= MAX_ROW_PARTS && !stretched(lines[k]!, [lines[k - 1], lines[k + 1]], fine);
  // What looking for tables may cost a page, in rows fitted to columns: a page of many lines
  // that never make a table is then read as lines.
  let budget = TABLE_BUDGET;
  type Built = { columns: Columns; em: number; rows: number; bridged: number };
  const add = (b: Built, k: number): Built | null => {
    budget--;
    const l = lines[k]!;
    const next = fit(b.columns, l.fine, Math.min(b.em, l.small), b.rows > 0 && rowLike(k));
    if (!next) return null;
    return { columns: next.columns, em: Math.min(b.em, l.small), rows: b.rows + (l.fine.length > 1 ? 1 : 0), bridged: b.bridged + (next.bridges ? 1 : 0) };
  };
  /** The columns the lines `taken` make, row after row, or null if a row does not fit them. */
  const columnsOf = (taken: number[]) => {
    let b: Built | null = { columns: [], em: lines[taken[0]!]!.small, rows: 0, bridged: 0 };
    for (const k of taken) if (b) b = add(b, k);
    return b;
  };
  for (let i = 0; i < lines.length && budget > 0; ) {
    if (!rowLike(i)) {
      i++;
      continue;
    }
    // The lines under it that fit its columns, one under the next, with at most two lines of one
    // cell together, and no wider apart than its rows already are: a wider space ends the table.
    const taken = [i];
    let built = columnsOf(taken);
    if (!built) {
      i++;
      continue;
    }
    let singles = 0;
    let pitch = 0;
    for (let k = i + 1; k < lines.length && taken.length < MAX_TABLE_LINES; k++) {
      const prev = lines[taken[taken.length - 1]!]!;
      const l = lines[k]!;
      const down = prev.y - l.y;
      if (!(down > 0 && down <= ROW_GAP * Math.max(prev.size, l.size)) || (pitch && down > ROW_SPREAD * pitch)) break;
      const multi = rowLike(k);
      if (!multi && (l.fine.length > 1 || ++singles > 2)) break;
      const next = add(built, k);
      if (!next) break;
      built = next;
      taken.push(k);
      pitch = Math.max(pitch, down);
      if (multi) singles = 0;
    }
    // A table ends at its last row of cells, and at the last row its columns stay aligned to.
    let table: Table | null = null;
    for (let tries = 0; !table && tries < MAX_TABLE_TRIES; tries++) {
      while (taken.length && lines[taken[taken.length - 1]!]!.fine.length < 2) taken.pop();
      const built = taken.length ? columnsOf(taken) : null;
      if (!built || built.rows < 2) break;
      if (built.bridged * 3 <= built.rows && built.columns.length >= 2) table = tableOf(taken.map((k) => lines[k]!), built.columns, built.em);
      if (table) found.set(table, { lines: taken.length, bridged: built.bridged > 0 });
      else taken.pop();
    }
    if (!table) {
      i++;
      continue;
    }
    for (const k of taken) lines[k]!.table = table;
    i = taken[taken.length - 1]! + 1;
  }
  findTightTables(lines, found);
}

/** The table that lines make in these columns, or null when its columns are not aligned. */
function tableOf(lines: Line[], columns: Columns, em: number, cellsFor: (l: Line) => Cell[] = (l) => l.fine): Table | null {
  const rows: { cells: string[]; at: (Cell | null)[]; y: number; size: number; rtl: boolean }[] = [];
  for (const l of lines.slice().sort((a, b) => b.y - a.y)) {
    const cells = columns.map(() => "");
    const at: (Cell | null)[] = columns.map(() => null);
    for (const c of cellsFor(l)) {
      let k = columns.findIndex((col) => c.x0 < col.x1 && c.x1 > col.x0);
      if (k < 0) k = Math.max(0, columns.findLastIndex((col) => col.x0 <= c.x0));
      cells[k] = cells[k] ? `${cells[k]} ${c.text}` : c.text;
      const was = at[k];
      at[k] = was ? { text: cells[k]!, x0: Math.min(was.x0, c.x0), x1: Math.max(was.x1, c.x1) } : c;
    }
    // A cell's words wrapped onto the next line join it: a line that leaves the first column empty,
    // just under a row that fills it, with words only where that row has words.
    const prev = rows[rows.length - 1];
    if (
      prev &&
      !cells[0] &&
      prev.cells[0] &&
      prev.y - l.y <= 1.6 * Math.max(prev.size, l.size) &&
      cells.every((c, k) => !c || (prev.cells[k] && LETTER.test(c) && LETTER.test(prev.cells[k]!)))
    ) {
      prev.cells = prev.cells.map((p, k) => (cells[k] ? `${p} ${cells[k]}` : p));
      prev.y = l.y;
      continue;
    }
    rows.push({ cells, at, y: l.y, size: l.size, rtl: l.rtl });
  }
  if (rows.length < 2) return null;
  // Every column but the first lines up, as a table's do.
  for (let k = 1; k < columns.length; k++) if (!aligned(rows[0]!.at[k] ?? null, rows.slice(1).flatMap((r) => r.at[k] ?? []), em)) return null;
  const labelled = rows.filter((r) => r.cells.slice(0, -1).some((c) => endsInColon(c))).length;
  // Columns whose lines wrap onto the next, as prose does and a table's cells do not, are columns of prose.
  const prose =
    rows.length >= 3 &&
    columns.every((_, k) => {
      const cells = rows.map((r) => r.cells[k]!).filter(Boolean);
      let wraps = 0;
      for (let i = 1; i < cells.length; i++) if (wrapsOnto(cells[i - 1]!, cells[i]!)) wraps++;
      return cells.length >= 3 && wraps >= Math.max(1, Math.ceil((cells.length - 1) / 3));
    });
  const table: Table = { rows: rows.map((r) => r.cells), form: labelled * 2 >= rows.length, prose };
  if (prose) {
    // A column's lines, each as the line of a page of one column it would be.
    table.columnLines = columns.map((_, k) =>
      rows.flatMap((r) => {
        const at = r.at[k];
        const text = r.cells[k];
        if (!at || !text) return [];
        const line: Line = { cells: [{ text, x0: at.x0, x1: at.x1 }], fine: [], rtl: r.rtl, x0: at.x0, x1: at.x1, y: r.y, size: r.size, small: r.size, bottom: r.y, top: r.y, order: 0 };
        return [line];
      }),
    );
  }
  return table;
}

// ---- Tables set tight --------------------------------------------------------------------------

/** A table the first search found: how many lines it takes, and whether a cell of it reaches across a gutter. */
interface Found {
  lines: number;
  bridged: boolean;
}

/**
 * A word of a line and where it stands. A run that holds one word, or a word at either end of a run,
 * has that edge from the file (`exact0`, `exact1`). pdf.js reads two cells set closer than 0.6 of
 * their font's height as one run when nothing in the file parts them, with a space between them, so
 * a word inside a run has only an edge reckoned from the letters before it.
 */
interface Word {
  text: string;
  x0: number;
  x1: number;
  exact0: boolean;
  exact1: boolean;
  /** The stretch the word certainly covers: all of it, less `ROUGH_EDGE` at an edge reckoned. */
  lo: number;
  hi: number;
  /** Set against the word before it in reading order with no space between, as a word in two fonts is. */
  glued: boolean;
  number: boolean;
}

/** About how wide a character is set, in ems: near enough, with a run's own width to scale it, to tell which word stands where. */
function charWidth(code: number): number {
  if (code >= 0x2e80) return 1;
  // Space, i l j t f r I . , : ; ' " ! |
  if (code === 0x20 || code === 0x69 || code === 0x6c || code === 0x6a || code === 0x74 || code === 0x66 || code === 0x72 || code === 0x49) return 0.28;
  if (code === 0x2e || code === 0x2c || code === 0x3a || code === 0x3b || code === 0x27 || code === 0x22 || code === 0x21 || code === 0x7c) return 0.28;
  // ( ) [ ] { } / \ -
  if (code === 0x28 || code === 0x29 || code === 0x5b || code === 0x5d || code === 0x7b || code === 0x7d || code === 0x2f || code === 0x5c || code === 0x2d) return 0.33;
  // m w M W @ %
  if (code === 0x6d || code === 0x77 || code === 0x4d || code === 0x57 || code === 0x40 || code === 0x25) return 0.85;
  if (code >= 0x41 && code <= 0x5a) return 0.68;
  return 0.55;
}

function reckon(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += charWidth(text.charCodeAt(i));
  return w;
}

/** A number with a decimal point, where a section's number has one with a heading after it: in a table, it is a cell. */
const DECIMAL = /^\d{1,3}\.\d{1,3}$/;

/** A line's words, across the page from its left; or null when a line has too much in it to be a row, or no width. */
function wordsOf(line: Line): Word[] | null {
  const runs = line.runs;
  if (!runs || runs.length > MAX_ROW_PARTS) return null;
  let chars = 0;
  for (const r of runs) chars += r.text.length;
  if (chars > MAX_ROW_CHARS) return null;
  const across = runs.slice().sort(line.rtl ? (a, b) => b.x1 - a.x1 : (a, b) => a.x - b.x);
  const edge = ROUGH_EDGE * line.small;
  const words: Word[] = [];
  let prev: Run | null = null;
  for (const r of across) {
    const width = r.x1 - r.x;
    if (width <= 0) return null;
    const scale = width / (reckon(r.text) || 1);
    let at = 0;
    let end = 0;
    let first = true;
    for (const m of r.text.matchAll(/[^ \t\r\n]+/g)) {
      at += reckon(r.text.slice(end, m.index));
      const wide = reckon(m[0]);
      end = m.index + m[0].length;
      const atStart = m.index === 0;
      const atEnd = end === r.text.length;
      const x0 = r.rtl ? r.x1 - (at + wide) * scale : r.x + at * scale;
      const x1 = r.rtl ? r.x1 - at * scale : r.x + (at + wide) * scale;
      const exact0 = r.rtl ? atEnd : atStart;
      const exact1 = r.rtl ? atStart : atEnd;
      const mid = (x0 + x1) / 2;
      const space = prev ? (line.rtl ? prev.x - r.x1 : r.x - prev.x1) : 0;
      words.push({
        text: m[0],
        x0,
        x1,
        exact0,
        exact1,
        lo: exact0 ? x0 : Math.min(mid, x0 + edge),
        hi: exact1 ? x1 : Math.max(mid, x1 - edge),
        glued: first && prev !== null && atStart && space < WORD_GAP * line.small && !isSpaceUnit(prev.text.charCodeAt(prev.text.length - 1)),
        number: NUMERIC.test(m[0]),
      });
      at += wide;
      first = false;
    }
    prev = r;
  }
  if (words.length > MAX_ROW_PARTS) return null;
  // A cell that only marks a list item stays with its words, as `withMarker` keeps it.
  const head = words[0];
  const after = words[1];
  if (head && after && head.text.length <= 12 && MARKER.test(head.text) && !DECIMAL.test(head.text)) {
    words.splice(0, 2, { ...after, text: `${head.text} ${after.text}`, x0: Math.min(head.x0, after.x0), x1: Math.max(head.x1, after.x1), lo: Math.min(head.lo, after.lo), hi: Math.max(head.hi, after.hi), glued: false, exact0: line.rtl ? after.exact0 : head.exact0, exact1: line.rtl ? head.exact1 : after.exact1, number: false });
  }
  return words.sort((a, b) => a.x0 - b.x0);
}

/** Whether the file parts two neighbouring words by a gap: each edge is where it put it, and they stand at least a word's space apart. */
const gapBetween = (a: Word, b: Word, em: number) => a.exact1 && b.exact0 && b.x0 - a.x1 >= WORD_GAP * em;

/**
 * Whether what stands in a line says two neighbouring words are two cells: the file parts them by a
 * gap, or a number follows, as a cell's words cannot be told from the cell beside them but a number
 * can (a number set in thousands, `12 500`, being one number).
 */
function parted(a: Word, b: Word, em: number): boolean {
  return gapBetween(a, b, em) || (b.number && !(a.number && /^\d{1,3}$/.test(a.text) && /^\d{3}(?!\d)/.test(b.text)));
}

/** A stretch across the page that no word of a table's rows so far covers, and whether a row has spoken for it (`parted`). */
type Stretch = { lo: number; hi: number; spoken: boolean };

/**
 * The stretches left open under a row's words, those narrower than a gutter being none; or null when
 * the row closes one that a row has spoken for: it is no row of this table, as a sentence under it is not.
 */
function crossStretches(open: Stretch[], words: Word[], gutter: number, em: number): Stretch[] | null {
  const out: Stretch[] = [];
  for (const s of open) {
    const from = out.length;
    let lo = s.lo;
    for (const w of words) {
      if (w.hi <= lo || w.lo >= s.hi) continue;
      if (w.lo - lo >= gutter) out.push({ lo, hi: w.lo, spoken: s.spoken });
      lo = Math.max(lo, w.hi);
    }
    if (s.hi - lo >= gutter) out.push({ lo, hi: s.hi, spoken: s.spoken });
    if (s.spoken && out.length === from) return null;
    // Parted by a word in it, it is what this row says of each part.
    if (out.length - from > 1) for (let n = from; n < out.length; n++) out[n]!.spoken = false;
  }
  for (let n = 1; n < words.length; n++) {
    const a = words[n - 1]!;
    const b = words[n]!;
    if (!parted(a, b, em)) continue;
    // The stretch nearest the cell after it: the rest of a wide gap may be another row's words.
    let nearest: Stretch | undefined;
    for (const s of out) if (s.lo >= a.hi && s.hi <= b.lo) nearest = s;
    if (nearest) nearest.spoken = true;
  }
  return out;
}

/**
 * The stretches that are gutters, by what the rows say of each: a row's pair of words the file parts
 * (`parted`) speaks for the one stretch between them, or, where several lie between them, as under a
 * row that leaves a column empty, for the one the most rows speak for, then the rightmost, since the
 * cell after it stands at its edge. A row whose words merely end at a stretch only meets it. A gutter
 * is spoken for by two rows; once a table has one, also by one row that two others meet.
 */
function guttersIn(open: Stretch[], rows: { words: Word[]; em: number }[]): number[] {
  const inner = open.filter((s) => Number.isFinite(s.lo) && Number.isFinite(s.hi));
  const seen = inner.map(() => 0);
  const met = inner.map(() => 0);
  const unsure: number[][] = [];
  for (const { words, em } of rows) {
    for (let n = 1; n < words.length; n++) {
      const a = words[n - 1]!;
      const b = words[n]!;
      const between: number[] = [];
      inner.forEach((s, i) => {
        if (s.lo >= a.hi && s.hi <= b.lo) between.push(i);
      });
      if (!between.length) continue;
      if (!parted(a, b, em)) for (const i of between) met[i]!++;
      else if (between.length === 1) seen[between[0]!]!++;
      else unsure.push(between);
    }
  }
  for (const between of unsure) {
    let best = between[0]!;
    for (const i of between) if (seen[i]! >= seen[best]!) best = i;
    seen[best]!++;
  }
  const settled = seen.some((n) => n >= 2);
  return inner.flatMap((s, i) => (seen[i]! >= 2 || (settled && seen[i] === 1 && met[i]! >= 2) ? [(s.lo + s.hi) / 2] : []));
}

/** A row's words as the cell each column holds, where the cuts part them: only the columns it fills. */
function cellsAcross(words: Word[], cuts: number[], rtl: boolean): { k: number; cell: Cell; exact0: boolean; exact1: boolean }[] {
  const byColumn = new Map<number, Word[]>();
  for (const w of words) {
    const mid = (w.x0 + w.x1) / 2;
    let k = 0;
    while (k < cuts.length && mid > cuts[k]!) k++;
    const list = byColumn.get(k);
    if (list) list.push(w);
    else byColumn.set(k, [w]);
  }
  return [...byColumn]
    .sort(([a], [b]) => a - b)
    .map(([k, list]) => {
      let text = "";
      for (const [i, w] of (rtl ? list.slice().reverse() : list).entries()) text += i === 0 || w.glued ? w.text : ` ${w.text}`;
      let right = -Infinity;
      for (const w of list) right = Math.max(right, w.x1);
      const x0 = Math.max(k > 0 ? cuts[k - 1]! : -Infinity, list[0]!.x0);
      const x1 = Math.min(k < cuts.length ? cuts[k]! : Infinity, right);
      const exact0 = list[0]!.exact0;
      const exact1 = list[list.length - 1]!.exact1;
      return { k, exact0, exact1, cell: exact0 && exact1 ? { text, x0, x1 } : { text, x0, x1, rough: true } };
    });
}

/**
 * Find the tables `findTables` could not, because their columns are set closer than a gap can tell:
 * rows of cells whose gaps are no wider than the spaces between words, or whose cells a run holds
 * together, so that some rows, or all, seem to have fewer cells than they do. Their columns are the
 * stretches no row's words cover (`guttersIn`). A row the file does not part keeps to those columns
 * only where its words stand about where their columns' cells do, and it holds no more words than a
 * row's cells would, so a title above a table, or a line of text under it, stays out of it. Rows
 * whose columns cannot be found this way read a line each, as any others do.
 *
 * It replaces a table the first search found only where this one reads more of those lines, or that
 * one held two cells in one, so a table whose columns are plain to see reads as it did.
 */
function findTightTables(lines: Line[], found: Map<Table, Found>): void {
  let budget = TIGHT_BUDGET;
  const wordsAt: (Word[] | null | undefined)[] = new Array(lines.length);
  const wordsOfLine = (k: number): Word[] | null => {
    let w = wordsAt[k];
    if (w === undefined) {
      w = wordsOf(lines[k]!);
      wordsAt[k] = w;
      if (w) budget -= w.length;
    }
    return w;
  };
  const textOf = (k: number) => lines[k]!.cells.map((c) => c.text).join(" ");
  const sameSize = (a: Line, b: Line) => Math.abs(a.size - b.size) <= 0.1 * Math.max(a.size, b.size);
  /** A row the file parts by a gap somewhere. */
  const gapped = (k: number) => {
    const words = wordsOfLine(k)!;
    return words.some((w, n) => n > 0 && gapBetween(words[n - 1]!, w, lines[k]!.small));
  };
  const spokenFor = (k: number) => {
    const words = wordsOfLine(k);
    return !!words && words.some((w, n) => n > 0 && parted(words[n - 1]!, w, lines[k]!.small));
  };
  /** Whether a line could start a table: only one with two runs, or a number, has words something parts. */
  const mayStart = (k: number) => {
    const runs = lines[k]!.runs;
    return !!runs && (runs.length > 1 || (runs.length === 1 && /\d/.test(runs[0]!.text))) && spokenFor(k);
  };

  /** The lines under `from`, one under the next, that leave a stretch open that the lines so far say is a gutter. */
  const linesUnder = (from: number): { taken: number[]; open: Stretch[] } => {
    const taken = [from];
    let open = crossStretches([{ lo: -Infinity, hi: Infinity, spoken: false }], wordsOfLine(from)!, MIN_GUTTER * lines[from]!.small, lines[from]!.small)!;
    let pitch = 0;
    for (let k = from + 1; k < lines.length && taken.length < MAX_TABLE_LINES && budget > 0; k++) {
      const prev = lines[taken[taken.length - 1]!]!;
      const l = lines[k]!;
      const down = prev.y - l.y;
      if (!(down > 0 && down <= ROW_GAP * Math.max(prev.size, l.size)) || (pitch && down > ROW_SPREAD * pitch)) break;
      const words = wordsOfLine(k);
      if (!words) break;
      budget -= (open.length + 1) * (words.length + 1);
      if (!spokenFor(k) && !sameSize(prev, l)) break;
      const next = crossStretches(open, words, MIN_GUTTER * Math.min(prev.small, l.small), l.small);
      if (!next) break;
      open = next;
      taken.push(k);
      pitch = Math.max(pitch, down);
    }
    return { taken, open };
  };

  /** The lines of `taken` from the first on that keep to the columns the rows say, and any lines above them that do. */
  const settle = (taken: number[], open: Stretch[]) => {
    const em = taken.reduce((m, k) => Math.min(m, lines[k]!.small), Infinity);
    let wordCount = 0;
    for (const k of taken) wordCount += wordsOfLine(k)!.length;
    budget -= wordCount * (open.length + 1);
    let cuts = guttersIn(open, taken.map((k) => ({ words: wordsOfLine(k)!, em: lines[k]!.small })));
    const across = (k: number) => cellsAcross(wordsOfLine(k)!, cuts, lines[k]!.rtl);
    // A column one row fills alone is no column, as a number set in a wide gutter is not.
    while (cuts.length && budget > 0) {
      const fills = new Array<number>(cuts.length + 1).fill(0);
      for (const k of taken) for (const c of across(k)) fills[c.k]!++;
      budget -= wordCount * (cuts.length + 1);
      const thin = fills.findIndex((n) => n < 2);
      if (thin < 0) break;
      cuts = cuts.filter((_, n) => n !== Math.min(thin, cuts.length - 1));
    }
    if (!cuts.length || budget <= 0) return null;
    // Where the file says its columns' cells stand: a row reckoned must stand about there, and on
    // the one edge the file sets all of them on, if it does.
    const lefts: number[][] = Array.from({ length: cuts.length + 1 }, () => []);
    const rights: number[][] = Array.from({ length: cuts.length + 1 }, () => []);
    for (const k of taken) {
      for (const c of across(k)) {
        if (c.exact0) lefts[c.k]!.push(c.cell.x0);
        if (c.exact1) rights[c.k]!.push(c.cell.x1);
      }
    }
    for (const xs of [...lefts, ...rights]) xs.sort((a, b) => a - b);
    const onOneEdge = (xs: number[]) => xs.length >= 2 && xs[xs.length - 1]! - xs[0]! <= Math.max(1.5, 0.15 * em);
    const keeps = (cells: ReturnType<typeof across>) =>
      cells.every(({ k, cell }) => {
        if (!cell.rough) return true;
        const ls = lefts[k]!;
        const rs = rights[k]!;
        const nearLeft = ls.length > 0 && Math.abs(cell.x0 - ls[ls.length >> 1]!) <= ROUGH_COLUMN * em;
        const nearRight = rs.length > 0 && Math.abs(cell.x1 - rs[rs.length >> 1]!) <= ROUGH_COLUMN * em;
        if (onOneEdge(ls)) return nearLeft;
        if (onOneEdge(rs)) return nearRight;
        return (!ls.length && !rs.length) || nearLeft || nearRight;
      });
    budget -= wordCount * (cuts.length + 1);
    // How far the rows the file parts reach: a table is as wide as its cells.
    let reachRight = -Infinity;
    for (const k of taken) if (gapped(k)) for (const w of wordsOfLine(k)!) reachRight = Math.max(reachRight, w.x1);
    if (reachRight === -Infinity) reachRight = Infinity;
    const asRow = (k: number) => {
      const cells = across(k);
      const words = wordsOfLine(k)!;
      if (!gapped(k) && cells.length > 1) {
        // A title or a line of text under the table may have words that stand there by chance. A
        // row reaches no further than the table does, and one with no number to part it fills every column.
        if (endsSentence(textOf(k)) || words.length > 3 * (cuts.length + 1) || words[words.length - 1]!.x1 > reachRight + 3 * em) return null;
        if (!spokenFor(k) && cells.length <= cuts.length) return null;
      }
      return keeps(cells) ? cells : null;
    };
    const rows = new Map<number, Cell[]>();
    let singles = 0;
    for (const k of taken) {
      const cells = asRow(k);
      if (!cells || (cells.length < 2 && ++singles > 2)) break;
      if (cells.length >= 2) singles = 0;
      rows.set(k, cells.map((c) => c.cell));
    }
    // A table ends at its last row of cells.
    const kept = [...rows.keys()];
    while (kept.length && rows.get(kept[kept.length - 1]!)!.length < 2) rows.delete(kept.pop()!);
    if (!kept.length) return null;
    let widest = 0;
    for (let n = 1; n < kept.length; n++) widest = Math.max(widest, lines[kept[n - 1]!]!.y - lines[kept[n]!]!.y);
    // Above the first row the file parts, rows it does not, filling every column: a first row often is.
    const above: [number, Cell[]][] = [];
    for (let k = kept[0]! - 1; k >= 0 && above.length + kept.length < MAX_TABLE_LINES; k--) {
      const l = lines[k]!;
      const under = lines[k + 1]!;
      const down = l.y - under.y;
      if (!wordsOfLine(k) || !(down > 0 && down <= ROW_GAP * Math.max(l.size, under.size)) || (widest && down > ROW_SPREAD * widest) || !sameSize(l, under) || endsInColon(textOf(k))) break;
      budget -= (cuts.length + 1) * wordsOfLine(k)!.length;
      if (cuts.some((c) => wordsOfLine(k)!.some((w) => w.lo < c && w.hi > c))) break;
      const cells = asRow(k);
      if (!cells || cells.length <= cuts.length) break;
      above.push([k, cells.map((c) => c.cell)]);
    }
    return { rows: new Map<number, Cell[]>([...above.reverse(), ...rows]), cuts };
  };

  for (let i = 0; i < lines.length && budget > 0; ) {
    if (!mayStart(i)) {
      i++;
      continue;
    }
    const { taken, open } = linesUnder(i);
    const settled = settle(taken, open);
    if (!settled) {
      i++;
      continue;
    }
    const { rows, cuts } = settled;
    const reach = [...rows.keys()];
    const full = reach.filter((k) => rows.get(k)!.length >= 2);
    // Characters set a column apart, as text written down the page is read across, are no cells.
    let letters = 0;
    let cellCount = 0;
    for (const k of full) {
      for (const c of rows.get(k)!) {
        cellCount++;
        if (codePointLength(c.text) === 1 && !NUMERIC.test(c.text)) letters++;
      }
    }
    if (letters * 2 > cellCount) {
      i++;
      continue;
    }
    // Two rows of cells are a table only where the file parts every cell of them; three, where it parts some.
    const certain = full.length === 2 && full.every((k) => gapped(k) && !rows.get(k)!.some((c) => c.rough));
    let wraps = 0;
    for (let n = 1; n < full.length; n++) if (wrapsOnto(textOf(full[n - 1]!), textOf(full[n]!))) wraps++;
    // Lines of cells that wrap onto the next are prose, a cell's own wrapped line having one cell.
    if ((full.length < 3 && !certain) || (full.length > 1 && wraps >= Math.max(1, Math.ceil((full.length - 1) / 3)))) {
      i++;
      continue;
    }
    const taking = reach.map((k) => lines[k]!);
    const cellsByLine = new Map(reach.map((k) => [lines[k]!, rows.get(k)!] as const));
    const columns: Columns = [-Infinity, ...cuts].map((x0, k) => ({ x0, x1: k < cuts.length ? cuts[k]! : Infinity }));
    const table = tableOf(taking, columns, taking.reduce((m, l) => Math.min(m, l.small), Infinity), (l) => cellsByLine.get(l) ?? []);
    if (!table) {
      i++;
      continue;
    }
    // A table found already stays, unless this one reads all of its lines and reads them better.
    const before = new Map<Table, number>();
    for (const l of taking) if (l.table) before.set(l.table, (before.get(l.table) ?? 0) + 1);
    const wholly = [...before].every(([t, n]) => found.get(t)?.lines === n);
    let rowsBefore = 0;
    let columnsBefore = 0;
    let held = false;
    for (const t of before.keys()) {
      rowsBefore += t.rows.length;
      columnsBefore = Math.max(columnsBefore, t.rows[0]?.length ?? 0);
      held ||= found.get(t)?.bridged ?? false;
    }
    if (!before.size || (wholly && (table.rows.length > rowsBefore || held || (table.rows[0]?.length ?? 0) > columnsBefore))) for (const l of taking) l.table = table;
    i = reach[reach.length - 1]! + 1;
  }
}

/**
 * A heading is a line set clearly larger than its page's text: every run of it at least this many
 * times the size most of the page's characters are set in.
 */
const HEADING_RATIO = 1.15;
/** A heading takes at most this many lines, one under the next in one size, and this many characters. */
const MAX_HEADING_LINES = 3;
const MAX_HEADING_CHARS = 200;
/** How a large line that is prose set large ends, as a pull quote or a paragraph in large print does. */
const PROSE_END = new Set([".", ",", ";", "…", "。", "，", "；"]);
/** A line that starts with a bullet is a list item, whatever its size. */
const BULLET = /^[•◦▪▫‣⁃●○■□►▸▹▶➢➤✓✔☐☑–—*·∙-]\s/u;

/** The size most of a page's characters are set in, outside its tables: the size of its text. */
function bodySize(lines: Line[]): number | null {
  const weight = new Map<number, number>();
  for (const l of lines) {
    if (l.table) continue;
    let n = 0;
    for (const c of l.cells) n += c.text.length;
    const size = Math.round(l.size * 10) / 10;
    weight.set(size, (weight.get(size) ?? 0) + n);
  }
  let body: number | null = null;
  for (const [size, n] of weight) if (body === null || n > weight.get(body)! || (n === weight.get(body)! && size < body)) body = size;
  return body;
}

/** Whether `b` goes on the heading that `a` is a line of: just under it, in its size, across the same stretch. */
function headingGoesOn(a: Line, b: Line): boolean {
  const down = a.y - b.y;
  const em = Math.max(a.size, b.size);
  return down > 0 && down <= 2 * em && Math.abs(a.size - b.size) <= 0.05 * em && b.x0 < a.x1 && b.x1 > a.x0;
}

/** A heading a page's lines make: its words, how many lines it takes, and the size it is set in. */
interface PageHeading {
  text: string;
  lines: number;
  size: number;
}

/**
 * A page's headings, by the line each starts at: a line of one cell, outside a table, set clearly
 * larger than the page's text (`HEADING_RATIO`), with the lines just under it in its size joined to
 * it. Lines like that are a heading when they are at most `MAX_HEADING_LINES` and
 * `MAX_HEADING_CHARS` long, hold a letter, are no list item, and do not end as prose does; any
 * other run of them is read as it always was, as paragraphs.
 */
function pageHeadings(lines: Line[]): Map<number, PageHeading> {
  const out = new Map<number, PageHeading>();
  const body = bodySize(lines);
  if (body === null) return out;
  const large = (l: Line) => !l.table && l.cells.length === 1 && l.small >= HEADING_RATIO * body;
  for (let k = 0; k < lines.length; k++) {
    if (!large(lines[k]!)) continue;
    let j = k;
    while (j + 1 < lines.length && large(lines[j + 1]!) && headingGoesOn(lines[j]!, lines[j + 1]!)) j++;
    const run = lines.slice(k, j + 1);
    const text = run.map((l) => l.cells[0]!.text).join(" ").replace(/\s+/g, " ").trim();
    if (run.length <= MAX_HEADING_LINES && codePointLength(text) <= MAX_HEADING_CHARS && LETTER.test(text) && !BULLET.test(text) && !PROSE_END.has(lastMark(text)))
      out.set(k, { text, lines: run.length, size: run.reduce((m, l) => Math.max(m, l.size), 0) });
    k = j;
  }
  return out;
}

/** A line that starts with a short label and its colon (`Sample ID: S-0001`), as a form's lines do. */
function labelled(line: Line): boolean {
  const first = line.cells[0]!.text;
  if (line.cells.length > 1 && endsInColon(first)) return true;
  const colon = first.indexOf(":");
  if (colon <= 0 || colon > 40 || (colon + 1 < first.length && !isSpaceUnit(first.charCodeAt(colon + 1)))) return false;
  return first.slice(0, colon).split(" ").length <= 5;
}

/** A bullet: a list item however it goes on. */
const LIST_BULLET = /^[•◦▪▫‣⁃●○■□►▸▹▶➢➤✓✔☐☑·∙]\s/u;
/** A dash or a star, which may also be a line of prose going on: `– and the office`. */
const LIST_DASH = /^[–—*-]\s+(\P{Ll})?/u;
/** A number or letter that marks an item: `1.`, `2)`, `(3)`, `1.2.`, `1.2 Scope`, `(a)`, `b)`, `iv.`. */
const LIST_NUMBER = /^(?:\(?\d{1,3}[.)]|\(\d{1,3}\)|\d{1,3}(?:\.\d{1,3}){1,4}\.|\d{1,3}(?:\.\d{1,3}){1,4}(?=\s+\p{Lu})|\(?[A-Za-z]\)|\(?[ivxIVX]{2,5}[.)])\s/u;
/** Writing that breaks between any two characters, with no spaces to break at. */
const NO_SPACES = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** How wide a line's first word is, in the run that holds it: what would have to fit on the line above. */
function firstWordWidth(line: Line): number {
  const cell = line.cells[0]!;
  const text = cell.text;
  let end = text.indexOf(" ");
  if (end < 0) end = text.length;
  if (NO_SPACES.test(text)) end = text.codePointAt(0)! > 0xffff ? 2 : 1;
  return ((cell.x1 - cell.x0) * reckon(text.slice(0, end))) / (reckon(text) || 1);
}

/** The white space most lines in one size stand apart by, for each size. */
function usualLeading(lines: Line[], prose: boolean[]): Map<number, number> {
  const seen = new Map<number, Map<number, number>>();
  for (let k = 1; k < lines.length; k++) {
    if (!prose[k] || !prose[k - 1]) continue;
    const a = lines[k - 1]!;
    const b = lines[k]!;
    const down = a.y - b.y;
    if (down <= 0 || down > 3 * b.size || Math.abs(a.size - b.size) > 0.05 * b.size) continue;
    const size = Math.round(b.size * 10);
    const counts = seen.get(size) ?? new Map<number, number>();
    const at = Math.round(down * 2) / 2;
    counts.set(at, (counts.get(at) ?? 0) + 1);
    seen.set(size, counts);
  }
  const out = new Map<number, number>();
  for (const [size, counts] of seen) {
    let best = 0;
    let most = 0;
    for (const [at, n] of counts) if (n > most || (n === most && at < best)) [best, most] = [at, n];
    out.set(size, best);
  }
  return out;
}

/**
 * Whether a line of `lines` ends a paragraph, where it ends no sentence (the reader asks only then):
 * `item` says the paragraph so far is a list item.
 *
 * A line of a paragraph breaks where the next word no longer fits. So a line that stops short of the
 * width of its column, with room for the next line's first word, ends its paragraph, whatever it
 * ends in, and a column's width is the widest of the lines near it that start where it or the next
 * starts, in its size: a quote or a box set narrower than the text is measured by its own lines.
 * Lines that go on in lower case take more to part, as they read on: they part only where the line
 * stops well short. Lines that do not are parted by less: by white space wider than the page's lines
 * are set at, a change of size, lines too narrow to be a column, a line wider than any line near it
 * shows a column to be, or, as a table's rows whose columns could not be found do, two lines that
 * each end in a number or three that hold as many words. A line that starts a list always stands
 * apart from what came before it.
 * A line the file gives no width to says nothing, and goes on, as vertical text does.
 */
function paragraphEnds(lines: Line[]): (k: number, item: boolean) => boolean {
  const prose = lines.map((l, k) => !l.table && (l.cells.length === 1 || stretched(l, [lines[k - 1], lines[k + 1]])));
  const leading = usualLeading(lines, prose);
  const near = (l: Line) => (l.rtl ? -l.x1 : l.x0);
  const far = (l: Line) => (l.rtl ? -l.x0 : l.x1);
  /** How many words a line holds, if it is a line of prose short enough for that to say anything, ending nothing and going on from nothing. */
  const wordsIn = (k: number) => {
    const l = lines[k];
    if (!l || !prose[k] || l.cells.length !== 1) return 0;
    const text = l.cells[0]!.text;
    if (text.length > 120 || LOWER_START.test(text) || endsSentence(text) || text.endsWith(",")) return 0;
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0x20) n++;
    return n;
  };
  /** Three lines from this one with as many words, more than one, as the rows of a table are whose columns could not be found. */
  const wordsAlike = (k: number) => {
    const n = wordsIn(k);
    return n > 1 && wordsIn(k + 1) === n && wordsIn(k + 2) === n;
  };
  return (k, item) => {
    const a = lines[k]!;
    const b = lines[k + 1];
    if (!b || !prose[k] || !prose[k + 1]) return false;
    if (a.frame !== b.frame) return true;
    const widthA = far(a) - near(a);
    const start = b.cells[0]!.text;
    if (LIST_BULLET.test(start)) return true;
    const endA = a.cells[a.cells.length - 1]!.text;
    if (HYPHENS.has(endA.charAt(endA.length - 1)) && LETTER.test(start.charAt(0))) return false;
    if (widthA <= 0 || far(b) - near(b) <= 0) return false;
    const em = Math.min(a.size, b.size);
    // Only a line under this one, in its column, says how wide the column is.
    const under = near(b) < far(a) && far(b) > near(a);
    const sameSize = (l: Line, m: Line) => Math.abs(l.size - m.size) <= 0.05 * Math.max(l.size, m.size);
    const ofColumn = (l: Line) => sameSize(l, a) && (Math.abs(near(l) - near(a)) <= SAME_EDGE * em || (under && Math.abs(near(l) - near(b)) <= SAME_EDGE * em));
    let measure = under ? Math.max(far(a), far(b)) : far(a);
    let seconded = under && far(b) >= far(a) - Math.max(2 * em, 0.12 * widthA);
    for (let j = Math.max(0, k - MEASURE_WINDOW); j <= Math.min(lines.length - 1, k + 1 + MEASURE_WINDOW); j++) {
      if (j === k || j === k + 1 || !prose[j]) continue;
      const l = lines[j]!;
      if (!ofColumn(l)) continue;
      measure = Math.max(measure, far(l));
      if (far(l) >= far(a) - Math.max(2 * em, 0.12 * widthA)) seconded = true;
    }
    const roomy = far(a) + 0.25 * em + 1.25 * firstWordWidth(b) <= measure;
    const wordAfter = LIST_DASH.exec(start);
    if (wordAfter && (item || roomy || wordAfter[1])) return true;
    if (LIST_NUMBER.test(start) && (item || roomy)) return true;
    const changesSize = !sameSize(a, b);
    const narrow = measure - near(a) < NARROWEST_COLUMN * em;
    if (LOWER_START.test(start)) {
      // A large figure and the words under it that go on from it (`87%`, `of the crews`) read on.
      if (changesSize) return false;
      if (roomy && widthA < STOPS_SHORT * (measure - near(a))) return true;
      return narrow && !endA.includes(" ") && !start.includes(" ");
    }
    if (changesSize || narrow || roomy || !seconded) return true;
    const down = a.y - b.y;
    const usual = leading.get(Math.round(b.size * 10));
    if (under && usual && down > PARAGRAPH_GAP * usual) return true;
    return (endsInNumber(endA) && endsInNumber(b.cells[b.cells.length - 1]!.text)) || wordsAlike(k - 1) || wordsAlike(k);
  };
}

/** Whether a text ends in a number: read from its last few characters, as a line may be very long. */
const endsInNumber = (text: string) => /\d[\d.,%)]*$/.test(text.slice(-24));

/** Whether a text starts a list, by what any line of it says. */
const startsItem = (text: string) => LIST_BULLET.test(text) || LIST_DASH.test(text) || LIST_NUMBER.test(text);

/** How a repeated line is read: left out, or kept, where it first appears, as this text, at the top of its page or the end. */
export type Repeated = { keep: string | null; top: boolean };

/**
 * A page's blocks, after its `# Page N` heading, and the characters of text they hold. Its headings
 * are among them, each with the size it is set in, for pdf.ts to give it a level once every page is
 * read: their words for now, at level 2. It stops reading past `room` blocks: the file makes too many
 * this way. With `onlySentences`, a paragraph ends only where a sentence does, for such a file.
 */
export function pageBlocks(page: PageLayout, pageNo: number, repeated: Map<Line, Repeated>, options: { room?: number; onlySentences?: boolean } = {}): { blocks: Block[]; chars: number; tables: number; headings: { block: Block; size: number }[] } {
  const { room = Infinity, onlySentences = false } = options;
  const blocks: Block[] = [];
  const headed: { block: Block; size: number }[] = [];
  let chars = 0;
  const push = (text: string) => {
    blocks.push({ text, page: pageNo });
    chars += text.length;
  };
  let para: string[] = [];
  const flush = () => {
    const t = para.join(" ").replace(/\s+/g, " ").trim();
    if (t) push(t);
    para = [];
  };
  /** A line goes into the paragraph, which it ends if it ends a sentence, or its column shows it stops there. */
  let item = false;
  const readLine = (text: string, ends: (k: number, item: boolean) => boolean, k: number) => {
    if (!para.length) item = startsItem(text);
    para.push(text);
    if (endsSentence(text) || (!onlySentences && ends(k, item))) flush();
  };
  const tables = new Set<Table>();
  const lines = page.lines.filter((l) => !repeated.has(l));
  const headings = pageHeadings(lines);
  const endsHere = paragraphEnds(lines);
  // The lines up to this one are a heading's, already read.
  let readTo = -1;
  // A header kept reads first, whenever the stream draws it.
  for (const l of page.lines) if (repeated.get(l)?.keep && repeated.get(l)!.top) push(repeated.get(l)!.keep!);
  for (const [k, line] of lines.entries()) {
    if (k <= readTo) continue;
    if (blocks.length > room) break;
    const heading = headings.get(k);
    if (heading) {
      // A heading stands on its own, never run into the text before or after it.
      flush();
      const block: Block = { text: heading.text, heading_level: 2, page: pageNo };
      blocks.push(block);
      headed.push({ block, size: heading.size });
      chars += heading.text.length;
      readTo = k + heading.lines - 1;
      continue;
    }
    const t = line.table;
    if (t) {
      if (tables.has(t)) continue;
      tables.add(t);
      flush();
      if (t.prose) {
        // Read a column at a time, as the paragraphs its lines make, one going on into the next.
        const read = t.columnLines?.flat() ?? [];
        const ends = paragraphEnds(read);
        for (const [i, l] of read.entries()) readLine(l.cells[0]!.text, ends, i);
        flush();
      } else if (t.form) for (const r of t.rows) push(lineText(r.filter(Boolean).map((text) => ({ text }))));
      else {
        for (const b of tableBlocks(t.rows)) blocks.push({ ...b, page: pageNo });
        for (const r of t.rows) for (const c of r) chars += c.length;
      }
      continue;
    }
    const prev = lines[k - 1];
    const next = lines[k + 1];
    if (line.cells.length > 1 && !stretched(line, [prev, next])) {
      flush();
      push(lineText(line.cells));
      continue;
    }
    const text = line.cells.map((c) => c.text).join(" ");
    // A form's lines, a label and its value each, stand apart from one another.
    if (labelled(line) && [prev, next].some((n) => n !== undefined && !n.table && labelled(n))) {
      flush();
      push(text);
      continue;
    }
    readLine(text, endsHere, k);
  }
  flush();
  const turned = page.turned.filter((l) => !repeated.has(l));
  const endsTurned = paragraphEnds(turned);
  for (const [k, line] of turned.entries()) readLine(line.cells.map((c) => c.text).join(" "), endsTurned, k);
  flush();
  // A footer kept, and a stamp, read last.
  for (const l of [...page.lines, ...page.turned]) if (repeated.get(l)?.keep && !repeated.get(l)!.top) push(repeated.get(l)!.keep!);
  return { blocks, chars, tables: [...tables].filter((t) => !t.form && !t.prose).length, headings: headed };
}

/** A page number as a repeated line says it, its numbers made `#`: `#`, `page #`, `# of #`, `- # -`. */
const PAGE_NUMBER = /^(?:(?:page|pg\.?|p\.|seite|página|pagina|side|sida|blz\.?|str\.?)\s*)?[-–—([]?\s*#\s*(?:(?:of|\/|de|von|sur|di|af|av|van|z)\s*#\s*)?[-–—)\]]?$/;
/** A page number inside a longer cell: `Page 3`, `Page 3 of 12`, `3 of 12`, `3/12`. */
const PAGE_PHRASE = /\b(?:(?:page|pg\.?|p\.)\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*(?:of|\/)\s*\d+)\b/g;

/** A line longer than this is the page's text, not a header or footer. */
const MAX_REPEATED_LINE = 300;

/**
 * A line as a key for its repeats: in lower case, with its page number, the part of it that
 * changes from page to page, made `#`: a cell that is a page number (a roman numeral too), or a
 * page number inside a cell. Any other number stays, so `Week 13` and `Week 14` are not repeats.
 */
function repeatKey(cells: readonly Cell[]): string[] {
  return cells.map((c) => {
    const t = c.text.slice(0, MAX_REPEATED_LINE).toLowerCase();
    const numbered = t.replace(/\d+/g, "#");
    if (PAGE_NUMBER.test(numbered) || /^[ivxlc]{1,7}$/.test(t)) return "#";
    return t.replace(PAGE_PHRASE, "#");
  });
}

/**
 * A header or footer is set apart from the page's text by white space this many ems high at
 * least, in the smaller font of the two lines: more than a paragraph's spacing.
 */
const MARGIN_GAP = 1.5;

/**
 * The lines at a page's edge, from the top or the bottom (`down` read from that edge): at most
 * three, in the outer eighth of the page, ending where a margin's gap parts them from the lines
 * inward. None when no such gap follows them, as when the page's own text starts at its edge.
 */
function edgeLines(down: Line[], inZone: (l: Line) => boolean): Line[] {
  for (let k = 0; k < Math.min(3, down.length - 1); k++) {
    const l = down[k]!;
    const inward = down[k + 1]!;
    if (l.table || !inZone(l)) return [];
    const space = l.y > inward.y ? l.bottom - inward.top : inward.bottom - l.top;
    if (space >= MARGIN_GAP * Math.min(l.size, inward.size)) return down.slice(0, k + 1);
  }
  return [];
}

/**
 * The lines repeated in the same place on most pages: running headers and footers, page numbers,
 * a stamp up the margin. A candidate is a line at a page's top or bottom edge (`edgeLines`), or a
 * line at another angle than the page's text; it is repeated when the same words, its page number
 * aside, stand within a fiftieth of a page's height of one place on two pages at least and half
 * of them. A page number is left out wherever it is; any other repeated line is kept once, where it
 * first appears, without its page number, and left out of later pages.
 */
export function repeatedLines(pages: PageLayout[]): { lines: Map<Line, Repeated>; said: string[]; leftOut: number } {
  type Seen = { page: number; line: Line; y: number; cells: string[]; top: boolean };
  const seen = new Map<string, Seen[]>();
  const add = (zone: string, page: number, line: Line, bottom: number, height: number) => {
    let length = 0;
    for (const c of line.cells) length += c.text.length;
    if (length > MAX_REPEATED_LINE) return;
    const cells = repeatKey(line.cells);
    const key = `${zone}\n${cells.join("\n")}`;
    const list = seen.get(key) ?? [];
    if (!list.some((s) => s.page === page)) list.push({ page, line, y: (line.y - bottom) / height, cells, top: zone === "top" });
    seen.set(key, list);
  };
  pages.forEach((p, page) => {
    const height = p.top - p.bottom;
    if (height <= 0) return;
    const down = p.lines.slice().sort((a, b) => b.y - a.y);
    const top = edgeLines(down, (l) => l.y >= p.top - height / 8);
    const bottom = edgeLines(down.slice(top.length).reverse(), (l) => l.y <= p.bottom + height / 8);
    for (const line of top) add("top", page, line, p.bottom, height);
    for (const line of bottom) add("bottom", page, line, p.bottom, height);
    for (const line of p.turned) add("turned", page, line, p.bottom, height);
  });
  const lines = new Map<Line, Repeated>();
  const said: string[] = [];
  let leftOut = 0;
  for (const list of seen.values()) {
    // The place most of them share.
    const ys = list.map((s) => s.y).sort((a, b) => a - b);
    const mid = ys[Math.floor(ys.length / 2)]!;
    const here = list.filter((s) => Math.abs(s.y - mid) <= 0.02);
    if (here.length < 2 || here.length * 2 < pages.length) continue;
    here.sort((a, b) => a.page - b.page || a.line.order - b.line.order);
    const first = here[0]!;
    const words = first.line.cells.filter((_, k) => first.cells[k] !== "#");
    said.push(lineText(first.line.cells));
    for (const s of here) {
      const keep = s === first && words.length ? lineText(words) : null;
      lines.set(s.line, { keep, top: s.top });
      if (!keep) leftOut++;
    }
  }
  return { lines, said, leftOut };
}
