---
type: Decision
title: Local development may substitute adapters, never behavior
description: One command runs the whole product locally with no accounts; any behavior difference from production is a bug.
tags: [decision, development, testing]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Local development may substitute adapters, never behavior

## Context

Contributors will not provision cloud services to fix a parser bug, and CI should be free and deterministic.

## Decision

- `pnpm dev` starts an embedded Postgres, runs migrations and the synthetic seed, and runs the API, the worker and Vite.
- Files go to the filesystem instead of Cloud Storage; mail is printed; a development-only sign-in exists.
- Parsing still runs on the job queue, never inline in a request.

## Consequences

- CI runs the same path: typecheck, tests against a real Postgres, build.

## Constrains

- Ports (`BlobStore`, `Mailer`, …) have one production and one local adapter each; code outside an adapter never imports a provider SDK.

Specified in: [02-architecture](../spec/02-architecture.md), [local-development](../operations/local-development.md).
