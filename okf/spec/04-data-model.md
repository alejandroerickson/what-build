---
type: Specification
title: Every object in a product, with its fields, limits and invariants, as the REST and MCP wire sees it.
description: The common envelope (ids, etags, attribution, revisions), outcomes, sources and their taxonomy, files, annotations, insights and insight review, the registers and citations, views and lineage, activity, Story, feedback, the product bundle, and the storage layout.
tags: [spec, data-model, schema, citations, revisions, story, export]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# 4. Data model

All objects are product-scoped unless stated. Every content row also carries `tenant_id`
([§3.6](03-accounts-teams-and-identity.md)). Field names here are the wire names used by REST,
MCP, and bundles. The schema is in [`apps/server/src/migrations`](../../apps/server/src/migrations);
the operations that enforce the rules below are in [`packages/core/src/ops`](../../packages/core/src/ops).

## 4.1 The common envelope

Every editable object carries:

| Field | Rule |
|---|---|
| `id` (named per type, e.g. `record_id`, `insight_id`; `id` for register entries) | ULID, immutable. Story pages are the exception: their `page_id` is a slug the author chooses (§4.11). |
| `product_id` | Immutable except when a source moves ([§3.7](03-accounts-teams-and-identity.md)). `tenant_id` is on every content row and never appears in a request body: it comes from the addressed product. |
| `etag` | Opaque string; changes on every successful mutation. |
| `created_at`, `created_by` | Timestamp and actor snapshot ([§3.9](03-accounts-teams-and-identity.md)). Sources say `uploaded_at`, `uploaded_by`. |
| `updated_at`, `updated_by` | Same, for the latest mutation. |
| `archived_at` | Where the type supports archive (sources, annotations, register entries, Story pages). Outcomes and insights archive through `status: "archived"` instead. Archived objects are excluded from lists and search unless asked for, and remain readable by id. |

**Concurrency.** Every update, review, link, single-object archive and restore, and every Story
publish after a page's first version requires the current etag (`expected_etag` in the input, or
`If-Match` in REST). Missing → `422`. Stale → `409 stale_etag`, with the current etag in
`details.current_etag` so a caller can re-read and retry deliberately. Creates take no etag;
neither do the batch `sources.archive` / `sources.restore` or `files.set_role`. A source's etag
also changes when a file is added or a file's role changes (`complete_upload` returns the new one as
`record_etag`). Parsing, which no caller does, does not change it, so an etag never goes stale while
the worker runs. Check-and-write is atomic: the row is locked (`SELECT … FOR UPDATE`) in the same
transaction.

**Unknown fields are rejected** (`422 invalid_input`), in every input, at every depth: every input
schema is a strict Zod object.

**Every mutation appends an activity event** (§4.10) in the same transaction.

**Authored text is never lost to an overwrite.** Every object with a body a person or an agent
writes keeps **revisions**: on any update that changes that text, the *previous* content is
appended to an immutable revision list with who wrote it and who replaced it
([`keepRevision`](../../packages/core/src/common.ts)).

| Object | Revised fields |
|---|---|
| Product | `concept` |
| Outcome | `title`, `description` |
| Source | — (metadata only; the activity log names the operation and the actor) |
| Annotation | `note` |
| Insight | `title`, `summary`, `body` |
| Assumption, Decision | `statement`, `body`, `citations` (while still editable, §4.8) |
| Story page | — (it has explicit, numbered, reader-visible versions instead, §4.11) |

Insights and outcomes have operations to read and restore revisions: `revisions` (list, bounded,
no bodies), `get_revision`, and `restore_revision` (writes the old content as a **new** update,
recorded like any other; it never rewinds history). Revisions of the other types are kept and
exported; operations to read them are planned.

◆ Decision: revisions are retained for the life of the object. Text is cheap, and the alternative
is explaining a retention rule to someone who just lost a paragraph to a well-meaning agent. They
are excluded from search and included in exports.

