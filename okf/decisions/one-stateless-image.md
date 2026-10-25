---
type: Decision
title: One stateless container image serves everything and runs the worker
description: The web app, REST, MCP, OAuth, the upload relay and the job worker ship in one image on Cloud Run.
tags: [decision, architecture, deployment]
generated: {by: agent:claude, at: 2026-10-24}
status: stable
---

# One stateless container image serves everything and runs the worker

## Context

A side project on near-free infrastructure benefits from the fewest moving services. Cloud Run scales stateless containers to zero.

## Decision

- One image serves the SPA, `/api/v1`, `/mcp`, `/oauth` and the upload relay, and runs the job worker.
- The worker parses each file in a worker thread of the same process, held to a memory and a time
  limit, so a file can fail but never take the service down
  ([decision](each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits.md)).
- It is stateless: no module-level mutable state, no in-process caches of tenant data, MCP without session affinity.
- Uploads go straight to object storage through signed grants; the application registers the stored object afterwards.
- Migrations run as a separate job before a new revision serves traffic.

## Consequences

- Any instance can serve any request.
- Splitting the worker into its own service is a configuration change.
- Large files never pass through the application or a tool call.
- MCP has no session, so the server cannot tell a connected client that a release added tools
  (`notifications/tools/list_changed`). The client keeps its list until a new session; the skill,
  the server's instructions and its `unknown_tool` and `unknown_action` refusals tell the agent to
  ask the person for one, and every product-scoped result gives the server's `skill_version`, so
  an upgrade made mid-conversation shows in the next answer
  ([06](../spec/06-operations-and-adapters.md)).

## Constrains

- Storage clients are built at startup and passed on context, never at module scope.

Specified in: [02-architecture](../spec/02-architecture.md), [cloud-run](../operations/cloud-run.md).
