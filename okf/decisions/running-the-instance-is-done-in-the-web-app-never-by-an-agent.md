---
type: Decision
title: Running the instance is done in the web app, never by an agent; the MCP server is for discovery work
description: The instance owners' actions (organizations and their plans, plans' limits, guests, allowances and the waitlist, accounts, usage) are web-only, so no MCP connection lists them, an agent's call to one is told where a person does it, and an instance owner reaches an organization they are not in only in the web app.
tags: [decision, mcp, agents, instance, security]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Running the instance is done in the web app, never by an agent; the MCP server is for discovery work

## Context

An instance owner's MCP connection was offered ten actions nobody else's was: every organization,
account and guest setting, the allowances and the waitlist, the usage, and moving an organization
to another plan, changing a plan's limits, setting the guests' and changing the allowances. One
such write changes what every organization on a plan may do, or who gets in; the Edit level, the
default, was enough for some of them; and they crowded the tool list an instance owner uses for
their own product work. A call to a web-only action was answered `422 unknown_action`, which tells
an agent its tool list is from another version. The maintainer set the rule below on 2026-10-26.

## Decision

- **The MCP server is for discovery work**, and for work whose amount does not scale for people
  and should be done by agents. Running the instance is neither: an instance owner does it in the
  web app, on Organizations (`/instance`) and People (`/people`).
- **Every operation only the instance's owners have is web-only** (`instanceOwnersOnly` with
  `webOnly`): `organizations`, `set_plan`, `set_plan_limits`, `guests`, `set_guests`,
  `tenant_allowances`, `set_tenant_allowance`, `remove_tenant_allowance`, `accounts` and `usage`,
  with `remove_account` as before. No connection lists them, at any level, an instance owner's
  included. REST keeps them, for the web app and a deployment's own billing service.
- **A web-only operation says where a person does it**, and an agent's call to one, in any of its
  noun's tools and with `describe` too, is refused `403 web_only` with that place, saying it is no
  sign of an older tool list. `unknown_action` keeps meaning a list from another version.
- How the instance is used is read with its usage report (`pnpm usage`), never over MCP.
- **An instance owner reaches an organization they are not in only in the web app**: renaming
  it (`allowInstanceOwners`) works there, and their agent, like anyone's, acts only where their
  own roles reach, so it finds such an organization missing (`404`).
- Rejected: keeping them on an Admin connection. A write would still reach every organization on a
  plan without the dialogs that show what it does first.

## Consequences

- An agent can no longer be asked to move an organization to another plan, or to let someone in
  from the waitlist. It tells the person where that is done instead.
- An instance owner's tool list is the one anyone who may start an organization gets.

## Constrains

- An operation marked `instanceOwnersOnly` is `webOnly` too, which `apps/server/test/mcp.test.ts`
  checks. `webOnly` holds the place a person does it (`packages/core/src/registry.ts`).
- The refusal is `webOnlyRefusal` (`packages/core/src/execute.ts`): `execute` gives it to any door
  but the web app, and `apps/server/src/mcp.ts` to a call to a web-only action before any lookup.
- `execute` lets an instance owner in as an organization's owner (`asInstanceOwner`) only on the
  web surface.

Revises [An agent is offered only what its person could do](an-agent-is-offered-only-what-its-person-could-do.md),
which listed the instance owners' actions to them alone, and
[An organization's owners, and the instance's owners, rename it](an-organizations-owners-rename-it-and-its-former-slugs-still-reach-it.md),
whose instance owners renamed any organization through either door.

Specified in: [§6.5](../spec/06-operations-and-adapters.md#65-mcp), [§3.3](../spec/03-accounts-teams-and-identity.md#33-tenants-and-teams).
