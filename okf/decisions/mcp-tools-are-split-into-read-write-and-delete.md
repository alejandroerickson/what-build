---
type: Decision
title: Each kind of object has a read, a write and a delete tool, so no MCP tool both reads and changes data
description: The noun-grouped tools are split by what they do to data, each with a title and a hint a client can ask the person by; actions, params and describe stay.
tags: [decision, mcp, agents]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Each kind of object has a read, a write and a delete tool, so no MCP tool both reads and changes data

## Context

Thirteen tools grouped by noun ([superseded](mcp-tools-grouped-by-noun.md)) kept the list short,
but ten of them mixed reads and writes behind `action`, and only the all-read ones carried
annotations. Clients decide whether to ask the person before a call from a tool's annotations, and
Anthropic's Connectors Directory refuses a tool that accepts both safe and unsafe operations. The
maintainer chose, on 2026-10-26, a read, a write and a delete tool per noun over a two-way split
(deletes beside edits) and a split by create, update and delete (about 40 tools).

## Decision

- An action is in `<noun>_read` if it changes nothing, `<noun>_delete` if it is a permanent
  delete (its REST method is DELETE), and `<noun>_write` otherwise. `mcpTool` in
  `packages/core/src/registry.ts` decides it from the operation, so no tool can mix them.
- Every tool has a `title`. A read tool says `readOnlyHint: true`; a write or delete tool says
  `destructiveHint: true`, so a client may ask before each call, and a person can allow a noun's
  writes without allowing its deletes. Only `attachments_write`, which fetches from the web, says
  `openWorldHint: true`.
- Each tool keeps `action`, `params`, `product` and `describe`. `search`, `guide` and
  `submit_feedback` stand alone. Tools are listed noun by noun, read, write, delete.
- An action called in another of its noun's tools is refused with `422 wrong_tool`, naming the
  tool it is in. A call to a noun's old tool name says where its actions went.

## Consequences

- About 28 tools instead of 13. A Read only connection lists only reads (and the one write it may
  make, an export), and only an Admin connection lists the delete tools.
- Every client that connected before the split holds the old list until a new session.

## Constrains

- Tool titles and description sentences live in `TOOL_TEXT` in `apps/server/src/mcp.ts`, each
  sentence with the actions it speaks of; keep them accurate when adding actions.
- `apps/server/test/mcp.test.ts` checks that no tool mixes kinds and that every tool has a title
  and its hint.

Specified in: [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [overview](../system/overview.md).
