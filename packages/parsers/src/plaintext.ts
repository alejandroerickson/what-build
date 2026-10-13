import { labelledSpeakers, looksLikeTranscript, speakerLabel, speakerTurn } from "./speakers.ts";
import { tableBlocks } from "./tables.ts";
import { decodeText } from "./text.ts";
import type { Block, FormatParser } from "./types.ts";

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
const isSpace = (ch: string) => /\s/.test(ch);

/**
 * An ATX heading's marker and text, exactly as `/^(#{1,6})\s+(.+?)\s*#*\s*$/` reads them, in one
 * pass: that pattern backtracks in cubic time on a long line of spaces, so a few kilobytes could
 * stall the parse for minutes.
 */
export function atxHeading(line: string): [marker: string, text: string] | null {
  const lead = /^(#{1,6})\s/.exec(line);
  if (!lead?.[1]) return null;
  const k = lead[1].length;
  let w = k;
  while (w < line.length && isSpace(line[w]!)) w++;
  // Where the optional closing sequence (spaces, #s, spaces) begins, read from the end.
  let m = line.length;
  while (m > w && isSpace(line[m - 1]!)) m--;
  while (m > w && line[m - 1] === "#") m--;
  while (m > w && isSpace(line[m - 1]!)) m--;
  if (m > w) {
    const text = line.slice(w, m);
    return LINE_TERMINATOR.test(text) ? null : [lead[1], text];
  }
  // Nothing but a closing sequence after the spaces: the pattern takes its first character, or
  // with nothing after the spaces, the last space it can.
  if (w < line.length) return [lead[1], line[w]!];
  for (let j = w - 1; j > k; j--) if (!LINE_TERMINATOR.test(line[j]!)) return [lead[1], line[j]!];
  return null;
}

const FENCE = /^\s*(```|~~~)/;
/** A bullet (`-`, `*`, `+`) or an ordered item (`1.`, `1)`), then its text. */
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])\s+(\S.*)$/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;
const PIPE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u;
const SPACE = /^\s$/u;
const isLetterOrNumber = (cp: number) => cp >= 0 && LETTER_OR_NUMBER.test(String.fromCodePoint(cp));
const isSpaceCodePoint = (cp: number) => cp >= 0 && SPACE.test(String.fromCodePoint(cp));
const isLineTerminator = (c: number) => c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
const BACKTICK = 0x60;

/** The code point that ends at `i`, or -1 at the start. */
function codePointBefore(s: string, i: number): number {
  if (i <= 0) return -1;
  const lo = s.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = s.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return (hi - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
  }
  return lo;
}

/** The code point that starts at `i`, or -1 at the end. */
const codePointAfter = (s: string, i: number) => (i < s.length ? s.codePointAt(i)! : -1);

/**
 * What `line.replace(/(`+)([^`]|[^`].*?[^`])\1(?!`)/g, span)` returns, in one pass. The pattern
 * backtracks in quadratic time over a long run of backticks. A span opens at any backtick, with
 * every backtick that follows it in its run, and closes at the first later run of exactly as many
 * backticks; between them, only the first and last character may end a line.
 */
export function replaceCodeSpans(line: string, span: (body: string) => string): string {
  if (!line.includes("`")) return line;
  // Every run of backticks, by length: where each starts, in order.
  const runs = new Map<number, number[]>();
  for (let i = 0; i < line.length; ) {
    if (line.charCodeAt(i) !== BACKTICK) {
      i++;
      continue;
    }
    let j = i;
    while (j < line.length && line.charCodeAt(j) === BACKTICK) j++;
    const starts = runs.get(j - i) ?? [];
    starts.push(i);
    runs.set(j - i, starts);
    i = j;
  }
  /** The first start in the sorted list at or after `from`. */
  const firstFrom = (starts: number[], from: number) => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid]! < from) lo = mid + 1;
      else hi = mid;
    }
    return starts[lo];
  };
  let out = "";
  let last = 0;
  let lineEnd = -1; // the first line terminator at or after some position, found once and kept
  let open = -1; // where the run of backticks holding `i` ends, found once for the whole run
  for (let i = line.indexOf("`"); i !== -1; ) {
    if (i >= open) for (open = i; open < line.length && line.charCodeAt(open) === BACKTICK; ) open++;
    const ticks = open - i;
    if (open < line.length) {
      if (lineEnd !== line.length && lineEnd < open + 1) {
        lineEnd = open + 1;
        while (lineEnd < line.length && !isLineTerminator(line.charCodeAt(lineEnd))) lineEnd++;
      }
      const close = firstFrom(runs.get(ticks) ?? [], open + 1);
      if (close !== undefined && close <= lineEnd + 1) {
        out += line.slice(last, i) + span(line.slice(open, close));
        last = close + ticks;
        i = line.indexOf("`", last);
        continue;
      }
    }
    i = line.indexOf("`", i + 1);
  }
  return last === 0 ? line : out + line.slice(last);
}

/**
 * What each of the four emphasis patterns in `stripInlineMarkdown`'s regex form returns, in one
 * pass: those patterns backtrack in quadratic time over a long line of marks that never close. A
 * mark opens where the pattern's look-behind and look-ahead allow, and closes at the first later
 * mark whose own look-behind and look-ahead allow, with no line terminator between.
 */
