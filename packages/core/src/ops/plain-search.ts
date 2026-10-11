import { sql, type RawBuilder } from "kysely";
import { productId } from "../common.ts";
import { closestWord, excerpt, fold, matchText, parseFind, termPattern, termTsquery, wordRoot, type FindKind, type FindTerm, type ParsedFind, type TextMatch } from "../plain-query.ts";
import type { OpContext } from "../registry.ts";

/**
 * Plain search (`search` with `mode: "plain"`): one search over everything in a product, read the way a person means it (see
 * plain-query.ts), ranked, and grouped so a source shows up once with its best passages. Lexical
 * and deterministic: no model, no embeddings, no index beyond the ones `search` already uses.
 */

export const FIND_KINDS = ["idea", "outcome", "source", "passage", "assumption", "mockup", "story"] as const satisfies readonly FindKind[];

/** What plain search takes: the words, and optionally one kind, one source, or no correcting. */
export interface PlainInput {
  query: string;
  kind?: FindKind;
  record_id?: string;
  strict: boolean;
}

type Input = PlainInput;

type Marks = [number, number][];

interface Hit {
  seq: number;
  speaker: string | null;
  start_ms: number | null;
  text: string;
  marks: Marks;
  found: number;
}

export interface FindResult {
  kind: Exclude<FindKind, "passage">;
  id: string;
  title: string;
  title_marks: Marks;
  /** The best excerpt of the text that matched, if the title alone does not say why it is here. */
  snippet: string | null;
  snippet_marks: Marks;
  /** Words this result does not contain. */
  missing: string[];
  score: number;
  /** Kind-specific: a source's date and tags, an assumption's or outcome's status, a mockup page. */
  meta: Record<string, unknown>;
  /** A source's matching passages, best first, and how many there are. */
  hits?: Omit<Hit, "found">[];
  hit_count?: number;
}

/** Text from stored HTML: scripts, styles and tags dropped, entities blanked. */
function htmlText(col: RawBuilder<unknown>): RawBuilder<string> {
  const text = sql`regexp_replace(regexp_replace(regexp_replace(${col}, '<(script|style)[^>]*?>.*?</\\1>', ' ', 'gi'), '<[^>]+>', ' ', 'g'), '&[a-zA-Z0-9#]+;', ' ', 'g')`;
  // A tag between a word and its punctuation leaves a space before the comma; close it.
  return sql<string>`regexp_replace(${text}, '\\s+([,.;:!?)])', '\\1', 'g')`;
}

