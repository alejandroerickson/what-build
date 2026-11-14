---
type: Decision
title: Every write is attributed, with the surface and the agent it came through
description: Writes store an actor snapshot naming the account, the surface and the agent's client, so agent work is never passed off as a person's.
tags: [decision, attribution, agents, trust]
generated: {by: agent:claude, at: 2026-11-13}
status: stable
---

# Every write is attributed, with the surface and the agent it came through

## Context

An agent writes with its person's credentials, so identity alone cannot say whether a person exercised judgment.

## Decision

- Every mutation stores `{account_id, display_name, surface, client}`, copied rather than joined, and appends an activity event.
- The surface says which door a write came through (`web` is a person in the app, `mcp` an agent), and `client` names the agent.
- Assumptions and their reviews also declared `author_type` / `reviewer_type` (`human` or `agent`), with a confidence rating only from a declared human. They were removed on 2026-11-13 ([decision](assumptions-are-removed-and-every-one-is-deleted.md)), and nothing else asks a writer to declare more than the surface says.

## Consequences

- The interface can say "Claude Code for Sam · via claude-code" and never pass agent work off as agreement.

## Constrains

- Never store an email address in attribution.

Specified in: [03-accounts-and-identity](../spec/03-accounts-and-identity.md), [04-data-model](../spec/04-data-model.md).
