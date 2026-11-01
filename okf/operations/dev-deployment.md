---
type: System Concept
title: The dev deployment is a second Cloud Run deployment, laid out like production and holding a copy of its example organization or other organizations its instance owners own, where a release is rehearsed before production moves.
description: For the maintainer and the agent working for them; what the dev deployment is and how it differs from production, where its values are, rehearsing a release on it, putting it back, refreshing its copy of the instance owners' organizations, setting one up from nothing, and keeping its data private.
tags: [operations, deployment, dev, rehearsal, migrations, cloud-run, neon, production]
generated: {by: agent:claude, at: 2026-10-31}
status: stable
---

# The dev deployment

Production moves only when a release's build is approved ([releasing](releasing.md)), and a
release that migrates can be undone only by restoring the database
([recovering from a bad release](recovering-from-a-bad-release.md)). So before production's build
of a release that adds a migration is approved, the release is deployed to the **dev deployment**,
which holds a recent copy of production's example organization, or of other organizations its
instance owners own, and its migrations and the jobs they queue are watched there ([decision](../decisions/releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)).
The skill `rehearse-on-the-dev-deployment` conducts the work in this guide.

[A copy of production](a-copy-of-production.md) on your own machine tries the code. The dev
deployment also tries the deploy: the same image build, restore point, migration job and Cloud Run
service that production's build runs, on the instance owners' organizations as production holds them.

## What it is