**Small edits and diffs.** `insights.update` and the registers' `update` take `edits`: up to 20
exact replacements `{ field?, old_text, new_text }`, applied in order, so a one-phrase correction
does not mean re-sending a long body ([`text-edits.ts`](../../packages/core/src/text-edits.ts)).
`field` is `body` by default, or `title` or `summary` on an insight and `statement` on an entry.
Each `old_text` must occur exactly once in its field at that point: no match is
`422 edit_not_found`, more than one is `422 edit_ambiguous` (with the count), and editing a field
the same call replaces whole is `422 invalid_input`. Any refusal changes nothing. Both updates
return `changed` (the fields that changed) and `diff`: per changed text field, one hunk
`{ field, at, before, removed, added, after }` from the first to the last difference, with 40
characters of unchanged context each side and the changed parts clipped at 300 characters, so a
slip in a re-sent text shows up in the result.

## 4.2 Outcomes

An outcome is what the product's users should be able to achieve with it. Outcomes sit under the
product concept ([§3.4](03-accounts-teams-and-identity.md)) on the Idea screen.

| Field | Rule |
|---|---|
| `outcome_id` | |
| `title` | 1–200 chars. |
| `description` | Markdown, 0–2,000 chars. |
| `status` | `active` (default), `achieved`, `archived`. |
| `position` | Ordering key within the product; new outcomes go last; reorder is an update. |

Insights, register entries and Story versions point *to* outcomes; outcomes hold no outgoing
references. Reads return counts of the insights, assumptions and decisions that point at each:
unarchived insights, and current (`unconfirmed` or `confirmed`) register entries. Superseded and
refuted entries are not counted, so a count matches the register's default view. `products.get`
counts assumptions and decisions the same way.

`outcomes.list` leaves archived outcomes out unless asked for `status: "archived"`, and says
how many it left out: `archived_hidden` (the count, honouring `query`) and, when it is not zero, a
`note`. An archived outcome can still be referenced. Insights (`refs.outcomes`) and register
entries (`outcome_ids`) return `archived_outcome_ids`: the referenced outcomes that are
archived, so a link to one is visible rather than accidental.

## 4.3 Sources

A source is one discovery event or document. It is stored as a **record**, so its id is
`record_id`.

| Field | Rule |
|---|---|
| `record_id` | Never changes, whatever else does (including a move to another product). |
| `kind` | One of the kinds in §4.4. Required. |
| `title` | 1–300 chars. Says what it is (who, what, when), never a file name. |
| `date` | `YYYY-MM-DD`: the date of the **event or document** the discovery question turns on, never the upload date. `null` when genuinely unknown. The web app calls it the **date captured**. |
| `slug` | Derived from the title. |
| `folder` | Derived, read-only: the source's logical placement (§4.4). |
| `organization` | Optional, ≤ 200 chars. The external organization the material concerns. |
| `participants` | Optional, ≤ 50 names of 1–100 chars. |
| `source_system` | Optional, ≤ 100 chars: where the material came from (a meeting tool, a wiki). |
| `tags` | ≤ 50, each 1–50 chars, normalized lower-case. |
| `related_records` | ≤ 50 source ids in the same product. |
| `dimensions` | `{ customer?, product_area?, lifecycle_stage? }`; `customer` and `product_area` are strings ≤ 120 chars normalized for case and spacing; `lifecycle_stage` is `discovery`, `sales` or `research` ([§8.3](08-search.md)). |
| `provenance_depth` | `primary`, `derived`, `analysis_of_analysis`, `unknown` (default). |
| `copied_from` | `{ product_id, record_id }` when the source is a copy ([§3.7](03-accounts-teams-and-identity.md)). |
| `uploaded_by`, `uploaded_at` | Actor snapshot and time of creation: the **date added**. |
| `updated_by`, `updated_at` | Actor snapshot and time of the last change to the source's details, archive or restore: the **date updated**. Adding a file changes the etag but not this. |
| files | §4.5. |
| `derived_status` and counts | The current derivation's status, or `pending` before one exists ([§5](05-derived-layer.md)). |

- **Reorganizing is a metadata change.** Changing `kind` or `date` re-derives `folder`. The
  `record_id`, file versions, derivations, and every citation are untouched.
- **Archive** takes the source out of browse, out of search (including the search space an agent
  can reach), and out of new citations. It erases nothing; existing citations still resolve by id
  and report `record_archived`; `restore` puts it back. This is the default and the first action
  the UI offers.
