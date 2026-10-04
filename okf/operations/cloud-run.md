---
type: System Concept
title: WhatBuild runs as one stateless Cloud Run service with Postgres and a Cloud Storage bucket.
description: What the production deployment is made of, how deploy/cloud-run/setup.sh creates it, sign-in, deploying and restore points before migrating, cost, names, and useful commands.
tags: [operations, deployment, cloud-run, gcp]
generated: {by: agent:claude, at: 2026-10-01}
status: stable
---

# WhatBuild on Google Cloud Run

One container image serves everything — the web app, the REST API, the MCP endpoint, OAuth for
agents, and the upload relay — and runs the job worker that parses uploads. Postgres holds every
row; a Cloud Storage bucket holds every file and parsed sidecar. Nothing else runs.

```
            ┌──────────────────── Cloud Run service "whatbuild" ─────────────────────┐
browser ──▶ │  web app · /api/v1 · /mcp · /oauth · upload relay · job worker        │
agent   ──▶ │  (one image, stateless; any instance serves any request)               │
            └──────────┬───────────────────────────────┬─────────────────────────────┘
                       │                               │
              Postgres (Cloud SQL, or any)     Cloud Storage bucket
              rows, search, job queue          files and sidecars, create-only
```

Before each new revision serves traffic, the same image runs as the Cloud Run Job
`whatbuild-migrate` (`node main.js migrate`), so the schema always leads the code. The image is
built by the repository's [`Dockerfile`](../../Dockerfile); migrations are the forward-only SQL
files in `apps/server/src/migrations/`.

## Setting it up

From a clone, signed in to `gcloud` with rights to create resources in the project. `PROJECT_ID`
is required and is never taken from `gcloud`'s current project:

```bash
# A project of its own is cleaner than sharing one.
PROJECT_ID=my-whatbuild CLOUD_SQL=1 deploy/cloud-run/setup.sh
# …or with an existing Postgres (Neon's free tier works):
PROJECT_ID=my-whatbuild DATABASE_URL='postgres://user:pass@host/db?sslmode=require' deploy/cloud-run/setup.sh
```

**The database role must not bypass row-level security.** Tenant isolation is enforced by the
application and again by Postgres policies; WhatBuild refuses to start in production as a role
that is a superuser or has `BYPASSRLS`, because the second layer would silently not exist. The
Cloud SQL path creates an ordinary user. On a hosted Postgres whose default role bypasses RLS,
create one for WhatBuild: `CREATE ROLE whatbuild LOGIN PASSWORD '…'; CREATE DATABASE whatbuild
OWNER whatbuild;` and use that in `DATABASE_URL`.

**Backups with another Postgres.** Cloud SQL keeps its own backups; a free tier keeps only hours
of restore history, so add a nightly logical backup. `setup.sh` does not create it yet. `pg_dump`
cannot run as the `whatbuild` role, whose own rows the policies hide, so give it a role of its own
that reads everything and can change nothing: `CREATE ROLE whatbuild_backup LOGIN PASSWORD '…'
BYPASSRLS; GRANT pg_read_all_data TO whatbuild_backup;` (run by a role that has `BYPASSRLS`
itself). The dumps go to a bucket of their own, which the backup identity may add to and read but
not delete from, so a fault in the job cannot erase the dumps before it; they expire after 35 days.
The job runs the stock `postgres` image, of the same major version as the database:

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

To restore one, create an empty database owned by `whatbuild` and `pg_trgm` in it (as an
administrator), then restore as `whatbuild` itself, which needs no bypass because the dump turns
row-level security on after it loads the rows. Leave out the extension's comment, which only the
extension's owner may set:

```bash
pg_restore -l whatbuild-….dump | grep -v 'COMMENT - EXTENSION' > restore.list
pg_restore -d 'postgres://whatbuild:…@host/whatbuild' --no-owner --exit-on-error -L restore.list whatbuild-….dump
```

The script is safe to re-run; every step checks before it creates. It enables the APIs, creates the
image repository, the runtime identity, the bucket, the secrets and (with `CLOUD_SQL=1`) a Cloud SQL
for PostgreSQL 17 instance with daily backups (seven kept) and point-in-time recovery; then builds
the first image with Cloud Build (no local Docker), runs the migrations, deploys the service, and
prints its URL. See the header of [`setup.sh`](../../deploy/cloud-run/setup.sh) for every setting.

**Large uploads.** Agents upload through the service's own relay, which takes at most 25 MB per
file (Cloud Run refuses bodies over 32 MiB). `SIGNED_URLS=1` also hands agents direct-to-bucket
upload URLs for larger files, up to the 100 MB per-file limit; it grants the runtime identity the
right to sign as itself.

**Sign-in.** A production server never logs sign-in links, so it needs one of:

- **Google sign-in** — create an OAuth client (type *Web application*) in Google Auth Platform with
  the redirect URI `https://<your-url>/auth/google/callback` (the service answers at
  `https://whatbuild-<project number>.<region>.run.app`, known as soon as the project exists), then re-run with `GOOGLE_CLIENT_ID`
  and `GOOGLE_CLIENT_SECRET` (or create the secret `whatbuild-google-client-secret` in Secret Manager
  yourself and pass only the ID). The secret lives in Secret Manager, never in the repository.
- **Email links** — re-run with `SMTP_URL=smtps://user:pass@host:465` and `MAIL_FROM`. Any SMTP
  provider works; this is also what sends invitations. Without it, invitations still work: the
  inviter is shown the single-use link to pass on.

**Who can join.** `SIGNUP_ALLOWLIST` (emails and `@domains`, comma-separated) limits who may create
an account; by default it is only the `gcloud` account that ran the script. Anyone who is invited
can always join. Widen it when public sign-up opens.

**Who can create organizations.** `INSTANCE_OWNERS` (emails, comma-separated; by default the
`gcloud` account that ran the script) names the people who run the instance. They create any
number of organizations, and on **Organization creators** (`/instance`, in the account menu) let
anyone else create a number of their own; being in an organization never lets anyone create one
([§3.3](../spec/03-accounts-teams-and-identity.md#33-tenants-and-teams)). An address given an
allowance may also sign up. `TENANT_ALLOWANCE` sets how many any other address may create (0 by
default). **A service deployed before this setting existed has no instance owner**, so nobody can
create an organization until it is set:

```bash
gcloud run services update whatbuild --region $R --update-env-vars WHATBUILD_INSTANCE_OWNERS=you@example.com
```

**Analytics.** `ANALYTICS_ID=G-…` is a Google Analytics 4 measurement ID. With it, the app asks
every person to accept or decline cookies and loads Google Analytics only for those who accept
([§9.1](../spec/09-data-lifecycle.md)); the page headers let Google's hosts in. The same ID and a
Cloudflare Web Analytics token go to the Worker for the public site. [Analytics](analytics.md) has
the stream settings to keep, the Worker command and how to read reports.

```bash
gcloud run services update whatbuild --region $R --update-env-vars WHATBUILD_ANALYTICS_ID=G-XXXXXXXXXX
```

**A public sandbox.** `SANDBOX_TENANT=<slug>` names one organization as the public sandbox
([§9.7](../spec/09-data-lifecycle.md)); the organization must exist, and the service reads the
name when it starts. On a service that is already deployed:

```bash
gcloud run services update whatbuild --region $R --update-env-vars WHATBUILD_SANDBOX_TENANT=<slug>
```

Then, signed in as an owner or admin of that organization, open `/t/<slug>/sandbox`: get the
content as visitors should find it, **Save baseline**, check the limits, and make an invitation.
Removing the variable closes the sandbox to every visitor at the next start, and leaves the
organization and its staff as they were.

The reset needs nothing more: the first request after its hour runs it. To have it run at the
hour even when nobody visits, let Cloud Scheduler wake the service. `setup.sh` creates the job
when `SANDBOX_TENANT` is set, and this creates it by hand:

```bash
gcloud scheduler jobs create http whatbuild-sandbox-reset --location $R \
  --schedule "1 2 * * *" --time-zone "America/Los_Angeles" \
  --http-method POST --uri "https://<your-url>/api/v1/sandbox/reset-if-due"
```

Keep the schedule a minute after the hour in the sandbox's settings, in the same time zone; if
you change one, change the other. The address needs no credential: it does nothing unless a reset
is due. Cloud Scheduler is not offered in every region, so `SCHEDULER_LOCATION` may need to name
a region near the service's.

**Continuous deployment.** It needs a Cloud Build trigger that `setup.sh` does not create; until
one exists, **a push to `main` deploys nothing**. In Cloud Build, connect the GitHub repository and create a trigger on pushes to
`main` that runs `/cloudbuild.yaml` with the substitution `_REGION` set to the service's region.
Choose the trigger's region before connecting the repository. Each build
([`cloudbuild.yaml`](../../cloudbuild.yaml)) builds and pushes the image, points the migration job
at it, runs it, then deploys the service with `WHATBUILD_RELEASE` set to the commit and sends
traffic to it. The build
passes the commit to the image as `WHATBUILD_COMMIT`, and the image records it with the build time,
so `/api/v1/meta` reports `release` (version, commit, `built_at`) and the account menu shows it.
Before assuming a merge is live, check that a trigger exists and compare the release:

```bash
gcloud builds triggers list --project $P --region $R             # empty: nothing deploys on push
curl -s https://<your-url>/api/v1/meta                            # server_version is the deployed commit
```

Without a trigger, deploy a commit by hand from a clean checkout of it; the build is the same:

```bash
gcloud builds submit --project $P --region $R --config cloudbuild.yaml \
  --substitutions COMMIT_SHA=$(git rev-parse HEAD),SHORT_SHA=$(git rev-parse --short=7 HEAD) .
```

A deploy changes only the image and `WHATBUILD_RELEASE`; every other setting on the service, such
as `WHATBUILD_INSTANCE_OWNERS`, stays as it was.

**A restore point before migrating (Neon).** A migration that fails rolls back in its own
transaction, but one that succeeds and is wrong can only be undone by going back to the database
as it was. On Neon, each deploy can first branch the database: a branch is a copy at that moment,
made in about a second whatever the size, that shares storage with its parent until they differ
([decision](../decisions/each-deploy-branches-the-neon-database-before-migrating.md)). Give the
build a Neon API key that can reach only the project, and name the project in each deploy:

```bash
neon api-keys create --name whatbuild-deploy-restore-points --project-id <neon-project> -o json \
  | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin)["key"])' \
  | gcloud secrets create whatbuild-neon-api-key --project $P --data-file=-
gcloud secrets add-iam-policy-binding whatbuild-neon-api-key --project $P \
  --member serviceAccount:<build identity> --role roles/secretmanager.secretAccessor
gcloud builds submit … --substitutions COMMIT_SHA=…,SHORT_SHA=…,_NEON_PROJECT=<neon-project> .
```

The build's `restore-point` step branches `_NEON_BRANCH` (default `production`) as
`pre-migrate-<UTC time>-<commit>`, waits until Neon has made it, and stops the deploy if it cannot,
so nothing migrates without one. It keeps the newest `_NEON_KEEP` (default 3) and removes older
ones; a free Neon plan allows ten branches. Without `_NEON_PROJECT` the step does nothing.

To go back, restore the branch to the restore point; the whole procedure, for every database, is
[recovering from a bad release](recovering-from-a-bad-release.md). The branch keeps its ID and its connection
string, so `DATABASE_URL` stays as it is, and its state just before the restore is kept under the
name given. Then send traffic to the revision that matches the older schema:

```bash
neon branches restore production pre-migrate-<time>-<commit> --project-id <neon-project> \
  --preserve-under-name production-before-restore
gcloud run revisions list --service whatbuild --project $P --region $R
gcloud run services update-traffic whatbuild --project $P --region $R --to-revisions <revision>=100
```

Writes made after the restore point are lost, apart from the preserved branch, which can be read
for them. After a restore, `production` hangs from the restore point, which therefore cannot be
deleted: the build keeps it and says so. Delete the preserved branch when it is no longer needed,
then that restore point, and deploy a fixed migration as a new commit; the restored database has no
record of the reverted migration, so it runs again.

**A custom domain.** The app answers at a subdomain (`app.example.com`) and the public site at the
domain itself (`example.com`, with `www.` redirecting to it); both reach the same service, which
tells them apart by Host. Put them in front of the service one of three ways:

- **Cloudflare** (free, any region). Move the domain's DNS to Cloudflare (the registration stays
  where it is; only the nameservers change), build the web app and deploy the Worker in
  [`deploy/cloudflare/`](../../deploy/cloudflare/wrangler.toml) with `ORIGIN` (the service's
  `run.app` URL), `SITE_HOST` and `APP_URL`, as `wrangler.toml` shows, and give the Worker the
  custom domains `example.com`, `www.example.com` and `app.example.com`. Cloudflare issues the
  certificates. The Worker serves the public site from the build it was deployed with, so
  visitors never wake the service, and passes on only the site's form; redeploy it when the page
  changes. Everything for the app goes to the service: Cloud Run picks a service by Host and the
  free plan cannot rewrite it, so the Worker sends each request to the `run.app` name and passes
  the browser's domain in `X-Forwarded-Host`. The free plan allows 100,000 Worker requests a day;
  the `run.app` address keeps serving. Most of WhatBuild's callers are agents, which Cloudflare's bot defences take for
  bots, so in the zone: leave Bot Fight Mode off; turn off blocking of AI bots and crawlers; skip
  Browser Integrity Check for `/mcp`, `/oauth`, `/.well-known` and `/api` with a configuration
  rule; and turn off Email Address Obfuscation and Rocket Loader, which rewrite HTML. A request
  that sends nothing for 100 seconds is cut off; no WhatBuild operation runs that long.

- **Cloud Run domain mappings** (free), only in the regions that support them (`us-central1`,
  `us-east1`, `us-east4`, `us-west1`, `europe-west1`, `europe-west4`, `europe-north1`,
  `asia-east1`, `asia-northeast1`, `asia-southeast1`). Verify the domain in Google Search Console,
  create a mapping per host, and add the DNS records each mapping lists.
- **A global external Application Load Balancer** in any region (about US$18 a month for its
  forwarding rule): a serverless network endpoint group for the service, a backend service, a
  URL map, a Google-managed certificate for all three hosts, and one static IP. At the DNS
  provider, point `@`, `www` and `app` at that IP with `A` records. The certificate turns active
  once DNS resolves to the IP, usually within an hour. With a load balancer in front, set the
  service's ingress to `internal-and-cloud-load-balancing` so the `run.app` address stops serving.

Then re-run with `PUBLIC_URL=https://app.example.com SITE_URL=https://example.com`: OAuth metadata,
upload grants and links use the first; the site's host is the second. Add
`https://app.example.com/auth/google/callback` to the Google sign-in client's redirect URIs.

**Who asked to hear from us.** The site's form writes to the `interest` table
([§4.12](../spec/04-data-model.md)); nothing sends mail yet. Read it with Cloud SQL Studio or
`psql`: `SELECT email, name, organization, note, created_at FROM interest ORDER BY created_at DESC;`

## What it costs

At a handful of people looking in bursts, the service itself fits in Cloud Run's free grant. CPU
stays allocated while an instance is alive (`--no-cpu-throttling`) so the worker can parse an upload
after the response returns, and `--min-instances 0` lets it scale to nothing when idle; the first
request after a quiet spell waits a few seconds. An instance stays alive for up to about 15 minutes
after its last request and is billed for all of it, so anything that calls every few minutes,
crawlers included, keeps one running: roughly US$45 a month for each instance kept busy. One
instance runs at most (`MAX_INSTANCES`, default 1), which is ample for a few teams and makes that
the ceiling. Builds deploy a new image and keep the setting. The smallest Cloud SQL instance is roughly
US$10 a month; a free-tier Postgres elsewhere costs nothing, but holds about 0.5 GB, so lower a
public sandbox's upload allowances to match (`bytes_per_day`, `org_bytes_per_day`;
[§9.7](../spec/09-data-lifecycle.md)): visitors' text and its search index land in Postgres. Storage is cents; data the service
sends out costs about US$0.12 a GB, and is the one cost that grows with downloads.

