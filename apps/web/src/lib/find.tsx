import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { GlyphName } from "../ui/index.tsx";
import { api, qs } from "./api.ts";
import { formatCue, formatDate } from "./format.ts";
import { REVIEW_STATUS } from "./status.ts";

/** What plain search returns: one ranked list over everything in a product (packages/core/src/ops/plain-search.ts). */
export type FindKind = "idea" | "outcome" | "source" | "assumption" | "mockup" | "story";
export type Marks = [number, number][];

export interface FindHit {
  seq: number;
  speaker: string | null;
  start_ms: number | null;
  text: string;
  marks: Marks;
}

export interface FindResult {
  kind: FindKind;
  id: string;
  title: string;
  title_marks: Marks;
  snippet: string | null;
  snippet_marks: Marks;
  missing: string[];
  score: number;
  meta: { date?: string | null; tags?: string[]; status?: string; citation_count?: number; page_id?: string | null; page_title?: string | null; pages?: number };
  hits?: FindHit[];
  hit_count?: number;
}

export interface FindResponse {
  query: string;
  terms: { text: string; phrase: boolean }[];
  ignored: string[];
  kind_hint: FindKind | "passage" | null;
  corrections: { from: string; to: string }[];
  partial: boolean;
  counts: Partial<Record<FindKind | "passage", number>>;
  results: FindResult[];
}

/** The kinds, in the order a product tells its story, with how each is named and drawn. */
export const FIND_KINDS: { id: FindKind | "passage"; label: string; one: string; glyph: GlyphName }[] = [
  { id: "idea", label: "Idea", one: "Idea", glyph: "lightbulb" },
  { id: "outcome", label: "Outcomes", one: "Outcome", glyph: "target" },
  { id: "source", label: "Sources", one: "Source", glyph: "library" },
  { id: "passage", label: "Passages", one: "Passage", glyph: "quote" },
  { id: "mockup", label: "Mockups", one: "Mockup", glyph: "blend" },
  { id: "assumption", label: "Assumptions", one: "Assumption", glyph: "scale" },
  { id: "story", label: "Story", one: "Story page", glyph: "book-open" },
];

export const kindOf = (id: string) => FIND_KINDS.find((k) => k.id === id)!;

/** How many things hold the words in all: results stop at the best 60, and `counts` counts every one. */
export function matchedCount(d: FindResponse): number {
  return FIND_KINDS.reduce((n, k) => n + (k.id === "passage" ? 0 : (d.counts[k.id] ?? 0)), 0);
}

/** The product's four areas, each holding the kinds found in it, in the panel's order. */
export const FIND_AREAS: { id: string; label: string; glyph: GlyphName; kinds: FindKind[] }[] = [
  { id: "idea", label: "Idea", glyph: "lightbulb", kinds: ["idea", "outcome"] },
  { id: "evidence", label: "Evidence", glyph: "library", kinds: ["source"] },
  { id: "exploration", label: "Exploration", glyph: "blend", kinds: ["mockup", "assumption"] },
  { id: "story", label: "Story", glyph: "book-open", kinds: ["story"] },
];

/**
 * Results under their areas. A kind named in the query ("mockups jobs") brings its area to the top
 * and its kind to the top of that area; otherwise each area lists its kinds in order, best match
 * first within each.
 */