function stripEmphasis(line: string, mark: "*" | "_", double: boolean): string {
  const code = mark.charCodeAt(0);
  const width = double ? 2 : 1;
  const at = (i: number) => line.charCodeAt(i) === code && (!double || line.charCodeAt(i + 1) === code);
  const opens = (i: number) => {
    const before = codePointBefore(line, i);
    if (isLetterOrNumber(before) || before === 0x5c || before === code) return false;
    const after = codePointAfter(line, i + width);
    return after >= 0 && !isSpaceCodePoint(after) && (double || after !== code);
  };
  const closes = (i: number) => {
    const before = codePointBefore(line, i);
    if (isSpaceCodePoint(before) || before === 0x5c || (!double && before === code)) return false;
    const after = codePointAfter(line, i + width);
    return !(isLetterOrNumber(after) || ((mark === "_" || !double) && after === code));
  };
  const closers: number[] = [];
  const breaks: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (isLineTerminator(line.charCodeAt(i))) breaks.push(i);
    else if (at(i) && closes(i)) closers.push(i);
  }
  if (!closers.length) return line;
  let out = "";
  let last = 0;
  let c = 0;
  let b = 0;
  for (let i = line.indexOf(double ? mark + mark : mark); i !== -1; ) {
    if (opens(i)) {
      // The emphasised text is at least one character, and none of it ends a line.
      while (c < closers.length && closers[c]! < i + width + 1) c++;
      while (b < breaks.length && breaks[b]! < i + width) b++;
      const close = closers[c];
      if (close !== undefined && (b === breaks.length || breaks[b]! >= close)) {
        out += line.slice(last, i) + line.slice(i + width, close);
        last = close + width;
        i = line.indexOf(double ? mark + mark : mark, last);
        continue;
      }
    }
    i = line.indexOf(double ? mark + mark : mark, i + 1);
  }
  return last === 0 ? line : out + line.slice(last);
}

/**
 * Remove inline Markdown that is clearly markup: code-span backticks, `**strong**`, `__strong__`,
 * `*emphasis*`, `_emphasis_` and backslash escapes. Underscores and asterisks inside words
 * (snake_case, 2*3*4) are left alone, and so is everything inside a code span. It returns what
 * these patterns, applied in this order, return, in linear time:
 *
 *     /(`+)([^`]|[^`].*?[^`])\1(?!`)/g
 *     /(?<![\p{L}\p{N}\\*])\*\*(?=\S)(.+?)(?<=[^\s\\])\*\*(?![\p{L}\p{N}])/gu
 *     /(?<![\p{L}\p{N}\\_])__(?=\S)(.+?)(?<=[^\s\\])__(?![\p{L}\p{N}_])/gu
 *     /(?<![\p{L}\p{N}\\*])\*(?=[^\s*])(.+?)(?<=[^\s\\*])\*(?![\p{L}\p{N}*])/gu
 *     /(?<![\p{L}\p{N}\\_])_(?=[^\s_])(.+?)(?<=[^\s\\_])_(?![\p{L}\p{N}_])/gu
 */
export function stripInlineMarkdown(line: string): string {
  const code: string[] = [];
  let s = replaceCodeSpans(line, (body) => {
    code.push(body.trim() || body);
    return `${code.length - 1}`;
  });
  s = stripEmphasis(s, "*", true);
  s = stripEmphasis(s, "_", true);
  s = stripEmphasis(s, "*", false);
  s = stripEmphasis(s, "_", false);
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, "$1");
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
    // trimEnd, not /\s+$/: that pattern takes quadratic time on a long run of inner spaces.
    const line = raw.trimEnd();
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
  const texts = lines.filter((l) => l.kind === "line").map((l) => l.text);
  // In a transcript of timed labels, a "Name: words" line is a turn only when the name is one of its speakers.
  const labelled = looksLikeTranscript(texts) ? null : labelledSpeakers(texts);
  const transcript = Boolean(labelled) || looksLikeTranscript(texts);
  const blocks: Block[] = [];
  let para: string[] = [];
  let item: string | null = null;
  let turn: Block | null = null;
  // Who is speaking after a timed label on a line of its own: every paragraph and list item until
  // the next label, turn, heading or break.
  let voice: string | null = null;
  let tables = 0;
  const flush = () => {
    if (turn) blocks.push(turn);
    turn = null;
    const said = voice ? { speaker: voice } : {};
    if (item !== null) blocks.push({ text: item.replace(/\s+/g, " ").trim(), ...said });
    item = null;
    if (para.length) blocks.push({ text: para.join(" ").replace(/\s+/g, " "), ...said });
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
    const h = atxHeading(line);
    if (h?.[0] && h[1]) {
      flush();
      voice = null;
      blocks.push({ text: `${h[0]} ${h[1]}`, heading_level: h[0].length });
      continue;
    }
    if (markdown && para.length === 1 && item === null && !turn && SETEXT_UNDERLINE.test(line)) {
      voice = null;
      const level = line.trim().startsWith("=") ? 1 : 2;
      blocks.push({ text: `${"#".repeat(level)} ${para[0]}`, heading_level: level });
      para = [];
      continue;
    }
    if (markdown && THEMATIC_BREAK.test(line)) {
      flush();
      voice = null;
      continue;
    }
    if (transcript) {
      const label = speakerLabel(line);
      if (label) {
        flush();
        voice = label;
        continue;
      }
      const t = speakerTurn(line);
      if (t && (!labelled || labelled.has(t.speaker.toLowerCase()))) {
        flush();
        voice = null;
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
      for (const b of tableBlocks(rows)) blocks.push(b);
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
 * per segment with its speaker. So is one whose turns start with a timed label on a line of their
 * own, "Dana (14:02):", each paragraph below a label being a segment with that speaker.
 */
export const plaintextParser: FormatParser = {
  name: "plaintext",
  version: "6",
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
  version: "3",
  parse(bytes) {
    return parseText(decodeText(bytes), true);
  },
};
