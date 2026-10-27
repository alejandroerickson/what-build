---
name: copy-an-organization
description: Copy one or more organizations of a WhatBuild deployment (the example organization unless others are named) with only their rows and files, and put the copy where it is wanted: a local copy to test on, the end-to-end golden master, the dev deployment (each only of organizations an instance owner owns), or another production deployment's new database. Use when asked to dump, export, extract, copy, clone or move an organization or the example organization; to take only some organizations from production; to keep an organization out of dev, the test database or a pull; to give an organization a deployment of its own; or to move an organization to another database or deployment.
---

# Copy an organization

You are taking some organizations out of a deployment, and nothing of the others. The knowledge,
with every command, is in `okf/operations/copying-an-organization.md`. Read it before the first
command. This file says how to conduct the work.

## What must stay true

- **Only the organizations asked for.** With none named, a pull takes the example organization. Name
  others with `--org <slug>[,<slug>…]` only when the person names them. `--all` takes every
  organization the instance owners own, never anyone else's: use it only when the person asks.
- **Outside production, only organizations an instance owner owns.** A local copy, the golden
  master, the Docker host and the dev deployment never hold a customer's organization, whoever
  names it: every owner of each organization must be an instance owner (`okf/decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md`). The pull checks
  and refuses; never work around it.
- **A move into another production deployment** is the one copy that may take a customer's
  organization: `--for-another-deployment`, with `--org`, into a directory only you can read
  (`WHATBUILD_FIXTURE_DIR`). Never load that pull anywhere else.
- **The source is only read**, through a role that changes nothing (production's backup role).
  Production is never a target.
- **Nothing from the copy is published.** It is real people's data, and stays in `.what-build/fixtures/` or a directory only you
  can read (`umask 077; D=$(mktemp -d)`), and is deleted once loaded elsewhere. Never commit,
  upload, attach or quote it in the repository, a commit message, an issue or a pull request. In
  your report to the person you may name the organizations.
- **Ask before replacing anything.** Restoring replaces the target's database, and `--files-into`
  deletes every other organization's files in the target bucket. Name both to the person, and
  have their go-ahead, before you run them on a deployment.
- **Name the project in every command** (`--project`, `--project-id`), never `gcloud`'s current
  one.

## Procedure

1. **Settle three things** from what the person said: which organizations (slugs; the example
   organization by default), from which deployment (production unless told), and where the copy
   goes (this machine unless they name another place). Ask only about what they left unclear; the
   example organization to this machine needs no go-ahead.
2. **Check the destination may hold them.** Outside production, each organization must be one an
   instance owner owns; if the person names a customer's organization for a test or for dev, say
   that it never leaves production, and offer the example organization or a synthetic one instead.
3. **Follow the destination's procedure:**
   - this machine, to test on: the `test-on-a-copy-of-production` skill;
   - the end-to-end golden master: the `run-end-to-end-tests` skill;
   - the dev deployment: the `rehearse-on-the-dev-deployment` skill, "Refreshing the copy", then
     record the slugs as `NEON_DEV_COPY_ORGANIZATIONS` in `.env`;
   - another production deployment's new database: the guide's "Into another deployment", step by
     step, with `--for-another-deployment`.
4. **Check** that `pnpm fixture list`, or the pull's `pulled.json`, names exactly the
   organizations asked for. After a restore elsewhere, compare its rows with `pulled.json`'s, as
   the dev deployment's guide does in "Refreshing the copy", step 3. Then sign in and open a
   product, a source and its text.
5. **Report** to the person which organizations went from where to where, the rows and files
   copied, what was replaced or deleted, and what you could not check.

## When it refuses

- **No example organization, or several:** ask which organizations are meant.
- **"holds only organizations an instance owner owns":** the organization named has an owner who
  is not an instance owner, so it is a customer's, and it does not go outside production. Tell
  the person and leave it. If they hold it for their own, one of its owners is not among the
  deployment's instance owners; changing its owners is theirs to decide, in the web app. Never a
  copy by hand, and never `--for-another-deployment` for a copy outside production.
- **"taken before pulls checked who owns each organization":** an old pull or golden master. Delete
  it and pull again.
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
