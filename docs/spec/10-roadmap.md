# 10. Roadmap

The ethos: the smallest implementation that proves the full path wins. Each phase ends in
something demonstrable, and each acceptance list is a test plan.

**Deploy from Phase 1.** A staging deployment exists as soon as there is something to deploy, is
redeployed on every merge, and is invite-only until Phase 6. The first production deploy is then a
configuration change and not a milestone that can go wrong.

## Phase 0 — Repository and local development

Monorepo scaffold ([§2.9](02-architecture.md)), strict TypeScript, lint, format, Docker Compose,
migration and seed commands, CI against a Postgres service container, MIT licence (already in
place), README, contribution guide, code of conduct, security policy.

*Accept:*
- On a machine with Node and Docker and nothing else, a fresh clone reaches a running, signed-in
  application with seeded data via `pnpm install && pnpm dev` — **with no account created anywhere
  and no API key of any kind**.
- `pnpm test` passes from that same clone.
- CI runs the same migration and seed path a contributor does, so a broken `pnpm dev` breaks the
  build.

## Phase 1 — The contract and the data spine

Operation registry; REST and MCP adapters generated from it; Postgres store with `team_id` and
row-level security **in the first migration**; in-memory ports for unit tests; a stub principal;
teams, projects, objectives, records with inline notes; error model; ETags; paging; `describe`;
the activity log.

*Accept:*
- A caller lists, reads, and writes projects, objectives, and records through **both** adapters.
- The parity test passes; an unregistered route or tool action fails the build.
- Stale ETag → `409`; unknown field → `422`; over-limit page → `422`.
- Project resolution over MCP follows [§3.6](03-accounts-teams-and-identity.md), including
  `project_required` listing the projects.
- **The isolation probe passes for every operation**: a caller scoped to team B receives `404`,
  never `403`, and never data.
- Every mutation writes exactly one activity event in the same transaction.
- Staging deploys on merge.

## Phase 2 — The library and the derived layer

Upload grants (presigned in staging, local endpoint in development); parsers and sidecars;
derivations on the queue; `read_passage` by seq and by ms; Postgres full-text and substring search;
archive, restore, `delete_impact` and `delete` with tombstones; usage metering; the conformance
suite; the synthetic sample project.

*Accept:*
- A representative VTT transcript yields exact cue times, speakers, and code-point offsets,
  verified against `text.md` — including a non-BMP character.
- Golden files for each format; each manifest status reachable by a test fixture.
- Out-of-range and over-size passage windows behave per [§5.4](05-derived-layer.md).
- Upload → derive → search → passage read works end to end through REST and through MCP.
- An archived record leaves search — including through MCP — and returns unchanged on restore.
- A deleted record frees its bytes, returns `410` with its tombstone, and leaves citations
  reporting `record_deleted` with their snapshot text intact. `delete` without `confirm`, with a
  stale `etag`, or without a reason is refused.
- Conformance passes on in-memory, filesystem-blob and S3-blob configurations.
- Usage counters match a reconciliation job's independent count.

## Phase 3 — Accounts, teams, invitations

Better Auth spike; sign-up and email verification; password and magic link; team creation; invites
by email and link; members; sessions; the `owner` flag and its single `403`; rate limits; quota
enforcement; the data statement in the sign-up flow.

*Accept:*
- Two accounts and two teams; the full isolation suite is green, including blob keys.
- An invitation works end to end: terminal mail in development, a real provider on staging.
- A member removed from a team loses access immediately; their attribution survives.
- A write over a quota returns `409 quota_exceeded` with usable `details`; a read, a search and an
  export over the same quota all succeed.
- The stub principal of Phase 1 is gone from the codebase.

## Phase 4 — The web application

Team screens (projects, members, Connect shell, settings, account); the four project screens;
Objectives; Library (upload, browse, record, passage reader, annotations, search); Insights and
registers with revision history; Story reading and arranging; the Activity drawer; conflict
handling. Design system chosen at the start of this phase.

