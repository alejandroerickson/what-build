---
type: Decision
title: End-to-end tests are written plans that an agent runs through the web app and MCP, on a local instance reset to a golden master made from production's public sandbox
description: Plans in the product's vocabulary, run by any agent with a shell through tools in the repository, against an instance that starts each time from the public sandbox's organization and a non-sandbox copy of it, taken from a private pull of production; no separate test service.
tags: [decision, development, testing, qa, e2e, agents, sandbox]
generated: {by: agent:claude, at: 2026-10-16}
status: stable
---

# End-to-end tests are written plans that an agent runs through the web app and MCP, on a local instance reset to a golden master made from production's public sandbox

## Context

WhatBuild has two front doors, the web app and MCP, and most of what can go wrong is between them:
an agent's write a person cannot see, attribution, a role that reaches too far, guidance that leads
an agent astray. Scripted browser tests (`scripts/e2e.mjs`) check one fixed path and cannot notice
what nobody scripted. On 2026-10-10 the maintainer asked for end-to-end tests that an agent runs on
request, through both doors, on a fixed database, reporting failures and anomalies, with no separate
system; and chose production's public sandbox organization, without the other organizations, as
that database, both as a sandbox and as an ordinary organization, to cover more cases than the
small synthetic sample does.

## Decision

- A test is a plan in `e2e/plans/`: numbered steps in the product's vocabulary, each naming who
  acts, through which door, in which organization, and what to expect. An agent follows it, finding
  its own way through the interface, and reports failures and anything else that looks wrong.
- It runs on its own local instance (`pnpm dev:e2e`), which starts every time from a golden master
  built by `pnpm e2e golden` from a pull of production: the public sandbox's organization as pulled,
  every other organization removed, migrated to the code's schema, and a copy of it under new ids
  that is not a sandbox. Once built it does not change; migrations added later run on each fresh
  copy.
- The agent drives the web app with `pnpm e2e browser` and MCP with `pnpm e2e mcp`, both in the
  repository, so any agent with a shell can run a plan. The MCP client connects through the real
  OAuth flow. Agents may use their own browser tools instead.
- The skill `run-end-to-end-tests` conducts a run and sets the report's format.
- Rejected:
  - **The synthetic sample as the golden master.** It is small and tidy, and has no sandbox.
  - **A test service or a hosted runner.** One more system to keep, for work the agent in the
    repository can do on request.
  - **A golden master committed to the repository.** It is real people's data.

## Consequences

- Plans keep working when screens are redesigned, but a run is judged by an agent, so two runs can
  word the same finding differently. The run log and screenshots are the evidence.
- Building the golden master needs a pull, so only someone with access to production can make one.
  Runs are not in CI; `pnpm test` stays the gate on every change.

## Constrains

- The standard organization holds the same content as the sandbox organization: whatever the copy
  rewrites (every id, in any column or JSON), it rewrites consistently.
- `apps/server/src/e2e.ts`, `e2e-golden.ts`, `e2e-browser.ts`, `e2e-mcp.ts` and the `--e2e` mode of
  `dev.ts`: the instance keeps its own Postgres, files and ports, prints mail, and never changes the
  golden master.
- Plans name and quote nothing in the golden master, and what they upload is synthetic
  ([decision](qa-uses-a-private-copy-of-production.md)).

Specified in: [end-to-end tests](../operations/end-to-end-tests.md).
