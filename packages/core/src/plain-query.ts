/**
 * How plain search reads what a person typed, without a model: deterministic rules a person can predict.
 *
 * - Words match in any order, each at the start of a word in the text. Endings are forgiven, so
 *   "pricing" finds price, prices and priced, and "schedule" finds scheduling.
 * - The word still being typed (the last one, with no space after it) matches as a prefix, even
 *   when it is short.
 * - "Quoted words" match as a phrase, exactly.
 * - An id or a number (a word with a digit in it, such as CB26-20734, 2026-05-01 or 2026) is one
 *   word, hyphens and all, matched as written: as a prefix only while it is being typed, never
 *   with its ending forgiven, and never corrected into another.
 * - Small words (the, of, how…) are left out when other words remain.
 * - A word naming a kind of thing ("mockups", "assumptions") brings that kind first instead of
 *   being searched for, when other words remain.
 * - Case and accents are ignored.
 */

export type FindKind = "idea" | "outcome" | "source" | "assumption" | "mockup" | "story";

export interface FindTerm {
  /** The word or phrase as typed, lowercased. */
  text: string;
  /** What is matched: the word's root, an id or number as typed, or the phrase's words. Lowercased, accents kept (Postgres's `simple` tokens keep them). */
  root: string;
  /** A prefix match, or (short words and phrases) the whole word or phrase only. */
  prefix: boolean;
  phrase: boolean;
}

export interface ParsedFind {
  terms: FindTerm[];
  /** Words left out of the search: small words. */
  ignored: string[];
  /** A kind the query named, brought first. */
  kind: FindKind | null;
}

export const MAX_TERMS = 8;

const STOP = new Set(
  "a an the and or of to in on at for with by from into about as is are was were be been being do does did how what why when where who whom which that this these those there here we i me my our you your they them their he she it its his her us can could would should will just any all some s t".split(
    " ",
  ),
);

const KIND_WORDS: Record<string, FindKind> = {
  idea: "idea",
  concept: "idea",
  outcome: "outcome",
  outcomes: "outcome",
  source: "source",
  sources: "source",
  // What a source says: its text, its summary, its notes and comments.
  passage: "source",
  passages: "source",
  quote: "source",
  quotes: "source",
  assumption: "assumption",
  assumptions: "assumption",
  mockup: "mockup",
  mockups: "mockup",
  story: "story",
};

/** Lowercase with accents removed, for comparing; the same length as `s` for nearly all text. */
export function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

const SUFFIXES = ["ations", "ation", "ments", "ment", "ings", "ing", "ers", "er", "ies", "ied", "ed", "es", "ly", "s"];

/**
 * A word's root for prefix matching: a common English ending removed, then a final e, so the root
 * is a prefix of every form ("pricing", "priced", "prices" → "pric"). A root keeps at least four
 * letters (three after a final e), so short words are not cut into prefixes of unrelated ones.
 */
export function wordRoot(word: string): string {
  let w = word;
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 4) {
      w = w.slice(0, -s.length);
      // planning → plann → plan
      if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
      break;
    }
  }
  if (w.endsWith("e") && w.length >= 4) w = w.slice(0, -1);
  return w;
}

const WORD = /[\p{L}\p{N}]+/gu;
/** Letters and digits, with single hyphens between them: a word, a hyphenated word, or an id. */
const TOKEN = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;
const DIGIT = /\p{N}/u;

/** An id or a number: a word with a digit in it. It matches as written and is never corrected. */
export function idLike(word: string): boolean {
  return DIGIT.test(word);
}

/**
 * The words of `text`, lowercased. An id with hyphens in it (CB26-20734, 2026-05-01) stays one
 * word; a hyphenated word without a digit ("follow-up") is its words.
 */
export function queryWords(text: string): string[] {
  const out: string[] = [];
  for (const [t] of text.toLowerCase().matchAll(TOKEN)) {
    if (t.includes("-") && !idLike(t)) out.push(...t.split("-"));
    else out.push(t);
  }
  return out;
}

