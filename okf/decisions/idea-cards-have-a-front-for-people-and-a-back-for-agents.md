---
type: Decision
title: The product concept and each outcome is a card with a front for people and a back for agents, and agents write both
description: Idea shows each idea as a card, an agent-drawn picture in WhatBuild's card kit on the front and the deep text agents read on the back, which More info opens above the picture; the two sides change together and the web app edits neither.
tags: [decision, product, idea, outcomes, agents, design-system]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# The product concept and each outcome is a card with a front for people and a back for agents, and agents write both

## Context

The Idea screen held the product concept and each outcome as a few paragraphs of Markdown. People
found the screen a wall of text, and a newcomer to a team could not take in what the product is
for at a glance. The same text was too thin for agents, who read it at the start of every piece of
work and need the reasons behind it. One text could serve neither reader well. The concept and
outcomes were also editable in the web app, while the agents writing them follow guidance a
person's edit skips. The maintainer chose this model on 2026-10-24.

## Decision

- **Two sides.** The product concept and each outcome is a card. Its **front** (`card_html`) is for
  people: a picture of the idea, drawn so that someone new to the team takes it in within a few
  seconds. Its **back** (the product's `concept`, an outcome's `description`) is for agents: the same
  idea in depth, Markdown, with room for it (8,000 characters for the concept, 6,000 for an
  outcome). The back may say more than the front, never something different.
- **The sides change together.** A write that changes one side and does not send the other is
  refused (`card_sides_together`); the other may be sent unchanged, so whoever changes one side has
  looked at the other. The back of a card with no front yet may change alone, so cards written
  before fronts existed keep working, and a write that leaves an outcome with no front says so.
- **Both sides in view at once.** A card shows its front under its title; **More info** in the
  title bar opens the back between the title and the front, in a well that scrolls within a set
  height, so a person reads the text with the picture still in view. Nothing on the screen names
  who a side is for: people go to the picture and agents to the text without being told.
- **Agents write the cards; people read and arrange them.** The web app has no editor for either
  side and no New outcome; product Settings has no concept field. People open a card's text,
  drag outcomes into order, and archive and delete them, as they arrange the Story that agents
  write ([decision](agents-write-the-story-people-arrange-it.md)). Earlier versions are kept for
  agents to read and restore; the screen does not offer them. People still give a new product its
  first concept when they create it.
- **A front is drawn in the card kit**, WhatBuild's own: the app's type and greys, a palette of
  seven hues for diagrams, Lucide pictograms, and parts for what an idea needs to show (a pitch,
  who it is for, a flow, before and after, a measure, a spectrum, a loop, a timeline, a
  comparison, a voice, chips, notes). Unlike a Story page, which follows the team's own design
  system because it is read outside the team ([decision](story-pages-follow-the-teams-design-system.md)),
  a card is read inside WhatBuild, so it looks like WhatBuild. `outcomes_read(action="card_guidance")`
  gives agents how to choose what a front shows, the kit's reference with examples, the
  pictograms, the room a front has, how to write the back, and a check before sending; a write
  that touches a card returns `card_advice` on what WhatBuild can check of that guidance, without
  refusing the write. WhatBuild cannot measure a front itself, so `outcomes_read(action="card_preview")`
  gives an agent the front as the Idea screen shows it, with the height a desktop shows marked, to
  look at in a browser before writing it, as `story_read(action="preview")` does for a Story page.
- **Editors write both cards.** The concept's card is written with `products_write(action="update_concept")`
  by editors as well as admins, as an outcome's is, since agents connected at Edit write the Idea;
  renaming a product and changing its slug stay with admins.
- **A front is agent HTML in a sandbox**, as a Story page is
  ([decision](story-pages-are-sandboxed-agent-html.md)), but stricter: only the card's markup, which
  WhatBuild wraps in a document with the kit; no scripts, links or forms; nothing loaded from
  elsewhere. The one script a card runs is WhatBuild's, under a nonce, telling the app how tall
  the card is.
- Rejected after trying it: a card that turns over, front for people and back for agents behind a
  People | Agents switch. It kept the card's size still, but it
  hid one side while showing the other, so no one could read the text against the picture, and it
  labelled each side by who it was for. Rejected: fronts as structured blocks the app draws itself. They would be consistent, but an
  agent could draw nothing the blocks lack, and an idea's picture varies more than a fixed set of
  blocks allows. Rejected: notes for agents beside the cards in the inspector, as a Story page has,
  since with several cards on the screen it would be unclear which card the notes belong to.

## Consequences

- The Idea screen reads as pictures first. A card with no front yet opens on its text and asks
  for an agent to draw the picture, so products made before fronts existed stay readable until one
  does; `outcomes_read(action="list")` and `products_read(action="get")` tell agents which cards have none.
- Cards differ in height, by their pictures and by whether their text is open, so the outcomes
  stand one under another, each as wide as the concept: side by side, a shorter card left a gap
  beside it. Every card has the same width and the same most height, so neither says anything about
  an outcome's weight.
- Every card's front carries the app's typeface (about 64 KB) in its response, since a sandboxed
  card loads nothing from elsewhere.
- A person who wants a card changed asks an agent; the screen says that agents write both sides.

## Constrains

- `outcomes.create`, `outcomes.update`, `products.create` and `products.update_concept` check a front
  against `IDEA_CARD_RULES` (`packages/core/src/html-rules.ts`) and the two-sides rule
  (`checkCardSides` in `packages/core/src/idea-card.ts`); the card kit, its guidance and the
  document a front is served in live together in `idea-card.ts`, so they never drift apart. A
  front is served from the content site when the deployment has one, under an address naming the
  digest of the front it was issued for ([decision](with-a-content-site-every-page-and-inline-file-is-served-from-it.md)).
- The web app's Idea screen (`apps/web/src/routes/idea.tsx`) offers no editor for the concept or an
  outcome.
- The guide describes both sides and the kit (`packages/core/src/guide/05-idea.md`), and the sample
  product has a front on every card (`apps/server/src/seed-content.ts`).

Specified in: [§4.2.1 Cards](../spec/04-data-model.md), [§7.5 Idea](../spec/07-web-app.md),
[§6 Operations](../spec/06-operations-and-adapters.md).
