---
type: Decision
title: Mockups are versioned canvases of agent-made HTML, in a stage called Exploration
description: Agents build directions as sandboxed HTML pages on a canvas under a brief, versioned as a whole and downloadable to build the next one; the third stage is named Exploration.
tags: [decision, mockups, exploration, story, security, web, agents]
generated: {by: agent:claude, at: 2026-10-09}
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
  no categories), under a Markdown **brief** that says what the canvas explores. It may list the
  outcomes, sources and assumptions it explores and cite passages.
- **A version is the whole canvas.** Every publish makes the next version; a later version keeps
  the fields and the pages it does not change.
- Pages are untrusted, like Story pages: checked by the Story's HTML rules and shown only in its
  sandbox ([decision](story-pages-are-sandboxed-agent-html.md)), without the app's theme.
- A version downloads as a ZIP (brief, manifest, each page's HTML and notes) through a short-lived
  grant, so an agent builds the next version in its own project and publishes the pages it changed.
- Agents publish and archive mockups; the web app shows them on a pannable, zoomable canvas and
  downloads them.
- One page of a mockup can be **promoted to the Story**, by an agent or by an editor from the
  mockup. The Story page's version points at that page in one mockup version and never copies it;
  it stays on that version until it is promoted again, so the Story never changes under its
  readers when the mockup does. A Story reader sees the promoted page and nothing else of the
  mockup. The maintainer chose both on 2026-10-09.
- The third stage is **Exploration**: mockups, insights, assumptions and decisions. Its URLs are
  `/exploration/…`, and old `/synthesis/…` links open the same place.
- Rejected names: "exploration" for the item (too abstract for people and for agents reading the
  tool list), "wireframe" (suggests grey boxes) and "prototype" (suggests a working product).

## Consequences

- A team compares directions at real size and clicks through them, with the reasons beside each.
- A promoted page needs a second step to move to a newer mockup version; the Story page says when
  one exists.
- Each version stores every page's HTML in full, so a long run of versions costs storage; 24 pages
  and 8,000,000 characters a version, and 50 mockups a product, bound it.
- Exploration still holds insights and decisions; moving them into Evidence is on the
  [roadmap](../spec/10-roadmap.md).

## Constrains

- Mockup HTML is checked by `inspectStoryHtml` and served by the Story's sandboxed responses
  (`packages/core/src/story-html.ts`, `apps/server/src/rest.ts`); there is no looser path.
- A source that a mockup cites or lists is reported, guarded on move and counted in a delete's
  impact exactly as for Story pages (`packages/core/src/ops/sources.ts`).

Specified in: [04-data-model §4.12](../spec/04-data-model.md), [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [07-web-app §7.7](../spec/07-web-app.md).
