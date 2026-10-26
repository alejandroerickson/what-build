---
type: Decision
title: An agent is offered only what its person could do
description: An MCP connection lists the instance owners' actions to them alone, and a scoped connector lists only what its fence answers and the person's role inside it reaches, as the web app shows people only what they may do.
tags: [decision, mcp, agents, security]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# An agent is offered only what its person could do

## Context

A connection's tool list used to depend on its level alone, so every agent, a guest's included,
was offered the actions of whoever runs the WhatBuild (the allowances to start organizations,
every organization's plan, every account, the usage) and was refused them only when it called.
The web app shows none of that to anyone else. The maintainer decided on 2026-10-25 that an
agent's menu follows the person, as the web app's does.

## Decision

- An operation marked `instanceOwnersOnly` is listed only to an owner of the instance
  (`WHATBUILD_INSTANCE_OWNERS`). Called by anyone else, it is `422 unknown_action`, and
  `describe` says the same, so its existence is not confirmed.
- A connector scoped to a product or an organization lists only what its fence answers
  ([decision](a-scoped-mcp-connector-is-a-fence.md)) and what the person's role reaches there,
  capped by the connection's level: their role on the product, or the highest they hold anywhere
  in the organization. A call beyond that role still reaches `execute` and is told what it needs.
- The unscoped connector is not cut to a role: one connection spans organizations where the
  person holds different roles, and a person may start an organization and work in it at once.
- The list is computed when the client connects. Someone whose role or ownership changes starts
  a new session to see the new list.

## Consequences

- A guest's or reader's agent sees a short menu of what they can use.
- Roles a handler checks beyond an operation's declared access (granting a role on a product one
  administers) are not modelled in the list; such an action may be listed and then refused.

## Constrains

- The flag is on the operation (`packages/core/src/registry.ts`); its handler still refuses
  anyone else.
- Role filtering mirrors `resolveScope` through `roleReaches` and `highestRoleIn` in
  `packages/core/src/policy.ts`; the fence's static part is `connectorOffers` in
  `packages/core/src/connector-scope.ts`. Change them with the checks they mirror.

Specified in: [§6.5](../spec/06-operations-and-adapters.md#65-mcp).
