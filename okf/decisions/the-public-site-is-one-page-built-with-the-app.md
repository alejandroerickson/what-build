---
type: Decision
title: The public site is one page built with the app, served from Cloudflare's edge or by host from the image
description: what-build.com is a page in the web app's build that records requests to hear when WhatBuild opens; behind Cloudflare the Worker serves it so visitors never wake the service, and the image can serve it by Host for any other front.
tags: [decision, deployment, web, site]
generated: {by: agent:claude, at: 2026-10-11}
status: stable
---

# The public site is one page built with the app, served from Cloudflare's edge or by host from the image

## Context

WhatBuild needs a public face at its own domain while the app is invite-only at a subdomain
(`app.what-build.com`). The maintainer asked for a welcome page with a coming-soon form on
2026-09-29, before any business mailbox exists, so requests have to be kept somewhere readable
without email. On 2026-10-01 they chose Cloudflare's free plan in front of the service instead of a
Google load balancer, and to serve the page from Cloudflare: the service keeps its CPU while an
instance is alive, so crawlers visiting the page every few minutes would keep one running.

## Decision

- The page is a second Vite entry (`apps/web/site/index.html`) on the Studio tokens and primitives,
  with none of the app's routing, session or data, built with the app. It reuses the overview's
  intro, its copy and its display type, the one place above the 20px ceiling
  ([decision](the-overview-is-the-front-door.md)).
- **Behind Cloudflare**, the Worker (`deploy/cloudflare/worker.js`) serves the page and its files
  from the build it was deployed with, redirects `www.` to the site (301) and every other path to
  the app (302), and passes only `POST /api/v1/interest` to the service.
- **Behind any other front**, the image does the same by Host: `WHATBUILD_SITE_URL` names the site,
  read from the Host header or from `X-Forwarded-Host`. Unset, the page is still at `/site/`.
- Requests to hear from us go to the `interest` table: one row per address, repeats update it, a
  hidden field drops bots, and 200 new rows an hour is the flood limit. Like feedback, nothing
  reads it back over HTTP; operators query it. It is not an operation: it is not for agents and
  belongs to no tenant.
- Rejected: Firebase Hosting or a bucket for the site, which would put a third system in front of
  the form, and in front of the app would strip its sign-in cookies.

## Consequences

- Visitors and crawlers on the site cost nothing; only a submitted form wakes the service.
- Behind Cloudflare, a change to the page reaches visitors when the Worker is deployed again, not
  when the image is.
- Nobody is emailed when someone signs up: nothing sends that mail, even where mail is set up
  ([Mail](../operations/mail.md)).

## Constrains

- The site's paths are listed twice and must agree: `SITE_FILES` and the interest route in
  `deploy/cloudflare/worker.js`, and `SITE_PATHS` in `apps/server/src/site.ts`. So are its
  headers (`PAGE_HEADERS`, and `PAGE_SECURITY_HEADERS` in `apps/server/src/public-routes.ts` with
  `RESPONSE_HEADERS` in `apps/server/src/app.ts`, which `response-headers.test.ts` compares).
- The page is `apps/web/src/site/`, styled in `apps/web/src/styles/screens/site.css`.

Specified in: [02-architecture §2.3](../spec/02-architecture.md), [04-data-model §4.13](../spec/04-data-model.md),
[07-web-app §7.3](../spec/07-web-app.md), [Cloud Run guide](../operations/cloud-run.md).
