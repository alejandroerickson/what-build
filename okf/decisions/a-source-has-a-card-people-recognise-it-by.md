---
type: Decision
title: A source has a card, an agent-drawn picture people recognise it by, beside its text summary
description: Beside its Markdown summary, a source carries a card, HTML in the Idea card kit on a 640 × 480 board, which heads its preview and page and is its face in the Evidence list when it has no picture of its own, so that sources are told apart at a glance rather than read.
tags: [decision, sources, evidence, agents, design-system, web, mcp]
generated: {by: agent:claude, at: 2026-11-02}
status: stable
---

# A source has a card, an agent-drawn picture people recognise it by, beside its text summary

## Context

A source's face in the Evidence list was its picture when it had one, and otherwise a small page of
its own words, so every interview, call and note looked like every other: grey lines. The preview
beside the list opened on the text summary, a few sentences in a large empty pane. The Idea screen
had already moved from text to agent-drawn cards that people take in at a glance
([decision](idea-cards-have-a-front-for-people-and-a-back-for-agents.md)). The maintainer chose on
2026-11-02 to give sources the same: an HTML picture agents are pushed to draw, kept with the
text summary, and preferred as the face over a page of words but never over the thing's own picture.

## Decision

- **A card beside the summary.** A source has at most one card (`note_kind` `card` in
  `derived.write_note`, beside `summary` and `notes`), with an etag of its own. The summary stays:
  agents, search and screen readers read it, and people read it under the card. The card is not
  searched; its words are the summary's.
- **A memory hook, not a summary in boxes.** Its guidance (`derived.card_guidance`) asks for the one
  thing this source says that the product's others do not, as a shape that survives at a tenth of
  its size, unlike the other sources' cards: big shapes, one hue, few and very large words.
- **One fixed board.** A card is drawn on 640 × 480 (4:3, the shape of every face), and the app
  scales it to fit: a thumbnail in the list, most of the preview's width beside it, 480 pixels on
  the source's page. Rejected: a responsive card like an Idea card's, which would recompose rather
  than shrink, so the thumbnail would not look like the large picture.
- **The thing's own picture wins.** A photo, a PDF's page, a deck's slide or card and a video's
  frame stay the face; the card comes next, before the small page of words.
- **The Idea card kit and sandbox.** A card is checked against `IDEA_CARD_RULES` and served in the
  Idea cards' document and sandbox, in the reader's theme, so it adds no new kind of HTML.
- **Agents draw it.** The web app shows it and offers no editor, as for Idea cards; people still
  write the summary there.

## Consequences

- Sources with no picture of their own become recognisable in the list; one an agent has not yet
  drawn looks as before. A summary written with no card says so, to prompt the drawing.
- Each card in the list is a frame from its route, and so a call against a plan's calls a minute.
  The list loads a frame only once its row is in view. Should that cost too much, a picture of the
  card made once and served like an attachment's thumbnail would replace the frames.

## Constrains

- The board, guidance, examples and advice live in `packages/core/src/source-card.ts`; the document
  is `ideaCardDocument` with its `artboard`. The sample product's sources each have a card
  (`apps/server/src/seed-content.ts`), checked with the guidance's examples by a test.
- The face order is `SourceFace` in `apps/web/src/routes/source-face.tsx`.

Specified in: [§4.6](../spec/04-data-model.md#46-comments-the-summary-the-card-and-notes),
[§6](../spec/06-operations-and-adapters.md), [§7.6](../spec/07-web-app.md).
