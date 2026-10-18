import { codePointLength } from "./text.ts";
import type { Block, TableRef } from "./types.ts";

/**
 * The text people read: a file's blocks laid out as one Markdown document. Headings stay headings,
 * a transcript says who spoke and when in the text itself, the cues of one turn run on as one
 * paragraph, and a table is one table rather than a block per row.
 */

/** A timed turn runs on to about this many code points; the next cue then opens a paragraph of its own. */
export const TURN_CHARS = 1200;

/** A cue time as people write it: m:ss, or h:mm:ss from an hour on. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const escapeName = (s: string) => s.replace(/[\\`*_[\]]/g, (c) => `\\${c}`);
const cell = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");

/** A table in GitHub's pipe syntax, as wide as its widest row. Rows with nothing in them are left out. */
export function tableMarkdown(t: TableRef): string {
  const rows = t.rows.filter((r) => r.some((c) => c.trim()));
  const width = Math.max(1, t.header.length, ...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(cells[i] ?? "")).join(" | ")} |`;
  return [line(t.header), `|${" --- |".repeat(width)}`, ...rows.map(line)].join("\n");
}

export function renderMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  const tables = new Set<TableRef>();
  // A timed turn being run on: its speaker ("" when the cues name none), its label and its text.
  let turn: { key: string; label: string; parts: string[]; chars: number } | null = null;
  // The speaker of the last untimed turn, so a turn's later paragraphs are not labelled again.
  let lastSpeaker: string | null = null;
  const close = () => {
    if (turn) out.push(turn.label + turn.parts.join(" "));
    turn = null;
  };
  for (const b of blocks) {
    if (b.table) {
      if (tables.has(b.table)) continue;
      tables.add(b.table);
      close();
      lastSpeaker = null;
      out.push(tableMarkdown(b.table));
      continue;
    }
    const text = b.heading_level ? b.text.replace(/\s+/g, " ").trim() : b.text.trim();
    if (!text) continue;
    if (b.heading_level) {
      close();
      lastSpeaker = null;
      out.push(text);
      continue;
    }
    const speaker = b.speaker ?? null;
    if (b.start_ms !== null && b.start_ms !== undefined) {
      const key = speaker ?? "";
      const chars = codePointLength(text);
      if (turn && turn.key === key && turn.chars < TURN_CHARS) {
        turn.parts.push(text);
        turn.chars += chars + 1;
        continue;
      }
      close();
      lastSpeaker = null;
      const label = speaker ? `**${escapeName(speaker)}** (${clock(b.start_ms)}): ` : `(${clock(b.start_ms)}) `;
      turn = { key, label, parts: [text], chars };
      continue;
    }
    close();
    if (speaker) {
      // A label before a list stands on its own line, or the list's first item would read as words.
      out.push(speaker === lastSpeaker ? text : `**${escapeName(speaker)}:**${b.opensWithList ? "  \n" : " "}${text}`);
      lastSpeaker = speaker;
      continue;
    }
    lastSpeaker = null;
    out.push(text);
  }
  close();
  return out.length ? out.join("\n\n") + "\n" : "";
}

/** A Markdown file's own text, as the readable text: line endings made plain, no byte-order mark, one closing newline. */
export function markdownAsIs(source: string): string {
  // trimEnd, not a pattern anchored at the end, which backtracks over every long run of spaces.
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trimEnd();
  return text ? text + "\n" : "";
}
