---
type: Decision
title: A canvas's pages are light, load in turns and stay loaded, and a move shows the next page at once
description: Publish refuses a page whose document loads more than 20 files or 1 MB, and a canvas whose pages load more than 12 MB together; the board and the clickable view load pages outward from the selected one, keep them, and show a page that is still loading as a sheet that says so.
tags: [decision, mockups, prototype, sandbox, web, agents, limits]
generated: {by: agent:claude, at: 2026-11-26}
status: draft
---

# A canvas's pages are light, load in turns and stay loaded, and a move shows the next page at once

## Context

A canvas of dozens of pages that each entered one large prototype, every page a different view of
the same app and each document loading about fifty files and three megabytes, showed pages white or
blank. Browsers cache nothing a sandboxed frame loads (an opaque origin's requests bypass the HTTP
cache; [decision](mockups-carry-prototypes-served-from-a-capability-path.md)), so every frame fetched
the whole app again, and every frame of the canvas did so at once: thousands of requests, more than
a browser takes, so Chrome refused hundreds (`net::ERR_INSUFFICIENT_RESOURCES`) and pages missing a
script or a stylesheet never drew. The clickable view also reopened each page it moved to, white
until it loaded. Keeping the page before on show until the next had loaded took the white away but
left a click with no answer.

The maintainer set what must hold on 2026-11-26. Moving left or right through a canvas's pages, on
the board and in the clickable view, shows the next page at once, within about a quarter of a
second. A canvas opens with every page loaded in about five seconds. A canvas's pages are meant to be
different screens, perhaps sharing components, between which a person moves by moving to another
page of the canvas; an interaction within a screen (a dialog, a tab, a button's result) stays inside
its page. A whole prototype behind every page is not how a canvas is meant to be made, and agents
are to be made to make them lighter and flatter.

## Decision

- **Pages take turns to load, and keep their frames.** In either view, the pages that enter a
  prototype load outward from the selected page (or the first): that page first and alone, then the
  two beside it, then the rest eight at a time, nearest first and the next before the previous. A
  page selected later goes to the front, and one that has not said it loaded within 8 seconds no
  longer holds back the others. A page keeps its frame once it has loaded, so moving between loaded
  pages loads nothing. A page with HTML of its own is one document, and loads as it did.
- **A move shows the page at once.** The clickable view loads every page behind the one on show, so
  the next is ready. A page not loaded yet takes the place at once, as a sheet with the progress mark
  and "Loading", in either view. A frame is drawn only once its document has loaded, so no page shows
  white or half drawn. Nothing keeps the page before on show. A page that takes the keyboard by
  itself as it loads (a field it focuses, a dialog it opens) gives it back unless a person pressed in
  it or pressed Tab in the moment before, or loading pages would take the arrows one after another.
- **Afresh when used.** A page the clickable view leaves opens afresh behind the others if a person
  used it (the frame says so at the first press, key, scroll or wheel); one nobody used stays as it
  is, ready. A page used on the board opens afresh when the view folds into the clickable view.
- **Publish refuses heavy pages.** An upload's prototype is held to what its pages load: each
  page's document, with what it and its stylesheets load, at most 20 files and 1 MB; the pages
  together at most 12 MB, each page counted as it loads (its own HTML, or its document's load,
  counted again for every page that enters it). The refusal is `422 invalid_input`, naming each
  document once with the pages that enter it, and pointing to the guide's ways of bringing a heavy
  prototype within the limits. A version that
  carries its base's prototype forward without an upload is not checked again.
- **The guide gives a person's agent what it needs without the person knowing how a prototype is
  built** (its mockups topic, under What a page loads): what publish counts, what it refuses, what
  people see, and the ways a heavy prototype comes within the limits (bundling and trimming it, a
  document for each screen, a page of its own for each screen, fewer pages), each with what it
  changes for the people who view the canvas. The refusal and the tool's description point there.
  As the guide's own decision has it, this describes the mechanism and what people see, and
  prescribes no method ([decision](agents-learn-whatbuild-from-the-servers-guide.md)). Many of the
  people who bring a prototype in are not developers, and their agents decide and explain.
- Rejected: keeping the page before on show until the next has loaded (a click that seems to do
  nothing); a server cache of prototype files (the server's own time per file measured at a few tens
  of milliseconds: the cost is the bytes and the round trips, which nothing caches in an opaque
  origin); a warning at publish alone, which leaves the canvas as slow.

## Consequences

- The limits follow from the targets: 12 MB with the round trips of eight frames at a time is about
  what loads in five seconds on an ordinary connection, and a page of at most 1 MB loads behind the
  one on show before a person moves to it.
- A canvas published before keeps loading in turns. The next upload of a heavy one is refused until
  its pages are made light.
- Every page of a canvas holds a live frame once loaded, as the board always showed them; a light
  page keeps that cheap.
- Caching between frames needs an origin of the prototype's own per view (the
  [roadmap](../spec/10-roadmap.md#planned--mockups-prototypes-next)'s content-site subdomain, which
  `allow-same-origin` would make cacheable).

## Constrains

- `apps/web/src/routes/frame-turns.ts` (the turns) and `apps/web/src/routes/mockup-canvas.tsx` (the
  sheets, eager frames in the clickable view, opening afresh), tested in
  `apps/web/test/mockup-canvas.test.tsx`.
- `readPrototype` and `PAGE_LOAD_FILES`, `PAGE_LOAD_BYTES` and `CANVAS_LOAD_BYTES` in
  `packages/core/src/prototype.ts`, held in `canvasLoadProblems` in `packages/core/src/ops/mockups.ts`,
  tested in `apps/server/test/mockup-prototypes.test.ts`.

Specified in: [04-data-model §4.12](../spec/04-data-model.md#412-mockups), [07-web-app §7.7](../spec/07-web-app.md#77-exploration), [09-data-lifecycle §9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas).
