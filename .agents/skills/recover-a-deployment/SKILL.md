---
name: recover-a-deployment
description: Recover a WhatBuild deployment that a new version broke, by going back to the last good release and, when the bad one migrated the database, restoring the database first. Use when a deploy or upgrade of WhatBuild left it failing or wrong (errors, a screen that no longer loads, sign-in failing, data that looks off), when a migration failed or did the wrong thing, or when asked to roll back, undo a release, restore the database or go back to a previous version, on Google Cloud Run (with Neon, Cloud SQL or another Postgres) or on Azure.
---

# Recover a deployment from a bad release

You are putting someone's WhatBuild deployment back to a version that worked. It may be the
maintainer's or an organization's own. The knowledge, with every command, is in
`okf/operations/recovering-from-a-bad-release.md`. Read it in full before the first command. This
file is how to conduct the work.

## What must stay true

- **Ask before anything that loses data.** Routing traffic back loses nothing. Restoring the
  database loses every write since the restore point. Say what will be lost and from when, and
  wait for the person's yes.
- **Never repair the schema by hand.** Do not edit or delete migration files, delete rows from
  `schema_migrations`, or run DDL to undo a migration. The database goes back by a restore.
- **Keep what you replace.** Every restore keeps the state it replaces: `--preserve-under-name` on
  Neon, a new server or instance on Cloud SQL and Azure. Delete nothing until the person says the
  recovery is done.
- **Touch only this deployment.** Work in the project, resource group or Neon project the person
  names. Read their values from their own environment file (`.env` for the Cloud Run deployment,
  `.env.azure` for Azure); never write IDs, addresses or secrets into the repository, which is
  public.

## Procedure

A Microsoft sign-in refused with a reference is usually the app registration, not the release:
find its log line first (the guide's step 1), and fix forward if it names a claim or a setting.
Rolling back adds no missing claim.

1. **Establish what runs.** `GET /api/v1/meta` gives the release; the platform's revision list
   gives the one before it (step 2 of the guide). Tell the person the bad and good releases.
2. **Find out whether the bad release migrated.** Release notes, the migration job's log, or
   `schema_migrations` (step 3). Anything applied, even when a later file failed, counts.
3. **No migration:** route traffic to the good revision, or redeploy the good image (step 4).
4. **A migration:** choose the restore that matches the database (step 5), state the loss, get a
   yes, restore, then put the good code back straight after.
5. **Check it** (step 6): health, the release named in `/api/v1/meta`, sign-in, a product, search,
   and logs without 500s. Do not call it recovered before all of these pass.
6. **Report** to the person: what broke, what you restored and to when, what was lost, and what
   still needs doing (the fix forward and the tidying in steps 7 and 8). Offer to write the issue
   for the project.

## When the guide is wrong

If a command fails because the guide is out of date (a renamed flag, a changed default), finish
the recovery first. Then correct `okf/operations/recovering-from-a-bad-release.md` so that it is
true, with the `okf-update` skill, and propose it as a pull request. Do not record the incident
itself in the repository.
