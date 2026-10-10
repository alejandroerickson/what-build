import { strFromU8 } from "fflate";
import { DEFAULT_PARSE_CAP_BYTES, type Block, type FormatParser } from "./types.ts";
import { descendants, elements, first, parseXml, textOf } from "./xml.ts";
import { unzipParts } from "./zip.ts";

export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 256;
export const MAX_CHARS = 20_000_000;
export const MAX_CELL = 32_767;

/** A non-empty row of a sheet: its 1-based row number and its non-empty cells. */
export interface SheetRow {
  n: number;
  cells: { col: number; value: string; isText: boolean }[];
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function columnLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** What a labelled row shows for a header column it leaves empty, so a blank reads as data. */
export const BLANK_CELL = "(blank)";

/**
 * One block per row, shared by XLSX and CSV. The first all-text row with two or more cells in the
 * top 20 is the header; later rows render `label: value` pairs in column order, and a header column
 * the row leaves empty renders `label: (blank)`. `budget` caps the characters across every sheet of
 * one file.
 */
export function sheetRowBlocks(table: SheetRow[], prefix: (n: number) => string, budget: { chars: number }): { blocks: Block[]; truncated: boolean } {
  const headerRow = table.slice(0, 20).find((r) => r.cells.length >= 2 && r.cells.every((c) => c.isText));
  const header = new Map<number, string>();
  if (headerRow) for (const c of headerRow.cells) header.set(c.col, c.value);
  const blocks: Block[] = [];
  for (const r of table) {
    let text: string;
    if (r === headerRow) text = r.cells.map((c) => c.value).join(" | ");
    else if (headerRow && r.n > headerRow.n && !(r.cells.length === 1 && !header.has(r.cells[0]!.col))) {
      const values = new Map(r.cells.map((c) => [c.col, c.value]));
      // Blanks only in a row that fills some header column; cells off to the side stay as they are.
      const blanks = r.cells.some((c) => header.has(c.col)) ? header.keys() : [];
      const cols = [...new Set([...blanks, ...values.keys()])].sort((a, b) => a - b);
      text = cols.map((col) => `${header.get(col) ?? columnLetter(col)}: ${values.get(col) ?? BLANK_CELL}`).join(" | ");
    } else text = r.cells.map((c) => c.value).join(" | ");
    const line = prefix(r.n) + text;
    budget.chars += line.length;
    if (budget.chars > MAX_CHARS) return { blocks, truncated: true };
    blocks.push({ text: line });
  }
  return { blocks, truncated: false };
}

function formatNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

/** The built-in number formats that are dates or times (ECMA-376 18.8.30); the others are numbers. */
const BUILTIN_DATE_FORMATS: Record<number, string> = {
  14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM",
  20: "h:mm", 21: "h:mm:ss", 22: "m/d/yyyy h:mm", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0",
};

/** What a number format shows of a date serial: a date, a time of day, an elapsed time, or none. */
export interface DateFormat {
  date: boolean;
  time: boolean;
  seconds: boolean;
  elapsed: "h" | "m" | "s" | null;
}

/**
 * A format code's first section: the text before the first `;` that has an even number of quotes
 * after it. Counted in one pass, so a long code of semicolons cannot stall the parse.
 */
function firstSection(code: string): string {
  let quotesAfter = 0;
  for (let i = 0; i < code.length; i++) if (code[i] === '"') quotesAfter++;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '"') quotesAfter--;
    else if (code[i] === ";" && quotesAfter % 2 === 0) return code.slice(0, i);
  }
  return code;
}

/**
 * Read a number format code as a date format, or undefined when it shows a plain number. Only the
 * first section counts; quoted text, backslash escapes, padding (`_x`, `*x`), colours and locales
 * in brackets and AM/PM markers are ignored. `m` is a month unless it sits with hours or seconds.
 */
