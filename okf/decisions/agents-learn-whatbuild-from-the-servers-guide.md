---
type: Decision
title: Agents learn WhatBuild from the server's own guide, with no skill to install
description: The installable skill is retired; a read-only guide tool serves topics that describe how WhatBuild works, without prescribing how to do discovery.
tags: [decision, mcp, agents, guide]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Agents learn WhatBuild from the server's own guide, with no skill to install

## Context

Agents used to install a versioned `whatbuild` skill, which the server's instructions told them
to check, fetch with `get_skill` and install. People had to install it in each client and keep it
in step with the server, and several copies drifted. Anthropic's Connectors Directory refuses
descriptions that send an agent to pull instructions from elsewhere. Much of the skill also
prescribed a way of doing discovery that many teams' agents would have had to work against. The
maintainer retired the skill on 2026-10-26.

## Decision

- The `guide` tool (`GET /api/v1/guide`) returns one topic of the guide as Markdown; without a
  topic, the index and the first topic. The topics are `packages/core/src/guide/NN-<topic>.md`,
  embedded by `scripts/gen-guide.mjs`.
- The guide describes what each object is, what people see, what the server enforces and refuses,
  limits, formats and the procedures a mechanism needs. It does not prescribe a method, an order of
  work, a writing style or how to talk with the person.
- The server's instructions and tool descriptions describe WhatBuild and its tools, and direct the
  agent to nothing outside them.
- `TOOLS_VERSION` versions the tool list and the guide. Answers give it as `tools_version`, so an
  agent learns its client holds an older list.

## Consequences

- Nothing to install, in any client, and the guide always matches the server it comes from.
- Skills people installed earlier go stale; their calls to old tool names are refused with the
  current names.

## Constrains

- Run `pnpm gen:guide` after editing a topic; CI fails when `guide-text.ts` drifts.
- An operation's `description` follows the same rule: what it does and refuses, not a method.

Specified in: [06-operations-and-adapters](../spec/06-operations-and-adapters.md).
