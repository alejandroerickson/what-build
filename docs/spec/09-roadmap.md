# 9. Roadmap

The ethos: the smallest implementation that proves the full path wins. Each phase ends in
something demonstrable, and each acceptance list is a test plan.

## Phase 0 — Repository

Monorepo scaffold ([§2.7](02-architecture.md)), strict TypeScript, lint, format, CI running tests
in Node **and** a browser, license, README, contribution guide, code of conduct, security policy.

*Accept:* a trivial `core` test passes in Node and in browser mode in CI.

## Phase 1 — The contract

Operation registry; REST and MCP adapters generated from it; in-memory ports; the local principal;
projects, objectives, records with inline notes; error model; ETags; paging; `describe`.

*Accept:*
- A caller lists, reads, and writes projects, objectives, and records through **both** adapters.
- With sign-in required, an unauthenticated caller gets `401` from both; no input changes access.
- The parity test passes; an unregistered route or tool action fails the build.
- Stale ETag → `409`; unknown field → `422`; over-limit page → `422`.
- Project resolution over MCP follows [§3.3](03-tenancy-and-identity.md), including
  `project_required` listing the projects.

## Phase 2 — The derived layer and real local storage

Parsers and sidecars; derivations; `read_passage` by seq and by ms; SQLite and filesystem
adapters; lexical and substring search; upload grants, URL fetch; the conformance suite.

*Accept:*
- A representative VTT transcript yields exact cue times, speakers, and code-point offsets,
  verified against `text.md` — including a non-BMP character.
- Golden files for each format; each manifest status reachable by a test fixture.
- Out-of-range and over-size passage windows behave per [§5.4](05-derived-layer.md).
- Upload → derive → search → passage read works end to end through REST and through MCP.
- `npx what-build` persists across restarts. Conformance passes on in-memory and SQLite.

## Phase 3 — The web application

Against the local server: project list and switch, Objectives, Sources (upload, browse, record,
passage reader, annotations, search), then Insights and registers, then Story reading and
arranging. Design system chosen at the start of this phase.

*Accept:* the core loop is completable by a person with no terminal use after start-up; every
filter round-trips through the URL; a two-tab edit conflict is surfaced without losing text;
Playwright covers the loop; accessibility checks pass.

## Phase 4 — The browser profile

SQLite WASM + OPFS adapters; worker transport; static deployment; persistence status; multi-tab
safety; project bundles (export/import) in all profiles; the synthetic sample project.

*Accept:* conformance passes in a real browser; the hosted static build completes the core loop
offline after first load; a project exported from the browser imports into the local server with
identical ids, citations, and `check_citations` results.

## Phase 5 — The agent path

The product skill; `get_skill` and version advertisement; Connect page; installers; `mcp-stdio`;
the hosted relay (`apps/relay`) with pairing and limits; `story.guidance` derived from the chosen
design system; feedback capture. Start with a relay spike: long agent runs against a backgrounded
tab, and URL-only (no OAuth) connector support in the target MCP clients.

*Accept:* someone who has never seen the product connects Claude Desktop and Claude Code from the
Connect page alone — by URL through the relay in the hosted browser profile with nothing
installed, and against the local server; an agent with only the skill and
`describe` completes: create source → upload via grant → read passages → register a cited
assumption → draft and publish a Story page; a wrong secret, a regenerated (old) URL, and a
wrong-origin WebSocket are all refused; the relay persists and logs no operation content.

## Phase 6 — Self-host

Docker image; sign-in (OIDC, owner passphrase); MCP OAuth; refusal to start unauthenticated on a
public address; backup and restore documentation; upgrade path with migrations.

*Accept:* a documented one-container deployment on a small VPS or container host with HTTPS; MCP
clients authorize through OAuth and writes are attributed to the authorizing person.

## Phase 7 — Cloud

Postgres and S3-compatible adapters; workspaces, membership, invitations; queue-backed
derivation; rate limits; row-level security; operator tooling for feedback and retention.

*Accept:* conformance passes on Postgres; the cross-workspace isolation test passes for every
operation; any replica serves any request with no session affinity.

## Phase 8 — Retrieval

In the order evidence supports: relevance set and semantic/hybrid evaluation; dimension registry;
tiered attachment search; approximate relocation; recursive lineage ([§8](08-search.md)).

Phases 3 and 4 may overlap once the `Client` interface is stable. Phases 6–8 are independent of
one another.

---

## Open questions

Every ◆ Decision in this spec, plus choices not yet made. Each has a default so work is not
blocked.

| # | Question | Default in this draft |
|---|---|---|
| 1 | **npm package name.** The product name is WhatBuild and the domain what-build.com is registered; the npm package and CLI name still need securing. Check registry availability before Phase 0 publishes anything. | `what-build` as the package and CLI name. |
| 2 | ~~**License.**~~ Settled 2026-09-19: **MIT**, in `LICENSE` at the repository root. | — |
| 3 | **The hosted relay** ([§2.6](02-architecture.md)) — agents reach the zero-install demo through a relay we host; data is stored in the browser but transits our service. Accept that trust model and the running cost? Which platform hosts it? | Yes, for demo data only, stated plainly in the UI. Edge platform with per-id coordination objects; single Node instance as the portable alternative. A local bridge process was considered and rejected (browser loopback restrictions; needs an install anyway). |
| 4 | **Cloud reference platform.** | Containers + managed Postgres + S3-compatible; no vendor SDKs outside adapters. |
| 5 | **Auth library.** | Better Auth, confirmed by a spike at the start of Phase 6 (OIDC, org membership, MCP OAuth provider on SQLite and Postgres). |
| 6 | **SQLite driver on Node** — `better-sqlite3` (native, prebuilt) vs `node:sqlite` vs the WASM build everywhere. | `better-sqlite3` behind the Kysely dialect; swap when `node:sqlite` is stable. |
| 7 | **Sources shared across projects?** ([§3.1](03-tenancy-and-identity.md)) | No. Add to each project; "copy to project" later. |
| 8 | **Register edit rule** — frozen after first review, corrections by supersede ([§4.8](04-data-model.md)). | As written. |
| 9 | **Human-declared reviews over MCP** ([§4.8](04-data-model.md)) — allow an agent to relay a person's judgment with confidence? | Allowed, recorded as declared. |
| 10 | **Workspace `owner` flag** limited to workspace lifecycle ([§3.5](03-tenancy-and-identity.md)). | As written. |
| 11 | **Personal access tokens** for MCP clients without OAuth. | Not in v1; permitted by the principles if needed. |
| 12 | **Purging.** "Nothing is deleted" meets real needs (a source uploaded by mistake containing personal data; erasure requests in the cloud). | No product operation. Local: an operator CLI command outside the API (`what-build purge-record`), logged. Cloud: operator process. Needs a proper design before Phase 7. |
| 13 | **Sample project content.** Who writes the synthetic corpus, and about what fictional product? | Written in Phase 4; entirely synthetic. |
| 14 | **UI framework.** React is chosen for contributor reach; the spec depends only on "static SPA". | React + Vite. |
| 15 | **Limits** (file size, parse caps, HTML size) are first guesses. | As written; tune with real material. |
| 16 | **Telemetry.** | None. The product makes no network calls except those the user initiates. |
