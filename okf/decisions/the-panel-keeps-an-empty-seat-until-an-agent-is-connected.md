---
type: Decision
title: The panel keeps an empty seat for an agent until one is connected
description: Until a person has an agent connected, Connect an agent's row in the panel is a card that says so and what an agent does here, for every role, with no dismissal, because most of WhatBuild happens through an agent.
tags: [decision, web, design, onboarding, agents]
generated: {by: agent:claude, at: 2026-11-01}
status: stable
---

# The panel keeps an empty seat for an agent until one is connected

## Context

Agents do most of the work in WhatBuild: they add and read sources, draft assumptions, build
mockups and write the Story, and two of those (publishing a mockup, writing a Story page) have no
path in the web app at all. The first-use states point at an agent, but only in a product with
nothing in it; someone who joins a product that already has evidence, or who reads the Story, could
use the web app for weeks without learning that half of it is out of reach. Three forms were
mocked up: a breathing mark on the row with a tooltip, a popover beside the panel shown once, and
the row itself widened into a card. The maintainer chose the card on 2026-11-01, and chose that it
shows for every kind of user until an agent is connected, rather than for editors only or with a
dismissal.

## Decision

- While the person's account-wide list of connected agents is empty, Connect an agent's row in
  the panel is the **empty seat** (`AgentSeat` in `apps/web/src/shell/agent-seat.tsx`): a card in
  the row's own place in the quiet group, saying "No agent connected", one line on what an agent
  does here, and Connect an agent as the panel's one accent button.
- It shows for **every role**, a reader included (under the Story, opening Connect an agent
  outside the product), and in the panel outside a product. On Connect an agent itself the plain
  row stays, marked current.
- **Nothing dismisses it.** Connecting an agent does. An agent connects from its own client, outside
  the tab, so while the list is empty the shared query (`apps/web/src/lib/agents.ts`) reads it again
  when the person comes back to the tab, and the row returns. It never polls, and reads nothing on
  coming back once there is an agent.
- It never covers content, and never opens a drawer. A hidden desktop panel is shown for it once a
  visit; while the panel is away the pill carries a mark with the same words. Focus mode on the Story
  keeps its panels away: someone in it, a reader on their first Story included, sees the seat on
  leaving it.
- Rejected: a popover beside the panel (it covers content and needs a dismissal), and showing it
  only to people who can write (a reader may connect a read-only agent too).

## Consequences

- Everyone who has not connected an agent is told, in the panel, on every screen, without a modal
  or a tour. The panel gives up about 90px to it while it shows.
- No new state on the server; the browser keeps one per-tab flag for opening a hidden panel once.

## Constrains

- The empty seat and the first-use states ask the same query (`AGENTS_KEY`), so the two never
  disagree about whether an agent is connected.
- The seat is the one accent button in the panel: nothing else in the panel takes a primary button
  ([Earned Accent Rule](../../apps/web/DESIGN.md)).

Specified in: [§7.2 The shell](../spec/07-web-app.md#72-the-shell-and-product-switching).
