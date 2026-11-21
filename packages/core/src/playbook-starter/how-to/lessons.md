---
type: Guide
title: Turning a correction into a lesson, and keeping lessons true
description: When to write a lesson, what goes in one, and how agents reason over lessons as they pile up.
applies_to: [all]
tags: [playbook, lessons]
status: stable
generated: {by: whatbuild/starter, at: 2026-11-20}
---

# Lessons

A lesson is something a person taught an agent that every agent working on the product should
know. Write it the moment it is taught: a correction ("not like that"), a preference said twice, a
mistake you made and found, an approach people liked enough to ask for again. An agent that waits
until the end of the work forgets the words, and the person repeats themselves to the next agent.

## Before you write one

Search first: `playbook_read(action="search", params={query})`. If a lesson already says it, add the new
case to that one. If one says the opposite, the newer correction wins: change the old lesson, and
say why in the revision's `message`.

## The team's, or your person's

A correction may be a rule for everyone or one person's preference. "A page's title says what it
decides" is the team's; "I like the options side by side" is your person's. Go by what they said:
"we", "always" and "the board needs" make it the team's; "I", "for me" and "my canvases" make it
theirs. When you can't tell, write it as theirs, naming them in `people` (or under "How they work"
on their page), and ask them whether it should hold for everyone.

When a second person makes the same correction, it is becoming the team's: take `people` out, or
merge it into the team's lesson, and tell them both.

## What goes in one

One file for each lesson, under `lessons/`, named for what it says:

```markdown
---
type: Lesson
title: A canvas page's title says what the page decides
description: Titles that named a topic were corrected to name the decision; holds for every canvas.
applies_to: [exploration]
tags: [canvas, titles]
status: stable
---

# A canvas page's title says what the page decides

**The rule.** Title each page with the decision it argues ("Price per seat, not per project"),
never its topic ("Pricing").

**What was said.** "I can't tell from the titles what we decided." (on the pricing canvas)

**Where.** whatbuild:mockups/<mockup_id>@4#pricing, 18 Nov 2026.

**How far it goes.** Every canvas, and Story pages made from one.
```

- **The rule first**, in a sentence or two an agent can follow without reading the rest.
- **The person's words**, quoted as closely as you have them: they carry what a paraphrase loses.
- **Where it came from**, as a `whatbuild:` link with the version, and the day.
- **How far it goes**: one canvas, every canvas, every page. Set `applies_to` to match.

## Reasoning over lessons

Lessons pile up, and a pile of them contradicts itself. Whenever you write one, read the others it
sits beside, and now and then read them all:

- **Merge** lessons that say the same thing in different words, for the same people. Two people's
  opposite preferences are not a contradiction: keep both, each naming its person.
- **Generalise**: three lessons about three canvases may be one rule about canvases, with the three
  as its examples.
- **Promote** a person's lesson to the team's once others hold it too, and a lesson every agent needs,
  whatever it works on, into
  [`product/now.md`](/product/now.md) or the `how-to/` file it belongs in.
- **Retire** a lesson the team no longer holds: remove it, or mark it `deprecated` and say what
  replaced it. Its history stays, and it can be restored.
- **Ask** your person only when two lessons disagree and nothing says which is right.

This is an agent's work, not a person's. Do it without asking, keep each lesson short, and tell your
person in a sentence what changed.
