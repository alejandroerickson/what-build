---
name: perform-the-restore-drill
description: Perform WhatBuild's restore drill - restore a deployment's nightly dump and its whole files bucket into a scratch database and bucket made for it inside the deployment's own accounts (a branch of its Neon project and a bucket in its Google Cloud project), check the rows and the files, time it, record the result and delete the scratch target. Use when asked to perform, run or rehearse the restore drill, to rehearse or test a restore from backup, to check that the backups can be restored, or to time a restore. Not for recovering a deployment a release broke (recover-a-deployment), and never on the dev deployment.
---

# Perform the restore drill

You are proving that a deployment's backups restore, by restoring them somewhere that is thrown
away afterwards. The procedure, with every command, is in `okf/operations/backups.md`, "The restore
drill"; restoring and checking a dump are in the sections before it. Read them before the first
command. This file is how to conduct the work.

## What must stay true

- **The drill stays in the deployment's own accounts.** It restores every organization's data, so
  the scratch database is a branch of the deployment's own Neon project (or a database on a scratch
  server in its own project), and the scratch bucket is in its own Google Cloud project. Never the
  dev deployment, this machine, or any other project: copies outside production hold only
  organizations an instance owner owns
  (`okf/decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md`).
- **Production is never written.** The drill reads the nightly dump, the files bucket and the
  secrets, and creates and deletes only its own branch, database and bucket. Never restore into
  `whatbuild` on any branch, and never point the drill at the `production` branch itself.
- **Name the project in every command** (`--project`, `--project-id`), with the deployment's values
  from `.env` (`GCP_PROJECT`, `GCP_REGION`, `NEON_PROJECT` for the maintainer's), never `gcloud`'s
  current one. Never write the values into the repository.
- **Delete the scratch target**, branch and bucket, and the local dump, even when the drill stops
  part-way, and say in your report that you did, or what is left.
- **Nothing from the restore is published.** In your report to the person you may say counts; in
  anything published, only the date and the elapsed time.

## Procedure

1. **Say what will be made**: a branch `restore-drill-<time>` in the Neon project and a bucket of the
   same name in the Google Cloud project, both deleted at the end. Check the Neon project has a
   branch to spare (ten on a free plan, three of them the newest restore points).
2. **Follow the guide's steps 1 to 3**: the scratch target, the restore of last night's dump and
   the copy of the bucket, then the rows and the files checked.
3. **A step that fails is the finding the drill exists for.** Note the step, the command and its
   message, then go straight to the deletion. Never work around a failed restore by hand.
4. **Note the elapsed time** and record the date and the elapsed time where the guide's step 4 says.
   That record is a fact about the system, not a session note.
5. **Delete** as the guide's step 5 says, then check that `neon branches list` and
   `gcloud storage ls` no longer show them.
6. **Report**: which dump, the elapsed time, the row comparison (every table matching, or which
   differed and by how much, beyond the writes since the dump), the count of files the database
   names that the bucket lacked, what failed, and that the scratch target is gone.

## When the guide is wrong

If a command fails because the guide is out of date, finish or abandon the drill, delete the
scratch target, then correct `okf/operations/backups.md` with the `okf-update` skill and propose it
as a pull request. Do not record the session itself in the repository.
