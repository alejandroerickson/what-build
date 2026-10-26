---
type: System Concept
title: WhatBuild runs as one stateless Cloud Run service with Postgres and a Cloud Storage bucket.
description: What a deployment on Cloud Run is made of, how deploy/cloud-run/setup.sh creates it, sign-in, deploying and restore points before migrating, its alerts and traces, cost, names, and useful commands; backups and the dev deployment have guides of their own.
tags: [operations, deployment, cloud-run, gcp]
generated: {by: agent:claude, at: 2026-10-25}
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
built by the repository's [`deploy/Dockerfile`](../../deploy/Dockerfile), from the repository's
root; migrations are the forward-only SQL files in `apps/server/src/migrations/`.

What a deployment keeps and how to restore it is in [Backups](backups.md). A second deployment
laid out the same way, a [dev deployment](dev-deployment.md), can hold a copy of production and
rehearse releases before production moves.

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
  setting up Cloudflare Email Sending, and its commands. A re-run replaces every
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

**The plan of a new organization.** `NEW_ORGANIZATION_PLAN=free` (`WHATBUILD_NEW_ORGANIZATION_PLAN`)
puts every organization someone other than an instance owner creates on the free plan, whose
limits everyone in it meets ([§9.7](../spec/09-data-lifecycle.md)); left out, they are unlimited.
A deployment open to the public sets `free`; a deployment for one organization's own people leaves it out.
Instance owners' organizations are always unlimited, and they change any organization's plan on
`/instance`:

```bash
gcloud run services update whatbuild --region $R --update-env-vars WHATBUILD_NEW_ORGANIZATION_PLAN=free
```

