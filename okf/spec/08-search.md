---
type: Specification
title: Search reads what a source says, its title, tags, summary, derived text, notes and comments, and never its attachments; it is lexical, bounded, and says exactly what it examined.
description: The search operation as built (substring, ranked and plain modes, scopes, filters, hits with their field and offsets, every place in substring mode, coverage), the search index of a source's texts, earlier readings, and the planned semantic retrieval.
tags: [spec, search, retrieval, coverage, index]
generated: {by: agent:claude, at: 2026-10-31}
status: stable
---

# 8. Search and retrieval

Retrieval is a first-class feature: synthesis is only as good as what a person or an agent can
find, and searching is how an agent finds what bears on a piece of work, since nothing records it
([decision](../decisions/evidence-is-searched-not-cited.md)). Search reads what each source says:
its title, tags, summary, derived text, notes and comments, and never its attachments
([decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
It is lexical and says so. Semantic retrieval (§8.7) is planned, not built.

## 8.1 The search operation

`search` is a standalone MCP tool and `GET /api/v1/p/<tenant>/<team>/<product>/search`
(`packages/core/src/ops/search.ts`):

```
search {
  query:     string (1–500)                  // required, as typed: never trimmed
  mode?:     "substring" (default) | "ranked" | "plain"
  scope?:    "sources" (default) | "assumptions" | "all"
  record_id?, date_from?, date_to?, tags[]?,          // source filters
  include_archived? (false), limit? (50 hits; 60 results in plain mode; at most 200), cursor?
  kind?, strict? (false)                              // plain mode only
}
```

Plain mode (§8.2) takes only `query`, `record_id`, `kind`, `strict` and `limit`; any other filter
with it (dates, tags, a cursor, `include_archived`, a `scope` other than `sources`), or `kind` or
`strict` in another mode, is `422 invalid_filter`.

- One product per call. There is no cross-product search, and there will never be a
  cross-tenant one.
- The query is used as it was sent, never trimmed: in substring mode its spaces are part of the
  text it matches, and in plain mode a space at its end says the last word is finished (§8.2).
  Ranked mode reads terms, so spaces around them change nothing. A query of nothing but spaces is
  `422 invalid_input`.
- `scope` says what is searched: `sources`, what the product's sources say; `assumptions`, their
  statements and bodies; `all`, both. The `passages` scope is gone (`422 invalid_input`). The
  answer repeats it as `search_scope`, and over REST as `scope` too: over MCP, `scope` is where the
  call ran, as on every product-scoped answer ([§6.5](06-operations-and-adapters.md)).
  ◆ Decision: a second name rather than a rename, so no caller that reads `scope` over REST breaks.
- Date and tag filters apply to sources: `date_from` and `date_to` bound the source's own date,
  and a source must carry every tag given. Combining them with `scope: "assumptions"` is
  `422 invalid_filter`. `record_id` keeps the search to that one source, so with it no
  assumption is searched. Sources have no kind, organization or folder to filter by, and sources
  and assumptions have no dimensions (`customer`, `product_area`, `lifecycle_stage`) or
  `provenance_depth` ([§4.4](04-data-model.md)); naming one is `422 invalid_input`.
- **Source hits:** `{ record_id, field, annotation_id?, char_start, char_end, snippet, score? }`.
  - `field` is where the words are: `title`, `tags`, `summary`, `text` (the derived text),
    `notes`, or `comment`, which adds the comment's `annotation_id`.
  - `char_start` and `char_end` are code-point offsets into that field's text, half-open: the
    matched words in substring mode, the piece that matched (§8.3) in ranked mode. So
    `derived.text { record_id, offset }` from a little before `char_start` reads the words around a
    hit in `text` ([§5.4](05-derived-layer.md)).
  - In substring mode every place the query occurs is a hit of its own, with its own offsets and
    snippet; places do not overlap. In ranked mode a hit is a piece that matches.
    ◆ Decision: every place, not one hit per piece at its first match, so a hit is always the
    matched words and none is hidden behind another in its piece.
  - `snippet` is at most 160 characters: around its own place in substring mode, the start of the
    piece in ranked mode. `score` comes in ranked mode.
  - Each source's `title`, `date`, `tags` and `archived_at` are sent once, in `records`.
  - Substring hits come by source, then by field in the order title, tags, summary, text, notes,
    comment, then by place; ranked hits by score.
- Assumption hits come back as `assumptions` (id, statement, status, and score in ranked mode), at
  most `limit` of them, on the first page only: assumptions are not paged, so with `scope: "all"`
  the pages `next_cursor` gives carry source hits alone, and a search of assumptions alone answers
  in one page and refuses a cursor (`422 invalid_cursor`).
- Results are bounded and paged as everywhere ([§6.3](06-operations-and-adapters.md)): `limit`
  counts hits. The substring cursor is a keyset of the last hit, its piece and its place there, so
  a page may end inside a piece and the next one carry on in it; the ranked cursor is an offset. A
  cursor search did not write (one changed by hand: a number that is not a whole one in range, a
  NUL in a key) is `422 invalid_cursor`, refused before the database reads it.
- The response carries a `coverage` object (§8.5).
- Search is a read, and reads are never blocked by a quota ([§9.2](09-data-lifecycle.md)).

## 8.2 Lexical search

- **`substring`** (the default): exact, case-insensitive substring match (`ILIKE`), indexed with
  `pg_trgm`. Right for identifiers, part numbers, and quotes where tokenization gets in the way.
  The query is matched as typed: `%`, `_` and `\` in it are characters, never wildcards or an
  escape. So is the `query` of every list that takes one (sources, assumptions, outcomes), through one helper, `likeContaining` in `packages/core/src/util.ts`.
- **`ranked`:** a small boolean grammar — terms, `"quoted phrases"`, `prefix*`, `AND`, `OR`, `NOT`
  and parentheses, adjacent terms implying AND, at most 64 tokens — compiled to a Postgres
  `tsquery` over the language-neutral `simple` configuration (no stemming), matched against a
  stored, GIN-indexed `tsvector`, and ranked with `ts_rank_cd`. A score is not a confidence. A
  term that starts with a digit, a prefix included, also matches the form the database stores
  after a hyphen, as plain mode's do (below): `20734` finds `CB26-20734`, stored as `cb26` and
  `-20734`, and `05` the month of `2026-05-01`.
- Each text is matched in pieces of about 1,500 characters (§8.3), in both modes: `AND`, `OR` and
  `NOT` combine terms within one piece, and words a piece boundary separates never match together.
  The `search` description says so.
- Queries match the text as stored. A derived text is Markdown: a transcript's
  `**Dana** (12:05):` labels, `#` headings and the pipes of a table are in it
  ([§5.3](05-derived-layer.md)), so a query searches for the words, not the markup. The `search`
  description says so too.
- Archived sources and assumptions are excluded unless `include_archived`. So is an archived
  comment, which `include_archived` brings back with them.
- Assumptions are searched over statement and body.
- **`plain`:** everything in the product, the way a person types into a search box. It is the
  web app's search ([§7.2](07-web-app.md)) and needs no model: it runs on the stored `tsvector`s,
  a page's among them (§8.3), and `pg_trgm`. The words are read deterministically
  (`packages/core/src/plain-query.ts`):
  - each word matches at the start of a word, in any order; endings are forgiven by a small
    suffix-stripping stemmer whose root matches as a prefix ("pricing" finds price and priced), and
    the last word, taken as still being typed, matches as a prefix even when it is short, unless the
    query ends with a space;
  - an id or a number, a word with a digit in it (`CB26-20734`, `2026-05-01`, `2026`), is one word
    with its hyphens, matched as written: no ending is forgiven, and it is a prefix only while it
    is being typed. It is matched as the database's parser stored it, which keeps `CB26-20734` as
    `cb26` followed by `-20734`, so the number alone finds it too, and ends a number after a hyphen
    before a letter, so `2026-05-01` is found in `2026-05-01T10:00` (a number alone runs on: `2020`
    is not in `2020s`). One with a letter in it is found written as its words side by side too, in
    order (`'q3-planning' | 'q3' <-> 'planning'`), so `q3-planning`, `covid-19` and `mid-2026` find
    "Q3 planning", "COVID 19" and "mid 2026"; an id of digits alone, such as a date, is found only
    as written. A hyphenated word without a digit ("follow-up") is its words;
  - `"quoted words"` match as a phrase; small words (the, of, how) are left out and listed in
    `ignored`, unless nothing else is left;
  - accents are folded when a match is marked and scored, but the search vectors keep them, so a
    word finds what its root starts as written: `café` finds `café` and not `cafe`, `cafe` finds
    both because its root is `caf`, and `resume` does not find `résumé`;
  - a kind word (`mockups`, `assumptions`, …) beside other words is not searched for: it lists
    that kind's results first, ahead of any that score higher, then the rest, each best first,
    and is returned as `kind_hint`; "passage", "passages", "quote" and "quotes" hint `source`. The order
    is the operation's, so the palette, the Search screen and an agent see the hinted kind first
    alike, and a result's `score` does not count the hint;
  - a word that matches nothing is replaced by the closest word the product holds (at most one
    edit, two for words of six letters or more, a transposition counting as one), taken from
    titles and from what the product's live sources say alike, by trigram; `corrections` lists
    each `{ from, to }`, and `strict: true` turns this off. An id or a number is never corrected,
    nor offered as a correction: one digit away is another thing, not a typo.

  It searches sources (their title and tags, and the pieces of their summary, derived text, notes
  and comments, archived sources and comments left out), assumptions, outcomes (not archived),
  mockups (each page's text at the current version), Story pages (their title, summary and what they
  show: their own text, or the mockup page or whole canvas, with its pages' titles, at the version
  they stay on) and the product concept. A Story page that shows a mockup is one thing in two places,
  so it is left out when the mockup is among the results and holds every word it does, and the
  mockup takes its score if that is higher ([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md));
  with `kind: "story"` no mockup is searched, so it is listed. A mockup page with a Story page of its
  own is not also found on a whole canvas that holds it at the same version. A result on several
  pages, a mockup or a whole canvas, names in `meta` the page holding the most of the words, and of
  those the one whose title says them best, scored as a result's title is, so a page titled with the
  words comes ahead of the first that says them; its excerpt comes from that page, what it says ahead
  of its title, and its score from the page that scores highest, and it names no page when the words
  are only in the mockup's own title, summary or brief. A reader searches the Story alone
  (`kind` is `story` for them): a result on a whole canvas gives the page the words are on in `meta`,
  corrections come only from the Story's titles, and any other mode, kind or `record_id` is `403`
  ([decision](../decisions/a-reader-reads-only-the-story.md)). Of
  an outcome's card and the concept's, it reads the back, the text; a card's front, a picture in
  HTML, is not searched. A source holds every word
  when its title, tags and pieces hold them between them, and is returned once, with the best
  three places it says the words in `hits` (all of them with `record_id`), how many pieces
  matched in `hit_count`, and in `match_count` how many times its derived text says them, counted
  as its Find in the text counts them for the same words ([§7](07-web-app.md)), with the one
  pattern and the one reading of the Markdown the web app shows
  ([`find-in-text.ts`](../../packages/core/src/find-in-text.ts), which the app's find uses too),
  so the result's "N matches" and the find's "… of N" agree. Only the derived text is counted,
  because only it is marked by the find. The count reads the pieces of the returned sources'
  derived texts that may hold a match, in the results' order, at most 2,000 of them in a search:
  a source past that has no `match_count` rather than one too small. A hit is `{ field, annotation_id, char_start, text, marks }`: `field` is
  `text`, `summary`, `notes` or `comment` (with the comment's `annotation_id`, null otherwise),
  `char_start` is where the piece starts in its field, in code points, and `text` an excerpt of up
  to 240 characters with the matched stretches as `[start, end]` `marks`; among equal hits the
  derived text comes first. An excerpt, a hit's or a result's `snippet`, is centred on the place
  where the most of the words occur within it, then the most matches, so a quoted phrase is shown
  where the phrase is rather than where its first word comes earlier; it starts and ends at word
  boundaries unless that would leave out a mark it was chosen for, never inside a character, and
  marks a match it cuts as far as it goes, so an excerpt of text that holds a match always holds a
  mark, in a text with an ellipsis or a ligature too (`plain-query.ts` `excerpt`). Markdown shows
  as its words in every excerpt, a source's and those of an assumption's body, an outcome's
  description, a mockup's brief and notes and the product concept alike: heading marks, list and
  quote markers, a table's rule row and a code fence's lines are dropped, and so are the markers
  of bold, italics (`*words*`, `_words_`, never inside a word, so `snake_case` stays) and a code
  span, whose words show as written; a link or an image shows as its text, without its address,
  and an escaped character (`\[`, `\*`) as itself, without its backslash, never read as markup
  (`shownWords`). The marks are made on the words shown, and a hit's `char_start` is still where
  its piece starts in the text as written. Results are scored by how many of the words they hold, in the title
  above the body, with exact words, words side by side and a title equal to the query ranked
  higher. When anything holds every word, only those are returned; otherwise the ones holding the
  most, with `partial: true` and each result's `missing` words. At most `limit` results (60 unless
  the call says, at most 200), the best first after a hinted kind's; `counts` counts every match, so a caller can say
  when more matched than came back. Sources are built from the 400 best pieces that hold any of
  the words (200 with `record_id`) and from their titles and tags; a source whose matching pieces
  all lie beyond those is still counted, by what its pieces hold, in the database. The response
  is `{ mode, query, terms, ignored, kind_hint, corrections, partial, counts, hits_matched,
  results }`, where `hits_matched` counts the pieces of those summaries, derived texts, notes and
  comments that hold any of the words;
  each result has `kind`, `id`, `title` and `snippet` with their marks, `missing`, `score` and
  `meta`, and a source its `hits`, `hit_count` and `match_count`.
  ◆ Decision: plain mode returns no `coverage`; the other modes do.
  ([decision](../decisions/one-search-reads-plain-words-across-the-whole-product.md))
- **One engine.** Because there is only one database, development and production rank results
  identically, and tests can assert ordering, not merely result sets.

## 8.3 The search index

What search reads of each source is kept in `text_chunks`
([`packages/core/src/text-index.ts`](../../packages/core/src/text-index.ts)): each of a source's
texts cut into pieces, one row a piece, with `record_id`, `field` (`title`, `tags`, `summary`,
`notes`, `text` or `comment`), `ref` (a comment's `annotation_id`, empty for the other fields),
`n` (the piece's number), `char_start` and `char_end` (code points into the field's text,
half-open), `text`, and a generated `tsvector` (`simple`). A GIN index on the `tsvector` and a
trigram GIN index on the text serve the modes; the table has the tenant's row-level security, as
every content table does.

- **Pieces.** A piece holds at most about 1,500 characters. A text is cut at blank lines:
  neighbouring paragraphs share a piece while they fit, and a longer paragraph is cut on its own,
  after a sentence or a line break where it can, else at a space, else hard, never inside a
  character. Each piece is exactly the text between its offsets, so a hit maps back to its place.
  A source's tags are indexed as one text, joined with `, `.
- **Written with the text.** Every write of one of these texts writes its pieces again in the same
  transaction, so search never finds words a source no longer holds and finds new ones at once:
  creating a source and correcting its title or tags, `derived.write_note`, `derived.write_text`, a
  reading that becomes the derived text ([§5.4](05-derived-layer.md)), a comment's creation, edit
  and delete, a copy to another product, and a source made from a retired insight or decision. A
  source's pieces are deleted with it.
- **Built whole** by the worker's `index_texts` job, one product at a time, which migration
  `0030_one_derived_text_per_source.sql` queues for every product.
- An archived source's pieces, and an archived comment's, stay in the index; search leaves them
  out unless asked.
- **Attachments are never in it.** What was read from an attachment is kept with the attachment
  ([§5](05-derived-layer.md)), and search reads it only once it is a source's derived text.

**A page's words.** Plain search never reads a mockup page's or a Story version's HTML. Each row of
`mockup_pages` and `story_versions` holds `search_text`, the words a reader sees, and `tsv`, their
`simple` search vector, both generated by Postgres from `html` through `html_search_text`
(migrations `0040_html_pages_keep_their_words.sql` and
`0042_a_word_keeps_the_letters_entities_spell.sql`)
([decision](../decisions/a-pages-words-are-kept-beside-its-html-and-a-search-runs-within-limits.md)).

- **What the words are:** the HTML without comments, script and style blocks, tags and their
  attributes (so an SVG's paths and a picture in a `data:` URI go, and an SVG's `<text>` stays), with
  each entity read as below. A `<` that opens no tag stays.
- **Entities.** A word spelled with an entity inside it is that word: `caf&eacute;`, `caf&#233;` and
  `caf&#xE9;` are all `café`. A reference becomes its character when that is a letter or a combining
  mark (Unicode general categories L and M): by any name the HTML standard gives it, and by number,
  with the numbers from 128 to 159 read as a browser reads them, in windows-1252. Any other entity is
  a word break, a space: `&lt;`, `&gt;`, `&amp;` and `&quot;` in any spelling, `&nbsp;`, `&rsquo;`,
  `&shy;`, a digit, an emoji, a control character, a name the standard does not have, and a number
  that is no character (`&#0;`, a surrogate, past U+10FFFF), which raises no error, since an error
  would make the page impossible to write. Without its semicolon a reference is not one, and is kept
  as written. Each is read once, so `&amp;lt;` is `lt;` and not a `<`.
- **The words are text, and hold no markup a reference made.** A reference never produces `<`, `>`
  or `&`, and a `<` directly before one is given a space, so a letter cannot complete a tag
  (`<&#115;cript>` is `< script>`, whose word a search vector would otherwise drop with the tag).
  Whatever they hold, they reach a reader as text: an excerpt in the JSON of an answer, drawn by the
  web app as text nodes (`Marked` in `apps/web/src/lib/find.tsx`); the app sets HTML from nothing,
  and neither column is in an answer or an export.
- **Written with the HTML.** The columns are computed in the statement that writes the row, so they
  commit with it, there is no job to wait for or clean up after, and a save that loses its race to
  another (`409 stale_etag`) leaves nothing behind. Search reaches a page through the same pointer
  that makes its version current, so it finds one version's words or the next's, never both.
- **The limit:** the first 200,000 characters of words a page holds, which always fit a search
  vector (at most 1 MB). HTML itself is limited to 1,000,000 characters, and markup costs nothing
  against the limit on words. Words past it are not found by search; the page itself is untouched.
- A page that enters a prototype has no HTML of its own, and a prototype's files are not searched.
- ◆ Decision: no GIN index on `tsv`. A search reads one product's current pages, found through its
  mockups and Story pages, and the vectors of those few rows are compared directly.

## 8.4 No dimensions

Sources and assumptions have no dimensions. Whom material concerns, what it bears on and which
stage of work it comes from are tags, filtered with `tags` (§8.1)
([decision](../decisions/sources-are-described-by-tags.md)). Migration `0027_drop_dimensions.sql`
dropped the customer, product area and lifecycle stage they held.

## 8.5 Honest coverage

Search must never claim to have examined what it did not.

- Every search of sources in the substring and ranked modes includes
  `coverage: { searched: ["title", "tags", "summary", "text", "notes", "comments"],
  records_considered, records_without_text, statement }`, counted over the sources the filters
  keep. `statement` says it in sentences for an agent to pass on, counting the sources without a
  derived text by reason, since each needs a different next step, leaving out zero counts, and
  always ending "Attachments are never searched.": "Searched the title, tags, summary, notes and
  comments of 3 sources, and the derived text of the 2 that have one. No derived text: 1 is a
  recording with no transcript (add the transcript as an attachment). Attachments are never
  searched." The reasons are: still being read; no attachment yet; an attachment whose text the
  source does not use; a recording with no transcript; pictures that are not read as text (a
  source whose status is `unsupported` because each of its unread attachments is an image or a
  PDF whose pages are pictures, which someone who can see them gives its words); and only
  attachments that could not be read (unsupported, too large or failed). The web app's Search
  does not show it.

## 8.6 Earlier readings

Readings are immutable and retained, and `derived.text` takes an attachment's `path` or a
`derivation_id` ([§5.4](05-derived-layer.md)), so what an attachment was read as stays readable
exactly as it was. A hit's offsets point into its field's text as it is now: an edit moves what
follows it, so an agent searches again rather than reusing offsets from before.

## 8.7 Semantic retrieval (planned)

- Behind new `Embedder` and `SearchIndex` ports (neither exists yet in
  `packages/core/src/ports.ts`); `mode: "semantic"` and a hybrid mode that fuses lexical and
  vector ranks.
- **The index question is answered:** `pgvector` is an extension of the database already in use,
  in both environments, with no new service and no new bill. Adopting it costs a migration.
- **The quality question is not.** Build a small relevance set (queries with judged places in
  sources' texts) from the synthetic sample product and one real corpus; adopt hybrid retrieval
  only if it clearly beats lexical on it. A measurable improvement, or it does not ship.
- The embedder runs a small sentence-embedding model **in our own worker** (ONNX), not a hosted
  API. That keeps the "no API key anywhere, including on a contributor's laptop" property.
- Embeddings are keyed to the pieces of the texts search reads (§8.3) and the model id, and are
  disposable: they can always be rebuilt from those texts, so they are excluded from backups and
  from exports.

## 8.8 A search runs within limits

A search, in any mode and through either door, cannot take every connection from other work
([`packages/core/src/bounded-search.ts`](../../packages/core/src/bounded-search.ts),
[decision](../decisions/a-pages-words-are-kept-beside-its-html-and-a-search-runs-within-limits.md)).
The operation is `bounded`, and `execute` runs it so:

- **Few at a time.** A server runs at most 3 searches at once, of the 10 connections in its pool. At
  most 12 more wait, up to 2 seconds, holding no connection. Any other is refused with
  `503 search_busy` and `Retry-After: 1`.
- **A time limit.** The whole search has 5 seconds, then `503 search_timed_out`, which says nothing
  was changed and that it does not mean the words are absent. Its statements carry the limit in
  `statement_timeout`, set for its transaction alone, so nothing else ever does. The server also
  cancels the running statement (`pg_cancel_backend`, naming the connection by its process and when
  its transaction began, so one that has moved on to other work is left alone), again every 250 ms
  until the transaction has ended. A cancelled statement ends the transaction, it rolls back, and
  its connection and its slot are free.
- **Stopped when whoever asked has gone.** A closed connection, in the REST and MCP doors alike,
  stops a search the same way at once. It is counted as `search_cancelled`.
- **The web app** cancels a search typed past or left behind, and does not ask again by itself after
  one fails ([§7.2](07-web-app.md)).
- **What is told.** The trace of each search carries how long it waited and ran, and usage counts
  each outcome by its code. The log has a line, in numbers alone and never the words, for each one
  refused (`search_busy`), stopped (`search_stopped`, with its outcome) or slower than a second
  (`search_slow`).

Waiting for a connection is limited for every request, not only searches: after 15 seconds it is
answered `503 database_busy` (`createDb`). Requests still waiting across two looks at the pool, ten
seconds apart, make an ERROR line, `database_pool_saturated`, with how many connections are held and
how many searches run and wait (`watchPool`), since the health check reads no database and cannot
say so ([Cloud Run](../operations/cloud-run.md#alerts)).
