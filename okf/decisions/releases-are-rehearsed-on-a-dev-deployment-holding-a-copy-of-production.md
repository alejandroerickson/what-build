---
type: Decision
title: A release that migrates is rehearsed on a dev deployment that holds a copy of production, before production's deploy is approved
description: A second Cloud Run deployment, sharing nothing with production, holds a copy of its database and files, so that a release's migrations run on real data through the real deploy before production runs them.
tags: [decision, deployment, releases, migrations, dev, production, privacy, operations]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# A release that migrates is rehearsed on a dev deployment that holds a copy of production, before production's deploy is approved

## Context

Production runs releases after approval ([decision](production-runs-releases-after-approval.md)),
and a migration that goes wrong is undone only by restoring the database, losing what was written
since ([recovering](../operations/recovering-from-a-bad-release.md)). A copy of production on the
maintainer's machine tries the code ([decision](qa-uses-a-private-copy-of-production.md)), but not
the deploy: the image build, the restore point, the migration job and the service on Cloud Run.
The maintainer chose on 2026-10-10 to keep a second deployment holding a copy of production's data
for this. They judged a cloud copy acceptable because WhatBuild has no customers yet, which
narrows that decision's rejection of "a shared copy in the cloud".

## Decision

- **The dev deployment** is a Cloud Run deployment of its own: its own Google Cloud project, Neon
  project, bucket, secrets and Google OAuth client, laid out by `setup.sh` and deployed by
  `cloudbuild.yaml` as production is. It has no trigger, analytics, public site or nightly backup.
- **It holds a copy of production**, taken by hand through production's read-only backup role
  and its bucket, and kept as loaded in its own Neon branch so it can be put back.
- **Before production's build of a release that adds a migration is approved**, that release (or
  its commit, before tagging) is deployed to dev, and its migrations and the jobs they queue are
  checked there, unless the maintainer says to skip it.
- Rejected: **a dev deployment with synthetic data only**, which would not show migrations on the
  shapes months of real use leave; **a branch of production's Neon database for dev**, which would
  give dev's identity and key access to production's project; **a trigger on dev**, which would
  deploy without anyone deciding to rehearse.

## Consequences

- A migration reaches production only after it ran once through the same build on the same data.
- Real people's data lives in a second place, behind the dev project's credentials, held by the
  same people as production's. The restore drill has a scratch environment.
- The copy ages; a rehearsal after production migrated needs a fresh one.

## Constrains

- Dev never shares a project, database, bucket, secret or OAuth client with production, and no
  credential of dev reaches production. Production is only read, through the backup role.
- Dumps are deleted once loaded; nothing from the copy enters the repository.
- Before public sign-up opens, whether dev may keep a copy of production is decided again
  ([roadmap](../spec/10-roadmap.md)).
- `.agents/skills/make-a-release` rehearses a release that migrates before approving production.

Specified in: [the dev deployment](../operations/dev-deployment.md).