**The example organization** is for the maintainer's public deployment only: any other deployment
leaves it out and has none. `EXAMPLE_TENANT=<slug>` (`WHATBUILD_EXAMPLE_TENANT`) names one
organization that every signed-in account reads and only its members change
([§3.10](../spec/03-accounts-teams-and-identity.md#310-the-example-organization)); the
organization must exist, and the service reads the name when it starts. On a service that is
already deployed:

```bash
gcloud run services update whatbuild --region $R --update-env-vars WHATBUILD_EXAMPLE_TENANT=<slug>
```

Its owners and admins then write the worked example there as in any organization. Removing the
variable takes every guest's access away at the next start, and leaves the organization and its
members as they were. After its slug changes (Organization name on its Members page, or Rename on
`/instance`), set the variable to the new slug: until then the server still finds the example by
the old one and warns at start-up.

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
  --tag-pattern '^v\d+\.\d+\.\d+$' --build-config deploy/cloud-run/cloudbuild.yaml --require-approval \
  --service-account projects/$P/serviceAccounts/<build identity> \
  --substitutions _REGION=$R,_NEON_PROJECT=<neon-project>
```

Publishing a release then starts a build that waits in Cloud Build's history until someone
approves it ([releasing](releasing.md)). Each build
([`deploy/cloud-run/cloudbuild.yaml`](../../deploy/cloud-run/cloudbuild.yaml)) builds and pushes
the image, points the migration job at it, runs it, then deploys the service with
`WHATBUILD_RELEASE` set to the tag and sends traffic to it. The build passes the commit to
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
gcloud builds submit --project $P --region $R --config deploy/cloud-run/cloudbuild.yaml \
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
  release production takes ([releasing](releasing.md)), or the site keeps an older page. Everything for the app goes to the service but for paths the app never serves, which scanners ask for by the hundred (a dotfile such as `/.env` or `/.git/config` other than `/.well-known`, or a root file such as `/xmlrpc.php` or `/service-account.json`): the Worker answers those 404 itself, so they never wake the service or its database. Cloud Run picks a service by Host and the
  free plan cannot rewrite it, so the Worker sends each request to the `run.app` name and passes
  the browser's domain in `X-Forwarded-Host`. The free plan allows 100,000 Worker requests a day;
  the `run.app` address keeps serving until the service holds an edge key (below). Most of WhatBuild's callers are agents, which Cloudflare's bot defences take for
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
second. The public URL is the app's one address. Where the `run.app` address keeps serving (no
edge key, below), a browser opening a page there is sent to the same path on it, while health checks, `/api`, `/mcp`,
`/oauth` and `/.well-known` answer on either name. The Worker passes the domain in
`X-Forwarded-Host`, so its requests are never redirected; a front that sends the `run.app` name
as `Host` without that header needs `WHATBUILD_REDIRECT_TO_PUBLIC_URL=0`
([decision](../decisions/the-app-has-one-address-and-pages-on-other-hosts-move-to-it.md)). An
agent's access is for the address it connected to, so changing the public URL refuses every agent
connected before (`401`) until it is connected again with the new address. Add
`https://app.example.com/auth/google/callback` to the Google sign-in client's redirect URIs.

**A content site.** Mockups' prototypes, Story and mockup pages, Idea cards, style specimens, the
print view, agents' previews and the PDFs and HTML files the app shows inline are served from the
app's origin until `WHATBUILD_CONTENT_URL` names an origin of their own, on a registrable domain
apart from the app's (`https://usercontent.example.net`; a subdomain of `example.com` would be the
same site and get its cookies), so a browser bug that escapes a page's sandbox lands away from the
session and the API ([decision](../decisions/with-a-content-site-every-page-and-inline-file-is-served-from-it.md)).
With the Worker in front, move that domain's DNS to the same Cloudflare account, give the
Worker the domain as one more custom domain, and in its zone turn off Email Address Obfuscation and
Rocket Loader, which would rewrite the pages' HTML, and Web Analytics' automatic beacon (RUM),
which Cloudflare may switch on for a new zone and which adds a script to every page. A
Configuration Rule on every request with Disable RUM and Disable Zaraz on, and both of the others
off, settles all of them. Behind another front, point the host at the service as the app's is.
Then:

```bash
gcloud run services update whatbuild --region $R --update-env-vars WHATBUILD_CONTENT_URL=https://usercontent.example.net
```

On that host the service answers `/prototypes/`, `/documents/`, the two preview paths
(`/api/v1/downloads/story-preview/` and `…/card-preview/`) and `/health`, and nothing else; the
Worker passes them all, since none has a dot in its first part. The app's `frame-src` names its
`/prototypes/` and `/documents/`. Ask people to reload WhatBuild's open tabs once it is first set.
Deploys keep the setting; removing it puts everything back on the app's origin.

**Behind Cloudflare, nobody goes around it.** Two settings keep a stranger from flooding the
service, or keeping it and its database awake, from outside what the Worker allows:

- **A rate limit** in the app's zone (Security > WAF > Rate limiting rules). The free plan has one
  rule, which may match on the path alone and counts by IP over 10 seconds. Make it match every
  path (`starts_with(http.request.uri.path, "/")`), and block for 10 seconds an address that sends
  more than 100 requests in 10 seconds; it answers `429`. `/assets/` counts too: the Worker passes
  an asset it lacks on to the service, so made-up asset paths would otherwise reach it unlimited,
  and the app's page loads only a few. That is several times what a person or an agent sends at
  their busiest, and less than a scanner's burst; Cloudflare counts approximately, so a burst may
  run somewhat past it before the block. The content site's zone needs none: a
  prototype's page may ask for hundreds of files at once.
- **An edge key.** The `run.app` address serves anyone who finds it, past the rate limit and the
  Worker's answers to scanners. With `WHATBUILD_EDGE_KEY` set, the service refuses every request
  but `/health` that does not carry the key in `X-WhatBuild-Edge-Key` (`403`, before anything else
  runs), and the Worker adds it, from its secret `EDGE_KEY`, to every request it passes on
  ([decision](../decisions/behind-cloudflare-the-service-answers-only-requests-that-carry-the-workers-key.md)).
  Make the key, give it to the Worker and deploy the Worker, then give it to the service, in that
  order, so no request through the Worker is refused:

```bash
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create whatbuild-edge-key --project $P --replication-policy=automatic --data-file=-
gcloud secrets add-iam-policy-binding whatbuild-edge-key --project $P \
  --member serviceAccount:whatbuild-runtime@$P.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
gcloud secrets versions access latest --secret whatbuild-edge-key --project $P \
  | npx wrangler secret put EDGE_KEY --config deploy/cloudflare/wrangler.toml
# deploy the Worker as above, from a build that sends the key, then:
gcloud run services update whatbuild --project $P --region $R --update-secrets WHATBUILD_EDGE_KEY=whatbuild-edge-key:latest
curl -s -o /dev/null -w '%{http_code}\n' https://whatbuild-<project number>.$R.run.app/api/v1/meta   # 403
curl -s -o /dev/null -w '%{http_code}\n' https://app.example.com/api/v1/meta                          # 200
```

The Worker keeps its secret across deploys, and the service its setting across builds; `setup.sh`
passes the secret on whenever it exists. Anything else that calls the service (a scheduler, a
script) calls the public URL, through the Worker. To change the
key, add a version to the secret, put it on the Worker, then update the service as above: requests
in the moments between the two are refused. Without a Worker in front, set no key. A flood sent
straight to the `run.app` address is then refused at little cost, but not at none: each refused
request still runs the instance (one at most, [What it costs](#what-it-costs)) and sends its short
answer. Cloud Run's own request log line for it is dropped (`whatbuild-refused-requests`, made by
`setup.sh`; [What is where](#what-is-where)).

**Who asked to hear from us.** The site's form writes to the `interest` table
([§4.13](../spec/04-data-model.md)); nothing sends mail yet. Read it with Cloud SQL Studio or
`psql`: `SELECT email, name, organization, note, created_at FROM interest ORDER BY created_at DESC;`

## Alerts

[`deploy/cloud-run/alerts.mjs`](../../deploy/cloud-run/alerts.mjs) creates seven alert policies, and three more with the kill switch ([A hard limit on the bill](#a-hard-limit-on-the-bill)), in
Cloud Monitoring, or brings them up to date, each mailed to `ALERT_EMAIL` (by default the `gcloud`
account running it); `setup.sh` runs it. They read only what Cloud Run measures and logs
([decision](../decisions/alerts-watch-the-platform-and-traces-go-to-a-project-of-their-own.md)):

| Policy | Mails when | Look first at |
|---|---|---|
| `whatbuild: server errors` | a 5xx response in five minutes | the service's error lines, below; a 503 or 504 with none means no instance could serve, or a request ran past the 300-second timeout |
| `whatbuild: errors in the log` | a line of severity ERROR from the service (Cloud Run's request log aside), at most one mail an hour | the line itself: an unexpected error names its request, `request_id`; `Memory limit … exceeded` |
| `whatbuild: memory` | an instance above 85% of its memory for five minutes | the worker's log lines for the file being read; [Parsing](#setting-it-up) for the limits and the service's memory |
| `whatbuild: a job failed` | a failed run of `whatbuild-backup` or `whatbuild-migrate` | `gcloud run jobs executions list --job <job>`; [Backups](backups.md) or [Recovering](recovering-from-a-bad-release.md) |
| `whatbuild: a flood of requests` | more than 3,000 requests in five minutes, however they were answered | Cloud Run's request log, for the paths asked for and the addresses asking |
| `whatbuild: data sent out` | more than 1 GB sent to the internet in an hour | the request log for large responses asked for again and again |
| `whatbuild: logs written` | more than 100 MB of logs written in the project in an hour | Logs Explorer's histogram by log name; most often a flood of requests |
| `whatbuild: kill switch, data sent out` | more than 20 GB sent to the internet in an hour; also closes the service | [A hard limit on the bill](#a-hard-limit-on-the-bill) |
| `whatbuild: kill switch, logs` | more than 2 GB of logs written in the project in an hour; also closes the service | [A hard limit on the bill](#a-hard-limit-on-the-bill) |
| `whatbuild: the kill switch acted` | the kill switch closed services, or could not | its log line, which names each service and why |

The three before the kill switch's watch the costs that have no ceiling ([What it costs](#what-it-costs)),
each set far past what a few teams and their agents send, and mail within minutes, where a budget's
figures arrive hours late. An unexpected error behind a 500 mails twice, once from each of the first two. Nothing calls the
service: an uptime check every few minutes would keep an instance alive, and billed, all month. So
an outage that keeps requests from reaching Cloud Run (the domain, DNS, Cloudflare) mails nothing.

```bash
PROJECT_ID=$P node deploy/cloud-run/alerts.mjs     # create or update; ALERT_EMAIL=… to mail elsewhere, DRY_RUN=1 to print them
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="whatbuild" AND severity>=ERROR AND NOT log_id("run.googleapis.com/requests")' \
  --project $P --freshness 1d --limit 20      # the error lines
gcloud logging read 'jsonPayload.request_id="<request id>"' --project $P --freshness 7d   # every line of one request
```

## Traces

The service traces each request, the operation it runs, the statements run inside them and each
job, when OpenTelemetry's standard settings name where to send them
([§2.8](../spec/02-architecture.md#28-cross-cutting-rules)). On Cloud Run, send them to Google's
Telemetry API, into **a project of their own that runs nothing**: a project
with trace storage also keeps Cloud Run's own span for each request it samples, with its whole
address (a search's words, an invitation's token) and the browser's user agent, and nothing turns
those off. With the traces elsewhere, the service's project has no trace storage, and Cloud Run's
spans are dropped. **Never send a deployment's traces to its own project**, nor press Enable on
its Trace Explorer page.

Setting it up for a deployment, once (`setup.sh` does the last two steps with `TRACES_PROJECT`):

```bash
T=my-whatbuild-traces       # a new project, billed with the service's
gcloud projects create $T --name "WhatBuild traces"
gcloud billing projects link $T --billing-account "$(gcloud billing projects describe $P --format='value(billingAccountName)' | sed 's#billingAccounts/##')"
gcloud services enable telemetry.googleapis.com cloudtrace.googleapis.com observability.googleapis.com bigquery.googleapis.com --project $T
gcloud projects add-iam-policy-binding $T --member serviceAccount:whatbuild-runtime@$P.iam.gserviceaccount.com \
  --role roles/telemetry.tracesWriter --condition None
gcloud run services update whatbuild --project $P --region $R --update-env-vars \
  OTEL_EXPORTER_OTLP_ENDPOINT=https://telemetry.googleapis.com,OTEL_RESOURCE_ATTRIBUTES=gcp.project_id=$T
```

A grant in a project made minutes before can be refused with `Forbidden` for a minute or two. A
refused send loses that batch of spans, and the service says so at most once a minute
(`"event":"tracing"`, severity WARNING); later batches go through once the grant has spread. The first
spans create the project's trace storage, `_Trace` in `us`, within a few minutes. Then link it to
BigQuery once, so an agent can query it: Google's Cloud Trace API cannot read spans written
through the Telemetry API.

```bash
gcloud observability buckets datasets links create projects/$T/locations/us/buckets/_Trace/datasets/Spans/links/whatbuild_traces \
  --dataset Spans --bucket _Trace --location us --project $T      # takes some minutes
```

**Reading them.** A person opens Trace Explorer in the traces project, where a request's ID
finds its trace; the request's log lines name the same trace (`logging.googleapis.com/trace`). An
agent queries the linked dataset, whose `_AllSpans` view has
`trace_id`, `span_id`, `parent_span_id`, `name`, `kind`, `start_time`, `duration_nano`,
`attributes` (JSON) and `status`:

```bash
bq query --project_id $T --use_legacy_sql=false '
  select name, count(*) as n, round(avg(duration_nano) / 1e6) as avg_ms, round(max(duration_nano) / 1e6) as max_ms
  from `'$T'.whatbuild_traces._AllSpans`
  where start_time > timestamp_sub(current_timestamp(), interval 1 day) and kind = 2    -- 2: a request; 1: an operation; 3: a statement; 5: a job
  group by name order by avg_ms desc limit 20'
bq query --project_id $T --use_legacy_sql=false '
  select name, parent_span_id, round(duration_nano / 1e6) as ms, to_json_string(attributes) as attributes
  from `'$T'.whatbuild_traces._AllSpans` where trace_id = "<request id>" order by start_time'
```

A deployment may send its traces anywhere that takes OTLP over HTTP with protobuf instead:
`OTEL_EXPORTER_OTLP_ENDPOINT` names it, and `OTEL_EXPORTER_OTLP_HEADERS` carries a key
(`x-honeycomb-team=<key>` for Honeycomb, say, from a secret). The provider then belongs on the
privacy page's list. Leaving `OTEL_EXPORTER_OTLP_ENDPOINT` unset, or `OTEL_SDK_DISABLED=true`,
sends nothing.

## What it costs

At a handful of people looking in bursts, the service itself fits in Cloud Run's free grant. CPU
stays allocated while an instance is alive (`--no-cpu-throttling`) so the worker can parse an upload
after the response returns, and `--min-instances 0` lets it scale to nothing when idle; the first
request after a quiet spell waits a few seconds. An instance stays alive for up to about 15 minutes
after its last request and is billed for all of it, so anything that calls every few minutes,
crawlers included, keeps one running: roughly US$62 a month for each instance kept busy in
`northamerica-northeast2` (US$0.0864 an hour for 1 vCPU and 1 GiB; less in Google's cheaper
regions). The
database need not stay up with it. The worker looks at the job queue every two seconds only for a
minute after the last request someone signed in made to the API, MCP or sign-in, or the last job,
then sleeps until the next such request, a commit that queues work, or a retry falling due, and
nothing else queries the database between requests. A request from nobody signed in (a scanner's,
a stranger's) never wakes it, so it cannot keep the database awake. A Postgres that suspends when idle (Neon's free plan, after five
minutes with no query) therefore sleeps about six minutes after the last request, while the
instance may stay up. On Neon's free plan a project has 100 CU-hours a month, 400 hours at its
smallest size, and its compute is suspended until the month ends once they are used up: a
deployment people use through much of the day needs the Launch plan. One
instance runs at most (`MAX_INSTANCES`, default 1), which is ample for a few teams and makes that
the ceiling, give or take: Google may run a second for a few minutes in a sudden spike, or while a
deploy replaces a revision. Builds deploy a new image and keep the setting. The smallest Cloud SQL instance is roughly
US$10 a month; a free-tier Postgres elsewhere costs nothing, but holds little (1 GB a project on Neon's), so keep
the free plan's upload allowances to match (`bytes_per_day`, `org_bytes_per_day`, changed per
organization on `/instance`; [§9.7](../spec/09-data-lifecycle.md)): the text of what free
organizations upload, and its search index, land in Postgres. Storage is cents. Data the service
sends to the internet costs US$0.105 a GB within North America after a free first GB a month (more
to other continents). It, the logs (US$0.50 a GB past 50 GB a project each month) and traces are
the costs with no ceiling: each grows with requests, whoever sends them, so only a flood could make
the bill large. Three alerts mail within minutes of one ([Alerts](#alerts)). With the kill switch, a
budget on the billing account mails at 75%, 100%, 200% and 500% of it and when the month's forecast
passes it, and is the kill switch's cap, which closes the service once it is reached ([A hard limit
on the bill](#a-hard-limit-on-the-bill)). Mail through
Cloudflare Email Sending needs the Workers Paid plan, which includes 3,000 messages a month
([Mail](mail.md)). The alert policies cost about US$0.10 each a month; their mail costs
nothing. Traces are billed by the million spans ingested, and a few thousand requests a day make
well under a million a month.

## A hard limit on the bill

Google Cloud caps nothing by itself: a budget only mails, hours late, and Google's own way to stop
spending, disabling billing, stops everything and may delete what the project holds. The kill
switch is a cap that keeps everything
([decision](../decisions/at-its-spending-cap-a-deployment-closes-itself-to-the-internet.md)).

**What it does.** When the month's spending on the billing account reaches the cap, or when one of
two alerts says a flood is running away (more than 20 GB sent to the internet, or 2 GB of logs
written, in an hour: about US$1 to US$2 an hour, far past anything people do), it takes the public
(`allUsers`, `allAuthenticatedUsers`) off the invoker role of every service it was given. Google's
front end then answers every request `403` before an instance starts, so nothing is billed for them
but a few hundred bytes each, and the log exclusion drops Cloud Run's line for each. Every row,
file, setting, revision and secret is kept, the nightly backup still runs, and behind Cloudflare
the public site is still served by the Worker. The change takes a minute or two to apply.
`whatbuild: the kill switch acted` mails when it closes something, and when it cannot; Pub/Sub then
tries again.

**How.** The budget and the two alerts publish to the topic `whatbuild-kill-switch`, and a push
subscription calls the service of that name ([`deploy/cloud-run/kill-switch/`](../../deploy/cloud-run/kill-switch/kill-switch.mjs)).
It compares a budget's message with the budget's own amount, acts on an alert that opens, and
ignores anything else. It is private, reachable from inside the project only, and runs only while
a message is handled. Its identity may change who calls the services it closes (the role
`whatbuildKillSwitch`, two permissions) and nothing else: changing their ingress or their revision
would need the right to act as their runtime identity, which reads the database and the files.

```bash
PROJECT_ID=$P CAP=<amount> SERVICES=$P/$R/whatbuild[,<another project>/$R/whatbuild] deploy/cloud-run/kill-switch.sh  # create or update
gcloud pubsub topics publish whatbuild-kill-switch --project $P \
  --message '{"costAmount":0,"budgetAmount":1}'                             # under the cap: nothing closes
gcloud logging read 'resource.labels.service_name="whatbuild-kill-switch"' --project $P --freshness 1d --limit 20
```

`CAP` is a whole amount in the billing account's currency, and every project billed to the account
counts towards it, so `SERVICES` names every deployment billed there. A message over the cap, or a
test notification sent from the console to the kill switch's Pub/Sub channel, closes every service
named: send one only to close them.

**Opening again.** A budget's message comes several times a day and closes the services again while
the month's spending is over the cap, so first raise the cap (re-run with a higher `CAP`) or wait
for the next month, then:

```bash
gcloud run services add-iam-policy-binding whatbuild --project $P --region $R --member allUsers --role roles/run.invoker
```

Re-running `setup.sh` opens the service too (`--allow-unauthenticated`); a release's build does not.
The kill switch does not reach Cloudflare: the requests the Worker passes on while the service is
closed are still billed on Workers Paid, and the zone's rate limit is what bounds them.

## What is where

| Thing | Name | Notes |
|---|---|---|
| Service | `whatbuild` | public; WhatBuild's own sign-in guards everything but the web app's static files, sign-in, OAuth discovery, `/api/v1/meta`, `/health`, the skill and its installers, and the public site with its interest form |
| Migration job | `whatbuild-migrate` | same image, `node main.js migrate` |
| Runtime identity | `whatbuild-runtime` | the bucket, the secrets, Cloud SQL client — nothing else |
| Build identity | the project's default compute identity, or `BUILD_SA` | deploy to Cloud Run, push images, write logs, read `<project>_cloudbuild`; `setup.sh` takes away the Editor role Google gives it |
| Database | Cloud SQL instance `whatbuild-db`, database and user `whatbuild` (with `CLOUD_SQL=1`) | or the Postgres named by `DATABASE_URL` |
| Bucket | `<project>-whatbuild-files` | private, uniform access, public access prevented; versioned, noncurrent versions deleted after 30 days |
| Secrets | `whatbuild-database-url`, `whatbuild-grant-key`, optional `whatbuild-smtp-url` ([Mail](mail.md)), `whatbuild-google-client-secret`, `whatbuild-edge-key` (behind Cloudflare; also the Worker's `EDGE_KEY`) | read by the runtime identity only |
| Images | Artifact Registry `whatbuild` | the ten most recent always kept; others deleted after 30 days |
| Log exclusions | `whatbuild-request-addresses` and `whatbuild-refused-requests` on the `_Default` sink | Cloud Run logs every request itself, with its whole address, the client's IP and its browser, for 30 days. The first drops its line for an address with a query (a search's words, a sign-in link's token) or an invitation link; the service's own line for it, masked, stays. The second drops its line for a `403` or a `429`: a request without the edge key, refused before the service logs anything, or one Cloud Run refused for want of an instance, so a flood of them writes no logs to pay for. The request metrics count them all, and the service's own line stays for each `403` it gives |
| Restore points (Neon, optional) | branches `pre-migrate-<time>-<commit>`, secret `whatbuild-neon-api-key` | one per deploy before migrating, the newest three kept; the key reaches only the Neon project and is read by the build identity |
| Alerts | seven policies named `whatbuild: …` (ten with the kill switch), one email channel, and with the kill switch a Pub/Sub channel to its topic | made by `deploy/cloud-run/alerts.mjs` ([Alerts](#alerts)) |
| Kill switch (optional) | service, identity, Pub/Sub topic and push subscription `whatbuild-kill-switch`; role `whatbuildKillSwitch` in each project whose service it closes; budget `WhatBuild: every project` on the billing account | made by `deploy/cloud-run/kill-switch.sh`; the service is private and reachable from inside the project only, and its identity may change who calls the services it closes, nothing else ([A hard limit on the bill](#a-hard-limit-on-the-bill)) |
| Traces | a project of their own (`TRACES_PROJECT`): trace storage `_Trace` in `us`, BigQuery dataset `whatbuild_traces` | runs nothing; the runtime identity has Cloud Telemetry Traces Writer there, and nothing else ([Traces](#traces)) |
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
