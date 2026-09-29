---
type: Index
title: The WhatBuild specification is ten documents, read in order.
description: What WhatBuild is in one paragraph, the ten spec files with what each settles, the conventions they share, and the decisions that shape the rest.
tags: [spec, index, conventions]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# WhatBuild specification

The bundle's entry point is [okf/index.md](../index.md); this file maps the `spec/` directory. What
is built and what is not is tracked in the [roadmap](10-roadmap.md).

WhatBuild is open-source software for rapid product discovery. A team collects discovery
material (interviews, sales calls, research exports, documents, decks) and the application gives
that material an opinionated home, derives precise, addressable text from every source, and helps
the team turn it into outcomes, insights, and reviewed assumptions and decisions, then tell the
story to stakeholders. A person works through a web application. An agent works through a Model
Context Protocol (MCP) server exposing the same operations. The product is agent-first: the MCP
surface is the most complete control panel, and the web UI is how a person does the same things.

It is **one hosted, multi-tenant service**, deployed on Google Cloud Run
([deployment guide](../operations/cloud-run.md)). The whole application also runs on a
contributor's laptop with one command, needing only Node: no Docker, no accounts and no API keys.
That is how it is developed and how CI runs it.

## Reading order

| # | Document | What it settles |
|---|---|---|
| 1 | [Product](01-product.md) | The core loop, the four screens, vocabulary, non-negotiable behaviors |
| 2 | [Architecture](02-architecture.md) | Technology stack, ports and adapters, production and development environments, repository layout |
| 3 | [Accounts, tenants, teams, products, roles](03-accounts-teams-and-identity.md) | Sign-in, the tenant → team → product hierarchy, roles, isolation, who the caller is |
| 4 | [Data model](04-data-model.md) | Every object, field, limit and invariant |
| 5 | [Derived layer](05-derived-layer.md) | Parsers, sidecars, passage reads |
| 6 | [Operations and adapters](06-operations-and-adapters.md) | The operation registry, REST, MCP tools, skill delivery, upload flows |
| 7 | [Web application](07-web-app.md) | The shell, screens and routes (behavior; the look is in [DESIGN.md](../../DESIGN.md)) |
| 8 | [Search and retrieval](08-search.md) | Lexical search now, the retrieval improvements planned |
| 9 | [Data lifecycle](09-data-lifecycle.md) | Quotas, backups, versioning, export, archive and delete, closing a tenant, what we tell people |
| 10 | [Roadmap](10-roadmap.md) | Build phases with acceptance criteria and status, and open questions |

## Conventions

- **MUST / MUST NOT / SHOULD / MAY** carry their RFC 2119 meanings. Anything stated without one of
  these words is descriptive.
- **◆ Decision** marks a choice this spec makes that a reviewer may reasonably want to reverse. All
  of them are collected in [10-roadmap.md](10-roadmap.md#open-questions).
- **Planned** marks behavior the spec requires that the code does not have yet; the
  [roadmap](10-roadmap.md) says where it stands.
- Limits (character counts, page sizes, quotas) are normative defaults. Where a limit is
  operator-configurable the text says so.
- Identifiers are ULIDs unless stated otherwise. Timestamps are RFC 3339 UTC. Dates are
  `YYYY-MM-DD`.

## The decisions that shape everything else

1. **One hosted application, multi-tenant from the first migration.** Stateless Node processes in
   front of Postgres and an object store, serving many tenants. Every content row and every blob
   key carries the tenant; isolation is enforced in the core and again by the database.
   → [Architecture](02-architecture.md), [Accounts and tenants](03-accounts-teams-and-identity.md)
2. **The whole thing runs on a laptop in one command.** No accounts, no API keys, no cloud services
   to provision, and nothing to install but Node. Development may substitute an adapter, never a
   behavior. → [Architecture §2.6](02-architecture.md)
3. **Operations are defined once.** A single operation registry generates the REST routes, the MCP
   tools, and their self-descriptions, so the two adapters cannot drift.
   → [Operations](06-operations-and-adapters.md)
4. **Tenant → team → product → everything.** A product is one discovery. Every object belongs to
   exactly one product; the product is explicit in every request.
   → [Accounts, tenants, teams, products, roles](03-accounts-teams-and-identity.md)
5. **Roles, checked in one place.** Viewer, editor and admin at the team or product, owner and admin
   at the tenant; the highest applies. What you cannot see answers `404`; what you can see but may
   not change answers `403` with both roles named. Agents act with exactly their person's role.
6. **Destruction is never a side effect.** Archive is the reversible default; delete is permanent,
   guarded, available to editors through both adapters, and leaves a tombstone.
   → [Data lifecycle §9.5](09-data-lifecycle.md)
7. **Data leaves as easily as it arrives.** A product exports completely, in an open format, for
   anyone who can read it, at any time, never blocked by a quota. → [Data lifecycle](09-data-lifecycle.md)
