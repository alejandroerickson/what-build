---
type: Decision
title: Each stage's count is the total of every item the stage holds
description: The count beside Idea, Evidence, Exploration and Story adds up every kind of item the stage holds, so Exploration counts mockups and assumptions and the Story counts its promoted pages too; product reads keep the per-kind counts beside the totals.
tags: [decision, web, counts, exploration, story, operations]
generated: {by: agent:claude, at: 2026-10-30}
status: stable
---

# Each stage's count is the total of every item the stage holds

## Context

The panel and the overview show a count beside each of the four stages. Each showed one kind of
item: Exploration showed its mockups and left out its assumptions, so a stage with a dozen
assumptions and no mockups read as empty. The Story already counted every live page, its Published
mockups included, but nothing said so. The maintainer chose additive counts on 2026-10-10,
replacing the rule in the web specification that Exploration counts mockups.

## Decision

- A stage's count is every item it holds, archived items left out: **Idea** its outcomes (the
  product concept is one field, not an item, so Idea holds one kind); **Evidence** its sources (the
  one kind it holds, since insights and decisions became sources); **Exploration** its mockups plus
  its current (unconfirmed or confirmed) assumptions; **Story** its live pages, which are exactly
  the pages in its tree and the unplaced ones a reader sees, of every kind.
- The server computes the totals: `products.get` and `products.list` return `stage_counts` beside
  `counts`, which keeps one number per kind, so agents see both the breakdown and what the app
  shows. A reader gets the Story's alone.
- Rejected: totals computed in the web app only, which agents would not see and could drift.

## Consequences

- A count never hides a kind of item, and the Exploration count agrees with its two lists.
- A new kind of item in a stage joins that stage's total in `stageCounts`
  (`packages/core/src/ops/products.ts`).

## Constrains

- The panel and the overview show `stage_counts`, never one key of `counts`
  (`apps/web/src/shell/panel.tsx`, `apps/web/src/routes/overview.tsx`).
- Assumptions are counted as `assumptions.list` lists them by default: current ones only.
- `apps/server/test/stage-counts.test.ts` pins every total, the Story's against what its
  navigation shows.

Specified in: [04-data-model §4.2](../spec/04-data-model.md), [07-web-app §7.2](../spec/07-web-app.md).
