---
type: Decision
title: MCP exposes 17 tools, grouped by the kind of object, with an action parameter
description: Thirteen tools group each noun's operations behind `action` and `params`; four stand alone.
tags: [decision, mcp, agents]
generated: {by: agent:claude, at: 2026-09-29}
status: stable
---

# MCP exposes 17 tools, grouped by the kind of object, with an action parameter

## Context

More than a hundred separate tools would crowd an agent's context and bury the workflow. Agents work noun by noun.

## Decision

- Grouped tools: products, members, sandbox, sources, files, derived, outcomes, insights, assumptions, decisions, story, lineage, activity. Each takes `action`, `params`, `product`, and `describe` (returns the action's schema and guidance instead of running it).
- Standalone tools: `search`, `read_passage`, `get_skill`, `submit_feedback`.
- Tools whose actions are all reads carry read-only annotations.
- Every product-scoped result echoes the tenant, team, product and the caller's role.

## Consequences

- An agent sees a short tool list and pulls detail on demand with `describe`.

## Constrains

- Group sentences live in `apps/server/src/mcp.ts`; keep them accurate when adding actions.

Specified in: [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [overview](../system/overview.md).
