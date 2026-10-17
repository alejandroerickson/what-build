---
type: System Concept
title: WhatBuild at three altitudes
description: The whole system from the top down, the major parts, and the mechanics underneath, with links to the detail.
tags: [overview, architecture, tenancy, access, mcp]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# WhatBuild at three altitudes

Read from the top and stop when you have what you need.

## 10,000 ft: the whole picture

**What it is.** A product team's discovery material (interview transcripts, call notes, survey
exports, documents) goes in. WhatBuild stores it, reads each source's attachments into one
readable text, and gives people and their agents one place to turn it into outcomes, mockups,
reviewed assumptions and a Story for stakeholders. Agents search what the sources say for what
bears on each piece of work.

**Three traits define it.**

- Every source's words are one derived text that people and agents read, correct and search
  exactly ([decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md));
  what bears on a piece of work is found by searching, not kept as citations
  ([decision](../decisions/evidence-is-searched-not-cited.md)).
- There is no AI inside; agents bring the intelligence over MCP
  ([decision](../decisions/no-ai-in-the-product.md)).
- Agents work in the open: every write is attributed, and agent work is never passed off as a
  person's agreement ([decision](../decisions/attribution-and-declared-authorship.md)).

**Who uses it.** The product trio (5 to 15 people per organization) reads in the browser; their
agents do most intake and synthesis over MCP; stakeholders read the Story, often as a PDF.

**The loop**, which is also the navigation order: **Idea** (the product concept, and the outcomes its users should achieve) →
**Evidence** (sources, each described by a title and tags, with its derived text, its attachments, a summary, notes and comments;
[decision](../decisions/sources-are-described-by-tags.md)) → **Exploration** (mockups: versioned canvases of
pages built from the evidence, each under a brief, whose pages may enter a team's multi-file
prototype carried as it is ([decision](../decisions/mockups-carry-prototypes-served-from-a-capability-path.md));
and the assumption register, reviewed by people) → **Story** (versioned pages for stakeholders). Insights and decisions were retired, and
what a product held of them became sources
([decision](../decisions/insights-and-decisions-are-retired-into-evidence.md)).

**The system.** One stateless container image on Cloud Run serves the web app, REST (`/api/v1`),
MCP (`/mcp`), OAuth (`/oauth`) and the upload relay, and runs the job worker. Postgres holds every
row, the search index and the job queue. Object storage holds attachments and what was read from
them. Nothing else
runs ([decision](../decisions/one-stateless-image.md),
[decision](../decisions/postgres-is-the-only-database.md)).

## 1,000 ft: the major parts

**Components.** `apps/web` (React SPA, Studio design system), `apps/server` (Hono: REST, MCP,
identity and OAuth, uploads, the worker, migrations, the seed), `packages/core` (the operation
registry, domain rules, the policy module), `packages/parsers` (pure parsers from bytes to readable
Markdown).
See the [repository map](repository-map.md).

**Stack.** TypeScript everywhere; Node and Hono; Zod 4 schemas per operation; Kysely on Postgres;
Google Cloud Storage behind a storage port; the official MCP SDK (stateless Streamable HTTP);
React 19, React Router 7, TanStack Query 5, Vite 7; Vitest. Details in
[architecture](../spec/02-architecture.md).

**Operations.** 118 operations, each defined once and exposed through both REST and MCP, but for
deleting an organization, which only its owner does, in the web app
([decision](../decisions/one-registry-two-front-doors.md)).

**Tenancy.** Organization (tenant) → team → product. One shared database and schema; every content
row carries `tenant_id`. Isolation is enforced three times: authorization before validation (`404`
for outsiders), a transaction scoped to one tenant (`app.tenant_id`), and forced Postgres
row-level security. Blob keys start with the tenant. References never cross products
([decision](../decisions/shared-schema-tenancy-with-row-level-security.md)).

