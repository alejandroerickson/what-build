---
type: Decision
title: The public site is pages built with the app, served from Cloudflare's edge or by host from the image
description: what-build.com is pages in the web app's build, one recording requests to hear when WhatBuild opens, one comparing the plans and the privacy page; behind Cloudflare the Worker serves them so visitors never wake the service, and the image can serve them by Host for any other front.
tags: [decision, deployment, web, site]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# The public site is pages built with the app, served from Cloudflare's edge or by host from the image

## Context

WhatBuild needs a public face at its own domain while the app is invite-only at a subdomain
(`app.what-build.com`). The maintainer asked on 2026-09-29 for a welcome page with a coming-soon
form whose requests are kept somewhere readable without email. On 2026-10-01 they chose Cloudflare
in front of the service instead of a Google load balancer, and to serve the page from Cloudflare: the service keeps its CPU while an
instance is alive, so crawlers visiting the page every few minutes would keep one running.

## Decision

- The pages are Vite entries of their own (`apps/web/site/index.html`, `site/plans/index.html`
  for `/plans` and `site/privacy/index.html` for `/privacy`, both added on 2026-10-26, the second
  [by decision](the-privacy-page-is-a-page-of-the-public-site.md)) on the Studio tokens and primitives, with none of the app's
  routing, session or data, built with the app. The front page reuses the overview's intro, its
  copy and its display type, the one place above the 20px ceiling
  ([decision](the-overview-is-the-front-door.md)). The plans page shows the plans from the build
  (`@whatbuild/core/plans`), so it asks the service nothing.
- What only the deployment knows is written into a page by whoever serves it: the Google Analytics
  ID (`whatbuild-analytics`), and the plans, whether guests may sign up and what the privacy page
  names (`whatbuild-site`, the service's `GET /api/v1/plans`). The Worker asks the service for the second through Cloudflare's
  cache, so a visit wakes the service at most once an hour; without an answer, a page shows the
  plans as the build has them.
- **Behind Cloudflare**, the Worker (`deploy/cloudflare/worker.js`) serves the pages and their files
  from the build it was deployed with, redirects `www.` to the site (301) and every other path to
  the app (302), and passes only `POST /api/v1/interest` to the service.
- **Behind any other front**, the image does the same by Host: `WHATBUILD_SITE_URL` names the site,
  read from the Host header or from `X-Forwarded-Host`. On the app's origin, set or not, the pages
  are at `/site/`, `/site/plans/` and `/site/privacy/`, with the same facts written in.
- Requests to hear from us go to the `interest` table: one row per address, repeats update it, a
  hidden field drops bots, and 200 new rows an hour is the flood limit. Like feedback, nothing
  reads it back over HTTP; operators query it. It is not an operation: it is not for agents and
  belongs to no tenant.
- Rejected: Firebase Hosting or a bucket for the site, which would put a third system in front of
  the form, and in front of the app would strip its sign-in cookies.

## Consequences

- Visitors and crawlers on the site cost nothing but, at most once an hour, the question about the
  plans; a submitted form wakes the service.
- Behind Cloudflare, a change to the page reaches visitors when the Worker is deployed again, not
  when the image is.
- Nobody is emailed when someone signs up: nothing sends that mail, even where mail is set up
  ([Mail](../operations/mail.md)).

## Constrains

- The site's paths are listed twice and must agree: `SITE_PAGES`, `SITE_FILES` and the interest
  route in `deploy/cloudflare/worker.js`, and `SITE_PATHS` in `apps/server/src/site.ts`. So are its
  headers (`PAGE_HEADERS`, and `PAGE_SECURITY_HEADERS` in `apps/server/src/public-routes.ts` with
  `RESPONSE_HEADERS` in `apps/server/src/app.ts`, which `response-headers.test.ts` compares).
- The pages are `apps/web/src/site/`, styled in `apps/web/src/styles/screens/site.css`; the plans
  table is the app's own (`apps/web/src/routes/plan-comparison.tsx`).

Specified in: [02-architecture §2.3](../spec/02-architecture.md), [04-data-model §4.13](../spec/04-data-model.md),
[07-web-app §7.3](../spec/07-web-app.md), [Cloud Run guide](../operations/cloud-run.md).
