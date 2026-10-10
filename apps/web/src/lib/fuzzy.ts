/**
 * Forgiving title search for the lists people scan by name (assumptions).
 * Every word typed must be found in the title: at the start of a word, anywhere inside one, or,
 * for words of four letters or more, with one letter wrong, missing or extra. Case, accents and
 * punctuation are ignored. Titles that match better rank first.
 */

export interface TitleMatch {
  score: number;
  /** Matched stretches of the original title, as [start, end) offsets, sorted and not overlapping. */
  ranges: [number, number][];
}

/** The title folded for matching, with the offset in the original title of each folded character. */
function fold(s: string): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    const out = /^[\p{L}\p{N}]+$/u.test(f) ? f : " ";
    for (const c of out) {
      text += c;
      at.push(i);
    }
    i += ch.length;
  }
  return { text, at };
}

/** Levenshtein distance, giving up once it passes `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]!);
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length]! <= max;
}

export function words(query: string): string[] {
  return fold(query).text.split(" ").filter(Boolean);
}

export function matchTitle(query: string, title: string): TitleMatch | null {
  const terms = words(query);
  if (!terms.length) return { score: 0, ranges: [] };
  const { text, at } = fold(title);
  const spans: [number, number][] = [];
  let score = 0;
  for (const t of terms) {
    let found = -1;
    let points = 0;
    // At the start of a word.
    for (let k = text.indexOf(t); k >= 0; k = text.indexOf(t, k + 1)) {
      if (k === 0 || text[k - 1] === " ") {
        found = k;
        points = 3;
        break;
      }
      if (found < 0) {
        found = k;
        points = 2;
      }
    }
    let length = t.length;
    // One letter off, against the start of each word (so "aproval" finds "Approval matrices").
    if (found < 0 && t.length >= 4) {
      for (let k = 0; k < text.length && found < 0; k++) {
        if (k > 0 && text[k - 1] !== " ") continue;
        for (const n of [t.length, t.length - 1, t.length + 1]) {
          const w = text.slice(k, k + n);
          if (w.length === n && !w.includes(" ") && within(t, w, 1)) {
            found = k;
            length = n;
            points = 1;
            break;
          }
        }
      }
    }
    if (found < 0) return null;
    score += points;
    spans.push([found, found + length]);
  }
  // The words typed, in order, as one phrase.
  if (terms.length > 1 && text.includes(terms.join(" "))) score += 2;
  spans.sort((a, b) => a[0] - b[0]);
  const ranges: [number, number][] = [];
  for (const [s, e] of spans) {
    const start = at[s]!;
    const end = e >= at.length ? title.length : at[e]!;
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return { score, ranges };
}

/** The items whose title matches, best first; the list's own order breaks ties. */
export function findByTitle<T>(items: T[], query: string, title: (item: T) => string): { item: T; ranges: [number, number][] }[] {
  if (!words(query).length) return items.map((item) => ({ item, ranges: [] }));
  return items
    .map((item, i) => ({ item, i, m: matchTitle(query, title(item)) }))
    .filter((x): x is { item: T; i: number; m: TitleMatch } => x.m !== null)
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i)
    .map(({ item, m }) => ({ item, ranges: m.ranges }));
}
