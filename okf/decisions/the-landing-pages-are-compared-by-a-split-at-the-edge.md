---
type: Decision
title: The two landing pages are compared by a split at the edge, with no cookie
description: The Worker sends a share of the front page's visitors to /what-to-build/, placed by their hashed address and never a crawler, and each request to hear from us records the page it came from.
tags: [decision, site, analytics, privacy]
generated: {by: agent:claude, at: 2026-11-23}
status: stable
---

# The two landing pages are compared by a split at the edge, with no cookie

## Context

The site has two landing pages that say the same thing in different pictures
([decision](the-site-opens-on-landing-pages-the-scroll-tells.md)). The maintainer chose on
2026-11-23 to A/B test them. The site is served from Cloudflare's edge so visits never wake the
service ([decision](the-public-site-is-pages-built-with-the-app.md)), and Google Analytics counts
only people who accept cookies ([decision](analytics-only-for-people-who-accept-cookies.md)).

## Decision

- The Worker sends a share of the visitors to `/` to `/what-to-build/` (302, `no-store`), set by
  `LANDING_SPLIT` from 0 to 1; unset or 0, nobody. A visitor is placed by a hash of their address,
  computed in the Worker and kept nowhere, so the same visitor sees the same page with no cookie.
  Crawlers and link previews always get `/`.
- The two pages keep their own addresses, so Cloudflare Web Analytics counts each page's visits,
  every visitor included.
- Each page says which it is wherever it leads: the form sends `page` (`interest.page` keeps the
  first), and its links to sign in carry `?landing=`, which the app sends once a new account is in
  (`accounts.came_from`). Accounts made over visits, per page, is the comparison; organizations
  started and organizations with a first source check that one page's people stay.
- Rejected: a cookie that keeps the variant, which would need the visitor's consent; a fresh draw
  on each visit, which shows one person both pages; counting in Google Analytics alone, which sees
  only those who accept cookies.

## Consequences

- Stopping the test is deploying the Worker without `LANDING_SPLIT`. Keeping the other page is a
  change to `SITE_PAGES`.
- A visitor whose address changes, as on a phone network, may be placed again.
- Behind any other front the image serves `/` to everyone: the split is the Worker's.

## Constrains

- `toSecondLanding` in `deploy/cloudflare/worker.js`; `page` in `apps/server/src/site.ts` and
  `apps/server/src/migrations/0053_where_people_came_from.sql`; `came-from` in `apps/server/src/auth/routes.ts`.

Specified in: [07-web-app §7.3](../spec/07-web-app.md#73-routes), [04-data-model §4.13](../spec/04-data-model.md).
