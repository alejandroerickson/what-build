---
type: Decision
title: The tutorial is remembered on the account, through the person's own session, and reached by no agent
description: Which of the web app's tutorials the person has been shown, and whether they turned tutorials off, are two columns of the account, read and written through GET and PATCH /api/v1/me, which only a web app session reaches, so the state follows the person between browsers and survives signing out, for a guest account too, and is no operation.
tags: [decision, web, accounts, onboarding, tutorial, agents]
generated: {by: agent:claude, at: 2026-11-17}
status: stable
---

# The tutorial is remembered on the account, through the person's own session, and reached by no agent

## Context

Each of the web app's tutorials starts by itself once per person
([decision](the-tutorial-is-five-short-ones-each-starting-the-first-time-its-page-is-opened.md)),
and the person can turn them all off. That has to survive signing out, which clears the app's browser storage
(`apps/web/src/lib/local-state.ts`), and follow the person to another browser. It must work for a
guest account, which holds no role anywhere, and no agent should read or change it. The account
already keeps one display choice of the person's own this way: hiding the example organization
(`hide_example`). The maintainer asked for it to be kept on the account on 2026-11-15.

## Decision

- Two columns of `accounts` (migration `0049`, which replaced the one tutorial's three of `0048`):
  `tutorials_seen`, the tutorials shown (`welcome`, `idea`, `evidence`, `exploration`, `story`),
  and `tutorials_off`. `GET /api/v1/me` and `/auth/session` give them as
  `tutorial: { seen, off }`; `PATCH /api/v1/me` with `tutorial` adds the tutorials `seen` names,
  sets `off`, and with `reset: true` forgets those seen.
- It is a route outside the registry, as `hide_example` is, not an operation: it needs no role,
  belongs to no organization or product, and is recorded in no activity log. REST takes no bearer
  token, so no agent reaches it; the operation and tool counts do not change.
- The web app keeps a tutorial as shown when it starts, so leaving in any way never starts it by
  itself again.
- Rejected: browser storage (lost at sign-out and on another browser), and an operation (it would
  be on the MCP surface unless marked web-only, and an activity entry per stop is noise).

## Consequences

- One request when a tutorial starts, and one when tutorials are turned off or on. Ending an
  account clears the columns.

## Constrains

- Only the person's own session reads or writes them, whatever roles they hold.

Specified in: [§3.2](../spec/03-accounts-and-identity.md#32-accounts-and-sign-in) and
[§7.4 The tutorial](../spec/07-web-app.md#the-tutorial).
