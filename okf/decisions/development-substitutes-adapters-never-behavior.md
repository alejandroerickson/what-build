---
type: Decision
title: Local development may substitute adapters, never behavior
description: One command runs the whole product locally with no accounts; any behavior difference from production is a bug.
tags: [decision, development, testing]
generated: {by: agent:claude, at: 2026-10-18}
status: stable
---

# Local development may substitute adapters, never behavior

## Context

Contributors will not provision cloud services to fix a parser bug, and CI should be free and deterministic.

## Decision

- `pnpm dev` starts an embedded Postgres, runs migrations and the synthetic seed, and runs the API, the worker and Vite.
- Every embedded cluster is made in UTF-8 with the C.UTF-8 locale, as Neon's databases are by default, so text functions count characters, text sorts by code point, and search reads letters beyond ASCII as production does. Rejected: the cluster embedded-postgres makes by itself, SQL_ASCII in the C locale, where `left()` and `length()` count bytes. A system without a C.UTF-8 locale gets PostgreSQL's own (`builtin`) C.UTF-8.
- Files go to the filesystem instead of Cloud Storage; mail is printed; a development-only sign-in exists.
- A server is a development one only when `NODE_ENV` is exactly `development` or `test`, which `pnpm dev`, the development scripts and the tests set. Any other value, or none, is production, so a server started by hand without it is never open to anyone signing in as anyone. Rejected: production only when `NODE_ENV` says `production`, which fails open.
- Parsing still runs on the job queue, never inline in a request.

## Consequences

- CI runs the same path: typecheck, tests against a real Postgres, build.
- A cluster made before clusters were UTF-8 is made again where it holds nothing to keep (the tests', the end-to-end instance's); the development cluster holds a person's work, so it is kept, and `pnpm dev` says so at start.

## Constrains

- Ports (`BlobStore`, `Mailer`, …) have one production and one local adapter each; code outside an adapter never imports a provider SDK.
- Whether a server is a development one is decided once, in `apps/server/src/config.ts`, from `NODE_ENV`; a script or tool that starts one sets `NODE_ENV=development` itself.
- Local clusters are made only by `startLocalPg` in `apps/server/src/testing/pg.ts`, with its `initdb` flags.

Specified in: [02-architecture](../spec/02-architecture.md), [local-development](../operations/local-development.md).
