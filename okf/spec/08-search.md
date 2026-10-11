---
type: Specification
title: Search is lexical, bounded, and says exactly what it examined.
description: The search operation as built (substring, ranked and plain modes, scopes, filters, coverage), dimensions, and the planned retrieval work (dimension registry, attachment tiers, semantic search, approximate relocation, recursive lineage).
tags: [spec, search, retrieval, coverage]
generated: {by: agent:claude, at: 2026-10-11}
status: stable
---

# 8. Search and retrieval

Retrieval is a first-class feature: synthesis is only as good as what a person or an agent can
find. Search today is lexical and says so. The improvements marked *planned* in §8.3–§8.6 are not
built.

## 8.1 The search operation

`search` is a standalone MCP tool and `GET /api/v1/p/<tenant>/<team>/<product>/search`
(`packages/core/src/ops/search.ts`):

```
search {
  query:     string (1–500)                  // required
  mode?:     "substring" (default) | "ranked" | "plain"
  scope?:    "passages" (default) | "assumptions" | "all"
  record_id?, date_from?, date_to?, tags[]?,          // passage filters
  customer?, product_area?, lifecycle_stage?, provenance_depth?,
  include_archived? (false), limit? (50, at most 200), cursor?
  kind?, strict? (false)                              // plain mode only
}
```

Plain mode (§8.2) takes only `query`, `record_id`, `kind` and `strict`; any other filter with it,
or `kind` or `strict` in another mode, is `422 invalid_filter`.

- One product per call. There is no cross-product search, and there will never be a
  cross-tenant one.
- Date and tag filters apply to passages: `date_from` and `date_to` bound the source's own date,
  and a source must carry every tag given. Combining them with `scope: "assumptions"` is
  `422 invalid_filter`. Sources have no kind, organization or folder to filter by
  ([§4.4](04-data-model.md)); naming one is `422 invalid_input`.
- Passage hits: `{ record_id, seq, start_ms, end_ms, speaker, snippet, char_start, char_end,
  score? }`, with each source's `title`, `date`, `tags` and `archived_at` sent once in
  `records`. A hit's `record_id` and `seq` are directly usable with `read_passage`
  (`{ record_id, seq }`) and as citations; the window around a hit is `start` and `end` in
  segments with `unit: "seq"`, never `char_start` and `char_end`. Snippets are at most 160
  characters.
- Assumption hits come back as `assumptions` (id, statement, status, citation count).
- Results are bounded and paged as everywhere ([§6.3](06-operations-and-adapters.md)).
- The response carries a `coverage` object (§8.4).
- Search is a read, and reads are never blocked by a quota ([§9.2](09-data-lifecycle.md)).

## 8.2 Lexical search

- **`substring`** (the default): exact, case-insensitive substring match (`ILIKE`), indexed with
  `pg_trgm`. Right for identifiers, part numbers, and quotes where tokenization gets in the way.
- **`ranked`:** a small boolean grammar — terms, `"quoted phrases"`, `prefix*`, `AND`, `OR`, `NOT`
  and parentheses, adjacent terms implying AND, at most 64 tokens — compiled to a Postgres
  `tsquery` over the language-neutral `simple` configuration (no stemming), matched against a
  stored, GIN-indexed `tsvector`, and ranked with `ts_rank_cd`. A score is not a confidence.
- Each passage (segment) is matched on its own, in both modes: `AND`, `OR` and `NOT` combine terms
  within one passage, so words a transcript splits across neighbouring cues never match together.
  The `search` description says so.
- Passages are searched over the segments of each source's *current* derivation, primary file
  only. Assumptions are searched over statement and body.
- Archived sources and assumptions are excluded unless `include_archived`.
- Segments are marked current in the same transaction that makes a derivation current, so search
  never returns a passage that `read_passage` cannot serve.
