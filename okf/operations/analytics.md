---
type: System Concept
title: Analytics in production - Google Analytics behind the cookie choice, Cloudflare Web Analytics on the site
description: What is measured on the public site and the app, where every setting lives, how to deploy the Worker with them, how an agent reaches the Google Analytics APIs and reads reports, and the stream settings to keep.
tags: [operations, analytics, google-analytics, cloudflare, privacy]
generated: {by: agent:claude, at: 2026-10-01}
status: stable
---

# Analytics in production

Two questions are measured: who comes to the public site (how many, from where, and how many ask
to hear when WhatBuild opens), and how the app is used (which screens and actions, and whether
people come back). The rules are in [§9.1](../spec/09-data-lifecycle.md) and the
[decision](../decisions/analytics-only-for-people-who-accept-cookies.md); the code is
`apps/web/src/lib/analytics.ts`.

| Tool | Where | Who it sees | What it shows |
|---|---|---|---|
| Google Analytics 4, one web stream | the site and the app | only people who press Accept | sources, countries, devices, returning people, masked screens, named actions, `generate_lead` |
| Cloudflare Web Analytics | the site's page only | every visit (no cookie, no consent needed) | visits, page views, referrers, countries, devices |

## Where the settings live

The maintainer keeps the deployment's values in `.env` at the root of their clone (gitignored).
Read it before asking the maintainer for anything:

| `.env` name | What it is | Where it is used |
|---|---|---|
| `GA_MEASUREMENT_ID` | the stream's `G-…` ID | Cloud Run `WHATBUILD_ANALYTICS_ID`; Worker `ANALYTICS_ID` |
| `GA_PROPERTY`, `GA_STREAM` | the property and stream resource names | the Admin and Data APIs |
| `GA_SERVICE_ACCOUNT` | the identity an agent uses for those APIs | below |
| `CF_ANALYTICS_TOKEN` | the Web Analytics site token (public in the page) | Worker `CF_ANALYTICS_TOKEN` |
| `WORKER_ORIGIN`, `WORKER_SITE_HOST`, `WORKER_APP_URL` | the Worker's other settings | `wrangler deploy` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Workers deploys and zone settings | `wrangler` |
| `GCP_PROJECT`, `GCP_REGION` | the Google Cloud project and region | `gcloud` |

Production secrets (database URL, grant key, Google sign-in secret) are in Secret Manager, not in
`.env`; `.env` names them.

The service keeps `WHATBUILD_ANALYTICS_ID` across deploys (Cloud Build only updates
`WHATBUILD_RELEASE`). The Worker keeps nothing between deploys: every `wrangler deploy` passes all
its settings, from the web app built at the same commit:

```bash
set -a; . ./.env; set +a
corepack pnpm --filter @whatbuild/web build
npx wrangler deploy --config deploy/cloudflare/wrangler.toml \
  --var ORIGIN:$WORKER_ORIGIN --var SITE_HOST:$WORKER_SITE_HOST --var APP_URL:$WORKER_APP_URL \
  --var ANALYTICS_ID:$GA_MEASUREMENT_ID --var CF_ANALYTICS_TOKEN:$CF_ANALYTICS_TOKEN
```

Leaving out `ANALYTICS_ID` or `CF_ANALYTICS_TOKEN` turns that tool off on the site.

## Reaching Google Analytics as an agent

Google blocks the analytics scopes for gcloud's own sign-in client, so an agent impersonates a
service account instead. Set up once: a service account in the Google Cloud project, the
maintainer given Service Account Token Creator on it, the IAM Credentials, Analytics Admin and
Analytics Data APIs enabled in the project, and the service account added as **Editor** under the
property's access management in Google Analytics. Then, with the maintainer's gcloud sign-in:

```bash
set -a; . ./.env; set +a
ga_token() {  # $1: analytics.readonly or analytics.edit
  curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${GA_SERVICE_ACCOUNT}:generateAccessToken" \
    -d "{\"scope\":[\"https://www.googleapis.com/auth/$1\"]}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])'
}
```

Write `${GA_SERVICE_ACCOUNT}:` with braces: in zsh, `$GA_SERVICE_ACCOUNT:g…` is read as a
modifier. A report, for example visitors and page views by host over the last week:

```bash
curl -s -X POST -H "Authorization: Bearer $(ga_token analytics.readonly)" -H "Content-Type: application/json" \
  "https://analyticsdata.googleapis.com/v1beta/${GA_PROPERTY}:runReport" \
  -d '{"dateRanges":[{"startDate":"7daysAgo","endDate":"today"}],"dimensions":[{"name":"hostName"}],"metrics":[{"name":"activeUsers"},{"name":"screenPageViews"}]}'
```

Useful dimensions: `hostName` (site or app), `sessionSource` and `sessionMedium` (where people
came from), `country`, `deviceCategory`, `pagePath` (masked screens), `eventName` (named actions
such as `assumptions_create`, and `generate_lead`), `newVsReturning`. New data takes up to a day to
appear in reports; `…:runRealtimeReport` shows the last 30 minutes.

## Stream and property settings to keep

Set through the Admin API (`ga_token analytics.edit`) or the Google Analytics admin screens:

- **Enhanced measurement** (`v1alpha/${GA_STREAM}/enhancedMeasurementSettings`): page changes,
  outbound clicks, file downloads and form interactions **off**. The app sends page views itself
  with names and ids masked; the others would send real addresses, source links or file names.
  Scrolls and site search may stay on.
- **Key event:** `generate_lead` (a request to hear from us on the site).
- **Data retention:** event data 14 months.
- **Google signals:** off.

Check them after anyone edits the stream in the Google Analytics screens.

## Cloudflare Web Analytics

The site is registered in the Cloudflare dashboard under the account's **Analytics & logs → Web
analytics** (not under the zone), with **manual JS snippet** installation, so the Worker adds the
beacon itself and nothing is counted twice; read the numbers there. The token in `.env` cannot
create or read Web Analytics sites; that needs an account token with Account Analytics
permission, or the dashboard.

## After a deploy

```bash
curl -s https://<app host>/auth/methods                 # analytics_id is the G- ID
curl -s https://<site host>/ | grep -c 'whatbuild-analytics\|cloudflareinsights'   # 2
curl -sI https://<site host>/ | grep -i content-security   # Google's and Cloudflare's hosts allowed
```

In a browser, before choosing: the notice shows, Cloudflare's beacon loads, Google's script does
not.

## Counting a new action

An action is named from the words in `NOUNS` and `VERBS` in `apps/web/src/lib/analytics.ts`; a
route word missing from them is dropped, never sent. Add a new route's words there, with a case in
`apps/web/test/analytics.test.ts`.
