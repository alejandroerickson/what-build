---
type: Specification
title: Nothing is ever trapped - say what we promise, keep export open, and never let a limit block a read.
description: What we tell people, limits and quotas (enforced and planned), backups and in-product versioning, export, archive and permanent delete of everything archivable and of an organization, the operator runbooks, plans and the free plan's limits, and how retired insights and decisions became sources.
tags: [spec, lifecycle, quotas, backups, export, archive, delete, limits, plans]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# 9. Data lifecycle

We host other people's research on rented infrastructure, for free, as a side project. That is a
defensible thing to do, but only if we say exactly what it means, keep the door open, and never let
a limit stand between someone and their own material. This section is the contract. Where a part
of it is not built yet, it says so.

## 9.1 What we tell people

This text — not a paraphrase of it — opens the privacy page, and is kept in the repository
(`apps/web/src/routes/privacy.tsx`) so a change to it is a reviewable commit. It is four short
statements, each under a lead-in. The sign-in page carries only the first, as one line under the
form ("WhatBuild is a free preview: don’t keep anything here you can’t afford to lose."), with
links to Privacy and Cookies.

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
| Operational telemetry stays about the service | [§2.8](02-architecture.md) — request logs carry method, path with ids masked and organizations, teams and products named only by kind, status, duration and the request's ID; never content, email addresses or tokens (`apps/server/src/app.ts`). Traces, when a deployment sends them, carry less: patterns, names of operations, kinds and codes, never a statement's text or an error's message (`apps/server/src/telemetry.ts`). On Cloud Run, the platform's own request log keeps no address with a query or an invitation link in it ([log exclusion](../operations/cloud-run.md)), and its own request spans are not kept, because traces go to a project that runs nothing ([decision](../decisions/alerts-watch-the-platform-and-traces-go-to-a-project-of-their-own.md)) |
| Use is counted without naming anyone | Below: counts by operation, and people under a keyed pseudonym kept 14 months, read only by the instance's owners (`packages/core/src/usage.ts`, [decision](../decisions/the-server-counts-how-whatbuild-is-used-naming-nobody.md)) |
| No model training on your content | [§2.8](02-architecture.md) — there is no language model in the product (`/api/v1/meta` says so) |
| Isolation per organization | [§3.6](03-accounts-teams-and-identity.md) — three layers, tested on every operation |
| Export is complete and always available | [§9.4](#94-taking-it-with-you) and [§1.5](01-product.md) |
| Analytics only for people who accept | The notice and `/cookies` ([§7.11](07-web-app.md)); Google's script loads only after Accept (`apps/web/src/lib/analytics.ts`) |
| We name our sub-processors | `/privacy` lists the providers the deployment names (`WHATBUILD_PROVIDERS`), below; the sign-in page links to it. Keeping the list current before a provider changes is the operator's. |

**Cookies and browser storage.** WhatBuild uses cookies and browser storage of two kinds. The
needed kind is always on: the session cookie that keeps a person signed in, two short-lived ones
that protect a sign-in with Google or Microsoft and an agent's connection while they happen
([§3.8](03-accounts-teams-and-identity.md)), display choices kept in the browser under
`whatbuild.*`, and `wb_cookies`, which remembers the person's answer below. A browser can pass
from one person to the next, so the display state that is one person's (the product they had open,
their place in each Story and mockup, the Story's focus, the example organization's notice they have read, their
recent searches in each product) is
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
by the operation the server ran, such as `assumptions_create`; search is counted by what was
followed (the kind of result and its place in the list) and whether it found anything, never by
its words; a request to hear from us is `generate_lead`. The instance's owners are never measured,
nor is any address but the deployment's own.
Advertising and Google signals are off. The public site's page also counts every visit,
whatever the answer, with Cloudflare Web Analytics, which sets no cookie
([decision](../decisions/analytics-only-for-people-who-accept-cookies.md)).

