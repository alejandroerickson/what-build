---
type: Decision
title: Each product keeps a Playbook that its people's agents write together, started from WhatBuild's starter and kept as revisions in Postgres
description: A product's shared agent knowledge (what is current, lessons from corrections, kits, people's pages) is a Playbook, a bundle in the Open Knowledge Format served over the operations, versioned in Postgres, with messages beside it and no screen of its own.
tags: [decision, playbook, agents, mcp, memory, data-model]
generated: {by: agent:claude, at: 2026-11-21}
status: stable
---

# Each product keeps a Playbook that its people's agents write together, started from WhatBuild's starter and kept as revisions in Postgres

## Context

What makes an agent's work on a product good (the corrections people made, the kits it builds pages with, what the team is working on) lived in each person's own agent, so every other agent started over and people repeated themselves. Each product's Story notes, source notes and card backs hold memory about one object; nothing held what is true across a product. Agents already read the Open Knowledge Format (Markdown with YAML frontmatter), and a product's people already share everything in it. The maintainer chose on 2026-11-20 that each product keeps one Playbook its people's agents build together, that WhatBuild is meant to be used through it, and that people see it only as a setting.

## Decision

- **One bundle per product**, of Markdown files with frontmatter (`type` required) and a kit's text files, in `playbook_files`, with every write kept in `playbook_revisions` (the latest 100 of each file) and its `whatbuild:` links in `playbook_links`.
- **Served over the operations**, as `playbook_read`, `playbook_write` and `playbook_delete`: index, read, read_files, search, history, backlinks, housekeeping, starter; write, move, remove, restore, apply (all or none); purge for admins. Every change to a file that exists takes its etag, and a stale one is refused with the current text to merge with. A local copy is files read with their etags, or a folder downloaded as a ZIP with a manifest of them, and sent back with `apply`, whose write steps may take their text from an uploaded ZIP, so a kit never has to pass through an agent's own output. The Playbook holds text only.
- **Git was rejected** as the store: the deployment is one stateless image on Postgres, deleting an organization must delete its history for good, and an agent without a shell could not use it. Branches and offline merges are not needed.
- **The starter is a template, not a layer.** WhatBuild ships one (`packages/core/src/playbook-starter/`); a product serves it until its first write copies it in, keeping its etags, and the team owns it from then on. `playbook_read(action="starter")` shows the latest to compare.
- **Agents are pointed at it**: the server's instructions and the guide say WhatBuild is used through it, `products.get` says what to read first, the guidance for each part lists the files whose `applies_to` names it, every agent's answer carries `playbook_messages_waiting`, and archiving something a file links to says which files do.
- **Named Playbook for people and agents alike.** "OKF" is the format's name and agent jargon; the feature is the product's playbook, how its team works as its agents keep it, a plain word beside Idea, Evidence, Exploration and Story. Its files are still in the Open Knowledge Format, which agents already read.
- **The team's files and each person's, by convention.** People working on one product don't all work alike (one makes canvases to test with customers, another to argue a price), so a file may be some people's rather than the team's, naming them in a `people` frontmatter key, and each person's page says what they use and why. This is the starter's and the guide's convention only: WhatBuild leaves `people` as written and points every agent at every file for its part, and agents check whose a file is. Narrowing what the server points each person's agent at was considered and left out, for now, as machinery the convention may not need.
- **Messages sit beside it**: one person's agents to another person's in the product, 60 days, left out of exports.
- **Agents curate it, people keep the say.** Housekeeping lists candidates; the starter tells agents to tidy the Playbook without asking and only archive the product's material, telling people, who delete.
- **No screen, one switch.** The web app shows no file of it; a product's admins turn it off and on in Settings, under Playbook. Off, every call is refused with `409 playbook_off` and nothing is lost.
- No AI inside: agents write and tidy it with their own tokens ([decision](no-ai-in-the-product.md)).

## Consequences

- A correction made to one agent reaches every agent on the product, and a kit built on one machine runs on another.
- Every agent's call in a product makes one more indexed count, for its messages.
- What a team's agents follow is the team's own text, so a bad file misleads every agent until someone mends it; its history makes that cheap to undo.

## Constrains

- Paths, limits, frontmatter and links follow `packages/core/src/playbook.ts`; operations are in `packages/core/src/ops/playbook.ts`.
- `index.md` and `log.md` are WhatBuild's at every level and never written.
- The starter's files are edited as Markdown, then `pnpm gen:guide`; CI fails when `starter-text.ts` drifts.

Specified in: [04-data-model](../spec/04-data-model.md#416-the-playbook), [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [07-web-app](../spec/07-web-app.md).
