import { decodeText, isSpaceUnit } from "./text.ts";
import type { Block, FormatParser } from "./types.ts";

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

export function parseTimestamp(ts: string): number {
  const [clock, fracRaw = "0"] = ts.replace(",", ".").split(".");
  const parts = (clock ?? "0").split(":").map((p) => Number.parseInt(p, 10));
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  const frac = Number.parseInt(fracRaw.padEnd(3, "0").slice(0, 3), 10);
  return seconds * 1000 + frac;
}

const SPEAKER_PREFIX = /^([A-Z][\p{L}\p{M}'’.\- ]{0,40}):\s+(.*)$/su;

const GT = 0x3e;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

/** Finds the first `>` at or after a position that only moves forward, scanning each stretch once. */
function nextGreaterThan(s: string): (from: number) => number {
  let found = -2;
  return (from) => {
    if (found === -1 || found >= from) return found;
    found = s.indexOf(">", from);
    return found;
  };
}

/**
 * The speaker in the first voice tag, as `raw.match(/<v(?:\.[^\s>]*)?\s+([^>]+)>/)?.[1]` reads it,
 * in one pass: the pattern backtracks in quadratic time over a cue of many `<v ` and no `>`. After
 * `<v` come an optional `.class`, spaces, then the name up to the first `>`; spaces that run right
 * up to the `>` leave the last of them as the name.
 */
export function voiceName(raw: string): string | null {
  const gt = nextGreaterThan(raw);
  let classEnd = -1; // where the run of class characters holding a position ends, found once for the run
  let spaceEnd = -1; // where the run of spaces holding a position ends, found once for the run
  for (let i = raw.indexOf("<v"); i !== -1; i = raw.indexOf("<v", i + 1)) {
    let k = i + 2;
    if (raw.charCodeAt(k) === 0x2e) {
      if (k + 1 > classEnd) for (classEnd = k + 1; classEnd < raw.length && !isSpaceUnit(raw.charCodeAt(classEnd)) && raw.charCodeAt(classEnd) !== GT; ) classEnd++;
      k = classEnd;
    }
    if (k >= raw.length || !isSpaceUnit(raw.charCodeAt(k))) continue;
    if (k >= spaceEnd) for (spaceEnd = k; spaceEnd < raw.length && isSpaceUnit(raw.charCodeAt(spaceEnd)); ) spaceEnd++;
    const g = gt(spaceEnd);
    // No `>` after the spaces means none after `i` either, so no later tag can match.
    if (g === -1) return null;
    if (g > spaceEnd) return raw.slice(spaceEnd, g);
    if (spaceEnd - k >= 2) return raw.slice(spaceEnd - 1, g);
  }
  return null;
}

const TAG_NAMES = ["v", "c", "i", "b", "u", "ruby", "rt", "lang"];

/**
 * Remove caption markup as these patterns, applied in this order, do, in one pass each: each
 * backtracks in quadratic time over a cue of many openings that never close.
 *
 *     /\{\\[^}]*\}/g
 *     /<\/?(?:v|c|i|b|u|ruby|rt|lang)(?:[.\s][^>]*)?>/g
 *     /<\d{1,2}:\d{2}[:.][^>]*>/g
 */
export function stripCueMarkup(raw: string): string {
  let s = raw;
  // Override blocks: `{\` up to the first `}`.
  if (s.includes("{\\")) {
    let out = "";
    let last = 0;
    for (let i = s.indexOf("{\\"); i !== -1; ) {
      const close = s.indexOf("}", i + 2);
      if (close === -1) break;
      out += s.slice(last, i);
      last = close + 1;
      i = s.indexOf("{\\", last);
    }
    if (last) s = out + s.slice(last);
  }
  if (!s.includes("<")) return s;
  const strip = (text: string, end: (text: string, q: number, gt: (from: number) => number) => number) => {
    const gt = nextGreaterThan(text);
    let out = "";
    let last = 0;
    for (let i = text.indexOf("<"); i !== -1; ) {
      const e = end(text, i + 1, gt);
      if (e === -1) i = text.indexOf("<", i + 1);
      else {
        out += text.slice(last, i);
        last = e;
        i = text.indexOf("<", e);
      }
    }
    return last ? out + text.slice(last) : text;
  };
  // Styling and voice tags, opening or closing, with an optional `.class` or annotation.
  s = strip(s, (text, q, gt) => {
    if (text.charCodeAt(q) === 0x2f) q++;
    const name = TAG_NAMES.find((n) => text.startsWith(n, q));
    if (!name) return -1;
    const after = q + name.length;
    const c = text.charCodeAt(after);
    if (c === GT) return after + 1;
    if (c !== 0x2e && !isSpaceUnit(c)) return -1;
    const g = gt(after + 1);
    return g === -1 ? -1 : g + 1;
  });
  // Timestamp tags inside a cue: `<00:01.000>` or `<1:02:03.000>`.
  s = strip(s, (text, q, gt) => {
    if (!isDigit(text.charCodeAt(q))) return -1;
    const colon = isDigit(text.charCodeAt(q + 1)) ? q + 2 : q + 1;
    if (text.charCodeAt(colon) !== 0x3a || !isDigit(text.charCodeAt(colon + 1)) || !isDigit(text.charCodeAt(colon + 2))) return -1;
    const sep = text.charCodeAt(colon + 3);
    if (sep !== 0x3a && sep !== 0x2e) return -1;
    const g = gt(colon + 4);
    return g === -1 ? -1 : g + 1;
  });
  return s;
}

/** Remove caption formatting tags and position codes; return the payload and any voice speaker. */
export function cleanPayload(raw: string): { text: string; speaker: string | null } {
  let speaker: string | null = null;
  const voice = voiceName(raw);
  if (voice) speaker = voice.trim();
  let text = stripCueMarkup(raw)
    // One pass collapses line breaks too; /\s*\n\s*/ took quadratic time on long runs of spaces.
    .replace(/\s+/g, " ")
    .trim();
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
  if (!speaker) {
    const m = text.match(SPEAKER_PREFIX);
    if (m?.[1] && m[2]) {
      speaker = m[1].trim();
      text = m[2].trim();
    }
  }
  return { text, speaker };
}

function parseCues(source: string): { blocks: Block[]; inverted: number } {
  const blocks: Block[] = [];
  let inverted = 0;
  for (const chunk of source.split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
    if (!lines.length) continue;
    const first = lines[0]?.trim() ?? "";
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(first) || /^WEBVTT/.test(first)) continue;
    // The timing line must be the block's first or second line, so timestamp-shaped caption text never becomes a cue.
    let timingIdx = -1;
    for (const i of [0, 1]) if (lines[i] && TIMING.test(lines[i])) timingIdx = i;
    if (timingIdx === -1) continue;
    const m = lines[timingIdx]!.match(TIMING)!;
    const start = parseTimestamp(m[1]!);
    const end = parseTimestamp(m[2]!);
    if (end < start) {
      inverted++;
      continue;
    }
    const payload = lines.slice(timingIdx + 1).join("\n");
    const { text, speaker } = cleanPayload(payload);
    if (!text) continue;
    blocks.push({ text, speaker, start_ms: start, end_ms: end });
  }
  return { blocks, inverted };
}

export const vttParser: FormatParser = {
  name: "webvtt",
  version: "2",
  timed: true,
  parse(bytes) {
    const { blocks, inverted } = parseCues(decodeText(bytes));
    return { blocks, facts: { inverted_cues: inverted } };
  },
};

export const srtParser: FormatParser = {
  name: "subrip",
  version: "2",
  timed: true,
  parse(bytes) {
    const { blocks, inverted } = parseCues(decodeText(bytes));
    return { blocks, facts: { inverted_cues: inverted } };
  },
};