**Counting use on the server.** Whatever the answer, the server counts how WhatBuild is used, so
that agents and people who decline are counted too
([decision](../decisions/the-server-counts-how-whatbuild-is-used-naming-nobody.md)). It reads and
stores nothing in the browser. Each call to an operation adds one to a count for its day, its
operation, its door (the web app or an agent), the agent client's family, whether it was in the
example organization, whether an instance owner made it, and how it ended. Each day a person uses a part of
WhatBuild is kept under a pseudonym, a keyed hash of their account that only the deployment can
compute, for 14 months, or until their account is deleted. Nothing kept names an organization, a product, a record, an address or
content. Only the instance's owners read the totals (`products.usage`), which leave the owners out
unless asked. `/cookies` says so under Counting without cookies.

**In the example organization** nobody but its own members writes, and every account reads what
they write; every screen there says so ([§3.10](03-accounts-teams-and-identity.md#310-the-example-organization)).

**The privacy page** (`/privacy`, readable signed out; `apps/web/src/routes/privacy.tsx`), linked
from the sign-in page, Settings, `/cookies` and the public site's footer. It opens with the
statement above. What it says of every deployment is fixed text: what is kept, why and for how long (the account; what people add; sessions
and connected agents, with the deployment's session and agent lifetimes; the counts held against
an organization's limits (§9.7 rules 9 and 10), for three days; request logs; the counts of use,
for 14 months; Google Analytics, when the deployment has it; feedback, without the sender's
name or address unless they share it, and mailed once a day to the people who run the deployment,
and interest; backups),
on what grounds (because a person uses WhatBuild; to run it safely and improve it, which a person
may object to; or their consent), that providers may handle it abroad, that nothing is sold, and
what a person can do (export, ask to see, correct, delete or object, delete their own account,
in the words the deletion page and its confirmation mail use, complain to their authority).
What only the deployment knows comes from its settings, in `privacy` from `GET /api/v1/meta`: who
runs it (`WHATBUILD_OPERATOR`), where to write (`WHATBUILD_PRIVACY_CONTACT`, an address or a page),
and its providers (`WHATBUILD_PROVIDERS`, `Name: what it does; …`). Without them the page says the
deployment has not named them yet.

**About agents.** What a connected agent reads goes to whoever runs it, under their terms, not
ours. The Connect page says so above the address a person is about to paste ([§6.8](06-operations-and-adapters.md)). We make no claims on
behalf of any third-party processor, including the ones our own users choose.

**What not to upload.** The statement asks people not to send material whose loss or exposure
would hurt. Planned: a more specific line in settings — no health records, no payment card data,
no government identifiers, nothing under a regulatory regime. This is the honest consequence of
running without a compliance program.

## 9.2 Limits and quotas

◆ Decision — the numbers are first guesses, to be tuned against real usage and real bills.

| Limit | Value | Enforced today |
|---|---|---|
| Per attachment | 100 MB (`WHATBUILD_FILE_MAX_BYTES`) | Yes — `413 too_large` |
| Through the upload relay | 25 MB (`WHATBUILD_RELAY_MAX_BYTES`); larger files need direct upload URLs | Yes — `413 too_large` |
| Read per attachment | 25 MB (`WHATBUILD_PARSE_CAP_BYTES`); a larger attachment is stored, not read | Yes |
| Memory for reading one attachment | 384 MB of heap (`WHATBUILD_PARSE_MEMORY_MB`), and half as much again for buffers; a parse that needs more is stopped and fails | Yes |
| Time for reading one attachment | 120 seconds (`WHATBUILD_PARSE_TIMEOUT_SECONDS`); a parse that runs longer is stopped and fails | Yes |
| Paragraphs read from one attachment | 200,000; a file that would make more is stored, not read (`too_large`) | Yes |
| Pages of a parsed PDF | 2,000; a longer PDF is stored, not read (`too_large`) | Yes |
| Attachments per source | 50 | Yes — `409 too_many_attachments` |
| A derived text written whole | 2,000,000 characters; a longer one is uploaded as an attachment and its text taken | Yes — `422 too_long` |
| Story pages | 50 per product | Yes — `409 quota_exceeded`, quota `story_pages` |
| Mockups | 50 per product, archived ones included; 48 pages and 8,000,000 characters of HTML, and 50 files and 2,000,000 characters of files, in a version | Yes — `409 quota_exceeded`, quota `mockups`; `422` for a version |
| A mockup's prototype | 2,000 files and 64 MB in a version, 25 MB a file; 500 MB of distinct prototype bytes per product | Yes — `422 invalid_upload`; `409 quota_exceeded`, quota `prototype_bytes` |
| A mockup canvas uploaded as a ZIP | 25 MB packed, or the relay's limit when lower; 96 MB unpacked and 2,148 entries | Yes — `413 too_large`; `422 invalid_upload` past the unpacked size or the entries |
| Story previews | 20 per product, each kept as long as its grant (30 minutes by default) | Yes — a new one drops the oldest, whose grant then answers `404` |
| REST or MCP request body | 5 MB | Yes — `413 too_large` (MCP: `413` with a JSON-RPC error) |
| Sign-in and OAuth request body | 64 KB | Yes — `413` |
| Sign-in links | 5 per address per hour | Yes — `429 rate_limited` |
| OAuth client registrations | 50 an hour waiting for their first connection; one that never connects is removed after 7 days | Yes — `429 rate_limited` |
| Exports in progress | one per product at a time | Yes — `409 export_in_progress` |
| Members | 5 per organization | Planned |
| Active products | 3 per organization | Planned |
| Sources | 300 per organization | Planned |
| Stored bytes (attachments and what was read from them) | 1 GB per organization | Planned |
| Writes and calls a minute, writes, sources, exports and uploaded bytes a day | The free plan's (§9.7) | Yes, on the free plan — `429 rate_limited`, `409 quota_exceeded`, `413 too_large`, `403 plan_restricted` |
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
   cannot drift. The layer exists, in `execute`, and serves the free plan's limits (§9.7).
5. Archiving does not free storage; deleting does. The UI says so where it matters.

**Abuse limits**, which are not quotas but belong beside them. Built: the sign-in link limit,
the limits on OAuth client registration and on sign-in and OAuth request bodies
([§3.8](03-accounts-teams-and-identity.md)), invite-only mode (`WHATBUILD_SIGNUP_ALLOWLIST`, [§3.2](03-accounts-teams-and-identity.md)), in
which an instance owner lets people in one at a time with an allowance, and a guest's limit on calls
a minute in the example organization (§9.7).
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
version>`; a mockup's prototype files by upload and hash, `t/<tenant>/p/<product>/mockup-prototypes/<upload>/<sha256>`,
shared by the versions of one mockup and deleted with it), so nothing is ever overwritten in place ([§4.15](04-data-model.md)) — the common cause
of "the backup has the corrupted version too" does not apply. The deployment's bucket is versioned,
and noncurrent versions are deleted after 30 days. **Planned:** a nightly manifest of keys and
sizes, so a restore can be checked against the database rather than hoped about.

**Backups are for our recovery, not a per-organization feature.** We do not restore one product
from backup on request. The product-level answer to "I broke it" is:

| Kept, in the product | Where |
|---|---|
| Attachment versions — every upload to the same path | [§4.5](04-data-model.md) |
| Readings — what every version of every attachment was read as, retained and readable by id | [§5.1](05-derived-layer.md) |
| Story page versions — immutable, numbered | [§4.11](04-data-model.md) |
| Mockup versions — immutable, numbered, each the whole canvas | [§4.12](04-data-model.md) |
| Outcome and assumption revisions — the previous text, on every content change | [§4.1](04-data-model.md) |
| Reviews — append-only, never edited | [§4.8](04-data-model.md) |
| Superseded assumptions — corrections never overwrite | [§4.8](04-data-model.md) |
| Archive and restore — for sources, assumptions, annotations, outcomes, Story pages, mockups, products | §9.5 |
| Activity — who changed what, when, through which surface | [§4.10](04-data-model.md) |

**Uploads on their way in are not kept.** A mockup canvas uploaded as a ZIP
([§4.12](04-data-model.md)) is read once, by the publish that names it, and its bytes are deleted
once that version is published; the row that recorded the upload goes 7 days later. One never
published goes, with its bytes, a day after its grant expired. The worker's hourly housekeeping
does both (`apps/server/src/worker.ts`), as it removes the bytes of a file upload nobody
completed. **Nor are Story previews:** the document `story.preview` made is kept as long as its
grant, a product keeps only its 20 newest, and the same housekeeping removes expired ones
([§4.11](04-data-model.md)).

Not versioned, deliberately: source metadata edits (the activity log names the operation and the
actor, which is enough to understand and redo), and any future embeddings (rebuildable, so
excluded from backups altogether). Not versioned yet: a source's derived text, summary and notes,
whose earlier wording a write replaces; what an attachment was read as stays readable
([§5.4](05-derived-layer.md)).

## 9.4 Taking it with you

**Product bundle — built.** `products.export` builds one ZIP of a whole product in the background
(`packages/core/src/ops/export.ts`); `products.exports` lists recent exports with a short-lived
download grant for each ready one. A viewer, editor or admin may export, through **both
adapters**, and export is **never blocked** for them — not by a quota, and not by archiving the
product. A reader, who reads only the Story, may not (`403`); the Story's own export is its print
view ([§6.4](06-operations-and-adapters.md)). On the free plan each person exports as many times a
day as `exports_per_day` allows (§9.7), and a guest of the example organization exports nothing:
the example is read where it is. A ready export is
listed for seven days. The bundle holds a manifest with its format name and version, every
source's metadata, its derived text, every attachment version's original bytes, what each was
read as, comments, summaries and notes,
outcomes, assumptions with their reviews, revisions,
the Story hierarchy, its style and every page version (JSON and HTML; a version that shows a
mockup page names it rather than repeating it), every mockup version (its brief, each page's HTML
and notes, its files and its prototype), tombstones, and the activity log, with a README that
names each kind of file and what it holds
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
| Comments (annotations) | `sources.update_annotation { archived, archive_reason? }`, while their source is not archived |
| Outcomes | `outcomes.archive` / `outcomes.restore` |
| Story pages | `story.archive_page` / `story.restore_page` (subpages move up into its place) |
| Mockups | `mockups.archive` / `mockups.restore` |
| Products | `products.archive` / `products.restore` (admin); an archived product is read-only |

- Reversible, erases nothing, and keeps every id resolvable. Editors archive; archiving a product
  is an admin's.
- It takes the object **out of listings, out of the UI's main views, and out of the search space an
  agent can reach** ([§8.2](08-search.md)). That last part is the point: archiving is how a team
  says "stop showing me this, and stop letting the agent find it", without losing it.
- Archiving does **not** free storage. Deleting does, and the UI says so.
- **Archive is what every destructive-looking control offers first.** Delete is available from the
  same place, one step further in, and never pre-selected; its dialog offers Archive instead.

### Delete — permanent, and said plainly

Everything that can be archived can also be deleted, and so can an organization:

| Object | Preview | Delete |
|---|---|---|
| Source | `sources.delete_impact` | `sources.delete` |
| Comment | — (nothing points at it: the comment itself is shown) | `sources.delete_annotation` |
| Assumption | `assumptions.delete_impact` | `assumptions.delete` |
| Outcome | `outcomes.delete_impact` | `outcomes.delete` |
| Story page | `story.delete_page_impact` | `story.delete_page` |
| Mockup | `mockups.delete_impact` | `mockups.delete` |
| Product | `products.delete_impact` | `products.delete` |
| Organization | `products.delete_tenant_impact` | `products.delete_tenant` (owners, web app only) |

- **Admins delete** ([§3.5](03-accounts-teams-and-identity.md)): product admins, and so team admins
  and organization owners and admins for what they administer. Editors archive and never delete.
  ◆ [Decision](../decisions/archive-by-default-delete-guarded.md).
- **Through both adapters**, but an agent deletes only on a connection its person set to Admin
  ([§3.8](03-accounts-teams-and-identity.md)): on Read only or Edit it is not offered a delete,
  and a call to one is refused with `403 connection_level`. Deleting an organization is never
  offered to an agent.
- **Permanent. Immediately.** There is no trash and no grace period. Every surface that offers it
  says it is permanent and cannot be undone, in those words, not "remove" and not "dismiss".
- **Three guards, none of them a permission:**
  1. `expected_etag` is required — you cannot delete an object you have not read. It is the
     `etag` in the preview's result (the comment's own etag for a comment); an object changed
     since the preview is refused with `409 stale_etag`. An organization has no etag; its name is
     its guard.
  2. `reason`, 1–500 characters, recorded on the tombstone.
  3. `confirm` must be the exact literal string `"delete permanently"`; anything else is
     `422 confirmation_required`. It exists so that no action enum, retry, or loose parameter
     can destroy something by accident.
- **A whole product or organization is also named.** `products.delete` and
  `products.delete_tenant` take `name`, which must be its name exactly; anything else is
  `422 name_mismatch`. The web app asks the person to type it.
- **Preview first.** Each preview is read-only and returns exactly what would be destroyed and
  what points at it. For a source: its attachments' versions and bytes, its readings and its
  comments. For an
  assumption: its reviews and the other assumptions that link to it (`linked_from`). For an
  outcome: the assumptions that serve it. For a Story page:
  its versions and the sub-pages that would move up. For a mockup: its versions and the Story
  pages that show it. For a product or organization: everything it holds, counted. Each says in
  `after_delete` what becomes of what points at it. The web UI shows this inside the confirmation
  dialog. An agent's delete takes the impact's etag, so it reads the impact first, and a permanent
  delete is in a `_delete` tool of its own, which a client such as Claude asks the person about
  before each call.
- **What each removes:**
  - A source: its attachments and their versions, its readings, its derived text and its pieces
    in the search index, comments, summary and notes; a background job then deletes the
    attachments' bytes and what was read from them. Bytes still used by a copy in another product
    stay until nothing refers to them.
  - A comment: its text, tags and earlier text.
  - An assumption: its statement, body, reviews and earlier text.
    The links other assumptions hold to it are removed from them (their etags change).
  - An outcome: its title, description and earlier text. Assumptions stop naming it in
    `outcome_ids` (their etags change).
  - A Story page: every version, with its HTML and notes; its sub-pages move up
    into its place, as when it is archived.
  - A mockup: every version, with its pages, notes, files and brief. Refused with
    `409 mockup_on_story` while a Story page's current version shows it (archived pages included):
    that page is deleted, or published with HTML of its own, first. An earlier Story page version
    that showed it then shows nothing.
  - A product: everything in it, archived or not (concept, outcomes, sources, comments,
    assumptions, mockups and canvases uploaded for them, the Story, exports, revisions, its
    activity and its tombstones), the
    roles and invitations on it alone, and its bytes, except those a copy in another product still
    uses. Allowed while it is archived.
  - An organization: every team and product with all they hold, its activity, every role and
    invitation in it, its jobs, its uploads in progress, and its bytes. Its people keep their accounts and their roles
    elsewhere; feedback sent to the maintainers is kept. The example organization can't be deleted
    while the deployment names it (`409 example_organization`).
- A Story page, a mockup or an assumption that mentions a deleted object keeps its text, as every
  version does; a link to the object stops opening.
- **Leaves a tombstone:** `{ object_type, object_id, product_id, title, reason, deleted_at,
  deleted_by }`, keyed by product, type and id, since a Story page's id is unique only within its
  product (a page deleted again under the same id keeps the latest). Reads return `410` with the
  tombstone: `record_deleted` for a source, `<type>_deleted` (`assumption_deleted`,
  `outcome_deleted`, `story_page_deleted`, `mockup_deleted`, `annotation_deleted`) for the rest,
  except that a reader is answered `404` for a deleted Story page, as for an archived one. The
  activity log records it. A deleted product leaves its tombstone and a `deleted`
  event on its team; an addressed call to it answers `404`. A deleted organization leaves nothing.
- **Backups.** Deleted content is gone from the product at once. In the Cloud Run deployment,
  deleted bytes linger as noncurrent bucket versions for 30 days, and deleted rows age out of
  database backups as they roll. We say that rather than claim instant erasure, because instant
  erasure from a provider's point-in-time recovery window is not something we can perform.
- **No undelete.** A tombstone keeps who deleted what, when and why, never the content, so nothing
  deleted can be put back from the product. Undelete would need deleted content kept for a time
  first; it is on the [roadmap](10-roadmap.md).

### Delete an organization

An owner-only operation, because it is organization lifecycle, not content
([§3.5](03-accounts-teams-and-identity.md)), offered in the web app only: the Members page shows
an owner Delete this organization, behind its typed name. `execute` refuses it to anything but a
person in the web app (`403 web_only`), and MCP lists neither it nor its preview.

- It is permanent at once, like every other delete: the organization is gone from the product
  immediately, and its bytes from the file store shortly after, through jobs that outlive it.
  Sessions and tokens need nothing done: with the organization's roles gone, they reach nothing
  in it. An agent connector scoped to it answers `404`.
- An export is not offered first, since export is per product; the dialog says what will go.
- ◆ Decision: no grace period. Earlier plans held content for 7 days so a mistake could be reversed
  by contacting the operator; that waits for undelete.

### Delete an account

A person deletes their own account in the web app, in the Delete account section of Settings, and
an instance owner removes anyone's on People; both do the same thing
([§3.2](03-accounts-teams-and-identity.md#32-accounts-and-sign-in),
[decision](../decisions/a-person-deletes-their-own-account-after-a-recent-sign-in.md)). It removes
the person from every organization, deletes their sign-in, sessions and tokens, and deletes what is
kept about them: their counts against limits and feedback, their counted days of use (§9.1), their
name on the account, and their address wherever it is kept. It does **not** delete organization
content, and actor snapshots survive ([§3.9](03-accounts-teams-and-identity.md)): attribution on a
colleague's assumption is part of that organization's record, not personal data we can silently
rewrite. Whoever wants their content gone too deletes it first, or asks the organization's admins.
A sole owner must make someone else owner or delete the organization first, and Settings names
each, with a link to each way out. It is final at once in the product, and Settings says it can't
be undone. ◆ Decision: the person is told nothing about backups, which go as each deployment's
backups age out ([backups](../operations/backups.md)); keeping to those windows, and taking a
person out of the backups sooner, is the operator's ([erasure](../operations/erasure.md)).

## 9.6 Operator runbooks

Runbooks live in [`okf/operations/`](../operations/index.md). The deployment runbook is
[cloud-run.md](../operations/cloud-run.md): setup, migrations before traffic, continuous
deployment, sign-in configuration. [Releasing](../operations/releasing.md) moves production, the
[dev deployment](../operations/dev-deployment.md) rehearses a release that migrates before it
does, and [recovering from a bad release](../operations/recovering-from-a-bad-release.md) goes
back after one, restoring the database first when it migrated: an earlier version takes no job on
a schema a later one migrated ([§2.3](02-architecture.md#23-the-shape-of-the-deployment)).

- **backup** — [backups](../operations/backups.md): what is configured, where, with what
  retention, and how to check that it runs.
- **restore** — [backups](../operations/backups.md): restoring a dump and checking it, and the
  drill: restore into a scratch environment, verify against the nightly blob manifest once it
  exists, record the date and the elapsed time. Repeated quarterly. Not performed yet.

- **erasure** — [erasure](../operations/erasure.md): the support path for what the product
  deliberately does not automate, a request to take a person out of backups and noncurrent bucket
  versions before they age out, and to delete content they wrote when an organization agrees.

Planned, a deliverable of [Phase 6](10-roadmap.md):

- **incident** — what we tell people, and how fast. A plain page and an honest note, no status
  page theatre.

## 9.7 Plans and limits

Every organization has a plan, `free` or `unlimited` ([§3.3](03-accounts-teams-and-identity.md)
says which an organization gets: the deployment's `WHATBUILD_NEW_ORGANIZATION_PLAN`, unlimited unless
it names free, for one made on an allowance; and who changes it;
◆ [decision](../decisions/free-organizations-meet-limits-that-only-instance-owners-change.md)). On
the free plan everyone in the organization, its owners included, meets the limits below, beside
the ones every organization has (§9.2), whichever is lower; on the unlimited plan nobody does. A
guest of the example organization meets only `requests_per_minute`, from the example's limits
([§3.10](03-accounts-teams-and-identity.md#310-the-example-organization)). The code is
[`packages/core/src/limits.ts`](../../packages/core/src/limits.ts) (every limit, its default, its
refusal and its enforcement) and [`ops/limits.ts`](../../packages/core/src/ops/limits.ts) (reading
and changing them).

An organization's limits are the free plan's (`FREE_LIMITS`) except those an instance owner changed
for it, which `tenants.limits` holds. Stored limits are read through their schema, so a missing or
unreadable value is the free plan's. `products.limits` gives every member each limit with its value,
the free plan's, what it is counted over, its refusal and, for the daily ones, what the caller and
everyone together used today (on every plan, rule 10), and the deployment's own limits, each with a
key that stays the same (`file_max_bytes`, `relay_max_bytes`, `attachments_per_source`, …) and,
where one does, the setting that changes it; the web app shows a person only the few they can run
into, and an instance owner all of them. `products.organizations` gives instance owners every
organization's changed limits and today's totals.

| Limit | Setting | Free plan | Counted over | Refusal |
|---|---|---|---|---|
| Calls, reads included | `requests_per_minute` | 120 | each person, each minute | `429 rate_limited` |
| Writes | `writes_per_minute` | 30 | each person, each minute | `429 rate_limited` |
| Writes | `writes_per_day` | 500 | each person, each day | `409 quota_exceeded` |
| Sources created or copied in, each source of a batch (`attachments.create_uploads`) counted | `sources_per_day` | 25 | each person, each day | `409 quota_exceeded` |
| Exports | `exports_per_day` | 5 | each person, each day | `409 quota_exceeded` |
| Writes | `org_writes_per_day` | 2,000 | everyone together, each day | `409 quota_exceeded` |
| File size | `file_max_bytes` | 10 MB | each file | `413 too_large` |
| Uploads | `bytes_per_day` | 100 MB | each person, each day | `409 quota_exceeded` |
| Uploads | `org_bytes_per_day` | 250 MB | everyone together, each day | `409 quota_exceeded` |
| Text in one field | `text_max_chars` | 200,000 | each text field | `413 too_large` |
| Sources in one archive or restore call | `batch_max` | 25 | each call | `413 too_large` |
| Fetching a file from a URL | `fetch_url` | on | each person | `403 plan_restricted` |
| Uploads limited to formats the parsers read | `documents_only` | on | each person | `403 plan_restricted` |

Rules:

1. **A write is an operation that mutates.** A call is any operation, a read included.
2. **A minute is a clock minute. A day is a UTC day**, from midnight UTC to the next; a refusal
   gives the moment the day's allowances start again (`resets_at`).
3. **A refused call counts as a call, and takes nothing from a day's allowance.** The minute's
   counters are written before the input is read. The day's are written inside the operation's
   transaction, so they go back if the call fails. A batch (`attachments.create_uploads`) is one
   write, and takes one from `sources_per_day` for each source in it; one that would pass the
   allowance is refused whole, with the day's count before the call as `used` and a message
   saying how many it would add and how many are left.
4. **A day's allowance never stops a read or a search** (§9.2 rule 1). Export is counted by
   `exports_per_day` alone: the day's writes never stop it.
5. **On the free plan an upload goes through the relay only**, where the size is enforced as the
   bytes arrive; no direct-to-store URL is issued. A grant's `max_bytes` is the lowest of the file
   limits and what is left of the day's bytes. Bytes are counted when the file is attached, against
   whoever asked for the grant. A mockup canvas is not uploaded as a ZIP (`403 plan_restricted`): its
   text is capped field by field, so its pages go in the call.
6. **The routes that serve bytes are calls too.** A file, an export, and a Story or mockup page's
   HTML are served outside the registry ([§6.4](06-operations-and-adapters.md)); each counts as a
   call against `requests_per_minute` for whoever requested its grant. On a deployment with a
   content site, a document the app's route hands off there counts once, at the app's route; its
   address on the content site counts nothing more.
7. **Setting a limit to 0 refuses everything it counts.** A daily allowance set to 0
   (`writes_per_day`, `org_writes_per_day`, `sources_per_day`, `exports_per_day`, `bytes_per_day`,
   `org_bytes_per_day`) is switched off rather than used up: the call is refused, before its
   allowance is counted, with `403 plan_restricted`, like a switch that is off, with
   `{ setting, limit: 0 }` in `details` and a message that says it is off on the organization's
   plan, never that it starts again tomorrow. `products.limits` gives its refusal as
   `403 plan_restricted`.
8. **A Story or Idea card preview is a call, not a write.** It changes nothing anyone sees, so it
   takes nothing from the day's writes; its text meets `text_max_chars` as a publish's does. It is
   refused wherever writing is switched off (`403 plan_restricted`).
9. **The counters** live in `limit_counters`, per organization and person, and under the account
   `''` for the whole organization. The worker drops a minute's counters after an hour and a day's
   after three days.
10. **A day's use is counted on every plan.** On the unlimited plan nobody is refused, but each
    write, source, export and attached file is counted as on the free plan, in the operation's
    transaction (rule 3), and `products.limits` and the instance owners' list of organizations
    give it as on the free plan. So an organization moved to the free plan during a day meets what
    that day already used: fifteen writes made while it was unlimited leave 485 of a person's 500.
    One moved the other way stops meeting the limits from its next call (`products.set_limits`),
    and its day goes on being counted. A minute's counters are kept only where someone meets the
    limits: counting every read of every organization would cost a write a call, and a plan
    changed in the middle of a minute leaves at most that minute uncounted.
    ◆ Decision: counting a day on every plan costs one more statement in a write's transaction and
    a few rows a person a day, kept three days, and spares the free plan's allowances from
    starting at zero partway through a day, which would let an organization moved to it that day
    write a second day's worth.

**The example organization** keeps no baseline and is never reset: its content changes only when
its own members change it ([§3.10](03-accounts-teams-and-identity.md#310-the-example-organization)).
Its plan is whatever an instance owner set; its members meet its limits only on the free plan.

## 9.8 Retired insights and decisions

Insights and decisions were retired on 2026-10-09
([decision](../decisions/insights-and-decisions-are-retired-into-evidence.md)). Whatever a
deployment held of them becomes sources in Evidence, keeping every id ([§4.7](04-data-model.md)).
The text goes to object storage, which only the worker reaches, so the move has two parts:

1. Migration `0015_insights_and_decisions_to_evidence.sql` queues one `move_to_evidence` job for
   each product that holds an insight or a decision. It changes no rows.
2. The worker runs the job ([`evidence-move.ts`](../../packages/core/src/evidence-move.ts)), one
   product per transaction: it writes each item's Markdown and earlier versions to storage as one
   attachment, adds the source with the same id, indexes its title and tags for search and queues
   its attachment to be read, which gives the source its derived text, points activity events at
   it, drops assumptions' links to decisions, and deletes the item and its revisions and reviews. A
   decision's body already holds the quotes it cited, put there by migration
   `0028_citations_refs_and_lineage_retired.sql` ([§4.8](04-data-model.md)). Run again, it finds
   nothing left to move.

Until the job has run, a link to an item opens nothing. The `insights` table and the
register's `kind` column stay, empty, until a later migration drops them
([roadmap](10-roadmap.md)).
