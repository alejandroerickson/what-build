---
type: Decision
title: Citations freeze a snapshot and report drift; they are never repaired silently
description: A citation stores the exact passage text when written; a check re-resolves it and reports the result in words.
tags: [decision, citations, trust, assumptions, story]
generated: {by: agent:claude, at: 2026-09-27}
status: stable
---

# Citations freeze a snapshot and report drift; they are never repaired silently

## Context

A conclusion is only as good as the words it rests on, and sources get re-parsed and replaced.

## Decision

- A citation names a source and passage range, with an optional quote; on save it is resolved and a snapshot is frozen.
- `check_citations` reports ok, relocated, text changed, source archived, deleted or missing, and flags a citation whose source was parsed again since the snapshot. It never rewrites.
- A quote is found exactly where possible; a match that holds only once markup, spacing and speaker labels are set aside is reported as such, never as silent equality.
- Assumptions, Story pages and mockups cite this way. After an assumption is reviewed, its statement and citations are frozen; correct it by superseding.

## Consequences

- Anyone can answer "where did we hear that?" and see whether it still holds.

## Constrains

- Citation code is shared in `packages/core/src/citations.ts`.

Specified in: [04-data-model](../spec/04-data-model.md).