- **Delete** ([§9.5](09-data-lifecycle.md)) destroys the source and every byte under it,
  permanently. Editors may do it, through either adapter. It requires the current etag, a reason,
  and `confirm` set to exactly `delete permanently`, and it leaves a tombstone, so citations report
  `record_deleted` and reads return `410 record_deleted` rather than a bare `404`.
  `sources.delete_impact` previews what it will destroy and which citations it will orphan,
  including every Story page version that cites the source.
- **Read modes** (`detail`): `brief` (identity, kind, title, date, derived status, counts) and
  `full` (adds files, the derivation manifest, the outline, and notes). Neither includes file bytes
  or derived text. Both carry `warnings`, which says when the source has files but no primary yet,
  so nothing on it is searched.
- **Duplicates are warned about, not refused.** `sources.create` and `files.create_upload` return a
  warning naming any live source in the product with the same title (ignoring case and surrounding
  space), kind and date.

## 4.4 Kinds and placement: the opinionated taxonomy

The kind list is closed ([`packages/core/src/kinds.ts`](../../packages/core/src/kinds.ts)). It
describes discovery work and source formats, never a domain.

| Kind | Logical folder |
|---|---|
| `interview_transcript`, `interview_recording`, `interviewer_notes` | `interviews/<yyyy>` |
| `sales_call_recording`, `sales_call_transcript` | `sales-calls/<yyyy>` |
| `user_research_export`, `usability_session_notes` | `research/<yyyy>` |
| `wiki_export`, `prd`, `deck`, `contract_sow`, `rfp` | `documents/<wiki\|prds\|decks\|contracts\|rfps>` |
| `analysis`, `digest`, `view` | `documents/<analysis\|digests\|views>` |
| `design_insight` | `design` |
| `other` | `misc` |

- `<yyyy>` comes from `date`; dated kinds without a date use `undated`.
- The folder is a **browse facet**, not a storage location. Bytes are stored under immutable keys
  (§4.14), so a change of kind or date moves nothing. No caller ever supplies a folder.
- Retiring a kind later MUST leave existing sources readable and listable under their stored kind.

## 4.5 Files

Each file of a source:

