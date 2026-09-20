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

- One project per call. There is no cross-project search in v1.
- `passages` results: `{ record (brief), seq_start, seq_end, snippet, speaker?, start_ms?,
  score }` — directly usable as `read_passage` and citation inputs. Snippets are ≤ 300 chars.
- Results are bounded as everywhere ([§6.3](06-operations-and-adapters.md)).
- The response carries a `coverage` object (§8.4).

## 8.2 Lexical search (v1)

- **`lexical`:** ranked full-text search over the segments of each record's *current* `ready`
  derivation, and over register statements and bodies and insight titles, summaries, and bodies.
  Boolean operators `AND`, `OR`, `NOT`, quoted phrases, prefix `*`. BM25-style ranking. SQLite
  FTS5 (unicode61, diacritics removed) in the browser and server profiles; Postgres full-text in
  the cloud. Ranking may differ slightly between engines; the conformance suite asserts result
  *sets* for a fixed corpus, and ordering only for clear-cut cases.
- **`substring`:** exact, case-insensitive substring match — for identifiers, part numbers, and
  quotes where tokenization gets in the way.
- Archived records and entries are excluded unless `include_archived`.
- Indexing happens in the same transaction that makes a derivation current, so search never
  returns a passage that `read_passage` cannot serve.

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
  primary text of 41 sources. 6 have attachments that are not searchable; 3 have no derived text
  yet.").
- **Planned — tiers:** derive `supplement` and `source` files as secondary derivations;
  `tiers: ["primary", "attachments"]` opts in; results name the file they came from. Citations
  continue to address primary derivations only until the citation model is deliberately extended.

## 8.5 Semantic retrieval (planned)

- Behind the `Embedder` and `SearchIndex` ports; `mode: "semantic"` and a hybrid mode that fuses
  lexical and vector ranks.
- **Measure before committing.** Build a small relevance set (queries with judged passages) from
  the synthetic sample project and one real corpus; adopt an index dependency only if hybrid
  retrieval clearly beats lexical on it.
- Default embedder runs **on-device** (a small sentence-embedding model in WASM/WebGPU in the
  browser, ONNX on the server) so the browser profile needs no embedding service and costs nothing to run. A hosted embedder
  is an optional adapter for the cloud profile.
- At local scale (tens of thousands of segments) brute-force cosine over a typed array is
  acceptable; a vector index is a cloud-scale concern.
- Embeddings are keyed by `derivation_id` and model id, and are disposable: they can always be
  rebuilt from sidecars.

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
