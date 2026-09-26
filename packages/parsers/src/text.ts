import type { Block, Segment } from "./types.ts";

/** The largest segment, in code points. An unbounded paragraph once produced a segment no client could read. */
export const MAX_SEGMENT_CHARS = 2000;

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

/** Slice a string by code-point offsets, half-open. */
export function sliceCodePoints(s: string, start: number, end: number): string {
  const cps = Array.from(s);
  return cps.slice(start, end).join("");
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

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const frac = total % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(frac, 3)}`;
}

/** An outline of headings as indented bullets, with the segment each starts at. */
export function headingOutline(segments: Segment[]): string {
  const heads = segments.filter((s) => s.heading_level);
  if (!heads.length) return "- (no headings)\n";
  const min = Math.min(...heads.map((h) => h.heading_level ?? 1));
  return (
    heads
      .map((h) => `${"  ".repeat((h.heading_level ?? min) - min)}- ${h.text} (segment ${h.seq})`)
      .join("\n") + "\n"
  );
}

/** An outline of speaker turns with time ranges; consecutive cues by one speaker merge. */
export function speakerOutline(segments: Segment[]): string {
  const lines: string[] = [];
  let cur: { speaker: string; start: number; end: number; seqStart: number; seqEnd: number } | null = null;
  const flush = () => {
    if (cur)
      lines.push(
        `- ${formatClock(cur.start)} to ${formatClock(cur.end)}: ${cur.speaker} (${cur.seqStart === cur.seqEnd ? `segment ${cur.seqStart}` : `segments ${cur.seqStart}–${cur.seqEnd}`})`,
      );
  };
  for (const s of segments) {
    const speaker = s.speaker ?? "Unattributed";
    if (cur && cur.speaker === speaker) {
      cur.end = Math.max(cur.end, s.end_ms ?? cur.end);
      cur.seqEnd = s.seq;
    } else {
      flush();
      cur = { speaker, start: s.start_ms ?? 0, end: s.end_ms ?? 0, seqStart: s.seq, seqEnd: s.seq };
    }
  }
  flush();
  return lines.length ? lines.join("\n") + "\n" : "- (no cues)\n";
}