| Field | Rule |
|---|---|
| `path` | Source-relative file name, unique within the source, ≤ 200 chars, no `/` traversal. |
| `role` | `primary`, `origin`, or `supplement`. |
| `media_type`, `size`, `sha256` | Taken from the stored object, never from caller claims. |
| `file_version_id` | Identifier of a stored version. Uploading to an existing `path` adds a version; earlier versions stay retrievable. |
| `derived_from`, `derivation_note`, `derived_by` | Optional provenance when this file was produced from others on the same source (a digest's originals): up to 20 paths, a note ≤ 2,000 chars. |
| `added_at`, `added_by` | |

Roles:

- **Exactly one `primary`** per source once it has any file (a unique index enforces it). The
  primary feeds the derived layer.
- **`origin`**: the material a digest or transcript was produced from. Retained and downloadable;
  outside derived search. Named `origin` rather than `source` so it does not collide with the
  product's own vocabulary.
- **`supplement`**: supporting material. Downloadable; not searchable, and search MUST NOT imply
  it was examined ([§8.4](08-search.md)).

Changing which file is primary, or uploading a new version of the primary, triggers a new
derivation.

Default limits: **100 MB per file** (`WHATBUILD_FILE_MAX_BYTES`), 25 MiB through the service's own
relay, 50 files per source. Inline notes (`files.add_note`): ≤ 2,048 bytes and ≤ 20 lines of plain
text. A per-tenant stored-bytes quota is planned ([§9.2](09-data-lifecycle.md)).
**No operation accepts base64 file content.** Upload flows: [§6.7](06-operations-and-adapters.md).

## 4.6 Annotations and agent notes

An **annotation** is a note on a source, optionally anchored to a passage.

| Field | Rule |
|---|---|
| `annotation_id`, `record_id` | |
| `seq_start`, `seq_end` | Optional, given together: an inclusive segment range of the current derivation, ≤ 50 segments. |
| `note` | Markdown, 1–2,000 chars. |
| `tags` | As sources. |
| `archive_reason` | Optional, ≤ 500 chars: why the note was archived. Given only with `archived: true`; restoring clears it. |
| `anchor` | When a range is given, a snapshot taken at creation (range, offsets, derivation id, and up to 500 characters of the text, with the speaker's `Name: ` at each change of speaker, a longer text cut at a word boundary and ending in an ellipsis), so the note can be re-located after a re-derivation. |

Editable (note only, keeping revisions), archivable.

**Agent notes** are an agent's own reading aids for a source: one `summary`, one `outline` and one
`notes` document per source, Markdown up to 100,000 chars, written with `derived.write_note` and
read with `derived.read_note`. They are an agent's interpretation, not the source's words, and are
labelled so.

## 4.7 Insights

| Field | Rule |
|---|---|
| `insight_id` | |
| `title` | 1–200 chars. |
| `summary` | 0–1,000 chars, plain text, shown in lists. |
| `body` | Markdown without HTML, 1–100,000 chars. |
| `status` | `draft` (default), `published` or `archived`. Publishing is an explicit action. |
| `revision` | Integer, starts at 1, increments on every change to title, summary or body. |
| `refs` | `{ outcomes[] ≤ 50, sources[] ≤ 100, insights[] ≤ 100, assumptions[] ≤ 100, decisions[] ≤ 100 }`, same product, validated to exist (`422 unknown_reference`, `422 cross_product_reference`). |

- Lists return everything except `body` (with `body_chars` and `body_words`, a count of runs of
  letters and digits that ignores Markdown punctuation). `get` returns the body in bounded
  windows (`offset`, `limit` default 20,000 and at most 100,000 chars) with a `truncated` flag;
  the UI pages through.
- The **per-source view** (`sources.insights_for`) for a source is: insights whose `refs.sources`
  include it, assumptions and decisions with a citation into it, live Story pages whose current
  version cites it or lists it in `refs`, and live views whose lineage lists it as a direct input.
- Evidence is cited in prose as a source id and segment range ("source 01K…, segments 4–6"); the
  web app renders such citations, and links to sources and passages, as evidence links
  ([`apps/web/src/lib/markdown.tsx`](../../apps/web/src/lib/markdown.tsx)).
  ◆ Decision: references are structural (`refs`); inline links are presentation only.

Insights carry revisions under the general rule in §4.1. `revision` above is the counter that rule
increments.

### Review

A person marks an insight **reviewed**: they read this revision and stand by it. It is not a vote
on truth, and it does not change the text or the revision.

| Field | Rule |
|---|---|
| `reviewed_revision` | The revision that was marked reviewed; `null` when never reviewed or cleared. |
| `reviewed_at`, `reviewed_by` | When, and the actor snapshot of who marked it. |
| `review_state` | Derived, never stored: `unreviewed` (no mark), `reviewed` (`reviewed_revision = revision`), `changed` (marked at an earlier revision: the text was edited since). |

- `insights.review { insight_id, reviewed, expected_etag }` marks the current revision (`reviewed:
  true`) or clears the mark (`false`). It changes the etag and appends an activity event.
- A change to `title`, `summary` or `body` increments `revision` and so turns `reviewed` into
  `changed` until someone reviews again. Status and reference changes leave the review standing.
- An agent calls `review` only to relay a review the person made; it never reviews on its own
  judgment. The actor snapshot records who made the call and through which surface.
- `insights.list` filters by one or more `review_state` values; list and get return
  `review_state`, `reviewed_revision`, `reviewed_at` and `reviewed_by`.

## 4.8 The registers

Two registers, **assumptions** and **decisions**, with the same shape and separate tools and lists.
Both are stored in one table with a `kind`; an entry's id is `id` (the tools also accept
`assumption_id` or `decision_id`, [§6.5](06-operations-and-adapters.md)), and a call on the wrong
register is `404`.

| Field | Rule |
|---|---|
| `id` | |
| `statement` | 1–1,000 chars. The premise or choice in one sentence. |
| `body` | Markdown, 0–10,000 chars: reasoning, stakes, alternatives considered. |
| `citations` | 0–20 (below). An entry may be recorded before any evidence cites it ([decision](../decisions/register-entries-may-start-uncited.md)). |
| `outcome_ids` | ≤ 20 outcome ids. |
| `links` | ≤ 50 of `{ id, type }` to entries in **either** register; `type` is `supports`, `contradicts`, or `supersedes`. Reads also return `linked_from` and `superseded_by` (the ids of entries that supersede this one, newest first). |
| `tags`, `dimensions`, `provenance_depth` | As sources. |
| `author`, `author_type` | Actor snapshot, and a declared `human` or `agent` ([§3.9](03-accounts-teams-and-identity.md)). |
| `status` | `unconfirmed` (initial), `confirmed`, `refuted`, `superseded`: always the status of the latest review. |
| `reviews` | Append-only, at most 500 per entry. |
| `frozen` | Derived: true once the entry has a review. |

List items carry the entry's state without a `get` per entry: `status`, `frozen`,
`superseded_by`, `link_count` (links out), `linked_from_count` (links in), `review_count`,
`human_review` and `archived_outcome_ids`. The list filters by one or more statuses.

### Citations

Input: `{ record_id, seq_start, seq_end, quote? }`: an inclusive segment range of ≤ 100 segments
in a live (unarchived) source of the same product with a `ready` derivation. If `quote` is given it
MUST occur exactly in the range's text, else `422 quote_not_found`. When the quote differs from the
range's text only in emphasis or code markers, spacing or a speaker label, the refusal gives the
range's own words in `details.exact_quote`; the quote is still refused. The quotes of one entry total
at most 40,000 characters. ([`packages/core/src/citations.ts`](../../packages/core/src/citations.ts))

Story page versions cite passages the same way, with the same input, limits and snapshot
(§4.11).

At creation the service stores an immutable **snapshot**:

```json
{
  "record_id": "01J…", "seq_start": 41, "seq_end": 43,
  "char_start": 10432, "char_end": 10987,
  "start_ms": 1815000, "end_ms": 1862000, "speakers": ["Dana"],
  "source_file": "call.vtt", "file_version_id": "01J…", "derivation_id": "01J…",
  "quote": "…the quote, or the exact text of the range…",
  "quote_hash": "…", "anchors_hash": "…",
  "captured_at": "2026-09-19T17:02:11Z"
}
```

`check_citations` re-resolves every citation of an entry and reports, per citation, one status, a
`version_drift` flag and a `derivation_changed` flag:

| Status | Meaning |
|---|---|
| `ok` | Same derivation, or a newer one in which the quote is found in the same range. |
| `relocated` | Quote intact but at a different segment range; the report gives the new range. |
| `text_changed` | The quote is no longer present in the current derivation. |
| `record_archived` | The source is archived: still readable, out of the default views. |
| `record_deleted` | The source was deliberately deleted; the tombstone gives who, when and why. |
| `record_missing` | The source cannot be resolved at all. |

`version_drift` is true when the primary file has a newer version than the snapshot's.
`derivation_changed` is true when the source has been parsed again since the snapshot (a new file
version or a re-derive), and then `current_derivation_id` names the derivation checked against. An
`ok` with `derivation_changed` says only that the quote is still in the range; the range's edges may
cover different text, so read the passage before relying on it.

Against a newer derivation the quote is looked for exactly first. If that fails it is matched again
with emphasis and code markers (`*`, `_` at a word edge, backticks), runs of whitespace, and a
`Name:` label at the start of a line set aside on both sides, the label only when the name is a
speaker of the source or of the snapshot. A match of that kind counts only where the source gives
the passage the labelled speaker, or none, and is reported with `quote_match: "normalized"` and a
`note`; it is `ok` in the same range and `relocated` elsewhere. Words, their order and punctuation
must still agree. The order of preference is exact in the range, normalised in the range, exact
elsewhere, normalised elsewhere.

It reports. It never rewrites a citation or a snapshot. The original passage stays readable
through its retained derivation ([§5.5](05-derived-layer.md)) unless the source was deleted, and
even then the **snapshot text survives**, because a citation snapshot is a quotation the team wrote
down, not a copy of the source ([§9.5](09-data-lifecycle.md)).

### Reviews

`{ status, note, reviewer, reviewer_type, confidence?, created_at }`

- `note` is required (1–2,000 chars). `reviewer` is the authenticated actor snapshot.
- `reviewer_type` is `human` or `agent`, defaulting from the surface (web → human, otherwise
  agent). An MCP caller MAY declare `human` only when relaying a judgment the person made in the
  conversation; the declaration is recorded as made.
- `confidence` (`low`, `medium`, `high`) is accepted only when `reviewer_type = human`; otherwise
  `422 confidence_requires_human`. Lists filter by the latest human confidence.
- Reviews are never edited or removed. A changed mind is a new review.

### Corrections and links

- ◆ Decision: `statement`, `body`, and `citations` are editable only while the entry has no
  review. After the first review — any review, by a person or an agent, with any status, including
  one that leaves it `unconfirmed` — they are frozen (`409 frozen`); the `review` guidance says
  so: a correction is a **new entry**
  created with `supersede`, which links `supersedes` → the old entry and records a `superseded`
  review on the old entry in the same atomic operation. `tags`, `outcome_ids`, and `links` stay
  editable.
- Links are type-checked **before** any mutation: the target must exist in the same product, a
  self-link is rejected, a duplicate `{id, type}` is rejected, and `supersedes` must be acyclic.

## 4.9 Views and lineage

A **view** is a derived document stored as a source of kind `view` (likewise `analysis`,
`digest`): something produced *from* other material. It can carry a **lineage baseline**, in three
steps ([`lineage.ts`](../../packages/core/src/ops/lineage.ts)):

- `capture` fingerprints 1–50 inputs (sources, assumptions, decisions) at that moment. An archived
  input is refused. A source's fingerprint covers its kind, title, date, organization, primary
  file version, current derivation and archived state; a register entry's covers its statement,
  body, citations, status, review count and archived state.
- `write` attaches the untouched fingerprints, `captured_at` as capture returned it (optional;
  refused if in the future), and a description of how the inputs were chosen to the view,
  refusing with `409 input_changed` if any input changed since capture. It also stores a short hash
  of each part the fingerprint covers; the fingerprint itself is unchanged.
- `check` reports each input as `current`, `changed`, `archived`, `deleted`, or `missing`, and
  whether the view is `stale`. A `changed` input lists `changed_parts` (the parts above whose hash
  differs) and `last_changed_at` (the latest recorded time among them: the source's or entry's
  `updated_at`, the file version's or derivation's `created_at`). Lineage written before parts were
  stored reports `changed_parts: null` with a note that the parts were not recorded.
- A view's full `sources.get` includes its lineage: the direct inputs, the query spec,
  `captured_at`, and when and by whom it was registered. Staleness comes only from `check`.
- It reports drift. It does not regenerate anything. It checks direct inputs only: a view built on
  a decision is not told when a source that decision cites changes (recursive lineage:
  [§8.6](08-search.md)).

## 4.10 Activity

An append-only event log, written in the same transaction as the mutation that caused it
([`recordActivity`](../../packages/core/src/common.ts)).

| Field | Rule |
|---|---|
| `activity_id` | ULID; ordering key. |
| `occurred_at` | Timestamp. |
| `action` | What happened, e.g. `created`, `reviewed`, `archived`, `derived`. |
| `entity_type`, `entity_id`, `entity_title` | What was touched. |
| `actor`, `channel` | Actor snapshot; the surface (`web`, `rest`, `mcp`), or none for the system. |
| `summary` | ≤ 280 chars, generated: "Marked confirmed with high confidence", "Parsed call.vtt into 412 passages". |

- **It never contains content.** No bodies, no passage text, no HTML, no email addresses. The
  summary names objects; it does not quote them.
- `activity.list` filters by `entity_type`, `entity_id`, `actor`, `channel`, `by` (`people` for
  the app and the REST API, `agents` for MCP) and `since`, with the usual bounds. Every role on the
  product can read it.
- Events are immutable and are retained for the life of the tenant. They are included in a product
  export.
- Several people and several agents write into one product, and "what did that agent just do" is a
  question the product must be able to answer.

## 4.11 Story

**Pages.** `page_id` (a slug the author chooses, `[a-z0-9][a-z0-9-]*`, ≤ 80 chars, e.g.
`overview`), `title` (1–200), `summary` (≤ 2,000), `archived_at`, `current_version`, and an
append-only list of **versions**. The first publish creates the page and needs a `title`. A
version is immutable: `version` (1, 2, 3…), `title`, `summary` (describes the page), `html`,
`refs`, `citations`, `published_at`, `published_by`, and `html_sha256` (computed on read, so
identical HTML can be recognised without reading it). Readers see the latest version; any version
can be read by number. Limit: 50 pages per product (`409 quota_exceeded`). Agents write, arrange,
archive and restore pages; the web app reads them
([decision](../decisions/agents-maintain-the-story-people-read-it.md)).
◆ Decision: a version has no change note. What changed is in the activity log, and an agent's
working context is in the page's notes. The `story_versions.note` column stays for versions
published before the note was removed, and is neither written nor returned; a product export
still includes it.

**Later versions.** Publishing a new version of an existing page requires the page's current etag.
It starts from a **base version**, the current one unless `from_version: N` names another, and
takes every field it omits (`title`, `summary`, `html`, `refs`, `citations`) from the base;
the result lists them in `carried_forward`, with `based_on_version`. Carried citations keep their
snapshots. `patch_html: [{find, replace}]` edits the base HTML instead of replacing it: each `find`
must occur exactly once when its turn comes, or nothing is published (`422 invalid_patch` listing
every failed edit). A generated title page follows a new title or summary. `from_version` alone
restores the base as a new version, and the activity log records "Published version N from
version M". An unknown `from_version` is `404`.
◆ Decision: a later version carries forward what it omits, so changing a sentence or reverting a
page never means re-sending the whole page. A list that is passed replaces the previous list in
full; an empty list clears it.

**HTML rules**, validated at publish (`422 invalid_html` listing every problem at once;
[`story-html.ts`](../../packages/core/src/story-html.ts)):

- One self-contained document, ≤ 1,000,000 chars; inline CSS; at most 10 inline scripts, and
  inline scripts and event handlers together ≤ 32,000 chars.
- No external references of any kind: `src`, `srcset`, `poster` and similar attributes, style
  `url()` and CSS must use `data:` URIs; no `@import`; `<script src>` is refused. Ordinary
  `<a href>` links are allowed.
- No `<iframe>`, `<frame>`, `<frameset>`, `<object>`, `<embed>`, `<portal>`, `<form>`, `<link>`,
  `<base>`, or `<meta http-equiv>`.

**Rendering.** A version's HTML is served by its own REST route with a sandboxing
Content-Security-Policy (`sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox;
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src
data:; media-src data:; connect-src 'none'; …`), and the web app shows it in an
`<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox">`, never
`allow-same-origin`. The page therefore runs in an opaque origin, can make no network request, and
reaches nothing of the application. Validation is a courtesy to authors; the sandbox is the
security boundary. This matters because the author of a Story page and its reader are routinely
different people.

**Citations.** A version may carry up to 20 `citations`, `{ record_id, seq_start, seq_end,
quote? }`, snapshotted exactly as register citations are (§4.8), with the same quote budget of
40,000 characters per version. Like `refs`, they belong to the version: a publish that passes them
passes the full list, and one that omits them keeps the base version's. Reading a version returns each citation with its source's
current title, and each `refs` id resolved to its current title and state (`resolved_refs`).
`story.check_citations { page_id, version? }` re-resolves a version's citations (the current one by
default) with the statuses in §4.8. It reports; it never rewrites.

