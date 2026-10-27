---
type: Decision
title: Connect an agent leads with one address, and limiting an agent is a choice behind it
description: The page gives `/mcp` first, the address a connectors directory lists; the scoped addresses stay, behind a quiet button.
tags: [decision, mcp, agents, web]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Connect an agent leads with one address, and limiting an agent is a choice behind it

## Context

Connect an agent asked what an agent could reach before it gave an address, and outside a product
it opened on one organization, so most people copied a scoped address they had no need for. A
connectors directory lists one address per server, `/mcp`, and most people have one organization
of their own and read the example organization, which `/mcp` already reaches safely. Scoped
connectors still matter to someone in several organizations who wants an agent kept to one
([decision](a-scoped-mcp-connector-is-a-fence.md)). The maintainer chose this layout from a
wireframe on 2026-10-26.

## Decision

- Step one gives `/mcp`, and says the agent can open every product the person can and reads the
  example organization without changing it.
- A quiet button, closed by default, opens the choices: everything, one organization or one
  product, and the scoped address for the choice. Closing it goes back to `/mcp`.
- Step two shows the three levels and what each may do, since a client asks before each write and
  delete the level allows.

## Consequences

- Scoped connectors work as before; only how often people choose one changes.
- A link that names a limited choice (`?reach=organization&org=…`) opens with the choices shown.

## Constrains

- `apps/web/src/routes/connect.tsx`; `apps/web/test/connect-page.test.tsx` checks the default and
  the choices.

Specified in: [06-operations-and-adapters](../spec/06-operations-and-adapters.md) §6.8, [07-web-app](../spec/07-web-app.md).
