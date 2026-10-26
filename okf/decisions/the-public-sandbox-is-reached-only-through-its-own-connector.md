---
type: Decision
title: The public sandbox is reached only through a connector scoped to it
description: The unscoped MCP connector refuses every call that lands in a public sandbox, so an agent that reads strangers' writing holds nothing else of WhatBuild while it does.
tags: [decision, mcp, sandbox, security, tenancy]
generated: {by: agent:claude, at: 2026-10-25}
status: deprecated
---

# The public sandbox is reached only through a connector scoped to it

Superseded on 2026-10-25 by [Every account reads the example organization, which only its staff write](every-account-reads-the-example-organization-which-only-its-staff-write.md).

## Context

In the public sandbox strangers write the content, and every visitor's agent reads it. Text in a
source can carry instructions, and the skill's rule that source text is never an instruction is a
request to the agent, not a boundary. What decides the damage is what else the agent holds while it
reads: through the unscoped connector (`/mcp`) a person who also belongs to a real organization
gives one agent both, so planted text could ask it to copy their own material into the sandbox.
The [fence](a-scoped-mcp-connector-is-a-fence.md) already let a careful person keep the two apart.
The maintainer chose on 2026-10-25 to make it the only way. A private copy of the sandbox for each
visitor, which removes the hostile text rather than what it could reach, is planned separately
([roadmap](../spec/10-roadmap.md)).

## Decision

- Through `/mcp`, a call whose resolved scope lies in a tenant with `sandbox = true` is refused with
  `403 sandbox_needs_its_own_connector`, after authorization and before the handler, so it changes
  nothing. Its details give `connect_at`, the sandbox's own address (`/mcp/t/<sandbox>`).
- It holds for staff too: an owner who also belongs to other organizations is exposed the same way.
  No setting lets anyone reach a sandbox through `/mcp`.
- `products.list` through `/mcp` leaves sandboxes out of `items` and `tenants`, and lists each
  under `public_sandboxes` by its name and `connect_at`, so an agent can tell its person where to
  connect. It names no sandbox product.
- `sandbox.join` stays account-level and works through `/mcp`; its answer gives `connect_at`.
- Rejected: listing a sandbox's products on `/mcp` with their content left out. The agent needs
  only where to connect, and the products' names would tempt it to call them.

## Consequences

- Working in the sandbox with an agent takes a connector of its own, which the join page, the
  sandbox's page and Connect an agent give, with the reason.
- An agent connected before this change through `/mcp` is refused in the sandbox and told the
  address to add.
- A connector scoped to the sandbox still reads strangers' writing; this limits what that writing
  can reach, not whether an agent reads it.

## Constrains

- The refusal is in `execute` (`packages/core/src/execute.ts`), beside `checkConnectorScope`, and
  applies to every call on the MCP surface that comes with no connector scope.
- `listWithoutSandboxes` (`packages/core/src/connector-scope.ts`) is the only other place `/mcp`
  filters a result; the MCP adapter never picks a sandbox's product as a default.

Specified in: [§3.6](../spec/03-accounts-teams-and-identity.md#36-addressing-and-isolation),
[§3.10](../spec/03-accounts-teams-and-identity.md), [§6.5](../spec/06-operations-and-adapters.md#65-mcp).