**Notes for agents.** Each page has one Markdown note, `agent_notes` (≤ 20,000 chars), that agents
keep while writing and maintaining the page: what the page is for and who reads it, sources still
to fold in, decisions about its structure. It is not versioned with the HTML and is not shown on
the page. It has its own etag (`agent_notes.etag`), so editing the note and publishing the page
never conflict. `story.write_notes { page_id, notes, expected_etag? }` replaces it and records
`agent_notes_updated_at` and `agent_notes_updated_by`; `expected_etag` may be omitted only while
the notes are empty, and passing the page etag instead is refused with a message that says so.
`story.get_page` returns the notes as `agent_notes { content, etag, updated_at, updated_by }`, and
`story.publish` returns their etag as `agent_notes_etag`.

**Print view.** `story.print_view` composes 1–50 chosen pages, each at its current version, into
one HTML document for a browser to print to PDF ([§6.4](06-operations-and-adapters.md)).

**Hierarchy.** A separate per-product object with its own etag: an ordered tree of `page_id`s,
depth ≤ 6, each page at most once, every page live and published. Publishing a page never places
it; placing a page never publishes it. Unplaced pages are listed for editors and absent from the
reader's navigation. Archived pages are dropped from the rendered navigation but keep their place
if restored.

**Guidance.** `story.guidance` returns versioned design and writing guidance (tokens, a
stylesheet, recipes, layouts, editorial passes, a checklist and a starter page) so authoring
quality does not depend on an agent's taste. Its colors, radii and UI fonts are copied from the web
app's design tokens ([`story-guidance.ts`](../../packages/core/src/story-guidance.ts)), and a
server test fails when the two drift apart. The stylesheet keeps pages readable at phone width
(about 390 px): tables sit in a scrolling `.wb-table-wrap`, cells keep a minimum width so a fourth
column scrolls rather than squeezes, and status labels never wrap. The writing guidance asks for
source-level quoting rules honoured (attribution by role where a source
limits naming people), derived views labelled as analysis rather than evidence, and pages placed in
the hierarchy unless the author's instructions say otherwise.

