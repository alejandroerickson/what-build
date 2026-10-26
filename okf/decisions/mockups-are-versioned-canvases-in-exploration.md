---
type: Decision
title: Mockups are versioned canvases of agent-made HTML, in a stage called Exploration
description: Agents build directions as sandboxed HTML pages on a canvas under a brief, versioned as a whole and downloadable to build the next one; the third stage is named Exploration.
tags: [decision, mockups, exploration, story, security, web, agents]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Mockups are versioned canvases of agent-made HTML, in a stage called Exploration

## Context

Agents now build working HTML screens in minutes, so a team can go from evidence to concrete
directions faster than it can write and debate long insights. People react better to two or three
directions side by side, at real size, with the reasoning beside each, than to prose about them.
The third stage was called Synthesis, a word designers reserve for making sense of research;
mockups are work on the solution. The maintainer chose the canvas, its versions and download, and
the names Mockups and Exploration on 2026-10-09.

## Decision

- A **mockup** is a canvas of HTML pages, each with Markdown design notes (one free-form field,
  no categories), under a Markdown **brief** that says what the canvas explores, and which
  outcomes and assumptions it tests.
- **A version is the whole canvas.** Every publish makes the next version; a later version keeps
  the fields and the pages it does not change.
- Pages are untrusted, like Story pages, and shown only in the Story's sandbox
  ([decision](story-pages-are-sandboxed-agent-html.md)), without the app's theme.
- **A version may carry a prototype**, a team's multi-file prototype as it is, and a page may be an
  entry into it instead of a document of its own: a path to one of its HTML documents. Its files
  are served from a capability path of their own, stateless and confined to that version
  ([decision](mockups-carry-prototypes-served-from-a-capability-path.md)). "Prototype" names that
  multi-file part only; it is still rejected as the name of a whole mockup (below).
- **A mockup page has HTML rules of its own**, because a canvas holds working prototypes as well
  as screens: scripts of any number and length, and forms, whose submit handlers run and whose
  submissions go nowhere. Like a
  Story page it is self-contained (nothing loaded from elsewhere, no frames, `<base>`, `<link>` or
  `<meta http-equiv>`) and holds at most 1,000,000 characters, and a version 8,000,000. A Story
  page keeps its own rules, a script budget and no forms, since the Story is for reading. Every
  refusal names the surface it belongs to. An organization on the free plan has the same rules,
  under its cap on what one field holds. The maintainer chose this on 2026-10-14, replacing the Story's
  rules for mockup pages: a budget on script length bounds nothing the sandbox does not, and kept
  interactive prototypes off the canvas.
