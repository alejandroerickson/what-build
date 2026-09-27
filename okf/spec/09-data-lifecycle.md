---
type: Specification
title: Nothing is ever trapped - say what we promise, keep export open, and never let a limit block a read.
description: What we tell people, limits and quotas (enforced and planned), backups and in-product versioning, export, archive and permanent delete, closing an organization, and the operator runbooks.
tags: [spec, lifecycle, quotas, backups, export, archive, delete]
generated: {by: agent:claude, at: 2026-09-27}
status: stable
---

# 9. Data lifecycle

We host other people's research on rented infrastructure, for free, as a side project. That is a
defensible thing to do, but only if we say exactly what it means, keep the door open, and never let
a limit stand between someone and their own material. This section is the contract. Where a part
of it is not built yet, it says so.

## 9.1 What we tell people

This text — not a paraphrase of it — is shown in full on the sign-in page, and kept in the
repository (`apps/web/src/routes/auth.tsx`) so a change to it is a reviewable commit.

> WhatBuild is a free, pre-1.0 demonstration service. Your content sits in a managed Postgres
> database and an object store we rent from providers named on our sub-processors page. It is
> encrypted in transit, encrypted at rest as far as those providers do it, and isolated per
> organization by the application and by the database. We take no analytics about what you do in
> the app, show no ads, sell nothing, and train no model on your content; there is no AI in the
> product to train one with. We do not promise uptime or durability, and we cannot promise anything
> on behalf of our providers. Export is always available and always complete. Please don't put
> anything here whose loss or exposure would hurt.

Supporting commitments, each of which is a rule elsewhere in this spec:

| We say | Enforced by |
|---|---|
| No product analytics; operational telemetry only | [§2.8](02-architecture.md) — request logs carry method, path with ids masked, status and duration; never content, email addresses or tokens (`apps/server/src/app.ts`) |
| No model training on your content | [§2.8](02-architecture.md) — there is no language model in the product (`/api/v1/meta` says so) |
| Isolation per organization | [§3.6](03-accounts-teams-and-identity.md) — three layers, tested on every operation |
| Export is complete and always available | [§9.4](#94-taking-it-with-you) and [§1.5](01-product.md) |
| We name our sub-processors | **Planned:** a public page listing the container host, database, object store and email provider, updated before a provider changes. The statement already refers to it. |

**About agents.** Connecting an agent sends your passages to whoever runs that agent, under their
terms, not ours. The Connect page says exactly that, in those words, immediately beside the
endpoint a person is about to paste ([§6.8](06-operations-and-adapters.md)). We make no claims on
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
| Files per source | 50 | Yes — `409 too_many_files` |
| Story pages | 50 per product | Yes — `409 quota_exceeded`, quota `story_pages` |
| REST request body | 5 MB | Yes — `413 too_large` |
| Sign-in links | 5 per address per hour | Yes — `429 rate_limited` |
| Exports in progress | one per product at a time | Yes — `409 export_in_progress` |
| Members | 5 per organization | Planned |
| Active products | 3 per organization | Planned |
| Sources | 300 per organization | Planned |
| Stored bytes (files + sidecars) | 1 GB per organization | Planned |
| Writes | 60 / minute / member | Planned — `429 rate_limited` |
| Requests | 600 / minute / member | Planned — `429 rate_limited` |
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
   cannot drift.
5. Archiving does not free storage; deleting does. The UI says so where it matters.
6. ◆ Decision: **no billing code.** The tenant's `plan` field (always `free`) and the `owner` role
   reserve the seam; nothing else anticipates it.

**Abuse limits**, which are not quotas but belong beside them. Built: the sign-in link limit, and
invite-only mode (`WHATBUILD_SIGNUP_ALLOWLIST`, [§3.2](03-accounts-teams-and-identity.md)).
Planned: per-IP sign-up limits, a cap on outstanding invitations, and an operator view of usage by
organization before public sign-up opens.

## 9.3 Durability: backups and what is versioned

**Postgres.** In the Cloud Run deployment with Cloud SQL
([cloud-run.md](../operations/cloud-run.md)), `setup.sh` turns on automated daily backups with seven
retained, and point-in-time recovery. With another Postgres, the provider's backups apply.
◆ Decision: a restore into a scratch environment is **performed and written up before public
sign-up opens**, and repeated quarterly. An untested backup is not a backup, and this is the item
most likely to be skipped under time pressure, so it is an acceptance criterion of a phase
([§10 Phase 6](10-roadmap.md)) rather than a good intention. It has not been performed yet.

**Object storage.** Blobs are immutable and keyed opaquely (`t/<tenant>/r/<record>/f/<file
version>`), so nothing is ever overwritten in place ([§4.14](04-data-model.md)) — the common cause
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
| Insight and objective revisions — the previous text, on every content change | [§4.7](04-data-model.md), [§4.2](04-data-model.md) |
| Reviews — append-only, never edited | [§4.8](04-data-model.md) |
| Superseded register entries — corrections never overwrite | [§4.8](04-data-model.md) |
| Archive and restore — for sources, insights, register entries, annotations, objectives, Story pages, products | §9.5 |
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
lineage, objectives, insights (JSON and Markdown), register entries with their reviews, revisions,
the Story hierarchy and every page version (JSON and HTML), tombstones, and the activity log
([§4.13](04-data-model.md)). It is readable with a ZIP tool and nothing else; no proprietary
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
| Insights | `insights.update { status: "archived" }`, and back |
| Assumptions, decisions | `<register>.archive { archived: true | false }` |
| Annotations | `sources.update_annotation { archived, archive_reason? }` |
| Objectives | `objectives.update { status: "archived" }`, and back |
| Story pages | `story.archive_page` / `story.restore_page` (subpages move up into its place) |
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
insights, register entries, annotations, Story pages, objectives and products, in the same shape.

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
  register entries whose citations point at the source, the insights that reference it, the
  Story pages whose current version cites it, and `story_versions_citing`: every page version,
  current or earlier, that cites it (`page_id`, `version`, `count`, `is_current`). `after_delete`
  says that those citations keep their quoted text and will report `record_deleted`. The web UI shows this inside the confirmation dialog. The skill requires
  an agent to call it and show the person the result before proposing a delete, and never to chain
  a delete after another action in the same turn.
- **What it removes:** the source and, with it, its files and file versions, derivations,
  segments (the searchable text), annotations and agent notes; a background job then deletes the
  file bytes and sidecars. Bytes still used by a copy in another product stay until nothing refers
  to them.
- **Leaves a tombstone:** `{ object_type, object_id, product_id, title, reason, deleted_at,
  deleted_by }`. Reads return `410 record_deleted` with the tombstone; `check_citations` reports
  `record_deleted` ([§4.8](04-data-model.md)); lineage reports `deleted`; the activity log records
  it. Nothing that pointed at the object is left guessing.
- **Citation snapshots survive a delete.** A snapshot is a quotation the team wrote down, not a
  copy of the source, and a reviewed decision does not silently lose its evidence because someone
  tidied the sources. ◆ Decision: if the snapshot itself must go, delete the register entry too
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
([§3.9](03-accounts-teams-and-identity.md)) — attribution on a colleague's cited decision is part
of that organization's record, not personal data we can silently rewrite. A sole owner must
transfer ownership or close the organization first, and the UI says which.

## 9.6 Operator runbooks

Runbooks live in [`okf/operations/`](../operations/index.md). The deployment runbook is
[cloud-run.md](../operations/cloud-run.md): setup, migrations before traffic, continuous
deployment, sign-in configuration. Planned, each a deliverable of [Phase 6](10-roadmap.md):

- **backup** — what is configured, where, with what retention.
- **restore** — the drill: restore into a scratch environment, verify against the nightly blob
  manifest, record the date and the elapsed time. Repeated quarterly.
- **incident** — what we tell people, and how fast. A plain page and an honest note, no status
  page theatre.
- **erasure** — the support path for the few cases the product deliberately does not automate: a
  closed organization inside the 7-day window, and content that must be removed from a snapshot a
  reviewed register entry froze.