## 4.12 Feedback

`submit_feedback { category, message, tool?, details? }`: `category` is `issue`, `confusion`,
`feature_request`, or `other`; `message` 1–4,000 chars; `tool` ≤ 64 chars; `details` ≤ 4,000
chars. Account-level (not tied to a tenant), attributed, stored with the server version, and
**write-only**: there is no read operation in either adapter. Operators read feedback from the
store directly.

## 4.13 The product bundle

A product exports to a single ZIP (`products.export`, open to every role on the product). A worker
job builds it; it can be downloaded for seven days ([`export.ts`](../../packages/core/src/ops/export.ts)).

```
bundle.json                 format and format version, exported_at/by, server version, tenant, team, product
README.txt
outcomes.json
records/<record_id>/record.json                  the source with its files and versions
records/<record_id>/files/<file_version_id>/<path>
records/<record_id>/derived/<derivation_id>/{segments.jsonl,text.md,outline.md,manifest.json}
records/<record_id>/annotations.json · agent-notes/<kind>.md · lineage.json
insights/<insight_id>.json  ·  insights/<insight_id>.md
registers/assumptions.json  ·  registers/decisions.json       with their reviews
revisions.json
story/hierarchy.json  ·  story/pages/<page_id>/page.json  ·  story/pages/<page_id>/v<n>.{json,html}
tombstones.json
activity.jsonl
```

