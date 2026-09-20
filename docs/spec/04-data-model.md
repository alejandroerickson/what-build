# 4. Data model

All objects are project-scoped unless stated. Field names here are the wire names used by REST,
MCP, and bundles.

## 4.1 The common envelope

Every editable object carries:

| Field | Rule |
|---|---|
| `id` (named per type, e.g. `record_id`) | ULID, immutable, unique across the workspace. |
| `project_id` | Immutable. |
| `etag` | Opaque string; changes on every successful mutation. |
| `created_at`, `created_by` | Timestamp and actor snapshot ([§3.6](03-tenancy-and-identity.md)). |
| `updated_at`, `updated_by` | Same, for the latest mutation. |
| `archived` | Boolean, where the type supports archive. Archived objects are excluded from lists and search unless asked for, and remain readable by id. |

**Concurrency.** Every update, archive, restore, review, and link operation requires the current
`etag` (`If-Match` in REST, `etag` in MCP). Missing → `422`. Stale → `409 stale_etag`, with the
current `etag` in `details` so a caller can re-read and retry deliberately. Creates do not take an
ETag. Implementations MUST make check-and-write atomic.

**Unknown fields are rejected** (`422`), in every input, at every depth.

## 4.2 Objectives

| Field | Rule |
|---|---|
| `objective_id` | |
| `title` | 1–200 chars. |
| `description` | Markdown, 0–2,000 chars. |
| `status` | `active` (default), `achieved`, `archived`. |
| `position` | Ordering key within the project; reorder is an update. |

Insights and register entries point *to* objectives; objectives hold no outgoing references.

## 4.3 Records

A record is one discovery event or document.

| Field | Rule |
|---|---|
| `record_id` | Never changes, whatever else does. |
| `kind` | One of the kinds in §4.4. Required. |
| `title` | 1–300 chars. |
| `date` | The date of the **event or document** the discovery question turns on — never the upload date. `null` when genuinely unknown. |
| `slug` | Derived from title; used only in the logical folder. |
| `folder` | Derived, read-only: the record's logical placement (§4.4). |
| `organization` | Optional, ≤ 200 chars. The external organization the source concerns. |
| `participants` | Optional, ≤ 50 of `{ name, role? }`. |
| `source_system` | Optional, ≤ 100 chars: where the material came from (a meeting tool, a wiki). |
| `tags` | ≤ 50, each 1–50 chars, normalized lower-case. |
| `related_records` | ≤ 50 record ids in the same project. |
| `dimensions` | `{ customer?, product_area?, lifecycle_stage? }`, normalized strings ([§8.3](08-search.md)). |
| `provenance_depth` | `primary`, `derived`, `analysis_of_analysis`, `unknown`. |
| `uploaded_by`, `uploaded_at` | Actor snapshot and time of creation. |
| `files[]` | §4.5. |
| `derivation` | Summary of the current derivation: `derivation_id`, `status`, counts ([§5](05-derived-layer.md)). |

- **Reorganizing is a metadata change.** Changing `kind`, `date`, or `title` re-derives `folder`.
  The `record_id`, file versions, derivations, and every citation are untouched.
- **Archive** hides the record from browse, search, and the per-source insight tab; it erases
  nothing; citations to it still resolve by id and report `source_archived`.
- **Read modes:** `brief` (identity, kind, title, date, derivation status, counts) and `full`
  (everything above). Neither includes file bytes or derived text.

## 4.4 Kinds and placement — the opinionated taxonomy

The kind list is closed. It describes discovery work and source formats, never a domain.

| Kind | Logical folder |
|---|---|
| `interview_transcript`, `interview_recording`, `interviewer_notes` | `interviews/<yyyy>/<slug>/` |
| `sales_call_recording`, `sales_call_transcript` | `sales-calls/<yyyy>/<slug>/` |
| `user_research_export`, `usability_session_notes` | `research/<yyyy>/<slug>/` |
| `wiki_export`, `prd`, `deck` | `documents/<wiki|prds|decks>/<slug>/` |
| `design_insight` | `design/<slug>/` |
| `analysis`, `digest`, `view` | `documents/<analysis|digests|views>/<slug>/` |
| `other` | `misc/<slug>/` |

- `<yyyy>` comes from `date`; records without a date use `undated`.
- The folder is a **browse facet and an export path**, not a storage location. Bytes are stored
  under immutable keys (§4.13), so a move rewrites nothing. No caller ever supplies a folder.
- Retiring a kind later MUST leave existing records readable and listable under their stored kind.

## 4.5 Files

Each entry in `files[]`:

| Field | Rule |
|---|---|
| `path` | Record-relative file name, unique within the record, ≤ 200 chars, no `/` traversal. |
| `role` | `primary`, `source`, or `supplement`. |
| `media_type`, `size`, `sha256` | Taken from the stored object, never from caller claims. |
| `version_id` | Identifier of the stored version. Uploading to an existing `path` adds a version; earlier versions stay retrievable. |
| `derived_from`, `derivation_note`, `derived_by` | Optional provenance when this file was produced from another (a digest derived from a recording). |
| `added_at`, `added_by` | |

