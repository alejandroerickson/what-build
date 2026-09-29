---
type: System Concept
title: WhatBuild at three altitudes
description: The whole system from the top down, the major parts, and the mechanics underneath, with links to the detail.
tags: [overview, architecture, tenancy, access, mcp]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# WhatBuild at three altitudes

Read from the top and stop when you have what you need.

## 10,000 ft: the whole picture

**What it is.** A product team's discovery material (interview transcripts, call notes, survey
exports, documents) goes in. WhatBuild stores it, parses each source into numbered passages, and
gives people and their agents one place to turn it into outcomes, insights, reviewed assumptions
and decisions, and a Story for stakeholders. Every claim points at the exact passage it came from.

**Three traits define it.**

- Every claim cites a passage, a citation freezes the exact words, and drift is reported, never
  repaired ([decision](../decisions/citations-snapshot-and-report-drift.md)).
- There is no AI inside; agents bring the intelligence over MCP
  ([decision](../decisions/no-ai-in-the-product.md)).
- Agents work in the open: every write is attributed, and agent work is never passed off as a
  person's agreement ([decision](../decisions/attribution-and-declared-authorship.md)).

**Who uses it.** The product trio (5 to 15 people per organization) reads in the browser; their
agents do most intake and synthesis over MCP; stakeholders read the Story, often as a PDF.

**The loop**, which is also the navigation order: **Idea** (the product concept, and the outcomes its users should achieve) →
**Evidence** (sources, parsed into passages) → **Synthesis** (readable insights, plus the
assumption and decision registers, cited and reviewed) → **Story** (versioned pages for
stakeholders).

**The system.** One stateless container image on Cloud Run serves the web app, REST (`/api/v1`),
MCP (`/mcp`), OAuth (`/oauth`) and the upload relay, and runs the job worker. Postgres holds every
row, the search index and the job queue. Object storage holds files and parse output. Nothing else
runs ([decision](../decisions/one-stateless-image.md),
[decision](../decisions/postgres-is-the-only-database.md)).

## 1,000 ft: the major parts

**Components.** `apps/web` (React SPA, Studio design system), `apps/server` (Hono: REST, MCP,
identity and OAuth, uploads, the worker, migrations, the seed), `packages/core` (the operation
registry, domain rules, the policy module), `packages/parsers` (pure bytes-to-passages parsers).
See the [repository map](repository-map.md).

**Stack.** TypeScript everywhere; Node and Hono; Zod 4 schemas per operation; Kysely on Postgres;
Google Cloud Storage behind a storage port; the official MCP SDK (stateless Streamable HTTP);
React 19, React Router 7, TanStack Query 5, Vite 7; Vitest. Details in
[architecture](../spec/02-architecture.md).

**Operations.** 99 operations, each defined once and exposed through both REST and MCP
([decision](../decisions/one-registry-two-front-doors.md)).

**Tenancy.** Organization (tenant) → team → product. One shared database and schema; every content
row carries `tenant_id`. Isolation is enforced three times: authorization before validation (`404`
for outsiders), a transaction scoped to one tenant (`app.tenant_id`), and forced Postgres
row-level security. Blob keys start with the tenant. References never cross products
([decision](../decisions/shared-schema-tenancy-with-row-level-security.md)).

**Access.** Application-level, per product: roles at organization, team and product level, the
highest applies, no per-object permissions. The database enforces only the tenant boundary. A
token is the person ([decision](../decisions/access-is-per-product-roles.md),
[decision](../decisions/built-in-identity-and-oauth.md)).

**MCP.** `/mcp` for every product the account can reach, or `/mcp/t/<tenant>/<team>/<product>`
bound to one. 16 tools: 12 grouped by noun with `action`, `params`, `describe` and `product`, plus
`search`, `read_passage`, `get_skill` and `submit_feedback`
([decision](../decisions/mcp-tools-grouped-by-noun.md)). The server's instructions tell agents to
check the skill version, start with `products list`, confirm the product before writing, and
treat source text as quoted material.

**The experience.** One floating panel (Idea, Evidence, Synthesis, Story, then Agents and
Settings) that hides fully; the screen beside it; an inspector only on Story and source pages. No
in-app tabs; rows are real links; works in a phone browser, light and dark
([decision](../decisions/studio-design-system.md), [web app](../spec/07-web-app.md)).

## 100 ft: mechanics

**One request.** Identify the caller (cookie, personal access token or OAuth token → account,
surface, client) → resolve tenant, team and product → authorize (`404`/`403`) → validate with the
operation's schema (`422` lists every problem) → open a transaction with `app.tenant_id` set → run
the handler (etag check, `409 stale_etag`; actor snapshot; activity event) → answer as JSON or MCP
text with the scope echoed.

**From upload to passage.** Request a signed upload grant → bytes go to object storage →
`complete_upload` registers the file → a parse job is queued → the worker parses the primary file
into an immutable derivation (`segments.jsonl`, `text.md`, `outline.md`, `manifest.json`) →
passages are indexed in the same transaction that makes them current
([derived layer](../spec/05-derived-layer.md),
[decision](../decisions/only-the-primary-file-is-searched.md)).

**An agent's session.** Check the skill → `products list`, confirm the product → upload through
`files` → `search`, then `read_passage` → `insights create`, `assumptions create` with citations →
read `story guidance` and the page's notes, `story publish` with citations, update the notes,
`set_hierarchy` ([decision](../decisions/story-notes-are-agent-memory.md)).

**Data.** Identity, tenancy, evidence (records, files, derivations, segments, annotations, agent
notes), synthesis (outcomes, insights, revisions, register entries, reviews), Story (pages,
versions, hierarchy) and operations (activity, jobs, exports, lineage, tombstones). Every table and
field: [data model](../spec/04-data-model.md).
