---
type: Roadmap
title: Phases 0 to 5 are mostly built, with an example organization every account reads and a free plan; durability, data rights and public sign-up come next.
description: What is built and what is not, phase by phase, with acceptance criteria; the open questions that remain, the ones already settled, the risks, and problems seen that are not yet explained.
tags: [roadmap, status, phases, open-questions, risks, problems]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# 10. Roadmap

The ethos: the smallest implementation that proves the full path wins. Each phase ends in
something demonstrable, and each acceptance list is a test plan.

## Status on 2026-10-26

Observed in the code on this date.

| Phase | State | Built | Not built yet |
|---|---|---|---|
| 0 | Mostly done | pnpm workspace, strict TypeScript, `pnpm dev` with **no Docker** (embedded Postgres), forward-only migrations, seed, `pnpm test` (parsers, server against real Postgres, web), GitHub Actions CI (documentation bundle check, install, guide drift check, typecheck, test, build); the [security checks](../operations/security-checks.md): git hooks and CI jobs that refuse private material in commits and pull request text, a weekly check of what GitHub holds beside the code, `pnpm security` (osv-scanner, zizmor) on every pull request and weekly, a weekly OWASP ZAP scan, Dependabot, CodeQL once public, and a security policy; a [contribution guide](../../.github/CONTRIBUTING.md) and issue forms; `pnpm attention` at the start of an agent session; [agent-driven end-to-end tests](../operations/end-to-end-tests.md) that follow written plans through the web app and the MCP server on an instance reset to a golden master built from production's example organization | code of conduct; lint and format config |
| 1 | Done | registry → REST and MCP (117 operations, 112 of them offered to agents; 28 tools, a read, a write and a delete tool for each kind of object); row-level security in the first migration; ETags; paging; `describe`; activity in the same transaction; the isolation test over every operation; the parity test | — |
| 2 | Mostly done | upload grants (relay, optional direct signed URLs); parsers for plain text, Markdown, VTT, SRT, HTML, DOCX, legacy Word `.doc`, PDF, XLSX, CSV and TSV, laying each file out as readable Markdown (plain text line by line as written, a workbook as the sheet displays it, its hidden parts marked, a PDF's page as it reads, its headings set larger than its text as headings, its tables as tables, a label beside its value and its running headers and footers once); a recording, an image, an unread format or an oversized file known as such the moment it arrives, and a PDF of pictures unread as an image is; every attachment read on the Postgres queue and kept, each in a thread of its own held to a memory and a time limit; hostile-file tests; sources described by a title, a date and tags, with `sources.facets` (the tags in use and who added sources), a summary for people, notes and whole-source comments; one derived text per source, taken from an attachment until someone writes it, read by offset and written whole, by edits or from an attachment; substring and ranked search over each source's title, tags, summary, derived text, notes and comments, through an index of their pieces, with coverage, and plain search over everything in a product; archive and restore; guarded delete, for admins, of sources, comments, assumptions, outcomes, Story pages, mockups and whole products, with tombstones; a synthetic sample product in the seed | usage metering; golden-file tests per format; revisions of a source's derived text, summary and notes; a blob-store conformance suite (no test exercises the Cloud Storage adapter); a fast-saved Word 6 or Word 95 `.doc`, and Word 6 tables beyond what cell marks show; the parse limits measured on the deployment's own Linux under its memory limit; a budget of parse time per organization; in a workbook, a formula stored with a placeholder 0 by a library that never calculates (it asks to be recalculated on opening) is not told from a calculated 0, and the built-in number formats left to East Asian and Thai locales read as General; in a PDF, a list item that ends no sentence runs into the text under it, and so does a heading set in the text's own size, in bold or in capitals, since the text layer gives no font's weight, a table that goes on over a page is read as a table on each page, and a table set so tight that the file runs two cells together is read with them in one cell |
| 3 | Mostly done | tenants, teams, products, roles; email-link, Google, Microsoft work-account and development sign-in; invitations by email and link; the Story-only reader role; invite-only mode; who may create organizations (instance owners, and allowances they give); sign-in link rate limit; the [example organization](#the-example-organization-and-the-free-plan) every account reads, as its guest; plans, and the free plan's limits on how often and how much, which only instance owners change; deleting an organization (its owners, in the web app); sign out everywhere (every session and agent connection at once); a person deleting their own account, after a recent sign-in, which ends it as an instance owner's removal does ([decision](../decisions/a-person-deletes-their-own-account-after-a-recent-sign-in.md)) | quotas on what an organization holds in total (the free plan limits each day, and Story pages and mockups are capped per product); a paid plan; a list of a person's own sessions (browser and when last seen) to end one at a time; archiving and deleting a team; an invitation that is still made, with its link to pass on, when its email cannot be sent (a failed send now fails the invitation) |
| 4 | Mostly done | the design system (Studio, [DESIGN.md](../../apps/web/DESIGN.md)) across every screen of the loop: Idea, search over the whole product (the ⌘K palette with recent searches, and the Search screen by area); Evidence (browse by tag and by who added; intake that asks for a title and tags, with one drop zone for attachments; the source page with its Text, Notes, Comments (archived and restored there too) and Attachments and the inspector, finding words in its text from a search hit's own match; search), Exploration (mockups on a full-width canvas that pans and zooms, fits or fills a page and keeps that view from page to page, with a page's notes, the brief, versions and download in the inspector, pages that enter a team's multi-file prototype as it is, and a page promoted to the Story from there; assumptions with review and confidence; old Synthesis, insight and decision links redirect), outcome revision history, Story (a reader with the page tree, arranged by dragging or Alt and the arrow keys, pages archived, restored and deleted by hand, the published mockups to flip through with the arrow keys and to fit or fill, crumbs, focus mode, the inspector with versions and notes for agents, the Story style with house-style previews, the print view for PDF, the page following the app's theme), Activity as one log for people and agents, organization members, product people, Connect an agent, the person's settings, the cookie choice and `/cookies` | an accessibility audit; on a touch screen, pinching or dragging the mockup canvas from a page in interact mode (the page keeps the touch); a browser walk-through of the loop in CI (`scripts/e2e.mjs` is one, run by hand; the [end-to-end plans](../operations/end-to-end-tests.md) are run by an agent on request); the public sample at `/sample` |
| 5 | Mostly done | OAuth 2.1 for MCP, MCP connectors scoped to one organization or one product that refuse anything outside them, a level on each agent connection (Read only, Edit or Admin) that caps what it may do and the actions it is offered, tools that never mix reads and writes, each with a title and a read-only or destructive hint, the guide agents read through the `guide` tool, with nothing to install, the tools version in the server instructions and in every product's answer, the Connect an agent page, feedback from people and agents that names nobody, with a daily limit, a switch on each agent connection and a daily email digest, the product's Story style (the team's design system or a house style), Story guidance with taste, anti-patterns and design passes, a vocabulary and compositions for plans and front pages, publishing a page from its body, and previewing a publish to look at the exact page first | the stdio transport |
| 6 | Started | the Cloud Run deployment ([cloud-run.md](../operations/cloud-run.md)) and the Cloud Build file, run by a trigger on release tags that waits for approval ([decision](../decisions/production-runs-releases-after-approval.md)); releases as tags that publish the image to the GitHub container registry ([decision](../decisions/releases-are-tags-with-a-published-image.md)); product export (`products.export`); the public site with its interest form, served from Cloudflare's edge or by host; the service capped at one instance, with a worker that sleeps between requests and scanners' paths answered at Cloudflare's edge, so a database that suspends when idle sleeps when nobody uses it; able to run on a free-tier Postgres (the suite passes against 18) with a nightly logical backup to a bucket, set up by hand, and its runbook ([backups.md](../operations/backups.md)); a dev deployment holding a copy of production, where a release that migrates is rehearsed before production moves ([dev-deployment.md](../operations/dev-deployment.md)); copies of production that hold only the example organization or the organizations named, for the local copy, the golden master, the dev deployment or another deployment's new database ([copying-an-organization.md](../operations/copying-an-organization.md)); mail through Cloudflare Email Sending or any SMTP provider ([mail.md](../operations/mail.md)); alerts on the Cloud Run deployment's server errors, error lines, memory and failed jobs, and its traces, in a project that runs nothing ([cloud-run.md](../operations/cloud-run.md#alerts)); instructions for an agent to self-host on Azure ([below](#self-hosting-on-azure)); account deletion, which also deletes the person's counted days of use, and the erasure runbook ([erasure.md](../operations/erasure.md)) | a rehearsed restore; import; organization export; adding a copied organization to a database that already holds others, matching its people to accounts there by address; `setup.sh` creating the Cloud Build trigger (made by hand, so a deployment without one deploys nothing on a release); [undelete](#planned--undelete); the sub-processors page; abuse tests beyond hostile uploads and isolation; limits per client address, once the Worker passes the client's address in a header the service can trust (until then the limit on agent registrations is shared by the whole deployment); Postgres 18 in CI and the embedded test server; `setup.sh` creating the nightly backup; a cap on bytes served per member a day |

**Deploy early.** A deployment exists as soon as there is something to deploy, is redeployed on
every release through a Cloud Build trigger that waits for approval (made by hand; see
[cloud-run.md](../operations/cloud-run.md)), and is invite-only until Phase 6. The first public
deploy is then a configuration change, not a milestone that can go wrong.

## Phase 0 — Repository and local development

Monorepo scaffold ([§2.9](02-architecture.md)), strict TypeScript, lint, format, an embedded
Postgres for development, migration and seed commands, CI, MIT licence, README, contribution
guide, code of conduct, security policy.

*Accept:*
- On a machine with Node and nothing else, a fresh clone reaches a running, signed-in application
  with seeded data via `pnpm install && pnpm dev` — **with no account created anywhere, no Docker
  and no API key of any kind**.
- `pnpm test` passes from that same clone.
- CI runs the same path a contributor does, so a broken `pnpm dev` breaks the build.

## Phase 1 — The contract and the data spine

Operation registry; REST and MCP adapters generated from it; Postgres with `tenant_id` and
row-level security **in the first migration**; the error model; ETags; paging; `describe`; the
activity log.

*Accept:*
- A caller lists, reads, and writes products, outcomes, and sources through **both** adapters.
- The parity test passes; an unregistered tool action fails it.
- Stale ETag → `409`; unknown field → `422`; over-limit page → `422`.
- Product resolution over MCP follows [§3.6](03-accounts-teams-and-identity.md), including
  `product_required` listing the products.
- **The isolation test passes for every operation**: a caller from another tenant receives `404`,
  never `403`, and never data.
- Every mutation writes its activity event in the same transaction.

## Phase 2 — Sources and the derived layer

Upload grants; parsers and the readable text they lay out; every attachment read on the queue;
one derived text per source, read by offset and written whole, by edits or from an attachment;
Postgres full-text and substring search over what a source says; archive, restore,
`delete_impact` and `delete` with tombstones; usage metering; the blob conformance suite; the
synthetic sample product.

*Accept:*
- A representative VTT transcript yields its speakers and cue times in its derived text, and
  `derived.text` windows cut it at exact code-point offsets — including a non-BMP character.
- Golden files for each format; each manifest status reachable by a test fixture.
- An over-size text window is refused, never clipped, per [§5.4](05-derived-layer.md).
- Upload → read → search → reading the derived text around a hit works end to end through REST
  and through MCP.
- An archived source leaves search — including through MCP — and returns unchanged on restore.
- A deleted source frees its bytes and returns `410` with its tombstone. `delete` without
  `confirm`, with a stale `expected_etag`, or without a reason is refused.
- Blob conformance passes on in-memory, filesystem and Cloud Storage configurations.
- Usage counters match a reconciliation job's independent count.

## Phase 3 — Accounts, organizations, invitations

Sign-in by email link, Google and Microsoft work accounts; organization creation; invitations by email and link; members
and roles; sessions; the `owner` role; rate limits; quota enforcement; the data statement at
sign-in.

*Accept:*
- Two accounts and two tenants; the full isolation suite is green, including blob keys.
- An invitation works end to end: terminal mail in development, a real provider in production.
- A member whose grant is revoked loses access immediately; their attribution survives.
- A write over a quota returns `409 quota_exceeded` with usable `details`; a read, a search and an
  export over the same quota all succeed.

## Phase 4 — The web application

Organization screens (the overview, members, Connect an agent, settings); the four product screens; Idea;
Evidence (upload, browse, source page with its summary, text, notes, comments and attachments, search); Exploration (mockups
and assumptions); outcome revision history; Story reading and export; the Activity page; conflict handling. The
design system is Studio ([DESIGN.md](../../apps/web/DESIGN.md)).

*Accept:* a person completes the loop from sign-in to a published Story page with no terminal use;
every filter round-trips through the URL; a two-person edit conflict is surfaced without losing
text; Playwright covers the loop; accessibility checks pass.

## Phase 5 — The agent path

MCP OAuth; the guide and the `guide` tool; the tools version's advertisement; the Connect an agent page;
the stdio transport; `story.guidance` derived from the design system;
feedback capture.

*Accept:* someone who has never seen the product connects Claude Desktop and Claude Code from the
Connect an agent page alone; an agent with only the tool descriptions, `describe` and the guide completes: create source → upload
via grant → read its text → register an assumption → draft and publish a Story page; a token
cannot reach a tenant its person is not in through any tool; a revoked token stops working
immediately; permanent delete over MCP happens only with every guard of
[§9.5](09-data-lifecycle.md).

## Phase 6 — Durability, data rights, and public sign-up

Backup configuration and a **rehearsed restore**; product export (built) and import; organization
export; deleting an organization (built); account deletion, which also removes the person's counted days of
use (built: [§9.5](09-data-lifecycle.md#delete-an-account)); the privacy page and its list of providers (built: `/privacy`);
abuse limits; the operator runbooks
([§9.6](09-data-lifecycle.md); erasure is built); alerts and traces for the Cloud Run deployment (built; an outage
that keeps requests from reaching Cloud Run still mails nobody, and the Azure deployment has
neither: [cloud-run.md](../operations/cloud-run.md#alerts)).

**Running for next to nothing.** A deployment for a few teams should cost only what it stores:
Cloudflare's free plan in front of the service ([cloud-run.md](../operations/cloud-run.md)), one
instance at most, and a free-tier Postgres instead of Cloud SQL. That needs the tests to run on the
Postgres versions such providers offer (18 today: the suite passes against 18 when pointed at one,
as [local-development.md](../operations/local-development.md) describes, but its embedded server and
CI run 17), and, because their restore windows are hours rather than days, a nightly logical backup
(`pg_dump`), which [cloud-run.md](../operations/cloud-run.md) sets up by hand and `setup.sh` does
not create yet. Data the service sends out is the one cost that grows with use, so a daily cap on
bytes served per member belongs with the planned quotas ([§9.2](09-data-lifecycle.md)).

Delete itself is **not** here: it shipped with the objects it destroys, because a product that can
only accumulate is not one people will put real material into. Everything that can be archived can
be deleted, by an admin, and an organization by its owner ([§9.5](09-data-lifecycle.md)).

*Accept:*
- A restore from backup into a scratch environment is **performed**, verified against the nightly
  blob manifest, and written up with its elapsed time.
- An export round-trips into a fresh instance with identical ids, versions, revisions and
  reviews.
- Deleting an organization removes its access and content from the product at once and its files
  from the store after (built), and backups age out within their stated window.
- Sign-up survives an abuse test: scripted sign-ups, oversized uploads, and a write flood are all
  limited without affecting other organizations.
- The privacy page of every deployment that takes sign-ups names who runs it, an address kept for
  privacy requests, and its providers (`WHATBUILD_OPERATOR`, `WHATBUILD_PRIVACY_CONTACT`,
  `WHATBUILD_PROVIDERS`; [§9.1](09-data-lifecycle.md)).
- Whether the dev deployment may keep holding a copy of production, which would then be customers'
  data, is decided again
  ([decision](../decisions/releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)).
- **Public sign-up opens.**

## Phase 7 — Retrieval

Relevance set and semantic/hybrid evaluation on `pgvector` ([§8.7](08-search.md)). Attachments
stay out of search ([decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).

*Accept:* hybrid beats lexical on the measured relevance set — or it is not adopted.

Phases 6 and 7 are independent of each other.

## Proposed — a Story an agent can write well the first time

**Not decided; proposed for discussion.** Each item names something that costs an agent effort, or
lets a defect through, when it writes a Story of many pages over MCP.

| Proposal | What it answers |
|---|---|
| `story.restyle` gives every live page the product's current stylesheet in one call, with each page's etag checked | After `set_style`, `publish { restyle }` is one call per page. |
| Publishing warns, without refusing, about a class the page uses that neither the product's stylesheet nor the page's own styles define | A page written for one style and published under another renders unstyled blocks, and nothing says so. |
| Publishing warns about a list item in `.steps` or `.lines` that does not have the shape the vocabulary gives | A house style once laid a step out as a grid, which broke any step holding a link or bold text. The styles no longer do, and a check would catch the next such fault. |
| The print view turns a link to another Story page that is in the same export into a link within the document | A printed Story's links between its own pages lead back to the app. |
| `story.guidance` names the width the app shows a page at, and the house styles are checked at it | A page is shown at up to 900 pixels. A style's grid that holds three figures at 1,100 pixels may hold two at 900. |
| A page's body is stored apart from its stylesheet | A version would then hold what the author wrote, a style change would need no new versions, and an export would not repeat the stylesheet in every version. It changes what a version is, so it needs a decision first. |

## Planned — Exploration after mockups

**Planned; not built.** Mockups are built
([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)); these follow from them.

| Item | What it answers |
|---|---|
| Drop what the retirement left | Insights and decisions are retired and moved into Evidence ([decision](../decisions/insights-and-decisions-are-retired-into-evidence.md)). The empty `insights` table, the register's `kind` column and the worker's move stay until every deployment has run the move ([§9.8](09-data-lifecycle.md)); a later migration drops them. |
| Structure in a page's design notes | Notes are one Markdown field. Whether they should carry kinds (design, technical, intent) waits until teams have used them. |

## Planned — Hosting the content people upload and agents write

**Planned; not built.** With a content site, every document of people's and agents' HTML and
every file the app shows inline is served from it, under a short-lived address the app's own
route hands off to ([decision](../decisions/with-a-content-site-every-page-and-inline-file-is-served-from-it.md));
uploaded HTML is previewed from a sandboxed route of its own, so the app's policy allows no inline
style. These follow.

| Item | What it answers |
|---|---|
| A document's address ends with its session | A document's address on the content site is checked again when it is used, but outlives a sign-out by up to its lifetime (30 minutes) for whoever holds it. Naming the session in the grant, by an HMAC of its hash under the grant key, would end it with the session ("sign out everywhere" included). |
| Stable addresses for immutable versions | Every load mints a new address, and every document is `no-store`, so a browser keeps nothing between loads. A Story page's or a mockup page's version never changes: an address whose expiry is rounded up, as a prototype's is, with `private, max-age`, would make flipping through the Story faster. |
| Images, audio and video from the content site | They are subresources of the app's pages, not documents, and SVG is never served inline, so they stay on the app's origin. Moving them would need `img-src` and `media-src` to name the content site and a grant for each file. |
| The print view's address | The print view's grant names each page's version, up to 50, so its address is long. Holding the composed document in a short-lived row, as a Story preview is, would shorten it. |

## Planned — Mockups' prototypes, next

**Planned; not built.** A mockup version carries a team's multi-file prototype as it is, served
from a capability path on the app's origin ([§4.12](04-data-model.md#412-mockups),
[decision](../decisions/mockups-carry-prototypes-served-from-a-capability-path.md)). These follow.

| Item | What it answers |
|---|---|
| One subdomain of the content site per view, with `allow-same-origin` | A prototype runs in an opaque origin: no browser storage or cookies, root-relative addresses that point outside it, and nothing a browser caches between its frames. An origin of its own per view (`<id>.usercontent.example.net`) would give it all three while keeping it from the app and from other prototypes. It needs wildcard DNS and a wildcard certificate, which a Cloud Run domain mapping does not take (a load balancer or the Worker would), and a revisited stateless rule. |
| Posters in place of frames at a small zoom | A canvas of many entries loads every one of them in a frame, each fetching every file it uses. Showing a page's poster until the person zooms in, or selects it, would load only what is looked at. |
| The bytes of an unpublished upload, on a product's delete | A publish that failed after storing a prototype's new bytes leaves them under the upload, which the worker removes with the upload a day after its grant expires. A product's delete drops the upload's row first, and those bytes then stay. |
| A PDF a prototype links to | On the app's origin a PDF opens neither in the frame (browsers refuse a PDF in a sandbox) nor in a tab of its own; its scripts can fetch the bytes. On a content site it could open in a tab, served without the sandbox as a source's PDF is. |

## Planned — Undelete

Today a delete is permanent at once: the tombstone keeps who deleted what, when and why, and none
of the content ([§9.5](09-data-lifecycle.md)), so nothing deleted can be put back from the product.
Undelete would be an organization owner's act, for what was deleted in a window counted in days.

What it takes:

- **Keep what a delete removes, for the window, out of every view.** A delete would move the rows
  it removes into a holding table as JSON, ids and all, and keep their bytes; only after the
  window would the rows and the bytes be erased. Nothing that reads content would see the held rows.
- **Put back with the same ids,** so every link that pointed at the object opens again, and the
  tombstone goes. What changed in the meantime decides what can come back:
  a page id used again, or links the delete removed from other assumptions.
- **Say so.** "Permanent. Immediately." would no longer be true inside the window, so the delete
  dialogs, the guide and the privacy page change with it, and a person who needs something gone at
  once still has a way: a delete that skips the window, or the operator's erasure path
  ([§9.6](09-data-lifecycle.md)).
- **Deleting an organization** would hold its content for the same window, its owners able to
  undo it; that is the 7-day window an earlier plan for closing an organization had.

*Accept:* an owner restores a deleted source, assumption, Story page, mockup and product within the
window, and each comes back with its id, the links to it opening and its history; after the window
nothing of it remains but its tombstone.

## The example organization and the free plan

Built, as [§3.3](03-accounts-teams-and-identity.md#33-tenants-and-teams),
[§3.10](03-accounts-teams-and-identity.md#310-the-example-organization) and
[§9.7](09-data-lifecycle.md) specify them
([decision](../decisions/every-account-reads-the-example-organization-which-only-its-staff-write.md),
[decision](../decisions/free-organizations-meet-limits-that-only-instance-owners-change.md)): one
organization named by `WHATBUILD_EXAMPLE_TENANT` that every account reads as its guest and only its
members change; every organization on a plan, the one the deployment names for one made on an allowance
(`WHATBUILD_NEW_ORGANIZATION_PLAN`, free on a deployment open to the public, unlimited unless named) and
unlimited for one an instance owner makes; the public sandbox's limits on how often and how much, moved to the
free plan and met by everyone in a free organization; and only instance owners changing a plan or
a limit. They replace the public sandbox, its visitors, invitation links, seats, baselines and
daily reset.

*Accept* (server tests):
- A guest reads every product of the example organization and every write there is refused with
  `403 example_read_only`, over REST and MCP, changing nothing.
- A guest sees none of its people, and is in no organization's list of members.
- Taking the deployment's setting away takes every guest's access with it.
- An organization made on an allowance gets the deployment's plan, and on the free plan meets
  every limit, its owners included; one an instance owner makes is unlimited; only an instance
  owner changes either.
- Every limit is refused with a usable error through REST, and the same limit through MCP; reads,
  search and export within the limits still work.

Not built yet:

| Gap | Why it matters |
|---|---|
| A cap on what a free organization holds in total | The free plan bounds each day, not the total: an organization within its daily allowances still grows without end, and storage is what a free tier runs out of first ([§9.2](09-data-lifecycle.md)). |
| A paid plan | Paid organizations will have limits too, other than the free plan's. Today an organization is free or unlimited. |
| What admission links do | The public sandbox's invitation links are gone. Whether a link should let a number of people in, or give an allowance, or something else, is undecided; until then an instance owner lets people in one address at a time, and the waiting list is the public site's interest form. |
| A cap on the people let in | Admission is one address at a time, by an instance owner. A deployment that wants a ceiling on accounts, to stay within free tiers if many arrive at once, has none to set. |
| A copy of the example's products into a person's own organization | Someone who wants to try writing on the worked example has to start from nothing in their own organization. It needs product cloning, which is close to import. |
| A test of the limits under real load | The counters are rows per person per minute in Postgres, tested for correctness and not for throughput. |

## Self-hosting on Azure

An organization runs its own copy on Azure Container Apps, with Azure Database for PostgreSQL, Key
Vault and a file share, and signs its people in with Microsoft work accounts. An agent sets it up
with the Azure CLI from [the guide](../operations/azure.md), following the `azure-self-host` skill
([decision](../decisions/self-hosting-on-azure-is-agent-led-and-shares-nothing-with-cloud-run.md)).

Built: the guide, the skill, the container app's definition in `deploy/azure/`, and sign-in with
Microsoft work accounts in one directory ([§3.2](03-accounts-teams-and-identity.md#sign-in-with-microsoft-work-accounts)).
Files go through the filesystem adapter to a mounted share. The guide has been followed once into a
subscription, with the app registration in a different directory from the resources, and corrected
where the Azure CLI and Azure's Postgres differed from it.

Not built yet:

| Gap | Where it is specified | What it touches |
|---|---|---|
| A deployment proved end to end | the guide's last step: a person signs in with a work account, uploads a document whose text is read, and an agent connects over MCP | the guide and the skill, corrected by whoever finds them wrong |
| An Azure Blob Storage adapter | [§2.4](02-architecture.md) | a new adapter file, `config.ts`, `createBlobStore` in `app.ts`, the server's dependencies; then the guide moves from the share to a container, the storage account's key leaves the deployment, and large uploads can go direct |

*Accept:*
- An agent given only the repository and a signed-in Azure CLI brings up a deployment in which a
  person signs in with a work account, uploads a document and reads its text, and an agent
  connects over MCP.
- The same with the app registration in a different directory from the resources.
- A deployment of the Cloud Run service before and after is unchanged.

---

## Open questions

Each has a default so work is not blocked.

| # | Question | Default |
|---|---|---|
| 1 | **npm package and CLI name.** The product name is WhatBuild and what-build.com is registered; the registry entry is not secured. | `what-build`, availability unchecked. Check before anything is published. |
| 2 | **Free-tier numbers** ([§9.2](09-data-lifecycle.md)) — 5 members, 3 products, 300 sources, 1 GB. | As written; tune against real usage and real bills. |
| 3 | **Undelete** — how long deleted content is held before it is erased, who may put it back, and what the privacy page then says ([below](#planned--undelete)). | Not built. An owner's act, over a window counted in days, after which the content is erased as today. |
| 4 | **Restore-drill cadence** ([§9.3](09-data-lifecycle.md)). | A rehearsed restore before public sign-up and quarterly after, as a phase acceptance criterion. |
| 5 | **Activity log retention** ([§4.10](04-data-model.md)). | For the life of the product; events are small and carry no content. Nothing prunes them today. |
| 6 | **Revision scope** ([§4.1](04-data-model.md)) — which objects expose their revisions, and which keep any. | Outcomes today; the product concept, annotations and assumptions while still editable are next. Retained for the life of the object. A source's derived text, summary and notes keep none yet: a write replaces them, though what each attachment was read as stays readable. |
| 7 | **The public sample** — a synthetic discovery readable at `/sample` with no account. | Built from the seed's synthetic content; read-only, with one "copy into my organization" action. The [example organization](#the-example-organization-and-the-free-plan) serves the same purpose for everyone signed in; the sample would serve people who have no account. |
| 8 | **The tenant's name in the UI.** The API and MCP say `tenant` and the UI says "organization". Sources no longer have an `organization` field to collide with ([decision](../decisions/sources-are-described-by-tags.md)), so the wire could say `organization` too, at the cost of renaming a field every caller sends. | As built, until the maintainer wants one word. |
| 9 | **Teams** can be neither archived nor deleted. | Archive a team first (its products with it), then delete it, by an organization admin, with its name typed, as a product. |
| 10 | **How WhatBuild describes Exploration** — the journey's line for it on the overview and the public site, the opening of the README, `AGENTS.md` and the charter, and the guide's first topic. When insights and decisions were retired, each was changed only enough to stop naming them. | As written until the maintainer settles the wording; the tagline stays. |
| 11 | **Shared parts on a mockup canvas** — several people, each with an agent in their own project, publish pages to one canvas. If the projects do not share styles and components, the pages drift apart. | Pages are self-contained outputs, and each version carries files (a DESIGN.md, components, tokens) that collaborators pull into their projects ([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)). Revisit pages drawn from a shared stylesheet and components if collaborators' pages still drift. |
| 12 | **Tags that drift apart** — tags are free text, so one team can end up with `interview`, `interviews` and `customer-interview` ([decision](../decisions/sources-are-described-by-tags.md)). | Agents read `sources.facets` before tagging and the app offers the tags in use. If drift appears anyway, an operation that renames or merges a tag across a product's sources. |
| 13 | **The waitlist.** Requests to hear from us on the public site go to the `interest` table ([decision](../decisions/the-public-site-is-one-page-built-with-the-app.md)), and an operator reads them with a query ([cloud-run.md](../operations/cloud-run.md)). What becomes of them is not decided: whether anyone is told of a new one, how what people wrote is used, and how the announcement reaches them. | Kept as they are: nothing sends mail about a request, and nothing reads the list but an operator's query. |
| 14 | **A deployment's former addresses.** After `WHATBUILD_PUBLIC_URL` moves, a link written with the old address outside the product being read is dead once that address stops reaching the deployment, every connected agent must connect again (its access names the old address), and nothing tells an agent at publish time that a page links to another host ([decision](../decisions/the-app-has-one-address-and-pages-on-other-hosts-move-to-it.md)). | Not built. A list of former addresses (for example `WHATBUILD_FORMER_URLS`) would let the web app and the Story frame open any link on them in place, let tokens issued for them keep working, and let publishing a Story or mockup page warn of links to a host that is not the public URL. |

**Settled**, and where:

- Hosted-only and multi-tenant from the start; one service on Cloud Run
  ([cloud-run.md](../operations/cloud-run.md)).
- Archive is the reversible default; delete is permanent, an admin's through both adapters (and
  an organization's, its owner's in the web app), guarded by `expected_etag` + `reason` +
  `confirm` + a preview ([§9.5](09-data-lifecycle.md),
  [decision](../decisions/archive-by-default-delete-guarded.md)).
- An agent's connection has a level its person chooses, Read only, Edit (the default) or Admin,
  which caps their role and the actions it is offered; only the person changes it
  ([decision](../decisions/an-agent-connection-has-a-level-the-person-chooses.md)).
- Providers: Cloud Run, Cloud Storage, Cloud SQL or any Postgres 15+, any SMTP server; no provider
  SDK outside its adapter ([§2.2](02-architecture.md)).
- Self-hosting on Azure is the same image, set up by an agent with the Azure CLI, sharing nothing
  with the Cloud Run deployment
  ([decision](../decisions/self-hosting-on-azure-is-agent-led-and-shares-nothing-with-cloud-run.md)).
- Authentication is WhatBuild's own: email links, Google, Microsoft work accounts, and its own OAuth 2.1 server for MCP; no
  passwords ([§3.2](03-accounts-teams-and-identity.md), [§3.8](03-accounts-teams-and-identity.md)).
- There are no personal access tokens: agents connect over MCP with OAuth, and REST answers the
  web app's session only ([decision](../decisions/built-in-identity-and-oauth.md)).
- Roles: highest applicable role wins, no negative overrides, editors review and archive, admins
  delete, no separate reviewer or delete role, every role but reader reads the activity log; `403` names the role
  ([§3.5](03-accounts-teams-and-identity.md)).
- Stakeholders who read only the Story get the reader role, not share links: they sign in, and
  the server gives them the Story's live pages, versions and export without the notes agents keep
  on them, and no archived page ([decision](../decisions/a-reader-reads-only-the-story.md)).
- Sources are not shared across products; they are copied or moved
  ([§3.7](03-accounts-teams-and-identity.md)).
- Assumptions freeze at first review; corrections supersede ([§4.8](04-data-model.md)).
- Evidence is found by searching, not kept as citations: nothing structural points from an
  assumption, a Story page or a mockup to a source, and a Story page quotes, paraphrases or links
  what is in the product however suits its readers, with no rule about any of it
  ([decision](../decisions/evidence-is-searched-not-cited.md)).
- Sources are described by a title and tags, with no kinds, folders or organization field
  ([decision](../decisions/sources-are-described-by-tags.md)).
- A source's words are one derived text, taken from an attachment until someone writes it;
  attachments are read and kept, never searched, and search reads a source's title, tags,
  summary, derived text, notes and comments
  ([decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
- A human review relayed by an agent is allowed and recorded as declared
  ([§3.9](03-accounts-teams-and-identity.md)).
- Telemetry is operational only ([§9.1](09-data-lifecycle.md)).
- The design system is Studio ([DESIGN.md](../../apps/web/DESIGN.md)); Story pages follow the product's own
  Story style, never the app's look
  ([decision](../decisions/story-pages-follow-the-teams-design-system.md)).

## Risks

| Risk | Mitigation |
|---|---|
| **We are a custodian.** Other people's research on rented infrastructure. | Small limits, plain words at sign-in, complete export, a rehearsed restore, and asking people not to send anything we would be sorry to lose. |
| **Hosting costs move.** A free tier changes or disappears. | Plain Postgres, a Postgres queue, the object store behind a port, no provider SDK outside its adapter — moving is a redeploy, not a rewrite. The service scales to zero when idle. |
| **Sign-up is an attack surface.** Abuse, spam accounts, storage burned by strangers. | Invite-only until the Phase 6 abuse limits exist; sign-in link limits, bounded request bodies on sign-in and OAuth, and a limit on agent registrations today; only accounts an instance owner gives an allowance create organizations; per-member write limits, small caps and an operator usage view before public sign-up. |
| **No zero-install demo.** A stranger cannot touch the product without being let in. | Every account reads the [example organization](#the-example-organization-and-the-free-plan), but an account needs an instance owner's allowance while sign-up is limited; the planned public read-only sample would ask for nothing. |
| **Free organizations cost money.** Anyone let in can create an organization and fill it. | The free plan's limits bound what each person and each organization adds a day; only instance owners let people in and raise a limit. Nothing yet caps an organization's total. |
| **Contributor setup rot.** A local environment nobody runs stops working. | CI uses the same path a contributor does, so a broken `pnpm dev` breaks the build. |
| **Public-repo hygiene.** Agents write most commits, and history keeps whatever slips in. | Sample content fully synthetic; git hooks and CI refuse secrets, local paths, real addresses, session talk and stray files; private notes have an ignored place, `_private/`; everything GitHub holds is audited before the repository goes public ([security checks](../operations/security-checks.md)). |
| **Known vulnerabilities.** A dependency, a workflow or the app's headers turn out to be exploitable. | Pinned scanners on every pull request and weekly, Dependabot security updates, a weekly ZAP scan, CodeQL once public; the [threat model](../system/security.md) names each control. |

## Seen, not yet explained

Problems seen in use that could not be reproduced, with what is known, so whoever meets one again
can look further.

| What was seen | What is known |
|---|---|
| `assumptions_read(action="list")` without filters twice showed, for three assumptions, other outcomes (`outcome_ids`) than `assumptions_read(action="get")`, a list filtered by outcome and a later list showed, with the same etags and no activity in between. | `list` and `get` read `outcome_ids` from the same column of each assumption's own row, in one query each, with no cache, join or reordering between (`packages/core/src/ops/registers.ts`), and the MCP adapter adds only `scope`. It could not be reproduced. To rule out on the reading side: outcome ids made close together share most of their 26 characters, and a list without filters carries many of them. |
