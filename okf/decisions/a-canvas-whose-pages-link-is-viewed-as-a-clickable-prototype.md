---
type: Decision
title: A canvas whose pages link can be viewed as a clickable prototype, and there is no separate kind of mockup
description: Pages link with ordinary relative links; the board flies to a linked page, the clickable view shows one page at a time, and a canvas downloads whole as a ZIP or one page at a time.
tags: [decision, mockups, prototype, sandbox, web, agents, export]
generated: {by: agent:claude, at: 2026-11-02}
status: stable
---

# A canvas whose pages link can be viewed as a clickable prototype, and there is no separate kind of mockup

## Context

People want to click through a canvas as a product and take it away from WhatBuild. A canvas's pages
had no way to link to each other, and links cannot be reconstructed from screens that never named
one another. The maintainer chose this on 2026-11-02, rejecting a second kind of item in Exploration
(the same lifecycle under two names, with an agent repackaging a canvas to move between them) and a
single-file HTML export (a multi-file prototype cannot be flattened into one document reliably).

## Decision

- **One kind of mockup.** A clickable prototype is a way to view a canvas, not an item. An agent makes
  one by adding links and publishing the next version of the same canvas.
- **Links are ordinary relative links**, `<a href="checkout.html">` where `checkout` is the other
  page's `page_id`, as files side by side in a folder and in the version's ZIP.
- **On the canvas a link flies the view** to the page it names, and the page clicked stays as it was.
- **The clickable view** (`?view=clickable`) shows one page at a time, inside WhatBuild with its
  rails, starting at the first page. A link changes the page in place and opens it afresh.
- **It is on offer where links exist:** a page links to another, or enters a prototype. Elsewhere it
  is disabled, with a request to copy for an agent. A canvas of one page has no View control.
- **One way to each thing.** View and the whole canvas's download are in the inspector; moving between
  and showing pages (fit, fill, the page menu) are in the toolbar; a page's own download is on its
  label on the board, and is not offered in the clickable view. The inspector has no page picker.
- **No lines between pages on the board.** A canvas where everything links to everything would be
  drawn over by them. No counts of links either: people see the view, not statistics about it.
- **Downloads.** The ZIP gains an `index.html` to start from, and the same ZIP uploads again. A page
  downloads as its own HTML. Each download says that a page runs its own code outside the sandbox.
- **Agents learn it from what they read anyway:** the tool list, `clickable` in `get` and `publish`
  (with the links that lead nowhere, and the view's address), and the guide.
- **The sandbox does not change.** A frame sends a page's name; the app checks it against the
  version's pages and goes nowhere else. It never shows a page's own words in its messages.
- **A script cannot flip pages or fill the browser's history through the app.** The app cannot see a
  click inside a page's frame, so it goes by the browser's word that a person did something moments
  ago. Without that, a page's request moves nothing, so a page that advances on a timer does not. With
  it, a page moves at most four times a second, and a move is a step for Back at most once a second.
  A script gets a few steps for each thing a person does, and someone clicking faster than that gets
  one step for the run. This holds for every message a frame can send, on the canvas and on the Story
  (`apps/web/src/routes/page-moves.ts`). A page navigating its own frame is the browser's doing, and it
  does not hold for that.

## Consequences

- A canvas downloaded and unzipped clicks through from disk with no server. A prototype's module
  scripts and `fetch` need one, since browsers refuse them from a file.
- A `?query` does not reach the next page, and browser storage stays unavailable.
- A link only a script follows does not move the canvas; publish's `clickable` counts addresses it
  finds in a page's HTML.

## Constrains

- `packages/core/src/canvas-links.ts` reads a version's links, and the frame script in
  `packages/core/src/story-theme.ts` reads a clicked address the same way.
- `apps/web/src/routes/mockup-canvas.tsx` checks every page name a frame sends against `version.pages`.

Specified in: [07-web-app §7.7](../spec/07-web-app.md#77-exploration), [04-data-model §4.12](../spec/04-data-model.md#412-mockups), [06-operations-and-adapters](../spec/06-operations-and-adapters.md).
