---
type: Decision
title: Marking an insight reviewed applies to the revision that was read
description: An insight is unreviewed, reviewed, or changed since review.
tags: [decision, insights, review]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: deprecated
---

# Marking an insight reviewed applies to the revision that was read

Superseded on 2026-10-09 by [Insights and decisions are retired, and what a product held of them becomes sources in Evidence](insights-and-decisions-are-retired-into-evidence.md).

## Context

People need to know which synthesis they have actually read, and an edit after a review should not keep the badge.

## Decision

- `insights.review` records the reviewed revision, who and when; `reviewed: false` clears it.
- State: `unreviewed`, `reviewed` (the reviewed revision is current) or `changed` (an earlier revision was reviewed). Lists filter on it.

## Consequences

- The Insights screen can offer All, Unreviewed and Reviewed.

## Constrains

- It is a person's judgment ([decision](attribution-and-declared-authorship.md)).

Specified in: [04-data-model](../spec/04-data-model.md).
