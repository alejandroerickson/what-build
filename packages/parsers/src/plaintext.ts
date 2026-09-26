import { decodeText } from "./text.ts";
import type { Block, FormatParser } from "./types.ts";

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SPEAKER_LINE = /^([A-Z][\p{L}\p{M}'’.\- ]{0,40}|\[[^\]]{1,40}\]):\s+(.+)$/u;
const TIMESTAMP_PREFIX = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+/;

/**
 * Plain text and Markdown. Paragraphs split on blank lines; ATX headings become their own
 * segments. A text whose lines mostly start with "Name:" is read as a transcript, one turn per
 * segment with its speaker — the fix for plain-text transcripts losing their speakers.
 */
export const plaintextParser: FormatParser = {
  name: "plaintext",
  version: "3",
  parse(bytes) {
    const source = decodeText(bytes);
    const lines = source.split("\n");
    const nonEmpty = lines.filter((l) => l.trim());
    const speakerLines = nonEmpty.filter((l) => SPEAKER_LINE.test(l.replace(TIMESTAMP_PREFIX, "").trim()));
    const transcript = nonEmpty.length >= 4 && speakerLines.length / nonEmpty.length >= 0.6;
    const blocks: Block[] = [];
    let para: string[] = [];
    let inFence = false;
    let inFenceBlock = false;
    const flush = () => {
      if (para.length) {
        blocks.push({ text: inFenceBlock ? para.join("\n") : para.join(" ").replace(/\s+/g, " ") });
        para = [];
      }
    };
    let turn: Block | null = null;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (/^(```|~~~)/.test(line.trim())) {
        if (inFence) {
          para.push(line);
          inFenceBlock = true;
          flush();
          inFenceBlock = false;
          inFence = false;
        } else {
          flush();
          inFence = true;
          para.push(line);
        }
        continue;
      }
      if (inFence) {
        para.push(line);
        continue;
      }
      const h = line.match(HEADING);
      if (h?.[1] && h[2]) {
        if (turn) (blocks.push(turn), (turn = null));
        flush();
        blocks.push({ text: `${h[1]} ${h[2]}`, heading_level: h[1].length });
        continue;
      }
      if (transcript) {
        const body = line.replace(TIMESTAMP_PREFIX, "").trim();
        const m = body.match(SPEAKER_LINE);
        if (m?.[1] && m[2]) {
          if (turn) blocks.push(turn);
          turn = { text: m[2], speaker: m[1].replace(/^\[|\]$/g, "").trim() };
          continue;
        }
        if (!line.trim()) {
          if (turn) (blocks.push(turn), (turn = null));
          continue;
        }
        if (turn) {
          turn.text += " " + line.trim();
          continue;
        }
      }
      if (!line.trim()) {
        flush();
        continue;
      }
      para.push(line.trim());
    }
    if (turn) blocks.push(turn);
    if (inFence) inFenceBlock = true;
    flush();
    const facts: Record<string, number> = {};
    if (transcript) facts["transcript_turns"] = blocks.filter((b) => b.speaker).length;
    return { blocks, facts };
  },
};
