---
type: Specification
title: Nothing is ever trapped - say what we promise, keep export open, and never let a limit block a read.
description: What we tell people, limits and quotas (enforced and planned), backups and in-product versioning, export, archive and permanent delete, closing an organization, the operator runbooks, the public sandbox with its limits, baseline and reset, and how retired insights and decisions became sources.
tags: [spec, lifecycle, quotas, backups, export, archive, delete, sandbox]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# 9. Data lifecycle

We host other people's research on rented infrastructure, for free, as a side project. That is a
defensible thing to do, but only if we say exactly what it means, keep the door open, and never let
a limit stand between someone and their own material. This section is the contract. Where a part
of it is not built yet, it says so.

## 9.1 What we tell people

This text — not a paraphrase of it — is shown in full on the sign-in page, under the heading
"Your data in WhatBuild", and kept in the repository (`apps/web/src/routes/auth.tsx`) so a change
to it is a reviewable commit. It is four short statements, each under a lead-in, so a person can
take it in at a glance.

> **A free preview.** We don’t promise uptime or durability, so don’t keep anything here whose
> loss or exposure would hurt.
>
> **Kept apart.** Your content is isolated per organization, encrypted in transit, and encrypted
> at rest as far as our providers do it. We rent the database and the file store, and can’t
> promise anything on their behalf.
>
> **Never sold or trained on.** No ads, nothing sold, and no model trained on your content. There
> is no AI in WhatBuild.
>
> **Yours to take.** Export is always available and always complete.

Supporting commitments, each of which is a rule elsewhere in this spec:

| We say | Enforced by |
|---|---|
| Operational telemetry stays about the service | [§2.8](02-architecture.md) — request logs carry method, path with ids masked, status and duration; never content, email addresses or tokens (`apps/server/src/app.ts`) |
| No model training on your content | [§2.8](02-architecture.md) — there is no language model in the product (`/api/v1/meta` says so) |
| Isolation per organization | [§3.6](03-accounts-teams-and-identity.md) — three layers, tested on every operation |
| Export is complete and always available | [§9.4](#94-taking-it-with-you) and [§1.5](01-product.md) |
| Analytics only for people who accept | The notice and `/cookies` ([§7.11](07-web-app.md)); Google's script loads only after Accept (`apps/web/src/lib/analytics.ts`) |
| We name our sub-processors | **Planned:** a public page listing the container host, database, object store and email provider, updated before a provider changes. The statement says the database and file store are rented, and links to the page once it exists. |

**Cookies and browser storage.** WhatBuild uses cookies and browser storage of two kinds. The
needed kind is always on: the session cookie that keeps a person signed in, two short-lived ones
that protect a sign-in with Google or Microsoft and an agent's connection while they happen
([§3.8](03-accounts-teams-and-identity.md)), display choices kept in the browser under
`whatbuild.*`, and `wb_cookies`, which remembers the person's answer below. A browser can pass
from one person to the next, so the display state that is one person's (the product they had open,
their place in each Story and mockup, the Story's focus, the sandbox notices they have read) is
cleared when they sign out or the app finds their session ended; only the device's own choices
(theme, hidden panels, the canvas's pan or interact mode) stay (`apps/web/src/lib/local-state.ts`).
The optional kind is
analytics. A deployment with a Google Analytics measurement ID asks every person once, on the
public site or in the app, with Accept and Decline of equal weight; `wb_cookies` sits on the parent
domain, so one answer covers both. Google Analytics loads only after Accept. Everything works the
same either way, and `/cookies` (or Cookies in the site's footer) changes the answer later
([§7.11](07-web-app.md)). What reaches Google names the page and the action, never the
organization, product, record or content: page views carry a masked path such as
`/t/:org/:team/:product/story/:id` and a fixed title; each change the app makes is an event named
from a fixed word list, such as `assumptions_create`; a request to hear from us is `generate_lead`.
Advertising and Google signals are off. The public site's page also counts every visit,
whatever the answer, with Cloudflare Web Analytics, which sets no cookie
([decision](../decisions/analytics-only-for-people-who-accept-cookies.md)).

**In the public sandbox** the statement above is not the whole truth, so every screen there says
the rest ([§9.7](#97-the-public-sandbox)): what is added is seen by other visitors and erased at
the next reset. The words come from the server (`sandboxNotice`), so the web app, the invitation
page and an agent say the same thing.

**About agents.** What a connected agent reads goes to whoever runs it, under their terms, not
ours. The Connect page says so above the address a person is about to paste ([§6.8](06-operations-and-adapters.md)). We make no claims on
behalf of any third-party processor, including the ones our own users choose.

**What not to upload.** The statement asks people not to send material whose loss or exposure
would hurt. Planned: a more specific line in settings — no health records, no payment card data,
no government identifiers, nothing under a regulatory regime. This is the honest consequence of
running on free tiers without a compliance program.

## 9.2 Limits and quotas

◆ Decision — the numbers are first guesses, to be tuned against real usage and real bills.

| Limit | Value | Enforced today |
|---|---|---|
| Per file | 100 MB (`WHATBUILD_FILE_MAX_BYTES`) | Yes — `413 too_large` |
| Through the upload relay | 25 MB (`WHATBUILD_RELAY_MAX_BYTES`); larger files need direct upload URLs | Yes — `413 too_large` |
| Parsed per primary file | 25 MB (`WHATBUILD_PARSE_CAP_BYTES`); larger files are stored, not parsed | Yes |
| Memory for parsing one file | 384 MB of heap (`WHATBUILD_PARSE_MEMORY_MB`), and half as much again for buffers; a parse that needs more is stopped and fails | Yes |
| Time for parsing one file | 120 seconds (`WHATBUILD_PARSE_TIMEOUT_SECONDS`); a parse that runs longer is stopped and fails | Yes |
| Passages from one file | 200,000; a file that would make more is stored, not parsed (`too_large`) | Yes |
| Pages of a parsed PDF | 2,000; a longer PDF is stored, not parsed (`too_large`) | Yes |
| Files per source | 50 | Yes — `409 too_many_files` |
| Story pages | 50 per product | Yes — `409 quota_exceeded`, quota `story_pages` |
| Mockups | 50 per product, archived ones included; 24 pages and 8,000,000 characters of HTML, and 50 files and 2,000,000 characters of files, in a version | Yes — `409 quota_exceeded`, quota `mockups`; `422` for a version |
| REST or MCP request body | 5 MB | Yes — `413 too_large` (MCP: `413` with a JSON-RPC error) |
| Sign-in and OAuth request body | 64 KB | Yes — `413` |
| Sign-in links | 5 per address per hour | Yes — `429 rate_limited` |
| OAuth client registrations | 50 an hour waiting for their first connection; one that never connects is removed after 7 days | Yes — `429 rate_limited` |
| Exports in progress | one per product at a time | Yes — `409 export_in_progress` |
| Members | 5 per organization | Planned |
| Active products | 3 per organization | Planned |
| Sources | 300 per organization | Planned |
| Stored bytes (files + sidecars) | 1 GB per organization | Planned |
| Writes | 60 / minute / member | Planned — `429 rate_limited`. Built for visitors to the public sandbox (§9.7) |
| Requests | 600 / minute / member | Planned — `429 rate_limited`. Built for visitors to the public sandbox (§9.7) |
| Organization exports | 2 / day | Planned |

Rules:

1. **A quota blocks writes. It never blocks a read, a search, or an export.** Someone over their
   limit can still work with, and leave with, everything they have. This is what makes §9.1
   honest.
2. Over a limit, a write returns `409 quota_exceeded` with `{ quota, limit, used, unit }` in
   `details` — an error an agent can explain and a person can act on
   ([§6.2](06-operations-and-adapters.md)).
3. **Planned — usage is visible before it bites:** a usage operation returning every counter and its
   limit, shown as fractions in organization settings ([§7.11](07-web-app.md)); an upload flow that
   shows remaining storage before it starts, not after it fails.
4. **Planned:** counters maintained transactionally with the mutations that change them
   ([§6.1](06-operations-and-adapters.md)), a nightly job reconciling stored bytes against the
   object store, and quota and rate limiting in one layer shared by both adapters, so REST and MCP
   cannot drift. The layer exists, in `execute`, and today it serves the public sandbox only
   (§9.7).
5. Archiving does not free storage; deleting does. The UI says so where it matters.
6. ◆ Decision: **no billing code.** The tenant's `plan` field (always `free`) and the `owner` role
   reserve the seam; nothing else anticipates it.

**Abuse limits**, which are not quotas but belong beside them. Built: the sign-in link limit,
the limits on OAuth client registration and on sign-in and OAuth request bodies
([§3.8](03-accounts-teams-and-identity.md)), invite-only mode (`WHATBUILD_SIGNUP_ALLOWLIST`, [§3.2](03-accounts-teams-and-identity.md)), and
in the public sandbox a cap on seats and on each invitation's places (§9.7).
Planned: per-IP sign-up limits, a cap on outstanding invitations, and an operator view of usage by
organization before public sign-up opens.

## 9.3 Durability: backups and what is versioned

**Postgres.** In the Cloud Run deployment with Cloud SQL
([cloud-run.md](../operations/cloud-run.md)), `setup.sh` turns on automated daily backups with seven
retained, and point-in-time recovery. With another Postgres, whose free tiers keep only hours of
restore history, a nightly `pg_dump` runs as a role that reads everything and changes nothing, into
a bucket of its own where dumps expire after 35 days ([backups](../operations/backups.md)). On Neon,
each deploy also branches the database before it migrates, as a restore point.
◆ Decision: the backup identity may add and read dumps but not delete them, so a fault in the job
cannot erase the backups it would be needed to replace.
◆ Decision: a restore into a scratch environment is **performed and written up before public
sign-up opens**, and repeated quarterly. An untested backup is not a backup, and this is the item
most likely to be skipped under time pressure, so it is an acceptance criterion of a phase
([§10 Phase 6](10-roadmap.md)) rather than a good intention. It has not been performed yet.
[Backups](../operations/backups.md#the-restore-drill) gives the procedure; the scratch environment
is the [dev deployment](../operations/dev-deployment.md).

**Object storage.** Blobs are immutable and keyed opaquely (`t/<tenant>/r/<record>/f/<file
version>`), so nothing is ever overwritten in place ([§4.15](04-data-model.md)) — the common cause
of "the backup has the corrupted version too" does not apply. The deployment's bucket is versioned,
and noncurrent versions are deleted after 30 days. **Planned:** a nightly manifest of keys and
sizes, so a restore can be checked against the database rather than hoped about.

**Backups are for our recovery, not a per-organization feature.** We do not restore one product
from backup on request. The product-level answer to "I broke it" is:

| Kept, in the product | Where |
|---|---|
| File versions — every upload to the same path | [§4.5](04-data-model.md) |
| Derivations — every parse, retained and readable by id | [§5.1](05-derived-layer.md) |
| Story page versions — immutable, numbered | [§4.11](04-data-model.md) |
| Mockup versions — immutable, numbered, each the whole canvas | [§4.12](04-data-model.md) |
| Outcome and assumption revisions — the previous text, on every content change | [§4.1](04-data-model.md) |
| Reviews — append-only, never edited | [§4.8](04-data-model.md) |
| Superseded assumptions — corrections never overwrite | [§4.8](04-data-model.md) |
| Archive and restore — for sources, assumptions, annotations, outcomes, Story pages, mockups, products | §9.5 |
| Activity — who changed what, when, through which surface | [§4.10](04-data-model.md) |

Not versioned, deliberately: source metadata edits (the activity log names the operation and the
actor, which is enough to understand and redo), and any future embeddings (rebuildable, so
excluded from backups altogether).

## 9.4 Taking it with you

**Product bundle — built.** `products.export` builds one ZIP of a whole product in the background
(`packages/core/src/ops/export.ts`); `products.exports` lists recent exports with a short-lived
download grant for each ready one. Any role may export, through **both adapters**, and export is
**never blocked** — not by a quota, and not by archiving the product. A ready export is listed for
seven days. The bundle holds a manifest with its format name and version, every source's metadata,
every file version's original bytes, every derivation's sidecars, annotations and agent notes,
lineage, outcomes, assumptions with their reviews, revisions,
the Story hierarchy and every page version (JSON and HTML; a version that shows a mockup page
names it rather than repeating it), every mockup version (its brief, each page's HTML and
notes, and its files), tombstones, and the activity log
([§4.14](04-data-model.md)). It is readable with a ZIP tool and nothing else; no proprietary
format, no API required to make sense of it.

**Planned:**

- **Organization export** — every product's bundle plus the organization, its teams, its members
  and their grants. Built by a job, downloadable through a short-lived grant for seven days, then
  deleted. Rate-limited to two per day.
- **Import** — the same path in reverse, into this instance or into one someone runs themselves
  ([§2.7](02-architecture.md)), upgrading bundles written with an older format version.
- Deleting the stored ZIP of an export once it is no longer listed.

**This is what makes §9.1 survivable.** We cannot promise durability on free infrastructure, so the
promise we make instead is that nothing is ever trapped: if the service disappears tomorrow,
everyone who exported has a complete, readable copy of their work, and everyone who did not can
export right up until it does.

## 9.5 Archive and delete

People upload the wrong file, paste the wrong transcript, or simply change their mind, and they
are entitled to have it gone. So both operations exist. They are for different jobs, and the
product never confuses them: archive is "stop showing me this", delete is "this should never have
been here".

### Archive — the default

| Object | How |
|---|---|
| Sources | `sources.archive` / `sources.restore` (up to 200 at once) |
| Assumptions | `assumptions.archive { archived: true | false }` |
| Annotations | `sources.update_annotation { archived, archive_reason? }` |
| Outcomes | `outcomes.update { status: "archived" }`, and back |
| Story pages | `story.archive_page` / `story.restore_page` (subpages move up into its place) |
| Mockups | `mockups.archive` / `mockups.restore` |
| Products | `products.archive` / `products.restore` (admin); an archived product is read-only |

- Reversible, erases nothing, and keeps every id resolvable.
- It takes the object **out of listings, out of the UI's main views, and out of the search space an
  agent can reach** ([§8.2](08-search.md)). That last part is the point: archiving is how a team
  says "stop showing me this, and stop letting the agent find it", without losing it.
- Citations to an archived source report `record_archived` and still resolve.
- Archiving does **not** free storage. Deleting does, and the UI says so.
- **Archive is what every destructive-looking control offers first.** Delete is available from the
  same place, one step further in, and never pre-selected.

### Delete — permanent, and said plainly

Built for **sources**: `sources.delete { record_id, expected_etag, reason, confirm }`. Planned for
assumptions, annotations, Story pages, outcomes and products, in the same shape.

- **Available to editors, through both adapters** — REST and MCP alike
  ([§3.5](03-accounts-teams-and-identity.md)). Adapter parity is not suspended for the operations
  that matter most: an agent that can create a source can delete one.
- **Permanent. Immediately.** There is no trash and no grace period. Every surface that offers it
  says it is permanent and cannot be undone, in those words, not "remove" and not "dismiss".
- **Three guards, none of them a permission:**
  1. `expected_etag` is required — you cannot delete an object you have not read. It is the
     `etag` in the `delete_impact` result; a source changed since the preview is refused with
     `409 stale_etag`.
  2. `reason`, 1–500 characters, recorded on the tombstone.
  3. `confirm` must be the exact literal string `"delete permanently"`; anything else is
     `422 confirmation_required`. It exists so that no action enum, retry, or loose parameter
     can destroy something by accident.
- **Preview first.** `sources.delete_impact { record_id }` is a read-only operation returning
  exactly what would be destroyed: file versions and bytes, derivations, annotations, the
  assumptions whose citations point at the source, the other sources that list it as related, the
  Story pages whose current version cites it, and `story_versions_citing`: every page version,
  current or earlier, that cites it (`page_id`, `version`, `count`, `is_current`), and the same
  for mockups (`mockup_versions_citing`, by `mockup_id`). `after_delete`
  says that those citations keep their quoted text and will report `record_deleted`. The web UI
  shows this inside the confirmation dialog. The skill requires an agent to call it and show the
  person the result before proposing a delete, and to delete only once the person approves that
  impact (a delete approved in advance still waits for the preview), never slipped into a run of
  other actions.
- **What it removes:** the source and, with it, its files and file versions, derivations,
  segments (the searchable text), annotations and agent notes; a background job then deletes the
  file bytes and sidecars. Bytes still used by a copy in another product stay until nothing refers
  to them.
- **Leaves a tombstone:** `{ object_type, object_id, product_id, title, reason, deleted_at,
  deleted_by }`. Reads return `410 record_deleted` with the tombstone; `check_citations` reports
  `record_deleted` ([§4.8](04-data-model.md)); lineage reports `deleted`; the activity log records
  it. Nothing that pointed at the object is left guessing.
- **Citation snapshots survive a delete.** A snapshot is a quotation the team wrote down, not a
  copy of the source, and a reviewed assumption does not silently lose its evidence because someone
  tidied the sources. ◆ Decision: if the snapshot itself must go, delete the assumption too
  (planned, as above).
- **Backups.** Deleted content is gone from the product at once. In the Cloud Run deployment,
  deleted bytes linger as noncurrent bucket versions for 30 days, and deleted rows age out of
  database backups as they roll. We say that rather than claim instant erasure, because instant
  erasure from a provider's point-in-time recovery window is not something we can perform.

### Close an organization (planned)

An owner-only operation, because it is organization lifecycle, not content
([§3.5](03-accounts-teams-and-identity.md)), offered in the web app only, behind a typed
confirmation.

- An export is offered first, and the UI waits for the person to decline it explicitly.
- The organization becomes inaccessible immediately (every write refused, reads `404` after the
  grace period), sessions and tokens scoped to it stop working, and invitations are void.
- Content is removed from live systems **within 7 days**, which leaves room to reverse a mistake by
  contacting us during that window, and ages out of backups as they roll off, **within 35 days** in
  total.

### Delete an account (planned)

Removes the person from every organization and deletes their sign-in, sessions and tokens. It does
**not** delete organization content, and actor snapshots survive
([§3.9](03-accounts-teams-and-identity.md)) — attribution on a colleague's cited assumption is part
of that organization's record, not personal data we can silently rewrite. A sole owner must
transfer ownership or close the organization first, and the UI says which.

## 9.6 Operator runbooks

Runbooks live in [`okf/operations/`](../operations/index.md). The deployment runbook is
[cloud-run.md](../operations/cloud-run.md): setup, migrations before traffic, continuous
deployment, sign-in configuration. [Releasing](../operations/releasing.md) moves production, the
[dev deployment](../operations/dev-deployment.md) rehearses a release that migrates before it
does, and [recovering from a bad release](../operations/recovering-from-a-bad-release.md) goes
back after one.

- **backup** — [backups](../operations/backups.md): what is configured, where, with what
  retention, and how to check that it runs.
- **restore** — [backups](../operations/backups.md): restoring a dump and checking it, and the
  drill: restore into a scratch environment, verify against the nightly blob manifest once it
  exists, record the date and the elapsed time. Repeated quarterly. Not performed yet.

Planned, each a deliverable of [Phase 6](10-roadmap.md):

- **incident** — what we tell people, and how fast. A plain page and an honest note, no status
  page theatre.
- **erasure** — the support path for the few cases the product deliberately does not automate: a
  closed organization inside the 7-day window, and content that must be removed from a snapshot a
  reviewed assumption froze.

## 9.7 The public sandbox

One organization, open to anyone holding an invitation, put back to a saved state every day
([§3.10](03-accounts-teams-and-identity.md) says who is who;
◆ [decision](../decisions/the-public-sandbox-is-one-organization-with-pseudonymous-visitors.md)).
The code is [`packages/core/src/public-sandbox.ts`](../../packages/core/src/public-sandbox.ts) (settings, limits,
the schedule), [`public-sandbox-baseline.ts`](../../packages/core/src/public-sandbox-baseline.ts) (baseline and
reset) and [`apps/server/src/public-sandbox.ts`](../../apps/server/src/public-sandbox.ts) (running a reset that is
due).

### Settings

Every setting is a field of `sandbox.update_settings`, guarded by the settings' `etag`. A change
applies to the next call a visitor makes. Stored settings are read through their schema, so a
missing or unreadable value is its default.

| Setting | Default | What it does |
|---|---|---|
| `visitor_access` | `write` | `read`: a visitor's writes are refused with `403 sandbox_read_only`, except export. `closed`: every call a visitor makes in the organization is refused with `403 sandbox_closed`, except `sandbox.status`. Neither takes a seat away. |
| `visitor_agents` | `true` | `false` refuses a visitor's calls over MCP with `403 sandbox_restricted`. |
| `reset_enabled` | `true` | Whether the sandbox resets by itself. |
| `reset_time`, `reset_timezone` | `02:00`, `America/Los_Angeles` | The local hour of the daily reset, and the IANA zone it is in. |
| `max_visitors` | 200 | Seats. |
| `visitor_idle_days` | 30 | Days without a sign-in or an agent's call before a visitor gives up their seat at a reset; `0` keeps every seat. |

### Limits on what a visitor does

They apply to visitors only. Staff meet the limits every organization has (§9.2), and so does a
visitor, who meets whichever is lower. `sandbox.settings` returns all of them as `limits`, with
each one's value, default, what it is counted over and the error it answers with; `sandbox.status`
returns them to a visitor with what is used today.

| Limit | Setting | Default | Counted over | Refusal |
|---|---|---|---|---|
| Calls, reads included | `requests_per_minute` | 120 | each visitor, each minute | `429 rate_limited` |
| Writes | `writes_per_minute` | 30 | each visitor, each minute | `429 rate_limited` |
| Writes | `writes_per_day` | 300 | each visitor, each day | `409 quota_exceeded` |
| Sources created or copied in | `sources_per_day` | 10 | each visitor, each day | `409 quota_exceeded` |
| Exports | `exports_per_day` | 0 (none) | each visitor, each day | `409 quota_exceeded` |
| Writes | `org_writes_per_day` | 20,000 | all visitors together, each day | `409 quota_exceeded` |
| File size | `file_max_bytes` | 5 MB | each file | `413 too_large` |
| Uploads | `bytes_per_day` | 50 MB | each visitor, each day | `409 quota_exceeded` |
| Uploads | `org_bytes_per_day` | 2 GB | all visitors together, each day | `409 quota_exceeded` |
| Text in one field | `text_max_chars` | 200,000 | each text field | `413 too_large` |
| Sources in one archive or restore call | `batch_max` | 25 | each call | `413 too_large` |
| Fetching a file from a URL | `fetch_url` | off | each visitor | `403 sandbox_restricted` |
| Uploads limited to formats the parsers read | `documents_only` | on | each visitor | `403 sandbox_restricted` |

Rules:

1. **A write is an operation that mutates.** A call is any operation, a read included.
2. **A minute is a clock minute. A day runs from one scheduled reset to the next**, whether or not
   resets are turned on, and a reset by hand starts the day's counts again.
3. **A refused call counts as a call, and takes nothing from a day's allowance.** The minute's
   counters are written before the input is read. The day's are written inside the operation's
   transaction, so they go back if the call fails.
4. **A day's allowance never stops a read or a search** (§9.2 rule 1). Export is counted by
   `exports_per_day` alone: neither the day's writes nor `visitor_access: "read"` stops it. Its
   default is 0, so visitors export nothing: the sandbox's content is a demonstration that belongs
   to its staff, not work a visitor could lose, so the promise that nothing is trapped (§9.1) does
   not reach it. Staff may raise it.
5. **A visitor uploads through the relay only**, where the size is enforced as the bytes arrive; no
   direct-to-store URL is issued. A grant's `max_bytes` is the lowest of the file limit and what
   is left of the day's bytes. Bytes are counted when the file is attached, against whoever asked
   for the grant.
6. **A call that names no organization** (`products.list`, `get_skill`, `submit_feedback`) is
   counted too, for a `sandbox_only` account that is a visitor. It meets only the limits on how
   often.
7. **The routes that serve bytes are calls too.** A file, an export, and a Story or mockup page's HTML are
   served outside the registry ([§6.4](06-operations-and-adapters.md)); for a visitor each counts
   as a call and is refused while the sandbox is closed. The upload relay takes no bytes from a
   visitor while `visitor_access` is not `write`, whenever the grant was given.
8. **Setting a limit to 0 refuses everything it counts.**

### The baseline

`sandbox.save_baseline` saves the organization's content as it is: every row carrying its
`tenant_id` in `teams`, `products`, `records`, `files`, `file_versions`, `derivations`,
`segments`, `annotations`, `agent_notes`, `lineage`, `outcomes`, `insights`, `revisions`,
`register_entries`, `reviews`, `story_pages`, `story_versions`, `story_hierarchies`,
`story_styles`, `mockups`, `mockup_versions`, `mockup_pages`, `mockup_files`, `tombstones`, and
the activity events that belong to a product. Each row is held
as JSON, without its generated columns, with its ids.

- **Not in a baseline:** memberships and invitations of either kind, because access is not
  content; the sandbox's own settings, counters and baselines; jobs, uploads in progress and
  exports; and the organization's own activity events. A test requires every table with a
  `tenant_id` to be on one list or the other.
- **Blobs are referred to, never copied.** They are immutable and keyed by file version.
- **It holds what is there**, what visitors added included. Staff who want it clean reset first,
  or set `visitor_access` to `read` while they work.
- **The newest three are kept.** `sandbox.baselines` lists them, and the one in use is the newest
  unless staff reset to an earlier one.
- Saving the first baseline of a sandbox that has never been reset counts as its reset, so the
  next one comes at the next scheduled hour.
- A baseline saved before insights and decisions were retired still holds them (§9.8), so
  `insights` stays on the list while that table exists.
- A baseline saved while sources had kinds was rewritten by migration `0017_sources_are_tagged.sql`
  as the sources were: each kind and organization became tags, and the dropped columns left its
  rows ([§4.4](04-data-model.md)), so a reset puts back tagged sources.

### The reset

`sandbox.reset` (staff, with `confirm: "reset the sandbox"`, and optionally a `baseline_id`) and
the scheduled reset do the same thing, in one transaction that runs alone in the organization:

1. Delete every row of content the organization holds, the uploads in progress, the exports, the
   jobs that have not run, and the day's counters.
2. Insert the baseline's rows. Only the columns the baseline holds are written, so a column added
   since keeps its default.
3. Remove a grant on a team or product the baseline does not hold, and the seat of a visitor idle
   past `visitor_idle_days`. Nothing else about people changes: a reset never gives back access
   that was taken away.
4. Queue a move into Evidence for each product that the baseline gave back an insight or a decision
   (§9.8).
5. Queue the deletion of every blob that no row and no kept baseline refers to.
6. Record when, which baseline, who or the schedule, and the counts, as `last_reset`.

Afterwards the organization's content equals the baseline row for row, links to what the baseline
holds still work, and no other organization's rows or blobs have changed
(`apps/server/test/public-sandbox.test.ts`).

**When the scheduled reset runs.** It is due when `reset_enabled` is true, a baseline exists, and
the last reset is earlier than the most recent `reset_time` in `reset_timezone`. The hour is local,
so it holds through the clock changes; a time the clocks skip lands just after the skip. The
service scales to nothing, so no timer can promise the hour. Instead:

- every request to the API, MCP or sign-in first runs a reset that is due, so nobody is served what
  the hour should have erased;
- an instance that is awake looks every minute;
- a scheduler may call `POST /api/v1/sandbox/reset-if-due` at the hour, so that what visitors
  added does not sit until the next visit ([Cloud Run](../operations/cloud-run.md)).

An instance trusts what it last read about the schedule for at most 30 seconds. A reset that fails
is logged and tried again at the next request; it never stops the request.

**Deleting in a sandbox.** A visitor cannot delete permanently. When staff delete a source that a
baseline holds, its rows go and its blobs stay, because a reset would bring the source back; the
blobs go once no kept baseline refers to them.

**Not built:** a baseline that can be taken out of the database and put into another deployment.
A baseline lives in the database it was saved in, beside blobs in that deployment's store.

## 9.8 Retired insights and decisions

Insights and decisions were retired on 2026-10-09
([decision](../decisions/insights-and-decisions-are-retired-into-evidence.md)). Whatever a
deployment held of them becomes sources in Evidence, keeping every id ([§4.7](04-data-model.md)).
The text goes to object storage, which only the worker reaches, so the move has two parts:

1. Migration `0015_insights_and_decisions_to_evidence.sql` queues one `move_to_evidence` job for
   each product that holds an insight or a decision. It changes no rows.
2. The worker runs the job ([`evidence-move.ts`](../../packages/core/src/evidence-move.ts)), one
   product per transaction: it writes each item's Markdown and earlier versions to storage, adds the
   source with the same id and queues its parse, points Story and mockup `refs`, view lineage and
   activity events at it, drops assumptions' links to decisions, and deletes the item and its
   revisions and reviews. Run again, it finds nothing left to move.

Until the job has run, a reference to an item reads as missing. The `insights` table and the
register's `kind` column stay, empty, until a later migration drops them
([roadmap](10-roadmap.md)).
