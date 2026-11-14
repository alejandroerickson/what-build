---
type: Decision
title: Assumptions are removed, and a migration deletes every one on every deployment
description: Writing assumptions down and agreeing on them is too slow for how product teams work now and nobody relies on what they hold, so WhatBuild keeps none, and migration 0046 deletes them, their reviews and their history for good, moving nothing anywhere.
tags: [decision, product, exploration, assumptions, data, migrations, mcp]
generated: {by: agent:claude, at: 2026-11-13}
status: stable
---

# Assumptions are removed, and a migration deletes every one on every deployment

## Context

Exploration held a reviewed register of assumptions beside the mockups: statements a team treated
as true while the evidence was incomplete, each with reviews that froze its wording, corrections
that superseded it, links to other entries and the outcomes it served. Keeping it meant writing
each premise down and agreeing on it before the work moved on, which is slower than product teams
work now that agents read and search the evidence for them. Nobody relied on what the registers
held. Retiring them into Evidence, as insights and decisions were
([decision](insights-and-decisions-are-retired-into-evidence.md)), would keep material no one
reads. The maintainer chose on 2026-11-13 to remove assumptions and delete every one, on every
deployment, whether anyone uses them or not, warning deployments first.

## Decision

- WhatBuild keeps no assumptions. The 11 operations `assumptions.list`, `get`, `create`,
  `update`, `review`, `supersede`, `link`, `unlink`, `archive`, `delete_impact` and `delete` are
  gone, with their REST routes and the MCP tools `assumptions_read`, `assumptions_write` and
  `assumptions_delete`. A client holding an older tool list that calls one is told assumptions are
  retired and WhatBuild no longer keeps them.
- Migration `0046_no_assumptions.sql` deletes every assumption in every product, archived or not,
  with its reviews, its revisions, its activity entries and its tombstones. Nothing is moved into
  Evidence or anywhere else, and nothing is left saying one was there.
- What stays: `register_entries` and `reviews`, holding only decisions still waiting to be moved
  into Evidence and their reviews, with the entries' `kind` narrowed to `decision`, until the move
  is done everywhere and a later migration drops them.
- Exploration holds mockups only. Outcomes are pointed at by nothing. Search reads no assumptions
  in any mode, the word "assumptions" names no kind, and an export has no `assumptions.json`.
- Rejected: moving assumptions into Evidence as sources, which keeps what nobody reads; keeping
  them read-only, which keeps a screen, a tool and a count for nothing.

## Consequences

- The product, the tools, the guide and the documentation lose a whole object and its rules
  (reviews, freezing, superseding, confidence, declared authorship).
- The deletion cannot be undone in WhatBuild. An organization that wants its assumptions exports
  its products before its deployment takes the release; the upgrading notes say so plainly.
- Going back past the release needs the database restored from before it, as for any release that
  migrates.

## Constrains

- No operation, screen, search kind, export file or guide topic names assumptions again; an old
  address under `/exploration/assumptions/…` opens Exploration's mockups with a toast that says
  WhatBuild no longer keeps them.
- No operation reads or writes `register_entries` or `reviews`: only the move into Evidence
  (`packages/core/src/evidence-move.ts`) reads them, and deletes what it moves, and deleting a
  product or an organization deletes its rows there with everything else.
- The [upgrading notes](../operations/upgrading.md) warn every deployment before it takes the
  release, and the release is rehearsed on the dev deployment first.

Specified in: [§4.8](../spec/04-data-model.md#48-assumptions-retired),
[§6.4](../spec/06-operations-and-adapters.md), [§7.7](../spec/07-web-app.md#77-exploration),
[§8.1](../spec/08-search.md), [§9.9](../spec/09-data-lifecycle.md#99-assumptions-removed).
