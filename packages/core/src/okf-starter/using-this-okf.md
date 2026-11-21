---
type: Bundle Guide
title: How this product's agents work together through its OKF
description: What this OKF is, why every agent working on the product reads it first and writes to it as it works, and how.
applies_to: [all]
tags: [okf, start-here]
status: stable
generated: {by: whatbuild/starter, at: 2026-11-20}
---

# This product's OKF

This is the product's shared knowledge, kept by the agents of everyone who works on it. WhatBuild
holds the product's material: its Idea, Evidence, Exploration and Story. This OKF holds what the
team has learned about working on that material: what is current, what people corrected and why,
the kits agents build pages with, who is working on what, and what needs tidying.

WhatBuild is meant to be used through it. An agent that reads it starts where the last one stopped.
An agent that writes to it saves the next one from a mistake a person already corrected. The more of
the team's work goes through it, the less each person repeats themselves to their own agent, and the
more every agent's work looks like the team's. An OKF nobody writes to is the only way it fails.

## At the start of work

1. Read [`product/now.md`](/product/now.md): what the team is working on, and what is settled.
2. Read the files listed for the part you work in. `products_read(action="get")` lists them under
   `okf`, and the guidance for each part lists its own: `story_read(action="guidance")`,
   `outcomes_read(action="card_guidance")`, `derived_read(action="card_guidance")`, and
   `mockups_read(action="list")` for Exploration.
3. Read your messages, `okf_read(action="messages")`. Every answer says how many wait, as
   `scope.okf_messages_waiting`.
4. Read your person's page under `people/`, if there is one, and the pages of whoever works near you.

`okf_read(action="index")` lists every file with its title and description, and
`okf_read(action="search")` finds words in them.

## While you work

- **When a person corrects you, write a lesson** before you go on ([how](/how-to/lessons.md)).
- **When you write something you will write again** (a script, a stylesheet, a page builder), keep
  it as a kit ([how](/how-to/kits.md)).
- **When the work changes direction**, change [`product/now.md`](/product/now.md).
- **When you finish a piece of work**, tidy what it touched ([how](/how-to/housekeeping.md)).
- **When someone else's work meets yours**, read their page and write to them
  ([how](/how-to/people-and-messages.md)).

## Links

Link to what you mean in WhatBuild with a `whatbuild:` link, which names no host, so it holds on
every copy of the product:

| Link | Names |
|---|---|
| `whatbuild:sources/<record_id>` | A source. |
| `whatbuild:mockups/<mockup_id>@3#pricing` | A mockup; `@3` its third version and `#pricing` a page, when they matter. |
| `whatbuild:outcomes/<outcome_id>` | An outcome. |
| `whatbuild:story/<page_id>@2` | A Story page, with a version when it matters. |
| `whatbuild:product` | The product concept. |

Reading a file gives each of its links with what it names now (its title, and whether it is
archived or gone), and archiving something a file links to says which files do. Link between files
as OKF does, from the bundle's root: `[the canvas lesson](/lessons/canvas-titles.md)`.

## How a file is written

Every Markdown file starts with frontmatter. `type` is required; `title`, `description` and
`applies_to` decide how it is found:

```yaml
---
type: Lesson
title: A canvas page's title says what the page decides
description: A correction made on the pricing canvas, which holds for every canvas.
applies_to: [exploration, story]
tags: [canvas, titles]
status: stable
stale_after: 2027-03-01
---
```

- `applies_to` names the parts of the product the file is about: `idea`, `evidence`,
  `exploration`, `story`, or `all`. WhatBuild lists the file to agents working there.
- `status` is `draft`, `stable` or `deprecated`; `stale_after` is the day it stops being trusted
  unless someone checks it and moves the day on.
- WhatBuild records who wrote every revision, through which agent, and when. A file need not say.

| Folder | Holds |
|---|---|
| `product/` | What is current, and maps into the evidence. A few files, rewritten often. |
| `lessons/` | One file for each correction or discovery that should change how agents work. |
| `kits/` | One folder for each kit: its `README.md` and its text files. |
| `people/` | One file for each person: what they work on, and how they like to work. |
| `how-to/` | How this OKF is used. |

Make other folders when the team needs them. `index.md` and `log.md` are WhatBuild's: it writes
both for every folder, and `okf_read(action="index")` and `okf_read(action="history")` give them.

## Versions and conflicts

Every write keeps a revision. `okf_read(action="history")` lists a file's revisions,
`okf_read(action="read")` with a `revision` reads one, and `okf_write(action="restore")` brings
one back, for a removed file too.

A write names the etag of your last read of the file. If someone wrote in between, it is refused
with their text: merge the two and write again. `okf_write(action="apply")` writes several files at
once, all or none. To work on files on your own machine, a kit say, read them with
`okf_read(action="read_files")`, keep the etags, and send your changes back with `apply`.

## These files are yours

Everything here came from WhatBuild's starter and belongs to the team now. Change this file, and the
others in `how-to/`, when the team works differently: they are what every agent here follows.
`okf_read(action="starter")` shows WhatBuild's latest starter, to compare.
