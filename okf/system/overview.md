---
type: System Concept
title: WhatBuild at three altitudes
description: The whole system from the top down, the major parts, and the mechanics underneath, with links to the detail.
tags: [overview, architecture, tenancy, access, mcp]
generated: {by: agent:claude, at: 2026-10-31}
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
React 19, React Router 7, TanStack Query 5, Vite 8; Vitest. Details in
[architecture](../spec/02-architecture.md).

**Operations.** 118 operations, each defined once and exposed through both REST and MCP, but for
seventeen: running the instance (its owners' ten actions on plans, organizations, guests,
allowances, accounts and usage, and removing an account), renaming an organization or a product,
which its owners or admins do, deleting an organization and previewing that delete, which only its
owners or an instance owner do, and deleting one's own account and previewing that, which only its
person does, all in the web app. Agents are offered the other 101, as 29 tools
([decision](../decisions/one-registry-two-front-doors.md),
[decision](../decisions/running-the-instance-is-done-in-the-web-app-never-by-an-agent.md)).

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
is offered, and an agent is offered only what its person could do
([decision](../decisions/access-is-per-product-roles.md),
[decision](../decisions/built-in-identity-and-oauth.md),
[decision](../decisions/an-agent-connection-has-a-level-the-person-chooses.md),
[decision](../decisions/an-agent-is-offered-only-what-its-person-could-do.md)).

**The example organization and plans.** The maintainer's public deployment names one organization
as its example (`WHATBUILD_EXAMPLE_TENANT`; a self-hosted deployment has none). Every signed-in
account reads it as its guest, a viewer of every product there, and nobody but its own members
changes it
([decision](../decisions/every-account-reads-the-example-organization-which-only-its-staff-write.md)).
Every organization is on a plan of its own: one the deployment defines (`WHATBUILD_PLANS`), or
unlimited. The plans, their limits and prices are the deployment's, never the code's, and a
deployment that defines none, as a self-hosted one, has every organization unlimited and shows
nothing of plans; billing is kept outside this repository
([decision](../decisions/the-deployment-defines-its-plans-and-billing-stays-outside-the-repository.md)). One someone other than an instance owner creates gets the deployment's starting
plan (`WHATBUILD_NEW_ORGANIZATION_PLAN`, unlimited unless named). Limits belong to plans, never to
one organization: on a plan the deployment defines everyone in it meets limits on how often and
how much each day and on what the organization holds, and only instance owners move an
organization to another plan, or change a plan's limits and price
([decision](../decisions/limits-belong-to-plans-and-each-organization-is-on-a-plan-of-its-own.md)).
An account in no organization is a **guest**: it reads the example organization while there is
room among a few places, and otherwise waits in line; an instance owner sets how many, and may let
anyone sign up as one
([decision](../decisions/guests-come-into-the-example-organization-while-there-is-room.md)).

**MCP.** `/mcp` for every product the account can reach, `/mcp/t/<tenant>` for one organization,
or `/mcp/t/<tenant>/<team>/<product>` for one product. A scoped endpoint is a fence: it refuses
every call outside its scope, and its token works nowhere wider
([decision](../decisions/a-scoped-mcp-connector-is-a-fence.md)). 29 tools: for each noun a
`_read`, a `_write` and, where something can be deleted for good, a `_delete` tool, each with
`action`, `params`, `describe` and `product`, a title and a read-only or destructive hint, plus
`products_export`, which is neither, and `search`, `guide` and `submit_feedback`
([decision](../decisions/mcp-tools-are-split-into-read-write-and-delete.md)). The server's
instructions describe WhatBuild and its tools; the `guide` tool explains how it works, one topic at
a time, with nothing to install
([decision](../decisions/agents-learn-whatbuild-from-the-servers-guide.md)). Source text is quoted
material.

**The experience.** One floating panel (Idea, Evidence, Exploration, Story, then Connect an agent,
Activity and Settings) that hides fully; the screen beside it; an inspector on the Story, a mockup
and a source page. No
in-app tabs; rows are real links; works in a phone browser, light and dark
([decision](../decisions/studio-design-system.md), [web app](../spec/07-web-app.md)).

## 100 ft: mechanics

**One request.** Identify the caller (cookie on REST, OAuth token on MCP → account,
surface, client, and for an agent its connection's level) → refuse an operation above that level
(`403`) → resolve tenant, team and product → authorize (`404`/`403`) → refuse a guest's
write in the example organization, and on a plan with limits admit the call to them
(`403`/`429`) → validate with the
operation's schema (`422` lists every problem) → open a transaction with `app.tenant_id` set → run
the handler (etag check, `409 stale_etag`; actor snapshot; activity event) → answer as JSON or MCP
text with the scope echoed.

**From upload to text.** Request a signed upload grant → bytes go to object storage →
the upload relay adds the attachment as they arrive (`complete_upload` does, after a PUT straight to
the bucket) → a job to read it is queued → the worker reads it,
in a process of its own held to a memory and a time limit, into an immutable reading
(`text.md`, `manifest.json`) → when the source has no text, or its text is still this
attachment's, the reading becomes the source's derived text, and its pieces are indexed for search
in the same transaction ([derived layer](../spec/05-derived-layer.md),
[search](../spec/08-search.md),
[decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md),
[decision](../decisions/each-file-is-parsed-in-a-process-of-its-own-so-a-parse-that-ends-in-a-fatal-error-ends-only-itself.md)).
Every write of a source's title, tags, summary, notes, text or comments indexes it again the same
way.

**An agent's session**, as one might go. `products_read list` → `guide` for a topic it needs →
`sources_read facets` and upload through `attachments_write` → `search`, then `derived_read text`
around a hit → `assumptions_write create`, saying why in its body →
`mockups_write publish` a canvas with its brief, or `get_download` a version, build the next one in a
project and publish the pages that changed
([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)) → read
`story_read guidance` and the page's notes, `story_read preview` the call and look at the page it
would store, `story_write publish` the same call, update the notes, `set_hierarchy`
([decision](../decisions/story-notes-are-agent-memory.md),
[decision](../decisions/a-story-preview-is-the-document-publish-would-store.md)).

**Data.** Identity, tenancy, evidence (records, attachments and their readings, derived texts,
the search index, comments, summaries and notes), synthesis (outcomes, revisions, assumptions, reviews), mockups (versions,
their pages and their files), Story (pages, versions, hierarchy) and operations (activity, jobs, exports, tombstones). Every table and
field: [data model](../spec/04-data-model.md).
