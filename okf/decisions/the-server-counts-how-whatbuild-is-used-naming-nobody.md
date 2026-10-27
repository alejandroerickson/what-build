---
type: Decision
title: The server counts how WhatBuild is used, for everyone and through both doors, naming nobody
description: Every call to an operation is counted on the server by operation, door, agent client and outcome, and people under a keyed pseudonym kept 14 months, so agents and people who decline cookies are measured without a cookie, and only the instance's owners read the totals.
tags: [decision, privacy, analytics, usage, agents, operations]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# The server counts how WhatBuild is used, for everyone and through both doors, naming nobody

## Context

Google Analytics sees only people who accept cookies, and only in the browser, while agents
connected over MCP make most of the calls to a deployment and are invisible to it; the request log
sees only `POST /mcp`. Finding out which features are used, and whether people come back, needs
counting where every call passes. The maintainer chose on 2026-10-11 to measure returning people
without identifying anyone, and to leave the instance's owners out. Hashing addresses was rejected:
people sign in, an account is a steadier anchor than an address that changes and is shared, and a
hashed address is still personal data.

## Decision

- `execute` counts every call when it ends, through either door: the operation, the door, the
  agent client's family (never the name a client registered with), in the example organization or
  not, owner or not, and the outcome. The MCP door counts the calls it refuses before `execute`. Counts per day name
  nobody and are kept. They are added up in memory and written every ten seconds, so counting
  costs a call nothing.
- People are counted per day and feature under `personOf`: an HMAC of the account id with a key
  derived from the grant key, so the pseudonym means nothing without the deployment's secret. Those
  rows are deleted after 14 months, as long as Google Analytics keeps an event.
- Nothing stored names an organization, a product, a record, an address or content. No cookie or
  browser storage is involved, so the cookie choice does not govern it. `/cookies` says that it
  happens and what is kept.
- Only the instance's owners read the report (`pnpm usage`; `products.usage` over REST, which no
  agent is offered), and it leaves them out unless asked. The app gives Google Analytics nothing for them either.

## Consequences

- One report answers what is used, by whom (people and agents), what fails, what nobody uses, and
  who comes back, on every deployment, with nothing to set up.
- Pseudonymous data is still personal data while the key exists: a request to be removed is met by
  computing the person's pseudonym and deleting its rows ([guide](../operations/analytics.md)).
- Rotating the grant key starts every pseudonym afresh.

## Constrains

- Every operation runs through `execute`, which counts it (`packages/core/src/usage.ts`). The MCP
  door counts what it refuses before `execute` (`apps/server/src/mcp.ts`). What is not counted
  (`describe`, REST refusals before an operation, the routes that serve bytes) is listed in the
  [guide](../operations/analytics.md).
- Nothing joins `usage_people` to `accounts`; the report gives totals only.
- A new dimension is a fixed, closed set of values, never free text from a caller.

Specified in: [§9.1](../spec/09-data-lifecycle.md) and [§4.15](../spec/04-data-model.md).
