---
type: Decision
title: One stateless container image serves everything and runs the worker
description: The web app, REST, MCP, OAuth, the upload relay and the job worker ship in one image on Cloud Run.
tags: [decision, architecture, deployment]
generated: {by: agent:claude, at: 2026-10-31}
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
- What the server leaves out of its bundle comes from `pnpm-lock.yaml`, with everything beneath it.
  A workspace package of its own, `packages/server-external`, lists those packages, and the image
  installs it with `pnpm deploy --prod --ignore-scripts`. There is one lockfile, so `pnpm security`,
  Dependabot and the tests read the tree the image ships
  ([security checks](../operations/security-checks.md)). Rejected: `npm install` from a generated
  `package.json`, which pins those packages and nothing beneath them, and a committed
  `package-lock.json` beside it, a second lockfile to scan and keep in step.

## Consequences

- Any instance can serve any request.
- `pnpm deploy` asks for `inject-workspace-packages` to deploy from the shared lockfile. The image's
  build passes it to that one command, and the package has no workspace dependencies for it to
  change; the workspace's own layout and lockfile stay as they are.
- Splitting the worker into its own service is a configuration change.
- In the service the worker sleeps a minute after the last signed-in request or job, and such a
  request, a commit that queues work or a job falling due wakes it, so a database that suspends when
  idle can sleep while an instance stays up, and a stranger's requests cannot keep it awake
  ([02-architecture](../spec/02-architecture.md)).
- Large files never pass through the application or a tool call.
- MCP has no session, so the server cannot tell a connected client that a release added tools
  (`notifications/tools/list_changed`). The client keeps its list until a new session; the guide,
  the server's instructions and its `unknown_tool` and `unknown_action` refusals say a new session
  brings the current one, and every product-scoped result gives the server's `tools_version`, so
  an upgrade made mid-conversation shows in the next answer
  ([06](../spec/06-operations-and-adapters.md)).

## Constrains

- Storage clients are built at startup and passed on context, never at module scope.
- A package left out of the bundle is listed in `packages/server-external`, which is what
  `apps/server/build.mjs` leaves out; the build fails if the code resolves it at another version.

Specified in: [02-architecture](../spec/02-architecture.md), [cloud-run](../operations/cloud-run.md).
