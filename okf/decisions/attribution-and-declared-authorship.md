---
type: Decision
title: Every write is attributed, and human or agent authorship is declared
description: Writes store an actor snapshot; register entries, reviews and insight reviews distinguish a person's judgment from an agent's.
tags: [decision, attribution, agents, trust]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Every write is attributed, and human or agent authorship is declared

## Context

An agent writes with its person's credentials, so identity alone cannot say whether a person exercised judgment.

## Decision

- Every mutation stores `{account_id, display_name, surface, client}`, copied rather than joined, and appends an activity event.
- Register entries and reviews declare `author_type` / `reviewer_type` (`human` or `agent`); a confidence rating is accepted only from a declared human.
- Marking an insight reviewed relays a person's judgment; agents may call it only to relay one.

## Consequences

- The interface can say "Claude Code for Sam · via claude-code" and never pass agent work off as agreement.

## Constrains

- Never store an email address in attribution.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md), [04-data-model](../spec/04-data-model.md).
