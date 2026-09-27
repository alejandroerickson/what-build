---
type: Decision
title: Every capability is one registered operation, exposed through both REST and MCP
description: Operations are defined once with a Zod schema, access level, REST route and MCP action; both transports are generated from the registry.
tags: [decision, architecture, operations, rest, mcp]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Every capability is one registered operation, exposed through both REST and MCP

## Context

The web app, scripts and agents must be able to do the same things with the same rules. Hand-written endpoints per transport drift apart.

## Decision

- Each operation is declared once in `packages/core/src/ops/` with its name, scope, access (`read`, `write`, `admin`), input schema, REST mapping, MCP mapping and handler.
- REST routes and MCP tools are generated from that registry. Every operation has both (99 today).
- If the web app needs something, it becomes an operation; the UI has no private back door.

## Consequences

- Validation, authorization, attribution and activity logging happen in one place for every caller.
- An agent can do anything a person can do in the UI, as that person.
- The MCP tool list and `describe` output come straight from the schemas.

## Constrains

- New features start as an operation with tests, then UI.
- MCP tool grouping follows [its own record](mcp-tools-grouped-by-noun.md).

Specified in: [06-operations-and-adapters](../spec/06-operations-and-adapters.md).
