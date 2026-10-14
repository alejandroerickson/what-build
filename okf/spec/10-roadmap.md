---
type: Roadmap
title: Phases 0 to 5 are mostly built, and a public sandbox; durability, data rights and public sign-up come next.
description: What is built and what is not, phase by phase, with acceptance criteria; the open questions that remain, the ones already settled, and the risks.
tags: [roadmap, status, phases, open-questions, risks]
generated: {by: agent:claude, at: 2026-10-14}
status: stable
---

# 10. Roadmap

The ethos: the smallest implementation that proves the full path wins. Each phase ends in
something demonstrable, and each acceptance list is a test plan.

## Status on 2026-10-14

Observed in the code on this date.

| Phase | State | Built | Not built yet |
|---|---|---|---|
| 0 | Mostly done | pnpm workspace, strict TypeScript, `pnpm dev` with **no Docker** (embedded Postgres), forward-only migrations, seed, `pnpm test` (parsers, server against real Postgres, web), GitHub Actions CI (documentation bundle check, install, skill drift check, typecheck, test, build); the [security checks](../operations/security-checks.md): git hooks and a CI job that refuse private material, `pnpm security` (osv-scanner, zizmor) on every pull request and weekly, a weekly OWASP ZAP scan, Dependabot, CodeQL once public, and a security policy; `pnpm attention` at the start of an agent session; [agent-driven end-to-end tests](../operations/end-to-end-tests.md) that follow written plans through the web app and the MCP server on an instance reset to a golden master built from production's public sandbox | contribution guide, code of conduct; lint and format config |
| 1 | Done | registry → REST and MCP (128 operations, 126 of them offered to agents; 16 tools); row-level security in the first migration; ETags; paging; `describe`; activity in the same transaction; the isolation test over every operation; the parity test | — |
| 2 | Mostly done | upload grants (relay, optional direct signed URLs); parsers for plain text, Markdown, VTT, SRT, HTML, DOCX, legacy Word `.doc`, PDF, XLSX, CSV and TSV; derivation on the Postgres queue, each file parsed in a thread of its own held to a memory and a time limit; hostile-file tests; sources described by a title and tags, with `sources.facets` (the tags in use and who added sources); passages by segment and time; substring and ranked search with coverage, and plain search over everything in a product; archive and restore; guarded delete, for admins, of sources, comments, assumptions, outcomes, Story pages, mockups and whole products, with tombstones; a synthetic sample product in the seed | usage metering; golden-file tests per format; a blob-store conformance suite (no test exercises the Cloud Storage adapter), then `@google-cloud/storage` 8, which retires the uuid advisory accepted in `.github/osv-scanner.toml`; a fast-saved Word 6 or Word 95 `.doc`, and Word 6 tables beyond what cell marks show; the parse limits measured on the deployment's own Linux under its memory limit; a budget of parse time per sandbox visitor or organization |
| 3 | Mostly done | tenants, teams, products, roles; email-link, Google, Microsoft work-account and development sign-in; invitations by email and link; the Story-only reader role; invite-only mode; who may create organizations (instance owners, and allowances they give); sign-in link rate limit; the [public sandbox](#the-public-sandbox) with its invitations, seats, visitor role and limits; deleting an organization (its owners, in the web app) | quotas and rate limits for every organization (they exist for visitors to the sandbox, and for Story pages and mockups); account deletion; archiving and deleting a team; an invitation that is still made, with its link to pass on, when its email cannot be sent (a failed send now fails the invitation) |
| 4 | Mostly done | the design system (Studio, [DESIGN.md](../../DESIGN.md)) across every screen of the loop: Idea, search over the whole product (the ⌘K palette with recent searches, and the Search screen by area); Evidence (browse by tag and by who added; intake that asks for a title and tags; the source page with sections and inspector, passage reader, notes, files, search), Exploration (mockups on a full-width canvas that pans and zooms, with a page's notes, the brief, versions and download in the inspector, and a page promoted to the Story from there; assumptions with review, confidence and citation checks; old Synthesis, insight and decision links redirect), outcome revision history, Story (a read-only reader with the page tree, the published mockups to flip through with the arrow keys, crumbs, focus mode, the inspector with versions, citations and notes for agents, the Story style with house-style previews, the print view for PDF, the page following the app's theme), Activity as one log for people and agents, organization members, product people, Connect an agent, the person's settings, the cookie choice and `/cookies` | an accessibility audit; on a touch screen, pinching or dragging the mockup canvas from a page in interact mode (the page keeps the touch); a browser walk-through of the loop in CI (`scripts/e2e.mjs` is one, run by hand; the [end-to-end plans](../operations/end-to-end-tests.md) are run by an agent on request); the public sample at `/sample` |
| 5 | Mostly done | OAuth 2.1 for MCP, MCP connectors scoped to one organization or one product that refuse anything outside them, a level on each agent connection (Read only, Edit or Admin) that caps what it may do and the actions it is offered, the versioned skill, `get_skill` and the version in the server instructions, the Connect an agent page, feedback, the product's Story style (the team's design system or a house style), Story guidance with taste, anti-patterns and design passes, a vocabulary and compositions for plans and front pages, publishing a page from its body, and previewing a publish to look at the exact page first | the stdio transport |
| 6 | Started | the Cloud Run deployment ([cloud-run.md](../operations/cloud-run.md)) and the Cloud Build file, run by a trigger on release tags that waits for approval ([decision](../decisions/production-runs-releases-after-approval.md)); releases as tags that publish the image to the GitHub container registry ([decision](../decisions/releases-are-tags-with-a-published-image.md)); product export (`products.export`); a sandbox's baseline and reset; the public site with its interest form, served from Cloudflare's edge or by host; the service capped at one instance; running on a free-tier Postgres (the suite passes against 18) with a nightly logical backup to a bucket, set up by hand, and its runbook ([backups.md](../operations/backups.md)); a dev deployment holding a copy of production, where a release that migrates is rehearsed before production moves ([dev-deployment.md](../operations/dev-deployment.md)); copies of production that hold only the public sandbox or the organizations named, for the local copy, the golden master, the dev deployment or another deployment's new database ([copying-an-organization.md](../operations/copying-an-organization.md)); production's mail, sent through Cloudflare Email Sending ([mail.md](../operations/mail.md)); instructions for an agent to self-host on Azure ([below](#self-hosting-on-azure)) | a rehearsed restore; import; organization export; adding a copied organization to a database that already holds others, matching its people to accounts there by address; `setup.sh` creating the Cloud Build trigger (made by hand, so a deployment without one deploys nothing on a release); [undelete](#planned--undelete); the sub-processors page; abuse tests beyond hostile uploads and isolation; limits per client address, once the Worker passes the client's address in a header the service can trust (until then the limit on agent registrations is shared by the whole deployment); Postgres 18 in CI and the embedded test server; `setup.sh` creating the nightly backup; a cap on bytes served per member a day |

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
export; deleting an organization (built); account deletion, which also removes the person's counted days of
use ([§9.1](09-data-lifecycle.md)); the privacy page and its list of providers (built: `/privacy`);
abuse limits; the operator runbooks
([§9.6](09-data-lifecycle.md)).

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
- An export round-trips into a fresh instance with identical ids, citations, revisions and
  `check_citations` results.
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
| Story and mockup HTML, and uploaded files, from a separate origin | The sandbox gives each page an opaque origin and no network. Serving page HTML from its own origin through short-lived signed addresses would keep a page that escaped the sandbox away from the app's origin too, and would let PDFs, which browsers will not render sandboxed, open away from it as well. It needs a second host name and a domain mapping. A mockup's prototype bundle would move there by a setting ([below](#planned--prototype-bundles-in-mockups)). |

## Planned — Prototype bundles in mockups

**Planned; not built.** A mockup version may carry a team's prototype as it is, and canvas pages
enter it ([draft decision](../decisions/mockups-carry-prototype-bundles-served-from-a-capability-path.md)).
What follows is the design the build starts from; [§4.12](04-data-model.md#412-mockups) and
[§7.7](07-web-app.md#77-exploration) take it over once built.

**Data.** One forward-only migration, after any the mockup HTML rules add:

- `mockup_pages.entry` and `mockup_pages.poster` (text, null); `html` becomes nullable, and a check
  holds that a page has exactly one of `html` and `entry`.
- `mockup_bundle_files (version_id, tenant_id, product_id, path, size, sha256, media_type,
  blob_key)`, keyed by `(version_id, path)`, with the row-level security policy and an index on
  `(tenant_id, blob_key)`. A version's bundle is its rows; carrying it forward copies rows.
- Blobs at `t/<tenant>/p/<product>/mockup-bundles/<upload_id>/<sha256>`, through the blob port
  (Cloud Storage, or the filesystem adapter on a disk or the Azure file share). A file whose hash a
  file of the base version has takes that file's key and stores nothing, so every blob belongs to
  one mockup and goes with it. Keys hold ids and hashes only, never a bundle's paths.

**Upload.** The canvas ZIP gains `bundle/<path>`; manifest format version 2, and version 1 still
reads. A manifest page may give `entry` (a bundle HTML path, then `?query` and `#fragment` if
wanted, at most 500 characters past the path) and `poster` (a bundle image). A `bundle` list in
the manifest, `[{path, sha256?}]`, is the whole set, a listed path missing from `bundle/` keeping
the base's bytes (and its hash, if given, must match); without a list, the files under `bundle/`
are the whole set; with neither, the base's bundle carries forward; `"bundle": []` drops it. An
entry must name an HTML file of the version's bundle. Paths are relative and `/`-separated,
normalised to NFC (a macOS ZIP's names arrive decomposed), at most 400 characters and 16 folders
deep, with no empty, `.` or `..` part and none of `\ : * ? " < > |` or a control character; two
paths equal without case, or once normalised, are refused. The archive must name each entry once
(today the last of two wins), hold no symbolic link and no encrypted entry, and use stored or
deflated entries. It is read one entry at a time and each written to the store as it comes, within
the unpacked budget, so memory holds the ZIP and one entry. Publish answers with `bundle_warnings`:
root-relative and remote addresses in HTML and CSS, which will not load. The download has the same
layout, its manifest listing each bundle file's size, hash and type, and uploading it again stores
nothing new.

**Limits**, first guesses against a 1 GiB instance: 2,000 files and 64 MB in a bundle, 25 MB a
file, 96 MB unpacked for the whole ZIP (still 25 MB packed through the relay); 48 pages on a canvas
(from 24, for prototypes with many routes); 500 MB of distinct bundle bytes in a product
(`409 quota_exceeded`, quota `mockup_bundle_bytes`) until stored bytes are counted against the
organization's 1 GB ([§9.2](09-data-lifecycle.md)).

**Serving.** `GET` and `HEAD /bundles/<grant>/<path>`, answered by one route with the headers the
decision lists. An empty path or one ending in `/` serves its `index.html`; a path is
percent-decoded strictly, and an encoded `/`, `\`, NUL or dot segment is `404`; `Range` works for
media; a request with `Sec-Fetch-Dest: document` on the app's origin and one with a
`Service-Worker` header are `403`. Types by extension: HTML, CSS, JavaScript (`js`, `mjs`), JSON
and source maps, SVG, PNG, JPEG, GIF, WebP, AVIF, ICO, WOFF, WOFF2, TTF, OTF, MP4, WebM, Ogg,
MP3, WAV, M4A, WebVTT, PDF; `txt`, `csv`, `md`, `xml`, `xhtml` and `xsl` as `text/plain`;
`charset=utf-8` only on text that is valid UTF-8; anything else `application/octet-stream` as an
attachment. HTML gets the frame script on the way out, never in storage. The grant lasts
`WHATBUILD_BUNDLE_GRANT_HOURS` (8), its expiry rounded up to the hour. The server's log line reads
`/bundles/:grant/…`; the platform's request logs keep the address, as they keep invitation links.
`WHATBUILD_CONTENT_URL`, when set, is the only host the route answers on; the app's `frame-src`
names it, and the frames there may open a document at the top level and show dialogs. Locally,
`http://127.0.0.1:<api port>` is a site apart from `http://localhost:<web port>`.

**Web app.** A frame's address is the bundle's address and the page's entry, kept until the page
is shown again, and fetched afresh when the tab returns within the grant's last hour. The frame
adds `allow-forms` (and `allow-modals` on a content site), so a form's own script runs while
`form-action 'none'` keeps it off the network. Each document that loads says so through the frame
script, and the app sends it the canvas's messages again; a load that does not within a second is
put back. A link within the bundle navigates in place, on the app's origin even one with a target,
which would open a refused top-level document.
Pan and interact work as now; keys pass from the bundle's top documents, not from its own iframes.
The inspector gains **Bundle**: its files, size and types, and the selected page's entry. The
Story's frame shows a promoted entry at its page's size; the print view shows its poster, or says it
is a prototype to open in WhatBuild.

**Lifecycle.** Deleting a mockup removes its bundle rows and queues its blob keys through
`blobsSafeToDelete`, so a sandbox baseline keeps what it holds; `public-sandbox-baseline.ts` adds
the table to the blobs live rows refer to; an upload never published takes its staged prefix with
it when the worker discards it; delete impact counts bundle files and bytes. Copying an
organization takes the rows and the `t/<tenant>/` blobs as it does now. The product export writes
`mockups/<mockup_id>/v<n>/bundle/<path>`. Backups change nothing: blobs are create-only, under the
bucket's versions or the file share's snapshots. The skill tells agents to build with a relative
base, use no network, and keep state out of browser storage.

**Out of scope.** Server code, rewrites (a deep path of an app that routes with history needs its
entry document first), root-relative addresses, the network, service and web workers,
WebAssembly, lasting browser storage, a bundle that frames another mockup, editing bundle files in
the app, searching them, and visitors adding them.

**Tests.** In `apps/server/test/`: each archive refusal (traversal, absolute and drive paths,
backslashes, duplicates, case and NFC/NFD collisions, symbolic links, encryption, a ZIP bomb
stopped at the budget, too many entries, a file too large); entry rules, carry-forward, the
`bundle` list, the hash check and blobs reused by hash; limits, etags, roles and the visitor's
refusal; a download whose every file has its upload's hash, uploaded again with no new blob;
every response's headers, unknown types, the grant's purpose, expiry, tampering and version
binding; encoded traversal; `Sec-Fetch-Dest: document`, `Service-Worker` and methods other than
GET and HEAD refused; a request with another tenant's session cookie served exactly what the grant
names, and one with a cookie and no grant refused; a deleted mockup's files gone at once; a reader
given an address only for a live promoted page; sandbox reset, organization copy and export
holding bundles; the log line masked. In the browser (`scripts/e2e.mjs`), on a synthetic bundle
of three documents: a module and a classic script, CSS with a relative font and image, a JSON
fixture fetched, a PDF fixture linked, an iframe of another of its documents, a form handled by
script, and storage in use; every file loads, links move in place without a put-back, a link off
the bundle is put back, keys pass from each document, nothing submits, a top-level open is
refused, no load carries the session cookie, the nested frame loads, and a canvas of 25 entries is
timed.

**Open questions**, each with a default:

| Question | Default |
|---|---|
| A content site: register a domain apart from what-build.com now, or later? | Later; the route serves from the app's origin, and the setting is ready. |
| A reader reaches the promoted version's whole bundle, not one page. | Yes: the prototype is the page. |
| Stand-ins in the frame script for `localStorage`, `sessionStorage` and `document.cookie`, kept in the frame's `window.name` so state crosses the bundle's documents in one frame. | Built, in the frame only, gone when the frame reloads. |
| One subdomain of a content site per view, with `allow-same-origin`, so storage, caching and root-relative addresses work. | Not until a content site exists. |
| A canvas of many entries at a small zoom: posters in place of frames? | Frames load lazily, as now; decide on the 25-entry timing. |
| "Bundle" also names a product's export ([§4.14](04-data-model.md#414-the-product-bundle)). | "A mockup's bundle" in prose, `bundle/` in the ZIP. |

## Planned — Undelete

Today a delete is permanent at once: the tombstone keeps who deleted what, when and why, and none
of the content ([§9.5](09-data-lifecycle.md)), so nothing deleted can be put back from the product.
Undelete would be an organization owner's act, for what was deleted in a window counted in days.

What it takes:

- **Keep what a delete removes, for the window, out of every view.** A delete would move the rows
  it removes into a holding table as JSON, ids and all, the way a sandbox's baseline holds an
  organization's content (`public-sandbox-baseline.ts`), and keep their bytes; only after the
  window would the rows and the bytes be erased. Nothing that reads content would see the held rows.
- **Put back with the same ids,** so every citation, link and reference that pointed at the object
  resolves again, and the tombstone goes. What changed in the meantime decides what can come back:
  a page id used again, or links the delete removed from other assumptions.
- **Say so.** "Permanent. Immediately." would no longer be true inside the window, so the delete
  dialogs, the skill and the privacy page change with it, and a person who needs something gone at
  once still has a way: a delete that skips the window, or the operator's erasure path
  ([§9.6](09-data-lifecycle.md)).
- **Deleting an organization** would hold its content for the same window, its owners able to
  undo it; that is the 7-day window an earlier plan for closing an organization had.

*Accept:* an owner restores a deleted source, assumption, Story page, mockup and product within the
window, and each comes back with its id, its citations resolving and its history; after the window
nothing of it remains but its tombstone.

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
| 3 | **Undelete** — how long deleted content is held before it is erased, who may put it back, and what the privacy page then says ([below](#planned--undelete)). | Not built. An owner's act, over a window counted in days, after which the content is erased as today. |
| 4 | **Restore-drill cadence** ([§9.3](09-data-lifecycle.md)). | A rehearsed restore before public sign-up and quarterly after, as a phase acceptance criterion. |
| 5 | **Activity log retention** ([§4.10](04-data-model.md)). | For the life of the product; events are small and carry no content. Nothing prunes them today. |
| 6 | **Revision scope** ([§4.1](04-data-model.md)) — which objects expose their revisions. | Outcomes today; the product concept, annotations and assumptions while still editable are next. Retained for the life of the object. |
| 7 | **The public sample** — a synthetic discovery readable at `/sample` with no account. | Built from the seed's synthetic content; read-only, with one "copy into my organization" action. The [public sandbox](#the-public-sandbox) serves the same purpose for anyone holding an invitation; the sample would serve people who have none. |
| 8 | **The tenant's name in the UI.** The API and MCP say `tenant` and the UI says "organization". Sources no longer have an `organization` field to collide with ([decision](../decisions/sources-are-described-by-tags.md)), so the wire could say `organization` too, at the cost of renaming a field every caller sends. | As built, until the maintainer wants one word. |
| 9 | **Teams** can be neither archived nor deleted. | Archive a team first (its products with it), then delete it, by an organization admin, with its name typed, as a product. |
| 10 | **How WhatBuild describes Exploration** — the journey's line for it on the overview and the public site, the opening of the README, `AGENTS.md` and the charter, and the skill's description. When insights and decisions were retired, each was changed only enough to stop naming them. | As written until the maintainer settles the wording; the tagline stays. |
| 11 | **Shared parts on a mockup canvas** — several people, each with an agent in their own project, publish pages to one canvas. If the projects do not share styles and components, the pages drift apart. | Pages are self-contained outputs, and each version carries files (a DESIGN.md, components, tokens) that collaborators pull into their projects ([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)). Revisit pages drawn from a shared stylesheet and components if collaborators' pages still drift. |
| 12 | **Tags that drift apart** — tags are free text, so one team can end up with `interview`, `interviews` and `customer-interview` ([decision](../decisions/sources-are-described-by-tags.md)). | Agents read `sources.facets` before tagging and the app offers the tags in use. If drift appears anyway, an operation that renames or merges a tag across a product's sources. |
| 13 | **The waitlist.** Requests to hear from us on the public site go to the `interest` table ([decision](../decisions/the-public-site-is-one-page-built-with-the-app.md)), and an operator reads them with a query ([cloud-run.md](../operations/cloud-run.md)). What becomes of them is not decided: whether anyone is told of a new one, how what people wrote is used, and how the announcement reaches them. | Kept as they are: nothing sends mail about a request, and nothing reads the list but an operator's query. |

**Settled**, and where:

- Hosted-only and multi-tenant from the start; one service on Cloud Run
  ([cloud-run.md](../operations/cloud-run.md)).
- Archive is the reversible default; delete is permanent, an admin's through both adapters (and
  an organization's, its owner's in the web app), guarded by `expected_etag` + `reason` +
  `confirm` + a preview, and citation snapshots survive a source's delete
  ([§9.5](09-data-lifecycle.md), [decision](../decisions/archive-by-default-delete-guarded.md)).
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
  the server gives them the Story's live pages, versions and export without what the pages draw
  on, and no archived page ([decision](../decisions/a-reader-reads-only-the-story.md)).
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
