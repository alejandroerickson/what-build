---
type: Decision
title: An empty list says what belongs in it and what to ask an agent; adding by hand stays in the header
description: Every first-use list in a product has the same shape, leading with a request to copy for an agent, and nothing prescribes an order of steps.
tags: [decision, web, design, onboarding, agents]
generated: {by: agent:claude, at: 2026-09-29T00:00:00Z}
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

- Outcomes, Sources, Mockups, Assumptions and the Story share one first-use state
  (`FirstUse` in `apps/web/src/routes/first-use.tsx`): "No … yet", one or two sentences on what
  belongs there, and a request for an agent naming the product, with Copy and, until the person
  has an agent connected, Connect an agent as the view's one accent button.
- Adding an item by hand stays in the sheet header, where it is once the list has items, as a
  default button. The empty body carries no second copy of it.
- A filter over a list with nothing in it shows the first-use state, not "No matches".
- No screen tells people what to do next or in what order.

## Consequences

- Each destination teaches its object and the agent path the same way, in the same place.
- People without edit access see what belongs there, without the request.

## Constrains

- New destination lists use `FirstUse` for their first-use state; the Story offers no manual path
  ([decision](agents-maintain-the-story-people-read-it.md)).

Specified in: [§7 Web application](../spec/07-web-app.md).
