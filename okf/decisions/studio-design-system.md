---
type: Decision
title: The web app uses the Studio design system
description: A quiet floating-panel interface with four destinations in a fixed order, recorded in DESIGN.md.
tags: [decision, design, web]
generated: {by: agent:claude, at: 2026-10-09}
status: stable
---

# The web app uses the Studio design system

## Context

People mostly read evidence and synthesis. The interface should stay out of the way, work in a phone browser, and make the product's story legible.

## Decision

- The design system is Studio, documented in [`DESIGN.md`](../../DESIGN.md) with tokens in `apps/web/src/styles/tokens.css`.
- One floating left panel holds Idea, Evidence, Exploration, Story in that order, then Connect an agent, Activity and Settings. It hides fully, never to an icon rail.
- Destinations are named for what they hold: Evidence holds the sources; Exploration holds the mockups and the assumption register. The web app's URLs follow the areas (`/evidence/…`, `/exploration/mockups|assumptions/…`). Objects keep their own nouns (source, mockup, assumption), and so do REST paths, operations and MCP tools (`sources`, `mockups`, `assumptions`), because those address objects rather than areas.
- No in-app tabs, peek drawers or embedded agent chat: rows are real links and the browser owns tabs and history. A right-hand inspector appears only on Story pages, mockups and source pages.
- The right-hand inspector hides and shows by the same mechanism as the panel: a hide button in its head, a shortcut, and a small button in its place while hidden. Shown, it docks beside the content at every width above a phone, and on a phone it is a drawer like the panel; it never overlays content that should stay usable. At 1100px and below it starts hidden. The maintainer chose this on 2026-09-28, replacing an overlay opened by a "Details" button that appeared only on narrow screens.
- Activity is reached from the account menu. Menus and popovers follow the light or dark theme; the theme follows the system by default.
- Inter and Lucide icons are installed with the app (the CSP allows scripts only from the app's origin).

## Consequences

- Screens share one layout pattern; state lives in the URL.

## Constrains

- UI changes follow DESIGN.md. A new visual direction is a maintainer decision.
- The overview's intro is the one place type exceeds 20px ([decision](the-overview-is-the-front-door.md)).

Specified in: [07-web-app](../spec/07-web-app.md).
