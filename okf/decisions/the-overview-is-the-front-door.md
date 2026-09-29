---
type: Decision
title: The overview is WhatBuild's front door, and the one screen with display type
description: `/` and the WhatBuild mark open an overview that introduces the product and lists every product with a link to each section; only its intro is set above the 20px ceiling.
tags: [decision, web, design, navigation]
generated: {by: agent:claude, at: 2026-09-29T00:00:00Z}
status: stable
---

# The overview is WhatBuild's front door, and the one screen with display type

## Context

The WhatBuild mark used to open the current product's Idea screen, and `/` opened the last product
used. That left nowhere that says what WhatBuild is, and nowhere to see every product at once and
jump into any part of one. The page also has to look right when someone shares a screenshot of
WhatBuild, which the Studio system's 20px type ceiling does not allow for. The maintainer chose the
overview, its landing role and the type exception on 2026-09-28. On 2026-09-29 they removed the
separate All products screen, which repeated the overview's list in a table, and moved roles and
the members link off the overview.

## Decision

- `/` is the overview, for everyone who belongs to an organization; people with none still go to
  first run. The W mark and wordmark in the panel link to it from every screen.
- The overview introduces WhatBuild, shows the six counts across the person's products, small and
  set out as the loop (Idea, Evidence, Synthesis, Story), and lists each organization's products.
  Each product row links to its four sections with their counts, one click each.
- The overview is the only list of products. New product opens as a dialog on it, and archived
  products appear on it only when asked for; `/products` redirects to it. It shows no roles and no
  product count per organization: the person's organization role is in the account menu, beside
  that organization's Members.
- Only the overview's intro, the wordmark and the question "What to build?", is set above 20px
  (tokens `--fs-brand` and `--fs-display`). Every other screen keeps the ceiling.
- `products.list` returns each product's counts, the same ones `products.get` reports, so the page
  needs one request and agents get the counts too.
- Rejected: a separate All products screen, which listed the same products a second way.
- Rejected: keeping `/` on the last product, which is faster for someone working in one product
  every day but leaves the overview reachable only by the mark.

## Consequences

- Returning to a product takes one click from the overview, or the product switch inside a product.
- `products.list` counts each tenant's products inside that tenant's row-level-security scope.

## Constrains

- A new screen above 20px needs a new decision; the exception is the overview's intro only.
- Tokens live in `apps/web/src/styles/tokens.css`; the screen is `apps/web/src/routes/overview.tsx`.

Specified in: [07-web-app §7.2 and §7.3](../spec/07-web-app.md), [DESIGN.md](../../DESIGN.md).
