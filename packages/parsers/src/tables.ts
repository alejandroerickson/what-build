import type { Block } from "./types.ts";

/**
 * One block per table row, the same for every format that has tables (DOCX, HTML, Markdown): the
 * header row as `A | B`, then each row as `A: cell | B: cell` with empty cells left out, so a single
 * row can be read and cited on its own. Without a usable header (one row, or an empty header
 * cell), each row's cells are joined with " | ".
 */
export function tableBlocks(rows: string[][]): Block[] {
  if (!rows.length) return [];
  const header = rows[0]!;
  const blocks: Block[] = [];
  const headerUsable = rows.length > 1 && header.every((h) => h.trim().length > 0);
  if (!headerUsable) {
    for (const r of rows) {
      const t = r.filter(Boolean).join(" | ");
      if (t) blocks.push({ text: t });
    }
    return blocks;
  }
  blocks.push({ text: header.join(" | ") });
  for (const r of rows.slice(1)) {
    const pairs = r.map((cell, i) => (cell ? `${header[i] ?? `Column ${i + 1}`}: ${cell}` : "")).filter(Boolean);
    if (pairs.length) blocks.push({ text: pairs.join(" | ") });
  }
  return blocks;
}