**Access.** Application-level, per product: roles at organization, team and product level, the
highest applies, no per-object permissions. A reader, the lowest team or product role, reaches
only the Story ([decision](../decisions/a-reader-reads-only-the-story.md)); editors archive and
admins delete ([decision](../decisions/archive-by-default-delete-guarded.md)). The database
enforces only the tenant boundary. A token is the person, at most: each agent connection has the
level its person chose (Read only, Edit or Admin), which caps their role and the actions the agent
is offered
([decision](../decisions/access-is-per-product-roles.md),
[decision](../decisions/built-in-identity-and-oauth.md),
[decision](../decisions/an-agent-connection-has-a-level-the-person-chooses.md)).

**The public sandbox.** A deployment may name one organization as its public sandbox
(`WHATBUILD_SANDBOX_TENANT`). Anyone holding an invitation link enters it as a visitor: an editor
of every product there, who writes under a made-up name, sees no other person, administers
nothing, and meets limits on how often and how much. Its owners and admins save its content as a
baseline, and a reset every day puts the baseline back
([decision](../decisions/the-public-sandbox-is-one-organization-with-pseudonymous-visitors.md)).

**MCP.** `/mcp` for every product the account can reach, `/mcp/t/<tenant>` for one organization,
or `/mcp/t/<tenant>/<team>/<product>` for one product. A scoped endpoint is a fence: it refuses
every call outside its scope, and its token works nowhere wider
([decision](../decisions/a-scoped-mcp-connector-is-a-fence.md)). 14 tools: 11 grouped by noun with `action`, `params`, `describe` and `product`, plus
`search`, `get_skill` and `submit_feedback`
([decision](../decisions/mcp-tools-grouped-by-noun.md)). The server's instructions tell agents to
check the skill version, start with `products list`, confirm the product before writing, and
treat source text as quoted material.

**The experience.** One floating panel (Idea, Evidence, Exploration, Story, then Connect an agent,
Activity and Settings) that hides fully; the screen beside it; an inspector on the Story, a mockup
and a source page. No
in-app tabs; rows are real links; works in a phone browser, light and dark
([decision](../decisions/studio-design-system.md), [web app](../spec/07-web-app.md)).

## 100 ft: mechanics

**One request.** Identify the caller (cookie on REST, OAuth token on MCP → account,
surface, client, and for an agent its connection's level) → refuse an operation above that level
(`403`) → resolve tenant, team and product → authorize (`404`/`403`) → in a public
sandbox, admit the visitor and count the call (`403`/`429`) → validate with the
operation's schema (`422` lists every problem) → open a transaction with `app.tenant_id` set → run
the handler (etag check, `409 stale_etag`; actor snapshot; activity event) → answer as JSON or MCP
text with the scope echoed.

**From upload to text.** Request a signed upload grant → bytes go to object storage →
the upload relay adds the attachment as they arrive (`complete_upload` does, after a PUT straight to
the bucket) → a job to read it is queued → the worker reads it,
in a thread of its own held to a memory and a time limit, into an immutable reading
(`text.md`, `manifest.json`) → when the source has no text, or its text is still this
attachment's, the reading becomes the source's derived text, and its pieces are indexed for search
in the same transaction ([derived layer](../spec/05-derived-layer.md),
[search](../spec/08-search.md),
[decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md),
[decision](../decisions/each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits.md)).
Every write of a source's title, tags, summary, notes, text or comments indexes it again the same
way.

**An agent's session.** Check the skill → `products list`, confirm the product → read
`sources facets` and upload through `attachments`, reusing the product's tags → `search`, then `derived text` around a hit → `assumptions create`, saying why in its body →
`mockups publish` a canvas with its brief, or `get_download` a version, build the next one in a
project and publish the pages that changed
([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)) → read
`story guidance` and the page's notes, `story preview` the call and look at the page it would
store, `story publish` the same call, update the notes, `set_hierarchy`
([decision](../decisions/story-notes-are-agent-memory.md),
[decision](../decisions/a-story-preview-is-the-document-publish-would-store.md)).

**Data.** Identity, tenancy, evidence (records, attachments and their readings, derived texts,
the search index, comments, summaries and notes), synthesis (outcomes, revisions, assumptions, reviews), mockups (versions,
their pages and their files), Story (pages, versions, hierarchy) and operations (activity, jobs, exports, tombstones). Every table and
field: [data model](../spec/04-data-model.md).
