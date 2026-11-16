---
type: Decision
title: The tutorial is remembered on the account, through the person's own session, and reached by no agent
description: Whether the tutorial was offered, the stop it was left at and whether it was finished are three columns of the account, read and written through GET and PATCH /api/v1/me, which only a web app session reaches, so the state follows the person between browsers and survives signing out, for a guest account too, and is no operation.
tags: [decision, web, accounts, onboarding, tutorial, agents]
generated: {by: agent:claude, at: 2026-11-15}
status: stable
---

# The tutorial is remembered on the account, through the person's own session, and reached by no agent

## Context

The tutorial is offered once per person, can be closed part-way and resumed, and offers itself
again once finished. That has to survive signing out, which clears the app's browser storage
(`apps/web/src/lib/local-state.ts`), and follow the person to another browser. It must work for a
guest account, which holds no role anywhere, and no agent should read or change it. The account
already keeps one display choice of the person's own this way: hiding the example organization
(`hide_example`). The maintainer asked for it to be kept on the account on 2026-11-15.

## Decision

- Three nullable columns of `accounts` (migration `0048`): `tutorial_offered_at`,
  `tutorial_stop` (0 to 63) and `tutorial_finished_at`. `GET /api/v1/me` and `/auth/session`
  give them as `tutorial: { offered, stop, finished }`; `PATCH /api/v1/me` with `tutorial` changes
  what it names, keeping the first offer and the last finish while they stay true.
- It is a route outside the registry, as `hide_example` is, not an operation: it needs no role,
  belongs to no organization or product, and is recorded in no activity log. REST takes no bearer
  token, so no agent reaches it; the operation and tool counts do not change.
- The web app keeps the stop at every stop, so leaving in any way leaves it closed where it was.
- Rejected: browser storage (lost at sign-out and on another browser), and an operation (it would
  be on the MCP surface unless marked web-only, and an activity entry per stop is noise).

## Consequences

- One request per stop while the tutorial runs. Ending an account clears the three columns.

## Constrains

- Only the person's own session reads or writes them, whatever roles they hold.

Specified in: [§3.2](../spec/03-accounts-and-identity.md#32-accounts-and-sign-in) and
[§7.4 The tutorial](../spec/07-web-app.md#the-tutorial).
