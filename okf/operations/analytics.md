---
type: System Concept
title: Analytics in production - the server's own counts, Google Analytics behind the cookie choice, Cloudflare Web Analytics on the site
description: What each source measures and for whom, where every setting lives, how an agent reads them all (pnpm usage, products.usage), how a deployment connects its own analytics, the Google Analytics settings to keep, and how a person's counted days are found and removed.
tags: [operations, analytics, usage, google-analytics, cloudflare, privacy]
generated: {by: agent:claude, at: 2026-10-31}
status: stable
---

# Analytics in production

Three questions are measured: who comes to the public site (how many, from where, and how many ask
to hear when WhatBuild opens); how the app is used (which features, through the web app and through
agents); and whether people come back. The rules are in [§9.1](../spec/09-data-lifecycle.md) and
two decisions: [the server's counts](../decisions/the-server-counts-how-whatbuild-is-used-naming-nobody.md)
and [Google Analytics behind the cookie choice](../decisions/analytics-only-for-people-who-accept-cookies.md).
An agent reads all three with the `read-usage` skill.

| Source | Where | Who it sees | What it shows |
|---|---|---|---|
| The server's counts (`packages/core/src/usage.ts`) | every call to an operation, web app and agents | everyone signed in except the instance's owners, with no cookie | calls by operation, door, agent client and outcome; people by feature, new and returning, weekly cohorts |
| Google Analytics 4, one web stream (`apps/web/src/lib/analytics.ts`) | the site and the app | only people who press Accept, never the instance's owners | sources, countries, devices, returning visitors, masked screens, changes named by operation, search use, `generate_lead` |
| Cloudflare Web Analytics | the site's page only | every visit (no cookie, no consent needed) | visits, page views, referrers, countries, devices |

The server's counts are the only source that sees agents, which make most calls, and people who
decline cookies. Compare features by people rather than calls: the web app makes reads of its own
on every screen, and its search box searches as a person types.

## Reading it all

```bash
corepack pnpm usage                 # the last 28 days; --days N, --example exclude|only, --include-owners, --json
```

`apps/server/src/usage-report.ts` reads its settings from the environment, then from `.env` at the
root of the checkout (or the main checkout's, from a git worktree), and prints each source, or why it
skipped one:

| Setting | For | Without it |
|---|---|---|
| `WHATBUILD_USAGE_DATABASE_URL`, or `GCP_PROJECT` | the server's counts: the URL of any role that reads the database; with `GCP_PROJECT`, the Cloud Run deployment's read-only backup role (`whatbuild-backup-database-url`) | skipped |
| `GA_PROPERTY` with `GA_SERVICE_ACCOUNT` or `GA_ACCESS_TOKEN` | Google Analytics' Data API | skipped |
| `CF_ANALYTICS_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; `CF_ANALYTICS_SITE_TAG` when the account has more than one site with visits | Cloudflare's GraphQL API, up to 31 days; it samples page loads, so small counts come in steps | skipped |

No agent reads them over MCP: running the instance is done outside the tools agents are offered
([decision](../decisions/running-the-instance-is-done-in-the-web-app-never-by-an-agent.md)), and a
call to `products_read(action="usage")` is refused `403 web_only`, pointing at this report. An
instance owner signed in to the web app may also read them with `GET /api/v1/usage`, which takes
`days` (1–400), `include_owners` and `example`.

## The server's counts

Every call that reaches `execute` (`packages/core/src/execute.ts`), from either door, is counted
when it ends: the operation, the door (`web` or `mcp`), the agent client's family (from the name it
registered with: Claude, Claude Code, Cursor, … or `other`), whether it is in the example
organization (before migration `0034`, the public sandbox), whether the caller is an instance owner, and `ok` or the error's code. An MCP call refused before
it reaches `execute` is counted too: under its operation when the tool and action exist (a product
that cannot be found, say), as `<tool>.(unknown)` for an action that does not, and as
`(unknown tool)` for a tool that does not. Counts are added up in memory and written every ten
seconds, or every 500 rows, and before the server stops; a crash loses at most those.

Not counted: seeding and the server's own work; `describe` lookups over MCP; REST requests refused
before an operation runs (signed out, a body that is not JSON, a write from another origin); and the
routes that serve bytes (attachments, a source's text for the app, exports, Story and mockup
pages' HTML, uploads), whose operations (the download grant, reading the Story) are counted.

- `usage_calls` holds the counts per UTC day. It names nobody and is kept.
- `usage_people` holds one row for each day a person used a part of WhatBuild (an MCP tool's name)
  through a door and client. The person is `personOf(key, account_id)`: an HMAC-SHA-256 keyed by
  `usageKey`, which `createPorts` derives from `WHATBUILD_GRANT_KEY`, so a deployment sets nothing
  new, and its pseudonyms mean nothing elsewhere. The worker deletes rows older than 14 months.
  Rotating the grant key starts everyone's pseudonym afresh, so for a while everyone shows as new.

The report (`usageReport`) gives the period's calls, people (active, through the web app and
agents, new, returning, how many days each was active, each week's active and new people, and each
week's newcomers followed through the weeks after), features, operations, agent clients, failures
by code, and every operation nobody called. `counting_since` is the first day counted; everyone
seen before that day shows as new.

**When someone asks to be removed.** Removing their account (People, for an instance owner) leaves
their counted days, which name nobody. To remove those too, compute their pseudonym with the
deployment's grant key and delete those rows:

```bash
node -e 'const c=require("node:crypto"); const k=c.createHmac("sha256", process.argv[1]).update("whatbuild usage people").digest("base64url");
  console.log(c.createHmac("sha256", k).update(process.argv[2]).digest("base64url").slice(0, 22))' "$GRANT_KEY" "<account_id>"
# then, as the app's role: delete from usage_people where person = '<that pseudonym>';
```

## Where the settings live

The maintainer keeps the deployment's values in `.env` at the root of their clone (gitignored).
Read it before asking the maintainer for anything:

| `.env` name | What it is | Where it is used |
|---|---|---|
| `GA_MEASUREMENT_ID` | the stream's `G-…` ID | Cloud Run `WHATBUILD_ANALYTICS_ID`; Worker `ANALYTICS_ID` |
| `GA_PROPERTY`, `GA_STREAM` | the property and stream resource names | the Admin and Data APIs, `pnpm usage` |
| `GA_SERVICE_ACCOUNT` | the identity an agent uses for those APIs | below |
| `CF_ANALYTICS_TOKEN` | the Web Analytics site token (public in the page; not the site's tag) | Worker `CF_ANALYTICS_TOKEN` |
| `CF_ANALYTICS_API_TOKEN` (optional) | an account token with **Account Analytics: Read**, for reading Web Analytics | `pnpm usage` |
| `WORKER_ORIGIN`, `WORKER_SITE_HOST`, `WORKER_APP_URL` | the Worker's other settings | `wrangler deploy` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Workers deploys and zone settings | `wrangler` |
| `GCP_PROJECT`, `GCP_REGION` | the Google Cloud project and region | `gcloud`, `pnpm usage` |

Production secrets (database URL, grant key, Google sign-in secret) are in Secret Manager, not in
`.env`; `.env` names them.

The service keeps `WHATBUILD_ANALYTICS_ID` across deploys (Cloud Build only updates
`WHATBUILD_RELEASE`). The Worker keeps only its secret, `EDGE_KEY`, between deploys
([Cloud Run](cloud-run.md)): every `wrangler deploy` passes all its other settings, from the web app
built at the same commit:

```bash
set -a; . ./.env; set +a
corepack pnpm --filter @whatbuild/web build
npx wrangler deploy --config deploy/cloudflare/wrangler.toml \
  --var ORIGIN:$WORKER_ORIGIN --var SITE_HOST:$WORKER_SITE_HOST --var APP_URL:$WORKER_APP_URL \
  --var ANALYTICS_ID:$GA_MEASUREMENT_ID --var CF_ANALYTICS_TOKEN:$CF_ANALYTICS_TOKEN
```

Leaving out `ANALYTICS_ID` or `CF_ANALYTICS_TOKEN` turns that tool off on the site.

## Connecting another deployment

A deployment counts its own use from the release that adds the counts, with nothing to set. Google
Analytics and Cloudflare are its own choice, in its own accounts:

1. **Google Analytics.** Create a GA4 property with one web stream for the site and the app, set its
   ID as `WHATBUILD_ANALYTICS_ID` on the service (and `ANALYTICS_ID` on a Worker in front of the
   site, if there is one), and apply the settings below. Name the instance's owners in
   `WHATBUILD_INSTANCE_OWNERS`, so their use is left out.
2. **Reading it as an agent.** Set up the service account below, or hand `pnpm usage` a token in
   `GA_ACCESS_TOKEN`.
3. **Cloudflare Web Analytics**, if the site is served through Cloudflare: register the site with
   manual installation, pass its token to the Worker, and make an account token with Account
   Analytics: Read for `CF_ANALYTICS_API_TOKEN`.

Keep the values in that deployment's own `.env` or vault, never in the repository.

## Reaching Google Analytics as an agent

Google blocks the analytics scopes for gcloud's own sign-in client, so an agent impersonates a
service account instead. Set up once: a service account in the Google Cloud project, the
maintainer given Service Account Token Creator on it, the IAM Credentials, Analytics Admin and
Analytics Data APIs enabled in the project, and the service account added as **Editor** under the
property's access management in Google Analytics. `pnpm usage` does this itself; by hand, with the
maintainer's gcloud sign-in:

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
came from), `country`, `deviceCategory`, `pagePath` (masked screens), `eventName`, `newVsReturning`,
`isoYearIsoWeek`, and the search parameters as `customEvent:kind`, `customEvent:from`,
`customEvent:via`, `customEvent:found` and `customEvent:rank`. New data takes up to a day to appear
in reports; `…:runRealtimeReport` shows the last 30 minutes.

## What the app sends

- **Page views:** the masked path (`/t/:org/:team/:product/story/:id`) and a fixed title, once a
  screen has stayed 0.7 seconds, so an old address that only redirects is not counted. The masked
  address is set before Google's first event and again the moment the screen changes, so no event
  carries the real one.
- **Changes:** each change the app makes is an event named by the operation the server ran, which
  every REST answer names in `X-WhatBuild-Operation`: `assumptions.review` is `assumptions_review`.
  A few changes are not operations and have names of their own: the interest form is
  `generate_lead`, asking for a sign-in link `sign_in_link`, signing out `sign_out`, accepting an
  invitation `invitation_accept`, declining one `invitation_decline`, changing one's name `profile_update`, and disconnecting an agent
  `agent_disconnect`. Any other change that is not an operation is not sent. These are not in the
  server's counts, which count operations.
- **Search,** never its words: `search_open` (`via`: `field` or `shortcut`), `search_result_open`
  (`kind`: the result's kind, `source`, `assumption`, `outcome`, `mockup`, `story` or `idea`, or,
  for a place in a source that was followed, the field it is in, `text`, `summary`, `notes` or
  `comment`; `rank`; `from`: `palette` or `screen`), `search_all_results`, `search_recent_use`, and `search_close` when the
  search box closes without a result followed (`found`: `yes`, `no`, `waiting` for an answer, or
  `not_typed`).
- **Never measured:** the instance's owners, and any address but the deployment's own (Cloud Run's
  run.app address, for one): `GET /auth/methods` gives them no `analytics_id`.

## Stream and property settings to keep

Set through the Admin API (`ga_token analytics.edit`) or the Google Analytics admin screens:

- **Enhanced measurement** (`v1alpha/${GA_STREAM}/enhancedMeasurementSettings`): page changes,
  outbound clicks, file downloads, form interactions and site search **off**. The app sends page
  views itself with names and ids masked; the others would send real addresses, source links, file
  names or the words searched. Scrolls may stay on.
- **Custom dimensions,** event-scoped, for search: `kind`, `from`, `via`, `found`, `rank`
  (`v1beta/${GA_PROPERTY}/customDimensions`).
- **Key event:** `generate_lead` (a request to hear from us on the site).
- **Data retention:** event data 14 months.
- **Google signals:** off.
- **Data processing terms:** accepted under the account's settings.

Check them after anyone edits the stream in the Google Analytics screens.

## Cloudflare Web Analytics

The site is registered in the Cloudflare dashboard under the account's **Analytics & logs → Web
analytics** (not under the zone), with **manual JS snippet** installation, so the Worker adds the
beacon itself and nothing is counted twice. The token in `CLOUDFLARE_API_TOKEN` cannot read Web
Analytics; `pnpm usage` needs `CF_ANALYTICS_API_TOKEN`, an account token with Account Analytics:
Read and nothing else. Without it, read the numbers in the dashboard. That permission does not list
sites, so `pnpm usage` takes the site's tag from the visits themselves when the account has one site
with visits; with more, set `CF_ANALYTICS_SITE_TAG` (in the site's address in the dashboard).

## After a deploy

```bash
curl -s https://<app host>/auth/methods                 # analytics_id is the G- ID (null when signed in as an owner)
curl -s https://<site host>/ | grep -c 'whatbuild-analytics\|cloudflareinsights'   # 2
curl -sI https://<site host>/ | grep -i content-security   # Google's and Cloudflare's hosts allowed
corepack pnpm usage --days 1                            # the server's counts answer
```

In a browser, before choosing: the notice shows, Cloudflare's beacon loads, Google's script does
not.

## Counting something new

A new operation is counted on the server and named in Google Analytics with no change here. A new
screen word goes in `SCREEN_WORDS` in `apps/web/src/lib/analytics.ts`, or it is masked as `:id`; a
new kind of browser event goes in `SearchEvent` (or a type beside it) with fixed values only, a case
in `apps/web/test/analytics.test.ts`, and, if it has parameters, their custom dimensions above.
