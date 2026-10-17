---
type: Decision
title: Only a source's primary file is parsed and searched
description: A source keeps originals and supplements, but exactly one primary file is parsed into passages and indexed.
tags: [decision, sources, search, derived]
generated: {by: agent:claude, at: 2026-10-16}
status: stable
---

# Only a source's primary file is parsed and searched

## Context

A recording, its raw transcript and a cleaned transcript are one piece of evidence. Searching all of them multiplies hits and makes a passage's address ambiguous.

## Decision

- Each file has a role: `primary`, `origin` or `supplement`. Exactly one primary per source.
- Parsing the primary produces an immutable derivation with numbered passages; earlier derivations stay readable.
- The interface says which files are searched and which are kept, not searched.

## Consequences

- A passage address (source + ¶n) is unambiguous.
- Changing the primary or re-parsing makes a new derivation; earlier ones stay readable.

## Constrains

- Parsers are pure functions in `packages/parsers`, run on the job queue, never inline in a request.

Specified in: [05-derived-layer](../spec/05-derived-layer.md), [04-data-model](../spec/04-data-model.md).
