---
type: Decision
title: An agent is offered only what its person could do
description: An MCP connection lists the instance owners' actions to them alone, and a scoped connector lists only what its fence answers and the person's roles inside it reach, as the web app shows people only what they may do; a call to anything else is still refused with what it needs.
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
  (`WHATBUILD_INSTANCE_OWNERS`), as far as the connection's level allows.
- A connector scoped to a product or an organization lists only what its fence answers
  ([decision](a-scoped-mcp-connector-is-a-fence.md)) and what the person's roles reach there:
  their role on the product, or the highest they hold in the organization, on its teams for a
  team's operations. An organization's operation whose handler checks a role where the call
  points declares it (`needsSomewhere`), so managing people is listed only to an admin of
  something there.
- A call to anything not listed is answered as before, with what it needs (`403`), never as
  `unknown_action`: that answer, and a newer skill version, are how an agent knows its tool list
  is from another version. Rejected: answering an instance owner's action as unknown, which the
  skill documents for every agent, and which would send the person to restart for nothing.
- The unscoped connector is not cut to a role: one connection spans organizations where the
  person holds different roles, and a person may start an organization and work in it at once.
- The list is computed when the client connects. Someone whose role or ownership changes starts
  a new session to see the new list.

## Consequences

- A guest's or reader's agent sees a short menu of what they can use.
- The server's instructions and the skill say a tool or action may be missing on purpose, so an
  agent no longer reads a missing tool as an older list.

## Constrains

- The flags are on the operation (`packages/core/src/registry.ts`); handlers still refuse anyone
  else, and `execute` still authorizes every call.
- Role filtering mirrors `resolveScope` through `roleReaches` and `highestRolesIn` in
  `packages/core/src/policy.ts`; the fence's static part is `connectorOffers` in
  `packages/core/src/connector-scope.ts`. Change them with the checks they mirror.

Specified in: [§6.5](../spec/06-operations-and-adapters.md#65-mcp).
