---
type: Decision
title: The web app uses the Studio design system
description: A quiet floating-panel interface with four destinations in a fixed order, recorded in DESIGN.md.
tags: [decision, design, web]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# The web app uses the Studio design system

## Context

People mostly read evidence and synthesis. The interface should stay out of the way, work in a phone browser, and make the product's story legible.

## Decision

- The design system is Studio, documented in [`DESIGN.md`](../../DESIGN.md) with tokens in `apps/web/src/styles/tokens.css`.
- One floating left panel holds Idea, Evidence, Synthesis, Story in that order, then Agents and Settings. It hides fully, never to an icon rail.
- Destinations are named for what they hold: Evidence holds the sources; Synthesis holds Insights (the insight documents) and the assumption and decision registers. The web app's URLs follow the areas (`/evidence/…`, `/synthesis/insights|assumptions|decisions/…`). Objects keep their own nouns (source, insight), and so do REST paths, operations and MCP tools (`sources`, `insights`), because those address objects rather than areas.
- No in-app tabs, peek drawers or embedded agent chat: rows are real links and the browser owns tabs and history. A right-hand inspector appears only on Story and source pages.
- Activity is reached from the account menu. Menus and popovers follow the light or dark theme; the theme follows the system by default.
- Inter and Lucide icons are installed with the app (the CSP allows scripts only from the app's origin).

## Consequences

- Screens share one layout pattern; state lives in the URL.

## Constrains

- UI changes follow DESIGN.md. A new visual direction is a maintainer decision.

Specified in: [07-web-app](../spec/07-web-app.md).