| | Production | Dev |
|---|---|---|
| Google Cloud project | its own | its own, with the same names inside ([Cloud Run](cloud-run.md#what-is-where)) |
| Postgres | a Neon project, branch `production` | its own Neon project: branch `main`, whose parent `prod-copy` holds the copy as it was loaded |
| Organizations | all of them | the ones `NEON_DEV_COPY_ORGANIZATIONS` names, each one an instance owner owns, copied from production, beside the [non-production dataset](the-non-production-dataset.md)'s synthetic ones; nothing of the others, and never a customer's ([decision](../decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)) |
| Files | its bucket | its own bucket, with the dataset's files |
| Deploys | a trigger on release tags, after approval | by hand, any tag or commit of `main`; no trigger |
| Sign-in | its own identity providers and clients | Google, with an OAuth client of its own in the same Google Auth Platform project as production's |
| Instance owners, sign-up allowlist | its own | the same as production's |
| Example organization, plan of a new organization | as production names them | the same organization, from the copy, and the same plan |
| Address | its own domain ([Cloud Run](cloud-run.md#setting-it-up)) | the service's `run.app` address only |
| Analytics, public site, Worker, nightly backup | whichever production has | none |
| Mail | its own provider ([Mail](mail.md)) | none, ever: its accounts and invitations are real people's addresses |

The two share nothing: no project, database, bucket, secret or OAuth client. Nothing in dev can
reach production.

## Its values

In `.env` in the maintainer's clone, beside production's:

| Key | What |
|---|---|
| `GCP_DEV_PROJECT`, `GCP_DEV_REGION` | the Google Cloud project and region |
| `DEV_URL` | the service's address |
| `NEON_DEV_PROJECT` | the Neon project |
| `NEON_DEV_BRANCH` | `main`, the branch the service uses |
| `NEON_DEV_COPY_BRANCH` | `prod-copy`, the copy as it was loaded |
| `NEON_DEV_COPY_TAKEN` | when the copy was taken from production, as the dataset's `pulled_at` writes it (`pnpm attention` reads it as a date, and reports a value it cannot read as a copy from before pulls checked owners) |
| `NEON_DEV_COPY_ORGANIZATIONS` | the organizations the copy holds, by slug, comma-separated: production's example organization unless the maintainer names others an instance owner owns. `pnpm attention` reports a dev deployment whose `.env` has no such line or says `all`, or whose copy was taken before pulls checked who owns each organization. |

The secrets are in the dev project's Secret Manager: `whatbuild-database-url`,
`whatbuild-grant-key`, `whatbuild-google-client-secret` and `whatbuild-neon-api-key`, a Neon key
that reaches only the dev Neon project. The commands below use `P=$GCP_DEV_PROJECT`,
`R=$GCP_DEV_REGION`, `N=$NEON_DEV_PROJECT` and, for production, `PP=$GCP_PROJECT` and
`PR=$GCP_REGION`.

## Rehearsing a release

**1. Start from production's state.** Dev should run the release production runs, on a copy taken
after production's last migration:

```bash
curl -s https://app.what-build.com/api/v1/meta     # what production runs
curl -s $DEV_URL/api/v1/meta                       # what dev runs
```

If an earlier rehearsal left dev on a newer release, [put it back](#putting-it-back). If production
has migrated since `NEON_DEV_COPY_TAKEN`, or the rehearsal should see recent data,
[refresh the copy](#refreshing-the-copy).

**2. Deploy the release**, or a commit of `main` before it is tagged, from a clean export. The
build branches `main` as a restore point, runs the migration job, deploys and sends traffic to it,
exactly as production's build does. Leave out `TAG_NAME` for a commit, which is then named by its
hash:

```bash
REF=v0.5.0                                          # the tag, or a commit of main
S=$(mktemp -d); git archive "$REF" | tar -x -C "$S"; SHA=$(git rev-parse "$REF^{commit}")
gcloud builds submit "$S" --project $P --region $R --config "$S/deploy/cloud-run/cloudbuild.yaml" \
  --substitutions "TAG_NAME=$REF,COMMIT_SHA=$SHA,SHORT_SHA=${SHA:0:7},_NEON_PROJECT=$N,_NEON_BRANCH=main"
rm -rf "$S"
```

**3. Check it.**

- Every step of the build succeeded, and `restore-point` printed the branch it made.
- The migration job applied each new migration, one `migrated …` line each:

  ```bash
  gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="whatbuild-migrate"' \
    --project $P --freshness 1h --format='value(textPayload)' | grep -E 'migrated|up to date|applied'
  ```

- Every job the migrations queued finished without an error. The worker logs a line for each
  (`job <id> <kind> … in <n> ms`, or `failed (attempt n)`), and the table says what is left:

  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="whatbuild" AND textPayload:"job "' \
    --project $P --freshness 1h --format='value(textPayload)'
  psql "$(gcloud secrets versions access latest --secret whatbuild-database-url --project $P)&sslrootcert=system" -c \
    "select kind, count(*) filter (where done_at is null) as waiting, count(*) filter (where error is not null) as with_error from jobs group by kind"
  ```

  A job with an error and no `done_at` is retried, five attempts in all; one with both gave up.
- `$DEV_URL/api/v1/meta` names the release.
- Signed in, the screens the release changed open on the copied data, and the service's log
  (`gcloud run services logs read whatbuild --project $P --region $R --limit 100`) has no 500s.

**4. Hostile files**, when the release changes parsing (`packages/parsers/`,
`apps/server/src/parse-process.ts`, `parse-child.ts` or `parse-worker.ts`), the parse limits (`WHATBUILD_PARSE_*`) or
the image's memory. Make them on your machine; none is committed:

```bash
H=$(mktemp -d); node scripts/hostile-files.mjs "$H"
```

The script prints what each file is and what WhatBuild should record for it at the default
limits: too large, failed for memory, or ready. Signed in to dev, upload each through the app as
the one attachment of a source of its own, in a product of an organization on the unlimited plan
made for the rehearsal; a plan with limits refuses files over its `file_max_bytes`. Then check:

- Each source ends in the status the script printed (its Text and Attachments say it), within a
  couple of minutes, and no job is left waiting.
- **The peak of each parse, from the processes themselves.** Each parse leaves a line in the log once
  its process is gone: how it ended, the peak of its process as that process measured it, what the
  server holds at that moment, and how many other processes run beside the server. Read them with the
  instance each came from:

  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="whatbuild" AND textPayload:("parse: the process" OR "listening on" OR "Memory limit" OR "put back in the queue")' \
    --project $P --freshness 1h --format='value(timestamp,labels.instanceId,textPayload)'
  ```

  Add each line's peak, what the server holds, and the file's size, which the server holds while
  its process runs. This sum, not the metric below, is the reading: the platform samples memory about
  once a minute, and a parse's peak lasts a second or two, so a chart can look healthy near the limit.
  If any sum came within about a sixth of the limit, or an instance ran out, lower
  `WHATBUILD_PARSE_MEMORY_MB` (or give the service more memory) on dev, upload the files again, and
  make the same change on production ([Cloud Run](cloud-run.md#setting-it-up), **Parsing**).
- **How each parse ended.** `ended by <signal or exit code>` in that line means its process ended
  without an answer; its source says `failed` with the reason, or, for a process killed from outside
  or one that never began, its job is tried again. The service should have kept answering.
- **No process left behind.** The same lines end with `<n> other processes`, normally none. It
  should be the same after every parse: a number that grows means a parse left something running.
  Where the server has no `/proc` to count them, the line leaves the count out; there, list the
  server's processes with what the platform offers, or say that it could not be checked.
- **The service kept answering**: pages opened, and the log has no 500s and no instance that ran out
  of memory:

  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="whatbuild" AND (severity>=ERROR OR textPayload:"Memory limit")' \
    --project $P --freshness 1h --format='value(timestamp,textPayload)'
  ```

- **The memory the platform saw**, for the level the server keeps between parses: the service's
  **Metrics** tab in the console, *Container memory utilization*, or the 99th percentile of each
  minute from the Monitoring API:

  ```bash
  t() { python3 -c "import datetime as d; print((d.datetime.now(d.timezone.utc) - d.timedelta(hours=$1)).strftime('%Y-%m-%dT%H:%M:%SZ'))"; }
  curl -s -G -H "Authorization: Bearer $(gcloud auth print-access-token)" "https://monitoring.googleapis.com/v3/projects/$P/timeSeries" \
    --data-urlencode 'filter=metric.type="run.googleapis.com/container/memory/utilizations" AND resource.type="cloud_run_revision" AND resource.labels.service_name="whatbuild"' \
    --data-urlencode "interval.startTime=$(t 1)" --data-urlencode "interval.endTime=$(t 0)" \
    --data-urlencode aggregation.alignmentPeriod=60s --data-urlencode aggregation.perSeriesAligner=ALIGN_PERCENTILE_99 |
    python3 -c 'import sys,json; [print(p["interval"]["endTime"], round(100 * p["value"]["doubleValue"]), "%") for s in json.load(sys.stdin).get("timeSeries", []) for p in s["points"]]'
  ```

- **The execution environment.** What ends an instance can differ between Cloud Run's environments,
  and `deploy/cloud-run/setup.sh` pins none, so record the one in use with the results below:

  ```bash
  gcloud run services describe whatbuild --project $P --region $R --format=json |
    python3 -c 'import sys,json; print(json.load(sys.stdin)["spec"]["template"]["metadata"].get("annotations", {}).get("run.googleapis.com/execution-environment", "not set: the platform chooses"))'
  ```

**4a. What ends first: a step test, on dev only, never on production.** It says what the rest cannot:
whether, on this platform, a parse's process past the instance's memory dies alone or takes the
server with it. Setting `oom_score_adj` does not settle that, since a platform may end the whole
container whatever it says. Raise `WHATBUILD_PARSE_MEMORY_MB` through steps from the value in use, say
by 128 at a time, until something dies, with requests going throughout:

```bash
gcloud run services update whatbuild --project $P --region $R --update-env-vars WHATBUILD_PARSE_MEMORY_MB=$MB
while sleep 0.2; do curl -s -o /dev/null -w '%{http_code} %{time_total}\n' "$DEV_URL/api/v1/meta"; done > traffic.txt &
T=$!
# Upload every hostile file again, as above, and wait for each to end. At the first death of the
# whole instance, its job waits and is tried again, up to five attempts in all: let that run its
# course, then put the value back. It takes a few minutes where the log shows `put back in the queue`,
# and about 50 where it does not, since each attempt then waits for its lock to be ten minutes old.
kill $T
sort -k2 -n traffic.txt | awk '{ t[NR] = $2; if ($1 == 0 || $1 >= 500) bad++ } END { print NR " requests, p95 " t[int(NR * 0.95)] " s, " bad + 0 " failed" }'
```

Then read the lines of step 4's first command, with their instances:

- `parse: … ended by SIGKILL`, and later lines from the same instance: the parse's process died alone,
  and the server went on.
- `Memory limit`, then a new `listening on` from another instance: the whole instance ended, the
  server with it.

Record, for each step, the peaks, which of those happened, the requests' p95 and how many failed,
and whether `put back in the queue` came just before `Memory limit`: if the platform stops an instance
over its limit with a signal, such a job is put back with its attempt spent; with none, its lock has to
go stale first. Either way, check that it is given up at its fifth attempt, as a `failed` reading saying
the server stopped during its last, and that the jobs behind it were read meanwhile. On Linux a child's reported peak can start at the server's own size, because a process carries
it across exec, so a small parse reads high; the heaviest parses' peaks are right.
Afterwards put the value back (`--update-env-vars WHATBUILD_PARSE_MEMORY_MB=<the value before>`, or
`--remove-env-vars WHATBUILD_PARSE_MEMORY_MB` if it had none), and delete `traffic.txt`.

**5. Report.** What ran, what migrated, what each job did, what each hostile file ended as, the peak
and the server's memory for each, whether any process was left behind, the execution environment, what
the step test ended and at which value, the requests' p95 and failures, and what failed. A migration or
job that fails on dev is a finding: production's build is not approved, the fix is a new commit, and
dev is put back before the fix is rehearsed. Never repair dev's schema by hand.

After a rehearsal that passed, dev may stay on the new release; it is then what production will be.

## Putting it back

To return dev to the copy as it was loaded, for example to rehearse a fix: delete the restore
points rehearsals made, reset `main` to `prod-copy`, then deploy the release production runs.
Name `prod-copy` rather than `^parent`: restoring `main` from a restore point leaves that restore
point as its parent, and the reset would then go back to it instead of the copy. Neon refuses to
reset a branch that still has children, and a deletion takes a few seconds to finish, so wait for
it:

```bash
for b in $(neon branches list --project-id $N -o json | python3 -c '
import json, sys; d = json.load(sys.stdin); bs = d["branches"] if isinstance(d, dict) else d
main = next(b["id"] for b in bs if b["name"] == "main")
print(" ".join(b["id"] for b in bs if b.get("parent_id") == main))'); do
  neon branches delete $b --project-id $N >/dev/null
done
sleep 20
neon branches restore main prod-copy --project-id $N
```

Then deploy production's release as in [step 2](#rehearsing-a-release). The files bucket is not
reset: files a rehearsal wrote stay, unreferenced and harmless.

## Refreshing the copy

Load a new copy into `prod-copy`, then put dev back. The service keeps running on `main` while
the copy loads. The copy is the [non-production dataset](the-non-production-dataset.md): the
organizations `NEON_DEV_COPY_ORGANIZATIONS` names and nothing of the others, each one an instance
owner owns ([copying an organization](copying-an-organization.md#which-organizations-may-leave-production)),
beside synthetic organizations with many members, pending invitations, and products and sources;
to change which organizations, say so to the maintainer, and record the new list in step 6.

**1. The copy.** Build the dataset from production into a directory only you can read. It reads
production and changes nothing there, and refuses an organization no instance owner owns. Pass
`--org` with `NEON_DEV_COPY_ORGANIZATIONS`, or nothing for production's example organization.
`--production-schema` keeps production's schema, so that a rehearsal runs the new release's
migrations on it: when `main` has migrations production lacks, build from a checkout of the
release production runs.

```bash
umask 077; D=$(mktemp -d)
WHATBUILD_FIXTURE_DIR=$D GCP_PROJECT=$PP GCP_REGION=$PR corepack pnpm dataset --production-schema --org <slug>[,<slug>…]
F=$(ls -d $D/*-dataset/)                         # the dataset; its pulled.json names what it holds
```

When production's database cannot be read, its compute suspended or the deployment closed, build
from a recent pull instead: copy the pull into `$D` and add `--from <pull>` in place of `--org`,
leaving out `GCP_PROJECT` and `GCP_REGION`. It holds the organizations the pull took, so choose
one that holds what `NEON_DEV_COPY_ORGANIZATIONS` names, and its `pulled_at` is when production
was read. `pnpm dataset` first shipped in v0.28.0, which has the same schema as v0.27.0.

**2. The database.** Replace the database `whatbuild` on `prod-copy` as the administrator, and
restore the dataset's dump into it as `whatbuild`, as [Backups](backups.md#restoring-a-dump) explains.
The connections are `prod-copy`'s, not `main`'s: `APP` is dev's database URL with `prod-copy`'s
host.

```bash
ADMIN=$(neon connection-string prod-copy --project-id $N --role-name neondb_owner --database-name neondb)
HOST=$(python3 -c 'import sys, urllib.parse as u; print(u.urlsplit(sys.argv[1]).hostname.replace("-pooler", ""))' "$ADMIN")
APP=$(gcloud secrets versions access latest --secret whatbuild-database-url --project $P |
  python3 -c 'import sys, urllib.parse as u; p = u.urlsplit(sys.stdin.read().strip()); print(p._replace(netloc=p.netloc.rpartition("@")[0] + "@" + sys.argv[1]).geturl())' "$HOST")
psql "$ADMIN" -v ON_ERROR_STOP=1 -c 'GRANT whatbuild TO neondb_owner WITH SET TRUE, INHERIT TRUE' \
  -c 'DROP DATABASE IF EXISTS whatbuild WITH (FORCE)' -c 'CREATE DATABASE whatbuild OWNER whatbuild' \
  -c 'REVOKE whatbuild FROM neondb_owner'
pg_restore -l $F/database.dump | grep -vE 'COMMENT - EXTENSION|STATISTICS DATA' > $D/restore.list
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --use-list=$D/restore.list \
  --dbname="$APP&sslrootcert=system" $F/database.dump
```

**3. The files.** Make dev's bucket hold the dataset's files and nothing else. The `.meta.json`
beside each file is the local file store's and stays behind: the database holds each file's type
and hash.

```bash
gcloud storage rsync --recursive --delete-unmatched-destination-objects --exclude='.*\.meta\.json$' \
  $F/files gs://$P-whatbuild-files
```

**4. Check it** against the rows the dataset recorded: make `to.txt` as
[Backups](backups.md#checking-a-restore) does, with `TO="$APP&sslrootcert=system"`, and `from.txt`
from the dataset. Every table matches:

```bash
python3 -c 'import json, sys; [print(t, n) for t, n in json.load(open(sys.argv[1]))["rows"].items()]' \
  $F/pulled.json | LC_ALL=C sort > from.txt
```

Then keep `pulled_at` and the slugs of `organizations` from `$F/pulled.json` for step 6, and
`rm -r $D`.

**5. Put dev back** ([above](#putting-it-back)), so that `main` is the new copy, and deploy the
release production runs.

**6. Record** in `.env` when production was read (`pulled_at`) as `NEON_DEV_COPY_TAKEN`, and the
slugs of the organizations pulled, not the synthetic ones, as `NEON_DEV_COPY_ORGANIZATIONS`.

The copy's accounts sign in with Google, the one way dev offers; the synthetic people, at
`example.com` and `.example` addresses, sign in nowhere and are there for their shape. Browser sessions and agents'
tokens from production do not work on dev: sessions belong to production's domain, and access
tokens to production's address.

## Setting one up

From a clone, signed in to `gcloud` and `neon` as the maintainer. Use the release production runs
(`/api/v1/meta`), so that dev starts where production is.

**1. The Google Cloud project**, on a billing account (`gcloud billing projects describe $PP`
names production's; on the same one, production's kill switch and budget can count dev too):

```bash
gcloud projects create $P --name "WhatBuild dev"
gcloud billing projects link $P --billing-account <billing account>
```

**2. The Neon project**, in production's region. Its first branch becomes `prod-copy`, with the
application's role and an empty database, and `main`, the service's branch, is made from it. The
role is an ordinary one, never one that bypasses row-level security
([Cloud Run](cloud-run.md#setting-it-up)):

```bash
neon projects create --name "WhatBuild dev" --region-id <production's region> --org-id <org>
neon branches rename main prod-copy --project-id $N
ADMIN=$(neon connection-string prod-copy --project-id $N --role-name neondb_owner --database-name neondb)
PW=$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)
psql "$ADMIN" -v ON_ERROR_STOP=1 -v pw="$PW" <<< "CREATE ROLE whatbuild LOGIN PASSWORD :'pw'"
psql "$ADMIN" -v ON_ERROR_STOP=1 -c 'GRANT whatbuild TO neondb_owner WITH SET TRUE, INHERIT TRUE' \
  -c 'CREATE DATABASE whatbuild OWNER whatbuild' -c 'REVOKE whatbuild FROM neondb_owner'
neon branches create --project-id $N --name main --parent prod-copy
neon branches set-default main --project-id $N
HOST=$(neon connection-string main --project-id $N --role-name neondb_owner --database-name neondb |
  python3 -c 'import sys, urllib.parse as u; print(u.urlsplit(sys.stdin.read().strip()).hostname.replace("-pooler", ""))')
DATABASE_URL="postgresql://whatbuild:$PW@$HOST/whatbuild?sslmode=verify-full"
```

**3. `setup.sh`**, from a clean export of the release, in the same shell. It builds the image,
migrates `main`'s empty database and deploys the service:

```bash
S=$(mktemp -d); git archive <release> | tar -x -C "$S"
(cd "$S" && PROJECT_ID=$P DATABASE_URL="$DATABASE_URL" \
  INSTANCE_OWNERS=<maintainer> SIGNUP_ALLOWLIST=<maintainer> deploy/cloud-run/setup.sh)
rm -rf "$S"; unset PW DATABASE_URL
```

In a project created minutes before, the first build can be refused with `PERMISSION_DENIED`
while its permissions spread. Run the script again; it is safe to.

**4. Restore points.** A Neon key that reaches only the dev Neon project, readable by the build:

```bash
neon api-keys create --name whatbuild-dev-deploy-restore-points --project-id $N -o json \
  | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin)["key"])' \
  | gcloud secrets create whatbuild-neon-api-key --project $P --data-file=-
gcloud secrets add-iam-policy-binding whatbuild-neon-api-key --project $P \
  --member serviceAccount:$(gcloud projects describe $P --format='value(projectNumber)')-compute@developer.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor
```

**5. Google sign-in.** Google offers no API for this. In the Google Cloud console, open Google
Auth Platform → Clients in production's project, create a client of type *Web application* named
"WhatBuild dev" with the redirect URI `<the service's address>/auth/google/callback`, and download
its JSON, the only time the secret is shown. Then:

```bash
F=~/Downloads/client_secret_<client id>.json
python3 -I -c 'import json,sys; sys.stdout.write(json.load(open(sys.argv[1]))["web"]["client_secret"])' "$F" \
  | gcloud secrets create whatbuild-google-client-secret --project $P --data-file=-
gcloud secrets add-iam-policy-binding whatbuild-google-client-secret --project $P \
  --member serviceAccount:whatbuild-runtime@$P.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
gcloud run jobs update whatbuild-migrate --project $P --region $R \
  --update-secrets WHATBUILD_GOOGLE_CLIENT_SECRET=whatbuild-google-client-secret:latest
gcloud run services update whatbuild --project $P --region $R --update-env-vars WHATBUILD_GOOGLE_CLIENT_ID=<client id> \
  --update-secrets WHATBUILD_GOOGLE_CLIENT_SECRET=whatbuild-google-client-secret:latest
rm "$F"
```

**6. The instance owners' organizations**, by [refreshing the copy](#refreshing-the-copy). Its last step deploys
the release, which names the service by it and makes the first restore point.

**7. Production's example organization and plans**, as production names them (its
`WHATBUILD_EXAMPLE_TENANT`, its plans file and `WHATBUILD_NEW_ORGANIZATION_PLAN`; leave out what it
does not set). The plans file is the one production's `whatbuild-plans` secret holds, kept with the
deployment's own settings ([Cloud Run](cloud-run.md)):

```bash
gcloud secrets create whatbuild-plans --project $P --data-file=<production's plans file>
gcloud secrets add-iam-policy-binding whatbuild-plans --project $P --member "serviceAccount:whatbuild-runtime@$P.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor
gcloud run services update whatbuild --project $P --region $R --update-secrets WHATBUILD_PLANS=whatbuild-plans:latest \
  --update-env-vars WHATBUILD_EXAMPLE_TENANT=<the same slug>,WHATBUILD_NEW_ORGANIZATION_PLAN=<the same plan>
```

**8. Record** the values in `.env` ([above](#its-values)). `$DEV_URL/api/v1/meta` names the
release and reports `"google": true`.

## Keeping it private

The copy is real people's data. Dev holds it by the maintainer's choice
([decision](../decisions/releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)),
and holds only organizations an instance owner owns: customers' organizations never leave
production ([decision](../decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)).

- Dev holds only the organizations named, each one an instance owner owns; nothing of another
  leaves production for it. The pull checks the owners and refuses any other.
- Dev is not where the [restore drill](backups.md#the-restore-drill) goes: it restores every
  organization, and stays in production's own accounts.
- A copy goes from production to dev through a directory only you can read, deleted once loaded,
  never through a pull or a dataset kept in `.what-build/fixtures`. Nothing from the copy goes into the
  repository, a commit, an issue or a pull request.
- Production is only read: through the backup role and its bucket, never the application's
  database secret.
- Every command names its project (`--project`, `--project-id`), never `gcloud`'s current one, so a
  dev command cannot land on production.

## What it costs

Idle, it scales to nothing; a rehearsal is a build and a few minutes of the service. A kill switch
that names it beside production closes it with production; a rehearsal then gets `403` until it is
opened again ([A hard limit on the bill](cloud-run.md#a-hard-limit-on-the-bill)).