export function byArea(results: FindResult[], hint: FindResponse["kind_hint"]) {
  const lead = hint === "passage" ? "source" : hint;
  const rank = (k: FindKind) => (k === lead ? -1 : FIND_KINDS.findIndex((x) => x.id === k));
  const areas = FIND_AREAS.map((a) => ({
    ...a,
    results: results.filter((r) => a.kinds.includes(r.kind)).sort((x, y) => rank(x.kind) - rank(y.kind)),
  }));
  return lead ? [...areas.filter((a) => a.kinds.includes(lead)), ...areas.filter((a) => !a.kinds.includes(lead))] : areas;
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Find as you type: the last answer stays on screen while the next one loads. */
export function useFind(base: string, query: string, opts: { kind?: string; recordId?: string; strict?: boolean } = {}) {
  const q = query.trim();
  return useQuery({
    queryKey: ["find", base, q, opts.kind ?? "", opts.recordId ?? "", Boolean(opts.strict)],
    queryFn: () => api<FindResponse>("GET", `${base}/search${qs({ mode: "plain", query: q, kind: opts.kind, record_id: opts.recordId, strict: opts.strict ? "true" : "" })}`),
    enabled: q.length > 0,
    placeholderData: (prev) => (q ? prev : undefined),
    staleTime: 30_000,
  });
}

/** Text with its matched stretches marked. */
export function Marked({ text, marks }: { text: string; marks: Marks }): ReactNode {
  if (!marks.length) return text;
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={i}>{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Where a result opens. */
export function resultHref(app: string, r: FindResult): string {
  switch (r.kind) {
    case "source":
      return `${app}/evidence/${r.id}`;
    case "assumption":
      return `${app}/exploration/assumptions/${r.id}`;
    case "mockup":
      return `${app}/exploration/mockups/${r.id}${r.meta.page_id ? `?page=${encodeURIComponent(r.meta.page_id)}` : ""}`;
    case "story":
      return `${app}/story/${r.id}`;
    case "outcome":
      return `${app}/idea?outcome=${encodeURIComponent(r.id)}`;
    case "idea":
      return `${app}/idea`;
  }
}

export function hitHref(app: string, recordId: string, h: FindHit): string {
  return `${app}/evidence/${recordId}?view=passages&seq=${h.seq}`;
}

/** The quiet line under a result's title: what it is, and what tells it apart. */
export function resultMeta(r: FindResult): string {
  const parts: string[] = [kindOf(r.kind).one];
  if (r.kind === "source") {
    if (r.meta.date) parts.push(formatDate(r.meta.date));
    if (r.hit_count) parts.push(`${r.hit_count} matching ${r.hit_count === 1 ? "passage" : "passages"}`);
  }
  if (r.kind === "assumption" && r.meta.status) parts.push(REVIEW_STATUS[r.meta.status]?.label ?? r.meta.status);
  if (r.kind === "outcome" && r.meta.status) parts.push(r.meta.status === "achieved" ? "Achieved" : "Active");
  if (r.kind === "mockup" && r.meta.page_title) parts.push(`page “${r.meta.page_title}”`);
  return parts.join(" · ");
}

export function hitMeta(h: FindHit): string {
  return [`¶${h.seq}`, h.speaker, h.start_ms !== null ? formatCue(h.start_ms) : null].filter(Boolean).join(" · ");
}

const RECENT_MAX = 6;
const recentKey = (productPath: string) => `whatbuild.recent-searches.${productPath}`;

function readRecent(productPath: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(productPath)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(productPath: string, list: string[]) {
  try {
    if (list.length) localStorage.setItem(recentKey(productPath), JSON.stringify(list));
    else localStorage.removeItem(recentKey(productPath));
  } catch {
    // Storage may be blocked; then recent searches last as long as the screen.
  }
}

/**
 * The searches a person followed through in a product (opened a result, or every result), newest
 * first, kept in this browser. Personal, so they go when that person signs out.
 */
export function useRecentSearches(productPath: string) {
  const [list, setList] = useState(() => readRecent(productPath));
  useEffect(() => setList(readRecent(productPath)), [productPath]);
  const remember = useCallback(
    (query: string) => {
      const q = query.trim().replace(/\s+/g, " ");
      if (!q) return;
      const next = [q, ...readRecent(productPath).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
      writeRecent(productPath, next);
      setList(next);
    },
    [productPath],
  );
  const clear = useCallback(() => {
    writeRecent(productPath, []);
    setList([]);
  }, [productPath]);
  return { recent: list, remember, clear };
}