Roles:

- **Exactly one `primary`** per record once it has any file. The primary feeds the derived layer.
- **`source`** — origin material a digest or transcript was produced from. Retained and
  downloadable; outside derived search.
- **`supplement`** — supporting material. Downloadable; not searchable, and search MUST NOT imply
  it was examined ([§8.4](08-search.md)).

Changing which file is primary, or uploading a new version of the primary, triggers a new
derivation.

Default limits (operator-configurable): 500 MB per file; 50 files per record. Inline notes: ≤ 2 KB
and ≤ 20 lines of plain text. **No operation accepts base64 file content.**
Upload flows: [§6.7](06-operations-and-adapters.md).

## 4.6 Annotations

A note attached to a passage of a record.

| Field | Rule |
|---|---|
| `annotation_id`, `record_id` | |
| `seq_start`, `seq_end` | Inclusive segment range, ≤ 50 segments. |
| `note` | Markdown, 1–2,000 chars. |
| `anchor` | Snapshot taken at creation, same shape as a citation snapshot (§4.8), so the note can be re-located after a re-derivation. |

Editable (note only), archivable.

## 4.7 Insights

| Field | Rule |
|---|---|
| `insight_id` | |
| `title` | 1–200 chars. |
| `summary` | 0–1,000 chars, plain text. |
| `body` | Markdown, 0–100,000 chars. |
| `status` | `draft` (default) or `published`. Publishing is an explicit action. |
| `refs` | `{ objectives[], records[], insights[], assumptions[], decisions[] }`, each ≤ 100 ids, same project, validated to exist. |

- Lists return everything except `body`. `get` returns the body in bounded windows
  (`offset`, `limit` ≤ 20,000 chars) with a `truncated` flag; the UI pages through.
- The **per-source insight view** for a record is: insights whose `refs.records` include it, plus
  assumptions and decisions with a citation into it.
- Inside `body`, `[[<id>]]` renders as a link to the referenced object when that id is in `refs`.
  ◆ Decision: references are structural (`refs`), the inline form is presentation only.

## 4.8 The registers

Two registers — **assumptions** and **decisions** — with the same shape and separate id spaces,
lists, and tools.

| Field | Rule |
|---|---|
| `assumption_id` / `decision_id` | |
| `statement` | 1–500 chars. The premise or choice in one sentence. |
| `body` | Markdown, 0–10,000 chars: reasoning, stakes, alternatives considered. |
| `citations` | 1–20 (below). |
| `objectives` | ≤ 20 objective ids. |
| `links` | ≤ 50 of `{ id, type }` to entries in **either** register; `type` is `supports`, `contradicts`, or `supersedes`. |
| `tags` | As records. |
| `review_status` | `unconfirmed` (initial), `confirmed`, `refuted`, `superseded` — always equal to the status of the latest review. |
| `reviews[]` | Append-only. |

### Citations

Input: `{ record_id, seq_start, seq_end, quote? }` — an inclusive segment range of ≤ 50 segments
in a record of the same project with a `ready` derivation. If `quote` is given it MUST occur
exactly in the range's text, else `422`.

At creation the service stores an immutable **snapshot**:

```json
{
  "text": "…exact text of the range, or of the quote…",
  "text_sha256": "…",
  "char_start": 10432, "char_end": 10987,
  "start_ms": 1815000, "end_ms": 1862000, "speakers": ["Dana"],
  "derivation_id": "01J…", "source_version_id": "01J…",
  "captured_at": "2026-09-19T17:02:11Z"
}
```

`check_citations` re-resolves every citation of an entry and reports one of:

| Status | Meaning |
|---|---|
| `ok` | Same derivation, or a newer one in which the snapshot text is found intact. |
| `relocated` | Text intact but at a different segment range; the report gives the new range. |
| `text_changed` | The text is no longer present in the current derivation. |
| `version_drift` | The primary file has a newer version than the snapshot's; combined with one of the above. |
| `source_archived` | The record is archived. |
| `source_missing` | The record cannot be resolved. |

It reports. It never rewrites a citation or a snapshot. The original passage stays readable
through its retained derivation ([§5.5](05-derived-layer.md)).

### Reviews

`{ status, note, reviewer, reviewer_kind, confidence?, reviewed_at }`

- `note` is required (1–2,000 chars). `reviewer` is the authenticated actor snapshot.
- `reviewer_kind` is `human` or `agent`, defaulting from the surface (web → human, mcp → agent).
  An MCP caller MAY declare `human` only when relaying a judgment the person made in the
  conversation; the declaration is recorded as made.
- `confidence` (`low`, `medium`, `high`) is accepted only when `reviewer_kind = human`; otherwise
  `422`.
- Reviews are never edited or removed. A changed mind is a new review.

### Corrections and links

