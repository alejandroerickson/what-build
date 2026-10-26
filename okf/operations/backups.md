---
type: System Concept
title: A deployment's backups are its database's restore history, a restore point before each deploy, a nightly dump and a versioned files bucket; this guide says where each is, how to check it and how to restore one.
description: For the operator and the agent working for them; what is kept, where and for how long on Cloud Run and Azure, setting up the nightly dump, checking that backups run, restoring a dump into an empty database, checking a restore, and the restore drill.
tags: [operations, backups, restore, postgres, neon, cloud-run, azure, runbook]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Backups and restoring them

This is the backup runbook ([§9.3](../spec/09-data-lifecycle.md), [§9.6](../spec/09-data-lifecycle.md)):
what a deployment keeps, how to check that it is kept, and how to put a dump into a database. To
go back after a release broke a deployment, follow
[recovering from a bad release](recovering-from-a-bad-release.md), which uses the restores here.
To put production's data into the [dev deployment](dev-deployment.md), copy it as that guide
says; the restore in the middle is the one here.

## What is kept

| What | Kept by | For how long | Set up by |
|---|---|---|---|
| Postgres on Neon | the project's history: restore the branch to any moment in it | six hours on the free plan; longer on paid plans | Neon |
| Postgres on Neon | a branch before each deploy migrates, `pre-migrate-<UTC time>-<commit>` | the newest three | `deploy/cloud-run/cloudbuild.yaml` with `_NEON_PROJECT` ([Cloud Run](cloud-run.md)) |
| Postgres other than Cloud SQL | a nightly `pg_dump` in the bucket `<project>-backups` | 35 days | by hand, [below](#the-nightly-dump) |
| Cloud SQL | daily backups and point-in-time recovery | seven backups | `setup.sh` with `CLOUD_SQL=1` |
| Azure Database for PostgreSQL | point-in-time recovery | 14 days | [Azure](azure.md) |
| Files on Cloud Run | the bucket's object versions; files are create-only, so a noncurrent version only ever holds deleted bytes | 30 days after deletion | `setup.sh` |
| Files on Azure | share soft delete, which brings back a deleted share but not a deleted file; Azure Backup, if added, keeps files | 30 days | [Azure](azure.md) |

The commands below take a deployment's project, region and, on Neon, its Neon project; the
maintainer's are in `.env` (`GCP_PROJECT`, `GCP_REGION`, `NEON_PROJECT`).

## The nightly dump

A free tier keeps only hours of history, so a deployment on one adds a nightly logical backup.
`setup.sh` does not create it yet. `pg_dump` cannot run as the `whatbuild` role, whose own rows
the policies hide, so it runs as a role of its own that reads everything and can change nothing:
`CREATE ROLE whatbuild_backup LOGIN PASSWORD '…' BYPASSRLS; GRANT pg_read_all_data TO
whatbuild_backup;` (run by a role that has `BYPASSRLS` itself). The dumps go to a bucket of their
own, which the backup identity may add to and read but not delete from, so a fault in the job
cannot erase the dumps before it. They expire after 35 days. The job runs the stock `postgres`
image, of the same major version as the database:

```bash
P=my-whatbuild R=northamerica-northeast2 SA=whatbuild-backup@$P.iam.gserviceaccount.com
gcloud iam service-accounts create whatbuild-backup --project $P
gcloud storage buckets create gs://$P-backups --project $P --location $R \
  --uniform-bucket-level-access --public-access-prevention
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":35}}]}' > lifecycle.json
gcloud storage buckets update gs://$P-backups --lifecycle-file lifecycle.json
for r in objectCreator objectViewer; do
  gcloud storage buckets add-iam-policy-binding gs://$P-backups --member serviceAccount:$SA --role roles/storage.$r
done
# libpq verifies the certificate against the system's roots only when asked:
printf '%s' 'postgres://whatbuild_backup:…@host/whatbuild?sslmode=verify-full&sslrootcert=system' |
  gcloud secrets create whatbuild-backup-database-url --project $P --data-file=-
gcloud secrets add-iam-policy-binding whatbuild-backup-database-url --project $P \
  --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
gcloud run jobs create whatbuild-backup --project $P --region $R --image docker.io/library/postgres:18-alpine \
  --service-account $SA --set-secrets DATABASE_URL=whatbuild-backup-database-url:latest \
  --add-volume name=backups,type=cloud-storage,bucket=$P-backups --add-volume-mount volume=backups,mount-path=/backups \
  --memory 512Mi --max-retries 1 --task-timeout 15m --command sh \
  --args=-c,'set -eu; f="whatbuild-$(date -u +%Y-%m-%dT%H%MZ).dump"; pg_dump "$DATABASE_URL" --format=custom --file="/tmp/$f"; cp "/tmp/$f" "/backups/$f"'
gcloud run jobs add-iam-policy-binding whatbuild-backup --project $P --region $R --member serviceAccount:$SA --role roles/run.invoker
gcloud services enable cloudscheduler.googleapis.com --project $P
gcloud scheduler jobs create http whatbuild-backup-nightly --project $P --location $R \
  --schedule '30 1 * * *' --time-zone America/Los_Angeles --http-method POST \
  --uri https://run.googleapis.com/v2/projects/$P/locations/$R/jobs/whatbuild-backup:run \
  --oauth-service-account-email $SA
```

The same role is the one that may read a deployment for a copy: [a copy of production](a-copy-of-production.md)
and the [dev deployment](dev-deployment.md) dump through it.

## Checking the backups

```bash
gcloud storage ls -l gs://$P-backups/ | tail -4                       # one dump a night, the newest from last night
gcloud run jobs executions list --job whatbuild-backup --project $P --region $R --limit 5
gcloud scheduler jobs describe whatbuild-backup-nightly --project $P --location $R \
  --format='value(state,lastAttemptTime)'
neon branches list --project-id <neon-project>                          # the pre-migrate-… restore points
gcloud storage buckets describe gs://$P-whatbuild-files --format='value(versioning_enabled,lifecycle_config)'
```

Every execution should have succeeded, and the newest dump should be from the last night. A night
with no dump, a failed execution, or a dump much smaller than the night before needs looking into:
`gcloud run jobs executions describe <execution> --project $P --region $R` and the job's logs.

## Restoring a dump

A dump holds every row; the files stay in the bucket. Restore it into an empty database owned by
the application's role. The steps below put a dump into an empty database the same way whether it is
last night's going back into production's or a [copy of some organizations](copying-an-organization.md)
going into the dev deployment's.

**1. The dump.** Either last night's, or a fresh one taken now through the read-only role, which
changes nothing. The client tools must be of the server's major version or newer. A dump is real
people's data: keep it in a directory only you can read, and delete it once it is loaded.

```bash
umask 077; D=$(mktemp -d)
gcloud storage cp gs://$P-backups/whatbuild-<time>.dump $D/database.dump            # last night's
pg_dump --format=custom --file=$D/database.dump \
  "$(gcloud secrets versions access latest --secret whatbuild-backup-database-url --project $P)"   # or now
```

**2. An empty database owned by `whatbuild`.** An administrator creates it. On Postgres 16 and
later, an administrator that is not a superuser, such as Neon's `neondb_owner`, may create a
database only for a role it may act as, and drop one only if it holds its owner's privileges, so
it takes the role for the moment and gives it back. `DROP` is only for replacing a database; the
service fails while it is gone (its instances stop with `relation "tenants" does not exist`) and
recovers when the restore commits.

```sql
GRANT whatbuild TO neondb_owner WITH SET TRUE, INHERIT TRUE;
DROP DATABASE IF EXISTS whatbuild WITH (FORCE);
CREATE DATABASE whatbuild OWNER whatbuild;
REVOKE whatbuild FROM neondb_owner;
```

On Neon, `neon connection-string <branch> --project-id <neon-project> --role-name neondb_owner
--database-name neondb` gives the administrator's connection.

**3. Restore as `whatbuild`.** The role needs no bypass: the dump turns row-level security on
after it loads the rows. Leave out the extension's comment, which only the extension's owner may
set, and the planner statistics that `pg_dump` 18 includes. `--no-privileges` leaves out grants to
roles the target may not have. `--single-transaction` makes the whole restore appear at once or
not at all. The dump creates `pg_trgm` itself, which the database's owner may do because it is a
trusted extension.

```bash
pg_restore -l $D/database.dump | grep -vE 'COMMENT - EXTENSION|STATISTICS DATA' > $D/restore.list
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --use-list=$D/restore.list \
  --dbname="$(gcloud secrets versions access latest --secret whatbuild-database-url --project $P)&sslrootcert=system" \
  $D/database.dump
rm -r $D
```

The stored `whatbuild-database-url` asks for `sslmode=verify-full`, which the server checks against
Node's own roots; `libpq` on a workstation needs `sslrootcert=system` added to use the system's.
On Cloud SQL the URL is a socket path, so restore through the Cloud SQL Auth Proxy instead.

**4. The files.** Restoring into the same deployment, the bucket still holds them, and a deleted
one comes back from its noncurrent version within 30 days. Restoring into another deployment, copy
the bucket too:

```bash
gcloud storage rsync --recursive --delete-unmatched-destination-objects \
  gs://<from-project>-whatbuild-files gs://<to-project>-whatbuild-files
```

## Checking a restore

`select name from schema_migrations order by name desc limit 1` names the same last migration as
the source. Then compare the rows, table by table. The application's role sees one organization at
a time on the tables that force row-level security, so the count for the restore sets each
organization in turn and adds them up. `FROM` is a role that sees everything in the source (the
backup role), `TO` the application's role on the restore:

```bash
Q="select string_agg(format('select %L, count(*) from %I', relname, relname), ' union all ' order by relname)
   from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace"
F="select string_agg(relname, ' ') from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relforcerowsecurity"
psql "$FROM" -AtF' ' -c "$(psql "$FROM" -Atc "$Q")" | LC_ALL=C sort > from.txt
{ psql "$TO" -AtF' ' -c "$(psql "$TO" -Atc "$Q")"
  psql "$TO" -Atc 'select tenant_id from tenants' | while read -r t; do
    psql "$TO" -AtF' ' -c "begin; select set_config('app.tenant_id', '$t', true); $(psql "$TO" -Atc "$Q"); commit;"
  done; } | grep -E '^[a-z_]+ [0-9]+$' |
  awk -v forced="$(psql "$TO" -Atc "$F")" 'BEGIN { n = split(forced, a, " "); for (i = 1; i <= n; i++) f[a[i]] = 1 }
    ($1 in f) { s[$1] += $2; next } !($1 in s) { s[$1] = $2 } END { for (t in s) print t, s[t] }' |
  LC_ALL=C sort > to.txt
diff from.txt to.txt && echo "every table matches"; rm from.txt to.txt
```

A dump of a database that is still in use differs from it by whatever was written since; compare
with the dump's source just after taking it, or expect small differences in `activity` and
`sessions`. Then use it: sign in, open a product, a source and its text, and search.

## The restore drill

A restore is **performed and written up before public sign-up opens, and quarterly after**
([§9.3](../spec/09-data-lifecycle.md)). It has not been performed yet. The scratch environment is
the [dev deployment](dev-deployment.md):

1. Note the time, then restore last night's dump (step 1 above, the nightly one) into the dev
   deployment's database, and copy production's files bucket into its own (step 4).
2. Check it as above, against production's backup role, expecting the writes since the dump.
3. Note the elapsed time. Record the date and the elapsed time in [§9.3](../spec/09-data-lifecycle.md)
   in place of "It has not been performed yet", and in the Phase 6 row of the
   [roadmap](../spec/10-roadmap.md).
4. Put the dev deployment back to its own copy if it was in use
   ([the dev deployment](dev-deployment.md#putting-it-back)).

The nightly manifest of the bucket's keys and sizes, against which a restore is to be checked, is
planned ([§9.3](../spec/09-data-lifecycle.md)). Until it exists, the check is the table comparison
and the sources opening with their text and their attachments.
