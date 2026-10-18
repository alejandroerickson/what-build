import { strFromU8 } from "fflate";
import { builtinFormat, formatNumber, formatText, generalNumber, readFormat, type NumberFormat } from "./numfmt.ts";
import { DEFAULT_PARSE_CAP_BYTES, type Block, type FormatParser, type TableRef } from "./types.ts";
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
  /** A row the sheet hides: read, and said to be hidden. */
  hidden?: boolean;
}

/** Said after a hidden sheet's name, a hidden column's label and a hidden row's number. */
export const HIDDEN = "(hidden)";

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
 * one file. The rows from the header on share one TableRef, so the readable text lays them out as
 * one table, its first column the sheet's row number; rows above the header stay paragraphs. A
 * hidden column's label, a hidden row's number and a hidden column's cells above the header say so.
 */
export function sheetRowBlocks(
  table: SheetRow[],
  prefix: (n: number, hidden: boolean) => string,
  budget: { chars: number },
  hiddenColumns: ReadonlySet<number> = new Set(),
): { blocks: Block[]; truncated: boolean } {
  const headerRow = table.slice(0, 20).find((r) => r.cells.length >= 2 && r.cells.every((c) => c.isText));
  const header = new Map<number, string>();
  if (headerRow) for (const c of headerRow.cells) header.set(c.col, c.value);
  const hidden = (col: number) => (hiddenColumns.has(col) ? ` ${HIDDEN}` : "");
  const label = (col: number) => (header.get(col) ?? columnLetter(col)) + hidden(col);
  const start = headerRow ? table.indexOf(headerRow) : 0;
  const cols = [...new Set(table.slice(start).flatMap((r) => r.cells.map((c) => c.col)))].sort((a, b) => a - b);
  const ref: TableRef = { header: ["Row", ...cols.map(label)], rows: [] };
  const blocks: Block[] = [];
  for (const [i, r] of table.entries()) {
    let text: string;
    if (r === headerRow) text = r.cells.map((c) => label(c.col)).join(" | ");
    else if (headerRow && r.n > headerRow.n && !(r.cells.length === 1 && !header.has(r.cells[0]!.col))) {
      const values = new Map(r.cells.map((c) => [c.col, c.value]));
      // Blanks only in a row that fills some header column; cells off to the side stay as they are.
      const blanks = r.cells.some((c) => header.has(c.col)) ? header.keys() : [];
      const cols = [...new Set([...blanks, ...values.keys()])].sort((a, b) => a - b);
      text = cols.map((col) => `${label(col)}: ${values.get(col) ?? BLANK_CELL}`).join(" | ");
    } else text = r.cells.map((c) => c.value + hidden(c.col)).join(" | ");
    const line = prefix(r.n, Boolean(r.hidden)) + text;
    budget.chars += line.length;
    if (budget.chars > MAX_CHARS) return { blocks, truncated: true };
    if (i < start) {
      blocks.push({ text: line });
      continue;
    }
    if (r !== headerRow) {
      const values = new Map(r.cells.map((c) => [c.col, c.value]));
      ref.rows.push([r.hidden ? `${r.n} ${HIDDEN}` : String(r.n), ...cols.map((c) => values.get(c) ?? "")]);
    }
    blocks.push({ text: line, table: ref });
  }
  return { blocks, truncated: false };
}

/** Each cell style's number format (`c/@s` indexes `cellXfs`); undefined for General. */
function cellFormats(stylesXml: Uint8Array | undefined): (NumberFormat | undefined)[] {
  if (!stylesXml) return [];
  const styles = parseXml(strFromU8(stylesXml));
  const custom = new Map<number, string>();
  for (const f of descendants(styles, "numFmt")) custom.set(Number(f.attrs["numFmtId"]), f.attrs["formatCode"] ?? "");
  const xfs = descendants(styles, "cellXfs")[0];
  if (!xfs) return [];
  // Read once per format, however many styles share it.
  const read = new Map<number, NumberFormat | undefined>();
  return elements(xfs, "xf").map((xf) => {
    const id = Number(xf.attrs["numFmtId"] ?? 0);
    if (!read.has(id)) {
      const code = custom.get(id);
      read.set(id, id === 0 && code === undefined ? undefined : code !== undefined ? readFormat(code) : builtinFormat(id));
    }
    return read.get(id);
  });
}

const isTrue = (v: string | undefined) => v === "1" || v === "true";

/**
 * The columns a worksheet hides (`<col hidden="1">`, or a width of 0), as indexes from 0. Only the
 * columns read count, so a range over the whole sheet costs no more than they do.
 */
