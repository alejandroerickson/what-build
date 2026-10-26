import { z } from "zod";
import { invalid } from "./errors.ts";

/**
 * Exact find-and-replace edits, so a small correction to a long text does not mean re-sending all
 * of it, and a short diff of what an update changed, so a slip in a re-sent text is visible.
 */

export const MAX_EDITS = 20;

export function textEditInput<F extends string>(fields: readonly [F, ...F[]], fallback: F) {
  return z.strictObject({
    field: z.enum(fields).default(fallback as never).describe(`The text to edit: ${fields.join(", ")}. Defaults to ${fallback}.`),
    old_text: z.string().min(1).max(10_000).describe("Text that occurs exactly once in the field, character for character."),
    new_text: z.string().max(10_000).describe("What replaces it. Empty deletes it."),
  });
}

export function editsInput<F extends string>(fields: readonly [F, ...F[]], fallback: F) {
  return z
    .array(textEditInput(fields, fallback))
    .min(1)
    .max(MAX_EDITS)
    .describe(
      `Up to ${MAX_EDITS} exact replacements, applied in order: each old_text must occur exactly once in its field at that point, else nothing changes (422 edit_not_found or edit_ambiguous). Do not also pass the whole field.`,
    );
}

type Edit<F extends string> = { field: F; old_text: string; new_text: string };

/** Apply edits to the current texts. Returns the edited fields only; throws before anything is written. */
export function applyEdits<F extends string>(current: Record<F, string>, edits: Edit<F>[], replaced: Partial<Record<F, unknown>>): Partial<Record<F, string>> {
  const out: Partial<Record<F, string>> = {};
  edits.forEach((e, i) => {
    if (replaced[e.field] !== undefined)
      throw invalid("invalid_input", `edits[${i}] edits ${e.field}, which this call also replaces whole. Send one or the other. Nothing was changed.`);
    const text = out[e.field] ?? current[e.field];
    const at = text.indexOf(e.old_text);
    if (at < 0) throw invalid("edit_not_found", `edits[${i}]: old_text does not occur in ${e.field}. Read the current text and copy the words exactly. Nothing was changed.`, { edit: i, field: e.field });
    const again = text.indexOf(e.old_text, at + 1);
    if (again >= 0) {
      let n = 2;
      for (let k = text.indexOf(e.old_text, again + 1); k >= 0; k = text.indexOf(e.old_text, k + 1)) n++;
      throw invalid("edit_ambiguous", `edits[${i}]: old_text occurs ${n} times in ${e.field}. Include more of the surrounding text so it occurs once. Nothing was changed.`, { edit: i, field: e.field, occurrences: n });
    }
    out[e.field] = text.slice(0, at) + e.new_text + text.slice(at + e.old_text.length);
  });
  return out;
}

const DIFF_MAX = 300;
const CONTEXT = 40;

const clip = (s: string) => (s.length > DIFF_MAX ? `${s.slice(0, DIFF_MAX)}… (${s.length} characters)` : s);

export interface TextDiff {
  field: string;
  /** Character offset of the first difference in the old text. */
  at: number;
  /** Up to 40 characters before the change, unchanged. */
  before: string;
  removed: string;
  added: string;
  /** Up to 40 characters after the change, unchanged. */
  after: string;
}

/** One hunk spanning the first to the last difference, clipped to a readable size. */
export function textDiff(field: string, oldText: string, newText: string): TextDiff | null {
  if (oldText === newText) return null;
  let start = 0;
  const max = Math.min(oldText.length, newText.length);
  while (start < max && oldText[start] === newText[start]) start++;
  let end = 0;
  while (end < max - start && oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]) end++;
  return {
    field,
    at: start,
    before: oldText.slice(Math.max(0, start - CONTEXT), start),
    removed: clip(oldText.slice(start, oldText.length - end)),
    added: clip(newText.slice(start, newText.length - end)),
    after: oldText.slice(oldText.length - end, oldText.length - end + CONTEXT),
  };
}

/**
 * The most words a write may remove and add, together, and still be an edit rather than a rewrite,
 * however long the text: it also bounds the comparison's work.
 */
export const EDIT_MAX_CHANGED_WORDS = 2_000;

/**
 * Whether a new text rewrites an old one, rather than editing it, as the activity log says. A word
 * is a run of characters between spaces or line breaks. The texts are compared word by word, in
 * order: a write that removes and adds, together, more words than half of the two texts hold
 * between them, or more than `EDIT_MAX_CHANGED_WORDS`, rewrites; any other edits. A correction
 * reads the same whether the whole text was sent or exact edits were, and line breaks or spacing
 * alone change no word.
 */
export function rewrites(oldText: string, newText: string): boolean {
  const ids = new Map<string, number>();
  const words = (t: string) => Int32Array.from(t.match(/\S+/g) ?? [], (w) => ids.get(w) ?? (ids.set(w, ids.size), ids.size - 1));
  const a = words(oldText);
  const b = words(newText);
  const most = Math.min(EDIT_MAX_CHANGED_WORDS, Math.floor((a.length + b.length) / 2));
  return changedWords(a, b, most) > most;
}

/**
 * The fewest words removed and added that turn `a` into `b` (Myers' difference algorithm), or
 * `most + 1` once that is past `most`, so a rewrite costs no more to tell than `most` allows.
 */
function changedWords(a: Int32Array, b: Int32Array, most: number): number {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return n + m;
  const max = Math.min(most, n + m);
  // The furthest point reached in `a` on each diagonal k = x - y, offset so k = -max - 1 is index 0.
  const reach = new Int32Array(2 * max + 3);
  const at = (k: number) => k + max + 1;
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && reach[at(k - 1)]! < reach[at(k + 1)]!) ? reach[at(k + 1)]! : reach[at(k - 1)]! + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      reach[at(k)] = x;
      if (x >= n && y >= m) return d;
    }
  }
  return max + 1;
}
