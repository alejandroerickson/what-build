---
type: Decision
title: Citations freeze a snapshot and report drift; they are never repaired silently
description: A citation stores the exact passage text when written; a check re-resolves it and reports the result in words.
tags: [decision, citations, trust, assumptions, story]
generated: {by: agent:claude, at: 2026-10-16}
status: deprecated
---

# Citations freeze a snapshot and report drift; they are never repaired silently

Superseded on 2026-10-16 by [Evidence is found by searching, not kept as citations](evidence-is-searched-not-cited.md).

## Context

A conclusion is only as good as the words it rests on, and sources get re-parsed and replaced.

## Decision

- A citation names a source and passage range, with an optional quote; on save it is resolved and a snapshot is frozen.
- `check_citations` reports ok, relocated, text changed, source archived, deleted or missing, and flags a citation whose source was parsed again since the snapshot. It never rewrites.
- Readers follow the quote rather than the stored numbers: after a source is parsed again, a citation's link and the passages marked as cited are where the quote is found now, and a quote no longer found marks nothing. The snapshot stays as written; only where a reader is sent changes.
- A check is valid when every quote holds in the passages of its source's current file. A newer file is reported, but does not by itself make a check invalid; a newer file whose passages have not been read yet does, and says so.
- A quote is found exactly where possible; a match that holds only once markup, spacing and speaker labels are set aside is reported as such, never as silent equality.
- Assumptions, Story pages and mockups cite this way. After an assumption is reviewed, its statement and citations are frozen; correct it by superseding.

## Consequences

- Anyone can answer "where did we hear that?" and see whether it still holds.

## Constrains

- Citation code is shared in `packages/core/src/citations.ts`.

Specified in: [04-data-model](../spec/04-data-model.md).
