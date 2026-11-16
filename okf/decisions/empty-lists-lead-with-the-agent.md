---
type: Decision
title: An empty list says what belongs in it and what to ask an agent; adding by hand stays in the header
description: Every first-use list in a product has the same shape, leading with a request to copy for an agent and saying where to ask it, and nothing prescribes an order among the product's steps.
tags: [decision, web, design, onboarding, agents]
generated: {by: agent:claude, at: 2026-11-15}
status: stable
---

# An empty list says what belongs in it and what to ask an agent; adding by hand stays in the header

## Context

A new product shows an empty list on every destination, so these are a person's first impression
of WhatBuild. They had grown apart: different titles, different buttons in different places, a
"Next:" callout that implied an order, and manual buttons outnumbering the agent path that the
product is built around. The owner asked on 2026-09-29 for one self-explanatory pattern that points
at agents and lets people start anywhere.

## Decision

- Outcomes, Sources, Mockups and the Story share one first-use state
  (`FirstUse` in `apps/web/src/routes/first-use.tsx`): "No … yet", one or two sentences on what
  belongs there, and a request for an agent naming the product, with Copy. The line over the
  request says where to ask it: in the agent, once one is connected; until then, after Connect your
  agent above it on Idea, or after a link to Settings at Agents elsewhere. It carries no button to
  connect one: since 2026-11-15 the steps are at the top of Idea, and the panel's seat opens them
  ([decision](idea-leads-with-connect-your-agent-until-an-agent-is-connected.md)).
- Adding an item by hand stays in the sheet header, where it is once the list has items, as a
  default button. The empty body carries no second copy of it.
- A filter over a list with nothing in it shows the first-use state, not "No matches".
- No screen prescribes an order among outcomes, sources, mockups and the Story. Connecting an agent
  comes before all of them, and only Idea's Connect your agent says so.

## Consequences

- Each destination teaches its object and the agent path the same way, in the same place.
- People without edit access see what belongs there, without the request.

## Constrains

- New destination lists use `FirstUse` for their first-use state; the Story offers no manual path to
  writing a page ([decision](agents-write-the-story-people-arrange-it.md)).

Specified in: [§7 Web application](../spec/07-web-app.md).
