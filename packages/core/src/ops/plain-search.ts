import { sql, type RawBuilder } from "kysely";
import { productId } from "../common.ts";
import type { MockupPageRef } from "../db.ts";
import { findCount, findPattern, findWords } from "../find-in-text.ts";
import { closestWord, excerpt, findTsquery, fold, idLike, matchText, parseFind, swappedLettersTsquery, termPattern, termTsquery, wordRoot, type FindKind, type FindTerm, type ParsedFind, type TextMatch } from "../plain-query.ts";
import { readsOnlyTheStory } from "../policy.ts";
import type { OpContext } from "../registry.ts";

/**
 * Plain search (`search` with `mode: "plain"`): one search over everything in a product, read the way a person means it (see
 * plain-query.ts), ranked, and grouped so a source shows up once with the best places it says
 * the words: its derived text, summary, notes or comments. Lexical and deterministic: no model and
 * no embeddings. It reads stored text and search vectors, a page's words among them
 * (`html_search_text` in the migrations), and never a page's HTML. What has no stored vector goes
 * through `words_search_vector`, as a page's words do, so no text takes a search longer than its length
 * says.
 */

export const FIND_KINDS = ["idea", "outcome", "source", "assumption", "mockup", "story"] as const satisfies readonly FindKind[];

/** What plain search takes: the words, and optionally one kind, one source, or no correcting. */
export interface PlainInput {
  query: string;
  kind?: FindKind;
  record_id?: string;
  strict: boolean;
  /** How many results at most, the best first. */
  limit: number;
}

/** How many results plain search returns when the call does not say. */
export const PLAIN_LIMIT = 60;

type Input = PlainInput;

type Marks = [number, number][];

/** Where a source says the words: a piece of its derived text, summary, notes or one comment. */
interface Hit {
  field: "summary" | "notes" | "text" | "comment";
  /** The comment's id, for a hit in a comment. */
  annotation_id: string | null;
  /** Where the piece starts in its field, in code points. */
  char_start: number;
  /** Where the first match the excerpt marks starts in its field, in code points: where the piece starts when it marks none. */
  match_start: number;
  text: string;
  marks: Marks;
  found: number;
}

export interface FindResult {
  kind: FindKind;
  id: string;
  title: string;
  title_marks: Marks;
  /** The best excerpt of the text that matched, if the title alone does not say why it is here. */
  snippet: string | null;
  snippet_marks: Marks;
  /** Words this result does not contain. */
  missing: string[];
  score: number;
  /** Kind-specific: a source's date and tags, an assumption's status, a mockup page. */
  meta: Record<string, unknown>;
  /** Where a source says the words, best first, and how many places there are. */
  hits?: Omit<Hit, "found">[];
  hit_count?: number;
  /**
   * How many times a source's derived text says the words, counted as its Find in the text counts
   * them for the same words: the number the web app shows as "N matches". Left out when counting
   * would read past COUNT_PIECES_MAX pieces, rather than given short.
   */
  match_count?: number;
}

/**
 * What shows as written: a backslash escape, as the ASCII punctuation it escapes, and a code span
 * (a run of backticks, what it holds, and a run as long), as what it holds (CommonMark). One pass
 * reads both, so an escaped backtick opens no code span and nothing in a code span is an escape.
 */
