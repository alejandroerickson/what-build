---
name: copy-an-organization
description: Copy one or more organizations of a WhatBuild deployment (the public sandbox unless others are named) with only their rows and files, and put the copy where it is wanted: a local copy to test on, the end-to-end golden master, the dev deployment, or another deployment's new database. Use when asked to dump, export, extract, copy, clone or move an organization or the sandbox; to take only some organizations from production; to keep an organization out of dev, the test database or a pull; to give an organization a deployment of its own; or to move an organization to another database or deployment.
---

# Copy an organization

You are taking some organizations out of a deployment, and nothing of the others. The knowledge,
with every command, is in `okf/operations/copying-an-organization.md`. Read it before the first
command. This file says how to conduct the work.

## What must stay true

- **Only the organizations asked for.** With none named, a pull takes the public sandbox. Name
  others with `--org <slug>[,<slug>…]` only when the person names them. Use `--all` only when they
  ask for every organization, and say first that it brings every organization to this machine.
- **The source is only read**, through a role that changes nothing (production's backup role).
  Production is never a target.
- **The copy is real people's data.** It stays in `.what-build/fixtures/` or a directory only you
  can read (`umask 077; D=$(mktemp -d)`), and is deleted once loaded elsewhere. Never commit,
  upload, attach or quote it in the repository, a commit message, an issue or a pull request. In
  your report to the person you may name the organizations.
- **Ask before replacing anything.** Restoring replaces the target's database, and `--files-into`
  deletes every other organization's files in the target bucket. Name both to the person, and
  have their go-ahead, before you run them on a deployment.
- **Name the project in every command** (`--project`, `--project-id`), never `gcloud`'s current
  one.

## Procedure

1. **Settle three things** with the person, from what they said or by asking: which
   organizations (slugs; the public sandbox by default), from which deployment (production unless
   told), and where the copy goes.
2. **Follow the destination's procedure:**
   - this machine, to test on: the `test-on-a-copy-of-production` skill;
   - the end-to-end golden master: the `run-end-to-end-tests` skill;
   - the dev deployment: the `rehearse-on-the-dev-deployment` skill, "Refreshing the copy", then
     record the slugs as `NEON_DEV_COPY_ORGANIZATIONS` in `.env`;
   - another deployment's new database: the guide's "Into another deployment", step by step.
3. **Check** that `pnpm fixture list`, or the pull's `pulled.json`, names exactly the
   organizations asked for. After a restore elsewhere, compare its rows with `pulled.json`'s, as
   the dev deployment's guide does in "Refreshing the copy", step 3. Then sign in and open a
   product, a source and its passages.
4. **Report** to the person which organizations went from where to where, the rows and files
   copied, what was replaced or deleted, and what you could not check.

## When it refuses

- **No organization, or several public sandboxes:** ask which organizations are meant.
- **"no rule for <table>":** a migration added a table without `tenant_id`. Decide with the person
  whether it belongs to the deployment or should be copied whole, then change
  `apps/server/src/organization-copy.ts` and its test (`apps/server/test/organization-copy.test.ts`).
  Never work around it.
- **Files outside their organization's folder:** a bug in how that file's key was made. Report it;
  do not copy the files by hand.
- **The target already holds organizations:** a copy cannot join them yet
  (`okf/spec/10-roadmap.md`). Offer a new database instead. Never merge rows by hand.

## When the guide is wrong

If a command fails because the guide is out of date, finish the work, then correct
`okf/operations/copying-an-organization.md` with the `okf-update` skill. Do not record the session
itself in the repository.
