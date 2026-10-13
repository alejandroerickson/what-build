/**
 * Speaker turns written as "Name: words", shared by every untimed format (plain text, Markdown,
 * DOCX) so the same transcript reads the same whatever it was saved as. Timed formats take their
 * speakers from cues instead (see cues.ts).
 */

import { isSpaceUnit } from "./text.ts";

/**
 * A capitalised name of up to 41 characters, or a bracketed label, then a colon. A short aside in
 * brackets may come between the name and the colon, "Dana (14:02 UTC):", and is left out.
 */
const SPEAKER_NAME = /^([A-Z][\p{L}\p{M}'’.\- ]{0,40}|\[[^\]]{1,40}\])(?:\s*\(([^()]{1,40})\))?:/u;
/** A label alone on its line, whose name may also say what the speaker is: "Sam, agent (14:03 UTC):". */
const LABEL_NAME = /^([A-Z][\p{L}\p{M}'’.,\- ]{0,40}|\[[^\]]{1,40}\])(?:\s*\(([^()]{1,40})\))?:$/u;
/** A clock in an aside or before a name: 14:02, 1:02:03. */
const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
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

/**
 * The speaker of a line that is only a label with a time, "Dana (14:02):" or "[14:02] Dana:", whose
 * words follow in the paragraphs after it; null for any other line. The time is required, so a
 * heading-like line such as "Attendees:" is never taken for a speaker.
 */
export function speakerLabel(line: string): string | null {
  const trimmed = line.trim();
  const stamped = TIMESTAMP_PREFIX.test(trimmed);
  const rest = trimmed.replace(TIMESTAMP_PREFIX, "");
  const m = LABEL_NAME.exec(rest);
  if (!m?.[1]) return null;
  if (!stamped && !(m[2] && CLOCK.test(m[2]))) return null;
  return m[1].replace(/^\[|\]$/g, "").trim() || null;
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

/**
 * The speakers of a transcript whose turns each start with a timed label on a line of its own, the
 * words in the paragraphs below (a record of a working session written as Markdown), in lower case;
 * null when the lines are not one. At least four labels, at least half of them by a name that
 * speaks more than once.
 */
export function labelledSpeakers(lines: string[]): Set<string> | null {
  const labels = lines.map(speakerLabel).filter((x) => x !== null);
  if (labels.length < 4) return null;
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l.toLowerCase(), (counts.get(l.toLowerCase()) ?? 0) + 1);
  if (labels.filter((l) => (counts.get(l.toLowerCase()) ?? 0) > 1).length * 2 < labels.length) return null;
  return new Set(counts.keys());
}
