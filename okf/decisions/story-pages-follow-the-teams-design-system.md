---
type: Decision
title: Story pages follow the team's design system, never WhatBuild's
description: Each product has one Story style, the company's own design system or an adopted house style, and the guidance gives agents taste and design passes instead of the app's tokens.
tags: [decision, story, design, agents]
generated: {by: agent:claude, at: 2026-09-29}
status: stable
---

# Story pages follow the team's design system, never WhatBuild's

## Context

Story guidance used to hand agents a stylesheet copied from the app's own design tokens, so every
Story looked like WhatBuild. A Story is the team's document and is often read outside the team,
and companies have design systems of their own. A small fixed set of recipes also produced
look-alike pages. The owner chose on 2026-09-29 to stop serving the app's look, to let a product
keep its own design system for the Story, to offer named house styles, and to push agents toward
taste and design tools they may already have.

## Decision

- Each product has at most one **Story style** (`story_styles`): a name, Markdown rules and one
  stylesheet, adopted from a house style or written from the company's own design system.
  `story.get_style` and `story.set_style` read and replace it, with its own etag.
- Four **house styles** ship with the server (`packages/core/src/story-styles.ts`): Broadsheet,
  Tufte, Swiss grid and Briefing deck. They style one shared semantic vocabulary, so content moves
  between styles unchanged. None uses WhatBuild's tokens.
- The vocabulary covers what stakeholders are told, not only what was found: an account of the
  evidence (quotes, notes, figures, comparisons) and a plan (dated milestones, a line per item,
  labelled facts, links to the pages beneath a page).
- An agent publishes a page's body and the server puts the product's stylesheet around it
  (`story.publish { body }`), so every page carries the same stylesheet and an agent never sends
  it. What a Story needs beyond the vocabulary goes into the product's style, not into one page.
- `story.guidance` serves no stylesheet of its own. It gives the style workflow, taste principles,
  anti-patterns, compositions, named design passes, and asks agents to use a design skill such as
  Impeccable when they have one and to mention it once when they do not. Guidance text is
  WhatBuild's own; no third-party skill text is embedded.
- The web app previews the product's style and every house style on one sample page, in the same
  sandbox as a Story page, and gives people the words to ask their agent for a change. It never
  sets the style itself ([decision](agents-maintain-the-story-people-read-it.md)).

## Consequences

- Stories can match a company's documents, and different products can look different.
- Changing the style does not restyle published pages; an agent publishes each again with
  `restyle`, which replaces the stylesheet and keeps the content.
- There is no drift test between the app's tokens and the Story guidance any more.

## Constrains

- `story-guidance.ts` and `story-styles.ts` never import or copy `apps/web/src/styles/tokens.css`;
  a server test fails if the guidance mentions the app's accent or font.
- A house style must pass the page validator, carry light and dark schemes, and style the whole
  shared vocabulary (`VOCABULARY`).

Specified in: [04-data-model §4.11](../spec/04-data-model.md), [07-web-app §7.8](../spec/07-web-app.md).