*Accept:* a person completes the loop from sign-up to a published Story page with no terminal use;
every filter round-trips through the URL; a two-person edit conflict is surfaced without losing
text; Playwright covers the loop; accessibility checks pass.

## Phase 5 — The agent path

MCP OAuth; personal access tokens; the product skill; `get_skill` and version advertisement; the
Connect page; installers; `mcp-stdio`; `story.guidance` derived from the chosen design system;
feedback capture.

*Accept:* someone who has never seen the product connects Claude Desktop and Claude Code from the
Connect page alone; an agent with only the skill and `describe` completes: create record → upload
via grant → read passages → register a cited assumption → draft and publish a Story page; a token
issued for team B cannot reach team A through any tool; a revoked token stops working immediately;
no destructive operation is reachable over MCP.

## Phase 6 — Durability, data rights, and public signup

Backup configuration and a **rehearsed restore**; project bundle export and import; team export;
close-the-team; account deletion; the sub-processors page; a status page; abuse limits; the
operator runbooks ([§9.6](09-data-lifecycle.md)).

Delete itself is **not** here: it ships with the objects it destroys, in Phases 2 and 4, because a
product that can only accumulate is not one people will put real material into.

*Accept:*
- A restore from backup into a scratch environment is **performed**, verified against the nightly
  blob manifest, and written up with its elapsed time.
- A team export round-trips into a fresh instance with identical ids, citations, revisions and
  `check_citations` results.
- Closing a team revokes access immediately and removes content within the stated window.
- Signup survives an abuse test: scripted sign-ups, oversized uploads, and a write flood are all
  limited without affecting other teams.
- **Public signup opens.**

## Phase 7 — Retrieval

In the order evidence supports: relevance set and semantic/hybrid evaluation on `pgvector`;
dimension registry; tiered attachment search; approximate relocation; recursive lineage
([§8](08-search.md)).

*Accept:* hybrid beats lexical on the measured relevance set — or it is not adopted.

## Phase 8 — A paid plan (deferred)

Billing, higher limits, and whatever the free tier turns out to be teaching us. ◆ Decision:
explicitly **not in v1 and not scheduled**. No billing code is written before it; the `plan` field
and the `owner` flag are the only anticipation.

Phases 6 and 7 are independent of each other. Everything else is ordered.

---

## Open questions

Every ◆ Decision in this spec, plus choices not yet made. Each has a default so work is not
blocked.

