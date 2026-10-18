---
type: System Concept
title: WhatBuild runs as one stateless Cloud Run service with Postgres and a Cloud Storage bucket.
description: What the production deployment is made of, how deploy/cloud-run/setup.sh creates it, sign-in, deploying and restore points before migrating, cost, names, and useful commands; backups and the dev deployment have guides of their own.
tags: [operations, deployment, cloud-run, gcp]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# WhatBuild on Google Cloud Run

One container image serves everything — the web app, the REST API, the MCP endpoint, OAuth for
agents, and the upload relay — and runs the job worker that reads uploads. Postgres holds every
row; a Cloud Storage bucket holds every attachment and the text read from it. Nothing else runs.

```
            ┌──────────────────── Cloud Run service "whatbuild" ─────────────────────┐
browser ──▶ │  web app · /api/v1 · /mcp · /oauth · upload relay · job worker        │
agent   ──▶ │  (one image, stateless; any instance serves any request)               │
            └──────────┬───────────────────────────────┬─────────────────────────────┘
                       │                               │
              Postgres (Cloud SQL, or any)     Cloud Storage bucket
              rows, search, job queue          attachments and their text, create-only
```

Before each new revision serves traffic, the same image runs as the Cloud Run Job
`whatbuild-migrate` (`node main.js migrate`), so the schema always leads the code. The image is
built by the repository's [`Dockerfile`](../../Dockerfile); migrations are the forward-only SQL
files in `apps/server/src/migrations/`.

