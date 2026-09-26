# WhatBuild — product specification

**Status:** Draft 0.3 · 2026-09-26 · Phases 0–2 built, most of 3–5 built; see the
[roadmap](10-roadmap.md) for what is done and what is not. This is still the document we build from.

WhatBuild is open-source software for rapid product discovery. A team collects discovery
material — interviews, sales calls, research exports, documents, decks — and the application gives
that material an opinionated home, derives precise, addressable text from every source, and helps
the team turn it into objectives, insights, and reviewed assumptions and decisions, then tell the
story to stakeholders. A person works through a web application. An agent works through a Model
Context Protocol (MCP) server exposing the same operations. The product is agent-first: the MCP
surface is the most complete control panel, and the web UI is how a person does the same things.

It is **one hosted, multi-tenant service**. People sign up, create a team, invite colleagues, and
try it for free within published limits. The whole application also runs on a contributor's laptop
with one command, no accounts and no API keys — that is how it is developed and how CI runs it.

## What changed in draft 0.3

Draft 0.3 records what the first build settled, and adopts the owner's brief for tenancy and roles.

| Changed | Why |
|---|---|
| **Tenant → team → product, with roles** replaces team → project with "membership is the only access rule" ([§3](03-accounts-teams-and-identity.md)). Roles at three levels; the highest applies; no role means `404`; a too-low role means a `403` that names both roles. | The owner's direction: customer organizations containing several teams, each running several discoveries, with differentiated access. |
| **Product** replaces project; **Sources** replaces Library as the destination and the MCP tool. The file role stays **origin** (not "source"), so it cannot be confused with the destination. | The owner's vocabulary. |
| **Delete** needs editor (not merely membership) and keeps every other guard. | Roles now exist; delete is a content operation, so it sits with writing. |
| **Local development needs Node only.** Postgres comes from the embedded-postgres npm package; no Docker. | Removes the last thing a contributor has to install. CI uses the same path. |
| **Google Cloud Run** is the host: one image, migrations as a Cloud Run Job, Cloud Storage for blobs, Secret Manager for secrets ([deployment guide](../../deploy/cloud-run/README.md)). | The owner's choice. |
| **WhatBuild is its own OAuth authorization server** for MCP (dynamic registration, PKCE, rotating refresh tokens), instead of an auth library. Sign-in is email links and Google; there are no passwords. | Fewer moving parts, fully under test; Better Auth was not needed. |
| **One upload path for everyone.** A grant always points at the service's own relay (agents' sandboxes can reach it); large files may also get a direct signed bucket URL. The browser uses the same grants. | Agents' sandboxes often cannot reach the object store; one path means one set of rules. |
| The web UI uses **React Router** rather than TanStack Router. | Smaller surface; no loss for URL-held state. |
| The visual design remains **deliberately open**: the web app runs on a provisional, neutral token layer ([`apps/web/src/styles/tokens.css`](../../apps/web/src/styles/tokens.css)) meant to be replaced, and Story guidance embeds the same provisional values. | The owner will choose the design system. |

## What changed in draft 0.2

Draft 0.1 specified three deployment profiles — a browser profile storing data in the visitor's
own browser, a single-user local server, and a later multi-tenant cloud — plus a hosted **relay**
so that an agent could reach data living in a browser tab. That design bought a zero-install trial
at the cost of doubling the architecture, and the trial it bought defeated most of what the product
is for: a team, shared evidence, a colleague's agent writing into the same project.

Draft 0.2 deletes all of it.

| Removed | Added |
|---|---|
| The browser profile: SQLite WASM, OPFS, the worker transport, multi-tab ownership, storage-persistence prompts | Accounts, teams and invitations in the first product phase instead of the seventh |
| The relay: a stateful public service, capability URLs, pairing secrets, origin checks | A specified local development environment with its own acceptance test |
| SQLite entirely — two dialects, two full-text engines, two sets of migrations | A free tier with published numbers, metered and enforced |
| The single-user server profile, its loopback-means-no-sign-in rule and owner-passphrase auth | Durability and data rights as specification: backups with a rehearsed restore, revisions on every authored body, an activity log, team export, **delete alongside archive**, close-the-team |
| Browser-runnable constraints on `core` and `parsers`, and the CI that ran every test twice | A public read-only sample project — the new "see it in under a minute" |

Two renames ride along:

