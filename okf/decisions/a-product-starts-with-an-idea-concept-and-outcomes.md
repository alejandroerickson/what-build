---
type: Decision
title: A product starts with its idea, a product concept and the outcomes its users should achieve
description: The first screen is Idea, holding the product concept and outcomes; an outcome is what the product's users achieve with it, the compass the rest of the product is read against, and it cites nothing.
tags: [decision, product, vocabulary, outcomes]
generated: {by: agent:claude, at: 2026-10-13T00:00:00Z}
status: stable
---

# A product starts with its idea, a product concept and the outcomes its users should achieve

## Context

Every product starts as an idea: a problem its users have that the product can solve, bringing them
value and letting the team make a profit. The first screen needs to hold that idea in two parts, the
short statement of it and the breakdown of how the product adds value. A word like "objective" or
"goal" is ambiguous here, because a reader cannot tell whether the goals are the business's, the
discovery team's or the user's. The maintainer chose this model and its names on 2026-09-28.

Agents then wrote outcomes as digests of the evidence: who asked, in which call, what the team had
heard since, with the success criterion at the end. An outcome written that way changes with every
source and stops steering anything. On 2026-10-13 the maintainer settled what an outcome holds and
how it ends: outcomes are the compass, they cite nothing, and they are current or archived.

## Decision

- The first L1 destination is **Idea**. It holds the **product concept** and the **outcomes**.
- The **product concept** is a product's `concept` field: who the product is for, the problem they
  have, and how the product solves it.
- An **outcome** is what the product's users should be able to achieve with it, written from their
  side ("The crew lead plans next week in minutes"). It is not a feature, a task, a business metric
  or a goal of the discovery itself. Questions the discovery must answer belong in assumptions.
- **Outcomes are the compass.** The evidence, assumptions, mockups and the Story exist to reach
  them and are read against them. Agents read them first, at the start of any work in a product.
  They change when the person changes what the product is for, not when evidence arrives; an
  agent whose evidence challenges one proposes new wording to the person.
- **An outcome cites nothing.** Its title says what the users achieve; its description, what
  success looks like for them. Neither retells evidence or names sources, calls, dates, people
  who asked, assumptions or mockups, and the server refuses an outcome whose text holds a record
  id. References run one way: assumptions (`outcome_ids`), mockups and Story pages
  (`refs.outcomes`) point at outcomes. The Idea screen shows no links or counts from an outcome to
  what serves it; the assumptions list filters by outcome.
- **An outcome is current or archived**, archived as a source, an assumption or a mockup is
  (`archived_at`, `include_archived`, `archive` and `restore`). Rejected: active, achieved and
  archived statuses. "Achieved" made an outcome a task to tick off, and three states asked people
  to keep a status nobody read.
- "Outcome" is the one word for the object everywhere: UI, REST (`/outcomes`), MCP (`outcomes`),
  the schema (`outcomes`, `outcome_id`, `refs.outcomes`, `outcome_ids`) and the skill.
- Rejected: "capability" (it describes what the product does, and pulls toward a feature list);
  "job" (a job to be done exists without the product, and the word already means background work).

## Consequences

- Assumptions, mockups and Story pages link to what users should achieve, so the work is read
  against user value rather than against a research plan.
- Some teams use "outcome" for a business metric; the screen and the skill say whose outcome it is.

## Constrains

- Help text, operation descriptions, the MCP server's instructions and the skill define an outcome
  from the user's side, as the compass, citing nothing (`packages/core/src/ops/outcomes.ts`,
  `apps/server/src/mcp.ts`, `packages/core/src/skill/SKILL.md`).
- `outcomes.create` and `outcomes.update` refuse a title or description holding a record id
  (`outcome_cites_a_record`); outcome reads carry no counts of what points at them.
- Sample content writes outcomes as user outcomes (`apps/server/src/seed-content.ts`).

Specified in: [§1 Product](../spec/01-product.md), [§4.2 Outcomes](../spec/04-data-model.md),
[§7.5 Idea](../spec/07-web-app.md).
