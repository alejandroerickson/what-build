---
type: Decision
title: An agent connection has a level the person chooses, which caps their role
description: Read only, Edit (the default) or Admin, chosen on the consent page and changed only by the person, so an agent is never offered more than it was given.
tags: [decision, oauth, mcp, roles, safety]
generated: {by: agent:claude, at: 2026-10-12}
status: stable
---

# An agent connection has a level the person chooses, which caps their role

## Context

A token carried exactly its person's roles, so an admin's agent could delete permanently whenever
the admin could. Agents act on loose instructions, and the costly mistake is deleting what should
have been archived. The maintainer chose on 2026-10-12 to let a person set what each connection
may do, and to keep an agent from raising it through MCP; an agent that leaves MCP for the browser
or the API is out of scope.

## Decision

- Three levels: Read only (`viewer`), Edit (`editor`) and Admin (`admin`). The person chooses one
  on the consent page; Edit is chosen unless they change it, and connections made before levels
  existed are Edit.
- A level caps the person's role and never adds to it: an agent acts as the lower of the two.
  Edit acts as an editor, so it neither deletes nor manages products and people.
- Each operation needs a level, from its access unless it says otherwise. `execute` refuses one
  above the connection's (`403 connection_level`), and MCP lists only what the level allows.
- Only the person changes a level, in the web app; no operation an agent can call reaches it.
- Rejected: a level that only gates delete, leaving admin's other powers to every connection;
  OAuth `scope` strings, which clients rarely let a person choose.

## Consequences

- An admin who wants an agent to manage people or delete raises its connection to Admin.
- An Edit connection is never shown a permanent delete, so it cannot be talked into one.

## Constrains

- Levels live on `oauth_tokens.level`; `connectionNeeds`, `levelAllows` and `capRole` in
  `packages/core/src/registry.ts` decide them, applied in `execute` and `apps/server/src/mcp.ts`.

Specified in: [§3.8](../spec/03-accounts-teams-and-identity.md#38-identity-of-the-caller),
[§6.5](../spec/06-operations-and-adapters.md#65-mcp).