const AS_WRITTEN = /\\([!-\/:-@[-`{-~])|(?<!`)(`+)(?!`)([^\n]*?[^`\n])\2(?!`)/g;
/** A line that opens or closes a fenced code block, its language with it. */
const FENCE = /^[ \t]*(?:`{3,}|~{3,})[^`\n]*$/gm;
/** A link or an image, `[text](address "title")`: its text stays, as a reader sees it, and the rest goes. */
const LINK = /!?\[([^[\]\n]*)\]\((?:<[^<>\n]*>|(?:[^()\s]|\([^()\s]*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\)/g;
/**
 * Italics, `*words*` and `_words_`: a marker that opens before a word and one that closes after
 * one, on one line, and neither inside a word, so `snake_case` and `2*3*4` stay as written.
 */
const STAR_EM = /(?<![*\p{L}\p{N}])\*(?![\s*])([^*\n]*?[^\s*])\*(?![*\p{L}\p{N}])/gu;
const UNDERSCORE_EM = /(?<![_\p{L}\p{N}])_(?![\s_])([^_\n]*?[^\s_])_(?![_\p{L}\p{N}])/gu;
/** What shows as written stands here while the rest is read, by its place in the list it is held in. A stored text never holds a null character. */
const HELD = /\u0000(\d+)\u0000/g;

/**
 * A piece of Markdown as a reader sees its words, for an excerpt: heading marks, the marks before
 * a list item or a quoted line, a table's rule row and a code fence's lines dropped, bold, italics
 * and a code span's backticks dropped (what a code span holds shows as written), a link or an
 * image shown as its text, and an escaped character shown without its backslash, never taken for
 * markup. Every Markdown text plain search shows an excerpt of goes through it: a source's, an
 * assumption's body, an outcome's description, a mockup's brief and notes, the product concept. An
 * excerpt and its marks are made from what it returns, so the marks fall on the words shown.
 * Single passes over a piece of at most a few thousand characters.
 */
export function shownWords(md: string): string {
  const held: string[] = [];
  const shown = md
    .replace(/\u0000/g, "")
    .replace(/^[ \t|:]*-{3,}[-:| \t]*$/gm, "")
    .replace(FENCE, "")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*(?:>[ \t]?|[-*+][ \t]+)+/gm, "")
    .replace(AS_WRITTEN, (_m, escaped: string | undefined, _ticks: string | undefined, code: string | undefined) => `\u0000${held.push(escaped ?? code ?? "") - 1}\u0000`)
    .replace(LINK, "$1")
    .replace(/\*\*|__/g, "")
    .replace(STAR_EM, "$1")
    .replace(UNDERSCORE_EM, "$1");
  return held.length ? shown.replace(HELD, (_m, i: string) => held[Number(i)] ?? "") : shown;
}

/**
 * Where a place in `shownWords(written)` stands in `written`, in code points. Showing a text's words
 * only takes characters out, so what is shown is what is written with some left out, in order, and
 * walking the two together finds the place. A character left out that happens to be the next one
 * shown (in a link's address, say) is taken for it only until the next that the rest does not hold,
 * such as a space, so a place can fall short only within what is not shown.
 */
function writtenOffset(written: string, shown: string, at: number): number {
  let w = 0;
  for (let s = 0; s <= at; s++, w++) while (w < written.length && written[w] !== shown[s]) w++;
  return [...written.slice(0, w - 1)].length;
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

function scoreDoc(doc: Doc, p: ParsedFind) {
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
  // The excerpt comes from the body that holds the most terms, when the title does not hold them all.
  let snippet: string | null = null;
  let snippet_marks: Marks = [];
  const best = bodies.filter((b) => b.m.ranges.length).sort((a, b) => b.m.found.filter(Boolean).length - a.m.found.filter(Boolean).length)[0];
  if (best && inTitle < n) ({ text: snippet, marks: snippet_marks } = excerpt(best.text, best.m));
  // What the score adds beyond plain coverage: where and how the words matched.
  const bonus = score - (100 * covered) / n;
  return { score, bonus, found, title: t, snippet, snippet_marks };
}

function missingWords(p: ParsedFind, found: boolean[]): string[] {
  return p.terms.filter((_, i) => !found[i]).map((t) => t.text);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Sources that match beyond the pieces results are built from: how many hold any of the words, and how many hold them all. */
interface Beyond {
  any: number;
  all: number;
}

/**
 * Plain search's sources: each built from the best pieces that say the words (at most `limit` of
 * them) and from its title and tags, with how many pieces matched and which words anything holds.
 * When more pieces matched than were read, the sources the rest belong to are counted in the
 * database (`beyond`), so the counts cover every source that matched.
 */
async function sources(ctx: OpContext, p: ParsedFind, i: Input, q: string): Promise<{ results: FindResult[]; hits: number; found: boolean[]; beyond: Beyond }> {
  const pid = productId(ctx);
  const one = i.record_id ? sql`and r.record_id = ${i.record_id}` : sql``;
  const perTerm = p.terms.map((t) => sql`(c.tsv @@ to_tsquery('simple', ${termTsquery(t)}))::int`);
  const cov = sql.join(perTerm, sql` + `);
  const limit = i.record_id ? 200 : 400;
  // The pieces search reads beyond a source's title and tags; an archived comment is not among them.
  const live = sql`r.product_id = ${pid} and r.archived_at is null ${one} and c.field not in ('title', 'tags') and (c.field <> 'comment' or a.archived_at is null)`;
  const [hits, counts, titled] = await Promise.all([
    sql<{ record_id: string; field: Hit["field"]; ref: string; char_start: number; text: string; cov: number; rank: number }>`
      select c.record_id, c.field, c.ref, c.char_start, c.text, ${cov} as cov, ts_rank_cd(c.tsv, q.q, 32)::float as rank
      from text_chunks c join records r on r.record_id = c.record_id
        left join annotations a on c.field = 'comment' and a.annotation_id = c.ref,
        (select to_tsquery('simple', ${q}) as q) q
      where ${live} and c.tsv @@ q.q
      order by cov desc, rank desc, c.record_id desc, c.field, c.ref, c.n
      limit ${limit}`.execute(ctx.db),
    sql<{ n: number; found: boolean[] }>`
      select count(*)::int as n, array[${sql.join(p.terms.map((t) => sql`coalesce(bool_or(c.tsv @@ to_tsquery('simple', ${termTsquery(t)})), false)`))}] as found
      from text_chunks c join records r on r.record_id = c.record_id
        left join annotations a on c.field = 'comment' and a.annotation_id = c.ref
      where ${live} and c.tsv @@ to_tsquery('simple', ${q})`.execute(ctx.db),
    sql<{ record_id: string; title: string; date: string | null; tags: string[] }>`
      select r.record_id, r.title, r.date, r.tags from records r
      where r.product_id = ${pid} and r.archived_at is null ${one}
        and words_search_vector(r.title || ' ' || array_to_string(r.tags, ' ')) @@ to_tsquery('simple', ${q})`.execute(ctx.db),
  ]);
  const ids = new Set([...hits.rows.map((h) => h.record_id), ...titled.rows.map((r) => r.record_id)]);
  const beyond = hits.rows.length < limit || i.record_id ? { any: 0, all: 0 } : await sourcesBeyond(ctx, p, q, live, [...ids]);
  const meta = ids.size
    ? await ctx.db.selectFrom("records").select(["record_id", "title", "date", "tags"]).where("record_id", "in", [...ids]).execute()
    : [];
  const byRecord = new Map<string, { hit: Hit; m: TextMatch }[]>();
  for (const h of hits.rows) {
    const shown = shownWords(h.text);
    const m = matchText(shown, p.terms);
    const ex = excerpt(shown, m, 240);
    const match_start = h.char_start + (ex.first === null ? 0 : writtenOffset(h.text, shown, ex.first));
    const hit: Hit = { field: h.field, annotation_id: h.field === "comment" ? h.ref : null, char_start: h.char_start, match_start, text: ex.text, marks: ex.marks, found: m.found.filter(Boolean).length };
    byRecord.set(h.record_id, [...(byRecord.get(h.record_id) ?? []), { hit, m }]);
  }
  const n = p.terms.length;
  // The derived text first among equals: it is the source's own words.
  const order: Record<Hit["field"], number> = { text: 0, summary: 1, notes: 2, comment: 3 };
  const results: FindResult[] = meta.map((r) => {
    const own = byRecord.get(r.record_id) ?? [];
    const s = scoreDoc({ title: r.title, body: [r.tags.join(" ")] }, p);
    // A source holds a word if its title, its tags or anything it says does.
    const found = p.terms.map((_, k) => s.found[k] || own.some((o) => o.m.found[k]));
    const best = own.reduce((a, o) => Math.max(a, o.hit.found), 0);
    let score = (100 * found.filter(Boolean).length) / n + s.bonus + Math.min(own.length, 20) * 1.2 + (best === n && n > 1 ? 12 : 0);
    if (own.some((o) => adjacent(o.hit.text, p.terms))) score += 10;
    const ranked = own.map((o) => o.hit).sort((a, b) => b.found - a.found || order[a.field] - order[b.field] || a.char_start - b.char_start);
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
  return {
    results,
    hits: counts.rows[0]?.n ?? 0,
    found: (counts.rows[0]?.found ?? []).map((f, k) => f || titled.rows.some((r) => matchText(`${r.title} ${r.tags.join(" ")}`, p.terms).found[k])),
    beyond,
  };
}

/**
 * The sources whose matching pieces all lie beyond the ones results were built from, counted by
 * what their pieces hold. Their titles and tags hold none of the words, or they would be among the
 * results.
 */
async function sourcesBeyond(ctx: OpContext, p: ParsedFind, q: string, live: RawBuilder<unknown>, built: string[]): Promise<Beyond> {
  const holds = p.terms.map((t, k) => sql`bool_or(c.tsv @@ to_tsquery('simple', ${termTsquery(t)})) as ${sql.ref(`t${k}`)}`);
  const every = sql.join(p.terms.map((_, k) => sql.ref(`t${k}`)), sql` and `);
  const r = await sql<Beyond>`
    select count(*)::int as "any", (count(*) filter (where ${every}))::int as "all"
    from (
      select ${sql.join(holds)}
      from text_chunks c join records r on r.record_id = c.record_id
        left join annotations a on c.field = 'comment' and a.annotation_id = c.ref
      where ${live} and c.tsv @@ to_tsquery('simple', ${q}) and not (c.record_id = any(${built}::text[]))
      group by c.record_id
    ) x`.execute(ctx.db);
  return r.rows[0] ?? { any: 0, all: 0 };
}

/** One page of something shown across pages, as search reads it. */
interface ShownPage {
  page_id: string | null;
  page_title: string | null;
  /** What the page itself says, in the order an excerpt should prefer it, ahead of its title. */
  says: string[];
}

async function smallKinds(ctx: OpContext, p: ParsedFind, i: Input, q: string): Promise<FindResult[]> {
  const pid = productId(ctx);
  const want = (k: FindKind) => !i.record_id && (!i.kind || i.kind === k);
  const tsq = sql`to_tsquery('simple', ${q})`;
  const [assumptions, outcomes, mockups, story, idea] = await Promise.all([
    want("assumption")
      ? sql<{ entry_id: string; statement: string; body: string; status: string }>`
        select entry_id, statement, body, status from register_entries
        where product_id = ${pid} and kind = 'assumption' and archived_at is null and tsv @@ ${tsq}`.execute(ctx.db)
      : null,
    want("outcome")
      ? sql<{ outcome_id: string; title: string; description: string }>`
        select outcome_id, title, description from outcomes
        where product_id = ${pid} and archived_at is null and words_search_vector(title || ' ' || description) @@ ${tsq}`.execute(ctx.db)
      : null,
    want("mockup")
      // What a mockup says of itself is read once, however many pages it has.
      ? sql<{ mockup_id: string; title: string; summary: string; brief: string; page_id: string | null; page_title: string | null; notes: string | null; text: string | null }>`
        with own as materialized (
          select m.mockup_id, m.title, m.summary, v.version_id, v.brief, words_search_vector(m.title || ' ' || m.summary || ' ' || v.brief) @@ ${tsq} as holds
          from mockups m join mockup_versions v on v.version_id = m.current_version_id
          where m.product_id = ${pid} and m.archived_at is null
        )
        select own.mockup_id, own.title, own.summary, own.brief, pg.page_id, pg.title as page_title, pg.notes, pg.search_text as text
        from own left join mockup_pages pg on pg.version_id = own.version_id
        where own.holds or pg.tsv @@ ${tsq} or words_search_vector(coalesce(pg.title, '') || ' ' || coalesce(pg.notes, '')) @@ ${tsq}
        order by pg.position`.execute(ctx.db)
      : null,
    want("story")
      // What a Story page shows: its own words, or those of the mockup page or whole canvas at the
      // version it points at. Only a canvas's page titles are read, since a reader sees those alone;
      // a mockup's brief and notes never are.
      ? sql<{ page_id: string; title: string; summary: string; text: string; mockup: MockupPageRef | null; shown_id: string | null; shown_title: string | null; shown_text: string | null }>`
        select sp.page_id, sp.title, sp.summary, v.search_text as text, v.mockup, pg.page_id as shown_id, pg.title as shown_title, pg.search_text as shown_text
        from story_pages sp join story_versions v on v.version_id = sp.current_version_id
          left join mockup_pages pg on pg.version_id = v.mockup->>'mockup_version_id' and (v.mockup->>'page_id' is null or pg.page_id = v.mockup->>'page_id')
        where sp.product_id = ${pid} and sp.archived_at is null
          and (v.tsv @@ ${tsq} or pg.tsv @@ ${tsq} or words_search_vector(sp.title || ' ' || sp.summary || ' ' || case when v.mockup->>'page_id' is null then coalesce(pg.title, '') else '' end) @@ ${tsq})
        order by pg.position`.execute(ctx.db)
      : null,
    want("idea") ? ctx.db.selectFrom("products").select(["concept"]).where("product_id", "=", pid).executeTakeFirst() : null,
  ]);
  const out: FindResult[] = [];
  const push = (kind: FindResult["kind"], idv: string, doc: Doc, meta: Record<string, unknown>) => {
    const s = scoreDoc(doc, p);
    if (!s.found.some(Boolean)) return;
    out.push({ kind, id: idv, title: doc.title, title_marks: s.title.ranges, snippet: s.snippet, snippet_marks: s.snippet_marks, missing: missingWords(p, s.found), score: round(s.score), meta });
  };
  // What is Markdown is read as its words, as a source's text is.
  for (const a of assumptions?.rows ?? []) push("assumption", a.entry_id, { title: a.statement, body: [shownWords(a.body)] }, { status: a.status });
  for (const o of outcomes?.rows ?? []) push("outcome", o.outcome_id, { title: o.title, body: [shownWords(o.description)] }, {});
  // A mockup is one result, scored by its best page. Its summary and brief count on every page, so
  // they cannot say which page it opens on: that is the page saying the most of the words itself, and
  // of those the one whose title says them best, as a result's own title is scored.
  const best = (title: string, own: { summary: string; brief?: string }, pages: ShownPage[]) => {
    const scored = pages.map((pg) => ({
      pg,
      s: scoreDoc({ title, body: [own.summary, ...pg.says, own.brief ?? ""] }, p),
      said: scoreDoc({ title: "", body: pg.says }, p).found.filter(Boolean).length,
      titled: scoreDoc({ title: pg.page_title ?? "", body: [] }, p).score,
    }));
    scored.sort((a, b) => b.s.score - a.s.score);
    const top = scored[0]!;
    const opens = [...scored].sort((a, b) => b.said - a.said || b.titled - a.titled || b.s.score - a.s.score)[0]!;
    const found = p.terms.map((_, k) => scored.some((x) => x.s.found[k]));
    // A page it names is what it quotes, or the summary when that says as many of the words; the brief
    // is quoted only when no page says any of them.
    const quote = opens.said ? scoreDoc({ title, body: [own.summary, ...opens.pg.says] }, p) : opens.s;
    return {
      found,
      result: {
        title,
        title_marks: top.s.title.ranges,
        snippet: quote.snippet,
        snippet_marks: quote.snippet_marks,
        missing: missingWords(p, found),
        score: round(top.s.score + (100 * (found.filter(Boolean).length - top.s.found.filter(Boolean).length)) / p.terms.length),
      },
      page: opens.said ? { page_id: opens.pg.page_id, page_title: opens.pg.page_title } : {},
    };
  };
  const byMockup = new Map<string, NonNullable<typeof mockups>["rows"]>();
  for (const m of mockups?.rows ?? []) byMockup.set(m.mockup_id, [...(byMockup.get(m.mockup_id) ?? []), m]);
  const heldByMockup = new Map<string, { found: boolean[]; result: FindResult; named: boolean }>();
  for (const [mid, pages] of byMockup) {
    const first = pages[0]!;
    const b = best(first.title, { summary: first.summary, brief: shownWords(first.brief) }, pages.map((pg) => ({
      page_id: pg.page_id,
      page_title: pg.page_title,
      says: [shownWords(pg.notes ?? ""), pg.text ?? "", pg.page_title ?? ""],
    })));
    const result: FindResult = { kind: "mockup", id: mid, ...b.result, meta: { ...b.page, pages: pages.length } };
    heldByMockup.set(mid, { found: b.found, result, named: "page_id" in b.page });
    out.push(result);
  }
  // One result for each Story page, a whole canvas's pages among them. A page from a mockup is one
  // thing in two places, so whoever finds the mockup finds it there, in Exploration: the Story page
  // is listed too only for a word the mockup does not hold, its own title, say, or one the version it
  // stays on has and the current version does not. A reader is given no mockups, so a reader finds
  // it on the Story.
  const byPage = new Map<string, NonNullable<typeof story>["rows"]>();
  for (const s of story?.rows ?? []) byPage.set(s.page_id, [...(byPage.get(s.page_id) ?? []), s]);
  // A mockup page with a Story page of its own is found there, not again on a canvas that holds it at the same version.
  const shownAlone = new Set([...byPage.values()].flatMap(([s]) => (s!.mockup?.page_id ? [`${s!.mockup.mockup_version_id}:${s!.mockup.page_id}`] : [])));
  for (const [id, rows] of byPage) {
    const first = rows[0]!;
    const canvas = first.mockup?.page_id === null;
    const onCanvas = canvas ? rows.filter((r) => !shownAlone.has(`${first.mockup!.mockup_version_id}:${r.shown_id}`)) : rows;
    const b = best(first.title, { summary: first.summary }, (onCanvas.length ? onCanvas : [{ ...first, shown_id: null, shown_title: null, shown_text: null }]).map((r) => ({
      page_id: r.shown_id,
      page_title: r.shown_title,
      says: [(first.mockup ? r.shown_text : r.text) ?? "", canvas ? (r.shown_title ?? "") : ""],
    })));
    if (!b.found.some(Boolean)) continue;
    const held = first.mockup ? heldByMockup.get(first.mockup.mockup_id) : undefined;
    if (held && b.found.every((f, k) => !f || held.found[k])) {
      // It ranks as the Story page would have, whose title may be the words searched for. The page it
      // names is still its own for those words, and the excerpt is from that page; only when none of
      // its pages says them does it open on the page shown here, if the current version still has it:
      // a mockup's result speaks of its current version, wherever the Story page stays.
      if (b.result.score > held.result.score) {
        held.result.score = b.result.score;
        const pageId = first.mockup?.page_id;
        const shown = pageId && !held.named ? byMockup.get(first.mockup!.mockup_id)?.find((r) => r.page_id === pageId) : undefined;
        if (shown) held.result.meta = { ...held.result.meta, page_id: shown.page_id, page_title: shown.page_title };
      }
      continue;
    }
    out.push({ kind: "story", id, ...b.result, meta: canvas ? b.page : {} });
  }
  if (idea?.concept) push("idea", pid, { title: "Product concept", body: [shownWords(idea.concept)] }, {});
  return out;
}

/** Words that matched nothing anywhere, each replaced by the closest word the product does hold. */
async function corrections(ctx: OpContext, p: ParsedFind, found: boolean[], typing: boolean): Promise<{ from: string; to: string }[]> {
  const pid = productId(ctx);
  // A finished word of three letters is too short to guess at; one still being typed is not. An id
  // or a number is never guessed at: one digit away is another thing.
  const lost = p.terms.map((t, k) => ({ t, k })).filter(({ t, k }) => !found[k] && !t.phrase && !idLike(t.text) && fold(t.text).length >= (typing && k === p.terms.length - 1 ? 3 : 4));
  if (!lost.length) return [];
  // A word offered back is a word the product holds, so a reader is offered only what the Story's titles say.
  const reader = readsOnlyTheStory(ctx.scope.role);
  const titles = reader
    ? await sql<{ t: string }>`select title as t from story_pages where product_id = ${pid} and archived_at is null`.execute(ctx.db)
    : await sql<{ t: string }>`
    select title as t from records where product_id = ${pid} and archived_at is null
    union all select statement from register_entries where product_id = ${pid} and archived_at is null
    union all select title from outcomes where product_id = ${pid}
    union all select title from mockups where product_id = ${pid} and archived_at is null
    union all select title from story_pages where product_id = ${pid} and archived_at is null`.execute(ctx.db);
  const out: { from: string; to: string }[] = [];
  // Looser than the default 0.6, so a missing letter in a short word still finds candidates. Looser
  // still would read every chunk with a word sharing its first two letters, in every organization.
  await sql`select set_config('pg_trgm.word_similarity_threshold', '0.4', true)`.execute(ctx.db);
  for (const { t, k } of lost) {
    const near = reader
      ? { rows: [] as { text: string }[] }
      : await sql<{ text: string }>`
      select c.text from text_chunks c join records r on r.record_id = c.record_id
      where r.product_id = ${pid} and r.archived_at is null and ${t.text} <% c.text
      limit 40`.execute(ctx.db);
    const swaps = swappedLettersTsquery(t.text);
    const swapped = reader || !swaps
      ? { rows: [] as { text: string }[] }
      : await sql<{ text: string }>`
      select c.text from text_chunks c join records r on r.record_id = c.record_id
      where r.product_id = ${pid} and r.archived_at is null and c.tsv @@ to_tsquery('simple', ${swaps})
      limit 10`.execute(ctx.db);
    const last = typing && k === p.terms.length - 1;
    const to = closestWord(t.text, [...near.rows.map((r) => r.text), ...swapped.rows.map((r) => r.text), ...titles.rows.map((r) => r.t)], last);
    if (to) out.push({ from: t.text, to });
  }
  return out;
}

async function run(ctx: OpContext, p: ParsedFind, i: Input) {
  const q = p.terms.map(termTsquery).map((x) => `(${x})`).join(" | ");
  const [sp, small] = await Promise.all([
    !i.kind || i.kind === "source" ? sources(ctx, p, i, q) : Promise.resolve({ results: [], hits: 0, found: p.terms.map(() => false), beyond: { any: 0, all: 0 } }),
    smallKinds(ctx, p, i, q),
  ]);
  const all = [...sp.results, ...small];
  const found = p.terms.map((_, k) => sp.found[k] || all.some((r) => !r.missing.includes(p.terms[k]!.text)));
  return { all, hits: sp.hits, found, beyond: sp.beyond };
}

/** How plain search reads the words it is given, whoever searches. */
const PLAIN_WORDS =
  "Words match in any order, each at the start of a word; endings are forgiven (\"pricing\" finds price and priced); the last word is taken as still being typed and matches as a prefix even when short, unless the query ends with a space; \"quoted words\" match as a phrase; an id or a number (CB26-20734, 2026-05-01, 2026) is one word, hyphens and all, matched as written, and one with a letter in it also as its words side by side (q3-planning finds \"Q3 planning\"); small words (the, of, how) are skipped;";
const PARTIAL_RESULTS = "When nothing holds every word, results hold most of them and list the `missing` ones.";

export const PLAIN_DESCRIPTION =
  "mode \"plain\" searches everything in the product the way a person types into a search box, ranked: sources, each with the best places it says the words (its derived text, summary, notes or comments; hits give the field, where the piece starts in char_start and where the first match its excerpt marks starts in match_start), how many places in hit_count, and in match_count how many times its derived text says them, as the source's Find in the text in the web app counts them, assumptions, outcomes, mockups, Story pages and the product concept. A Story page that shows a mockup page or a whole canvas is searched by what it shows at the version it stays on, and is left out when the mockup is among the results and holds every word it does, so one thing is listed once, as the mockup. A reader (the Story-only role) searches the Story alone: every Story page, by what it shows, and for a whole canvas meta gives the page the words are on; never the mockup's brief or notes. " +
  PLAIN_WORDS +
  " a word naming a kind (mockups, assumptions, sources, outcomes, story, idea), beside other words, is not searched for but lists that kind's results first, ahead of any that score higher, and `kind_hint` names it; a word that matches nothing is replaced by the closest word the product holds, and `corrections` says so (`strict: true` turns that off), but an id or a number is never corrected. " +
  PARTIAL_RESULTS +
  " At most `limit` results come back (60 unless you say), best first; `counts` says how many of each kind matched in all, so say so when more matched than came back. It takes `kind`, `record_id`, `strict` and `limit`, not the date or tag filters or a cursor.";

/** Plain search as someone who reads only the Story meets it: the Story, and what it does with their words. */
export const PLAIN_STORY_DESCRIPTION =
  "It reads every Story page, by what it shows, and takes words the way a person types them into a search box, best matches first; on a whole canvas, meta gives the page the words are on. It takes mode \"plain\", the one mode it answers here (any other is refused with 403), `kind` \"story\" or none, `strict` and `limit`. " +
  PLAIN_WORDS +
  " the word story, beside other words, is not searched for, and `kind_hint` names it; a word that matches nothing is replaced by the closest word in the Story pages' titles, and `corrections` says so (`strict: true` turns that off), but an id or a number is never corrected. " +
  PARTIAL_RESULTS +
  " At most `limit` results come back (60 unless you say), best first; `counts` says how many matched in all, so say so when more matched than came back.";

/** At most this many pieces of derived text are read to count matches, so a search for a common word stays quick. */
const COUNT_PIECES_MAX = 2000;

/**
 * Each source result's `match_count`: the matches its Find in the text marks for the words this
 * search read, counted in the pieces of its derived text that may hold one. Only the derived text
 * is counted, because the find marks only it. The pieces are read in the results' order, so the
 * best come first; a source the limit cuts, and those after it, are left without a count.
 */
async function countMatches(ctx: OpContext, p: ParsedFind, results: FindResult[]): Promise<void> {
  const sources = results.filter((r) => r.kind === "source");
  const pattern = findPattern(findWords(p.terms));
  if (!sources.length || !pattern) return;
  const ids = sources.map((r) => r.id);
  const q = p.terms.map((t) => `(${findTsquery(t)})`).join(" | ");
  const rows = await sql<{ record_id: string; text: string }>`
    select c.record_id, c.text from text_chunks c
    where c.record_id = any(${ids}::text[]) and c.field = 'text' and c.tsv @@ to_tsquery('simple', ${q})
    order by array_position(${ids}::text[], c.record_id), c.n
    limit ${COUNT_PIECES_MAX + 1}`.execute(ctx.db);
  const counts = new Map<string, number>();
  for (const r of rows.rows.slice(0, COUNT_PIECES_MAX)) counts.set(r.record_id, (counts.get(r.record_id) ?? 0) + findCount(r.text, pattern));
  const cut = rows.rows.length > COUNT_PIECES_MAX ? rows.rows[COUNT_PIECES_MAX]!.record_id : null;
  for (const r of sources) {
    if (r.id === cut) break;
    r.match_count = counts.get(r.id) ?? 0;
  }
}

export async function plainSearch(ctx: OpContext, asked: PlainInput) {
  // A reader has only the Story, so nothing else is searched for them, and only its word names a kind.
  const reader = readsOnlyTheStory(ctx.scope.role);
  const i = reader ? { ...asked, kind: "story" as const } : asked;
  let p = parseFind(i.query, reader ? "story" : undefined);
  const typing = !/[\s"]$/.test(i.query);
  const empty = { query: i.query, terms: [], ignored: p.ignored, kind_hint: p.kind, corrections: [], partial: false, counts: {}, hits_matched: 0, results: [] };
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
  // A kind the query names ("mockups jobs") comes first, whatever the others score, so every door
  // lists it first: the palette, the Search screen's areas and an agent alike.
  const named = (x: FindResult) => (x.kind === p.kind ? 0 : 1);
  const shown = (partial ? r.all : complete).sort((a, b) => named(a) - named(b) || b.score - a.score || a.title.localeCompare(b.title));
  const counts: Partial<Record<FindKind, number>> = {};
  for (const x of shown) counts[x.kind] = (counts[x.kind] ?? 0) + 1;
  // Sources matched beyond the pieces results come from count too: all of them for a partial
  // answer, else those that hold every word.
  const more = partial ? r.beyond.any : r.beyond.all;
  if (more) counts.source = (counts.source ?? 0) + more;
  // With record_id, that source is the only result there can be.
  const results = shown.slice(0, i.record_id ? 1 : i.limit);
  await countMatches(ctx, p, results);
  return {
    query: i.query,
    terms: p.terms.map((t) => ({ text: t.text, phrase: t.phrase })),
    ignored: p.ignored,
    kind_hint: p.kind,
    corrections: fixed,
    partial,
    counts,
    hits_matched: r.hits,
    results,
  };
}
