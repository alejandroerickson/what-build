---
type: Specification
title: Every object in a product, with its fields, limits and invariants, as the REST and MCP wire sees it.
description: The common envelope (ids, etags, attribution, revisions), objectives, sources and their taxonomy, files, annotations, insights and insight review, the registers and citations, views and lineage, activity, Story, feedback, the product bundle, and the storage layout.
tags: [spec, data-model, schema, citations, revisions, story, export]
generated: {by: agent:claude, at: 2026-09-27}
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
| `archived_at` | Where the type supports archive (sources, annotations, register entries, Story pages). Objectives and insights archive through `status: "archived"` instead. Archived objects are excluded from lists and search unless asked for, and remain readable by id. |

**Concurrency.** Every update, review, link, single-object archive and restore, and every Story
publish after a page's first version requires the current etag (`expected_etag` in the input, or
`If-Match` in REST). Missing → `422`. Stale → `409 stale_etag`, with the current etag in
`details.current_etag` so a caller can re-read and retry deliberately. Creates take no etag;
neither do the batch `sources.archive` / `sources.restore` or `files.set_role`. Check-and-write is
atomic: the row is locked (`SELECT … FOR UPDATE`) in the same transaction.

**Unknown fields are rejected** (`422 invalid_input`), in every input, at every depth: every input
schema is a strict Zod object.

**Every mutation appends an activity event** (§4.10) in the same transaction.

**Authored text is never lost to an overwrite.** Every object with a body a person or an agent
writes keeps **revisions**: on any update that changes that text, the *previous* content is
appended to an immutable revision list with who wrote it and who replaced it
([`keepRevision`](../../packages/core/src/common.ts)).

| Object | Revised fields |
|---|---|
| Product | `idea` |
| Objective | `title`, `description` |
| Source | — (metadata only; the activity log names the operation and the actor) |
| Annotation | `note` |
| Insight | `title`, `summary`, `body` |
| Assumption, Decision | `statement`, `body`, `citations` (while still editable, §4.8) |
| Story page | — (it has explicit, numbered, reader-visible versions instead, §4.11) |

Insights and objectives have operations to read and restore revisions: `revisions` (list, bounded,
no bodies), `get_revision`, and `restore_revision` (writes the old content as a **new** update,
recorded like any other; it never rewinds history). Revisions of the other types are kept and
exported; operations to read them are planned.

◆ Decision: revisions are retained for the life of the object. Text is cheap, and the alternative
is explaining a retention rule to someone who just lost a paragraph to a well-meaning agent. They
are excluded from search and included in exports.

## 4.2 Objectives

| Field | Rule |
|---|---|
| `objective_id` | |
| `title` | 1–200 chars. |
| `description` | Markdown, 0–2,000 chars. |
| `status` | `active` (default), `achieved`, `archived`. |
| `position` | Ordering key within the product; new objectives go last; reorder is an update. |

Insights, register entries and Story versions point *to* objectives; objectives hold no outgoing
references. Reads return counts of the insights, assumptions and decisions that point at each.

## 4.3 Sources

A source is one discovery event or document. It is stored as a **record**, so its id is
`record_id`.

| Field | Rule |
|---|---|
| `record_id` | Never changes, whatever else does (including a move to another product). |
| `kind` | One of the kinds in §4.4. Required. |
| `title` | 1–300 chars. Says what it is (who, what, when), never a file name. |
| `date` | `YYYY-MM-DD`: the date of the **event or document** the discovery question turns on, never the upload date. `null` when genuinely unknown. |
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
| `uploaded_by`, `uploaded_at` | Actor snapshot and time of creation. |
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
  `sources.delete_impact` previews what it will destroy and which citations it will orphan.
- **Read modes** (`detail`): `brief` (identity, kind, title, date, derived status, counts) and
  `full` (adds files, the derivation manifest, the outline, and notes). Neither includes file bytes
  or derived text.

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
| `anchor` | When a range is given, a snapshot taken at creation (range, offsets, derivation id, and up to 500 characters of the text, a longer text cut at a word boundary and ending in an ellipsis), so the note can be re-located after a re-derivation. |

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
| `refs` | `{ objectives[] ≤ 50, sources[] ≤ 100, insights[] ≤ 100, assumptions[] ≤ 100, decisions[] ≤ 100 }`, same product, validated to exist (`422 unknown_reference`, `422 cross_product_reference`). |