- **`plain`:** everything in the product, the way a person types into a search box. It is the
  web app's search ([§7.2](07-web-app.md)) and needs no index of its own and no model: it runs on
  the stored `tsvector`s and `pg_trgm`. The words are read deterministically
  (`packages/core/src/plain-query.ts`):
  - each word matches at the start of a word, in any order; endings are forgiven by a small
    suffix-stripping stemmer whose root matches as a prefix ("pricing" finds price and priced), and
    the last word, possibly still being typed, always matches as a prefix;
  - `"quoted words"` match as a phrase; accents are folded; small words (the, of, how) are left out
    and listed in `ignored`, unless nothing else is left;
  - a kind word (`mockups`, `assumptions`, …) brings that kind first and is returned as
    `kind_hint`;
  - a word that matches nothing is replaced by the closest word the product holds (at most one
    edit, two for words of six letters or more, a transposition counting as one), taken from
    titles and from passages alike by trigram; `corrections` lists each `{ from, to }`, and
    `strict: true` turns this off.

  It searches sources (title, tags, and the passages of the current primary derivation),
  assumptions, outcomes (not archived), mockups (each page's text at the current version), Story
  pages and the product concept. A source holds every word when its passages hold them between
  them, and is returned once, with its best three passages (all of them with `record_id`) and how
  many matched. Results are scored by how many of the words they hold, in the title above the
  body, with exact words, words side by side and a title equal to the query ranked higher. When
  anything holds every word, only those are returned; otherwise the ones holding the most, with
  `partial: true` and each result's `missing` words. At most 60 results, the best first; `counts`
  counts every match, so a caller can say when more matched than came back. The response is
  `{ mode, query, terms, ignored, kind_hint, corrections, partial, counts, passages_matched,
  results }`; each result has `kind`, `id`, `title` and `snippet` with the matched stretches as
  `[start, end]` marks, `missing`, `score` and `meta`, and a source its `hits` and `hit_count`.
  ◆ Decision: plain mode returns no `coverage`; the other modes do.
  ([decision](../decisions/one-search-reads-plain-words-across-the-whole-product.md))
- **One engine.** Because there is only one database, development and production rank results
  identically, and tests can assert ordering, not merely result sets.

## 8.3 Dimensions and the alias registry

Records carry three optional, domain-neutral dimensions: `customer`, `product_area`,
`lifecycle_stage`.

- **As built:** `customer` and `product_area` are free text; `lifecycle_stage` is one of
  `discovery`, `sales`, `research`. Values are normalized on write (trimmed, whitespace collapsed,
  case-folded) and filters match the normalized value. This does not catch misspellings.
- **Planned — a per-product dimension registry:** each dimension has canonical values with
  aliases (`{ value_id, label, aliases[] }`). Writes resolve through aliases; unknown values are
  accepted and listed as *unregistered* for someone to merge. Merging two values is an alias
  change, not a rewrite of records. Operations: `dimensions.list`, `register`, `add_alias`,
  `merge`. The product ships no values: the registry is filled by each product, keeping the
  platform domain-independent.

## 8.4 Honest coverage, and tiered search of attachments

Search must never claim to have examined what it did not.

- Every passage search response in the substring and ranked modes includes
  `coverage: { searched: ["primary"], records_considered, records_without_passages,
  records_with_unsearched_files, statement }`, counted over the sources matching the filters.
  `statement` says it in sentences, leaving out zero counts and counting sources without passages
  by reason, since each needs a different next step ("Searched the primary text of 41 sources. 6
  sources have origin or supplement files that are not searched. Not searched: 1 has no primary
  file yet; 2 are not parsed yet; 1 is a recording with no transcript (add the transcript as its own source); 1 has a primary
  that could not be parsed (unsupported, too large or failed)."), for an agent to pass on. The
  web app's Search does not show it.
- **Planned — tiers:** derive `supplement` and `origin` files as secondary derivations;
  `tiers: ["primary", "attachments"]` opts in; results name the file they came from. Citations
  continue to address primary derivations only until the citation model is deliberately extended.

## 8.5 Semantic retrieval (planned)

- Behind new `Embedder` and `SearchIndex` ports (neither exists yet in
  `packages/core/src/ports.ts`); `mode: "semantic"` and a hybrid mode that fuses lexical and
  vector ranks.
- **The index question is answered:** `pgvector` is an extension of the database already in use,
  in both environments, with no new service and no new bill. Adopting it costs a migration.
- **The quality question is not.** Build a small relevance set (queries with judged passages) from
  the synthetic sample product and one real corpus; adopt hybrid retrieval only if it clearly
  beats lexical on it. A measurable improvement, or it does not ship.
- The embedder runs a small sentence-embedding model **in our own worker** (ONNX), not a hosted
  API. That keeps the "no API key anywhere, including on a contributor's laptop" property.
- Embeddings are keyed by `derivation_id` and model id, and are disposable: they can always be
  rebuilt from sidecars, so they are excluded from backups and from exports.

## 8.6 Historical derivations and recursive lineage

- **Historical reads exist:** derivations are immutable and retained, and the derived reads accept
  `derivation_id` ([§5.5](05-derived-layer.md)).
- **Planned — anchors that survive re-parsing:** `check_citations` already relocates intact text,
  forgiving differences in markup, spacing and speaker labels, and flags `derivation_changed`
  ([§4.8](04-data-model.md)). Still to come: comparing a range's edges as well as its quote, a text
  hash on each derivation so a re-parse with identical text says so, and a safe refresh of a
  snapshot whose quote still matches. The extension is fuzzy relocation (a quote with small edits) reported
  as `relocated_approximate` with a similarity score — still report-only.
- **Planned — recursive lineage:** `lineage.check { recursive: true }` walks inputs that are
  themselves views, reports the full ancestor tree with per-node status, detects cycles, and is
  bounded (depth ≤ 10, ≤ 500 nodes). Regeneration stays an agent task: the product reports exactly
  what is stale and why, and the skill describes the regenerate-and-recapture routine.
