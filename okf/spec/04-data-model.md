---
type: Specification
title: Every object in a product, with its fields, limits and invariants, as the REST and MCP wire sees it.
description: The common envelope (ids, etags, attribution, revisions), outcomes, sources and their tags, attachments, comments, summaries and notes, evidence links, the assumption register, views, activity, Story, mockups, feedback, the product bundle, and the storage layout.
tags: [spec, data-model, schema, revisions, story, mockups, export]
generated: {by: agent:claude, at: 2026-10-17}
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
| `id` (named per type, e.g. `record_id`, `outcome_id`; `id` for assumptions) | ULID, immutable. Story pages are the exception: their `page_id` is a slug the author chooses (§4.11). |
| `product_id` | Immutable except when a source moves ([§3.7](03-accounts-teams-and-identity.md)). `tenant_id` is on every content row and never appears in a request body: it comes from the addressed product. |
| `etag` | Opaque string; changes on every successful mutation. |
| `created_at`, `created_by` | Timestamp and actor snapshot ([§3.9](03-accounts-teams-and-identity.md)). Sources say `uploaded_at`, `uploaded_by`. |
| `updated_at`, `updated_by` | Same, for the latest mutation. |
| `archived_at` | Where the type supports archive (sources, annotations, outcomes, assumptions, Story pages, mockups). Archived objects are excluded from lists and search unless asked for, and remain readable by id. |

**Concurrency.** Every update, review, link, single-object archive and restore, and every Story
publish after a page's first version requires the current etag (`expected_etag` in the input, or
`If-Match` in REST). Missing → `422`. Stale → `409 stale_etag`, with the current etag in
`details.current_etag` so a caller can re-read and retry deliberately. Creates take no etag;
neither do the batch `sources.archive` / `sources.restore`. A source's etag also changes when an
attachment is added (`complete_upload` returns the new one as `record_etag`). Reading an
attachment, which no caller does, does not change it, so an etag never goes stale while the worker
runs; nor do the source's summary, notes, comments and derived text, which are written apart from
it. The derived text has an etag of its own, which `derived.write_text` takes as an optional
`expected_etag` and which a reading that replaces the text changes
([§5.4](05-derived-layer.md)). Check-and-write is atomic: the row is locked (`SELECT … FOR UPDATE`)
in the same transaction.

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
| A source's derived text, summary and notes | — (none yet; the activity log names each write, and what each attachment was read as stays readable, [§5.4](05-derived-layer.md)) |
| Annotation | `note` |
| Assumption | `statement`, `body` (while still editable, §4.8) |
| Story page | — (it has explicit, numbered, reader-visible versions instead, §4.11) |

Outcomes have operations to read and restore revisions: `revisions` (list, bounded,
no bodies), `get_revision`, and `restore_revision` (writes the old content as a **new** update,
recorded like any other; it never rewinds history). Revisions of the other types are kept and
exported; operations to read them are planned.

◆ Decision: revisions are retained for the life of the object. Text is cheap, and the alternative
is explaining a retention rule to someone who just lost a paragraph to a well-meaning agent. They
are excluded from search and included in exports.

**Small edits and diffs.** `assumptions.update` and `derived.write_text` take `edits`: up to 20
exact replacements `{ field?, old_text, new_text }`, applied in order, so a one-phrase correction
does not mean re-sending a long body ([`text-edits.ts`](../../packages/core/src/text-edits.ts)).
`field` is `body` by default, or `statement`, for an assumption, and `text` for a derived text.
Each `old_text` must occur exactly once in its field at that point: no match is
`422 edit_not_found`, more than one is `422 edit_ambiguous` (with the count), and editing a field
the same call replaces whole is `422 invalid_input`. Any refusal changes nothing. The update
returns `changed` (the fields that changed; `write_text` leaves it out) and `diff`: per changed text field, one hunk
`{ field, at, before, removed, added, after }` from the first to the last difference, with 40
characters of unchanged context each side and the changed parts clipped at 300 characters, so a
slip in a re-sent text shows up in the result.

## 4.2 Outcomes

An outcome is what the product's users should be able to achieve with it. Outcomes sit under the
product concept ([§3.4](03-accounts-teams-and-identity.md)) on the Idea screen, and are the compass
the evidence, assumptions, mockups and Story are read against
([decision](../decisions/a-product-starts-with-an-idea-concept-and-outcomes.md)).