- Lists return everything except `body` (with `body_chars`). `get` returns the body in bounded
  windows (`offset`, `limit` default 20,000 and at most 100,000 chars) with a `truncated` flag;
  the UI pages through.
- The **per-source view** (`sources.insights_for`) for a source is: insights whose `refs.sources`
  include it, assumptions and decisions with a citation into it, and live Story pages whose current
  version cites it or lists it in `refs`.
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
Both are stored in one table with a `kind`; an entry's id is `id`, and a call on the wrong register
is `404`.

| Field | Rule |
|---|---|
| `id` | |
| `statement` | 1–1,000 chars. The premise or choice in one sentence. |
| `body` | Markdown, 0–10,000 chars: reasoning, stakes, alternatives considered. |
| `citations` | 1–20 (below). |
| `objective_ids` | ≤ 20 objective ids. |
| `links` | ≤ 50 of `{ id, type }` to entries in **either** register; `type` is `supports`, `contradicts`, or `supersedes`. Reads also return `linked_from`. |
| `tags`, `dimensions`, `provenance_depth` | As sources. |
| `author`, `author_type` | Actor snapshot, and a declared `human` or `agent` ([§3.9](03-accounts-teams-and-identity.md)). |
| `status` | `unconfirmed` (initial), `confirmed`, `refuted`, `superseded`: always the status of the latest review. |
| `reviews` | Append-only, at most 500 per entry. |
| `frozen` | Derived: true once the entry has a review. |

### Citations

Input: `{ record_id, seq_start, seq_end, quote? }`: an inclusive segment range of ≤ 100 segments
in a live (unarchived) source of the same product with a `ready` derivation. If `quote` is given it
MUST occur exactly in the range's text, else `422 quote_not_found`. The quotes of one entry total
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

`check_citations` re-resolves every citation of an entry and reports, per citation, one status and
a `version_drift` flag:

| Status | Meaning |
|---|---|
| `ok` | Same derivation, or a newer one in which the quote is found in the same range. |
| `relocated` | Quote intact but at a different segment range; the report gives the new range. |
| `text_changed` | The quote is no longer present in the current derivation. |
| `record_archived` | The source is archived: still readable, out of the default views. |
| `record_deleted` | The source was deliberately deleted; the tombstone gives who, when and why. |
| `record_missing` | The source cannot be resolved at all. |

`version_drift` is true when the primary file has a newer version than the snapshot's.

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
  review. After the first review they are frozen (`409 frozen`): a correction is a **new entry**
  created with `supersede`, which links `supersedes` → the old entry and records a `superseded`
  review on the old entry in the same atomic operation. `tags`, `objective_ids`, and `links` stay
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
- `write` attaches the untouched fingerprints and a description of how the inputs were chosen to
  the view, refusing with `409 input_changed` if any input changed since capture.
- `check` reports each input as `current`, `changed`, `archived`, `deleted`, or `missing`, and
  whether the view is `stale`.
- It reports drift. It does not regenerate anything. It checks direct inputs only (recursive
  lineage: [§8.6](08-search.md)).

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
append-only list of **versions**. The first publish creates the page. A version is immutable:
`version` (1, 2, 3…), `title`, `summary`, `html`, `note` (what changed, ≤ 500 chars), `refs`,
`citations`, `published_at`, `published_by`. Publishing a new version of an existing page requires
the page's current etag. Readers see the latest version; any version can be read by number.
Limit: 50 pages per product (`409 quota_exceeded`).

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
40,000 characters per version. Like `refs`, they belong to the version: each publish passes the
full list, and nothing carries over. Reading a version returns each citation with its source's
current title, and each `refs` id resolved to its current title and state (`resolved_refs`).
`story.check_citations { page_id, version? }` re-resolves a version's citations (the current one by
default) with the statuses in §4.8. It reports; it never rewrites.

**Notes for agents.** Each page has one Markdown note, `agent_notes` (≤ 20,000 chars), that agents
keep while writing and maintaining the page: what the page is for and who reads it, sources still
to fold in, decisions about its structure. It is not versioned with the HTML and is not shown on
the page. It has its own etag (`agent_notes.etag`), so editing the note and publishing the page
never conflict. `story.write_notes { page_id, notes, expected_etag }` replaces it and records
`agent_notes_updated_at` and `agent_notes_updated_by`; `story.get_page` returns it as
`agent_notes { content, etag, updated_at, updated_by }`.

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
server test fails when the two drift apart.

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
objectives.json
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
