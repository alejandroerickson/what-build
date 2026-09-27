---
type: Decision
title: Archive is the reversible default; delete is permanent and guarded
description: Everything can be archived and restored; permanent deletion is explicit and shows its impact first.
tags: [decision, lifecycle, safety]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Archive is the reversible default; delete is permanent and guarded

## Context

Evidence is cited long after it is added. Losing it silently breaks conclusions.

## Decision

- Archiving hides an object from lists and search and makes it read-only; it keeps everything and can be restored.
- Deleting a source is permanent, needs an explicit call after `delete_impact`, and leaves a tombstone.
- The interface never calls archiving deleting.

## Consequences

- Citations to archived sources report `source archived`, not an error.

## Constrains

- Destructive operations require their guard; keep the vocabulary exact.

Specified in: [09-data-lifecycle](../spec/09-data-lifecycle.md).