| Field | Rule |
|---|---|
| `outcome_id` | |
| `title` | 1–200 chars. What the users achieve. |
| `description` | Markdown, 0–2,000 chars. What success looks like for them. |
| `archived_at` | Null while the outcome is current. An outcome is current or archived; it has no other state. |
| `position` | Ordering key within the product. `create` takes one to place a new outcome (a value between two others' positions puts it between them); omitted, it goes last. Reorder is an update. |

Assumptions point *to* outcomes (`outcome_ids`); an outcome points at nothing. Its
title and description may not hold a record id: `create` and `update` refuse one with `422
outcome_cites_a_record`, naming the field and the id. Reads carry no count of what points at an
outcome; `assumptions.list` with `outcome_id` lists the assumptions that serve one.
`products.get` and `products.list` count only current (`unconfirmed` or `confirmed`) assumptions,
the ones `assumptions.list` returns without a status.

Product reads return `counts`, one number per kind (`sources`, `outcomes`, `assumptions`,
`mockups`, `story_pages`, archived items left out), and `stage_counts`, the total of every item each
stage holds, which the web app shows beside each stage
([decision](../decisions/each-stage-counts-every-item-it-holds.md)): `idea` is the outcomes (the
product concept is one field, not an item), `evidence` the sources, `exploration` the mockups plus
the current assumptions, and `story` the live Story pages, which are exactly the pages in the tree,
the unplaced ones and the Published mockups (§4.11).

`outcomes.archive` and `outcomes.restore` set and clear `archived_at`. `outcomes.list` leaves
archived outcomes out unless `include_archived`, and says how many it left out: `archived_hidden` (the count, honouring `query`) and, when it is not zero, a
`note`. An archived outcome can still be referenced. Assumptions (`outcome_ids`) return
`archived_outcome_ids`: the referenced outcomes that are archived, so a link to one is visible
rather than accidental.

## 4.3 Sources

A source is one discovery event or document. It is stored as a **record**, so its id is
`record_id`.

| Field | Rule |
|---|---|
| `record_id` | Never changes, whatever else does (including a move to another product). |
| `title` | 1–300 chars. Says what it is (who, what, when), never a file name. |
| `date` | `YYYY-MM-DD`: the date of the **event or document** the discovery question turns on, never the upload date. `null` when genuinely unknown. The web app calls it the **date captured**. |
| `slug` | Derived from the title. |
| `tags` | ≤ 50, each 1–50 chars: what the material is, whom it concerns, what it bears on (§4.4). Stored NFKC-normalized, spacing collapsed, lower-case, without repeats. |
| `copied_from` | `{ product_id, record_id }` when the source is a copy ([§3.7](03-accounts-teams-and-identity.md)). |
| `uploaded_by`, `uploaded_at` | Actor snapshot and time of creation: the **date added**. |
| `updated_by`, `updated_at` | Actor snapshot and time of the last change to the source's details, archive or restore: the **date updated**. Adding an attachment changes the etag but not this. |
| attachments | §4.5. `attachment_count` counts them. |
| derived text | The source's words, one Markdown document with an etag of its own, at most one per source ([§5.4](05-derived-layer.md)). `text_chars` is its length in code points, 0 without one. |
| `derived_status` | Where the derived text stands: `ready` (the source has one), `pending` (an attachment is arriving or being read), `awaiting_file` (no attachment), `awaiting_text` (an attachment has text the source does not use), or how its newest attachment was read: `needs_transcript`, `unsupported`, `too_large` or `failed` ([§5.5](05-derived-layer.md)). |

- **Correcting is a metadata change.** `sources.update` changes the title, date and tags in place
  (`tags` replaces the whole list). The `record_id`, the attachments and their versions, the
  readings, the derived text and the comments are untouched.
- **Archive** takes the source out of browse and out of search (including the search space an
  agent can reach). It erases nothing, and the source stays readable by id; `restore` puts it
  back. This is the default and the first action the UI offers.
- **Delete** ([§9.5](09-data-lifecycle.md)) destroys the source and every byte under it,
  permanently. Admins may do it, through either adapter (an agent on an Admin connection). It
  requires the current etag, a reason,
  and `confirm` set to exactly `delete permanently`, and it leaves a tombstone, so reads return
  `410 record_deleted` rather than a bare `404`. `sources.delete_impact` previews what it will
  destroy: its attachments' versions and their bytes, its readings and its comments; its derived
  text, summary and notes go with it.
- **List entries** (what `sources.list`, `create` and `update` return of a source): `record_id`, `title`, `date`,
  `tags`, `uploaded_by`, `uploaded_at`, `updated_at`, `updated_by`, `archived_at`,
  `derived_status`, `text_chars`, `attachment_count` and `etag`. `sources.list` adds `text_from`,
  the path of the attachment the derived text is still the text of, or `null`.
- **Read modes** (`detail`): `brief` (the list entry, with `text_from`, `duration_ms` (the longest
  recording or timed transcript among the attachments), `status_detail`, `annotation_count` and
  `warnings`) and `full` (adds `copied_from`, `pending_upload_path`, the `attachments` (§4.5), the
  derived text's `text: { chars, etag, updated_at, updated_by, taken_from }` or `null`, the
  comments, and which of its summary and notes exist). Neither includes file bytes or the text
  itself. `warnings` says when an attachment has text the source does not use, so search finds the
  source only by its title, tags, summary, notes and comments.
- **Duplicates are warned about, not refused.** `sources.create` and `attachments.create_upload`
  return a warning naming any live source in the product with the same title (ignoring case and
  surrounding space) and date.

## 4.4 Tags

A source is described by its title, its date and its **tags**. There is no list of kinds, no
folder and no organization field
([decision](../decisions/sources-are-described-by-tags.md)).

- A tag says what the material is (`interview`, `workshop`, `deck`, `analysis`), whom it concerns
  (an organization, a segment) or what it bears on. Tags are free text and describe discovery
  work, never a built-in classification. Derived material is tagged `view`, `analysis` or `digest`
  (§4.9).
- `sources.facets` lists what sources can be filtered by: `tags`, the tags in use with the number
  of sources carrying each, most used first and then A to Z (at most 500; `tags_truncated` says the
  list stopped), and `added_by`, each person who added sources (`account_id`, `display_name` as
  they were named when they last added one, and a count). It counts live sources, and archived
  ones too with `include_archived`. Agents read it before tagging and reuse the team's tags; the
  web app offers the most used tags wherever tags are written.
- `sources.list` filters by `tags` (a source must carry all of them), `added_by` (an `account_id`;
  what an agent added counts as its person's, since the actor snapshot names the person),
  `added_since` (a date, read as UTC midnight, or a time), `date_from` and `date_to` (the source's
  own date), and `query`, a substring of the title, tags or attachment names. `search` filters
  sources by tags and dates ([§8.1](08-search.md)).
- A call to a `sources`, `attachments` or `search` operation that names `kind`, `organization` or
  `folder` is refused with `422 invalid_input`; the message adds that sources are described by
  tags, and to reuse those `sources.facets` lists.

Migration `0017_sources_are_tagged.sql` turned what a source held into tags in front of its own,
without repeats, keeping at most 50: its kind (`interview_transcript`, `interview_recording` and
`interviewer_notes` → `interview`; `sales_call_recording` and `sales_call_transcript` → `sales`;
`user_research_export` → `research`; `usability_session_notes` → `usability`; `wiki_export` →
`wiki`; `contract_sow` → `contract`; `design_insight` → `design`; `prd`, `deck`, `rfp`,
`analysis`, `digest` and `view` as they are; `other` adds none), then its organization, normalized
as every tag is. It rewrote saved sandbox baselines the same way
([§9.7](09-data-lifecycle.md)), then dropped the `kind`, `organization` and `folder` columns.

## 4.5 Attachments

A source's files are its **attachments**
([decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
The database keeps the tables' names, `files` and `file_versions`; everything people and agents see
says attachments. `sources.get` with `detail: "full"`, `complete_upload` and the upload relay give
each attachment as:

| Field | Rule |
|---|---|
| `path` | Source-relative file name, unique within the source, ≤ 200 chars, no `/` traversal. |
| `media_type`, `size`, `sha256` | Of its current version, taken from the stored object, never from caller claims. |
| `file_version_id`, `versions` | Its current version, and every version, newest first, each `{ file_version_id, size, media_type, created_at, created_by }`. Uploading to an existing `path` adds a version; earlier versions stay retrievable. |
| `added_at`, `added_by` | |
| `text` | How its current version was read: `{ status, status_detail, chars, duration_ms, parser, derivation_id, read_at }`. `status` is `pending` until it has been read, then the reading's: `ready`, `needs_transcript`, `unsupported`, `too_large` or `failed` ([§5.5](05-derived-layer.md)). |
| `is_text_source` | True while the source's derived text is still this attachment's text. |

- **Every version of every attachment is read** when it arrives, and what was read is kept with it
  and stays readable, but is **never searched** ([§5](05-derived-layer.md)). A source's derived
  text is taken from one of them and follows it until someone writes it (§4.3).
- **No role and no provenance.** Nothing makes one attachment primary, marks another as the
  material it was made from, or records what it was derived from; what an attachment was made from
  goes in the source's notes. A call to an `attachments` action that sends `role`,
  `derived_from`, `derivation_note` or `derived_by` is refused with `422 invalid_input` and a hint
  that attachments have none.
- A recording is stored and playable, never transcribed: its transcript is another attachment.

Default limits: **100 MB per attachment** (`WHATBUILD_FILE_MAX_BYTES`), 25 MiB through the
service's own relay, **50 attachments per source** (`409 too_many_attachments`), and 25 MiB read
of each (`WHATBUILD_PARSE_CAP_BYTES`; a larger one is stored, not read). A per-tenant stored-bytes
quota is planned ([§9.2](09-data-lifecycle.md)).
**No operation accepts base64 file content.** Upload flows: [§6.7](06-operations-and-adapters.md).

## 4.6 Comments, the summary and notes

A **comment** (an `annotation` on the wire) is someone's remark on a source as a whole. It is not
anchored to any part of the source's text
([decision](../decisions/a-source-carries-a-summary-notes-and-whole-source-comments.md)).

| Field | Rule |
|---|---|
| `annotation_id`, `record_id` | |
| `note` | Markdown, 1–2,000 chars. |
| `tags` | As sources. |
| `archive_reason` | Optional, ≤ 500 chars: why the comment was archived. Given only with `archived: true`; restoring clears it. |

Editable (text only, keeping revisions), archivable. `sources.annotate` refuses a segment range
(`seq_start`, `seq_end`) with `422 invalid_input`, saying a comment is on the whole source.
Comments are searched with the rest of the source; an archived one is not
([§8](08-search.md)).

A source also has at most one **summary** and one set of **notes**, each Markdown up to 100,000
chars, written with `derived.write_note` (`note_kind` `summary` or `notes`; empty content removes
it) and read with `derived.read_note`. People write and edit both in the web app, and agents
through the same operations; each records who wrote it last and when. Both are searched.

- The **summary** heads the source's page and is written for people: a few short sentences saying
  what the source is and what it tells the team, without ids or codes.
- The **notes** are freeform: whatever is worth keeping about the source that is not its words,
  structured as the writer likes. Agents keep their working knowledge of a source there, and
  what an attachment was made from.

Both are someone's reading of the source; its words are its derived text
([§5.4](05-derived-layer.md)). There is no outline: migration
`0029_simplify_source_details.sql` deleted the agent outlines a product held, and dropped the
comments' segment ranges and anchors, keeping their text.

## 4.7 Evidence links

Writing may mention a source in prose by its id ("source 01K…"). The web app renders such a
mention in Markdown as an evidence link that reads as the source's title and opens the source
([`apps/web/src/lib/markdown.tsx`](../../apps/web/src/lib/markdown.tsx)). A source has no
passages to point at: a mention written while it had ("source 01K…, segments 4–6") opens the
source too, and its numbers are left out. A link is presentation
only. Nothing structural points from an assumption, a Story page, a mockup or another source to a
source, and nothing records what mentions what: what bears on a piece of work is found by
searching the product ([§8](08-search.md),
[decision](../decisions/evidence-is-searched-not-cited.md)).

### Retired: insights and decisions

A product once also held **insights** (Markdown synthesis, reviewed per revision) and a
**decision** register. Both are retired
([decision](../decisions/insights-and-decisions-are-retired-into-evidence.md)): no operation reads
or writes them. Each one a product still held becomes a source with the same id, by a worker job
([§9.8](09-data-lifecycle.md)):

| Was | Becomes |
|---|---|
| An insight | A source tagged `analysis` and `insight` (and `draft` for a draft), archived if it was. Its one attachment is Markdown, whose text becomes the source's derived text: the title, summary and body, then a note of its status, review mark, authors and what it referred to. Each earlier revision is an earlier version of the attachment; the summary is the source's summary note. |
| A decision | A source tagged `decision` and with the entry's tags. Its Markdown attachment holds the statement, the body (which holds the quotes it cited, §4.8), the status, the outcomes, the links in and out, and every review. Earlier revisions are earlier versions of the attachment. |

An assumption's link to a decision is dropped (the decision's document names it), and the item's
history in the activity log becomes the source's.

## 4.8 Assumptions

A product keeps one register: **assumptions**, what the team treats as true while the evidence is
incomplete. An entry's id is `id` (the tool also accepts `assumption_id`,
[§6.5](06-operations-and-adapters.md)).

| Field | Rule |
|---|---|
| `id` | |
| `statement` | 1–1,000 chars. The premise in one sentence. |
| `body` | Markdown, 0–10,000 chars: why the team holds it, what it rests on, and what would change if it turned out false. An entry may be recorded before any evidence exists. |
| `outcome_ids` | ≤ 20 outcome ids. |
| `links` | ≤ 50 of `{ id, type }` to other assumptions; `type` is `supports`, `contradicts`, or `supersedes`. Reads also return `linked_from` and `superseded_by` (the ids of entries that supersede this one, newest first). |
| `tags` | As sources. |
| `author`, `author_type` | Actor snapshot, and a declared `human` or `agent` ([§3.9](03-accounts-teams-and-identity.md)). |
| `status` | `unconfirmed` (initial), `confirmed`, `refuted`, `superseded`: always the status of the latest review. |
| `reviews` | Append-only, at most 500 per entry. |
| `frozen` | Derived: true once the entry has a review. |

List items carry the entry's state without a `get` per entry: `status`, `frozen`,
`superseded_by`, `link_count` (links out), `linked_from_count` (links in), `review_count`,
`human_review` and `archived_outcome_ids`. The list filters by one or more statuses; without
one it returns the current entries (unconfirmed and confirmed), so it agrees with the counts on
products and outcomes and with the register's default view, and says in `not_current_hidden` how
many refuted or superseded entries it left out.

An assumption names no source structurally: its body says, in words, what it rests on, and an
agent finds the evidence by searching
([decision](../decisions/evidence-is-searched-not-cited.md)).
Migration `0028_citations_refs_and_lineage_retired.sql` put the passages an entry had cited at the
end of its body, under **Passages cited**: one line each, `- “quote” (source title)`, the quote on
one line and cut to 500 characters, the title the source's, or its tombstone's once it was deleted,
or "a source no longer in WhatBuild". Those entries took a new etag; their status, reviews and
`updated_at` stayed as they were, and their kept revisions lost the citations they held.

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

- ◆ Decision: `statement` and `body` are editable only while the entry has no
  review. After the first review — any review, by a person or an agent, with any status, including
  one that leaves it `unconfirmed` — they are frozen (`409 frozen`); the `review` guidance says
  so: a correction is a **new entry**
  created with `supersede`, which links `supersedes` → the old entry and records a `superseded`
  review on the old entry in the same atomic operation. `tags`, `outcome_ids`, and `links` stay
  editable.
- Links are type-checked **before** any mutation: the target must exist in the same product, a
  self-link is rejected, a duplicate `{id, type}` is rejected, and `supersedes` must be acyclic.

## 4.9 Views

A **view** is a document built from other material and stored as a source tagged `view` (or
`analysis`, `digest`): something produced *from* other sources. It says in its own text what it was built from and when. WhatBuild keeps no record of a view's
inputs and does not report when they change; an agent builds a view again when the person wants it
current ([decision](../decisions/evidence-is-searched-not-cited.md)). A view is never presented
as direct evidence.

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
| `summary` | ≤ 280 chars, generated: "Marked confirmed with high confidence", "Read the text of call.vtt; it is the source’s derived text" (never the parser's name or version, which the reading's manifest holds), "Edited the derived text", "Added a comment". |

- **It never contains content.** No bodies, no source text, no HTML, no email addresses. The
  summary names objects; it does not quote them.
- `activity.list` filters by `entity_type`, `entity_id`, `actor`, `channel`, `by` (`people` for
  the app and the REST API, `agents` for MCP) and `since`, with the usual bounds. Every role on the
  product can read it.
- Events are immutable and are retained for the life of the tenant, with one exception: when an
  insight or a decision became a source (§4.7), its events were relabelled as the source's. They
  are included in a product export.
- An event about the organization's people and access (a role given, changed or removed, an
  invitation sent, accepted or cancelled, and the sandbox's invitation links, visitors and
  settings) is read by the organization's owners and admins with `members.activity`; a product's
  `activity.list` leaves out the ones that belong to no product.
- In a public sandbox an event about a product is content: a reset puts the baseline's back
  ([§9.7](09-data-lifecycle.md)). An event about the organization (people, access, the sandbox's
  settings, baselines and resets) has no product, and stays through every reset.
- Several people and several agents write into one product, and "what did that agent just do" is a
  question the product must be able to answer.

## 4.11 Story

**Pages.** `page_id` (a slug the author chooses, `[a-z0-9][a-z0-9-]*`, ≤ 80 chars, e.g.
`overview`), `title` (1–200), `summary` (≤ 2,000), `archived_at`, `current_version`, and an
append-only list of **versions**. The first publish creates the page and needs a `title`. The
page itself is given in one of three ways: `body` (only the markup inside `<body>`, which the
server wraps in a document carrying the product's Story style), `html` (a whole document), or
neither (a generated title page). A
version is immutable: `version` (1, 2, 3…), `title`, `summary` (describes the page), `html`,
`published_at`, `published_by`, and `html_sha256` (computed on read, so identical HTML can be
recognised without reading it). Readers see the latest version; any version
can be read by number. Limit: 50 pages per product (`409 quota_exceeded`). Agents write pages; agents
and people arrange, archive and restore them, and admins delete them
([decision](../decisions/agents-write-the-story-people-arrange-it.md)).
◆ Decision: a version has no change note. What changed is in the activity log, and an agent's
working context is in the page's notes. The `story_versions.note` column stays for versions
published before the note was removed, and is neither written nor returned; a product export
still includes it.

**Later versions.** Publishing a new version of an existing page requires the page's current etag.
It starts from a **base version**, the current one unless `from_version: N` names another, and
takes every field it omits (`title`, `summary`, `html`) from the base; the result lists them in
`carried_forward`, with `based_on_version`. `patch_html: [{find, replace}]` edits the base HTML instead of replacing it: each `find`
must occur exactly once when its turn comes, or nothing is published (`422 invalid_patch` listing
every failed edit). `body` replaces the page's content and takes the product's current stylesheet.
`restyle: true` keeps the page and replaces its first `<style>` block with the product's current
stylesheet, for use on each page after the Story style changes; it is refused on a page with no
`<style>` block (`422`) and in a product with no Story style (`409 no_story_style`). `html`, `body`,
`patch_html` and `restyle` exclude one another (`422`). A `body` that holds a doctype, `<html>`,
`<head>` or `<body>` is refused (`422`). A generated title page follows a new title or summary. `from_version` alone
restores the base as a new version, and the activity log records "Published version N from
version M". An unknown `from_version` is `404`.
◆ Decision: a later version carries forward what it omits, so changing a sentence or reverting a
page never means re-sending the whole page.
◆ Decision: an agent publishes a page's body and the server adds the stylesheet. A stylesheet sent
with every page costs an agent its length each time and lets pages drift apart; one the server
adds is the same on every page and changes in one place. `html` stays for a document that is not
in the product's style.

**A page from a mockup.** A version may show one page of a mockup version instead of HTML of its
own ([§4.12](#412-mockups)): `story.promote_mockup { mockup_id, mockup_page_id, version?, page_id?,
title?, summary?, expected_etag? }` publishes it, on a new page or, with an existing page's
`page_id` and its etag, as that page's next version. A new page takes the `page_id` given when no
page has it yet, and otherwise the mockup page's slug, with `-2`, `-3`… when that is taken; it is
titled with the mockup page's title unless `title` is given. `version` is the mockup version, the current one by
default. The version stores `mockup` (`mockup_id`, `mockup_version_id`, `version`, `page_id`) and
no HTML: mockup versions are immutable, so the page is read from the mockup when it is shown and is
never copied. It stays on that mockup version until
it is promoted again; reading it returns `mockup` with the page's `width` and `height` and, for
every role but a reader, the mockup's title, the version shown and the mockup's current version.
The page appears among the Story's Published mockups (Hierarchy, below).
`html`, `html_chars` and `html_sha256` describe the mockup page, which keeps the mockup's HTML
rules (§4.12) and sandbox on the Story: it may hold scripts of any length and a form, whose
submission goes nowhere. A later `publish` without `html` or
`body` keeps showing the mockup page; `html` or `body` replaces it with HTML of the page's own; and
`patch_html` and `restyle` are refused (`422`), since there is no HTML of its own to change.
◆ Decision: a promoted page stays on its mockup version. A Story is read outside the team, and work
in progress on a mockup should not appear in it unannounced.

**HTML rules**, validated at publish (`422 invalid_html` listing every problem at once, each
naming the Story page, the rule, the limit and the element; `STORY_PAGE_RULES` in
[`html-rules.ts`](../../packages/core/src/html-rules.ts), where a mockup page's rules sit beside
them, §4.12):

- One self-contained document, ≤ 1,000,000 chars; inline CSS; at most 10 inline scripts, and
  inline scripts and event handlers together ≤ 32,000 chars, since the Story is for reading.
- No external references of any kind: `src`, `srcset`, `poster` and similar attributes, style
  `url()` and CSS must use `data:` URIs, quoted or not (a stylesheet may also name a fragment,
  `url(#id)`); no `@import`; `<script src>` is refused. Ordinary `<a href>` links are allowed.
- No `<iframe>`, `<frame>`, `<frameset>`, `<object>`, `<embed>`, `<portal>`, `<form>`, `<link>`,
  `<base>`, or `<meta http-equiv>`.

**Rendering.** A version's HTML is served by its own REST route with a sandboxing
Content-Security-Policy (`sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox;
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src
data:; media-src data:; connect-src 'none'; …`), and the web app shows it in an
`<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox">`, never
`allow-same-origin` (a mockup page's sandbox adds `allow-forms`, §4.12; both are constants in
[`page-sandbox.ts`](../../packages/core/src/page-sandbox.ts)). The page therefore runs in an
opaque origin, can make no network request, submits no form anywhere (`form-action 'none'`), and
reaches nothing of the application. Validation is a courtesy to authors; the sandbox is the
security boundary. This matters because the author of a Story page and its reader are routinely
different people.
The route takes `?theme=light|dark` (written onto the page's `<html>` as `data-wb-theme` for that
response) and `?frame=1`, which the app's frame always sends: it appends one inline script, inside
the sandbox, that posts only the name of an F, Esc, ← or → key press to the parent (focus mode,
and flipping through the Published mockups, [§7.8](07-web-app.md)), unless the page handled the
key itself, hands a link to another page of the same Story to the app, and turns a
click on any other link that would replace the page in its frame into a new tab. For the second,
the app tells the frame the address its Story's pages live under once the frame has loaded; on a
plain click (no modifier key, the main button) on a link under that address the script stops the
click and posts only the page's slug, which the app checks against the slug pattern before it
shows that page in place. The app also tells the frame its product's own address, and a click on
a link into that product written with another deployment's address (an agent writes the address it
was given, and a copy of a deployment keeps it) is pointed at this deployment before it goes
anywhere, so the dev deployment and a local copy of production never send a reader to production,
and a link written with a name this deployment answered on before (its default host, an earlier
domain) opens here even once that name is gone. A link with an old name to anywhere else in the
deployment is left as written; while the name still reaches the deployment, the page it opens
moves to the public URL ([§2.3](02-architecture.md#23-the-shape-of-the-deployment)).
The stored HTML is never changed. The app resets a frame that loads a second document (a
page navigating itself by script) and says so, and the app's own pages send
`Cross-Origin-Opener-Policy: same-origin`, so a Story page cannot keep a handle to an app tab it
opened and redirect it later. The print view drops scripts, event handlers and every element a
Story page may not hold, forms included, whatever a stored page holds (a mockup page it shows
too).

**Preview.** `story.preview` takes exactly what `story.publish` takes and runs the same code up to
the point of writing ([`ops/story.ts`](../../packages/core/src/ops/story.ts), `draftVersion`):
every check, in the same order, with the same errors (a list of problems says "The page would not
be published"), and the same document. It writes no version, page or activity. It stores the
document publish would store (or, for a version that keeps showing a mockup page, that page) in
`story_previews`, and returns its `html_sha256` with a download grant to GET it
(`GET /api/v1/downloads/story-preview/{preview_id}`, [§6.4](06-operations-and-adapters.md)),
served exactly as a version's HTML is: the same sandbox headers, the carried typefaces embedded,
and `?theme=light|dark`. Publishing the same call then stores a version whose `html_sha256` is the
preview's, unless the page or the Story style changed in between. A preview lasts as long as its
grant (30 minutes by default) and a product keeps its 20 newest; it is refused where publish would
be (a viewer, an archived product, a public sandbox not taking visitors' writes) and is never a
write in a sandbox's allowances ([§9.7](09-data-lifecycle.md),
[decision](../decisions/a-story-preview-is-the-document-publish-would-store.md)).

**Notes for agents.** Each page has one Markdown note, `agent_notes` (≤ 20,000 chars), that agents
keep while writing and maintaining the page: what the page is for and who reads it, sources still
to fold in, choices about its structure. It is not versioned with the HTML and is not shown on
the page. It has its own etag (`agent_notes.etag`), so editing the note and publishing the page
never conflict. `story.write_notes { page_id, notes, expected_etag? }` replaces it and records
`agent_notes_updated_at` and `agent_notes_updated_by`; `expected_etag` may be omitted only while
the notes are empty, and passing the page etag instead is refused with a message that says so.
`story.get_page` returns the notes as `agent_notes { content, etag, updated_at, updated_by }`, and
`story.publish` returns their etag as `agent_notes_etag`.

**Print view.** `story.print_view` composes 1–50 chosen pages, each at its current version, into
one HTML document for a browser to print to PDF ([§6.4](06-operations-and-adapters.md)).

**Hierarchy.** A separate per-product object with its own etag, in two parts:

- **The tree** (`items`): an ordered tree of `page_id`s, depth ≤ 6, each page at most once, every
  page live and published, none showing a mockup page. Publishing a page never places it; placing
  a page never publishes it. Pages not yet placed are listed in `unplaced`, never in `items`, and
  readers see them at the end of the tree until an agent adds them to it. A stored node whose page is archived, missing or showing a mockup page is skipped and
  its children promoted into its place; archiving a page takes it out of the stored tree, and a
  restored page returns unplaced.
- **The Published mockups** (`mockups`): every live page whose current version shows a mockup
  page, flat, in the order agents set (`set_hierarchy { mockups }`, a list of page ids that
  replaces the order; omitted, the order is kept), then any not listed, in the order their current
  versions were published. A promoted page joins the end at once, and leaves when `html` or `body`
  replaces the mockup page, returning to its place in the tree if it has one. Archiving takes a
  page out of the order. `set_hierarchy` refuses a page showing a mockup page in the tree, and any
  other page in `mockups` (`422 invalid_hierarchy`).

`set_hierarchy` takes the hierarchy's etag as `expected_etag`. Before the first save there is none
(`get_hierarchy` gives `etag: null`), and `expected_etag` is null or left out; once saved, leaving
it out is `409 stale_etag`, saying to read `get_hierarchy` and pass its etag.

Every published page appears exactly once, in the tree or among the Published mockups
([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)).

**Story style.** A product has at most one: the design system every Story page follows, either the
company's own or a **house style** adopted for the product
([decision](../decisions/story-pages-follow-the-teams-design-system.md)). Fields: `name` (1–80),
`summary` (≤ 300), `based_on` (a house style id, or null for the team's own), `rules` (Markdown,
≤ 20,000), `stylesheet` (≤ 200,000 chars, the same rules as a page's `<style>`: no `@import`, `url()`
only to `data:`), an optional `specimen_html` (a page in the style, validated like a Story page),
`etag`, `updated_at`, `updated_by`. `story.get_style` returns it (or null) with the house style
catalogue; `story.set_style` replaces it. `house_style` adopts a house style whole, other fields
adapt it; without `house_style`, omitted fields carry forward, and the first style needs `name`,
`rules` and `stylesheet`. `expected_etag` is required once a style exists. `422 invalid_style`
lists every problem. Setting a style changes no published page. The app previews a style on its
`specimen_html`, or on a sample page in its stylesheet; each house style has a sample page too
(`GET …/story/style/specimen`, `GET …/story/house-styles/{id}/specimen`, both served like a Story
version, `?theme=` and `?frame=1` included). A product export holds it as `story/style.json` and
`story/style.css`.

**House styles** (one per file in [`house-styles/`](../../packages/core/src/house-styles/), listed
by [`story-styles.ts`](../../packages/core/src/story-styles.ts)), in the catalogue's order, from
the quietest to the loudest: **Clear** (public-service clarity: big bold type, a step-by-step
plan, tags and summary lists, a yellow focus), **Large** (big type for a large screen or a
meeting, monochrome), **Report** (an executive status report: navy and amber, statuses as filled,
half and empty circles), **Tonal** (one sea-green hue at every surface step, large rounded
containers, pill statuses), **Wide** (extended headings over a normal body, signal orange),
**Pastel** (pale colour tiles under dark type), **Wayfinding** (bold signs: a plan as a route with
stops), **Isotype** (pictorial statistics: counts as rows of figures), **Blocks** (neo-brutalist
blocks with hard shadows, every one square to the page) and **Riso** (two inks, grain and
misregistration). Each carries a light and a dark scheme, names its faces once as custom
properties, in typefaces the server carries, and styles one shared semantic vocabulary
(`.page`, `.opening` with an optional `.kicker`, `.lead` and `.meta`, sections, `.quote`, `.note`, `.callout`, `.status`, `.figures`,
`.columns`, `.table-wrap`, `.steps`, `details`; for plans and front pages `section.wide`,
`h2[data-label]`, `ol.timeline` with `data-state="done"` and `aria-current="step"`, `ul.lines`
with `.tag`, `dl.facts` and `nav.pages`; and for evidence and what changes `div.quotes`, `mark`,
`span.tally`, `ol.flow`, `figure.diagram` with SVG classes `node`, `edge`, `head` and `label`, and
`figure.shot` with `.screen`, `.pin` and `ol.pins`), so content moves between styles unchanged;
`BASE` in `house-styles/kit.ts` gives every style the vocabulary's structure, and each adds
signature moves of its own. They also set what a browser draws for itself: the selection, the
scrollbar, the focus ring, and where a printed page may break. A product that adopted a house
style since removed keeps its copy: it reads as a house style with its `based_on` id and no
`based_on_name`, and an agent can still change or replace it.

**Carried typefaces** ([`story-fonts.ts`](../../packages/core/src/story-fonts.ts),
[decision](../decisions/story-pages-name-typefaces-the-server-carries.md)): Archivo (with its
width axis, 62% to 125%), Bricolage Grotesque, Figtree, Gabarito, Jost, Libre Franklin, Onest,
Public Sans, Red Hat Display, Red Hat Text and Signika, the faces the house styles use, each the
Latin subset of its variable font under the SIL Open Font License. A page or stylesheet that
names one in quotes in `font-family` gets an `@font-face` for it, as a data URI, when the server shows the page or a
specimen, and once for the whole print view; stored pages and what agents read never hold font
data, and mockup pages get none. `story.guidance` lists them as `carried_typefaces`.

**Guidance.** `story.guidance { section?, house_style? }` returns versioned authoring guidance
([`story-guidance.ts`](../../packages/core/src/story-guidance.ts)): how to settle the Story style
with the person, the house style catalogue and the shared vocabulary, taste principles,
anti-patterns, compositions (a narrative, a decision, a front page, a plan, a scope and others), recipes for every block of the vocabulary, the carried typefaces, named design passes (critique, distill, bolder, quieter, typeset,
layout, adapt, polish), a push to use a design skill such as Impeccable when the agent has one and
to mention it once when it does not, the sandbox rules, recipes, writing rules and a checklist.
It carries no stylesheet of its own and nothing of the app's look; `house_style` returns that
style in full with a starter page, and `product_style` says whether the product has a style yet.
The writing guidance asks for pages that explain in their own words and quote a person only where
their exact words matter, attributed in words, with no source reference or link to the evidence
after each claim ([decision](../decisions/evidence-is-searched-not-cited.md)); source-level quoting rules
honoured (attribution by role where a source limits naming people, looked for before the first
page), derived views labelled as analysis rather than evidence, a plan's dates presented as the
team's plan with their origin kept in the page's notes, and pages placed in the hierarchy unless
the author's instructions say otherwise. A first version that
omits both `body` and `html` gets a generated title page in the product's Story style, or a plain
page when there is none.

## 4.12 Mockups

A mockup is a canvas of HTML pages an agent built from the evidence (screens, flows, alternatives
side by side), each with design notes, and a brief that says what the canvas explores
([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)). Fields:
`mockup_id`, `title` (1–200), `summary` (≤ 2,000, shown in the list), `archived_at`,
`current_version`, `etag`, and an append-only list of **versions**. A version is immutable and is
the whole canvas: `version` (1, 2, 3…), `title`, `summary`, `brief` (Markdown, ≤ 50,000: what the
canvas explores, for whom, the questions it should answer, what each page tries), `columns` (1–12
pages side by side before the canvas wraps, or null for one row), the `pages` in order, the
`files` it carries, its `prototype` if it carries one, `published_at` and `published_by`. A
page:
`page_id` (a slug, `[a-z0-9][a-z0-9-]*`, ≤ 80 chars), `title` (1–200), `notes` (Markdown,
≤ 10,000, the page's design notes), `width` (240–2,560 CSS pixels, default 1,280; 390 for a
phone) and `height` (240–4,000, default 800), and either its HTML, returned only with
`include_html` (otherwise `html_chars`), with `html_sha256` and `html_path` (the page's HTML
route) computed on read, or an `entry` into the version's prototype, with its `poster` and its
frame's address, `prototype_url`, computed on read (Prototype, below). Limits: 48 pages and
8,000,000 characters of HTML in a version; 50 mockups in a product,
archived ones included (`409 quota_exceeded`, whose details give `used`, `limit` and how many are
`archived`).

**Characters and hashes.** Every count of characters here, a limit, `html_chars` or a file's
`chars`, is a JavaScript string's length: UTF-16 code units, so a character outside the Basic
Multilingual Plane, such as an emoji, counts two, and bytes are never counted. `html_sha256` and a
file's `sha256` are the SHA-256 of the text encoded as UTF-8 (`sha256Hex`), so they equal a hash
of a UTF-8 file's bytes; a page or file read from an uploaded ZIP has lost a leading byte-order
mark, so its hash is of the bytes after it.

**Files.** A version carries text files for collaborators to pull into their own projects: a
DESIGN.md, components, tokens. A file is a `path` (relative, ≤ 200 chars, folders separated by
`/`, each part of letters, digits, `.`, `-` and `_`, never `.` or `..`, at most five folders
deep) and its `content` (text). Reads list `path`, `chars` and `sha256`, sorted by path in byte
order, and add `content` with `include_files`; `mockups.list_versions` gives each version's
`file_count`. WhatBuild never draws a page with a file, and the app shows one only as text.
Limits: 50 files and 2,000,000 characters of files in a version; two paths that differ only in
case are refused, since they would overwrite each other when unzipped.

**Publishing.** `mockups.publish` without `mockup_id` creates a mockup with its first version: a
`title` and at least one page with a `title` and `html` (or an `entry`, from an upload that brings
a prototype). With `mockup_id` it publishes the next
version and needs the mockup's etag (`409 stale_etag`); an archived mockup refuses it
(`409 mockup_archived`). A version starts from a base, the current one unless `from_version: N`
names another, and takes every field it omits (`title`, `summary`, `brief`, `columns`) from the
base. `pages`, when passed, is the whole canvas in order: a page left out is
dropped from the version, and a page whose `page_id` was on the base keeps its title, notes, size
and HTML unless they are sent, so a version that changes one page sends only that page's HTML.
`files`, when passed, is the whole set in the same way: a path on the base keeps its content
unless it is sent, a path left out is dropped, `[]` drops them all, and omitting `files` keeps
them. A page that sends `html` becomes a page of its own and one that sends `entry` an entry, and
one that sends neither keeps the base's; sending both is refused. A new page needs a title and HTML
or an entry, and a new file its content (`422 invalid_input`, listing every problem). HTML that is sent is checked at publish against a mockup page's rules
(`422 invalid_html`, listing every problem at once, each naming the page, the rule, the limit and
the element); carried HTML was checked when it was first published. A refused publish changes
nothing and leaves an upload unused, so publishing is a safe way to check a canvas.

**HTML rules** for a mockup page (`MOCKUP_PAGE_RULES` in
[`html-rules.ts`](../../packages/core/src/html-rules.ts),
[decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)), which a canvas of
working prototypes needs and a Story page does not have (§4.11):

- One self-contained document, ≤ 1,000,000 chars; inline CSS; inline scripts and event handlers
  of any number and length.
- Forms and their controls work as far as their `submit` handlers, and a submission goes
  nowhere: a mockup page's sandbox allows forms, and its policy says `form-action 'none'`
  (Rendering, below). A prototype handles `submit` and calls `preventDefault()`.
- No external references, as on a Story page: `src`, `srcset`, `poster` and similar attributes,
  style `url()` and CSS use `data:` URIs (a stylesheet may also name a fragment); no `@import`;
  no `<script src>`.
- No `<iframe>`, `<frame>`, `<frameset>`, `<object>`, `<embed>`, `<portal>`, `<link>`, `<base>`,
  or `<meta http-equiv>`.

A visitor to a public sandbox has the same rules, and the sandbox's cap on what one field holds
([§3.10](03-accounts-teams-and-identity.md)). Every refusal names the mockup page, never the Story.
◆ Decision: a version is the whole canvas, not one page. The pages of a canvas are read and
compared together, so they are published, numbered and downloaded together.

**Uploading a canvas.** An agent can send a canvas as a ZIP instead of putting its pages' HTML in
the call. `mockups.request_upload { size? }` returns a grant, `{ upload_id, method: "PUT", url,
headers, max_bytes, expires_at, next }`, for one PUT of the ZIP to the upload relay (§6.7); a
`size` over `max_bytes` is refused at once (`413 too_large`). `max_bytes` is 25 MB, or the relay's
limit when that is lower. A visitor to a public sandbox is refused (`403`): a visitor's text is
capped field by field, so a visitor publishes pages in the call. `mockups.publish { upload_id }`
then reads the ZIP, in `get_download`'s layout, so a downloaded version round-trips:

- `manifest.json` lists the canvas's pages in order, `[{ page_id, title?, width?, height?,
  entry?, poster? }]`, and may give `title`, `summary`, `columns`, `files` (`[{ path }]`) and
  `prototype` (`[{ path, sha256? }]`). Its other fields are not read.
- `brief.md` is the brief; `pages/<page_id>.html` and `pages/<page_id>.notes.md` hold a page's
  HTML and notes; `files/<path>` holds a file; `prototype/<path>` holds a file of the prototype,
  any bytes, never decoded.
- One folder around everything is allowed, and the litter of ZIP tools (`__MACOSX/`, `.DS_Store`,
  folder entries) is ignored. Anything else, a page file for a page the manifest does not list, a
  file that is not UTF-8 outside `prototype/`, an empty or oversized page, a name used twice or a
  symbolic link is refused, with every problem listed at once (`422 invalid_upload`). The ZIP is
  at most 96 MB unpacked and 2,148 entries, and is read without unpacking more than that.

A page whose HTML or notes the ZIP leaves out keeps the base version's, so a ZIP may carry only the
pages that changed, with every page still listed. When `manifest.json` lists `files`, that list is
the whole set and a listed path missing from `files/` keeps the base's content; without a list,
the files under `files/` are the whole set; with neither, the version keeps the base's files. The
call may not also send `pages` or `files` (`422 invalid_input`), nor a `brief` when the ZIP has
`brief.md`; a `title`, `summary` or `columns` in the call wins over the manifest's. Everything
else (`mockup_id`, `expected_etag`, `from_version`) is passed as usual, and the
pages' HTML is checked as if it had been sent.

The ZIP is read before the transaction, so a large one holds no database connection. An upload is
published once: publish marks it used, and a second publish of it is `409 upload_used`; one whose
bytes have not arrived is `404`. After publishing, its bytes are deleted and the result names
`from_upload` and gives `upload { upload_id, size, sha256 }`, the ZIP's own size in bytes and
SHA-256 as its PUT answered them. A refused publish leaves the upload unused, to publish once the
call is right; its bytes cannot be replaced, so a changed page needs a new upload. The grant's state is a `mockup_uploads` row (who asked, the product, the expiry,
when the bytes arrived, their size and SHA-256, when publish used them and for which version);
how long it is kept is in §9.2.

**Prototype** ([decision](../decisions/mockups-carry-prototypes-served-from-a-capability-path.md),
[`prototype.ts`](../../packages/core/src/prototype.ts)). A version may carry a team's multi-file
prototype as it is, uploaded under `prototype/` and never sent in a call; a page whose `entry`
names one of its HTML documents (`index.html`, `app/checkout.html?plan=pro#step-2`) opens it.

- **Files.** Each is a row of `mockup_prototype_files`: `path` (relative, `/` between folders, in
  Unicode NFC, ≤ 400 chars and 16 folders deep, no empty, `.` or `..` part, none of
  `\ : * ? " < > | #` or a control character, no part ending in a space or a dot; two paths equal
  once case is set aside are refused), `size`, `sha256` of the bytes, `media_type` and `blob_key`.
  The type comes from the name, once, from an allowlist (HTML, CSS, JavaScript, JSON and source
  maps, a web manifest, SVG, PNG, JPEG, GIF, WebP, AVIF, ICO, BMP, WOFF, WOFF2, TTF, OTF, MP4, WebM,
  Ogg, MP3, WAV, M4A, WebVTT, PDF; text, CSV, Markdown, XML, XHTML and XSLT as `text/plain`), with
  `charset=utf-8` only on text that is valid UTF-8; anything else is `application/octet-stream`.
  Limits: 2,000 files and 64 MB in a prototype, 25 MB a file (`422 invalid_upload`); 500 MB of
  distinct prototype bytes in a product, a blob two versions share counted once
  (`409 quota_exceeded`, quota `prototype_bytes`).
- **Versions.** A `prototype` list in the manifest is the whole set, a listed path missing from
  `prototype/` keeping the base's bytes (its `sha256`, if given, must match); without a list, the
  files under `prototype/` are the whole set; with neither, the base's prototype carries forward,
  as it does for a version published without an upload; `"prototype": []` drops it. A file whose
  hash the base holds takes the base's blob, so new bytes are stored once per mockup; they are kept
  at `t/<tenant>/p/<product>/mockup-prototypes/<upload_id>/<sha256>`, never under their path.
- **Entries and posters.** An entry must name an HTML file of the version's prototype, and a
  version without one refuses entries; `poster`, an image of the prototype (PNG, JPEG, GIF, WebP or
  AVIF, ≤ 2 MB), is what the Story's print view shows for the page (`422 invalid_input`).
- **Warnings.** Publish's result gives `prototype_warnings` for a newly uploaded prototype, each
  naming its file: a root-relative or remote address in HTML or CSS, a relative one the prototype
  does not hold, and a script (a file, inline, or an event handler) that uses `localStorage`,
  `sessionStorage`, IndexedDB or `document.cookie`, which are unavailable and throw. A warning
  never refuses.
- **Stateless.** A prototype's documents run in an opaque origin, which has no browser storage and
  no cookies; WhatBuild injects no stand-in, so each document load starts fresh. State lives in
  script variables while a document is open, or in the address (query or hash) across documents.
- **Reads.** A version's `prototype` gives `file_count`, `bytes`, `base_url` (the prototype's
  address, a capability), `expires_at`, the `sandbox` its frames take, and with `include_files`
  each file's `path`, `size`, `sha256` and `media_type`; an entry page's `prototype_url` is
  `base_url` and its entry, the path percent-encoded.

**Serving a prototype.** One route serves every prototype file,
`GET`/`HEAD /prototypes/{grant}/{path}` ([`prototype.ts`](../../apps/server/src/prototype.ts)). The
grant is HMAC-signed with purpose `prototype`, the tenant and one version, and no account; it
lasts `WHATBUILD_PROTOTYPE_GRANT_HOURS` (8), its expiry rounded up to the hour. The route reads no
cookie or Authorization header, sets no cookie and never redirects; it decodes the path part by
part (an encoded `/`, `\`, NUL or dot part, or malformed encoding, is `404`), serves `index.html`
for an empty path or one ending in `/`, and looks the path up as a row of that version (`404`
otherwise, at once after a delete). Other methods are `405`; a bad or expired grant `401`; a
`Service-Worker` request `403`; and on the app's origin a request with `Sec-Fetch-Dest: document`
`403`, since a prototype's document is shown only in a frame there. `Range` gives `206` for media.
Every response, a refusal's too, carries the prototype's policy: a CSP `sandbox` of a mockup
page's (plus `allow-modals` on a content site), sources limited to the prototype's own address for
scripts (`'unsafe-inline' 'unsafe-eval'`), styles, images, fonts, media, `connect-src`, frames and
`base-uri`, `worker-src`, `manifest-src` and `object-src` `'none'`, `form-action 'none'` and no
`frame-ancestors`; `nosniff`, `no-referrer`, `private, no-store`, CORP `cross-origin`, COEP
`credentialless`, `Access-Control-Allow-Origin: *` without credentials, and the Permissions-Policy.
An unknown type is served as an attachment. An HTML document gets the frame script after its
stored bytes, with the prototype's address, so its links within the prototype stay in its frame.
With `WHATBUILD_CONTENT_URL` set, the route answers on that host only, the content site answers
nothing else, and the app's `frame-src` names it.

**Rendering.** A page's HTML is served by `GET …/mockups/{mockup_id}/versions/{n}/pages/{page_id}/html`
with the Story's sandbox and one addition, `allow-forms`, in the Content-Security-Policy and in
the app's frame alike, and with the same frame script with `?frame=1` (§4.11). The Story's own
HTML route serves a page that shows a mockup page in the same mockup sandbox. It takes no `?theme`, because a mockup carries its own look. Any role but
a reader may read it. A page's frame is its `width` × `height`; content taller than `height`
scrolls inside the frame, on the canvas in interact mode and on the Story ([§7.7](07-web-app.md),
[§7.8](07-web-app.md)). A long document can be one page that scrolls or several pages side by
side; the choice is how people will read it.

**Download.** `mockups.get_download { mockup_id, version? }` returns a short-lived grant for
`GET /api/v1/downloads/mockup/{version_id}` with the `X-WhatBuild-Download-Grant` header. The ZIP
holds `brief.md`, `manifest.json` (format `whatbuild-mockup`, format version 2: the mockup, the
version, `columns`, who published it and when, the pages in order with their titles, sizes and
`html_sha256` and file names or `entry` and `poster`, the files, and the prototype's files with
their size, SHA-256 and type), `pages/<page_id>.html` (for a page with HTML
of its own) with `pages/<page_id>.notes.md`, each file under `files/` at its path, and each
prototype file under `prototype/`, byte for byte, so an agent can build the next version in a
project of its own and publish what changed; the ZIP uploads again as it is.

**Archive.** `mockups.archive` and `mockups.restore` take the etag. An archived mockup leaves the
list unless `include_archived`, and every version stays readable. `mockups.list` says how many
archived mockups it left out (`archived_hidden`, and a `note` when there are any), and always
gives `quota { used, limit, unit, archived_included }`: the product's mockups against its 50,
archived ones counted, so an agent sees the limit before a publish meets it. `products.get`'s
counts stay the live mockups the stage shows.

**On the Story.** A page of a mockup version can be promoted to the Story (§4.11).
`mockups.get` returns `story_pages`: each Story page whose current version shows one of the
mockup's pages, with the mockup page and version it shows and the Story page's etag. The Story
serves a promoted page through its own HTML route, so a Story reader sees that page and nothing
else of the mockup; a promoted page of an archived mockup stays readable. A promoted entry's
version gives, in its `mockup`, the `entry`, its `prototype_url`, `prototype_sandbox` and
`prototype_expires_at`, to a reader too, whose address reaches that version's whole prototype and
nothing else of the mockup ([decision](../decisions/a-reader-reads-only-the-story.md)); its HTML,
where HTML is needed, is a notice, with the poster in the print view.

## 4.13 Feedback

`submit_feedback { category, message, tool?, details?, screen?, reply? }`: `category` is `issue`
(a bug), `confusion`, `improvement`, `feature_request` or `other`; `message` 1–4,000 chars; `tool`
≤ 64 chars; `details` ≤ 4,000 chars; `screen` ≤ 64 chars, the part of the web app it was sent from;
`reply`, the web app only, adds the signed-in person's address (an agent's `reply` is `422`).
Account-level (not tied to a tenant) and **write-only**: there is no read operation in either
adapter.

A report **names nobody**: it keeps its kind, its words, the release (`server_version`), the door
(`surface`: `web` or `mcp`), an agent's family (`client`, from `clientFamily`, never the name its
client registered) or the `screen`, and `reply_to` only when the person shared their address.
`submitted_by` holds who sent a report made before this, and is null since. One person, with their
agents, sends at most 10 a UTC day (`feedback_counts`, a count per account and day that never says
which reports, deleted once the day is over), and a deployment takes at most 200 a day; past
either, `429 rate_limited`. An agent connection whose person turned feedback off is refused with
`403 feedback_off` ([§3.8](03-accounts-teams-and-identity.md#38-identity-of-the-caller)).

**The digest.** With `WHATBUILD_FEEDBACK_EMAIL` set and mail configured, the worker mails what is
unsent (`sent_at` null) to that address in one plain-text message, at most 100 reports, at most once
every 24 hours and only when there is something new, and sets `sent_at` on each report in the same
transaction, so a send that fails leaves them for the next try ([mail](../operations/mail.md)).
Otherwise reports stay in the database for whoever runs the deployment
(◆ [decision](../decisions/feedback-names-nobody-and-reaches-the-maintainers-in-a-daily-digest.md)).

**Interest.** The public site's form (`POST /api/v1/interest { email, name?, organization?,
note? }`, no sign-in) records someone asking to hear when WhatBuild opens: `email` ≤ 320 chars,
`name` and `organization` ≤ 200, `note` ≤ 2,000. One row per address, compared without case; a
repeat updates the fields it sends. The answer is the same `{ received: true }` for a new address,
a repeat and a bot (a hidden `website` field), so it never reveals who asked. New rows are limited
to 200 an hour across the site (`429 rate_limited`). Not tenant content and not an operation;
write-only like feedback
([decision](../decisions/the-public-site-is-one-page-built-with-the-app.md)).

## 4.14 The product bundle

A product exports to a single ZIP (`products.export`, open to every role on the product). A worker
job builds it; it can be downloaded for seven days ([`export.ts`](../../packages/core/src/ops/export.ts)).

```
bundle.json                 format (whatbuild-product-bundle) and format version (2), exported_at/by,
                            server version, tenant, team, product, layout
README.txt
outcomes.json
records/<record_id>/record.json                  the source, its derived text's details and its attachments with their versions
records/<record_id>/text.md                      the source's derived text, when it has one
records/<record_id>/attachments/<file_version_id>/<path>   every version of every attachment
records/<record_id>/derived/<derivation_id>/{text.md,manifest.json}   every reading (and segments.jsonl, in one made while sources had passages)
records/<record_id>/annotations.json · agent-notes/{summary,notes}.md
assumptions.json            with their reviews
revisions.json
story/hierarchy.json  ·  story/pages/<page_id>/page.json  ·  story/pages/<page_id>/v<n>.{json,html}
                            (a version that shows a mockup page has no .html; its JSON names the page)
mockups/<mockup_id>/mockup.json
mockups/<mockup_id>/v<n>/{version.json,brief.md}  ·  mockups/<mockup_id>/v<n>/pages/<page_id>.{html,notes.md}
mockups/<mockup_id>/v<n>/files/<path>  ·  mockups/<mockup_id>/v<n>/prototype/<path>
tombstones.json
activity.jsonl
```

- `record.json` is the portable, self-describing form of a source: a bundle is readable by a
  person with a ZIP tool and nothing else. Its `text` gives the derived text's `chars`,
  `from_file_version_id`, `updated_at` and `updated_by` (or `null`), and its `attachments` each
  attachment with its versions.
- Format version 2 holds each source's derived text as `text.md` and its attachments under
  `attachments/`; version 1 had `files/`, and each parse's passages in `segments.jsonl`.
- Feedback is not part of an export.
- Planned ([§9.4](09-data-lifecycle.md)): **import**, which preserves every id, version, review,
  revision and actor snapshot, creates a product and never merges into one (`409` if the
  `product_id` exists, unless the caller asks for a copy, which re-mints the product id only); and
  a **tenant export** of every product's bundle plus members and outstanding invitations.

## 4.15 Storage layout

- **Metadata** lives in Postgres: one table per object type with ordinary columns, JSONB for nested
  values (actor snapshots, links, a Story version's mockup page), and indexes for the filters in
  this spec.
  Append-only data (reviews, Story versions, mockup versions and their pages, derivations,
  revisions, activity events, tombstones)
  lives in its own tables and is never updated. Every content table has a row-level security
  policy keyed on the transaction-local `app.tenant_id`. Directory tables (accounts, sessions,
  tokens, OAuth clients, tenants, teams, products, memberships, invitations) and the job queue,
  feedback and its daily counts, the public site's interest form, the usage counts and `schema_migrations` have no
  row-level security and
  are reached only through the authorization layer. Policies are forced, because the app's role owns
  the tables. [`apps/server/test/row-level-security.test.ts`](../../apps/server/test/row-level-security.test.ts)
  lists each table without the policy with its reason, and fails on any other.
- **The public sandbox** ([§9.7](09-data-lifecycle.md),
  [`0009_public_sandbox.sql`](../../apps/server/src/migrations/0009_public_sandbox.sql)) adds
  `tenants.sandbox` and `accounts.sandbox_only`, and five tables. Three sit beside the directory
  tables, without row-level security: `sandbox_settings` (one row per sandbox: `settings` as
  JSONB, `baseline_id`, `last_reset_at`, `last_reset`, `etag`), `sandbox_invites` (`code_hash`,
  `label`, `max_uses`, `used`, `expires_at`, `revoked_at`) and `sandbox_usage` (the counters
  behind the limits, keyed by tenant, account, `minute` or `day` bucket, its start, and counter).
  Two hold content and have the policy: `sandbox_baselines` and `sandbox_baseline_rows`, which
  keeps each row of a baseline as JSONB beside its table's name.
- **Allowances to create organizations** ([§3.3](03-accounts-teams-and-identity.md),
  [`0010_tenant_allowances.sql`](../../apps/server/src/migrations/0010_tenant_allowances.sql)):
  `tenant_allowances`, a directory table without row-level security keyed by the lower-cased
  address (`allowed`, `note`, `etag`, who gave it and who last changed it), and an index on
  `tenants.created_by->>'account_id'`, which is what an allowance is counted against.
- **Prototypes** ([`0025_mockup_prototypes.sql`](../../apps/server/src/migrations/0025_mockup_prototypes.sql)):
  `mockup_prototype_files`, keyed by version and path, with the policy and an index on product and
  blob key; `mockup_pages.entry` and `poster`, and `mockup_pages.html` nullable, a check holding
  that a page has exactly one of `html` and `entry`.
- **Tombstones** ([§9.5](09-data-lifecycle.md),
  [`0021_tombstones_per_product.sql`](../../apps/server/src/migrations/0021_tombstones_per_product.sql))
  are keyed by product, object type and object id, since a Story page's id is unique only within
  its product, with an index on the object id. A product's own tombstone
  carries its id as both product and object.
- **Agent connection levels** ([§3.8](03-accounts-teams-and-identity.md),
  [`0020_connection_levels.sql`](../../apps/server/src/migrations/0020_connection_levels.sql)):
  `oauth_codes.level` and `oauth_tokens.level`, one of `viewer`, `editor` (the default, for every
  connection made before levels existed) and `admin`.
- **How the service is used** ([§9.1](09-data-lifecycle.md),
  [`0019_usage.sql`](../../apps/server/src/migrations/0019_usage.sql),
  [`usage.ts`](../../packages/core/src/usage.ts)): two tables without row-level security that name
  no organization, product, record or account. `usage_calls` counts calls per UTC day, operation,
  door (`web`, `mcp`), agent client family, sandbox or not, owner or not, and outcome (`ok` or the
  error's code). `usage_people` keeps a row for each day a person used a part of WhatBuild (an MCP
  tool's name) through a door and client, the person named by `personOf`, an HMAC of the account id
  under a key derived from the grant key. The worker deletes its rows after 14 months.
- **A source's text and the search index**
  ([`0030_one_derived_text_per_source.sql`](../../apps/server/src/migrations/0030_one_derived_text_per_source.sql)):
  `source_texts`, one row for each source that has a derived text (`record_id`, `content`,
  `chars`, `from_file_version_id`, `updated_at`, `updated_by`, `etag`, [§5.4](05-derived-layer.md)),
  and `text_chunks`, the pieces of a source's title, tags, summary, notes, derived text and comments
  that search reads ([§8.3](08-search.md)); both have the policy and go with their source. An index
  on `derivations (file_version_id, derivation_id desc)` finds an attachment's latest reading. The
  tables that hold attachments keep their names, `files` and `file_versions`.
- **Blobs** are immutable and keyed opaquely: `t/<tenant_id>/r/<record_id>/f/<file_version_id>`
  for attachments' versions, `t/<tenant_id>/r/<record_id>/d/<derivation_id>/{text.md,manifest.json}`
  for what each reading read, and
  `t/<tenant_id>/exports/<export_id>.zip` for exports. Keys never encode titles, tags or any other
  metadata, so no metadata change ever moves bytes, and a key names its tenant. A copied source shares its
  original's attachment blobs; delete frees a blob only when no file version still refers to it.
- **Story previews** ([`0024_story_previews.sql`](../../apps/server/src/migrations/0024_story_previews.sql)):
  `story_previews` holds each document `story.preview` made (`preview_id`, the product, `page_id`,
  `html`, `shows_mockup`, `created_by`, `expires_at`), with the row-level security policy. Nothing
  refers to a row; the grant names it, and it goes when the grant expires (§4.11).
