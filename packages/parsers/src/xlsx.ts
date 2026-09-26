import { strFromU8, unzipSync } from "fflate";
import type { Block, FormatParser } from "./types.ts";
import { descendants, elements, first, parseXml, textOf } from "./xml.ts";

const MAX_ROWS = 50_000;
const MAX_COLUMNS = 256;
const MAX_CHARS = 20_000_000;
const MAX_CELL = 32_767;

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

function formatNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

/**
 * XLSX: a `# Sheet: <name>` heading per worksheet and one segment per non-empty row, prefixed
 * `[<Sheet>, row N]`. The first all-text row with two or more cells in the top 20 becomes the
 * header, and later rows render `label: value` pairs.
 */
export const xlsxParser: FormatParser = {
  name: "xlsx",
  version: "1",
  parse(bytes) {
    const files = unzipSync(bytes, {
      filter: (f) =>
        f.name === "xl/workbook.xml" ||
        f.name === "xl/_rels/workbook.xml.rels" ||
        f.name === "xl/sharedStrings.xml" ||
        /^xl\/worksheets\/[^/]+\.xml$/.test(f.name),
    });
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
    const sheets = descendants(parseXml(strFromU8(wb)), "sheet").map((s, i) => ({
      name: s.attrs["name"] ?? `Sheet${i + 1}`,
      path: rels.get(s.attrs["r:id"] ?? "") ?? `xl/worksheets/sheet${i + 1}.xml`,
    }));
    const blocks: Block[] = [];
    let rowCount = 0;
    let chars = 0;
    const truncatedSheets: string[] = [];
    for (const sheet of sheets) {
      const xml = files[sheet.path];
      if (!xml) continue;
      blocks.push({ text: `# Sheet: ${sheet.name}`, heading_level: 1 });
      const rows = descendants(parseXml(strFromU8(xml)), "row");
      const table: { n: number; cells: { col: number; value: string; isText: boolean }[] }[] = [];
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
            value = formatNumber(textOf(v));
          }
          value = value.replace(/\s+/g, " ").trim().slice(0, MAX_CELL);
          if (value) cells.push({ col, value, isText });
        }
        if (cells.length) table.push({ n, cells });
      }
      const headerRow = table.slice(0, 20).find((r) => r.cells.length >= 2 && r.cells.every((c) => c.isText));
      const header = new Map<number, string>();
      if (headerRow) for (const c of headerRow.cells) header.set(c.col, c.value);
      for (const r of table) {
        let text: string;
        if (r === headerRow) text = r.cells.map((c) => c.value).join(" | ");
        else if (headerRow && r.n > headerRow.n && !(r.cells.length === 1 && !header.has(r.cells[0]!.col)))
          text = r.cells.map((c) => `${header.get(c.col) ?? columnLetter(c.col)}: ${c.value}`).join(" | ");
        else text = r.cells.map((c) => c.value).join(" | ");
        const line = `[${sheet.name}, row ${r.n}] ${text}`;
        chars += line.length;
        if (chars > MAX_CHARS) {
          truncated = true;
          break;
        }
        blocks.push({ text: line });
        rowCount++;
      }
      if (truncated) truncatedSheets.push(sheet.name);
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
