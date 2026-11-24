---
type: Decision
title: Mockups and Story pages keep their newest versions, as many as the plan says, and a mockup keeps what the Story shows
description: Publishing past a plan's number of versions deletes the oldest, so what a deployment holds of earlier versions stays bounded; a mockup version a Story page shows is never deleted.
tags: [decision, mockups, story, plans, limits, data-lifecycle]
generated: {by: agent:claude, at: 2026-11-23}
status: stable
---

# Mockups and Story pages keep their newest versions, as many as the plan says, and a mockup keeps what the Story shows

## Context

Every version of a mockup is the whole canvas, its unchanged pages stored again, so a canvas
revised often holds many copies of the same HTML, and mockup HTML grows to most of the database,
of every backup and of what each nightly dump reads. Keeping every version forever made that growth
unbounded. The maintainer chose on 2026-11-23 to keep only the newest versions: 5 on the example
Free plan, 10 on Pro and on Unlimited, with any version the Story shows kept as well.

## Decision

- Each plan sets `mockup_versions_max` and `story_page_versions_max` (at least 1, or null for every
  version), totals of what each product holds. A plan that leaves them out, `unlimited`, and a
  deployment with no plans keep 10.
- Publishing a version past them deletes the oldest, for good, in the same call; nothing is refused.
- A mockup keeps every version a Story page version shows, past its number; a Story page keeps only
  its newest. When a Story trim deletes the last version showing a mockup version, the mockup trims.
- Numbers are never reused, and a read of a deleted version answers `410 version_deleted`.
- Rejected: refusing a publish at the limit, since an agent's next version is the work; and a
  sweep when a release deploys or a plan changes, since a trim at the next publish deletes nothing
  nobody was working on.

## Consequences

- What a deployment holds of earlier versions is bounded per mockup and per page; restoring a
  version older than the number is no longer possible.
- A plan lowered later trims each object at its next version, not at once.

## Constrains

- Only `packages/core/src/ops/versions-kept.ts` deletes versions; every operation that adds a version
  calls its trim, and a mockup version a Story page version names is never deleted.
- `version_count` stays the newest number; a count of versions held is read from the rows.

Specified in: [§9.7](../spec/09-data-lifecycle.md#97-plans-and-limits),
[§4.11 and §4.12](../spec/04-data-model.md).
