---
type: Decision
title: Guests come into the example organization while there is room, under limits an instance owner sets
description: An account in no organization is a guest; it may be made by anyone when an instance owner allows it, and holds one of a few places while it reads the example, waiting in line past them.
tags: [decision, guests, example-organization, sign-up, cost, limits]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Guests come into the example organization while there is room, under limits an instance owner sets

## Context

Every account reads the [example organization](every-account-reads-the-example-organization-which-only-its-staff-write.md),
but an account could be made only for someone invited, listed or given an allowance, so nobody
could try WhatBuild without being let in by hand. Letting anyone in costs the deployment while they
work, and a spike of visitors would cost the most. The maintainer chose on 2026-10-26 that anyone
may make an account and explore the example on their own, that how many come in is the
instance owner's to set and to raise as the deployment grows, and that these accounts are called
guests. The same day they chose that a guest who wants an organization of their own joins a
waitlist the instance owner lets people in from.

## Decision

- **A guest account** is one in no organization, with no allowance to start one, that is not an
  instance owner. It reads the example organization (and its agent reads it over MCP), changes
  nothing, and is never offered as a plan.
- **Making an account is free; coming in is not.** While `self_serve` is on, anyone may make one.
  Each call a guest account makes into the example takes a **place**, held while it calls at least
  every `idle_minutes`. Past `at_once` places it waits in line and comes in on its own; past
  `new_per_day` first-time guests, or its `minutes_per_day`, it comes back after midnight UTC.
  `at_once` 0 lets no guest in.
- **Only guest accounts wait.** People in an organization, allowed to start one, or running the
  instance never do, the example's own people included.
- **A guest's limits are the instance owner's** (`products.set_guests`, `/instance`): those above,
  calls a minute and bytes downloaded a day (10 MB to start), stored with the deployment
  (`instance_settings`) over defaults in the code (`GUEST_DEFAULTS`). So are each plan's limits
  and price ([decision](limits-belong-to-plans-and-each-organization-is-on-a-plan-of-its-own.md)).
- **A guest asks for an organization of their own** with one click, and joins the waitlist the
  public site's form also feeds (`interest`). An instance owner reads it on `/instance` and lets
  someone in by giving them an allowance, which emails them; they are then no guest.
- Rejected: limits measured from the deployment's load. Fixed numbers an instance owner raises are
  predictable and cost nothing to measure; adaptive admission can come later.

## Consequences

- WhatBuild can be tried without anyone being let in, and the cost of trying it is bounded by
  numbers on one page.
- A guest who leaves the page holds no place for long; one who stays may wait.

## Constrains

- Admission is `enterAsGuest` in `packages/core/src/guests.ts`, under one advisory lock;
  `execute` and `admitRead` call it for a guest account's every call into the example.
- The web app shows a guest account the waiting page (`GuestGate`) while it is not in.

Specified in: [§3.2](../spec/03-accounts-teams-and-identity.md#32-accounts-and-sign-in), [§3.10](../spec/03-accounts-teams-and-identity.md#310-the-example-organization), [§9.7](../spec/09-data-lifecycle.md#97-plans-and-limits).
