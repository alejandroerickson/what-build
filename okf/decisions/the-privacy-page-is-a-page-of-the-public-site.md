---
type: Decision
title: The privacy page is a page of the public site, which the app opens in a new tab
description: The privacy notice is served with the public site (from Cloudflare's edge, behind the Worker), not as a screen of the app; the app links to it by the address the deployment gives, in a new tab.
tags: [decision, privacy, web, site, deployment]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# The privacy page is a page of the public site, which the app opens in a new tab

## Context

The privacy notice was a screen of the web app at `/privacy` on the app's domain, and the public
site's footer sent visitors there, out of the site and into the app. A notice is for anyone,
before they have an account, and has no use for the app's session, routing or data. The maintainer
chose on 2026-10-26 to serve it with the public site, from Cloudflare where the site is served
from there, and to keep no privacy screen in the app. This replaces the part of
[the short-notice decision](the-privacy-page-is-a-short-notice-written-to-stay-true.md) that kept
the page in the app; what the page says is unchanged.

## Decision

- The privacy page is a page of the public site (`apps/web/site/privacy/index.html`,
  `apps/web/src/site/SitePrivacyPage.tsx`), at `/privacy` on the site's domain, served like the
  site's other pages ([decision](the-public-site-is-pages-built-with-the-app.md)): by the Worker
  from its own build, or by the image on the site's host.
- What only the deployment knows (who runs it, where to write, who else handles the data, whether
  it has analytics) is written into the page by whoever serves it, as `privacy` in the answer of
  `GET /api/v1/plans`, which the Worker keeps in Cloudflare's cache. Without it the page says it
  did not load, rather than name nobody.
- The app has no privacy screen, and nothing at `/privacy` on the app's domain. Its links go to
  `privacy_url` from `GET /api/v1/meta`: the site's `/privacy`, or `/site/privacy/` on the app's
  origin for a deployment without a site, where the image serves the site's pages. Each opens it in
  a new tab, leaving the app where it was.
- Rejected: redirecting `/privacy` on the app's domain to the site's page. It would keep old links
  working, but no mail or published link names that address, and a redirect there would loop
  between an old Worker and a new image while a release goes out.
- Rejected: copying the page into both the app and the site, which would be two notices to keep
  true.

## Consequences

- Behind Cloudflare, reading the notice wakes nothing: it costs at most the hourly question the
  Worker asks the service. A change to its text reaches visitors when the Worker is deployed again.
- Until the Worker is deployed with a release that has the page, the site's `/privacy` goes to the
  app, which has nothing there: deploy the Worker right after the image, as every release already
  does.
- A self-hosted deployment without a site still has the page, at `/site/privacy/`.

## Constrains

- `SITE_PAGES` in `deploy/cloudflare/worker.js` and `SITE_PAGES` and `SITE_PATHS` in
  `apps/server/src/site.ts` list `/privacy`; `privacyUrl` in `apps/server/src/public-routes.ts`
  says where it is.
- The app links to the privacy page only through `PrivacyLink` (`apps/web/src/shell/privacy-link.tsx`),
  never with a router link or a fixed path.

Specified in: [09-data-lifecycle §9.1](../spec/09-data-lifecycle.md), [07-web-app §7.3](../spec/07-web-app.md).