/** The terms, in the order typed and next to each other: a strong sign the text is about them. */
function adjacent(text: string, terms: FindTerm[]): boolean {
  if (terms.length < 2) return false;
  const parts = terms.map((t) => termPattern(t).source.replace(/^\(\?<!\[\\p\{L\}\\p\{N\}\]\)/, ""));
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join("[^\\p{L}\\p{N}]+")}`, "u").test(fold(text));
}

interface Doc {
  title: string;
  /** Searchable text beyond the title, in the order an excerpt should prefer it. */
  body: string[];
}

function scoreDoc(doc: Doc, p: ParsedFind, kind: FindKind) {
  const n = p.terms.length;
  const t = matchText(doc.title, p.terms);
  const bodies = doc.body.filter(Boolean).map((b) => ({ text: b, m: matchText(b, p.terms) }));
  const found = p.terms.map((_, i) => t.found[i] || bodies.some((b) => b.m.found[i]));
  const covered = found.filter(Boolean).length;
  const inTitle = t.found.filter(Boolean).length;
  const ft = fold(doc.title).trim();
  const q = p.terms.map((x) => fold(x.text)).join(" ");
  let score = (100 * covered) / n + (45 * inTitle) / n + (8 * (t.exact + Math.max(0, ...bodies.map((b) => b.m.exact)))) / n;
  if (adjacent(doc.title, p.terms)) score += 25;
  else if (bodies.some((b) => adjacent(b.text, p.terms))) score += 10;
  if (ft === q) score += 30;
  else if (ft.startsWith(q)) score += 12;
  if (p.kind === kind) score += 60;
  // The excerpt comes from the body that holds the most terms, when the title does not hold them all.
  let snippet: string | null = null;
  let snippet_marks: Marks = [];
  const best = bodies.filter((b) => b.m.ranges.length).sort((a, b) => b.m.found.filter(Boolean).length - a.m.found.filter(Boolean).length)[0];
  if (best && inTitle < n) ({ text: snippet, marks: snippet_marks } = excerpt(best.text, best.m.ranges));
  // What the score adds beyond plain coverage: where and how the words matched.
  const bonus = score - (100 * covered) / n;
  return { score, bonus, found, title: t, snippet, snippet_marks };
}

function missingWords(p: ParsedFind, found: boolean[]): string[] {
  return p.terms.filter((_, i) => !found[i]).map((t) => t.text);
}

const round = (n: number) => Math.round(n * 100) / 100;

async function sourcesAndPassages(ctx: OpContext, p: ParsedFind, i: Input, q: string): Promise<{ results: FindResult[]; passages: number; found: boolean[] }> {
  const pid = productId(ctx);
  const one = i.record_id ? sql`and r.record_id = ${i.record_id}` : sql``;
  const perTerm = p.terms.map((t) => sql`(s.tsv @@ to_tsquery('simple', ${termTsquery(t)}))::int`);
  const cov = sql.join(perTerm, sql` + `);
  const limit = i.record_id ? 200 : 400;
  const [hits, counts, titled] = await Promise.all([
    sql<{ record_id: string; seq: number; text: string; speaker: string | null; start_ms: string | null; cov: number; rank: number }>`
      select s.record_id, s.seq, s.text, s.speaker, s.start_ms, ${cov} as cov, ts_rank_cd(s.tsv, q.q, 32)::float as rank
      from segments s join records r on r.record_id = s.record_id, (select to_tsquery('simple', ${q}) as q) q
      where s.is_current and r.product_id = ${pid} and r.archived_at is null ${one} and s.tsv @@ q.q
      order by cov desc, rank desc, s.record_id desc, s.seq
      limit ${limit}`.execute(ctx.db),
    sql<{ n: number; found: boolean[] }>`
      select count(*)::int as n, array[${sql.join(p.terms.map((t) => sql`coalesce(bool_or(s.tsv @@ to_tsquery('simple', ${termTsquery(t)})), false)`))}] as found
      from segments s join records r on r.record_id = s.record_id
      where s.is_current and r.product_id = ${pid} and r.archived_at is null ${one} and s.tsv @@ to_tsquery('simple', ${q})`.execute(ctx.db),
    i.kind === "passage"
      ? Promise.resolve({ rows: [] as { record_id: string; title: string; date: string | null; tags: string[] }[] })
      : sql<{ record_id: string; title: string; date: string | null; tags: string[] }>`
      select r.record_id, r.title, r.date, r.tags from records r
      where r.product_id = ${pid} and r.archived_at is null ${one}
        and to_tsvector('simple', r.title || ' ' || array_to_string(r.tags, ' ')) @@ to_tsquery('simple', ${q})`.execute(ctx.db),
  ]);
  const ids = new Set([...hits.rows.map((h) => h.record_id), ...titled.rows.map((r) => r.record_id)]);
  const meta = ids.size
    ? await ctx.db.selectFrom("records").select(["record_id", "title", "date", "tags"]).where("record_id", "in", [...ids]).execute()
    : [];
  const byRecord = new Map<string, { hit: Hit; m: TextMatch }[]>();
  for (const h of hits.rows) {
    const m = matchText(h.text, p.terms);
    const ex = excerpt(h.text, m.ranges, 240);
    const hit = { seq: h.seq, speaker: h.speaker, start_ms: h.start_ms === null ? null : Number(h.start_ms), text: ex.text, marks: ex.marks, found: m.found.filter(Boolean).length };
    byRecord.set(h.record_id, [...(byRecord.get(h.record_id) ?? []), { hit, m }]);
  }
  const n = p.terms.length;
  const results: FindResult[] = meta.map((r) => {
    const own = byRecord.get(r.record_id) ?? [];
    const s = scoreDoc({ title: r.title, body: [r.tags.join(" ")] }, p, "source");
    // A source holds a word if its title, its tags or any of its passages does.
    const found = p.terms.map((_, k) => s.found[k] || own.some((o) => o.m.found[k]));
    const best = own.reduce((a, o) => Math.max(a, o.hit.found), 0);
    let score = (100 * found.filter(Boolean).length) / n + s.bonus + Math.min(own.length, 20) * 1.2 + (best === n && n > 1 ? 12 : 0);
    if (own.some((o) => adjacent(o.hit.text, p.terms))) score += 10;
    if (p.kind === "passage" && own.length) score += 60;
    const ranked = own.map((o) => o.hit).sort((a, b) => b.found - a.found || a.seq - b.seq);
    return {
      kind: "source",
      id: r.record_id,
      title: r.title,
      title_marks: s.title.ranges,
      snippet: null,
      snippet_marks: [],
      missing: missingWords(p, found),
      score: round(score),
      meta: { date: r.date, tags: r.tags },
      hits: (i.record_id ? ranked : ranked.slice(0, 3)).map(({ found: _f, ...h }) => h),
      hit_count: own.length,
    };
  });
  return { results, passages: counts.rows[0]?.n ?? 0, found: (counts.rows[0]?.found ?? []).map((f, k) => f || titled.rows.some((r) => matchText(`${r.title} ${r.tags.join(" ")}`, p.terms).found[k])) };
}

async function smallKinds(ctx: OpContext, p: ParsedFind, i: Input, q: string): Promise<FindResult[]> {
  const pid = productId(ctx);
  const want = (k: FindKind) => !i.record_id && (!i.kind || i.kind === k);
  const tsq = sql`to_tsquery('simple', ${q})`;
  const [assumptions, outcomes, mockups, story, idea] = await Promise.all([
    want("assumption")
      ? sql<{ entry_id: string; statement: string; body: string; status: string; citation_count: number }>`
        select entry_id, statement, body, status, jsonb_array_length(citations)::int as citation_count from register_entries
        where product_id = ${pid} and kind = 'assumption' and archived_at is null and tsv @@ ${tsq}`.execute(ctx.db)
      : null,
    want("outcome")
      ? sql<{ outcome_id: string; title: string; description: string; status: string }>`
        select outcome_id, title, description, status from outcomes
        where product_id = ${pid} and status <> 'archived' and to_tsvector('simple', title || ' ' || description) @@ ${tsq}`.execute(ctx.db)
      : null,
    want("mockup")
      ? sql<{ mockup_id: string; title: string; summary: string; brief: string; page_id: string | null; page_title: string | null; notes: string | null; text: string | null }>`
        select * from (
          select m.mockup_id, m.title, m.summary, v.brief, pg.page_id, pg.title as page_title, pg.notes, ${htmlText(sql`pg.html`)} as text, pg.position
          from mockups m join mockup_versions v on v.version_id = m.current_version_id
            left join mockup_pages pg on pg.version_id = v.version_id
          where m.product_id = ${pid} and m.archived_at is null) x
        where to_tsvector('simple', x.title || ' ' || x.summary || ' ' || x.brief || ' ' || coalesce(x.page_title, '') || ' ' || coalesce(x.notes, '') || ' ' || coalesce(x.text, '')) @@ ${tsq}
        order by x.position`.execute(ctx.db)
      : null,
    want("story")
      ? sql<{ page_id: string; title: string; summary: string; text: string }>`
        select * from (
          select sp.page_id, sp.title, sp.summary, ${htmlText(sql`v.html`)} as text
          from story_pages sp join story_versions v on v.version_id = sp.current_version_id
          where sp.product_id = ${pid} and sp.archived_at is null) x
        where to_tsvector('simple', x.title || ' ' || x.summary || ' ' || x.text) @@ ${tsq}`.execute(ctx.db)
      : null,
    want("idea") ? ctx.db.selectFrom("products").select(["concept"]).where("product_id", "=", pid).executeTakeFirst() : null,
  ]);
  const out: FindResult[] = [];
  const push = (kind: FindResult["kind"], idv: string, doc: Doc, meta: Record<string, unknown>) => {
    const s = scoreDoc(doc, p, kind);
    if (!s.found.some(Boolean)) return;
    out.push({ kind, id: idv, title: doc.title, title_marks: s.title.ranges, snippet: s.snippet, snippet_marks: s.snippet_marks, missing: missingWords(p, s.found), score: round(s.score), meta });
  };
  for (const a of assumptions?.rows ?? []) push("assumption", a.entry_id, { title: a.statement, body: [a.body] }, { status: a.status, citation_count: a.citation_count });
  for (const o of outcomes?.rows ?? []) push("outcome", o.outcome_id, { title: o.title, body: [o.description] }, { status: o.status });
  // A mockup is one result; the page that matches best is the one it opens on.
  const byMockup = new Map<string, NonNullable<typeof mockups>["rows"]>();
  for (const m of mockups?.rows ?? []) byMockup.set(m.mockup_id, [...(byMockup.get(m.mockup_id) ?? []), m]);
  for (const [mid, pages] of byMockup) {
    const first = pages[0]!;
    const scored = pages.map((pg) => ({ pg, s: scoreDoc({ title: first.title, body: [first.summary, pg.page_title ?? "", pg.notes ?? "", pg.text ?? "", first.brief] }, p, "mockup") }));
    scored.sort((a, b) => b.s.score - a.s.score);
    const top = scored[0]!;
    const found = p.terms.map((_, k) => scored.some((x) => x.s.found[k]));
    out.push({
      kind: "mockup",
      id: mid,
      title: first.title,
      title_marks: top.s.title.ranges,
      snippet: top.s.snippet,
      snippet_marks: top.s.snippet_marks,
      missing: missingWords(p, found),
      score: round(top.s.score + (100 * (found.filter(Boolean).length - top.s.found.filter(Boolean).length)) / p.terms.length),
      // Open on the page only when the words are on it, not just in the mockup's title or brief.
      meta: { ...(matchText(`${top.pg.page_title ?? ""} ${top.pg.notes ?? ""} ${top.pg.text ?? ""}`, p.terms).found.some(Boolean) ? { page_id: top.pg.page_id, page_title: top.pg.page_title } : {}), pages: pages.length },
    });
  }
  for (const s of story?.rows ?? []) push("story", s.page_id, { title: s.title, body: [s.summary, s.text] }, {});
  if (idea?.concept) push("idea", pid, { title: "Product concept", body: [idea.concept] }, {});
  return out;
}

/** Words that matched nothing anywhere, each replaced by the closest word the product does hold. */
async function corrections(ctx: OpContext, p: ParsedFind, found: boolean[], typing: boolean): Promise<{ from: string; to: string }[]> {
  const pid = productId(ctx);
  // A finished word of three letters is too short to guess at; one still being typed is not.
  const lost = p.terms.map((t, k) => ({ t, k })).filter(({ t, k }) => !found[k] && !t.phrase && fold(t.text).length >= (typing && k === p.terms.length - 1 ? 3 : 4));
  if (!lost.length) return [];
  const titles = await sql<{ t: string }>`
    select title as t from records where product_id = ${pid} and archived_at is null
    union all select statement from register_entries where product_id = ${pid} and archived_at is null
    union all select title from outcomes where product_id = ${pid}
    union all select title from mockups where product_id = ${pid} and archived_at is null
    union all select title from story_pages where product_id = ${pid} and archived_at is null`.execute(ctx.db);
  const out: { from: string; to: string }[] = [];
  // Looser than the default 0.6, so a swapped or missing letter in a short word still finds candidates.
  await sql`select set_config('pg_trgm.word_similarity_threshold', '0.4', true)`.execute(ctx.db);
  for (const { t, k } of lost) {
    const near = await sql<{ text: string }>`
      select s.text from segments s join records r on r.record_id = s.record_id
      where s.is_current and r.product_id = ${pid} and r.archived_at is null and ${t.text} <% s.text
      limit 40`.execute(ctx.db);
    const last = typing && k === p.terms.length - 1;
    const to = closestWord(t.text, [...near.rows.map((r) => r.text), ...titles.rows.map((r) => r.t)], last);
    if (to) out.push({ from: t.text, to });
  }
  return out;
}

async function run(ctx: OpContext, p: ParsedFind, i: Input) {
  const q = p.terms.map(termTsquery).map((x) => `(${x})`).join(" | ");
  const [sp, small] = await Promise.all([
    !i.kind || i.kind === "source" || i.kind === "passage" ? sourcesAndPassages(ctx, p, i, q) : Promise.resolve({ results: [], passages: 0, found: p.terms.map(() => false) }),
    smallKinds(ctx, p, i, q),
  ]);
  const all = [...sp.results, ...small];
  const found = p.terms.map((_, k) => sp.found[k] || all.some((r) => !r.missing.includes(p.terms[k]!.text)));
  return { all, passages: sp.passages, found };
}

export const PLAIN_DESCRIPTION =
  "mode \"plain\" searches everything in the product the way a person types into a search box, ranked: sources with their best passages, assumptions, outcomes, mockups, Story pages and the product concept. Words match in any order, each at the start of a word; endings are forgiven (\"pricing\" finds price and priced); the last word matches as a prefix; \"quoted words\" match as a phrase; small words (the, of, how) are skipped; a word that matches nothing is replaced by the closest word the product holds, and `corrections` says so (`strict: true` turns that off). When nothing holds every word, results hold most of them and list the `missing` ones. It takes `kind` and `record_id`, not the date, tag or dimension filters.";

export async function plainSearch(ctx: OpContext, i: PlainInput) {
  let p = parseFind(i.query);
  const typing = !/[\s"]$/.test(i.query);
  const empty = { query: i.query, terms: [], ignored: p.ignored, kind_hint: p.kind, corrections: [], partial: false, counts: {}, results: [] };
  if (!p.terms.length) return empty;
  let r = await run(ctx, p, i);
  let fixed: { from: string; to: string }[] = [];
  if (!i.strict && r.found.some((f) => !f)) {
    fixed = await corrections(ctx, p, r.found, typing);
    if (fixed.length) {
      p = {
        ...p,
        terms: p.terms.map((t) => {
          const c = fixed.find((f) => f.from === t.text);
          return c ? { ...t, text: c.to, root: wordRoot(c.to), prefix: true } : t;
        }),
      };
      r = await run(ctx, p, i);
    }
  }
  // When something holds every word, show only those; otherwise the ones holding the most.
  const complete = r.all.filter((x) => !x.missing.length);
  const partial = !complete.length && r.all.length > 0;
  const shown = (partial ? r.all : complete).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const counts: Partial<Record<FindKind, number>> = {};
  for (const x of shown) counts[x.kind] = (counts[x.kind] ?? 0) + 1;
  counts.passage = shown.reduce((n, x) => n + (x.hit_count ?? 0), 0);
  return {
    query: i.query,
    terms: p.terms.map((t) => ({ text: t.text, phrase: t.phrase })),
    ignored: p.ignored,
    kind_hint: p.kind,
    corrections: fixed,
    partial,
    counts,
    passages_matched: r.passages,
    results: shown.slice(0, i.record_id ? 1 : 60),
  };
}
