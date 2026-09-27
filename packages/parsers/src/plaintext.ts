import { looksLikeTranscript, speakerTurn } from "./speakers.ts";
import { tableBlocks } from "./tables.ts";
import { decodeText } from "./text.ts";
import type { Block, FormatParser } from "./types.ts";

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
/** A bullet (`-`, `*`, `+`) or an ordered item (`1.`, `1)`), then its text. */
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])\s+(\S.*)$/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;
const PIPE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Remove inline Markdown that is clearly markup: code-span backticks, `**strong**`, `__strong__`,
 * `*emphasis*`, `_emphasis_` and backslash escapes. Underscores and asterisks inside words
 * (snake_case, 2*3*4) are left alone, and so is everything inside a code span.
 */
export function stripInlineMarkdown(line: string): string {
  const code: string[] = [];
  let s = line.replace(/(`+)([^`]|[^`].*?[^`])\1(?!`)/g, (_m, _ticks: string, body: string) => {
    code.push(body.trim() || body);
    return `${code.length - 1}`;
  });
  s = s
    .replace(/(?<![\p{L}\p{N}\\*])\*\*(?=\S)(.+?)(?<=[^\s\\])\*\*(?![\p{L}\p{N}])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}\\_])__(?=\S)(.+?)(?<=[^\s\\])__(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}\\*])\*(?=[^\s*])(.+?)(?<=[^\s\\*])\*(?![\p{L}\p{N}*])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}\\_])_(?=[^\s_])(.+?)(?<=[^\s\\_])_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1");
  return s.replace(/(\d+)/g, (_m, i: string) => code[Number(i)] ?? "");
}

function splitPipeRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

type Line = { kind: "line"; text: string } | { kind: "code"; text: string };

/** Group fenced code blocks, and in Markdown drop blockquote markers and inline markup from other lines. */
function prepare(source: string, markdown: boolean): Line[] {
  const out: Line[] = [];
  let fence: string[] | null = null;
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (FENCE.test(line)) {
      if (fence) {
        fence.push(line);
        out.push({ kind: "code", text: fence.join("\n") });
        fence = null;
      } else fence = [line];
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    out.push({ kind: "line", text: markdown ? stripInlineMarkdown(line.replace(/^\s{0,3}(?:>\s?)+/, "")) : line });
  }
  if (fence) out.push({ kind: "code", text: fence.join("\n") });
  return out;
}

function parseText(source: string, markdown: boolean): { blocks: Block[]; facts: Record<string, number> } {
  const lines = prepare(source, markdown);
  const transcript = looksLikeTranscript(lines.filter((l) => l.kind === "line").map((l) => l.text));
  const blocks: Block[] = [];
  let para: string[] = [];
  let item: string | null = null;
  let turn: Block | null = null;
  let tables = 0;
  const flush = () => {
    if (turn) blocks.push(turn);
    turn = null;
    if (item !== null) blocks.push({ text: item.replace(/\s+/g, " ").trim() });
    item = null;
    if (para.length) blocks.push({ text: para.join(" ").replace(/\s+/g, " ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    if (cur.kind === "code") {
      flush();
      blocks.push({ text: cur.text });
      continue;
    }
    const line = cur.text;
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(HEADING);
    if (h?.[1] && h[2]) {
      flush();
      blocks.push({ text: `${h[1]} ${h[2]}`, heading_level: h[1].length });
      continue;
    }
    if (markdown && para.length === 1 && item === null && !turn && SETEXT_UNDERLINE.test(line)) {
      const level = line.trim().startsWith("=") ? 1 : 2;
      blocks.push({ text: `${"#".repeat(level)} ${para[0]}`, heading_level: level });
      para = [];
      continue;
    }
    if (markdown && THEMATIC_BREAK.test(line)) {
      flush();
      continue;
    }
    if (transcript) {
      const t = speakerTurn(line);
      if (t) {
        flush();
        turn = { text: t.text, speaker: t.speaker };
        continue;
      }
      if (turn) {
        turn.text += " " + line.trim();
        continue;
      }
    }
    const next = lines[i + 1];
    if (line.includes("|") && next?.kind === "line" && next.text.includes("|") && PIPE_SEPARATOR.test(next.text)) {
      flush();
      const rows = [splitPipeRow(line)];
      let j = i + 2;
      for (; j < lines.length; j++) {
        const row = lines[j]!;
        if (row.kind !== "line" || !row.text.trim() || !row.text.includes("|")) break;
        rows.push(splitPipeRow(row.text));
      }
      blocks.push(...tableBlocks(rows));
      tables++;
      i = j - 1;
      continue;
    }
    const li = line.match(LIST_ITEM);
    // As in CommonMark, only a bullet or an item numbered 1 can interrupt a paragraph, so a wrapped
    // line that happens to start "2019. " stays in its paragraph.
    if (li?.[1] && li[2] && (item !== null || para.length === 0 || !/^\d/.test(li[1]) || /^1[.)]$/.test(li[1]))) {
      flush();
      item = /^\d/.test(li[1]) ? `${li[1]} ${li[2]}` : li[2];
      continue;
    }
    if (item !== null) {
      item += " " + line.trim();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  const facts: Record<string, number> = {};
  if (transcript) facts["transcript_turns"] = blocks.filter((b) => b.speaker).length;
  if (tables) facts["table_count"] = tables;
  return { blocks, facts };
}

/**
 * Plain text. Paragraphs split on blank lines; ATX headings, list items and pipe-table rows become
 * their own segments. A text whose lines are mostly "Name:" turns is read as a transcript, one turn
 * per segment with its speaker.
 */
export const plaintextParser: FormatParser = {
  name: "plaintext",
  version: "4",
  parse(bytes) {
    return parseText(decodeText(bytes), false);
  },
};

/**
 * Markdown: everything plain text does, plus setext headings, blockquote markers and thematic
 * breaks dropped, and inline emphasis and code markers stripped from the text, so `**Name:** words`
 * is a speaker turn and a quote need not reproduce the markup.
 */
export const markdownParser: FormatParser = {
  name: "markdown",
  version: "1",
  parse(bytes) {
    return parseText(decodeText(bytes), true);
  },
};
