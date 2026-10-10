/**
 * Speaker turns written as "Name: words", shared by every untimed format (plain text, Markdown,
 * DOCX) so the same transcript reads the same whatever it was saved as. Timed formats take their
 * speakers from cues instead (see cues.ts).
 */

import { isSpaceUnit } from "./text.ts";

/** A capitalised name of up to 41 characters, or a bracketed label, then a colon. */
const SPEAKER_NAME = /^([A-Z][\p{L}\p{M}'’.\- ]{0,40}|\[[^\]]{1,40}\]):/u;
/** An optional clock before the name: "[00:01:02] Dana: …" or "01:02 Dana: …". */
const TIMESTAMP_PREFIX = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+/;

const isLineTerminator = (c: number) => c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;

/**
 * The name and words of a line as `/^(NAME):\s+(.+)$/u` reads them, NAME being `SPEAKER_NAME`'s
 * group. That pattern backtracks in quadratic time over a long run of spaces followed by a line
 * separator, so the part after the colon is read here in one pass, with the same result.
 */
export function speakerLine(line: string): [name: string, words: string] | null {
  const m = SPEAKER_NAME.exec(line);
  if (!m?.[1]) return null;
  const at = m[0].length;
  let w = at;
  while (w < line.length && isSpaceUnit(line.charCodeAt(w))) w++;
  if (w === at) return null;
  // `\s+` takes every space it can, and gives one back only when nothing is left for `.+`, which
  // reads to the end and crosses no line terminator.
  let from = w;
  if (w === line.length) from = w - 1;
  if (from === at) return null;
  for (let i = from; i < line.length; i++) if (isLineTerminator(line.charCodeAt(i))) return null;
  return [m[1], line.slice(from)];
}

/** The speaker and words of one "Name: words" line, or null when the line is not a turn. */
export function speakerTurn(line: string): { speaker: string; text: string } | null {
  const m = speakerLine(line.replace(TIMESTAMP_PREFIX, "").trim());
  if (!m?.[0] || !m[1]) return null;
  return { speaker: m[0].replace(/^\[|\]$/g, "").trim(), text: m[1] };
}

/**
 * Whether a document's lines (or paragraphs) are a transcript. Conservative, so ordinary notes
 * with a few "Note:" or "Date:" lines are never split into speakers: at least four lines, at least
 * 60% of them "Name:" turns, and at least half of those turns by a name that speaks more than once
 * (a block of "Project: … / Date: … / Location: …" fields has no recurring name).
 */
export function looksLikeTranscript(lines: string[]): boolean {
  const nonEmpty = lines.filter((l) => l.trim());
  const turns = nonEmpty.map(speakerTurn).filter((t) => t !== null);
  if (nonEmpty.length < 4 || turns.length / nonEmpty.length < 0.6) return false;
  const counts = new Map<string, number>();
  for (const t of turns) counts.set(t.speaker.toLowerCase(), (counts.get(t.speaker.toLowerCase()) ?? 0) + 1);
  const recurring = turns.filter((t) => (counts.get(t.speaker.toLowerCase()) ?? 0) > 1).length;
  return recurring * 2 >= turns.length;
}