## What is where

| Thing | Name | Notes |
|---|---|---|
| Service | `whatbuild` | public; WhatBuild's own sign-in guards everything but the web app's static files, sign-in, OAuth discovery, `/api/v1/meta`, `/health`, the skill and its installers, and the public site with its interest form |
| Migration job | `whatbuild-migrate` | same image, `node main.js migrate` |
| Runtime identity | `whatbuild-runtime` | the bucket, the secrets, Cloud SQL client — nothing else |
| Build identity | the project's default compute identity, or `BUILD_SA` | deploy to Cloud Run, push images, write logs, read `<project>_cloudbuild`; `setup.sh` takes away the Editor role Google gives it |
| Database | Cloud SQL instance `whatbuild-db`, database and user `whatbuild` (with `CLOUD_SQL=1`) | or the Postgres named by `DATABASE_URL` |
| Bucket | `<project>-whatbuild-files` | private, uniform access, public access prevented; versioned, noncurrent versions deleted after 30 days |
| Secrets | `whatbuild-database-url`, `whatbuild-grant-key`, optional `whatbuild-smtp-url`, `whatbuild-google-client-secret` | read by the runtime identity only |
| Images | Artifact Registry `whatbuild` | the ten most recent always kept; others deleted after 30 days |
| Scheduler job | `whatbuild-sandbox-reset` (with `SANDBOX_TENANT`) | wakes the service a minute after the sandbox's reset hour |
| Restore points (Neon, optional) | branches `pre-migrate-<time>-<commit>`, secret `whatbuild-neon-api-key` | one per deploy before migrating, the newest three kept; the key reaches only the Neon project and is read by the build identity |
| Backup (another Postgres, set up by hand) | job `whatbuild-backup`, scheduler job `whatbuild-backup-nightly`, identity `whatbuild-backup`, bucket `<project>-backups`, secret `whatbuild-backup-database-url` | a `pg_dump` each night as a read-only role that bypasses row-level security; the identity adds and reads dumps, never deletes; dumps expire after 35 days |

## Useful commands

```bash
P=my-whatbuild              # the PROJECT_ID; never gcloud's current project
R=northamerica-northeast2   # the default REGION; use yours
gcloud run services logs read whatbuild --region $R --limit 100     # structured request logs; no content, no tokens
gcloud run jobs execute whatbuild-migrate --region $R --wait         # migrate by hand
gcloud run services update whatbuild --region $R --update-env-vars WHATBUILD_SIGNUP_ALLOWLIST=@example.com
```

## Before public sign-up

The specification makes these an acceptance test, not a good intention
([§9.3](../spec/09-data-lifecycle.md), [Phase 6](../spec/10-roadmap.md)): a restore from backup
into a scratch instance, performed and written up; an export round-tripping into a fresh instance;
abuse limits tested. None of that is done yet.
