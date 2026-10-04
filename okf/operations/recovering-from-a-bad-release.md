---
type: System Concept
title: When a new version breaks a WhatBuild deployment, go back to the last good version, and restore the database first if the new one migrated it.
description: For the operator of any WhatBuild deployment and the agent working for them; how to see what runs, tell whether the bad version changed the schema, go back on Cloud Run (Neon, Cloud SQL, another Postgres) or Azure, check it, and fix forward.
tags: [operations, recovery, rollback, migrations, deployment, cloud-run, neon, azure, runbook]
generated: {by: agent:claude, at: 2026-10-03}
status: stable
---

# Recovering from a bad release

This is the runbook for the moment after a deploy, when a deployment of WhatBuild is broken or
wrong: errors, a screen that no longer loads, sign-in failing, data that looks off, or a migration
that failed. It is written for whoever operates the deployment, which may not be WhatBuild's
maintainer, and for the agent they ask to fix it. The skill `recover-a-deployment` conducts it.

## The one rule

A deploy changes two things: the **code** (the image) and, when the release carries migrations,
the **schema** (the database). They go back differently:

- **Code goes back by running the previous image**: route traffic to the previous revision, or
  deploy the previous release again. It takes seconds and loses nothing.
- **The schema goes back only by restoring the database** to a moment before the migration ran.
  Migrations are forward-only: there are no down migrations, and older code is not promised to
  work against a newer schema. Restoring loses whatever was written since that moment.

So: **if the bad release ran no migration, put the previous code back and stop. If it did, restore
the database to just before it, then put the previous code back.** Never repair the schema by
hand, delete rows from `schema_migrations`, or edit a migration file to undo it.

## 1. Stop making it worse

- Do not deploy again until you know what went wrong; a redeploy of the same commit does the same
  thing.
- Write down the time, in UTC (`date -u`). A point-in-time restore needs a moment before the deploy
  began; the build's log and the migration job's execution carry exact times.
- If people are using the deployment, tell them it is being restored and that recent changes may
  be lost.

## 2. What runs now, and what ran before

The release is in the account menu's last row ("Release v0.3.1" or "Commit 1a2b3c4", with the day
it was built) and in `GET /api/v1/meta`, which needs no sign-in:

```bash
curl -s https://<app-host>/api/v1/meta     # release: { version, commit, built_at }
```

The previous version is the revision before it:

```bash
# Cloud Run: newest first, with the release each one runs
gcloud run revisions list --service whatbuild --project $P --region $R \
  --format='table(metadata.name,metadata.creationTimestamp,spec.containers[0].env.filter(name=WHATBUILD_RELEASE).extract(value).flatten())'
# Azure Container Apps
az containerapp revision list -g "$AZ_RG" -n "$AZ_APP" --query '[].{name:name,created:properties.createdTime,image:properties.template.containers[0].image}' -o table
```

## 3. Did the bad release change the schema?

Any one of these answers it:

- **The release notes.** Each GitHub release lists the migrations it adds since the previous tag,
  or says it adds none.
- **The code.** Migrations are the numbered files in `apps/server/src/migrations/`:
  `git diff --name-only --diff-filter=A <good> <bad> -- apps/server/src/migrations/`
- **The migration job's log** for the deploy: `migrated 0012_….sql` for each file it applied, or
  `database is up to date`.
- **The database**: `select name, applied_at from schema_migrations order by applied_at desc limit 5;`

Each migration file runs in its own transaction. A file that fails changes nothing, the deploy
stops, and the previous version keeps serving; but files before it in the same deploy stay
applied. If anything was applied, take the path in step 5.

## 4. No migration: put the previous code back

**Cloud Run.** Send all traffic to the last good revision:

```bash
gcloud run services update-traffic whatbuild --project $P --region $R --to-revisions <good revision>=100
```

Traffic stays pinned there until it is moved again; each deploy through `cloudbuild.yaml` ends by
sending traffic to its new revision, so the next deploy moves it.

**Azure.** The app runs one revision at a time, so deploy the previous image again, with the
commands in [Azure](azure.md) under "Deploying a new version" and the previous `WB_IMAGE_TAG`. Its
migration job finds nothing to do.

Then check (step 6).

## 5. A migration ran: restore the database, then the code

Restore first and move the code straight after; between the two, the app may show errors for a
minute. Choose the restore that matches the database.