- ◆ Decision: `statement`, `body`, and `citations` are editable only while the entry has no review
  beyond its initial `unconfirmed` state. After the first review they are frozen: a correction is a
  **new entry** created with `supersede`, which links `supersedes` → the old entry and records a
  `superseded` review on the old entry in the same atomic operation. `tags`, `objectives`, and
  `links` stay editable.
- Links are type-checked **before** any mutation: the target must exist in the same project, a
  self-link is rejected, a duplicate `{id, type}` is rejected, and `supersedes` must be acyclic.

## 4.9 Views and lineage

A **view** is a derived document stored in the library as a record of kind `view` (likewise
`analysis`, `digest`): something produced *from* other material. It can carry a **lineage
baseline**:

- `capture` fingerprints up to 50 inputs — records, assumptions, decisions — at that moment.
  A record's fingerprint covers its primary `version_id`, current `derivation_id`, and archived
  state; a register entry's covers its content hash and `review_status`.
- `check` reports each input as `current`, `changed`, `archived`, `missing`, or `unavailable`.
- It reports drift. It does not regenerate anything. (Recursive lineage: [§8.6](08-search.md).)

## 4.10 Story

**Pages.** `page_id`, `title` (1–200), `slug`, `archived`, `current_version`, and an append-only
list of **versions**. A version is immutable: `version` (1, 2, 3…), `html`, `note` (what changed,
≤ 500 chars), `published_at`, `published_by`. Publishing a version requires the page's current
ETag. Readers see the latest version; any version can be read by number.

**HTML rules**, validated at publish (`422` with a precise list of violations):

- One self-contained document, ≤ 512 KB; inline CSS; inline JavaScript ≤ 64 KB in total.
- No external references of any kind: no `src`/`href` to network URLs for scripts, styles, images,
  fonts, media, or frames; images are inline SVG or `data:` URIs. Ordinary `<a href>` links are
  allowed and open in a new tab.
- No `<iframe>`, `<object>`, `<embed>`, `<base>`, or `<meta http-equiv>`.

**Rendering.** Always in an `<iframe sandbox="allow-scripts allow-popups">` — never
`allow-same-origin` — fed by `srcdoc`, with an injected CSP of
`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:`.
The page can therefore make no network request, open no frame, and reach nothing of the
application. Validation is a courtesy to authors; the sandbox is the security boundary.

**Hierarchy.** A separate per-project object with its own ETag: an ordered tree of `page_id`s,
depth ≤ 4, each page at most once. Publishing a page never places it; placing a page never
publishes it. Unplaced pages are listed for editors and absent from the reader's navigation.
Archived pages are dropped from the rendered navigation but keep their place if restored.

**Guidance.** `story.guidance` returns versioned design and writing guidance — tokens, layout
patterns, accessibility rules, tone, and a starter template — so authoring quality does not depend
on an agent's taste. It MUST be derived from this product's own design system once that exists;
until then it ships a deliberately minimal neutral template.

## 4.11 Feedback

`submit_feedback { category, message, context? }` — `category` is `bug`, `friction`, `idea`, or
`praise`; `message` 1–4,000 chars; `context` an optional small JSON object (tool, action, error
code). Workspace-level, attributed, **write-only**: there is no read operation in either adapter.
Operators read feedback from the store directly.

## 4.12 Project bundle

A project exports to a single ZIP, and imports from one, in every profile.

```
bundle.json                 format version, schema version, exported_at, project envelope
objectives.json
records/<record_id>/record.json
records/<record_id>/files/<version_id>/<path>
records/<record_id>/derived/<derivation_id>/{segments.jsonl,text.md,outline.md,manifest.json}
records/<record_id>/annotations.json
insights/<insight_id>.json  ·  insights/<insight_id>.md
registers/assumptions.json  ·  registers/decisions.json
views/lineage.json
story/hierarchy.json  ·  story/pages/<page_id>/page.json  ·  story/pages/<page_id>/v<n>.html
```

- Import preserves every id, version, snapshot, review, and actor snapshot. It creates a project;
  it never merges into one. If the `project_id` already exists in the workspace, import fails with
  `409` unless the caller asks for a copy, which re-mints the project id only.
- `record.json` is the portable, self-describing form of a record: a bundle is readable by a
  person with a ZIP tool and nothing else.
- Feedback is not part of a bundle.

## 4.13 Storage layout

- **Metadata** lives in the database; one table per object type with indexed columns for every
  filter in this spec and the full object as JSON. Append-only data (reviews, page versions,
  derivations) lives in its own tables and is never updated.
- **Blobs** are immutable and keyed opaquely:
  `w/<workspace_id>/p/<project_id>/r/<record_id>/f/<version_id>` for files and
  `…/r/<record_id>/d/<derivation_id>/<sidecar>` for derived sidecars. Keys never encode titles,
  kinds, or folders, so no metadata change ever moves bytes.
- **Segments** of each record's *current* derivation are also loaded into the database for passage
  reads and search. Older derivations are read from their sidecar blobs.
