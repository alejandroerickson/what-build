---
type: Decision
title: Postgres is the only database: rows, search and the job queue
description: One engine holds every row, the full-text index and the job queue, in development and production alike.
tags: [decision, architecture, postgres, search]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Postgres is the only database: rows, search and the job queue

## Context

The product must be cheap to run, run fully on a laptop, and behave the same everywhere. A second store or a search service would mean two dialects and two behaviors to keep in step.

## Decision

- Postgres holds all rows, full-text search (`tsvector` with GIN, `pg_trgm` for substring) and the job queue (`FOR UPDATE SKIP LOCKED`).
- Development runs a real embedded Postgres (`apps/server/src/dev.ts`), and server tests run against one too.
- Files and parse output live in object storage, not the database ([decision](one-stateless-image.md)).

## Consequences

- No broker, search cluster or cache to run.
- Search ranks identically in tests and production, so tests can assert ordering.
- Row-level security is available for tenant isolation ([decision](shared-schema-tenancy-with-row-level-security.md)).

## Constrains

- Queries use Kysely with forward-only SQL migrations in `apps/server/src/migrations/`.
- No new datastore without revisiting this record.

Specified in: [02-architecture](../spec/02-architecture.md), [08-search](../spec/08-search.md).
