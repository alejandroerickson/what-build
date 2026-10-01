---
type: Decision
title: WhatBuild asks once whether a person accepts cookies, and runs Google Analytics only for those who do
description: One Accept or Decline choice across the public site and the app; Google Analytics loads only after Accept and sees pages and actions, never names or content; the cookie page describes kinds of cookies without promises.
tags: [decision, privacy, cookies, analytics, web, compliance]
generated: {by: agent:claude, at: 2026-10-01}
status: stable
---

# WhatBuild asks once whether a person accepts cookies, and runs Google Analytics only for those who do

## Context

The maintainer wants two things measured: traffic to the public site (how many come, from where,
and how many ask to hear when it opens), and use of the app (which screens and actions people use,
and whether they come back), to judge and improve the product. Under the ePrivacy rules and the GDPR, analytics cookies need consent before they are
set, refusing must be as easy as accepting, and the service must not be withheld from someone who
refuses. The maintainer chose on 2026-10-01 to add Google Analytics behind a plain choice, and to
describe cookies without promises the product may outgrow. This replaces
[the earlier record](only-necessary-cookies-and-optional-ones-wait-for-consent.md), which kept
everything strictly necessary and offered no choice.

## Decision

- One GA4 measurement ID serves the public site and the app, so a visitor can be followed from one
  to the other. With it set (`WHATBUILD_ANALYTICS_ID` on the service, `ANALYTICS_ID` on the
  Cloudflare Worker), both show a notice until the person presses Accept or Decline, which carry
  equal weight. Everything works the same either way. Without it there is no notice.
- The choice is the `wb_cookies` cookie on the parent domain, so one answer covers both hosts.
  Google's script loads only after Accept; declining later (`/cookies`, or Cookies in the site's
  footer) stops it and removes its cookies. Advertising signals and Google signals are off.
- What reaches Google names the page and the action, never the organization, product, record or
  content: page views carry masked paths (`/t/:org/:team/:product/story/:id`) and a fixed title,
  and each change the app makes is an event named from a fixed word list (`insights_create`,
  `sources_archive`). A request to hear from us on the site is `generate_lead`.
- `/cookies` describes cookies by kind (needed, analytics) and holds the choice. It makes no claims
  about what WhatBuild will never do.
- Rejected: a wall that refuses the app until a person accepts. Consent given to get in is not
  freely given.

## Consequences

- The maintainer can see site traffic and its sources, sign-ups, screens and actions used in the
  app, and returning people, in Google Analytics.
- Google sees only people who accept. So the site's page also carries Cloudflare Web Analytics
  when the Worker has a token (`CF_ANALYTICS_TOKEN`): it sets no cookie, needs no consent, and
  counts every visit, with referrers, countries and devices. It is on the site only.
- A new necessary cookie or storage key needs no page change; a new optional one joins the choice.

## Constrains

- No analytics, pixel or third-party script loads before Accept (`apps/web/src/lib/analytics.ts`).
- The app's CSP lets Google's hosts in only when the deployment sets an ID
  (`appPageHeaders` in `apps/server/src/public-routes.ts`).
- Anything sent to an analytics provider passes through `screenPath` or `actionName`, never a raw
  address, title or request body. A new route word is added to their lists to be counted.

Specified in: [§9.1](../spec/09-data-lifecycle.md) and [§7.11](../spec/07-web-app.md).
