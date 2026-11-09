---
type: Decision
title: The panel shows one product; everything else is in a Settings dialog, the account menu is the person's, and running the instance is in Instance admin
description: The web app's panel is the same for every screen and role, showing one product; an organization's and a person's settings open in one dialog over the screen, and instance owners run the instance in a place of their own at /admin.
tags: [decision, web, design, navigation, settings, instance]
generated: {by: agent:claude, at: 2026-11-09}
status: stable
---

# The panel shows one product; everything else is in a Settings dialog, the account menu is the person's, and running the instance is in Instance admin

## Context

The panel turned into another panel outside a product (a list of organizations and their products,
with Connect an agent, Organizations and People), the account menu grew a block for every
organization a person joined (Members, Plan), and an instance owner's plan page carried controls
nobody else saw. Where something lived depended on where the person stood and which role they held,
so the same thing was found in different places by different people. The maintainer set the rule
below on 2026-11-08 (principle 6 in [PRODUCT.md](../../apps/web/PRODUCT.md), the One Product Panel
Rule in [DESIGN.md](../../apps/web/DESIGN.md)).

## Decision

- **The panel shows one product of one organization**, with the same rows on every screen and for
  every role, an instance owner's included: the product switch, Search, the four sections, then the
  empty seat, Activity and Settings. A screen that is no product's own shows the product the person
  was last in. An organization with nothing to open shows Create a product where the sections
  would be. The product switch holds one organization and switches to another.
- **Everything else is in Settings**, one large dialog over the current screen, addressed by
  `?settings=<section>`: the product's sections, its organization's (people, plan, access changes,
  name) and the person's (account, agents). Closing it leaves the screen as it was.
- **The account menu is only about the person**: Settings, the theme, Instance admin for an instance
  owner, feedback, sign out. Joining an organization adds nothing to it.
- **Running the instance is in Instance admin** (`/admin`), a place of its own with its own panel,
  which only instance owners reach; anyone else is told it wasn't found. Plan in Settings is the same
  for everyone.
- **Old addresses lead to the new places**, query kept (`/connect`, `/settings`,
  `/t/<organization>/members`, `/plan`, `/instance`, `/people`, a product's `/settings` and `/connect`).
- Rejected: a screen for the organization in the panel, which brings back a panel that changes with
  where the person stands. Rejected: a settings page instead of a dialog, which takes the person away
  from the product and needs its own way back.

## Consequences

- A person finds a setting in one place whatever screen they are on; a link opens it over any screen.
- Settings sections are components that take the organization or product they are about, not routes.
- The overview stays the front door and the one list of products, with the product panel beside it.

## Constrains

- No admin row in the panel, no screen beside the product, no organization block in the account menu
  (`apps/web/src/shell/panel.tsx`). A new setting is a Settings section
  (`apps/web/src/shell/settings-dialog.tsx`, `settings-link.ts`), listed only to who may use it.
- What only instance owners do is an Instance admin section (`apps/web/src/routes/admin.tsx`), never
  a control shown to them alone elsewhere.
- A screen or address that moves keeps its old address as a redirect (`apps/web/src/routes/addresses.tsx`).

Specified in: [07-web-app §7.2, §7.3 and §7.11](../spec/07-web-app.md).
