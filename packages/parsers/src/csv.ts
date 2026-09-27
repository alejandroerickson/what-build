import { decodeText } from "./text.ts";
import type { FormatParser } from "./types.ts";
import { MAX_CELL, MAX_COLUMNS, MAX_ROWS, sheetRowBlocks, type SheetRow } from "./xlsx.ts";

/** The delimiter of a delimited text: tab, semicolon or comma, whichever the first line uses most. */
function sniffDelimiter(source: string, fileName: string): string {
  if (fileName.toLowerCase().endsWith(".tsv")) return "\t";
  const firstLine = source.split("\n", 1)[0]!.replace(/"[^"]*"/g, "");
  const count = (d: string) => firstLine.split(d).length - 1;
  const best = ["\t", ";", ","].reduce((a, b) => (count(b) > count(a) ? b : a), ",");
  return count(best) > 0 ? best : ",";
}

/** RFC 4180 records: quoted fields may hold the delimiter, doubled quotes and line breaks. */
function* records(source: string, delimiter: string): Generator<string[]> {
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      yield row;
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    yield row;
  }
}

const isNumeric = (v: string) => /^[-+]?(\d+([.,]\d+)?|\.\d+)([eE][-+]?\d+)?%?$/.test(v);

/**
 * CSV and TSV, read like a one-sheet workbook: one segment per non-empty row, prefixed
 * `[row N]`, with the same header detection and `label: value` pairs as XLSX.
 */
export const csvParser: FormatParser = {
  name: "csv",
  version: "1",
  parse(bytes, fileName) {
    const source = decodeText(bytes);
    const delimiter = sniffDelimiter(source, fileName);
    const table: SheetRow[] = [];
    let truncated = false;
    let n = 0;
    for (const fields of records(source, delimiter)) {
      n++;
      if (table.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
      if (fields.length > MAX_COLUMNS) truncated = true;
      const cells = fields
        .slice(0, MAX_COLUMNS)
        .map((raw, col) => {
          const value = raw.replace(/\s+/g, " ").trim().slice(0, MAX_CELL);
          return { col, value, isText: !isNumeric(value) };
        })
        .filter((c) => c.value);
      if (cells.length) table.push({ n, cells });
    }
    const out = sheetRowBlocks(table, (row) => `[row ${row}] `, { chars: 0 });
    return {
      blocks: out.blocks,
      facts: { row_count: out.blocks.length, column_delimiter: delimiter === "\t" ? "tab" : delimiter, truncated: truncated || out.truncated },
    };
  },
};
