/**
 * Speaker turns written as "Name: words", shared by every untimed format (plain text, Markdown,
 * DOCX) so the same transcript reads the same whatever it was saved as. Timed formats take their
 * speakers from cues instead (see cues.ts).
 */

/** A capitalised name of up to 41 characters, or a bracketed label, then a colon and the words. */
const SPEAKER_LINE = /^([A-Z][\p{L}\p{M}'’.\- ]{0,40}|\[[^\]]{1,40}\]):\s+(.+)$/u;
/** An optional clock before the name: "[00:01:02] Dana: …" or "01:02 Dana: …". */
const TIMESTAMP_PREFIX = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+/;

/** The speaker and words of one "Name: words" line, or null when the line is not a turn. */
export function speakerTurn(line: string): { speaker: string; text: string } | null {
  const m = line.replace(TIMESTAMP_PREFIX, "").trim().match(SPEAKER_LINE);
  if (!m?.[1] || !m[2]) return null;
  return { speaker: m[1].replace(/^\[|\]$/g, "").trim(), text: m[2] };
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