export function dateFormatOf(code: string): DateFormat | undefined {
  const section = firstSection(code);
  const elapsed = section.match(/\[(h+|m+|s+)\]/i)?.[1]?.[0]?.toLowerCase() as DateFormat["elapsed"] | undefined;
  const bare = section
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "")
    .replace(/\[[^\]]*\]/g, (m) => (/^\[(h+|m+|s+)\]$/i.test(m) ? m.slice(1, -1) : ""))
    .replace(/AM\/PM|A\/P/gi, "h")
    .toLowerCase();
  if (!/[dmyhs]/.test(bare) || /^general$/.test(bare.trim())) return undefined;
  const time = /[hs]/.test(bare);
  const date = /[dy]/.test(bare) || (/m/.test(bare) && !time);
  return { date, time, seconds: /s/.test(bare), elapsed: elapsed ?? null };
}

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * An Excel date serial as ISO 8601: `YYYY-MM-DD`, `YYYY-MM-DD HH:MM[:SS]`, `HH:MM[:SS]`, or an
 * elapsed `H:MM[:SS]`. The 1900 system keeps Excel's fictitious 1900-02-29 (serial 60); the 1904
 * system counts from 1904-01-01. Undefined when the serial is out of range for the format.
 */
export function formatDateSerial(serial: number, fmt: DateFormat, date1904: boolean): string | undefined {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return undefined;
  const totalSeconds = Math.round(serial * 86_400);
  const days = Math.floor(totalSeconds / 86_400);
  const secs = totalSeconds - days * 86_400;
  const hh = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  if (fmt.elapsed) {
    if (fmt.elapsed === "s") return String(totalSeconds);
    if (fmt.elapsed === "m") return `${Math.floor(totalSeconds / 60)}:${pad(ss)}`;
    return `${Math.floor(totalSeconds / 3600)}:${pad(mm)}${fmt.seconds ? `:${pad(ss)}` : ""}`;
  }
  const clock = `${pad(hh)}:${pad(mm)}${fmt.seconds ? `:${pad(ss)}` : ""}`;
  if (!fmt.date || (days < 1 && !date1904)) return fmt.time ? clock : undefined;
  let day: string;
  if (date1904) day = new Date(Date.UTC(1904, 0, 1) + days * DAY_MS).toISOString().slice(0, 10);
  else if (days === 60) day = "1900-02-29";
  else day = new Date(Date.UTC(1899, 11, days < 60 ? 31 : 30) + days * DAY_MS).toISOString().slice(0, 10);
  return fmt.time ? `${day} ${clock}` : day;
}

/** The date format of each cell style (`c/@s` indexes `cellXfs`), undefined for number styles. */
function cellDateFormats(stylesXml: Uint8Array | undefined): (DateFormat | undefined)[] {
  if (!stylesXml) return [];
  const styles = parseXml(strFromU8(stylesXml));
  const custom = new Map<number, string>();
  for (const f of descendants(styles, "numFmt")) custom.set(Number(f.attrs["numFmtId"]), f.attrs["formatCode"] ?? "");
  const xfs = descendants(styles, "cellXfs")[0];
  if (!xfs) return [];
  return elements(xfs, "xf").map((xf) => {
    const id = Number(xf.attrs["numFmtId"] ?? 0);
    const code = custom.get(id) ?? BUILTIN_DATE_FORMATS[id];
    return code === undefined ? undefined : dateFormatOf(code);
  });
}

/**
 * XLSX: a `# Sheet: <name>` heading per worksheet and one segment per non-empty row, prefixed
 * `[<Sheet>, row N]`. The first all-text row with two or more cells in the top 20 becomes the
 * header, and later rows render `label: value` pairs. A number in a date or time format renders
 * as an ISO 8601 date or time, in the workbook's 1900 or 1904 date system.
 */