What a deployment keeps and how to restore it is in [Backups](backups.md). The maintainer also
runs a second deployment laid out the same way, the [dev deployment](dev-deployment.md), which
holds a copy of production and rehearses releases before production moves.

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
create one for WhatBuild and use it in `DATABASE_URL`. On Postgres 16 and later, an administrator
that is not a superuser (Neon's `neondb_owner`, for one) may create a database only for a role it
may act as, so it takes the role for the moment:

```sql
CREATE ROLE whatbuild LOGIN PASSWORD '…';
GRANT whatbuild TO neondb_owner WITH SET TRUE, INHERIT TRUE;
CREATE DATABASE whatbuild OWNER whatbuild;
REVOKE whatbuild FROM neondb_owner;
```

**Backups with another Postgres.** Cloud SQL keeps its own backups; a free tier keeps only hours
of restore history, so add the nightly logical backup that [Backups](backups.md#the-nightly-dump)
sets up. `setup.sh` does not create it yet. [Backups](backups.md) also says how to check that
backups run and how to restore one.

The script is safe to re-run; every step checks before it creates. It enables the APIs, creates the
image repository, the runtime identity, the bucket, the secrets and (with `CLOUD_SQL=1`) a Cloud SQL
for PostgreSQL 17 instance with daily backups (seven kept) and point-in-time recovery; then builds
the first image with Cloud Build (no local Docker), runs the migrations, deploys the service, and
prints its URL. See the header of [`setup.sh`](../../deploy/cloud-run/setup.sh) for every setting.
In a project created minutes before, the first build can be refused with `PERMISSION_DENIED`
while the project's new permissions spread; run the script again.

**Large uploads.** Agents upload through the service's own relay, which takes at most 25 MB per
file (Cloud Run refuses bodies over 32 MiB). `SIGNED_URLS=1` also hands agents direct-to-bucket
upload URLs for larger files, up to the 100 MB per-file limit; it grants the runtime identity the
right to sign as itself.

**Parsing.** The worker parses each file in a thread of its own, held to 384 MB of heap, half as
much again for buffers, and 120 seconds; a file that needs more is recorded as failed, and the
service keeps answering meanwhile ([§5.1](../spec/05-derived-layer.md#51-reading-an-attachment)). The
defaults suit the service's 1 GiB, leaving the rest to the server. Give the service more memory
before raising them (`WHATBUILD_PARSE_MEMORY_MB`, about a third of the instance's memory;
`WHATBUILD_PARSE_TIMEOUT_SECONDS`):

```bash
gcloud run services update whatbuild --region $R --memory 2Gi --update-env-vars WHATBUILD_PARSE_MEMORY_MB=768
```

**Production, whatever starts it.** The image sets `NODE_ENV=production`, and a server started
without it, or with any value but `development` or `test`, is production as well: it needs
`WHATBUILD_GRANT_KEY`, offers no development sign-in and logs no sign-in link. Never set
`NODE_ENV` to `development` or `test` on a deployment
([local development](local-development.md#development-and-production)). Over HTTPS the session
cookie is `__Host-wb_session`, which only the service's own host can set.

A release that changes parsing, these limits or the service's memory is tried with hostile files
on the [dev deployment](dev-deployment.md#rehearsing-a-release) (`scripts/hostile-files.mjs`), and
its memory read there, before production moves.

**Sign-in.** A production server never logs sign-in links, so it needs one of:

- **Google sign-in** — create an OAuth client (type *Web application*) in Google Auth Platform with
  the redirect URI `https://<your-url>/auth/google/callback` (the service answers at
  `https://whatbuild-<project number>.<region>.run.app`, known as soon as the project exists), then re-run with `GOOGLE_CLIENT_ID`
  and `GOOGLE_CLIENT_SECRET` (or create the secret `whatbuild-google-client-secret` in Secret Manager
  yourself and pass only the ID). The secret lives in Secret Manager, never in the repository.
- **Email links** — re-run with `SMTP_URL=smtps://user:pass@host:465` and `MAIL_FROM`. Any SMTP
  provider works; this is also what sends invitations. Without it, invitations still work: the
  inviter is shown the single-use link to pass on. [Mail](mail.md) has what the server sends,
  production's provider (Cloudflare Email Sending) and its commands. A re-run replaces every
  setting on the service, so a deployment that sends mail passes `MAIL_FROM` each time: without it
  the sender falls back to `no-reply@localhost`, which providers refuse, and sign-in links and
  invitations to new addresses fail.
- **Feedback by email** — with mail, also pass `FEEDBACK_EMAIL=<address>`, and that address gets a
  digest of people's and agents' feedback at most once a day. Without it, feedback stays in the
  database. A re-run replaces it too, so pass it each time ([mail](mail.md#the-feedback-digest)).
- **Microsoft work accounts** — `setup.sh` does not set it up. Register the application as the
  [Azure guide](azure.md#sign-in) does, with the optional ID-token claims `email` and `xms_edov`
  and the redirect URI `https://<your-url>/auth/microsoft/callback`, store its secret as
  `whatbuild-microsoft-client-secret`, and set `WHATBUILD_MICROSOFT_TENANT`,
  `WHATBUILD_MICROSOFT_CLIENT_ID` and `WHATBUILD_MICROSOFT_CLIENT_SECRET` (from the secret) on the
  service. An address is taken from the directory only when the token's `xms_edov` says its domain
  is verified, or its domain is listed in `WHATBUILD_MICROSOFT_DOMAINS`
  ([§3.2](../spec/03-accounts-teams-and-identity.md#sign-in-with-microsoft-work-accounts)). A
  refused sign-in shows a reference; the service's log line with it says which check failed and
  how to fix it ([When Microsoft sign-in is refused](azure.md#when-microsoft-sign-in-is-refused);
  on Cloud Run, `gcloud logging read 'jsonPayload.reference="<reference>"'`).

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

**The privacy page.** `/privacy` names who runs the deployment (`WHATBUILD_OPERATOR`), where to
write about one's data (`WHATBUILD_PRIVACY_CONTACT`, an email address or a web page) and the
providers that handle it (`WHATBUILD_PROVIDERS`, `Name: what it does; …`)
([§9.1](../spec/09-data-lifecycle.md)). Without them it says they have not been named. A
deployment's mail provider is one of them: it receives every recipient's address and message
([Mail](mail.md)). The list
holds commas, so pass it with gcloud's alternate delimiter:

```bash
gcloud run services update whatbuild --region $R --update-env-vars \
  '^|^WHATBUILD_OPERATOR=Example Labs|WHATBUILD_PRIVACY_CONTACT=privacy@example.com|WHATBUILD_PROVIDERS=Google Cloud: hosting, files and logs; Neon: the database; Cloudflare: the public site, its visit counts and email; Google Analytics: analytics, for those who accept'
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

**Deploying releases.** A deployment that follows releases has a Cloud Build trigger, which
`setup.sh` does not create; until one exists, **nothing deploys on its own**, and a merge to `main`
never does ([decision](../decisions/production-runs-releases-after-approval.md)). Choose the
trigger's region first, connect the GitHub repository there (installing the Cloud Build GitHub app
on it), and create a trigger on new tags that waits for approval:

```bash
gcloud builds connections create github github --project $P --region $R   # prints a link: install the app, then run it again
gcloud builds repositories create what-build --connection github --project $P --region $R \
  --remote-uri https://github.com/<owner>/what-build.git
gcloud builds triggers create github --name deploy-release --project $P --region $R \
  --repository projects/$P/locations/$R/connections/github/repositories/what-build \
  --tag-pattern '^v\d+\.\d+\.\d+$' --build-config cloudbuild.yaml --require-approval \
  --service-account projects/$P/serviceAccounts/<build identity> \
  --substitutions _REGION=$R,_NEON_PROJECT=<neon-project>
```

Publishing a release then starts a build that waits in Cloud Build's history until someone
approves it ([releasing](releasing.md)). Each build ([`cloudbuild.yaml`](../../cloudbuild.yaml))
builds and pushes the image, points the migration job at it, runs it, then deploys the service
with `WHATBUILD_RELEASE` set to the tag and sends traffic to it. The build passes the commit to
the image as `WHATBUILD_COMMIT`, and the image records it with the build time, so
`/api/v1/meta` reports `release` (version, commit, `built_at`) and the account menu shows
"Release v0.2.0", linked to the release's page on GitHub. The web app is built with the same
commit, so a page left open across the deploy loads the new release at its next screen
([§7.1](../spec/07-web-app.md#71-principles)). Before assuming a release is live, check
that a trigger exists and compare the release:

```bash
gcloud builds triggers list --project $P --region $R             # empty: nothing deploys on its own
curl -s https://<your-url>/api/v1/meta                            # server_version is the deployed release
```

Without a trigger, deploy by hand from a clean checkout of the tag; the build is the same. Leave
out `TAG_NAME` to deploy a commit that is not a release, which is then named by its hash:

```bash
gcloud builds submit --project $P --region $R --config cloudbuild.yaml \
  --substitutions TAG_NAME=v0.2.0,COMMIT_SHA=$(git rev-parse HEAD),SHORT_SHA=$(git rev-parse --short=7 HEAD) .
```

A deploy changes only the image and `WHATBUILD_RELEASE`; every other setting on the service, such
as `WHATBUILD_INSTANCE_OWNERS`, stays as it was.

**A restore point before migrating (Neon).** A migration that fails rolls back in its own
transaction, but one that succeeds and is wrong can only be undone by going back to the database
as it was. On Neon, each deploy can first branch the database: a branch is a copy at that moment,
made in about a second whatever the size, that shares storage with its parent until they differ
([decision](../decisions/each-deploy-branches-the-neon-database-before-migrating.md)). Give the
build a Neon API key that can reach only the project, and name the project in the trigger's
substitutions (above) or in each deploy by hand:

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
  visitors never wake the service, and passes on only the site's form; deploy it again with each
  release production takes ([releasing](releasing.md)), or the site keeps an older page. Everything for the app goes to the service: Cloud Run picks a service by Host and the
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
upload grants, links and the MCP server's instructions use the first; the site's host is the
second. The public URL is the app's one address. Where the `run.app` address keeps serving, a
browser opening a page there is sent to the same path on it, while health checks, `/api`, `/mcp`,
`/oauth` and `/.well-known` answer on either name. The Worker passes the domain in
`X-Forwarded-Host`, so its requests are never redirected; a front that sends the `run.app` name
as `Host` without that header needs `WHATBUILD_REDIRECT_TO_PUBLIC_URL=0`
([decision](../decisions/the-app-has-one-address-and-pages-on-other-hosts-move-to-it.md)). An
agent's access is for the address it connected to, so changing the public URL refuses every agent
connected before (`401`) until it is connected again with the new address. Add
`https://app.example.com/auth/google/callback` to the Google sign-in client's redirect URIs.

**Who asked to hear from us.** The site's form writes to the `interest` table
([§4.13](../spec/04-data-model.md)); nothing sends mail yet. Read it with Cloud SQL Studio or
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
sends out costs about US$0.12 a GB, and is the one cost that grows with downloads. Mail through
Cloudflare Email Sending needs the Workers Paid plan, which includes 3,000 messages a month
([Mail](mail.md)).

## What is where

| Thing | Name | Notes |
|---|---|---|
| Service | `whatbuild` | public; WhatBuild's own sign-in guards everything but the web app's static files, sign-in, OAuth discovery, `/api/v1/meta`, `/health`, the skill and its installers, and the public site with its interest form |
| Migration job | `whatbuild-migrate` | same image, `node main.js migrate` |
| Runtime identity | `whatbuild-runtime` | the bucket, the secrets, Cloud SQL client — nothing else |
| Build identity | the project's default compute identity, or `BUILD_SA` | deploy to Cloud Run, push images, write logs, read `<project>_cloudbuild`; `setup.sh` takes away the Editor role Google gives it |
| Database | Cloud SQL instance `whatbuild-db`, database and user `whatbuild` (with `CLOUD_SQL=1`) | or the Postgres named by `DATABASE_URL` |
| Bucket | `<project>-whatbuild-files` | private, uniform access, public access prevented; versioned, noncurrent versions deleted after 30 days |
| Secrets | `whatbuild-database-url`, `whatbuild-grant-key`, optional `whatbuild-smtp-url` ([Mail](mail.md)), `whatbuild-google-client-secret` | read by the runtime identity only |
| Images | Artifact Registry `whatbuild` | the ten most recent always kept; others deleted after 30 days |
| Scheduler job | `whatbuild-sandbox-reset` (with `SANDBOX_TENANT`) | wakes the service a minute after the sandbox's reset hour |
| Log exclusion | `whatbuild-request-addresses` on the `_Default` sink | Cloud Run logs every request itself, with its whole address, the client's IP and its browser, for 30 days. This drops its line for an address with a query (a search's words, a sign-in link's token) or an invitation link; the service's own line for it, masked, stays |
| Restore points (Neon, optional) | branches `pre-migrate-<time>-<commit>`, secret `whatbuild-neon-api-key` | one per deploy before migrating, the newest three kept; the key reaches only the Neon project and is read by the build identity |
| Backup (another Postgres, set up by hand) | job `whatbuild-backup`, scheduler job `whatbuild-backup-nightly`, identity `whatbuild-backup`, bucket `<project>-backups`, secret `whatbuild-backup-database-url` | a `pg_dump` each night as a read-only role that bypasses row-level security; the identity adds and reads dumps, never deletes; dumps expire after 35 days ([Backups](backups.md)) |

## Useful commands

```bash
P=my-whatbuild              # the PROJECT_ID; never gcloud's current project
R=northamerica-northeast2   # the default REGION; use yours
gcloud run services logs read whatbuild --region $R --limit 100     # structured request logs; no content, no tokens
gcloud logging sinks describe _Default --project $P --format='value(exclusions[].name)'   # whatbuild-request-addresses
gcloud run jobs execute whatbuild-migrate --region $R --wait         # migrate by hand
gcloud run services update whatbuild --region $R --update-env-vars WHATBUILD_SIGNUP_ALLOWLIST=@example.com
```

## Before public sign-up

The specification makes these an acceptance test, not a good intention
([§9.3](../spec/09-data-lifecycle.md), [Phase 6](../spec/10-roadmap.md)): a restore from backup
into a scratch instance, performed and written up; an export round-tripping into a fresh instance;
abuse limits tested; and the privacy page naming who runs the deployment, an address for privacy
requests and its providers (The privacy page, above). None of that is done yet.
