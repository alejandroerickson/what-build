---
type: Roadmap
title: Phases 0 to 5 are mostly built, and a public sandbox; durability, data rights and public sign-up come next.
description: What is built and what is not, phase by phase, with acceptance criteria; the open questions that remain, the ones already settled, and the risks.
tags: [roadmap, status, phases, open-questions, risks]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# 10. Roadmap

The ethos: the smallest implementation that proves the full path wins. Each phase ends in
something demonstrable, and each acceptance list is a test plan.

## Status on 2026-10-10

Observed in the code on this date.

| Phase | State | Built | Not built yet |
|---|---|---|---|
| 0 | Mostly done | pnpm workspace, strict TypeScript, `pnpm dev` with **no Docker** (embedded Postgres), forward-only migrations, seed, `pnpm test` (parsers, server against real Postgres, web), GitHub Actions CI (documentation bundle check, install, skill drift check, typecheck, test, build); the [security checks](../operations/security-checks.md): git hooks and a CI job that refuse private material, `pnpm security` (osv-scanner, zizmor) on every pull request and weekly, a weekly OWASP ZAP scan, Dependabot, CodeQL once public, and a security policy; `pnpm attention` at the start of an agent session; [agent-driven end-to-end tests](../operations/end-to-end-tests.md) that follow written plans through the web app and the MCP server on an instance reset to a golden master built from production's public sandbox | contribution guide, code of conduct; lint and format config |
| 1 | Done | registry → REST and MCP (108 operations, 16 tools); row-level security in the first migration; ETags; paging; `describe`; activity in the same transaction; the isolation test over every operation; the parity test | — |
| 2 | Mostly done | upload grants (relay, optional direct signed URLs); parsers for plain text, Markdown, VTT, SRT, HTML, DOCX, legacy Word `.doc`, PDF, XLSX, CSV and TSV; derivation on the Postgres queue, each file parsed in a thread of its own held to a memory and a time limit; hostile-file tests; sources described by a title and tags, with `sources.facets` (the tags in use and who added sources); passages by segment and time; substring and ranked search with coverage; archive and restore; guarded delete of sources with tombstones; a synthetic sample product in the seed | usage metering; golden-file tests per format; a blob-store conformance suite (no test exercises the Cloud Storage adapter), then `@google-cloud/storage` 8, which retires the uuid advisory accepted in `.github/osv-scanner.toml`; a fast-saved Word 6 or Word 95 `.doc`, and Word 6 tables beyond what cell marks show; the parse limits measured on the deployment's own Linux under its memory limit; a budget of parse time per sandbox visitor or organization |
| 3 | Mostly done | tenants, teams, products, roles; email-link, Google, Microsoft work-account and development sign-in; invitations by email and link; the Story-only reader role; invite-only mode; who may create organizations (instance owners, and allowances they give); sign-in link rate limit; the [public sandbox](#the-public-sandbox) with its invitations, seats, visitor role and limits | quotas and rate limits for every organization (they exist for visitors to the sandbox, and for Story pages and mockups); account deletion |
| 4 | Mostly done | the design system (Studio, [DESIGN.md](../../DESIGN.md)) across every screen of the loop: Idea, Evidence (browse by tag, by who added and when, and search passages or titles from the panel; intake that asks for a title and tags; the source page with sections and inspector, passage reader, notes, files, search), Exploration (mockups on a full-width canvas that pans and zooms, with a page's notes, the brief, versions and download in the inspector, and a page promoted to the Story from there; assumptions with review, confidence and citation checks; old Synthesis, insight and decision links redirect), outcome revision history, Story (a read-only reader with the page tree, the published mockups to flip through with the arrow keys, crumbs, focus mode, the inspector with versions, citations and notes for agents, the Story style with house-style previews, the print view for PDF, the page following the app's theme), Activity as one log for people and agents, organization members, product people, Connect an agent, the person's settings, the cookie choice and `/cookies` | an accessibility audit; a browser walk-through of the loop in CI (`scripts/e2e.mjs` is one, run by hand; the [end-to-end plans](../operations/end-to-end-tests.md) are run by an agent on request); the public sample at `/sample` |
| 5 | Mostly done | OAuth 2.1 for MCP, MCP connectors scoped to one organization or one product that refuse anything outside them, the versioned skill, `get_skill` and the version in the server instructions, the Connect an agent page, feedback, the product's Story style (the team's design system or a house style), Story guidance with taste, anti-patterns and design passes, a vocabulary and compositions for plans and front pages, and publishing a page from its body | the stdio transport |
| 6 | Started | the Cloud Run deployment ([cloud-run.md](../operations/cloud-run.md)) and the Cloud Build file, run by a trigger on release tags that waits for approval ([decision](../decisions/production-runs-releases-after-approval.md)); releases as tags that publish the image to the GitHub container registry ([decision](../decisions/releases-are-tags-with-a-published-image.md)); product export (`products.export`); a sandbox's baseline and reset; the public site with its interest form, served from Cloudflare's edge or by host; the service capped at one instance; running on a free-tier Postgres (the suite passes against 18) with a nightly logical backup to a bucket, set up by hand, and its runbook ([backups.md](../operations/backups.md)); a dev deployment holding a copy of production, where a release that migrates is rehearsed before production moves ([dev-deployment.md](../operations/dev-deployment.md)); instructions for an agent to self-host on Azure ([below](#self-hosting-on-azure)) | a rehearsed restore; import; organization export; `setup.sh` creating the Cloud Build trigger (made by hand, so a deployment without one deploys nothing on a release); closing an organization; the sub-processors page; abuse tests beyond hostile uploads and isolation; limits per client address, once the Worker passes the client's address in a header the service can trust (until then the limit on agent registrations is shared by the whole deployment); mail to the operator when someone asks to hear from us; Postgres 18 in CI and the embedded test server; `setup.sh` creating the nightly backup; a cap on bytes served per member a day |

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

Upload grants; parsers and sidecars; derivations on the queue; `read_passage` by seq and by ms;
Postgres full-text and substring search; archive, restore, `delete_impact` and `delete` with
tombstones; usage metering; the blob conformance suite; the synthetic sample product.

*Accept:*
- A representative VTT transcript yields exact cue times, speakers, and code-point offsets,
  verified against `text.md` — including a non-BMP character.
- Golden files for each format; each manifest status reachable by a test fixture.
- Out-of-range and over-size passage windows behave per [§5.4](05-derived-layer.md).
- Upload → derive → search → passage read works end to end through REST and through MCP.
- An archived source leaves search — including through MCP — and returns unchanged on restore.
- A deleted source frees its bytes, returns `410` with its tombstone, and leaves citations
  reporting `record_deleted` with their snapshot text intact. `delete` without `confirm`, with a
  stale `expected_etag`, or without a reason is refused.
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
Evidence (upload, browse, source page, passage reader, annotations, search); Exploration (mockups
and assumptions); outcome revision history; Story reading and export; the Activity page; conflict handling. The
design system is Studio ([DESIGN.md](../../DESIGN.md)).

*Accept:* a person completes the loop from sign-in to a published Story page with no terminal use;
every filter round-trips through the URL; a two-person edit conflict is surfaced without losing
text; Playwright covers the loop; accessibility checks pass.

## Phase 5 — The agent path

MCP OAuth; the product skill; `get_skill` and version advertisement; the Connect an agent page;
the stdio transport; `story.guidance` derived from the design system;
feedback capture.

*Accept:* someone who has never seen the product connects Claude Desktop and Claude Code from the
Connect an agent page alone; an agent with only the skill and `describe` completes: create source → upload
via grant → read passages → register a cited assumption → draft and publish a Story page; a token
cannot reach a tenant its person is not in through any tool; a revoked token stops working
immediately; permanent delete over MCP happens only with every guard of
[§9.5](09-data-lifecycle.md).

## Phase 6 — Durability, data rights, and public sign-up

Backup configuration and a **rehearsed restore**; product export (built) and import; organization
export; closing an organization; account deletion; the sub-processors page; abuse limits; the
operator runbooks ([§9.6](09-data-lifecycle.md)).

**Running for next to nothing.** A deployment for a few teams should cost only what it stores:
Cloudflare's free plan in front of the service ([cloud-run.md](../operations/cloud-run.md)), one
instance at most, and a free-tier Postgres instead of Cloud SQL. That needs the tests to run on the
Postgres versions such providers offer (18 today: the suite passes against 18 when pointed at one,
as [local-development.md](../operations/local-development.md) describes, but its embedded server and
CI run 17), and, because their restore windows are hours rather than days, a nightly logical backup
(`pg_dump`), which [cloud-run.md](../operations/cloud-run.md) sets up by hand and `setup.sh` does
not create yet. Data the service sends out is the one cost that grows with use, so a daily cap on
bytes served per member belongs with the planned quotas ([§9.2](09-data-lifecycle.md)).

Delete itself is **not** here: it ships with the objects it destroys, because a product that can
only accumulate is not one people will put real material into.

*Accept:*
- A restore from backup into a scratch environment is **performed**, verified against the nightly
  blob manifest, and written up with its elapsed time.
- An export round-trips into a fresh instance with identical ids, citations, revisions and
  `check_citations` results.
- Closing an organization revokes access immediately and removes content within the stated window.
- Sign-up survives an abuse test: scripted sign-ups, oversized uploads, and a write flood are all
  limited without affecting other organizations.
- Whether the dev deployment may keep holding a copy of production, which would then be customers'
  data, is decided again
  ([decision](../decisions/releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)).
- **Public sign-up opens.**

## Phase 7 — Retrieval

In the order evidence supports: relevance set and semantic/hybrid evaluation on `pgvector`;
dimension registry; tiered attachment search; approximate relocation; recursive lineage
([§8](08-search.md)).

*Accept:* hybrid beats lexical on the measured relevance set — or it is not adopted.

## Phase 8 — A paid plan (deferred)

Billing, higher limits, and whatever the free tier turns out to be teaching us. ◆ Decision:
explicitly **not scheduled**. No billing code is written before it; the `plan` field and the
`owner` role are the only anticipation.

Phases 6 and 7 are independent of each other.

## Proposed — a Story an agent can write well the first time

**Not decided; proposed for discussion.** Each item names something that costs an agent effort, or
lets a defect through, when it writes a Story of many pages over MCP.

| Proposal | What it answers |
|---|---|
| `story.publish` answers with counts (`refs`, `citations`) and no resolved titles or snapshots unless `verbose` is passed | The result of publishing a page with 17 references and 10 citations is several times longer than the page's body. An agent that publishes ten pages reads all of it. |
| `story.restyle` gives every live page the product's current stylesheet in one call, with each page's etag checked | After `set_style`, `publish { restyle }` is one call per page. |
| Publishing warns, without refusing, about a class the page uses that neither the product's stylesheet nor the page's own styles define | A page written for one style and published under another renders unstyled blocks, and nothing says so. |
| Publishing warns about a list item in `.steps` or `.lines` that does not have the shape the vocabulary gives | A house style once laid a step out as a grid, which broke any step holding a link or bold text. The styles no longer do, and a check would catch the next such fault. |
| A source may carry a quoting rule in its metadata (for example "by role only"), and `story.guidance` lists the rules in force in the product | An agreement that limits naming an organisation is one source among many. An agent finds it only by reading it, and a Story is what is read outside the team. |
| The print view turns a link to another Story page that is in the same export into a link within the document | A printed Story's links between its own pages lead back to the app. |
| `story.guidance` names the width the app shows a page at, and the house styles are checked at it | A page is shown at up to 900 pixels. A style's grid that holds three figures at 1,100 pixels may hold two at 900. |
| A page's body is stored apart from its stylesheet | A version would then hold what the author wrote, a style change would need no new versions, and an export would not repeat the stylesheet in every version. It changes what a version is, so it needs a decision first. |

## Planned — Exploration after mockups

**Planned; not built.** Mockups are built
([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)); these follow from them.

| Item | What it answers |
|---|---|
| Drop what the retirement left | Insights and decisions are retired and moved into Evidence ([decision](../decisions/insights-and-decisions-are-retired-into-evidence.md)). The empty `insights` table, the register's `kind` column and the worker's move stay until every deployment has run the move ([§9.8](09-data-lifecycle.md)); a later migration drops them, once no kept sandbox baseline holds an insight or a decision. |
| Structure in a page's design notes | Notes are one Markdown field. Whether they should carry kinds (design, technical, intent) waits until teams have used them. |

## Planned — Hosting the content people upload and agents write

**Planned; not built.** These keep HTML and files that WhatBuild serves away from the app, and come
from the [security checks](../operations/security-checks.md).

| Item | What it answers |
|---|---|
| Uploaded HTML previewed from a sandboxed route | The uploaded-HTML preview inherits the app's content security policy, so the app keeps `style-src 'unsafe-inline'` for it. Serving the preview from its own sandboxed route, as Story pages are, would let the app's policy drop it, and the ZAP rule for directives without a fallback (10055) become a failure. |
| Story and mockup HTML, and uploaded files, from a separate origin | The sandbox gives each page an opaque origin and no network. Serving page HTML from its own origin through short-lived signed addresses would keep a page that escaped the sandbox away from the app's origin too, and would let PDFs, which browsers will not render sandboxed, open away from it as well. It needs a second host name and a domain mapping. |

## The public sandbox

Built, as [§3.10](03-accounts-teams-and-identity.md) and [§9.7](09-data-lifecycle.md) specify it
([decision](../decisions/the-public-sandbox-is-one-organization-with-pseudonymous-visitors.md)):
one organization named by `WHATBUILD_SANDBOX_TENANT`; invitation links with places, under a cap
on seats; visitors who edit under made-up names, see nobody and administer nothing; limits on how
often and how much, in one layer for REST and MCP, shown and changed in one control panel; a
baseline of the organization's content; and a reset every day at an hour and time zone the
sandbox's staff set.

*Accepted, each by a test in `apps/server/test/public-sandbox.test.ts`:*
- A stranger signs up on an invitation alone in invite-only mode, and their account cannot create
  an organization.
- A visitor's name and address appear in no response to another visitor and in no row of the
  organization.
- Every limit is refused with a usable error through REST, and the same limit through MCP; reads,
  search and export within the limits still work.
- After a reset the organization equals its baseline row for row, and no other organization's rows
  or blobs have changed.
- Taking the deployment's setting away takes every visitor's access with it.

Not built yet:

| Gap | Why it matters |
|---|---|
| A baseline that can leave the database: a file that another deployment can load | A baseline is safe only as far as the database's own backups are. It waits on import ([Phase 6](#phase-6--durability-data-rights-and-public-sign-up)). |
| A limit on accounts created from one network address | An invitation with many places lets one person take several, each with its own address and allowances. Seats cap the total. |
| A waiting list when the sandbox is full | Someone who arrives at a full sandbox is told to come back later, and nobody learns that they came. |
| Staff under a made-up name | Staff write under their own names, which every visitor sees, in the baseline too. |
| Moderation: a way for a visitor to report what another added | Staff can archive, remove a visitor, close the sandbox or reset it, but must notice first. |
| A private copy of a product for each visitor | One visitor can archive or rewrite what the next came to see, within the limits and until the next reset. It needs product cloning, which is close to import. |
| A test of the limits under real load | The counters are one row per visitor per minute in Postgres, tested for correctness and not for throughput. |

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
| A deployment proved end to end | the guide's last step: a person signs in with a work account, uploads a document that parses, and an agent connects over MCP | the guide and the skill, corrected by whoever finds them wrong |
| An Azure Blob Storage adapter | [§2.4](02-architecture.md) | a new adapter file, `config.ts`, `createBlobStore` in `app.ts`, the server's dependencies; then the guide moves from the share to a container, the storage account's key leaves the deployment, and large uploads can go direct |
| A reset on the hour for a public sandbox on Azure | not specified | the guide; a scheduled Container Apps job calling `POST /api/v1/sandbox/reset-if-due`, as Cloud Scheduler does on Cloud Run |

*Accept:*
- An agent given only the repository and a signed-in Azure CLI brings up a deployment in which a
  person signs in with a work account, uploads a document and reads its passages, and an agent
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
| 3 | **Closing an organization** — content leaves live systems within 7 days, backups within 35. | As written; the 7-day window is deliberate room to reverse a mistake. |
| 4 | **Restore-drill cadence** ([§9.3](09-data-lifecycle.md)). | A rehearsed restore before public sign-up and quarterly after, as a phase acceptance criterion. |
| 5 | **Activity log retention** ([§4.10](04-data-model.md)). | For the life of the product; events are small and carry no content. Nothing prunes them today. |
| 6 | **Revision scope** ([§4.1](04-data-model.md)) — which objects expose their revisions. | Outcomes today; the product concept, annotations and assumptions while still editable are next. Retained for the life of the object. |
| 7 | **The public sample** — a synthetic discovery readable at `/sample` with no account. | Built from the seed's synthetic content; read-only, with one "copy into my organization" action. The [public sandbox](#the-public-sandbox) serves the same purpose for anyone holding an invitation; the sample would serve people who have none. |
| 8 | **The tenant's name in the UI.** The API and MCP say `tenant` and the UI says "organization". Sources no longer have an `organization` field to collide with ([decision](../decisions/sources-are-described-by-tags.md)), so the wire could say `organization` too, at the cost of renaming a field every caller sends. | As built, until the maintainer wants one word. |
| 9 | **Delete beyond sources** — assumptions, annotations, Story pages, mockups, outcomes, products. | The same guards and tombstones as sources; an assumption's delete is also how a citation snapshot is removed. |
| 10 | **How WhatBuild describes Exploration** — the journey's line for it on the overview and the public site, the opening of the README, `AGENTS.md` and the charter, and the skill's description. When insights and decisions were retired, each was changed only enough to stop naming them. | As written until the maintainer settles the wording; the tagline stays. |
| 11 | **Shared parts on a mockup canvas** — several people, each with an agent in their own project, publish pages to one canvas. If the projects do not share styles and components, the pages drift apart. | Pages are self-contained outputs, and each version carries files (a DESIGN.md, components, tokens) that collaborators pull into their projects ([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)). Revisit pages drawn from a shared stylesheet and components if collaborators' pages still drift. |
| 12 | **Tags that drift apart** — tags are free text, so one team can end up with `interview`, `interviews` and `customer-interview` ([decision](../decisions/sources-are-described-by-tags.md)). | Agents read `sources.facets` before tagging and the app offers the tags in use. If drift appears anyway, an operation that renames or merges a tag across a product's sources. |

**Settled**, and where:

- Hosted-only and multi-tenant from the start; one service on Cloud Run
  ([cloud-run.md](../operations/cloud-run.md)).
- Archive is the reversible default; delete is permanent, available to editors through both
  adapters, guarded by `expected_etag` + `reason` + `confirm` + a `delete_impact` preview, and
  citation snapshots survive it ([§9.5](09-data-lifecycle.md)).
- Providers: Cloud Run, Cloud Storage, Cloud SQL or any Postgres 15+, any SMTP server; no provider
  SDK outside its adapter ([§2.2](02-architecture.md)).
- Self-hosting on Azure is the same image, set up by an agent with the Azure CLI, sharing nothing
  with the Cloud Run deployment
  ([decision](../decisions/self-hosting-on-azure-is-agent-led-and-shares-nothing-with-cloud-run.md)).
- Authentication is WhatBuild's own: email links, Google, Microsoft work accounts, and its own OAuth 2.1 server for MCP; no
  passwords ([§3.2](03-accounts-teams-and-identity.md), [§3.8](03-accounts-teams-and-identity.md)).
- There are no personal access tokens: agents connect over MCP with OAuth, and REST answers the
  web app's session only ([decision](../decisions/built-in-identity-and-oauth.md)).
- Roles: highest applicable role wins, no negative overrides, editors review and delete, no
  separate reviewer role, every role but reader reads the activity log; `403` names the role
  ([§3.5](03-accounts-teams-and-identity.md)).
- Stakeholders who read only the Story get the reader role, not share links: they sign in, and
  the server gives them the Story's pages, versions and export without what the pages draw on
  ([decision](../decisions/a-reader-reads-only-the-story.md)).
- Sources are not shared across products; they are copied or moved
  ([§3.7](03-accounts-teams-and-identity.md)).
- Assumptions freeze at first review; corrections supersede ([§4.8](04-data-model.md)).
- Sources are described by a title and tags, with no kinds, folders or organization field
  ([decision](../decisions/sources-are-described-by-tags.md)).
- A human review relayed by an agent is allowed and recorded as declared
  ([§3.9](03-accounts-teams-and-identity.md)).
- Telemetry is operational only ([§9.1](09-data-lifecycle.md)).
- The design system is Studio ([DESIGN.md](../../DESIGN.md)); Story pages follow the product's own
  Story style, never the app's look
  ([decision](../decisions/story-pages-follow-the-teams-design-system.md)).

## Risks

| Risk | Mitigation |
|---|---|
| **We are a custodian.** Other people's research on rented infrastructure with no revenue. | Small limits, plain words at sign-in, complete export, a rehearsed restore, and asking people not to send anything we would be sorry to lose. |
| **Hosting costs move.** A free tier changes or disappears. | Plain Postgres, a Postgres queue, the object store behind a port, no provider SDK outside its adapter — moving is a redeploy, not a rewrite. The service scales to zero when idle. |
| **Sign-up is an attack surface.** Abuse, spam accounts, storage burned by strangers. | Invite-only until the Phase 6 abuse limits exist; sign-in link limits, bounded request bodies on sign-in and OAuth, and a limit on agent registrations today; only accounts an instance owner gives an allowance create organizations; per-member write limits, small caps and an operator usage view before public sign-up. |
| **No zero-install demo.** A stranger cannot touch the product without an email address. | The [public sandbox](#the-public-sandbox) admits anyone holding an invitation, and still asks for an address to sign in with; the planned public read-only sample would ask for none. |
| **The sandbox is public.** Strangers write into a shared place, and may add what is unlawful, private or hostile. | Invitations and seats bound who enters; limits bound how much; uploads are limited to documents, under 5 MB; everything is erased every day; staff can set visitors to reading only, close the sandbox, remove a visitor, or reset at once. No one reviews what is added before others see it. |
| **Contributor setup rot.** A local environment nobody runs stops working. | CI uses the same path a contributor does, so a broken `pnpm dev` breaks the build. |
| **Public-repo hygiene.** Agents write most commits, and history keeps whatever slips in. | Sample content fully synthetic; git hooks and CI refuse secrets, local paths, real addresses, session talk and stray files; private notes have an ignored place, `_private/`; everything GitHub holds is audited before the repository goes public ([security checks](../operations/security-checks.md)). |
| **Known vulnerabilities.** A dependency, a workflow or the app's headers turn out to be exploitable. | Pinned scanners on every pull request and weekly, Dependabot security updates, a weekly ZAP scan, CodeQL once public; the [threat model](../system/security.md) names each control. |
