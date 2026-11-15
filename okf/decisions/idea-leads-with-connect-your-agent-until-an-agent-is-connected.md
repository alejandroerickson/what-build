---
type: Decision
title: Idea leads with the steps to connect an agent until one is connected, and the empty screens only say where to ask
description: Someone who can write in a product and has no agent connected finds Connect your agent, a sheet of numbered steps for their agent, at the top of Idea, with nothing to dismiss it; the empty screens and cards drop their buttons and say where to ask, because connecting is the first thing to do and the steps belong where people start.
tags: [decision, web, design, onboarding, agents]
generated: {by: agent:claude, at: 2026-11-15}
status: stable
---

# Idea leads with the steps to connect an agent until one is connected, and the empty screens only say where to ask

## Context

A new product opens on Idea. With no agent connected, three buttons there (the outcomes' empty
state, the panel's seat, and the empty states of the other screens) led to Settings → Agents, which
gave an address and no word on where it goes, and a card with no picture showed a request to paste
to an agent without saying so. Nothing in WhatBuild works for a writer until an agent is connected,
and connecting one means leaving the tab for the agent, meeting a WhatBuild page it opens, and
finding the way back. The maintainer approved this design and its words on 2026-11-15.

## Decision

- **Connect your agent** (`ConnectYourAgent` in `apps/web/src/routes/connect-steps.tsx`) is the
  first sheet on Idea, above the product concept, for someone who can write in the product while
  their account has no agent connected. It says what an agent does here, offers a choice of agent
  (Claude, Claude Code, Another agent, remembered on the device), and gives numbered steps for it,
  each saying where it happens. It gives the plain `/mcp` address.
- **Nothing dismisses it.** It goes when an agent is connected, which the shared query hears when
  the person comes back to the tab or the window, says Connected in a toast as it goes, and does not
  come back while they have one.
- **One set of steps.** Settings → Agents shows the same steps from the same component
  (`ConnectSteps`), adding what only it does: limiting the agent, its levels, a first request.
  Each agent's steps are written once, in a table at the top of that file.
- **The empty screens only say where to ask.** `FirstUse` carries no Connect an agent button. Its
  line over the request says where to ask: after the sheet on Idea, after a link to Settings →
  Agents elsewhere, and in the agent once one is connected. A card's "No picture yet" waits for an
  agent before it shows its request, under a line saying it is for the agent.
- The panel's seat stays
  ([decision](the-panel-keeps-an-empty-seat-until-an-agent-is-connected.md)), saying only that no
  agent is connected.
- Rejected: a dismissable sheet (with no agent, there is nothing else to do there first), and the
  steps in Settings alone (people start on Idea and should not have to find them).

## Consequences

- A writer with no agent sees how to connect one where they land, without a tour or a modal, and
  the screens under it stop repeating the same button.
- The steps name what Claude and Claude Code show; when those products change, the table changes.

## Constrains

- Steps to connect an agent live only in `AGENTS` in `apps/web/src/routes/connect-steps.tsx`; every
  screen that gives them uses `ConnectSteps`.
- The sheet, the first-use states, the cards and the seat ask the same query (`AGENTS_KEY`).

Specified in: [§7.5 Idea](../spec/07-web-app.md#75-idea), [§6.8](../spec/06-operations-and-adapters.md).
