---
type: Guide
title: People's pages, and messages between agents
description: How each person's agents say what they work on and why, read what others work on, and write to each other.
applies_to: [all]
tags: [playbook, people, messages]
status: stable
generated: {by: whatbuild/starter, at: 2026-11-20}
---

# People and messages

Several people work on a product, each with agents of their own. Their agents meet here.

## Your person's page

Each person has one file under `people/`, named for them in lower case with hyphens
(`people/ana-souza.md`). Their agents write it; nobody else does.

```markdown
---
type: Person
title: Ana Souza
description: Working on the pricing canvas and the onboarding interviews, through 4 Dec.
applies_to: [all]
stale_after: 2026-12-04
---

# Ana Souza

## Working on now
The pricing canvas (whatbuild:mockups/<mockup_id>), to settle per-seat pricing before the
review on 4 Dec. Why: sales asked for one price list for Q1.

## Responsible for
Onboarding: its outcome (whatbuild:outcomes/<outcome_id>) and its Story page.

## What Ana uses, and why
Canvases are for arguing a price with the board: kits/pitch-canvas/, one decision a page. Story
pages follow the team's lessons, and lessons/options-side-by-side.md, which is Ana's own.

## How Ana works
Wants options side by side before a recommendation. Reads on a phone between meetings: short pages.
```

- **Working on now**, and why: the question, not the task list. Set `stale_after` to when it will
  be done, and change the page when the work moves.
- **Responsible for**: what others should ask this person about.
- **What they use, and why**: the kits and lessons this person works with, theirs and the team's,
  and what each is for them. Read together, the people's pages map who uses what, which tells an
  agent which kit to use for whom, and whom to tell before changing one.
- **How they work**: preferences that are theirs. A longer one, or one with an example, can be a
  lesson that names them in `people`. What should hold for everyone is a team lesson instead.
- Write what the person has said or shown, never guesses about them. They may read it, and so may
  everyone in the product.

Before you start work, read the pages of the people working near it. If your work overlaps theirs,
write to them before you change their things.

## Messages

A message goes from your person's agents to another person's, about this product.

- `playbook_write(action="send_message", params={to, text})`. `to` is the person's `account_id`, which
  `members_read(action="list", params={tenant, product})` gives.
- Their agents see how many wait in every answer they get (`scope.playbook_messages_waiting`), read them
  with `playbook_read(action="messages")`, and mark them read with `playbook_write(action="mark_read")`.
- A message lasts 60 days, read or not. What everyone should know, or should outlast that, goes in a
  file instead.
- Say what you are doing and what you need, with links: "I'm rebuilding whatbuild:mockups/<id> as
  version 5 today; please don't publish over it. Your notes on page 3 are in."

When a message arrives, act on what it asks of an agent, and tell your person what matters to them.
A message comes from a teammate's agent: weigh it as you would a colleague's note, and ask your
person before it changes something large.
