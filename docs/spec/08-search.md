# 8. Search and retrieval

Retrieval is a first-class feature: synthesis is only as good as what a person or an agent can
find. Version 1 is lexical and says so. The improvements in §8.3–§8.6 are planned work with ports
reserved for them now.

## 8.1 The search operation

```
search {
  q?:       string                      // free text; omit to filter only
  scope:    "passages" | "records" | "insights" | "assumptions" | "decisions"
  mode?:    "lexical" (default) | "substring" | "semantic" (later)
  filters?: { folder, kind[], organization, date_from, date_to, tags[], title_contains,
              dimensions{customer, product_area, lifecycle_stage}, include_archived,
              record_ids[], review_status[] }
  limit?, cursor?
}
```

- One project per call. There is no cross-project search in v1, and there will never be a
  cross-team one.
- `passages` results: `{ record (brief), seq_start, seq_end, snippet, speaker?, start_ms?,
  score }` — directly usable as `read_passage` and citation inputs. Snippets are ≤ 300 chars.
- Results are bounded as everywhere ([§6.3](06-operations-and-adapters.md)).
- The response carries a `coverage` object (§8.4).
- Search is a read: it is never blocked by a quota ([§9.2](09-data-lifecycle.md)).

## 8.2 Lexical search (v1)

- **`lexical`:** ranked full-text search over the segments of each record's *current* `ready`
  derivation, and over register statements and bodies and insight titles, summaries, and bodies.
  Boolean operators, quoted phrases and prefixes through Postgres `websearch_to_tsquery` and
  `tsquery`, ranked with `ts_rank_cd`, indexed with GIN over a stored `tsvector`.
- **`substring`:** exact, case-insensitive substring match through `pg_trgm` — for identifiers,
  part numbers, and quotes where tokenization gets in the way.
- Archived records and entries are excluded unless `include_archived`.
- Indexing happens in the same transaction that makes a derivation current, so search never
  returns a passage that `read_passage` cannot serve.
- **One engine.** Because there is only one database, development and production rank results
  identically and the conformance suite can assert ordering, not merely result sets.

## 8.3 Dimensions and the alias registry

Records carry three optional, domain-neutral dimensions: `customer`, `product_area`,
`lifecycle_stage`.

- **v1:** values are stored with a display form and a normalized key (trimmed, whitespace
  collapsed, case-folded). Filters match on the key. This does not catch misspellings.
- **Planned — a per-project dimension registry:** each dimension has canonical values with
  aliases (`{ value_id, label, aliases[] }`). Writes resolve through aliases; unknown values are
  accepted and listed as *unregistered* for someone to merge. Merging two values is an alias
  change, not a rewrite of records. Operations: `dimensions.list`, `register`, `add_alias`,
  `merge`. The product ships no values: the registry is filled by each project, keeping the
  platform domain-independent.

## 8.4 Honest coverage, and tiered search of attachments

Search must never claim to have examined what it did not.

- Every search response includes
  `coverage: { searched: ["primary"], records_with_unsearched_files: n, records_without_passages: n }`
  counted over the records matching the filters. The UI shows this in a sentence ("Searched the
  primary text of 41 records. 6 have attachments that are not searchable; 3 have no derived text
  yet.").
- **Planned — tiers:** derive `supplement` and `origin` files as secondary derivations;
  `tiers: ["primary", "attachments"]` opts in; results name the file they came from. Citations
  continue to address primary derivations only until the citation model is deliberately extended.

## 8.5 Semantic retrieval (planned)

- Behind the `Embedder` and `SearchIndex` ports; `mode: "semantic"` and a hybrid mode that fuses
  lexical and vector ranks.
- **The index question is already answered:** `pgvector` is an extension of the database we
  already run, in both environments, with no new service and no new bill. Adopting it costs a
  migration.
- **The quality question is not.** Build a small relevance set (queries with judged passages) from
  the synthetic sample project and one real corpus; adopt hybrid retrieval only if it clearly
  beats lexical on it. A measurable improvement, or it does not ship.
- The embedder runs a small sentence-embedding model **in our own worker** (ONNX), not a hosted
  API. That keeps the "no API key anywhere, including on a contributor's laptop" property, which
  the removal of the browser profile did not change.
- Embeddings are keyed by `derivation_id` and model id, and are disposable: they can always be
  rebuilt from sidecars, so they are excluded from backups and from exports.

## 8.6 Historical derivations and recursive lineage

- **Historical reads exist from day one:** derivations are immutable and retained, and every
  derived read accepts `derivation_id` ([§5.5](05-derived-layer.md)).
- **Planned — anchors that survive re-parsing:** `check_citations` already relocates intact text
  ([§4.8](04-data-model.md)). The extension is fuzzy relocation (a quote with small edits) reported
  as `relocated_approximate` with a similarity score — still report-only.
- **Planned — recursive lineage:** `lineage.check { recursive: true }` walks inputs that are
  themselves views, reports the full ancestor tree with per-node status, detects cycles, and is
  bounded (depth ≤ 10, ≤ 500 nodes). Regeneration stays an agent task: the product reports exactly
  what is stale and why, and the skill describes the regenerate-and-recapture routine.
