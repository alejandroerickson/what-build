---
type: Decision
title: People start a number of organizations a day themselves, and the waitlist gets the next places first
description: An instance owner sets how many organizations people may start each UTC day without being let in by hand; a place is used only when an organization starts on it, the line is let in first by email, and nothing tells a visitor the number.
tags: [decision, sign-up, organizations, waitlist, guests, launch]
generated: {by: agent:claude, at: 2026-11-25}
status: stable
---

# People start a number of organizations a day themselves, and the waitlist gets the next places first

## Context

Starting an organization took an allowance an instance owner gave one address at a time, so every
newcomer who clicked the public site's button to start waited on a person, with no time frame. Opening sign-up to everyone
at once risks a spike the deployment cannot carry. The maintainer chose on 2026-11-23 to let people
start organizations themselves up to a number a day they control, to make the path after the public
site's button as short as it can be, and to tighten or open that number as the deployment grows. The
number is the deployment's business, never told to visitors. A place was first given when someone
pressed Start using WhatBuild, so people who looked at the Welcome form and left used up the day's
places while others waited; on 2026-11-25 the maintainer chose that a place is used only when an
organization starts on it.

## Decision

- **The setting**: `organizations_per_day` among the guests' settings (Instance admin → Guests,
  `products.set_guests`), 0 by default, which keeps today's rule: only people an owner lets in.
- **A place** is an allowance of 1 that WhatBuild gives (`created_by.client` is
  `whatbuild:organizations-a-day`), counted on the UTC day it was given. An address an owner already
  gave an allowance, 0 included, gets none, nor does an account already in an organization.
- **A place is used when an organization starts on it**: Start organization on `/welcome`, in the
  web app, takes it in the transaction that creates the organization, under one advisory lock
  across the deployment, so the day's number holds however many start at once. Start using WhatBuild
  (`POST /api/v1/me/start`) and Start your own organization (`POST /api/v1/me/ask-for-organization`)
  only say whether one is open (`place_open`) and hold none. An agent takes no place.
- **The last place going first**: whoever presses Start organization after it went is refused with
  `409 places_taken`, nothing is started, the app puts them on the waitlist with the name they typed,
  and the form gives way to "The last open place was taken just before you." and the waitlist line.
- **The waitlist goes first**: the day's free places go to those waiting, earliest first, before
  anyone new, whenever someone asks and every ten minutes while the worker is awake. Each is held
  for its person, told by email ("Your place on WhatBuild is ready"), and counts on the day it was
  given whether or not they use it: they were promised it. Nothing runs while the service sleeps.
- **Sign-up opens with it**: above 0, anyone may make an account, as when guests may sign up.
- **Nothing tells a visitor the number**: not the site, `GET /api/v1/plans` (it says only
  `sign_up`), the sign-in page or the app. Instance owners see the day's places used in `products.guests`.
- Rejected: opening sign-up with no daily cap, which leaves a spike unbounded; a timer that lets
  people in at midnight, which would wake the service; holding a place while someone fills in the
  Welcome form, which needs a hold that lapses and still spends places on people who leave.

## Consequences

- Nobody who clicks Start using WhatBuild waits on a person while places are left, and those in line hear by
  email without anyone acting.
- The day's number counts organizations started, not people who looked; someone can lose the last
  place to whoever presses Start organization first, and is told so plainly.
- An owner still lets anyone in by hand at any time, beyond the day's number.

## Constrains

- `packages/core/src/places.ts`; `requireTenantAllowance` (`packages/core/src/tenant-allowance.ts`);
  the field in `GUEST_FIELDS` (`packages/core/src/plans.ts`).

Specified in: [03-accounts-and-identity §3.2](../spec/03-accounts-and-identity.md#32-accounts-and-sign-in), [07-web-app §7.3](../spec/07-web-app.md#73-routes), [09-data-lifecycle §9.7](../spec/09-data-lifecycle.md#97-plans-and-limits).