export const xlsxParser: FormatParser = {
  name: "xlsx",
  version: "4",
  parse(bytes, _fileName, options = {}) {
    const files = unzipParts(
      bytes,
      (name) =>
        name === "xl/workbook.xml" ||
        name === "xl/_rels/workbook.xml.rels" ||
        name === "xl/sharedStrings.xml" ||
        name === "xl/styles.xml" ||
        /^xl\/worksheets\/[^/]+\.xml$/.test(name),
      options.maxBytes ?? DEFAULT_PARSE_CAP_BYTES,
    );
    const wb = files["xl/workbook.xml"];
    if (!wb) throw new Error("not a spreadsheet: xl/workbook.xml is missing");
    const shared: string[] = [];
    const ss = files["xl/sharedStrings.xml"];
    if (ss) for (const si of descendants(parseXml(strFromU8(ss)), "si")) shared.push(descendants(si, "t").map(textOf).join(""));
    const rels = new Map<string, string>();
    const relsXml = files["xl/_rels/workbook.xml.rels"];
    if (relsXml)
      for (const r of descendants(parseXml(strFromU8(relsXml)), "Relationship")) {
        const target = r.attrs["Target"] ?? "";
        rels.set(r.attrs["Id"] ?? "", target.startsWith("/") ? target.slice(1) : `xl/${target}`);
      }
    const workbook = parseXml(strFromU8(wb));
    const date1904 = ["1", "true"].includes(descendants(workbook, "workbookPr")[0]?.attrs["date1904"] ?? "");
    const dateFormats = cellDateFormats(files["xl/styles.xml"]);
    const sheets = descendants(workbook, "sheet").map((s, i) => ({
      name: s.attrs["name"] ?? `Sheet${i + 1}`,
      path: rels.get(s.attrs["r:id"] ?? "") ?? `xl/worksheets/sheet${i + 1}.xml`,
    }));
    const blocks: Block[] = [];
    let rowCount = 0;
    const budget = { chars: 0 };
    const truncatedSheets: string[] = [];
    for (const sheet of sheets) {
      const xml = files[sheet.path];
      if (!xml) continue;
      blocks.push({ text: `# Sheet: ${sheet.name}`, heading_level: 1 });
      const rows = descendants(parseXml(strFromU8(xml)), "row");
      const table: SheetRow[] = [];
      let truncated = false;
      for (const row of rows) {
        if (table.length >= MAX_ROWS) {
          truncated = true;
          break;
        }
        const n = Number(row.attrs["r"] ?? table.length + 1);
        const cells: { col: number; value: string; isText: boolean }[] = [];
        for (const c of elements(row, "c")) {
          const col = columnIndex(c.attrs["r"] ?? "A");
          if (col >= MAX_COLUMNS) {
            truncated = true;
            continue;
          }
          const t = c.attrs["t"];
          const v = first(c, "v");
          let value = "";
          let isText = false;
          if (t === "s") {
            value = shared[Number(v ? textOf(v) : -1)] ?? "";
            isText = true;
          } else if (t === "inlineStr") {
            value = descendants(c, "t").map(textOf).join("");
            isText = true;
          } else if (t === "str") {
            value = v ? textOf(v) : "";
            isText = true;
          } else if (t === "b") {
            value = v && textOf(v) === "1" ? "TRUE" : "FALSE";
          } else if (t === "e") {
            value = v ? textOf(v) : "";
          } else if (v) {
            const fmt = dateFormats[Number(c.attrs["s"] ?? 0)];
            value = (fmt && formatDateSerial(Number(textOf(v)), fmt, date1904)) || formatNumber(textOf(v));
          }
          value = value.replace(/\s+/g, " ").trim().slice(0, MAX_CELL);
          if (value) cells.push({ col, value, isText });
        }
        if (cells.length) table.push({ n, cells });
      }
      const out = sheetRowBlocks(table, (n) => `[${sheet.name}, row ${n}] `, budget);
      for (const b of out.blocks) blocks.push(b);
      rowCount += out.blocks.length;
      if (truncated || out.truncated) truncatedSheets.push(sheet.name);
    }
    return {
      blocks,
      facts: {
        sheet_count: sheets.length,
        row_count: rowCount,
        truncated: truncatedSheets.length > 0,
        truncated_sheets: truncatedSheets,
      },
    };
  },
};