- `record.json` is the portable, self-describing form of a source: a bundle is readable by a
  person with a ZIP tool and nothing else.
- Feedback is not part of an export.
- Planned ([§9.4](09-data-lifecycle.md)): **import**, which preserves every id, version, snapshot,
  review, revision and actor snapshot, creates a product and never merges into one (`409` if the
  `product_id` exists, unless the caller asks for a copy, which re-mints the product id only); and
  a **tenant export** of every product's bundle plus members and outstanding invitations.

## 4.14 Storage layout

- **Metadata** lives in Postgres: one table per object type with ordinary columns, JSONB for nested
  values (actor snapshots, citations, refs, links), and indexes for the filters in this spec.
  Append-only data (reviews, Story versions, derivations, revisions, activity events, tombstones)
  lives in its own tables and is never updated. Every content table has a row-level security
  policy keyed on the transaction-local `app.tenant_id`. Directory tables (accounts, sessions,
  tokens, OAuth clients, tenants, teams, products, memberships, invitations) and the job queue and
  feedback tables have no row-level security and are reached only through the authorization layer.
- **Blobs** are immutable and keyed opaquely: `t/<tenant_id>/r/<record_id>/f/<file_version_id>`
  for files, `t/<tenant_id>/r/<record_id>/d/<derivation_id>/<sidecar>` for derived sidecars, and
  `t/<tenant_id>/exports/<export_id>.zip` for exports. Keys never encode titles, kinds, or folders,
  so no metadata change ever moves bytes, and a key names its tenant. A copied source shares its
  original's file blobs; delete frees a blob only when no file version still refers to it.
- **Segments** of every derivation are also loaded into Postgres for passage reads, with the
  current derivation's segments flagged `is_current`; only those are indexed for search.