function hiddenColumnsOf(sheet: ReturnType<typeof parseXml>): Set<number> {
  const out = new Set<number>();
  for (const col of descendants(sheet, "col")) {
    const width = col.attrs["width"];
    if (!isTrue(col.attrs["hidden"]) && !(width !== undefined && Number(width) === 0)) continue;
    const min = Math.max(1, Number(col.attrs["min"] ?? 1));
    const max = Math.min(MAX_COLUMNS, Number(col.attrs["max"] ?? min));
    for (let c = min; c <= max; c++) out.add(c - 1);
  }
  return out;
}

/**
 * XLSX: a `# Sheet: <name>` heading per worksheet and one segment per non-empty row, prefixed
 * `[<Sheet>, row N]`. The first all-text row with two or more cells in the top 20 becomes the
 * header, and later rows render `label: value` pairs. Each value reads as the sheet shows it,
 * through its cell's number format (numfmt.ts); a hidden sheet, column or row is read and says it is
 * hidden; and a formula saved without its value says so instead of reading as 0.
 */
export const xlsxParser: FormatParser = {
  name: "xlsx",
  version: "6",
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
    const date1904 = isTrue(descendants(workbook, "workbookPr")[0]?.attrs["date1904"]);
    const formats = cellFormats(files["xl/styles.xml"]);
    const sheets = descendants(workbook, "sheet").map((s, i) => ({
      name: s.attrs["name"] ?? `Sheet${i + 1}`,
      path: rels.get(s.attrs["r:id"] ?? "") ?? `xl/worksheets/sheet${i + 1}.xml`,
      hidden: s.attrs["state"] === "hidden" || s.attrs["state"] === "veryHidden",
    }));
    const blocks: Block[] = [];
    let rowCount = 0;
    const budget = { chars: 0 };
    const truncatedSheets: string[] = [];
    let hiddenRows = 0;
    let hiddenColumns = 0;
    let unsaved = 0;
    for (const sheet of sheets) {
      const xml = files[sheet.path];
      if (!xml) continue;
      blocks.push({ text: `# Sheet: ${sheet.name}${sheet.hidden ? ` ${HIDDEN}` : ""}`, heading_level: 1 });
      const root = parseXml(strFromU8(xml));
      const hiddenCols = hiddenColumnsOf(root);
      const usedHidden = new Set<number>();
      const table: SheetRow[] = [];
      let truncated = false;
      for (const row of descendants(root, "row")) {
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
          const raw = v ? textOf(v) : "";
          const f = first(c, "f");
          const fmt = formats[Number(c.attrs["s"] ?? 0)];
          let value = "";
          let isText = false;
          if (f && !raw && t !== "str" && t !== "inlineStr") {
            // A formula the file holds without its value, as libraries that never calculate write it:
            // its formula, said to have no value, rather than a 0 nobody calculated.
            const formula = textOf(f).replace(/\s+/g, " ").trim();
            value = formula ? `=${formula} (no stored value)` : "(a formula with no stored value)";
            unsaved++;
          } else if (t === "s") {
            value = shared[Number(v ? raw : -1)] ?? "";
            isText = true;
          } else if (t === "inlineStr") {
            value = descendants(c, "t").map(textOf).join("");
            isText = true;
          } else if (t === "str") {
            value = raw;
            isText = true;
          } else if (t === "b") {
            value = raw === "1" ? "TRUE" : "FALSE";
          } else if (t === "e" || t === "d") {
            value = raw;
          } else if (v) {
            const num = Number(raw);
            value = !raw.trim() || !Number.isFinite(num) ? raw : ((fmt && formatNumber(fmt, num, date1904)) ?? generalNumber(num));
          }
          if (isText && fmt && value) value = formatText(fmt, value);
          value = value.replace(/\s+/g, " ").trim().slice(0, MAX_CELL);
          if (!value) continue;
          cells.push({ col, value, isText });
          if (hiddenCols.has(col)) usedHidden.add(col);
        }
        if (!cells.length) continue;
        const hidden = isTrue(row.attrs["hidden"]);
        table.push({ n, cells, ...(hidden ? { hidden } : {}) });
        if (hidden) hiddenRows++;
      }
      hiddenColumns += usedHidden.size;
      const out = sheetRowBlocks(table, (n, hidden) => `[${sheet.name}, row ${n}${hidden ? ", hidden" : ""}] `, budget, hiddenCols);
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
        hidden_sheets: sheets.filter((s) => s.hidden).map((s) => s.name),
        hidden_rows: hiddenRows,
        hidden_columns: hiddenColumns,
        formulas_without_values: unsaved,
      },
    };
  },
};
