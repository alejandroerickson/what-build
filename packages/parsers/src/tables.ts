import type { Block, TableRef } from "./types.ts";

/**
 * One block per table row, the same for every format that has tables (DOCX, HTML, Markdown): the
 * header row as `A | B`, then each row as `A: cell | B: cell` with empty cells left out, so a single
 * row can be read on its own. A matrix whose top-left header cell is empty
 * (`|  | A | B |`) still labels its columns, and each row's first cell leads unlabelled as the
 * row's name: `Name | A: cell | B: cell`. Without a usable header (one row, or an empty header
 * cell after the first), each row's cells are joined with " | ". The rows of a table of two or more
 * rows share one TableRef, so the readable text lays it out as one table under its first row.
 */
export function tableBlocks(rows: string[][]): Block[] {
  if (!rows.length) return [];
  const blocks = rowBlocks(rows);
  if (rows.length > 1) {
    const table: TableRef = { header: rows[0]!, rows: rows.slice(1) };
    for (const b of blocks) b.table = table;
  }
  return blocks;
}

function rowBlocks(rows: string[][]): Block[] {
  const header = rows[0]!;
  const blocks: Block[] = [];
  const filled = (h: string | undefined) => (h ?? "").trim().length > 0;
  const headerUsable = rows.length > 1 && header.slice(1).every(filled) && header.some(filled);
  if (!headerUsable) {
    for (const r of rows) {
      const t = r.filter(Boolean).join(" | ");
      if (t) blocks.push({ text: t });
    }
    return blocks;
  }
  blocks.push({ text: header.filter(filled).join(" | ") });
  for (const r of rows.slice(1)) {
    const pairs = r
      .map((cell, i) => {
        if (!cell) return "";
        if (i === 0 && !filled(header[0])) return cell;
        return `${header[i] ?? `Column ${i + 1}`}: ${cell}`;
      })
      .filter(Boolean);
    if (pairs.length) blocks.push({ text: pairs.join(" | ") });
  }
  return blocks;
}
