---
type: Decision
title: Insights and decisions are retired, and what a product held of them becomes sources in Evidence
description: Exploration holds mockups and assumptions only; existing insights and decisions are moved into Evidence as Markdown sources with the same ids, by a worker job a migration queues.
tags: [decision, exploration, evidence, migration, mcp, product]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Insights and decisions are retired, and what a product held of them becomes sources in Evidence

## Context

Mockups now carry a team's work from evidence to a direction, so insights (Markdown synthesis with
review marks) and the decision register no longer earn lists, tools and screens of their own. The
maintainer retired both on 2026-10-09 and asked that what deployments already hold be kept as
sources, without changing what a source is. This replaces the
[insight review decision](insight-review-marks-a-revision.md).

## Decision

- No operation, MCP tool, screen or agent guidance reads, writes or mentions insights or decisions.
  Assumptions stay, as the one register.
- Each insight or decision a product holds becomes a Markdown source with **the same id**: an
  insight tagged `analysis` and `insight`, a decision tagged `decision`
  ([sources are described by tags](sources-are-described-by-tags.md)). What the item's fields held
  (summary, status, review mark, what it referred to, the passages it cited, links, reviews) is
  written into its document;
  earlier revisions become earlier file versions. The move adds no field to sources.
- The item's history in the activity log becomes the source's. An assumption's link to a decision
  is dropped; the decision's document names it.
- A migration queues the move and the worker does it, because only the worker reaches object
  storage; the migration jobs of the Cloud Run and Azure deployments have no storage access.
- Old app links to an insight or a decision open its source.
- Rejected again on 2026-10-13: decisions as a lightweight type with a status (proposed, decided,
  superseded) and links. Decisions belong to the people, who make them as they work, and agents
  work within them as they are asked; recording each as it is made adds a step that gives no one
  anything. A decision a team wants agents to see can be a source like any other; no guidance
  describes a convention for one.
- Rejected: one decision log per product. It would collapse every link and reference to one
  decision into a link to the whole log.

## Consequences

- MCP has 16 tools and the registry 108 operations. Agents that call the old tools get `422`.
- The empty `insights` table and the register's `kind` column remain until a later migration drops
  them ([roadmap](../spec/10-roadmap.md)).

## Constrains

- The move is `packages/core/src/evidence-move.ts`, run by the worker's `move_to_evidence` job,
  queued by `apps/server/src/migrations/0015_insights_and_decisions_to_evidence.sql`. It must stay
  idempotent.

Specified in: [04-data-model §4.7](../spec/04-data-model.md), [09-data-lifecycle §9.8](../spec/09-data-lifecycle.md).
