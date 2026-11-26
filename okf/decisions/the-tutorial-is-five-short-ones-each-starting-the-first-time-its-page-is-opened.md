---
type: Decision
title: The tutorial is five short ones, a welcome and one for each page, each starting by itself the first time its page is opened, and the person can turn them all off
description: Instead of one tutorial of twenty stops, a welcome of the navigation and an agent at work is offered once in the example organization and once on a product of the person's own, and each of a product's four pages has a tutorial of its own of three to seven stops that starts by itself the first time the page is opened, so no one meets more than a few stops at once; every tutorial offers to turn them all off.
tags: [decision, web, onboarding, tutorial]
generated: {by: agent:claude, at: 2026-11-25}
status: stable
---

# The tutorial is five short ones, a welcome and one for each page, each starting by itself the first time its page is opened, and the person can turn them all off

## Context

The spotlight tutorial walked twenty stops in one line across a product's four pages, too many for
someone to take in at once, and long enough that it was built to be closed and resumed part-way.
Each page's stops are only of use on that page. The maintainer chose on 2026-11-17 to split it: a
welcome, then a tutorial for each page that shows up the first time someone uses that page, with
Connect an agent at the end of each while no agent is connected, and a way to turn tutorials off
from any of them. It replaces the one tutorial and its resuming.

The welcome was first offered once per person, wherever it came first. Most newcomers explore the
example organization before starting their own, so they met it on a finished product and never on
their own empty one, whose lists wait for an agent. The maintainer chose on 2026-11-25 to offer it
once more there.

## Decision

- Five tutorials (`TUTORIALS` in `apps/web/src/tutorial/stops.ts`): **WhatBuild** (the main
  navigation and the agent stage, over the product's own screen) and **Idea**, **Evidence**,
  **Exploration** and **Story**, each entered at its item in the navigation and never leaving its
  page. While no agent is connected, each ends on the "No agent connected" seat.
- The welcome is offered on the first screen with a product's panel: once in the example
  organization, and once on a product of the person's own (`welcomeSeen` and `dueTutorial` in
  `state.ts`). Offered in the example first, it comes again, the same offer, on the first product
  of their own; offered on their own first, it comes nowhere again. After it, each page's tutorial
  starts by itself the first time that page is opened, wherever that was, but not on the visit the
  welcome was offered on: Idea's waits for the next visit to Idea.
- A tutorial counts as shown once it starts; closed part-way, it is taken again from the start
  from the account menu, which offers the tutorial of the page on screen. Nothing resumes.
- **Turn off tutorials** is in the welcome and in every stop's foot (the close button closes only
  that tutorial). Off, nothing starts by itself; Settings → Account turns them on again, and every
  tutorial stays in the account menu.
- Rejected: one tutorial with chapters (still long, and its stops off the page in view); a
  question on closing whether to turn them all off (a click more every time); the choice only in a
  toast (gone before it is read); every tutorial remembered apart for the example and for one's
  own (each page's tutorial would come a second time, on pages the person was just shown).

## Consequences

- No one is shown more than seven stops at once, and each page's stops come when that page is in
  front of them. A page's tutorial can start right after the person clicks into the page.
- The account keeps which tutorials were shown and whether they are off, not a stop
  ([decision](the-tutorial-is-remembered-on-the-account-and-reached-by-no-agent.md)), so a
  request goes when a tutorial starts, not at every stop. The welcome offered on a product of
  one's own is kept apart from the welcome (`welcome-own`).

## Constrains

- A new stop belongs to the page whose screen it lights; a stop that needs another page is a stop
  of that page's tutorial. Whether something new gets a stop is the maintainer's call.
- Every tutorial's words follow §7.4: the word is "tutorial", never "tour".

Specified in: [§7.4 The tutorial](../spec/07-web-app.md#the-tutorial).