export function parseFind(raw: string): ParsedFind {
  const text = raw.normalize("NFC");
  const typing = !/[\s"]$/.test(text);
  const phrases: string[] = [];
  const rest = text.replace(/"([^"]*)("|$)/g, (_, p: string) => {
    const words = queryWords(p);
    if (words.length) phrases.push(words.join(" "));
    return " ";
  });
  const words = queryWords(rest);
  const terms: FindTerm[] = [];
  const ignored: string[] = [];
  let kind: FindKind | null = null;
  const keep = words.filter((w) => !STOP.has(fold(w)) && !KIND_WORDS[fold(w)]);
  const anyOther = keep.length + phrases.length > 0;
  words.forEach((w, i) => {
    const f = fold(w);
    const last = i === words.length - 1 && typing && !phrases.length;
    if (anyOther && KIND_WORDS[f] && !kind) {
      kind = KIND_WORDS[f]!;
      return;
    }
    if (anyOther && STOP.has(f)) {
      ignored.push(w);
      return;
    }
    // An id or a number is a prefix only while it is being typed: CB26-2073 is not CB26-20734.
    if (idLike(w)) terms.push({ text: w, root: w, prefix: last, phrase: false });
    else terms.push({ text: w, root: wordRoot(w), prefix: last || w.length > 3, phrase: false });
  });
  for (const p of phrases) terms.push({ text: p, root: p, prefix: false, phrase: true });
  // The same root twice adds nothing.
  const seen = new Set<string>();
  const unique = terms.filter((t) => (seen.has(t.root) ? false : (seen.add(t.root), true)));
  return { terms: unique.slice(0, MAX_TERMS), ignored, kind };
}

/**
 * A Postgres tsquery for one term (words are letters, digits and hyphens only, so quoting them is
 * safe). Postgres reads a quoted id as its parser reads the text, so CB26-20734 becomes the phrase
 * cb26 <-> -20734, as it is stored; and since a number after a hyphen is stored with the hyphen,
 * a term that starts with a digit matches that form too.
 */
export function termTsquery(t: FindTerm): string {
  if (t.phrase) return t.root.split(" ").map((w) => `'${w}'`).join(" <-> ");
  const star = t.prefix ? ":*" : "";
  return /^\p{N}/u.test(t.root) ? `'${t.root}'${star} | '-${t.root}'${star}` : `'${t.root}'${star}`;
}

/** An id that ends in a number after a hyphen: the 01 of 2026-05-01, the 20734 of CB26-20734. */
const ENDS_IN_NUMBER = /-\p{N}+$/u;

/**
 * A regular expression that finds a term in folded text, where Postgres finds it. A term ends where
 * its word does; but Postgres reads a number after a hyphen as ending before a letter, so an id that
 * ends in one is found before a letter too, as 2026-05-01 is in 2026-05-01T10:00. A number alone
 * runs on into letters there as here: 2020 is not in 2020s.
 */
