---
type: Decision
title: Each Cloud Run deploy on Neon branches the database before migrating, as a restore point
description: A Neon branch is made in a second at any size and restores in place, so every deploy takes one before its migrations run and fails without it.
tags: [decision, deployment, operations, database, neon, cloud-run]
generated: {by: agent:claude, at: 2026-10-03}
status: stable
---

# Each Cloud Run deploy on Neon branches the database before migrating, as a restore point

## Context

Migrations are forward-only and each runs in a transaction, so a failing one changes nothing; a
wrong one that succeeds can only be undone from a copy of the database taken just before it. The
Cloud Run deployment runs on Neon's free plan, whose own restore history is six hours, beside a
nightly `pg_dump`. A dump taken in the deploy would also serve and would live outside Neon, but it
grows slower with the data and restores into a new database. The maintainer chose Neon branches on
2026-10-03.

## Decision

- `cloudbuild.yaml` has a `restore-point` step before `migrate`: with `_NEON_PROJECT` set, it
  branches `_NEON_BRANCH` as `pre-migrate-<UTC time>-<commit>`, waits for Neon to finish, and fails
  the build if it cannot. It keeps the newest `_NEON_KEEP` (3) and never fails over removing one.
- The step authenticates with a Neon API key scoped to the one project, in Secret Manager as
  `whatbuild-neon-api-key`, readable by the build identity only.
- Going back is `neon branches restore` onto the restore point, in place, preserving the state it
  replaces, then routing traffic to the matching revision.
- Rejected: a branch only when migrations are pending. Telling would mean reading the database
  before the image runs; a branch costs a second and almost no storage.

## Consequences

- Any deploy can be undone to the moment before its migrations, in seconds, with the same
  connection string. Writes after that moment are lost except in the preserved branch.
- The restore point shares Neon's fate; the nightly dump outside Neon remains the backup.
- Without `_NEON_PROJECT`, or on another Postgres, the step does nothing.

## Constrains

- The key never appears in the repository or the build log; the project ID is passed at deploy
  time, not committed.
- The nightly logical backup stays ([Cloud Run](../operations/cloud-run.md)).

Specified in: [Cloud Run](../operations/cloud-run.md) (a restore point before migrating),
[recovering from a bad release](../operations/recovering-from-a-bad-release.md).
