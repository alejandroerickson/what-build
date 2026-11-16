---
type: Decision
title: The tutorial's examples are fixed content shipped with the web app, never in a product and never visible to agents
description: What the tutorial shows on each page is typed content in the web app's own bundle, drawn through the components that draw a product's content in place of the product's own while it runs, so no product holds it, the server never sees it and no agent can reach it.
tags: [decision, web, onboarding, tutorial, agents, security]
generated: {by: agent:claude, at: 2026-11-15}
status: stable
---

# The tutorial's examples are fixed content shipped with the web app, never in a product and never visible to agents

## Context

The spotlight tutorial needs something to light on every page: a product concept, an outcome, a
source with a picture, a canvas, a Story page. A new product has none of these, and an existing one
has its own, which the tutorial cannot rely on. Examples could be rows written into the product (an
agent would then read and might change them, and they would need cleaning up, migrating and
excluding from counts, exports and search), or fixed content the app draws. The maintainer chose
fixed content on 2026-11-15, with guests of the example organization taking the tutorial over the
example's own content the same way.

## Decision

- The examples are typed objects in `apps/web/src/tutorial/content/`, one per page (Idea,
  Evidence, Exploration, Story) and the agent stage's script, from the synthetic Crewboard sample.
  What a page shows during the tutorial is changed there, never in the mechanics.
- While the tutorial shows its examples, each page draws them **in place of** the product's own
  content, through the same components (`IdeaCard`, `SourceRow` and `SourcePreview`, `Canvas` and
  `MockupInspector`, `StoryTree` and `StoryInspectorBody`), as someone who can edit sees them
  (`AsEditor`), and inert. The product's name, organization and navigation counts stay its own.
- Nothing about them reaches the server: no request, no row, no file. The whiteboard photo is a
  static file of the web app's bundle.
- What a product's own content shows in a sandboxed frame from its own address (an Idea card's
  front, a canvas page, a Story page) is drawn by the app itself for the examples: the `picture`
  of `IdeaCard`, `drawPage` of `Canvas`, and a drawn Story page. They are the app's own markup,
  not anyone's HTML, so they need no sandbox, and no sandbox or content security rule changes
  for them. A frame's document (`srcdoc`, a blob) would inherit the app's policy, which allows no
  inline style, and the app's own files may not be framed.
- Rejected: example rows in each product, and a server route that serves the examples.

## Consequences

- Agents never see them; no tool lists, reads or writes them, and exports, search and counts are
  untouched. Nothing to migrate or clean up.
- The examples are drawn, so a change to how a card, a canvas page or a Story page looks has to be
  matched in `tutorial.css` by hand. The canvas is shown as not promoted in Exploration and as
  promoted on the Story: they are fixed, and accepted so.
- The tutorial lights the real screens by their classes, names their controls, asks for the
  canvas's keys and plays the agents' tools, so it can fall behind any change to them. A change to
  one changes the tutorial with it (`AGENTS.md`), and `apps/web/test/tutorial-screens.test.ts`
  fails until it does.

## Constrains

- A component that draws tutorial content takes it as a prop and asks the server for nothing.
- No tutorial content goes into the seed, the server, the guide or an operation.

Specified in: [§7.4 The tutorial](../spec/07-web-app.md#the-tutorial).