- **Sources → Library.** The screen, the route and the MCP tool now use the word the spec already
  used for the thing itself. `library` also covers documents and decks more comfortably than
  `sources` did. The file role `source` becomes `origin` so it does not collide, and
  `source_version_id` becomes `file_version_id`.
- **Workspace → team.** Settled 2026-09-19. "Team" is the word a person uses for the thing they
  create and invite people to, and "workspace" does not appear in the product.

And one rule is reversed outright. Draft 0.1 said **"nothing is deleted through the product"**;
draft 0.2 says destruction is never a *side effect*, which is a different and better claim.
**Archive and delete both exist.** Archive is the reversible default and always the first thing
offered: it takes an object out of listings, out of the main views, and out of the search space an
agent can reach, and erases nothing. **Delete is permanent, is available to every member through
both adapters including MCP**, and is guarded — by the current ETag, a required reason, an explicit
confirmation string, and a `delete_impact` preview that names the citations it will orphan — rather
than hidden behind a role or a surface. People upload the wrong file and are entitled to have it
gone. → [§9.5](09-data-lifecycle.md)

Unchanged: the product loop, the four screens, the vocabulary, the library taxonomy, the operation
registry and adapter parity, the derived layer, citations and the two registers, and Story in a
sandboxed frame.

## Reading order

| # | Document | What it settles |
|---|---|---|
| 1 | [Product](01-product.md) | The core loop, principles, non-negotiable behaviors, vocabulary |
| 2 | [Architecture](02-architecture.md) | Technology stack, ports, production and development environments, repository layout |
| 3 | [Accounts, teams, identity](03-accounts-teams-and-identity.md) | Sign-up, teams, invitations, projects, isolation, who the caller is |
| 4 | [Data model](04-data-model.md) | Every object, field, limit, and invariant |
| 5 | [Derived layer](05-derived-layer.md) | Parsers, sidecars, passage reads |
| 6 | [Operations and adapters](06-operations-and-adapters.md) | The operation registry, REST, MCP tools, skill delivery, upload flows |
| 7 | [Web application](07-web-app.md) | Screens, routes, the project switch — behavior, not visual design |
| 8 | [Search and retrieval](08-search.md) | Lexical search now, the retrieval improvements planned |
| 9 | [Data lifecycle](09-data-lifecycle.md) | Quotas, backups, versioning, export, archive and delete, closing a team, what we tell people |
| 10 | [Roadmap](10-roadmap.md) | Build phases with acceptance criteria, and open questions |

## Conventions

- **MUST / MUST NOT / SHOULD / MAY** carry their RFC 2119 meanings. Anything stated without one of
  these words is descriptive.
- **◆ Decision** marks a choice this spec makes that a reviewer may reasonably want to reverse. All
  of them are collected in [10-roadmap.md](10-roadmap.md#open-questions).
- Limits (character counts, page sizes, quotas) are normative defaults. Where a limit is
  operator-configurable the text says so.
- Identifiers are ULIDs unless stated otherwise. Timestamps are RFC 3339 UTC. Dates are
  `YYYY-MM-DD`.

## The decisions that shape everything else

1. **One hosted application, multi-tenant from the first migration.** Stateless Node processes in
   front of Postgres and an object store, serving many teams. Every row and every blob key carries
   the team; isolation is enforced in the core and again by the database.
   → [Architecture](02-architecture.md), [Accounts and teams](03-accounts-teams-and-identity.md)
2. **The whole thing runs on a laptop in one command.** No accounts, no API keys, no cloud services
   to provision. Development may substitute an adapter, never a behavior.
   → [Architecture §2.6](02-architecture.md)
3. **Operations are defined once.** A single operation registry generates the REST routes, the MCP
   tools, and their self-descriptions, so the two adapters cannot drift.
   → [Operations](06-operations-and-adapters.md)
4. **Tenant → team → product → everything.** A product is one discovery. Every object belongs to
   exactly one product; the product is explicit in every request.
   → [Accounts, tenants, teams, products, roles](03-accounts-teams-and-identity.md)
5. **Roles, checked in one place.** Viewer, editor and admin at the team or product, owner and admin
   at the tenant; the highest applies. What you cannot see answers `404`; what you can see but may
   not change answers `403` with both roles named. Agents act with exactly their person's role.
6. **Data leaves as easily as it arrives.** Complete export in an open format, by any member, at
   any time, never blocked by a quota. → [Data lifecycle](09-data-lifecycle.md)
