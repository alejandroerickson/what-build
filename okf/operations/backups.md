---
type: System Concept
title: A deployment's backups are its database's restore history, a restore point before each deploy, a nightly dump and a versioned files bucket; this guide says where each is, how to check it and how to restore one.
description: For the operator and the agent working for them; what is kept, where and for how long on Cloud Run and Azure, setting up the nightly dump, checking that backups run, restoring a dump into an empty database, checking a restore, and the restore drill.
tags: [operations, backups, restore, postgres, neon, cloud-run, azure, runbook]
generated: {by: agent:claude, at: 2026-10-27}
status: stable
---

# Backups and restoring them

This is the backup runbook ([§9.3](../spec/09-data-lifecycle.md), [§9.6](../spec/09-data-lifecycle.md)):
what a deployment keeps, how to check that it is kept, and how to put a dump into a database. To
go back after a release broke a deployment, follow
[recovering from a bad release](recovering-from-a-bad-release.md), which uses the restores here.
To put the instance owners' organizations into the [dev deployment](dev-deployment.md), copy
them as that guide says; the restore in the middle is the one here.

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
and the [dev deployment](dev-deployment.md) dump the instance owners' organizations through it.

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
going into the dev deployment's. Restoring production's from before an account was deleted brings the
account back: list the accounts ended since, and end them again after
([erasure](erasure.md#after-a-restore)).

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
([§9.3](../spec/09-data-lifecycle.md)). It has not been performed yet. The drill restores
production's whole nightly dump and its whole files bucket, every organization's, so it never
leaves production's own accounts: no copy outside production holds an organization an instance
owner does not own ([decision](../decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)),
and the [dev deployment](dev-deployment.md) is such a copy. Its scratch target is a database and a
bucket made for it in production's own Neon project and Google Cloud project, read by no one but
the operator, checked, timed and deleted. The skill `perform-the-restore-drill` conducts it.

The commands use production's values: `P=$GCP_PROJECT`, `R=$GCP_REGION` and `N=$NEON_PROJECT`.
Name them in every command, never `gcloud`'s current project. On Postgres other than Neon, the
scratch database is an empty database on a scratch server in production's own project, made as
step 2 of [Restoring a dump](#restoring-a-dump) makes one, and deleted with it; on Cloud SQL, which
keeps its own backups and no nightly dump, the newest backup is restored into a new instance in
production's project, checked the same way, and the instance deleted.

**What the drill costs.** On a free plan the drill spends the same month's allowances production
lives on, so it spends as little of them as it can:

- **Storage.** The restored copy is a second copy of the database in the same Neon project, until
  the branch is deleted. Check first that the database's size (`select
  pg_size_pretty(pg_database_size('whatbuild'))`) fits twice within the plan's storage, with room.
- **Compute.** The branch's compute runs while the dump is restored and checked, and counts against
  the project's compute for the month. Step 1 creates it at the smallest size (`--cu 0.25`), and the
  branch expires on its own six hours later should step 5 never run; run the steps back to back,
  and delete the branch as soon as the check is done. Run the drill early in a
  month, when most of the month's compute is left, never near its end.
- **Transfer.** The dump is downloaded once, and the check reads counts and file keys, never
  content. The bucket is copied within the same region, which Google Cloud does not charge as
  transfer; the scratch bucket's storage is charged for the hours it exists.

**1. The scratch target.** Note the time. Branch production's database in its own Neon project and
make an empty database, `drill`, beside the branch's copy of `whatbuild`, which the drill never
touches; make an empty bucket in production's project. A branch counts against the project's
branches (ten on a free plan) until it is deleted.

```bash
T0=$(date -u +%s); S=restore-drill-$(date -u +%Y%m%dt%H%M)
EXPIRES=$(python3 -c 'import datetime as d; print((d.datetime.now(d.timezone.utc) + d.timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
neon branches create --project-id $N --name $S --parent production --cu 0.25 --expires-at $EXPIRES
ADMIN=$(neon connection-string $S --project-id $N --role-name neondb_owner --database-name neondb)
psql "$ADMIN" -v ON_ERROR_STOP=1 -c 'GRANT whatbuild TO neondb_owner WITH SET TRUE, INHERIT TRUE' \
  -c 'CREATE DATABASE drill OWNER whatbuild' -c 'REVOKE whatbuild FROM neondb_owner'
gcloud storage buckets create gs://$P-$S --project $P --location $R \
  --uniform-bucket-level-access --public-access-prevention
```

The branch has production's roles. `APP` is the application's role and `READ` the backup role, each
on the branch's host and the database `drill`:

```bash
HOST=$(python3 -c 'import sys, urllib.parse as u; print(u.urlsplit(sys.argv[1]).hostname.replace("-pooler", ""))' "$ADMIN")
on_drill() { gcloud secrets versions access latest --secret "$1" --project $P |
  python3 -c 'import sys, urllib.parse as u; p = u.urlsplit(sys.stdin.read().strip()); print(p._replace(netloc=p.netloc.rpartition("@")[0] + "@" + sys.argv[1], path="/drill").geturl())' "$HOST"; }
APP="$(on_drill whatbuild-database-url)&sslrootcert=system"; READ=$(on_drill whatbuild-backup-database-url)
```

**2. Restore last night's dump** into `drill` as `whatbuild`, as steps 1 and 3 of
[Restoring a dump](#restoring-a-dump) do, and copy production's files bucket into the scratch one:

```bash
umask 077; D=$(mktemp -d)
gcloud storage cp "$(gcloud storage ls gs://$P-backups/ | LC_ALL=C sort | tail -1)" $D/database.dump
pg_restore -l $D/database.dump | grep -vE 'COMMENT - EXTENSION|STATISTICS DATA' > $D/restore.list
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --use-list=$D/restore.list \
  --dbname="$APP" $D/database.dump
gcloud storage rsync --recursive --no-user-output-enabled gs://$P-whatbuild-files gs://$P-$S
```

**3. Check it.** The rows, as [Checking a restore](#checking-a-restore) compares them, with `FROM`
production's backup role (`gcloud secrets versions access latest --secret
whatbuild-backup-database-url --project $P`) and `TO="$APP"`, expecting the writes since the dump
in `activity`, `sessions` and the usage counts. Then the files: every file the restored database
names is in the scratch bucket.

```bash
K="select string_agg(format('select %I from %I where %I is not null', column_name, table_name, column_name), ' union ')
   from information_schema.columns where table_schema = 'public' and column_name like '%blob%' and data_type = 'text'"
psql "$READ" -Atc "$(psql "$READ" -Atc "$K")" | LC_ALL=C sort -u > $D/named.txt
gcloud storage ls --recursive "gs://$P-$S/**" | sed "s|^gs://$P-$S/||" | LC_ALL=C sort -u > $D/stored.txt
LC_ALL=C comm -23 $D/named.txt $D/stored.txt | wc -l    # 0: no file the database names is missing
```

No service serves the scratch target, so nobody signs in to it: the rows and the files are the
check.

**4. Note the elapsed time**, `echo $(( ($(date -u +%s) - T0) / 60 )) minutes`. Record the date and
the elapsed time in [§9.3](../spec/09-data-lifecycle.md) in place of "It has not been performed
yet", and in the Phase 6 row of the [roadmap](../spec/10-roadmap.md).

**5. Delete the scratch target and the dump.** Do it even when the drill stopped part-way: both
hold every organization's data.

```bash
neon branches delete $S --project-id $N
gcloud storage rm --recursive gs://$P-$S          # its files, then the bucket
rm -r $D
```

The nightly manifest of the bucket's keys and sizes, against which a restore is to be checked, is
planned ([§9.3](../spec/09-data-lifecycle.md)). Until it exists, the check is the table comparison
and every key the restored database names being in the scratch bucket.
