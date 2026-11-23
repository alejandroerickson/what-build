---
type: Decision
title: People start a number of organizations a day themselves, and the waitlist gets the next places first
description: An instance owner sets how many organizations people may start each UTC day without being let in by hand; Start using WhatBuild takes one of them or a place in line, the line is let in first by email, and nothing tells a visitor the number.
tags: [decision, sign-up, organizations, waitlist, guests, launch]
generated: {by: agent:claude, at: 2026-11-23}
status: stable
---

# People start a number of organizations a day themselves, and the waitlist gets the next places first

## Context

Starting an organization took an allowance an instance owner gave one address at a time, so every
newcomer who clicked the public site's button to start waited on a person, with no time frame. Opening sign-up to everyone
at once risks a spike the deployment cannot carry. The maintainer chose on 2026-11-23 to let people
start organizations themselves up to a number a day they control, to make the path after the public
site's button as short as it can be, and to tighten or open that number as the deployment grows. The
number is the deployment's business, never told to visitors.

## Decision

- **The setting**: `organizations_per_day` among the guests' settings (Instance admin → Guests,
  `products.set_guests`), 0 by default, which keeps today's rule: only people an owner lets in.
- **A place** is an allowance of 1 that WhatBuild gives (`created_by.client` is
  `whatbuild:organizations-a-day`), counted on the UTC day it was given. An address an owner already
  gave an allowance, 0 included, gets none.
- **Asking takes one**: Start using WhatBuild after sign-in (`/start`, `POST /api/v1/me/start`) and Start your
  own organization in the app (`POST /api/v1/me/ask-for-organization`) give a place while one is left
  and go to `/welcome`; else the person joins the waitlist and reads that their organization is on
  its way, by email.
- **The waitlist goes first**: the day's free places go to those waiting, earliest first, each told
  by email ("Your place on WhatBuild is ready"), whenever someone asks and every ten minutes while
  the worker is awake. Nothing runs while the service sleeps.
- **Sign-up opens with it**: above 0, anyone may make an account, as when guests may sign up.
- **Nothing tells a visitor the number**: not the site, `GET /api/v1/plans` (it says only
  `sign_up`), the sign-in page or the app. Instance owners see the day's count in `products.guests`.
- Rejected: opening sign-up with no daily cap, which leaves a spike unbounded; a timer that lets
  people in at midnight, which would wake the service.

## Consequences

- Nobody who clicks Start using WhatBuild waits on a person while places are left, and those in line hear by
  email without anyone acting.
- An owner still lets anyone in by hand at any time, beyond the day's number.

## Constrains

- `packages/core/src/places.ts`; the field in `GUEST_FIELDS` (`packages/core/src/plans.ts`).

Specified in: [03-accounts-and-identity §3.2](../spec/03-accounts-and-identity.md#32-accounts-and-sign-in), [07-web-app §7.3](../spec/07-web-app.md#73-routes).
