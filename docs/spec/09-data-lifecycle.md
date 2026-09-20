# 9. Data lifecycle

We host other people's research on rented infrastructure, for free, as a side project. That is a
defensible thing to do, but only if we say exactly what it means, keep the door open, and never let
a limit stand between someone and their own material. This section is the contract.

## 9.1 What we tell people

This text — not a paraphrase of it — is shown in full during sign-up, linked from every team's
settings, and kept in the repository so a change to it is a reviewable commit.

> WhatBuild is a free, pre-1.0 demonstration service. Your content sits in a managed Postgres
> database and an object store we rent from providers named on our sub-processors page. It is
> encrypted in transit, encrypted at rest as far as those providers do it, and isolated per team by
> the application and by the database. We take no analytics about what you do in the app, show no
> ads, sell nothing, and train no model on your content — there is no LLM in the product to train
> one with. We do not promise uptime or durability, and we cannot promise anything on behalf of our
> providers. Export is always available and always complete. Please don't put anything here whose
> loss or exposure would hurt.

Supporting commitments, each of which is a rule elsewhere in this spec:

| We say | Enforced by |
|---|---|
| No product analytics; operational telemetry only | [§2.8](02-architecture.md) — logs carry ids, statuses and durations, never content, email addresses or tokens |
| No model training on your content | [§2.8](02-architecture.md) — there is no LLM in the product |
| Isolation per team | [§3.6](03-accounts-teams-and-identity.md) — three layers, tested on every operation |
| Export is complete and always available | [§9.4](#94-taking-it-with-you) and [§1.5 rule 9](01-product.md) |
| We name our sub-processors | A public page listing the container host, database, object store and email provider, updated before a provider changes |

**About agents.** Connecting an agent sends your passages to whoever runs that agent, under their
terms, not ours. The Connect page says exactly that, in those words, immediately beside the
endpoint a person is about to paste ([§6.8](06-operations-and-adapters.md)). We make no claims on
behalf of any third-party processor, including the ones our own users choose.

**What not to upload.** The sign-up text asks people not to send material whose loss or exposure
would hurt. The settings page is more specific: no health records, no payment card data, no
government identifiers, nothing under a regulatory regime. This is not legal boilerplate — it is
the honest consequence of running on free tiers without a compliance program.

## 9.2 Quotas and the free tier

◆ Decision — the numbers are first guesses, to be tuned against real usage and real bills.

| Limit | Free team | Code |
|---|---|---|
| Members | 5 | `members` |
| Active projects | 3 | `projects` |
| Records | 300 | `records` |
| Stored bytes (files + sidecars) | 1 GB | `bytes` |
| Per file | 100 MB | — (`413 too_large`) |
| Story pages | 50 per project | `story_pages` |
| Writes | 60 / minute / member | — (`429 rate_limited`) |
| Requests | 600 / minute / member | — (`429 rate_limited`) |
| Team exports | 2 / day | `exports` |

Rules:

1. **A quota blocks writes. It never blocks a read, a search, or an export.** Someone over their
   limit can still work with, and leave with, everything they have. This is not a courtesy; it is
   what makes §9.1 honest.
2. Over a limit, a write returns `409 quota_exceeded` with `{ quota, limit, used, unit }` in
   `details` — an error an agent can explain and a person can act on
   ([§6.2](06-operations-and-adapters.md)).
3. **Usage is visible before it bites.** `team.usage` returns every counter and its limit, and team
   settings shows them as fractions ([§7.11](07-web-app.md)). An upload flow shows remaining
   storage before it starts, not after it fails.
4. Counters are maintained transactionally with the mutations that change them
   ([§6.1](06-operations-and-adapters.md)), and a nightly job reconciles stored bytes against the
   object store's own accounting.
5. Archiving does not free storage; exporting and purging does. The UI says so where it matters.
6. Quota and rate limiting live in **one middleware shared by both adapters**, so REST and MCP
   cannot drift.
7. ◆ Decision: **no billing code in v1.** The `plan` field on a team and the `owner` flag reserve
   the seam; nothing else anticipates it.

**Abuse limits**, which are not quotas but belong beside them: per-IP and per-email sign-up rate
limits; email verification required before any upload or invitation; a cap on outstanding
invitations; and an operator view of usage by team from the first public deployment.

## 9.3 Durability: backups and what is versioned

**Postgres.** The provider's automated daily backup plus point-in-time recovery, with at least
seven days retained. ◆ Decision: a restore into a scratch environment is **performed and written
up before public signup opens**, and repeated quarterly. An untested backup is not a backup, and
this is the single item in this document most likely to be skipped under time pressure, so it is an
acceptance criterion of a phase ([§10 Phase 6](10-roadmap.md)) rather than a good intention.

**Object storage.** Blobs are immutable and keyed opaquely, so nothing is ever overwritten in
place ([§4.14](04-data-model.md)) — the common cause of "the backup has the corrupted version too"
does not apply. Bucket versioning and lifecycle rules are enabled where the provider offers them.
A nightly job writes a manifest of keys and sizes, so a restore can be checked against the database
rather than hoped about.

**Backups are for our recovery, not a per-team feature.** We do not restore one team's project from
backup on request, and we do not offer it. The product-level answer to "I broke it" is:

| Kept, in the product | Where |
|---|---|
| File versions — every upload to the same path | [§4.5](04-data-model.md) |
| Derivations — every parse, retained and readable by id | [§5.1](05-derived-layer.md) |
| Story page versions — immutable, numbered | [§4.11](04-data-model.md) |
| Insight revisions — the previous body, on every content change | [§4.7](04-data-model.md) |
| Reviews — append-only, never edited | [§4.8](04-data-model.md) |
| Superseded register entries — corrections never overwrite | [§4.8](04-data-model.md) |
| Archive and restore — for records, insights, entries, pages, projects | [§1.5 rule 3](01-product.md) |
| Activity — who changed what, when, through which surface | [§4.10](04-data-model.md) |

Not versioned, deliberately: record and objective metadata edits (the activity log names the
operation and the actor, which is enough to understand and redo), and embeddings (rebuildable, so
excluded from backups altogether).

## 9.4 Taking it with you

Two operations, both available to **any member**, through **both adapters**, and **never blocked by
a quota**.

**Project bundle** — one ZIP per project, described in [§4.13](04-data-model.md): every id,
version, snapshot, review, revision and actor, the original files, the derived sidecars, insights
as Markdown, Story pages as HTML, tombstones. Readable with a ZIP tool and nothing else; no
proprietary format, no API required to make sense of it.

**Team export** — every project's bundle plus the team, its members and its activity log. Built by
a job, because it can be large; the caller is notified and the archive is downloadable through a
short-lived signed URL for seven days, then deleted. Rate-limited to two per day.

Import is the same path in reverse, into this instance or into one someone runs themselves
([§2.7](02-architecture.md)). A bundle records its schema version and import upgrades older
bundles.

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

`archive` / `restore`, on records, insights, register entries, annotations, Story pages,
objectives, and whole projects.

- Reversible, erases nothing, and keeps every id resolvable.
- It takes the object **out of listings, out of the UI's main views, and out of the search space an
  agent can reach** ([§8.2](08-search.md)). That last part is the point: archiving is how a team
  says "stop showing me this, and stop letting the agent find it", without losing it.
- Citations to an archived record report `record_archived` and still resolve.
- Archiving does **not** free storage against the quota. Deleting does, and the UI says so.
- **Archive is what every destructive-looking control offers first.** Delete is available from the
  same place, one step further in, and never pre-selected.

### Delete — permanent, and said plainly

`delete` on records, insights, register entries, annotations, Story pages, objectives, and
projects. `library.delete { record_id, etag, reason, confirm }` is the shape; the others match.

- **Available to every member, through both adapters** — REST and MCP alike. It is a content
  operation, so membership is the only access rule ([§1.5 rule 1](01-product.md)), and adapter
  parity ([§1.5 rule 11](01-product.md)) is not suspended for the operations that matter most. An
  agent that can create a record can delete one.
- **Permanent. Immediately.** There is no trash and no grace period. Every surface that offers it
  says *deletes permanently — this cannot be undone*, in those words, not "remove" and not
  "dismiss".
- **Three guards, none of them a permission:**
  1. `etag` is required — you cannot delete an object you have not read.
  2. `reason`, 1–500 chars, recorded on the tombstone.
  3. `confirm` must be the exact literal string `"delete permanently"`; anything else is
     `422 confirmation_required`. It exists so that no action enum, retry, or loose parameter
     can destroy something by accident.
- **Preview first.** `<group>.delete_impact { id }` is a read-only operation returning exactly what
  would be destroyed: file count and bytes, derivations, annotations, revisions, and — most
  importantly — **the citations elsewhere in the project that will be left pointing at a
  tombstone**. The web UI shows this inside the confirmation dialog. The skill requires an agent to
  call it and show the person the result before proposing a delete, and never to chain a delete
  after another action in the same turn.
- **What it removes:** for a record, file bytes of every version, every derivation and its
  sidecars, segments, annotations, revisions, and the searchable text. For a project, everything in
  it. Storage is freed and the team's usage drops.
- **Leaves a tombstone:** `{ object_type, id, project_id, title, deleted_at, deleted_by, reason }`.
  Reads return `410 record_deleted` with the tombstone; `check_citations` reports `record_deleted`
  ([§4.8](04-data-model.md)); lineage reports `deleted`; the activity log records it. Nothing that
  pointed at the object is left guessing.
- **Citation snapshots survive a delete.** A snapshot is a quotation the team wrote down, not a
  copy of the source, and a reviewed decision does not silently lose its evidence because someone
  tidied the library. ◆ Decision: if the snapshot itself must go, delete the register entry too —
  which is an ordinary delete, available in the same way.
- **Backups.** Deleted content is gone from the product at once and ages out of database backups as
  they roll, within 35 days. We say that rather than claim instant erasure, because instant erasure
  from a provider's point-in-time recovery window is not something we can perform.

### Close the team

`team.close` — owner-only, web-only, typed confirmation. This one stays owner-gated because it is
team lifecycle, not content ([§3.5](03-accounts-teams-and-identity.md)).

- An export is offered first, and the UI waits for the person to decline it explicitly.
- The team becomes inaccessible immediately (`409 team_closing` on every write, `404` on reads
  after the grace period), sessions and tokens are revoked, and invitations are void.
- Content is removed from live systems **within 7 days**, which leaves room to reverse a mistake by
  contacting us during that window.
- It ages out of backups as they roll off, **within 35 days** in total. We say that number rather
  than claim instant erasure, because instant erasure from a provider's point-in-time recovery
  window is not a thing we can perform.

### Delete an account

Removes the person from every team and deletes their sign-in, sessions and
tokens. It does **not** delete team content, and actor snapshots survive
([§3.8](03-accounts-teams-and-identity.md)) — attribution on a colleague's cited decision is part
of that team's record, not personal data we can silently rewrite. If the person was a team's sole
owner, they must transfer ownership or close the team first, and the UI says which.

## 9.6 Operator runbooks

`docs/operations/` holds the procedures this section implies, and each is a deliverable of
[Phase 6](10-roadmap.md):

- `deploy.md` — the reference deployment, migrations-before-traffic, rollback.
- `backup.md` — what is configured, where, with what retention.
- `restore.md` — the drill: restore into a scratch environment, verify against the nightly blob
  manifest, record the date and the elapsed time. Repeated quarterly.
- `incident.md` — what we tell people, and how fast. No status page theatre: a plain page and an
  honest note.
- `erasure.md` — the support path for the few cases the product deliberately does not automate:
  a closed team inside the 7-day window, and content that must be removed from a snapshot a
  reviewed register entry froze.
