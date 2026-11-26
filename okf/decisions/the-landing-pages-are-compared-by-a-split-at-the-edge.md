---
type: Decision
title: The two landing pages are compared by a split at the edge, with no cookie
description: The Worker sends a share of the front page's visitors to /what-to-build/, placed by their hashed address and never a crawler; each page's button presses are counted naming nobody, and a request to hear from us or a new account keeps the page (and button) it came from.
tags: [decision, site, analytics, privacy]
generated: {by: agent:claude, at: 2026-11-25}
status: stable
---

# The two landing pages are compared by a split at the edge, with no cookie

## Context

The site has two landing pages that say the same thing in different pictures
([decision](the-site-opens-on-landing-pages-the-scroll-tells.md)). The maintainer chose on
2026-11-23 to A/B test them, and on 2026-11-25 to follow each page through to people coming back,
so that a page that turns people away can be removed. The site is served from Cloudflare's edge so visits never wake the
service ([decision](the-public-site-is-pages-built-with-the-app.md)), and Google Analytics counts
only people who accept cookies ([decision](analytics-only-for-people-who-accept-cookies.md)).

## Decision

- The Worker sends a share of the visitors to `/` to `/what-to-build/` (302, `no-store`), set by
  `LANDING_SPLIT` from 0 to 1; unset or 0, nobody. A visitor is placed by a hash of their address,
  computed in the Worker and kept nowhere, so the same visitor sees the same page with no cookie.
  Crawlers and link previews always get `/`, and so does `/?split=off`, so whoever runs the test
  can see both pages from an address the split sends to the second (added 2026-11-23). A person
  reading in an app's own browser, LinkedIn's among them, is split like anyone else.
- The two pages keep their own addresses, so Cloudflare Web Analytics counts each page's visits,
  every visitor included.
- Each page says which it is wherever it leads: the form sends `page` (`interest.page` keeps the
  first), and its links to sign in carry `?landing=` and `&button=` (`explore` or `start`), which
  the app sends once a new account is in (`accounts.came_from`, `came_via`). The plans page's
  links carry `?landing=/plans/`, so the accounts it makes are kept apart from both pages' and
  count for neither; no press is counted there (added 2026-11-25).
- Each press of a page's buttons is counted on the server, one more for its UTC day, page and
  button (`landing_presses`, `POST /api/v1/pressed`), with no cookie and naming nobody, so the
  step from a visit to acting is seen for every visitor (added 2026-11-25). An account keeps when
  it first came back, its first call to an operation on a later UTC day than the one it was made
  (`accounts.returned_at`). The three are cleared when the account is deleted.
- The comparison is the funnel, step by step for each page: visits, presses, accounts, then
  organizations started, agents connected and people back within a week
  ([analytics](../operations/analytics.md#the-landing-page-funnel)). Each deployment decides
  what difference removes a page.
- Rejected: a cookie that keeps the variant, which would need the visitor's consent; a fresh draw
  on each visit, which shows one person both pages; counting in Google Analytics alone, which sees
  only those who accept cookies; following returns through the server's pseudonymous counts, which
  are never joined to accounts.

## Consequences

- Stopping the test is deploying the Worker without `LANDING_SPLIT` (everyone gets `/`) or with it
  at 1 (everyone gets `/what-to-build/`). Removing a page follows in a later release, a change to
  `SITE_PAGES`.
- A press wakes the service, as a link to sign in does; scrolling a page still asks it nothing.
- A visitor whose address changes, as on a phone network, may be placed again.
- Behind any other front the image serves `/` to everyone: the split is the Worker's.

## Constrains

- `toSecondLanding` and `SITE_API` in `deploy/cloudflare/worker.js`; `page` and `/api/v1/pressed`
  in `apps/server/src/site.ts`; `0053_where_people_came_from.sql` and `0054_the_landing_funnel.sql`;
  `came-from` in `apps/server/src/auth/routes.ts`; `pressed` in `apps/web/src/site/landing/Landing.tsx`;
  `signInTo` in `apps/web/src/site/SitePage.tsx`;
  `packages/core/src/first-return.ts`.

Specified in: [07-web-app §7.3](../spec/07-web-app.md#73-routes), [04-data-model §4.13](../spec/04-data-model.md), [09-data-lifecycle §9.1](../spec/09-data-lifecycle.md).
