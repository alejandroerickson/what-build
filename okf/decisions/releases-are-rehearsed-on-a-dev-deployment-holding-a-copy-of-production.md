---
type: Decision
title: A release that migrates is rehearsed on a dev deployment that holds a copy of production, before production's deploy is approved
description: A second Cloud Run deployment, sharing nothing with production, holds a copy of the organizations its instance owners own, with their files, so that a release's migrations run on real data through the real deploy before production runs them.
tags: [decision, deployment, releases, migrations, dev, production, privacy, operations]
generated: {by: agent:claude, at: 2026-10-27}
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
for this, which narrows that decision's rejection of "a shared copy in the cloud". On 2026-10-27
they settled what the copy may hold: only organizations an instance owner owns
([decision](copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)).

## Decision

- **The dev deployment** is a Cloud Run deployment of its own: its own Google Cloud project, Neon
  project, bucket, secrets and Google OAuth client, laid out by `setup.sh` and deployed by
  `cloudbuild.yaml` as production is. It has no trigger, analytics, public site or nightly backup.
- **It holds a copy of production's own organizations**, taken by hand through production's
  read-only backup role and its bucket, and kept as loaded in its own Neon branch so it can be put
  back. The copy holds the example organization, or the organizations `.env` names, each one an
  instance owner owns, and nothing of any other: customers' organizations never reach dev
  ([decision](copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)).
- **Before production's build of a release that adds a migration is approved**, that release (or
  its commit, before tagging) is deployed to dev, and its migrations and the jobs they queue are
  checked there, unless the maintainer says to skip it. The same holds for a release that
  changes parsing (`packages/parsers/`, `apps/server/src/parse-thread.ts`, the `WHATBUILD_PARSE_*` limits) or the service's memory: hostile files are uploaded on dev and its memory is read there
  (`scripts/hostile-files.mjs`), since a parse that runs out of memory takes the instance with it.
- Rejected: **a dev deployment with synthetic data only**, which would not show migrations on the
  shapes months of real use leave; **a branch of production's Neon database for dev**, which would
  give dev's identity and key access to production's project; **a trigger on dev**, which would
  deploy without anyone deciding to rehearse.

## Consequences

- A migration reaches production only after it ran once through the same build on the same data.
- The instance owners' organizations, with the accounts their rows name, live in a second place,
  behind the dev project's credentials, held by the same people as production's. A migration that
  rewrites content they lack is rehearsed on synthetic organizations shaped like it.
- Dev is no scratch environment for the restore drill, which restores every organization; that
  drill stays in production's own accounts ([backups](../operations/backups.md#the-restore-drill)).
- The copy ages; a rehearsal after production migrated needs a fresh one.

## Constrains

- Dev never shares a project, database, bucket, secret or OAuth client with production, and no
  credential of dev reaches production. Production is only read, through the backup role.
- Dumps are deleted once loaded; nothing from the copy enters the repository.
- Dev is refreshed only from a pull that checked an instance owner owns each organization in it.
- `.agents/skills/make-a-release` rehearses a release that migrates before approving production.

Specified in: [the dev deployment](../operations/dev-deployment.md).