export function termPattern(t: FindTerm): RegExp {
  const esc = (s: string) => fold(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = t.phrase ? t.root.split(" ").map(esc).join("[^\\p{L}\\p{N}]+") : esc(t.root);
  const end = t.prefix ? "[\\p{L}\\p{N}]*" : !t.phrase && ENDS_IN_NUMBER.test(t.root) ? "(?!\\p{N})" : "(?![\\p{L}\\p{N}])";
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${end}`, "gu");
}

export interface TextMatch {
  /** Which terms were found, by index. */
  found: boolean[];
  /** Matched stretches as [start, end) offsets in the text, sorted and merged. */
  ranges: [number, number][];
  /** Terms found as the very word typed rather than another form of it. */
  exact: number;
}

/** Where the terms occur in `text`. Folding keeps offsets for all but rare characters (ligatures), which are then off by a little. */
export function matchText(text: string, terms: FindTerm[]): TextMatch {
  const folded = fold(text);
  const aligned = folded.length === text.length;
  const found = terms.map(() => false);
  const spans: [number, number][] = [];
  let exact = 0;
  terms.forEach((t, i) => {
    let exactHere = false;
    for (const m of folded.matchAll(termPattern(t))) {
      found[i] = true;
      if (m[0] === fold(t.text)) exactHere = true;
      if (aligned) spans.push([m.index, m.index + m[0].length]);
      if (spans.length > 400) break;
    }
    if (exactHere) exact++;
  });
  spans.sort((a, b) => a[0] - b[0]);
  const ranges: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = ranges[ranges.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else ranges.push([s, e]);
  }
  return { found, ranges, exact };
}

/**
 * About `width` characters of `text` around the densest run of matches, cut at word boundaries,
 * with the match ranges moved to the excerpt.
 */
export function excerpt(text: string, ranges: [number, number][], width = 220): { text: string; marks: [number, number][] } {
  const clean = text.replace(/\s+/g, " ").trim();
  // Collapsing whitespace moves offsets; find the ranges again in the cleaned text by mapping.
  const map: number[] = [];
  {
    let j = 0;
    let space = false;
    const lead = text.length - text.trimStart().length;
    for (let i = 0; i < text.length; i++) {
      if (i < lead) {
        map.push(0);
        continue;
      }
      const ws = /\s/.test(text[i]!);
      if (ws && space) {
        map.push(j);
        continue;
      }
      map.push(j);
      j++;
      space = ws;
    }
    map.push(j);
  }
  const rs = ranges.map(([s, e]) => [map[s] ?? 0, map[e] ?? clean.length] as [number, number]).filter(([s, e]) => e > s && s < clean.length);
  if (clean.length <= width) return { text: clean, marks: rs };
  // The window holding the most matches, starting a little before one of them.
  let best = 0;
  let bestCount = -1;
  for (const [s] of rs.length ? rs : [[0, 0] as [number, number]]) {
    const start = Math.max(0, s - 60);
    const count = rs.filter(([a, b]) => a >= start && b <= start + width).length;
    if (count > bestCount) {
      best = start;
      bestCount = count;
    }
  }
  let start = best;
  if (start > 0) {
    const sp = clean.lastIndexOf(" ", start);
    start = sp > start - 20 && sp >= 0 ? sp + 1 : start;
  }
  if (start + width > clean.length) start = Math.max(0, clean.length - width);
  let end = Math.min(clean.length, start + width);
  if (end < clean.length) {
    const sp = clean.lastIndexOf(" ", end);
    if (sp > start + width - 30) end = sp;
  }
  const pre = start > 0 ? "…" : "";
  const post = end < clean.length ? "…" : "";
  const marks = rs.filter(([a, b]) => a >= start && b <= end).map(([a, b]) => [a - start + pre.length, b - start + pre.length] as [number, number]);
  return { text: pre + clean.slice(start, end) + post, marks };
}

/** Levenshtein distance, giving up once it passes `max`. */
export function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const swap = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? prev[j - 2]! + 1 : Infinity;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1), swap);
      best = Math.min(best, row[j]!);
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length]! <= max;
}

/**
 * The word in `texts` closest to a word that found nothing: within one edit for words of up to
 * five letters, two for longer ones; a word still being typed is compared with the start of each
 * word. The most frequent wins a tie. Ids and numbers are never corrected, nor offered as a
 * correction: one digit away is another thing, not a typo.
 */
export function closestWord(word: string, texts: string[], typing: boolean): string | null {
  const w = fold(word);
  if (idLike(w)) return null;
  const max = w.length >= 6 ? 2 : 1;
  const counts = new Map<string, number>();
  for (const t of texts) for (const m of fold(t).matchAll(WORD)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  let best: { word: string; d: number; n: number } | null = null;
  for (const [cand, n] of counts) {
    if (cand === w || cand.length < 3 || idLike(cand) || (typing && cand.startsWith(w))) continue;
    // A word still being typed is compared with the starts of each candidate around its length.
    const targets = typing ? [w.length - 1, w.length, w.length + 1].filter((l) => l >= 3 && l <= cand.length).map((l) => cand.slice(0, l)) : [cand];
    for (let d = 1; d <= max; d++) {
      if (!targets.some((target) => target !== w && editDistanceWithin(w, target, d))) continue;
      const gap = Math.abs(cand.length - w.length);
      if (!best || d < best.d || (d === best.d && (n > best.n || (n === best.n && gap < Math.abs(best.word.length - w.length))))) best = { word: cand, d, n };
      break;
    }
  }
  return best?.word ?? null;
}
