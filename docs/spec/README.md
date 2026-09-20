# Rapid Discovery — product specification

**Status:** Draft 0.1 · 2026-09-19 · nothing is built yet; this is the document we build from.

"Rapid Discovery" is a working name (see [open questions](09-roadmap.md#open-questions)).

Rapid Discovery is open-source software for rapid product discovery. A team collects discovery
material — interviews, sales calls, research exports, documents, decks — and the application gives
that material an opinionated home, derives precise, addressable text from every source, and helps
the team turn it into objectives, insights, and reviewed assumptions and decisions, then tell the
story to stakeholders. A person works through a web application. An agent works through a Model
Context Protocol (MCP) server exposing the same operations. The product is agent-first: the MCP
surface is the most complete control panel, and the web UI is how a person does the same things.

## Reading order

| # | Document | What it settles |
|---|---|---|
| 1 | [Product](01-product.md) | The core loop, principles, non-negotiable behaviors, vocabulary |
| 2 | [Architecture](02-architecture.md) | Technology stack, the three deployment profiles, ports, repository layout |
| 3 | [Workspaces, projects, identity](03-tenancy-and-identity.md) | Multiple discoveries side by side, tenancy, who the caller is in each profile |
| 4 | [Data model](04-data-model.md) | Every object, field, limit, and invariant |
| 5 | [Derived layer](05-derived-layer.md) | Parsers, sidecars, passage reads |
| 6 | [Operations and adapters](06-operations-and-adapters.md) | The operation registry, REST, MCP tools, skill delivery, upload flows |
| 7 | [Web application](07-web-app.md) | Screens, routes, the project switch — behavior, not visual design |
| 8 | [Search and retrieval](08-search.md) | Lexical search now, the retrieval improvements planned |
| 9 | [Roadmap](09-roadmap.md) | Build phases with acceptance criteria, and open questions |

## Conventions

- **MUST / MUST NOT / SHOULD / MAY** carry their RFC 2119 meanings. Anything stated without one of
  these words is descriptive.
- **◆ Decision** marks a choice this spec makes that a reviewer may reasonably want to reverse. All
  of them are collected in [09-roadmap.md](09-roadmap.md#open-questions).
- Limits (character counts, page sizes) are normative defaults. Where a limit is operator-configurable
  the text says so.
- Identifiers are ULIDs unless stated otherwise. Timestamps are RFC 3339 UTC. Dates are
  `YYYY-MM-DD`.

## The decisions that shape everything else

1. **One TypeScript core, three profiles.** The same core runs in the visitor's browser for the
   trial we host (no install; data stored in the browser; agents connect through a relay we
   run), in a local or self-hosted Node server over SQLite and disk for real data, and in a
   multi-tenant cloud service over Postgres and object storage. → [Architecture](02-architecture.md)
2. **Operations are defined once.** A single operation registry generates the REST routes, the MCP
   tools, and their self-descriptions, so the two adapters cannot drift.
   → [Operations](06-operations-and-adapters.md)
3. **Workspace → project → everything.** A project is one product discovery. Every object belongs
   to exactly one project; the project is in every URL and every MCP call.
   → [Workspaces, projects, identity](03-tenancy-and-identity.md)
4. **Membership is the only access rule.** Every member of a workspace, human or agent, reads and
   writes everything in it. There is no permission model to administer.
