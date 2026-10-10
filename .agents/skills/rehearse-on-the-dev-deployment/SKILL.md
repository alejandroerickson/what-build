---
name: rehearse-on-the-dev-deployment
description: Work on WhatBuild's dev deployment, a second Cloud Run deployment that holds a copy of production; rehearse a release or a commit of main (its migrations above all) before production moves, refresh its copy of production's database and files, put it back to the copy, set one up from nothing, or perform the restore drill there. Use when asked to deploy to dev or staging, to rehearse, try or test a release or migration on a deployment, to copy production's data to dev, to reset or refresh dev, to set up a dev deployment, or to rehearse a restore from backup.
---

# Rehearse on the dev deployment

You are working on the maintainer's dev deployment, which holds real people's data. The
knowledge, with every command, is in `okf/operations/dev-deployment.md`; restoring and checking a
dump are in `okf/operations/backups.md`. Read the sections your task needs before the first
command. This file is how to conduct the work.

## What must stay true

- **Production is read, never written.** Read it only through its backup role
  (`whatbuild-backup-database-url`) and its files bucket. Never use production's application
  secret, and never run anything that changes production's project, database or bucket.
- **Name the project in every command.** Take dev's values from `.env` in the maintainer's clone
  (`GCP_DEV_PROJECT`, `GCP_DEV_REGION`, `DEV_URL`, `NEON_DEV_PROJECT`, `NEON_DEV_BRANCH`,
  `NEON_DEV_COPY_BRANCH`, `NEON_DEV_COPY_TAKEN`) and pass `--project` and `--project-id` every
  time, never `gcloud`'s current project. Never write the values into the repository.
- **Dev shares nothing with production**: no secret, OAuth client, database or bucket.
- **The copy is real people's data.** Keep dumps in a directory only you can read and delete them
  once loaded. Nothing from the copy goes into the repository, a commit, an issue or a pull
  request; in a report to the maintainer you may say what you saw.
- **Never repair a migration on dev by hand.** A migration or job that fails on dev is the finding
  the rehearsal exists for. Put dev back; the fix is a new commit.
- **Say before replacing dev's data.** Putting dev back or refreshing it loses what was done on dev
  since; tell the maintainer if a rehearsal or a test may still be in progress there.

## Procedure

**Rehearsing a release** (the usual task, often from `make-a-release` before production is
approved):

1. Compare what production and dev run (`/api/v1/meta` on both) and when dev's copy was taken.
   If dev is ahead of production, put it back. If production migrated after the copy, or the
   maintainer wants recent data, refresh it.
2. Deploy the tag, or a commit of `main`, with the command in the guide's "Rehearsing a release".
3. Check, from the guide: every build step, a `migrated …` line per new migration, every queued
   job done without an error, `/api/v1/meta`, the changed screens on the copied data, and logs
   without 500s.
4. Report what ran, what migrated, what each job did, and what failed or could not be checked.
   Say plainly whether production's build should be approved.

**Putting it back, refreshing the copy, setting one up:** the guide's sections of those names, in
order. After a refresh, update `NEON_DEV_COPY_TAKEN` in `.env`.

**The restore drill:** `okf/operations/backups.md`, "The restore drill". Record its date and
elapsed time where the guide says; that record is a fact about the system, not a session note.

## When the guide is wrong

If a command fails because a guide is out of date, finish the work, then correct the guide with
the `okf-update` skill and propose it as a pull request. Do not record the session itself in the
repository.