| # | Question | Default in this draft |
|---|---|---|
| 1 | ~~**The shape itself.**~~ Settled 2026-09-19: hosted-only, multi-tenant from day one; the browser profile and the relay deleted rather than deferred. | — |
| 2 | ~~**Rename `workspace` → `team`.**~~ Settled 2026-09-19: **team**, everywhere. "Workspace" does not appear in the product. | — |
| 2a | ~~**Delete.**~~ Settled 2026-09-19: archive and delete both exist. Archive is the reversible default and the first thing offered; **delete is permanent, available to every member through both adapters including MCP**, and guarded by `etag` + `reason` + `confirm` + a `delete_impact` preview ([§9.5](09-data-lifecycle.md)). | — |
| 3 | **npm package and CLI name.** The product name is WhatBuild and what-build.com is registered; the registry entry is not secured. | `what-build`, availability unchecked. Check before Phase 0 publishes anything. |
| 4 | **Free-tier numbers** ([§9.2](09-data-lifecycle.md)) — 5 members, 3 projects, 300 records, 1 GB, 100 MB per file. | As written; tune against real usage and real bills. Metered in Phase 2, enforced in Phase 3. |
| 5 | **Which providers we rent** — container host, managed Postgres, S3-compatible storage, transactional email. | The cheapest credible free tiers, chosen so each is replaceable: plain Postgres, an S3-compatible API, SMTP. No provider SDK outside its adapter package ([§2.2](02-architecture.md)). |
| 6 | **Auth library.** | Better Auth, confirmed by a spike at the start of Phase 3 (email/password, magic link, organizations, MCP OAuth provider, on Postgres). |
| 7 | **Personal access tokens in v1** ([§3.7](03-accounts-teams-and-identity.md)). | Yes — without them, clients that cannot do OAuth have no way in, and there is no local no-auth mode any more. |
| 8 | **The single `403`** — an `owner` flag gating only team lifecycle and billing ([§3.5](03-accounts-teams-and-identity.md)). | As written. |
| 9 | **Delete's guards** ([§9.5](09-data-lifecycle.md)) — `etag` + `reason` + `confirm: "delete permanently"` + a `delete_impact` preview, and citation snapshots surviving the source. | As written. The snapshot rule is the one most likely to be argued with: a reviewed decision keeps its quoted evidence even after the record is deleted, and removing that means deleting the register entry too. |
| 9a | **Delete on a closed team** — content leaves live systems within 7 days, backups within 35. | As written; the 7-day window is deliberate room to reverse a mistake. |
| 10 | **Backup retention and restore-drill cadence** ([§9.3](09-data-lifecycle.md)). | ≥ 7 days retained; a rehearsed restore before public signup and quarterly after, as a phase acceptance criterion. |
| 11 | **Telemetry.** A hosted service needs operational signal; a product that promises no analytics must not collect product analytics. | Operational only: request and error rates, job durations, structured logs with ids. No product analytics, no content, no email addresses, no tokens — and the data statement says so ([§9.1](09-data-lifecycle.md)). |
| 12 | **Activity log retention** ([§4.10](04-data-model.md)). | For the life of the team; events are small and carry no content. |
| 13 | **Revision retention and scope** ([§4.1](04-data-model.md)) — which objects keep revisions, and for how long. | Every object with an authored body: the project idea, objectives, annotations, insights, and register entries while still editable. Retained for the life of the object. |
| 14 | **Records shared across projects** ([§3.1](03-accounts-teams-and-identity.md)). | No. Add to each; "copy to project" later. |
| 15 | **Register edit rule** — frozen after first review, corrections by supersede ([§4.8](04-data-model.md)). | As written. |
| 16 | **Human-declared reviews over MCP** ([§4.8](04-data-model.md)) — allow an agent to relay a person's judgment with confidence? | Allowed, recorded as declared. |
| 17 | **Sample project content** — who writes the synthetic corpus, and about what fictional product? | Written in Phase 2; entirely synthetic; published read-only and unauthenticated at `/sample`. |

## Risks

| Risk | Mitigation |
|---|---|
| **We are now a custodian.** Other people's research on rented infrastructure with no revenue. | Small quotas, plain words at sign-up, complete export, a rehearsed restore, and asking people not to send anything we would be sorry to lose. |
| **MCP OAuth moved up the critical path.** It was Phase 6 work; it is now what makes the agent story exist at all, because there is no local no-auth mode to fall back on. | Spike alongside auth in Phase 3; ship personal access tokens as the floor. |
| **Free hosting is a moving target.** The cheap tier of the month sleeps, changes, or disappears. | Plain Postgres, S3-compatible storage, a Postgres queue, no provider SDK outside its adapter — moving is a redeploy, not a rewrite. |
| **Signup is an attack surface.** Abuse, spam accounts, storage burned by strangers. | Email verification before upload, per-IP signup limits, per-member write limits, small caps, an operator usage view from Phase 3. |
| **We lost the zero-install demo.** A stranger can no longer touch the product without an email address. | The public read-only sample project, and a sign-up that takes under a minute. This is the one real cost of draft 0.2 and it should be re-examined if adoption stalls. |
| **Contributor setup rot.** A local environment nobody runs stops working. | CI uses the same path a contributor does, so a broken `pnpm dev` breaks the build. |
| **Public-repo hygiene.** | Sample content fully synthetic; no private names or material in code, docs, or history. |
