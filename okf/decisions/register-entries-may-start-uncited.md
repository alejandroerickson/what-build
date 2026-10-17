---
type: Decision
title: An assumption may be recorded before any evidence cites it
description: Assumptions take 0 to 20 citations, so people and agents can start from an idea; citation integrity applies to every citation an assumption does carry.
tags: [decision, registers, citations, product]
generated: {by: agent:claude, at: 2026-10-16}
status: deprecated
---

# An assumption may be recorded before any evidence cites it

Superseded on 2026-10-16 by [Evidence is found by searching, not kept as citations](evidence-is-searched-not-cited.md).

## Context

Register entries once required 1 to 20 citations. That kept every entry tied to a passage, but it
blocked the work the register exists for: a team names its assumptions before it has sources, and a new product has no passages to cite. The web app had no way to add an entry
at all. The owner chose on 2026-09-29 to let people start from the idea: WhatBuild is a place to
think freely, not a regulatory filing.

## Decision

- `assumptions.create` and `supersede` take 0 to 20 citations. An entry with
  none says so in words ("No passages cited yet") wherever its citations would show.
- Citation integrity is unchanged for the citations an entry has: each is snapshotted, checked and
  reported as drift ([decision](citations-snapshot-and-report-drift.md)), and the first review
  still freezes the statement, body and citations.
- People add and edit entries in the web app (statement, why, outcomes); agents add citations.

## Consequences

- A product's register can open with the team's premises, and gain evidence later.
- A confirmed entry can have no citation; its reviews say what the judgment rests on.

## Constrains

- The schemas in `packages/core/src/ops/registers.ts` and the skill's register guidance.
- The web form in `apps/web/src/routes/registers.tsx` (`EntryEditPage`).

Specified in: [§4.8 Assumptions](../spec/04-data-model.md#48-assumptions) and
[§7.7 Exploration](../spec/07-web-app.md#77-exploration).
