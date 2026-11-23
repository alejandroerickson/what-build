---
type: Decision
title: The site opens on landing pages the scroll tells, one plain statement per screen
description: what-build.com's front page and /what-to-build/ tell the same six steps beside a picture the scroll moves, with display type of their own, and lead to one form that is the only thing on them that wakes the service.
tags: [decision, web, site, design, marketing]
generated: {by: agent:claude, at: 2026-11-23}
status: stable
---

# The site opens on landing pages the scroll tells, one plain statement per screen

## Context

The front page was the overview's intro and a form. Before a public launch the maintainer wanted a
first screen that shows a stranger WhatBuild's value and moves as they scroll. On 2026-11-23 they
chose two of three directions explored as mockups: words that scroll past a picture, and the
window on a dark stage. They rejected the third, a before and after per screen, because someone who
only scrolls passes its scenes without seeing them. The site's pages are still served from the
edge ([decision](the-public-site-is-pages-built-with-the-app.md)), so a visit must not wake the service.

## Decision

- `/` scrolls six steps of words up beside a picture that stays put and changes as each passes.
  `/what-to-build/` pins a dark stage while the scroll runs each scene, under "What to build?".
  Both say the same thing: "Product engineering at the speed of AI engineering", then evidence in
  one place, agents working on it, exploring product concepts, telling the story, and a coding
  agent building from the concept.
- One plain statement per screen and one sentence under it. The pictures are schematic marks the
  page's script draws on a 1440 × 900 stage. The words are text at real sizes. On a narrow or
  upright window the picture takes the top and the words the foot.
- These pages set their own type above the twenty pixel ceiling, as the overview's intro does
  ([decision](the-overview-is-the-front-door.md)).
- Looking comes first: while guests may come in, **Explore the demo** is the main button and
  **Start using WhatBuild** the second (the maintainer's words, 2026-11-23: neither promises "free"
  or "now"), and the demo's banner invites a guest to start using WhatBuild and engineer their next
  product. Start using WhatBuild signs the visitor in and starts their
  organization, or puts them in line
  ([decision](people-start-a-number-of-organizations-a-day-themselves.md)), where anyone may make an
  account; where nobody may yet, it leads to the form at the foot, which asks for an email only.
  Sending it, or following a link to sign in, is all that reaches the service. The page shows no
  address to add to an agent, and calls the example organization "the demo".
- A gentle Scroll prompt sits at the foot of the first screen. The scroll bar always shows. With
  reduced motion each scene is shown settled.
- Which one a visitor meets at `/` is an A/B test
  ([decision](the-landing-pages-are-compared-by-a-split-at-the-edge.md)).
- `/` follows the system's theme. `/what-to-build/` is always dark: its HTML says
  `data-theme-fixed="dark"`, which `theme-boot.js` reads before the first paint.

## Consequences

- The words are in one place, `apps/web/src/site/landing/Landing.tsx`, and both pages change together.
- The picture runs only while its section is on screen.

## Constrains

- The pictures are `apps/web/src/site/landing/` (`motion.ts`, `one-line.ts`, `window.ts`), styled in
  `apps/web/src/styles/screens/landing.css` under the `ld-` prefix.
- `/what-to-build` is listed with the site's other paths (`SITE_PAGES` in
  `deploy/cloudflare/worker.js`, `SITE_PATHS` and `SITE_PAGES` in `apps/server/src/site.ts`, the
  Vite entry `apps/web/site/what-to-build/index.html`).

Specified in: [07-web-app §7.3](../spec/07-web-app.md#73-routes).
