---
name: okf-decision
description: Record, revise or supersede an architectural decision record in WhatBuild's okf/decisions/. Use when a change makes a durable choice (a technology, a data or security model, an API or MCP shape, a product rule, a design-system direction, a process rule), when the person states a decision that should outlive the conversation, when work would contradict an existing decision, or when asked why something is built the way it is and no record explains it.
---

# Record a decision in okf/decisions/

A decision record keeps a durable choice, its reasons and what it rules out, so that later work
does not reopen it by accident. If work contradicts a decision, the decision wins until it is
revisited explicitly.

## Does it need a record?

It does if **any** of these is true:

- A later change could reasonably go the other way, and someone would need to know why it did not.
- It constrains other work: code, schema, an API shape, the interface, deployment, or process.
- The owner decided it explicitly. Product calls, and the design system above all, are the
  owner's to make. Record them. Do not make them yourself.

If the choice only matters inside one spec area, a `◆ Decision:` line in that spec section is
enough. Everything else goes in the code or its tests.

## Before writing

1. Read `okf/decisions/index.md`. If a record already covers the area, revise it or supersede it.
   Do not add a second record that half-overlaps.
2. Read the spec sections the decision affects. The decision and the spec must agree once you are
   done.
3. If you are deciding for the owner on something that is theirs to decide, stop and ask.

## Write it

File: `okf/decisions/<the-choice-in-kebab-case>.md`. Name the choice, not the topic.
`postgres-is-the-only-database.md` is a good name; `database.md` is not.

```markdown
---
type: Decision
title: <The choice, stated as a sentence>
description: <One line: the choice and its main reason.>
tags: [decision, <area>, …]
generated: {by: agent:<your-name>, at: <YYYY-MM-DD>}
status: stable
---

# <Same as title>

## Context

<The forces: what problem, what constraints, what alternatives were live. Two to five sentences.
Present the situation; do not tell the story of a session.>

## Decision

- <What is chosen, concretely enough to check code against.>
- <Name the alternative that was rejected, and why, in one line, if that helps a later reader.>

## Consequences

- <What becomes easier, what becomes harder, what it costs.>

## Constrains

- <The rules this imposes on code or process, with paths: "all access checks go through
  `packages/core/src/policy.ts`".>

Specified in: [<spec section>](../spec/<file>.md).
```

Keep it under about 40 lines. Link to the spec for detail rather than repeating it. If the owner
made the decision, say so and date it in Context, for example "The maintainer chose X on
2026-01-31".

Then:

1. Add a line to `okf/decisions/index.md`: `- [<title>](<file>.md)`.
2. Link the decision from the spec sections it governs, and from `system/overview.md` if it
   shapes the system at that level.
3. Make the spec agree with the decision.
4. Run `python3 okf/tools/validate_okf.py`.

## Revise or supersede

- **Refining** a decision while its choice stays the same: edit it in place and bump
  `generated.at`.
- **Reversing or replacing** one: write the new record. On the old record, set
  `status: deprecated` and add a first line to its body:
  `Superseded on <date> by [<new title>](<new-file>.md).` Give the new record's Context a line on
  what it replaces and why. Keep both in the index until nothing links to the old one.
- **Code that contradicts a decision** is either a bug to fix or a sign the decision should change.
  Say which in your report. Never change a decision silently to match code you just wrote.

## Public repository

Records are published. Give reasons in terms of the product and the system. Never name private
projects, clients, conversations or people outside the repository, even when they shaped the
choice.
