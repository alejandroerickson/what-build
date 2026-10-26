---
type: Decision
title: MCP exposes 13 tools, grouped by the kind of object, with an action parameter
description: Ten tools group each noun's operations behind `action` and `params`; three stand alone.
tags: [decision, mcp, agents]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# MCP exposes 13 tools, grouped by the kind of object, with an action parameter

## Context

More than a hundred separate tools would crowd an agent's context and bury the workflow. Agents work noun by noun.

## Decision

- Grouped tools: products, members, sources, attachments, derived, outcomes, assumptions, mockups, story, activity. Each takes `action`, `params`, `product`, and `describe` (returns the action's schema and guidance instead of running it).
- Standalone tools: `search`, `get_skill`, `submit_feedback`.
- A tool is named for what people and agents call the object: `attachments`, not the `files` table that holds them ([decision](a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
- Tools whose actions are all reads carry read-only annotations.
- A connection is listed only the actions its level allows ([decision](an-agent-connection-has-a-level-the-person-chooses.md)) and its person could do ([decision](an-agent-is-offered-only-what-its-person-could-do.md)).
- Every product-scoped result echoes the tenant, team, product and the caller's role.

## Consequences

- An agent sees a short tool list and pulls detail on demand with `describe`.
- Renaming or removing a tool reaches a connected client only in a new session: its tool list is
  the one it got when it connected ([§6.5](../spec/06-operations-and-adapters.md)).

## Constrains

- Group sentences live in `apps/server/src/mcp.ts`; keep them accurate when adding actions.

Specified in: [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [overview](../system/overview.md).
