---
type: Roadmap
title: Phases 0 to 5 are mostly built; durability, data rights and public sign-up come next.
description: What is built and what is not, phase by phase, with acceptance criteria; the open questions that remain, the ones already settled, and the risks.
tags: [roadmap, status, phases, open-questions, risks]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# 10. Roadmap

The ethos: the smallest implementation that proves the full path wins. Each phase ends in
something demonstrable, and each acceptance list is a test plan.

## Status on 2026-09-28

Observed in the code on this date.

| Phase | State | Built | Not built yet |
|---|---|---|---|
| 0 | Mostly done | pnpm workspace, strict TypeScript, `pnpm dev` with **no Docker** (embedded Postgres), forward-only migrations, seed, `pnpm test` (parsers, server against real Postgres, web), GitHub Actions CI (documentation bundle check, install, skill drift check, typecheck, test, build) | contribution guide, code of conduct, security policy; lint and format config |
| 1 | Done | registry → REST and MCP (99 operations, 16 tools); row-level security in the first migration; ETags; paging; `describe`; activity in the same transaction; the isolation test over every operation; the parity test | — |
| 2 | Mostly done | upload grants (relay, optional direct signed URLs); parsers for plain text, Markdown, VTT, SRT, HTML, DOCX, PDF, XLSX, CSV and TSV; derivation on the Postgres queue; passages by segment and time; substring and ranked search with coverage; archive and restore; guarded delete of sources with tombstones; a synthetic sample product in the seed | usage metering; golden-file tests per format; a blob-store conformance suite (no test exercises the Cloud Storage adapter); legacy `.doc` |
| 3 | Mostly done | tenants, teams, products, roles; email-link, Google and development sign-in; invitations by email and link; personal access tokens; invite-only mode; sign-in link rate limit | quotas and their `409 quota_exceeded` (only the Story page limit exists); general rate limits; account deletion |
| 4 | Mostly done | the design system (Studio, [DESIGN.md](../../DESIGN.md)) across every screen of the loop: Idea, Evidence (browse, kind-first intake, the source page with sections and inspector, passage reader, notes, files, search), Synthesis (the insight editor, revision history, insight review, assumptions and decisions with review, confidence, citation checks), Story (a read-only reader with the page tree, crumbs, the inspector with versions, citations and notes for agents, the print view for PDF, the page following the app's theme), Activity as one log for people and agents, organization members, product people, Agents, account | an accessibility audit; Playwright in CI (a browser walk-through exists in `scripts/e2e.mjs`); the public sample at `/sample`; links in a Story page that stay in the app (the sandboxed frame opens every link, including one to another Story page, in a new tab) |
| 5 | Mostly done | OAuth 2.1 for MCP, tokens, the versioned skill, `get_skill`, the Agents (Connect) page, installers, feedback, Story guidance derived from the design tokens (with a drift test) | the stdio transport |
| 6 | Started | the Cloud Run deployment ([cloud-run.md](../operations/cloud-run.md)) with Cloud Build continuous deployment; product export (`products.export`) | a rehearsed restore; import; organization export; closing an organization; the sub-processors page; abuse tests |

**Deploy early.** A deployment exists as soon as there is something to deploy, is redeployed on
every push to `main` through Cloud Build, and is invite-only until Phase 6. The first public
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

Sign-in by email link and Google; organization creation; invitations by email and link; members
and roles; sessions; the `owner` role; rate limits; quota enforcement; the data statement at
sign-in.

*Accept:*
- Two accounts and two tenants; the full isolation suite is green, including blob keys.
- An invitation works end to end: terminal mail in development, a real provider in production.
- A member whose grant is revoked loses access immediately; their attribution survives.
- A write over a quota returns `409 quota_exceeded` with usable `details`; a read, a search and an
  export over the same quota all succeed.

## Phase 4 — The web application

Organization screens (products, members, Agents, account); the four product screens; Idea;
Evidence (upload, browse, source page, passage reader, annotations, search); Synthesis (insights
and registers) with revision history; Story reading and export; the Activity page; conflict handling. The
design system is Studio ([DESIGN.md](../../DESIGN.md)).

*Accept:* a person completes the loop from sign-in to a published Story page with no terminal use;
every filter round-trips through the URL; a two-person edit conflict is surfaced without losing
text; Playwright covers the loop; accessibility checks pass.

## Phase 5 — The agent path

MCP OAuth; personal access tokens; the product skill; `get_skill` and version advertisement; the
Agents page; installers; the stdio transport; `story.guidance` derived from the design system;
feedback capture.

*Accept:* someone who has never seen the product connects Claude Desktop and Claude Code from the
Agents page alone; an agent with only the skill and `describe` completes: create source → upload
via grant → read passages → register a cited assumption → draft and publish a Story page; a token
cannot reach a tenant its person is not in through any tool; a revoked token stops working
immediately; permanent delete over MCP happens only with every guard of
[§9.5](09-data-lifecycle.md).

## Phase 6 — Durability, data rights, and public sign-up

Backup configuration and a **rehearsed restore**; product export (built) and import; organization
export; closing an organization; account deletion; the sub-processors page; abuse limits; the
operator runbooks ([§9.6](09-data-lifecycle.md)).

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
| 6 | **Revision scope** ([§4.1](04-data-model.md)) — which objects expose their revisions. | Insights and outcomes today; the product concept, annotations and register entries while still editable are next. Retained for the life of the object. |
| 7 | **The public sample** — a synthetic discovery readable at `/sample` with no account. | Built from the seed's synthetic content; read-only, with one "copy into my organization" action. |
| 8 | **The tenant's name in the UI.** Sources already have an `organization` field (the organization a source concerns), so the API says `tenant` and the UI says "organization". | As built; rename the source field (for example `about_organization`) if one word is wanted. |
| 9 | **Stakeholders who read only the Story** — a Story-only role, or share links? | Open. Viewers can read the Story today. |
| 10 | **Delete beyond sources** — insights, register entries, annotations, Story pages, outcomes, products. | The same guards and tombstones as sources; a register entry's delete is also how a citation snapshot is removed. |

**Settled**, and where:

- Hosted-only and multi-tenant from the start; one service on Cloud Run
  ([cloud-run.md](../operations/cloud-run.md)).
- Archive is the reversible default; delete is permanent, available to editors through both
  adapters, guarded by `expected_etag` + `reason` + `confirm` + a `delete_impact` preview, and
  citation snapshots survive it ([§9.5](09-data-lifecycle.md)).
- Providers: Cloud Run, Cloud Storage, Cloud SQL or any Postgres 15+, any SMTP server; no provider
  SDK outside its adapter ([§2.2](02-architecture.md)).
- Authentication is WhatBuild's own: email links, Google, and its own OAuth 2.1 server for MCP; no
  passwords ([§3.2](03-accounts-teams-and-identity.md), [§3.8](03-accounts-teams-and-identity.md)).
- Personal access tokens exist, for clients that cannot do OAuth.
- Roles: highest applicable role wins, no negative overrides, editors review and delete, no
  separate reviewer role, every role reads the activity log; `403` names the role
  ([§3.5](03-accounts-teams-and-identity.md)).
- Sources are not shared across products; they are copied or moved
  ([§3.7](03-accounts-teams-and-identity.md)).
- Register entries freeze at first review; corrections supersede ([§4.8](04-data-model.md)).
- A human review relayed by an agent is allowed and recorded as declared
  ([§3.9](03-accounts-teams-and-identity.md)).
- Telemetry is operational only ([§9.1](09-data-lifecycle.md)).
- The design system is Studio ([DESIGN.md](../../DESIGN.md)); Story guidance derives its tokens
  from the web app's, checked by a drift test.

## Risks

| Risk | Mitigation |
|---|---|
| **We are a custodian.** Other people's research on rented infrastructure with no revenue. | Small limits, plain words at sign-in, complete export, a rehearsed restore, and asking people not to send anything we would be sorry to lose. |
| **Hosting costs move.** A free tier changes or disappears. | Plain Postgres, a Postgres queue, the object store behind a port, no provider SDK outside its adapter — moving is a redeploy, not a rewrite. The service scales to zero when idle. |
| **Sign-up is an attack surface.** Abuse, spam accounts, storage burned by strangers. | Invite-only until the Phase 6 abuse limits exist; sign-in link limits today; per-member write limits, small caps and an operator usage view before public sign-up. |
| **No zero-install demo.** A stranger cannot touch the product without an email address. | The planned public read-only sample, and a sign-in that takes under a minute. Re-examine if adoption stalls. |
| **Contributor setup rot.** A local environment nobody runs stops working. | CI uses the same path a contributor does, so a broken `pnpm dev` breaks the build. |
| **Public-repo hygiene.** | Sample content fully synthetic; no private names or material in code, docs, or history. |