- A version downloads as a ZIP (brief, manifest, each page's HTML and notes) through a short-lived
  grant, so an agent builds the next version in its own project and publishes the pages it changed.
  The same layout uploads as a ZIP through a grant, so an agent can publish a canvas without
  sending its pages' HTML through a tool call.
- Agents publish and archive mockups; the web app shows them on a pannable, zoomable canvas and
  downloads them.
- **Mockups are outputs.** They come from the work a team's agents do in their own projects, where
  shared components, stylesheets and design systems are used. Each page is stored as one
  self-contained document, and nothing shared is used to draw it. The maintainer chose this on
  2026-10-09, rejecting a shared stylesheet and shared components that pages would use, with a
  reservation: it may not hold up when several people, each in their own project, work on one
  canvas.
- **A mockup's look is its own.** A canvas may be a wireframe that deliberately looks unlike the
  product, a high-fidelity copy of it, or document-like pages and charts. No mockup version
  draws on the product's Story style, and the Story style takes no files from a mockup. An agent
  may carry parts of a mockup's design into the Story style by writing them into it. The
  maintainer chose this on 2026-10-13, rejecting one design system for both.
- **A canvas is published whole.** An agent builds it in its own project and publishes it in one
  call, uploading it as a ZIP when it is large. Rejected on 2026-10-13: staging versions that
  gather pages over several calls before one commit, which the upload makes unneeded.
- **A version carries files for collaborators**: text files such as a DESIGN.md, components and
  tokens, which people see in the inspector and agents pull into their projects with the
  download, so collaborators share the conventions behind a canvas. They belong to the version
  and carry forward like pages. WhatBuild never draws a page with them, and keeps no PRODUCT.md;
  the maintainer chose this on 2026-10-09.
- One page of a mockup can be **promoted to the Story**, by an agent or by an editor from the
  mockup. The Story page's version points at that page in one mockup version and never copies it;
  it stays on that version until it is promoted again, so the Story never changes under its
  readers when the mockup does. A Story reader sees the promoted page and nothing else of the
  mockup. The maintainer chose both on 2026-10-09.
- **Promoted pages are the Story's Published mockups**: a section of their own after the page
  tree, flat, in an order agents set, where a reader flips from one to the next with the arrow
  keys or the control beside the crumbs. A page showing a mockup page is never in the tree, and
  every one is in the section, so nothing promoted waits unseen for an agent to place it. The
  maintainer chose this on 2026-10-10, over a list of unplaced pages and over letting agents put
  promoted pages anywhere in the tree.
- The third stage is **Exploration**: mockups and assumptions (insights and decisions, which it
  also held, were retired: [decision](insights-and-decisions-are-retired-into-evidence.md)). Its
  URLs are `/exploration/…`, and old `/synthesis/…` links open the same place. Its count is its
  mockups and its current assumptions together, as the Story's count includes its Published
  mockups ([decision](each-stage-counts-every-item-it-holds.md), the maintainer's choice on
  2026-10-10, replacing a count of the mockups alone).
- Rejected names: "exploration" for the item (too abstract for people and for agents reading the
  tool list), "wireframe" (suggests grey boxes) and "prototype" (suggests a working product).

## Consequences

- A team compares directions at real size and clicks through them, with the reasons beside each.
- A promoted page needs a second step to move to a newer mockup version; the Story page says when
  one exists.
- Stakeholders see every direction a team promoted, in one place and in order, without an agent
  placing each page. A narrative page that wants a mockup beside its argument links to it.
- Collaborators share a canvas's styles and components by pulling its files into their projects,
  not through WhatBuild drawing pages from them. If their pages still drift apart, pages drawn from
  a shared stylesheet and components is the change to revisit (an open question on the
  [roadmap](../spec/10-roadmap.md)).
- An agent can publish an existing prototype as it is. Its forms work as far as their submit
  handlers; a submission the handler does not stop goes nowhere, so a prototype calls
  `preventDefault()`. A page promoted to the Story is the mockup's page, so it keeps the mockup's
  rules and sandbox there.
- Each version stores every page's HTML and every file in full, so a long run of versions costs
  storage; 48 pages and 8,000,000 characters of HTML, 50 files and 2,000,000 characters of files a
  version, and 50 mockups a product, bound it. A prototype's bytes are stored once per mockup by
  hash, and bounded by its own limits.

## Constrains

- Each surface's rules are one `PageRules` in `packages/core/src/html-rules.ts`; mockup HTML is
  checked by `inspectMockupHtml`, sent in a call or in an uploaded ZIP, and served only by the
  Story's sandboxed responses (`STORY_RESPONSE_HEADERS` in `packages/core/src/story-html.ts`,
  `apps/server/src/rest.ts`); there is no looser path for a page's own HTML. A prototype's files
  are served by their own route, under the prototype's policy (`apps/server/src/prototype.ts`).
- A mockup page's sandbox allows forms, so a submit handler runs; it is safe only because every
  response that serves a page says `form-action 'none'`, so no submission goes anywhere. The
  sandbox for each surface is one constant in `packages/core/src/page-sandbox.ts`, used by the
  responses (`pageResponseHeaders`) and by the app's frames alike; a Story page's has no
  `allow-forms` (held by `apps/server/test/mockups.test.ts`).
- Whether a page is a published mockup follows its current version (`story_versions.mockup`), and
  `story.set_hierarchy` refuses one in the tree and any other page in `mockups`
  (`packages/core/src/ops/story.ts`).

Specified in: [04-data-model §4.12](../spec/04-data-model.md), [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [07-web-app §7.7](../spec/07-web-app.md).
