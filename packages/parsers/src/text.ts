import { TooLargeError, type Block, type ParsedFile, type ParseResult, type Segment } from "./types.ts";

/** The largest segment, in code points. An unbounded paragraph once produced a segment no client could read. */
export const MAX_SEGMENT_CHARS = 2000;

/**
 * The most paragraphs (segments) one file may make. Far more than a long document or a full workbook makes, and
 * a bound on what a derivation writes: a file of millions of one-character paragraphs is too large
 * to parse, as a file over the parse cap is.
 */
export const MAX_SEGMENTS = 200_000;

/** Length of a string in Unicode code points (not UTF-16 units). */
export function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** The UTF-16 index of code point `cp` of `s`, counting on from `unit`, which is code point `at`. */
function unitOf(s: string, cp: number, unit = 0, at = 0): number {
  let i = unit;
  for (let n = at; n < cp && i < s.length; n++) {
    const c = s.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff ? 2 : 1;
  }
  return i;
}

/** Slice a string by code-point offsets, half-open, in one pass and without splitting it into characters. */
export function sliceCodePoints(s: string, start: number, end: number): string {
  if (end <= start) return "";
  const from = unitOf(s, start);
  return s.slice(from, unitOf(s, end, from, start));
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** The code units `\s` matches. */
export const isSpaceUnit = (c: number) =>
  (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;

/**
 * The code points left in the strings, joined, once every `\s` is removed: what
 * `codePointLength(texts.join("").replace(/\s+/g, ""))` returns, in one pass and without the copies.
 */
export function nonSpaceCodePoints(texts: Iterable<string>): number {
  let n = 0;
  // A high surrogate counted and waiting for its pair, which may follow in the next string or after spaces.
  let open = false;
  for (const s of texts) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (isSpaceUnit(c)) continue;
      if (open && isLowSurrogate(c)) {
        open = false;
        continue;
      }
      n++;
      open = isHighSurrogate(c);
    }
  }
  return n;
}

/** Decode bytes as UTF-8, dropping a BOM, replacing invalid sequences, and normalizing line endings. */
export function decodeText(bytes: Uint8Array): string {
  let s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r\n?/g, "\n");
}

export function collapseWhitespace(s: string): string {
  return s.replace(/[\t\f\v   -   　]+/g, " ").replace(/ *\n */g, "\n").trim();
}

/**
 * Split a paragraph into pieces of at most `max` code points, preferring sentence boundaries,
 * then the last space that fits, then a hard cut.
 */
export function splitLong(text: string, max = MAX_SEGMENT_CHARS): string[] {
  const cps = Array.from(text);
  if (cps.length <= max) return [text];
  const out: string[] = [];
  let start = 0;
  while (cps.length - start > max) {
    const window = cps.slice(start, start + max).join("");
    let cut = -1;
    // Sentence boundary: punctuation followed by whitespace, in the back half of the window.
    const re = /[.!?…。！？]["')\]]?\s/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(window)) !== null) {
      const endIdx = codePointLength(window.slice(0, m.index + m[0].length));
      if (endIdx >= max / 2) cut = endIdx;
    }
    if (cut === -1) {
      const lastSpace = window.lastIndexOf(" ");
      if (lastSpace > 0) cut = codePointLength(window.slice(0, lastSpace + 1));
    }
    if (cut <= 0) cut = max;
    const piece = cps.slice(start, start + cut).join("").trim();
    if (piece) out.push(piece);
    start += cut;
  }
  const rest = cps.slice(start).join("").trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * Assemble blocks into segments and the text they index into. Segments are joined by a blank
 * line; `text` ends with one newline past the last offset. `text[char_start:char_end] == segment.text`
 * holds for every segment, in code points.
 */
export function assemble(blocks: Block[]): { segments: Segment[]; text: string } {
  const segments: Segment[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const block of blocks) {
    const clean = block.heading_level ? block.text.replace(/\s+/g, " ").trim() : block.text.trim();
    if (!clean) continue;
    for (const piece of splitLong(clean)) {
      if (segments.length >= MAX_SEGMENTS) throw new TooLargeError(`the file makes more than ${MAX_SEGMENTS} paragraphs; files that make more are stored but not read`);
      if (segments.length > 0) {
        parts.push("\n\n");
        offset += 2;
      }
      const len = codePointLength(piece);
      const seg: Segment = {
        seq: segments.length,
        text: piece,
        speaker: block.speaker ?? null,
        start_ms: block.start_ms ?? null,
        end_ms: block.end_ms ?? null,
        char_start: offset,
        char_end: offset + len,
      };
      if (block.heading_level) seg.heading_level = block.heading_level;
      if (block.page !== undefined) seg.page = block.page;
      segments.push(seg);
      parts.push(piece);
      offset += len;
    }
  }
  const text = parts.length ? parts.join("") + "\n" : "";
  return { segments, text };
}

/** A parse as a derivation stores it: the readable text's bytes, and what its row records. */
export function toParsedFile(r: ParseResult): ParsedFile {
  return {
    status: r.status,
    parser: r.parser,
    parser_version: r.parser_version,
    status_detail: r.status_detail,
    duration_ms: r.duration_ms,
    facts: r.facts,
    char_count: codePointLength(r.markdown),
    text_md: new TextEncoder().encode(r.markdown),
  };
}
