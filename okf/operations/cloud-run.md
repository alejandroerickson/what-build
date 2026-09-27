---
type: System Concept
title: WhatBuild runs as one stateless Cloud Run service with Postgres and a Cloud Storage bucket.
description: What the production deployment is made of, how deploy/cloud-run/setup.sh creates it, sign-in and continuous deployment, cost, names, and useful commands.
tags: [operations, deployment, cloud-run, gcp]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
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
  the redirect URI `https://<your-url>/auth/google/callback`, then re-run with `GOOGLE_CLIENT_ID`
  and `GOOGLE_CLIENT_SECRET`. The secret goes to Secret Manager, never to the repository.
- **Email links** — re-run with `SMTP_URL=smtps://user:pass@host:465` and `MAIL_FROM`. Any SMTP
  provider works; this is also what sends invitations. Without it, invitations still work: the
  inviter is shown the single-use link to pass on.

**Who can join.** `SIGNUP_ALLOWLIST` (emails and `@domains`, comma-separated) limits who may create
an account; by default it is only the `gcloud` account that ran the script. Anyone who is invited
can always join. Widen it when public sign-up opens.

**Continuous deployment.** In Cloud Build, connect the GitHub repository and create a trigger on
pushes to `main` that runs `/cloudbuild.yaml` with the substitution `_REGION` set to the service's
region. Choose the trigger's region before connecting the repository. Each build
([`cloudbuild.yaml`](../../cloudbuild.yaml)) builds and pushes the image, points the migration job
at it, runs it, then deploys the service with `WHATBUILD_RELEASE` set to the commit.

**A custom domain.** Map it with Cloud Run domain mappings (or a load balancer), then re-run with
`PUBLIC_URL=https://app.what-build.com`: OAuth metadata, upload grants and links all use it.

## What it costs

At a handful of people looking in bursts, the service itself fits in Cloud Run's free grant. CPU
stays allocated while an instance is alive (`--no-cpu-throttling`) so the worker can parse an upload
after the response returns, and `--min-instances 0` lets it scale to nothing when idle (at most
three instances run); the first request after a quiet spell waits a few seconds. The smallest Cloud SQL instance is roughly
US$10 a month; a free-tier Postgres elsewhere costs nothing. Storage is cents.

## What is where

| Thing | Name | Notes |
|---|---|---|
| Service | `whatbuild` | public; WhatBuild's own sign-in guards everything but the web app's static files, sign-in, OAuth discovery, `/api/v1/meta`, `/healthz`, and the skill and its installers |
| Migration job | `whatbuild-migrate` | same image, `node main.js migrate` |
| Runtime identity | `whatbuild-runtime` | the bucket, the secrets, Cloud SQL client — nothing else |
| Database | Cloud SQL instance `whatbuild-db`, database and user `whatbuild` (with `CLOUD_SQL=1`) | or the Postgres named by `DATABASE_URL` |
| Bucket | `<project>-whatbuild-files` | private, uniform access, public access prevented; versioned, noncurrent versions deleted after 30 days |
| Secrets | `whatbuild-database-url`, `whatbuild-grant-key`, optional `whatbuild-smtp-url`, `whatbuild-google-client-secret` | read by the runtime identity only |
| Images | Artifact Registry `whatbuild` | the ten most recent always kept; others deleted after 30 days |

## Useful commands

```bash
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