**Neon, with restore points.** A Cloud Run deploy with `_NEON_PROJECT` set branches the database as
`pre-migrate-<UTC time>-<commit>` before it migrates ([Cloud Run](cloud-run.md)). Restore the
branch to the restore point taken by the bad deploy; it keeps its ID and connection string, and
its current state is kept under the name you give:

```bash
neon branches list --project-id <neon-project>          # find pre-migrate-…-<bad commit>
neon branches restore production pre-migrate-<time>-<bad commit> --project-id <neon-project> \
  --preserve-under-name production-before-restore
```

**Neon, without one.** Restore the branch to a moment before the deploy, within the project's
history window (six hours on the free plan; longer on paid plans):

```bash
neon branches restore production ^self@<UTC time before the deploy> --project-id <neon-project> \
  --preserve-under-name production-before-restore
```

**Cloud SQL** (`setup.sh` with `CLOUD_SQL=1` keeps seven days of point-in-time recovery). Clone the
instance at a moment before the deploy, then point the service and the migration job at the clone:

```bash
gcloud sql instances clone whatbuild-db whatbuild-db-restored --project $P --point-in-time '<UTC time>'
printf '%s' "postgres://whatbuild:<password>@/whatbuild?host=/cloudsql/$P:$R:whatbuild-db-restored" |
  gcloud secrets versions add whatbuild-database-url --project $P --data-file=-
gcloud run jobs update whatbuild-migrate --project $P --region $R --set-cloudsql-instances $P:$R:whatbuild-db-restored
gcloud run services update whatbuild --project $P --region $R --set-cloudsql-instances $P:$R:whatbuild-db-restored
```

The password is the one in the current `whatbuild-database-url`; the clone has the same users.

**Another Postgres.** Use its own point-in-time restore if it has one; otherwise restore the most
recent nightly dump from before the deploy, as [Cloud Run](cloud-run.md) describes under backups,
into a new database, and point `whatbuild-database-url` at it. Anything written since that dump is
lost.

**Azure Database for PostgreSQL** (14 days of point-in-time recovery). The restore is a new
server; give it the original's firewall rule and `pg_trgm` allow-listing if it lacks them
([Azure](azure.md), step 4), then point the vault's `whatbuild-database-url` at it and restart:

```bash
az postgres flexible-server restore -g "$AZ_RG" -n "$AZ_POSTGRES-restored" --source-server "$AZ_POSTGRES" \
  --restore-time '<UTC time before the deploy>'
```

Follow `az … --help` where the CLI's flags have moved.

Then put the previous code back (step 4). Whichever restore was used, the database no longer
records the reverted migration in `schema_migrations`, so a later release runs it again.

## 6. Check it

- `curl -s https://<app-host>/health` is `{"status":"ok"}`.
- `/api/v1/meta` and the account menu name the good release.
- Sign in, open a product, open a source and its passages, and search.
- On Cloud Run: `gcloud run services logs read whatbuild --project $P --region $R --limit 50` shows
  requests with status 200, not 500.

## 7. Fix forward

- **Report it** to the project with what broke, the bad and good releases, and whether a migration
  ran, so the maintainer can ship a fix.
- **A migration that has been released is never edited or deleted.** Deployments that kept it
  have applied it, and deployments that restored will apply it again; the fix is a new migration
  after it, which must be correct in both cases.
- **A release is a new tag.** Tags are never moved or reused
  ([decision](../decisions/releases-are-tags-with-a-published-image.md)); the fix is the next
  patch version.
- **Deploy the fix the usual way.** On Cloud Run, the deploy sends traffic to its new revision,
  ending the pin from step 4.

## 8. Tidy up after a Neon restore

After a restore, `production` hangs from the restore point it was restored to, so that restore
point cannot be deleted; deploys keep it and print a warning. Once you no longer need the state
the restore replaced, delete `production-before-restore`, then, when `production` has moved on,
that restore point:

```bash
neon branches delete production-before-restore --project-id <neon-project>
```

## Before the next release

- **Have a restore point for every deploy.** On Neon, deploy with `_NEON_PROJECT` set; Cloud SQL
  and Azure Database for PostgreSQL keep point-in-time recovery; on any Postgres, keep the nightly
  dump ([Cloud Run](cloud-run.md)).
- **Read the release notes before deploying.** A release that adds migrations is the one that can
  only be undone by a restore.
- **Pin releases, not `main`.** A deployment that runs tags knows exactly what to go back to.
