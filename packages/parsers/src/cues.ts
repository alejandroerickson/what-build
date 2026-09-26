import { decodeText } from "./text.ts";
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

/** Remove caption formatting tags and position codes; return the payload and any voice speaker. */
export function cleanPayload(raw: string): { text: string; speaker: string | null } {
  let speaker: string | null = null;
  const voice = raw.match(/<v(?:\.[^\s>]*)?\s+([^>]+)>/);
  if (voice?.[1]) speaker = voice[1].trim();
  let text = raw
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<\/?(?:v|c|i|b|u|ruby|rt|lang)(?:[.\s][^>]*)?>/g, "")
    .replace(/<\d{1,2}:\d{2}[:.][^>]*>/g, "")
    .replace(/\s*\n\s*/g, " ")
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
  version: "1",
  timed: true,
  parse(bytes) {
    const { blocks, inverted } = parseCues(decodeText(bytes));
    return { blocks, facts: { inverted_cues: inverted } };
  },
};

export const srtParser: FormatParser = {
  name: "subrip",
  version: "1",
  timed: true,
  parse(bytes) {
    const { blocks, inverted } = parseCues(decodeText(bytes));
    return { blocks, facts: { inverted_cues: inverted } };
  },
};
