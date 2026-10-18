import { labelledSpeakers, looksLikeTranscript, speakerLabel, speakerTurn } from "./speakers.ts";
import { tableBlocks } from "./tables.ts";
import { markdownAsIs } from "./markdown.ts";
import { codePointLength, decodeText } from "./text.ts";
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

/**
 * A bullet as plain-text authors write one, then its text: Markdown's own (`-`, `*`, `+`), the
 * typographic ones (`•`, `–` and their kin), a check box, and the `o` and `§` that Word's lower list
 * levels become when pasted as text (`o` only before a tab, so "o well" is not a list).
 */
const BULLET = /^(?:([-*+•◦‣⁃▪▫●○■□–—·∙§➢➤►▶→✓✔☐☑☒✗✘])[ \t]+|(o)\t[ \t]*)(?=\S)/u;
/** A numbered item, `1.` or `1)`, then its text. */
const ORDERED = /^(\d{1,9})([.)])[ \t]+(?=\S)/;
/** A line that is only a run of `-` or `=`: under a line of text Markdown would make that line a heading. */
const UNDERLINE = /^\s*(?:-+|=+)\s*$/;
/** A marker alone on its line, which Markdown would read as an empty list item or heading. */
const BARE_MARKER = /^(?:[-*+]|\d{1,9}[.)]|#{1,6})$/;
/** Characters that may close a sentence after its last mark: quotes and brackets. */
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "}", "»"]);
/** Marks that end a sentence, or a line that introduces the next (`Attendees:`). */
const SENTENCE_END = new Set([".", "!", "?", ":", "…", "。", "！", "？", "："]);
/** Marks that end a sentence, and not a line that introduces the next. */
const FULL_STOP = new Set([".", "!", "?", "…", "。", "！", "？"]);
/** A sentence's end, then the capital that starts the next, on one line or across a break. */
const SENTENCE_BREAK = /[.!?…]["'”’)\]}»]*\s+["'“‘(\[]*\p{Lu}/u;
const LOWERCASE_START = /^\p{Ll}/u;
/** A word in lower case and its colon at a line's start (`warning:`, `note:`): a line of its own, as in a log. */
const LABEL_START = /^\p{Ll}[\p{L}\p{N}_-]*:(?:\s|$)/u;

/**
 * A paragraph narrower than this is never taken for hard-wrapped prose: short lines are lists,
 * names and notes, whatever case they start in.
 */
export const WRAP_MIN_WIDTH = 40;

/**
 * Lists nest at most this deep; a deeper item is laid out at the deepest level, so a file of ever
 * deeper items cannot make a text that a Markdown reader has to descend into level by level.
 */
export const MAX_LIST_DEPTH = 8;

function indentWidth(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

function endsSentence(line: string, marks: ReadonlySet<string> = SENTENCE_END): boolean {
  let i = line.length - 1;
  while (i >= 0 && CLOSERS.has(line[i]!)) i--;
  return i >= 0 && marks.has(line[i]!);
}

function firstWordLength(line: string): number {
  let end = 0;
  while (end < line.length && line[end] !== " " && line[end] !== "\t") end++;
  return codePointLength(line.slice(0, end));
}

/**
 * Whether the break between two lines of a paragraph only wraps a sentence onto the next line, as a
 * text wrapped to a width does: the first line does not end a sentence, the next starts in lower
 * case and not with a label (`warning: …`), and its first word would not have fitted on the first
 * line within the paragraph's width.
 */
export function wraps(line: string, next: string, width: number): boolean {
  if (width < WRAP_MIN_WIDTH || !LOWERCASE_START.test(next) || LABEL_START.test(next) || endsSentence(line)) return false;
  return codePointLength(line) + 1 + firstWordLength(next) > width;
}

/** One line of a laid-out paragraph: a line of text, a Markdown list item, or a line inside one. */
interface LaidLine {
  kind: "line" | "item" | "inside";
  text: string;
  /** The spaces before it in the readable text: a nested item's, or a line inside an item. */
  indent: number;
  /**
   * A line of text after a Markdown list or a quote (`> …`), which a blank line must close, or
   * Markdown would read the line into the list's last item or the quote.
   */
  closes?: boolean;
  /**
   * An item that opens a list under a line ending in a colon, set apart from that line by a blank
   * line: Markdown lets only a list numbered 1 interrupt a paragraph, so a list from 3 would
   * otherwise read on as the line's paragraph.
   */
  opensList?: boolean;
}

const isQuote = (line: string) => line.startsWith(">");

const COLONS = new Set([":", "："]);

/**
 * Whether the numbered line `at` goes on to the next, numbered one more with the same mark (`3.`
 * then `4.`): a list, which Markdown numbers as written, not a line that starts with a year.
 */
function numbersOn(lines: { trimmed: string }[], at: number, numbered: RegExpExecArray): boolean {
  const next = ORDERED.exec(lines[at + 1]?.trimmed ?? "");
  return next !== null && Number(next[1]) === Number(numbered[1]) + 1 && next[2] === numbered[2];
}

/**
 * Whether a break between two lines may join them: never when either is quoted (`> …`), so the reply
 * under a quote is never read into it, nor one quoted line into another with its `>` inside the text.
 */
const joins = (line: string, next: string) => !isQuote(line) && !isQuote(next);

/**
 * Whether a paragraph is prose, whose breaks may join: a sentence in it ends before the paragraph
 * does and the next starts with a capital, or the paragraph is one sentence, ended, that wraps at
 * every break between its lines of text (not before a list item, not next to a quoted line). Notes
 * and a log's lines end no sentence, so they keep their lines however their lengths fall.
 */
function isProse(lines: string[], wrapped: boolean[]): boolean {
  if (SENTENCE_BREAK.test(lines.join("\n"))) return true;
  if (!endsSentence(lines[lines.length - 1] ?? "", FULL_STOP)) return false;
  return lines.every((l, i) => i === 0 || wrapped[i - 1] || BULLET.test(l) || ORDERED.test(l) || !joins(lines[i - 1]!, l));
}

/** An open Markdown list item: where its marker stood in the file, where it stands, and how wide the marker is. */
interface OpenItem {
  from: number;
  at: number;
  width: number;
}

/**
 * A plain-text paragraph as the readable text lays it out, keeping the author's lines: each line
 * stays a line (a Markdown hard break, two spaces before the line end), a list item keeps its
 * marker (`-`, `*` and `+` bullets and `1.` or `1)` numbers as Markdown lists, nested by their
 * indentation; other bullets as written), and in prose (isProse) a line that only wraps a sentence
 * onto the next joins it. A paragraph of prose in which most breaks are such wraps is hard-wrapped,
 * and reads as one flowing paragraph. `first` stands for the first line's text when it is a
 * speaker's turn, whose name is said apart; the line as written still sets the paragraph's width.
 */
export function layoutLines(raw: string[], first?: string): { text: string; opensWithList: boolean } {
  const lines = raw.map((r) => ({ trimmed: r.trim(), indent: indentWidth(r) }));
  // A loop, not Math.max(...): a paragraph may have more lines than a call takes arguments.
  let width = 0;
  for (const l of lines) width = Math.max(width, codePointLength(l.trimmed));
  const wrapAt = lines.slice(1).map((l, i) => joins(lines[i]!.trimmed, l.trimmed) && wraps(lines[i]!.trimmed, l.trimmed, width));
  // Only prose joins: notes and a log's lines are kept as their author broke them.
  const wrapped = isProse(lines.map((l) => l.trimmed), wrapAt) ? wrapAt : wrapAt.map(() => false);
  const build = (joinAll: boolean) => {
    const out: LaidLine[] = [];
    let open: OpenItem[] = [];
    let joinable = 0;
    let wraps = 0;
    for (let i = 0; i < lines.length; i++) {
      const { trimmed, indent } = lines[i]!;
      const text = i === 0 && first !== undefined ? first : trimmed;
      const prev = out[out.length - 1];
      const closes = (line: string) => open.length > 0 || (prev?.kind === "line" && isQuote(prev.text) && !isQuote(line));
      // Under a line that ends in a colon (`Dispatcher:`, `Next steps:`), a list opens apart from it.
      const introduced = open.length === 0 && prev?.kind === "line" && endsSentence(prev.text, COLONS);
      // A turn's words are never an item; a numbered line is one where Markdown would read it as
      // one: first in its paragraph, numbered 1, or in a list already; or where it opens a list
      // under a line that ends in a colon, numbered on by the line after it.
      const bullet = i === 0 && first !== undefined ? null : BULLET.exec(trimmed);
      const numbered = i === 0 && first !== undefined ? null : ORDERED.exec(trimmed);
      if (bullet || (numbered && (i === 0 || numbered[1] === "1" || open.length > 0 || (introduced && numbersOn(lines, i, numbered))))) {
        const marker = bullet ? (bullet[1] ?? bullet[2]!) : numbered![1]! + numbered![2]!;
        const body = trimmed.slice((bullet ?? numbered)![0].length);
        if (bullet && !/^[-*+]$/.test(marker)) {
          // A bullet Markdown does not read stays a line, as written.
          out.push({ kind: "line", text: `${marker} ${body}`, indent: 0, closes: closes(trimmed) });
          open = [];
          continue;
        }
        while (open.length && (open[open.length - 1]!.from >= indent || open.length >= MAX_LIST_DEPTH)) open.pop();
        const parent = open[open.length - 1];
        const at = parent ? parent.at + parent.width : 0;
        open.push({ from: indent, at, width: marker.length + 1 });
        out.push({ kind: "item", text: `${marker} ${body}`, indent: at, ...(introduced ? { opensList: true } : {}) });
        continue;
      }
      if (prev) {
        joinable++;
        if (wrapped[i - 1]) wraps++;
        if (wrapped[i - 1] || (joinAll && joins(prev.text, trimmed))) {
          prev.text += " " + trimmed;
          continue;
        }
      }
      // A line of its own: inside the open item when indented under it, else after the list.
      const top = open[open.length - 1];
      if (top && indent > top.from) {
        out.push({ kind: "inside", text, indent: top.at + top.width });
        continue;
      }
      out.push({ kind: "line", text: escapeBareMarker(text), indent: 0, closes: closes(text) });
      open = [];
    }
    return { out, joinable, wraps };
  };
  let laid = build(false);
  if (laid.joinable >= 2 && laid.wraps * 2 > laid.joinable) laid = build(true);
  let text = "";
  for (const [k, l] of laid.out.entries()) {
    const line = " ".repeat(l.indent) + l.text;
    if (k === 0) text = line;
    else if (l.kind === "item") text += (l.opensList ? "\n\n" : "\n") + line;
    else if (l.closes) text += "\n\n" + line;
    else text += "  \n" + line;
  }
  return { text, opensWithList: laid.out[0]?.kind === "item" };
}

/** A lone `-`, `1.` or `#` on a line reads as itself, not as an empty list item or heading. */
function escapeBareMarker(line: string): string {
  return BARE_MARKER.test(line) ? line.replace(/[-*+.)#]/g, (c) => `\\${c}`) : line;
}

function parseText(source: string, markdown: boolean): { blocks: Block[]; facts: Record<string, number> } {
  const lines = prepare(source, markdown);
  const texts = lines.filter((l) => l.kind === "line").map((l) => l.text);
  // In a transcript of timed labels, a "Name: words" line is a turn only when the name is one of its speakers.
  const labelled = looksLikeTranscript(texts) ? null : labelledSpeakers(texts);
  const transcript = Boolean(labelled) || looksLikeTranscript(texts);
  const blocks: Block[] = [];
  // The paragraph being read: in Markdown its lines trimmed, to be joined; in plain text its lines
  // as written, to be laid out line by line.
  let para: string[] = [];
  let item: string | null = null;
  // A speaker's turn: its words, and in plain text its lines as written, the first holding the name.
  let turn: { speaker: string; text: string; lines: string[] } | null = null;
  // Who is speaking after a timed label on a line of its own: every paragraph and list item until
  // the next label, turn, heading or break.
  let voice: string | null = null;
  let tables = 0;
  const flush = () => {
    if (turn) blocks.push({ text: markdown ? turn.text : layoutLines(turn.lines, turn.text).text, speaker: turn.speaker });
    turn = null;
    const said = voice ? { speaker: voice } : {};
    if (item !== null) blocks.push({ text: item.replace(/\s+/g, " ").trim(), ...said });
    item = null;
    if (para.length && markdown) blocks.push({ text: para.join(" ").replace(/\s+/g, " "), ...said });
    else if (para.length) {
      const laid = layoutLines(para);
      blocks.push({ text: laid.text, ...said, ...(voice && laid.opensWithList ? { opensWithList: true } : {}) });
    }
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
    if (!markdown && (THEMATIC_BREAK.test(line) || UNDERLINE.test(line))) {
      // A rule or an underline stands on its own, as written, so it never turns the line above
      // into a heading; a rule ends a speaker's paragraphs, as in Markdown.
      flush();
      voice = null;
      blocks.push({ text: escapeBareMarker(line.trim()) });
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
        turn = { text: t.text, speaker: t.speaker, lines: [line] };
        continue;
      }
      if (turn) {
        if (markdown) turn.text += " " + line.trim();
        else turn.lines.push(line);
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
    if (!markdown) {
      // Plain text keeps its lines: the paragraph, list items and all, is laid out when it ends.
      para.push(line);
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
 * Plain text, read as written. Paragraphs split on blank lines and keep their lines, list markers
 * and all (`layoutLines`), unless a paragraph is hard-wrapped prose; ATX headings, pipe tables, and
 * rules and underlines stand on their own. A text whose lines are mostly "Name:" turns is read as a
 * transcript, one turn per segment with its speaker. So is one whose turns start with a timed label
 * on a line of their own, "Dana (14:02):", each paragraph below a label being a segment with that
 * speaker.
 */
export const plaintextParser: FormatParser = {
  name: "plaintext",
  version: "8",
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
  version: "5",
  parse(bytes) {
    const source = decodeText(bytes);
    // A Markdown file already reads as it was written; its own text is the readable text.
    return { ...parseText(source, true), markdown: markdownAsIs(source) };
  },
};
