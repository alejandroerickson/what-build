---
title: From the landing pages to the demo, an organization of one's own, or a place in line
organizations: [example]
people: [riley, guest]
surfaces: [web]
---

# Starting to use WhatBuild

What a stranger meets after pressing a button on the public site: Explore the demo lets them in as
a guest, straight into the demo, where every screen invites them to start using WhatBuild; Start
using WhatBuild takes one of the day's places and opens their own organization, or puts them in
line and lets them into the demo meanwhile; the line gets the next places first, by email; and with
nobody let in, the site asks for an email instead. Each step signs in as a new address, so each is a new person.

**Serve it with sign-up closed.** `pnpm dev:e2e` sets no sign-up allowlist, and with none anyone
can make an account whatever the guests' settings say, so step 9 could never close it. Serve the
instance for the whole plan with Riley alone on the allowlist:
`WHATBUILD_SIGNUP_ALLOWLIST=riley@example.com pnpm dev:e2e`. Steps 1 to 8 hold the same with it:
from step 1, guests' sign-up and New organizations a day each let anyone make an account.

**The tutorials.** Riley, in step 1, and each new person after is offered the tutorial's welcome,
over a darkened screen, on the first screen with a product's panel they reach. As the plans'
[README](README.md#what-a-plan-runs-on) says, press **Turn off tutorials** on it and go on: it is
expected, not a finding.

**Reading the site again.** In development the site asks the server for what only the deployment
knows (`/api/v1/plans`), which the browser may keep for up to five minutes, so a reload just after
Riley changes the guests' settings can show the page as it was. Close the browser first
(`pnpm e2e browser stop`; the next command opens a fresh one, with nothing kept), or use a new
private window.

**Trying it yourself.** Serve the instance as above, open `http://localhost:5283/site/` and
`http://localhost:5283/site/what-to-build/`, and on the sign-in page type any new address under
Development sign-in and press **As the email above**: every new address is a new person. Riley
(`riley` in Development sign-in) owns the instance and changes its settings. Mail only prints, in
the instance's output. On a deployment with real mail, an address with a `+` (`you+try1@…`) is a
new person whose mail still reaches you; delete each such account afterwards in Settings.

## Steps

1. **Web, as Riley.** In Instance admin → Guests, turn on **Anyone can sign up as a guest** and set
   **New organizations a day** to 2. *Expect:* the field's help says people start their own
   organization without waiting, up to this many each UTC day, and that past it they join the
   waitlist. `GET /api/v1/plans` says `sign_up: true` and nowhere the number 2 or
   `organizations_per_day`.
2. **Web, signed out, on `/site/`.** Read the first screen and scroll to the end. *Expect:* Start
   **Explore the demo** as the filled button under the headline and Start using WhatBuild beside it
   as the quiet one, a small Scroll prompt at the foot of the first screen that goes once the page
   moves, and, at the end, a line saying what a team builds in the demo (the first sentence of the
   example's first product), a large Explore the demo, and "Or start using WhatBuild". Where any
   plan has a price, a line of the priced plans follows with Compare plans; this instance's plans
   (`deploy/plans.example.json`) have none, so there is no such line. Nothing promises "free" or
   "now". No number of places anywhere. While
   scrolling, the page asks the service nothing (the browser's requests); pressing a button sends
   one `POST /api/v1/pressed` with the page and the button. The same on `/site/what-to-build/`, on a
   dark stage.
3. **Web, from `/site/what-to-build/`, as `new1@example.com`.** Press Start using WhatBuild.
   *Expect:* the sign-in page, titled **Start using WhatBuild**, says signing in creates their
   account and its foot has only
   Privacy and Cookies, with no line about a free preview. Sign in: *Expect:* the address has no
   `?landing=` or `button=` left in it, the Welcome screen asks for an organization and a first
   product, and starting it opens the product's Idea with **Connect your agent** first, once the
   tutorial's welcome over it is turned off.
4. **Web, from `/site/`, as `new2@example.com`.** As step 3. *Expect:* the same, their own
   organization started.
5. **Web, from `/site/`, as `new3@example.com`.** Press Start using WhatBuild and sign in.
   *Expect:* the overview, with the demo to read and a line saying their organization is on its way
   and that `new3@example.com` will hear as soon as it is ready; no Welcome form, and no number of
   places or day. The example's products open with "Your organization is on its way", the address
   they will hear at, and that nothing here can be changed.
6. **Web, as Riley.** Open Instance admin → Starting organizations. *Expect:* `new1` and `new2`
   each with an allowance of 1, given by "New organizations a day", not by Riley; `new3` first on
   the waitlist.
7. **Web, as Riley, then as `new4@example.com`.** Riley sets New organizations a day to 3, which
   makes one more place today but gives it to nobody yet: it goes to the first in line when someone
   next asks for an organization, or when the worker next looks (as it starts, then at most every
   ten minutes). Then `new4` presses Start using WhatBuild on `/site/` and signs in. *Expect:* the
   place goes to `new3`, who was first in line, by the time `new4` is answered (at `new4`'s asking,
   unless the worker gave it first): the instance's output prints the mail "Your place on WhatBuild
   is ready" to `new3@example.com`, with a link to `/welcome`, once; `new4` is told their
   organization is on its way. Signing in again as `new3` and opening `/welcome` lets them start one.
8. **Web, from `/site/`, as `new5@example.com`, at 1280 wide and again at 390 as `new6@example.com`.**
   Press **Explore the demo**. *Expect:* the sign-in page, titled **Explore the demo**, says "Sign in
   to open the demo. New here? Signing in creates your account." Sign in. *Expect:* the demo itself,
   as a guest: the example's first product on its Idea, its product concept in view without
   scrolling, and the address with no `?landing=` or `button=` left in it; never the overview. At
   1280, the tutorial's welcome over it (turn it off, as above); at 390, none. The Idea opens with
   "Like what you see?" and "Start using WhatBuild and engineer your next product.", with **Start
   using WhatBuild**; pressing it says the organization is on its way (no places left today), and
   the banner says the same from then on. On `/site/plans/`, **Explore the demo** in Try it first
   leads to the same sign-in page.
9. **Web, as Riley, then signed out.** Riley sets New organizations a day to 0 and turns guests'
   sign-up off; open `/site/` again in a fresh browser (see Reading the site again, above). This
   holds only on an instance served with a sign-up allowlist, as above: with none, sign-up stays
   open. *Expect:* Start using WhatBuild now leads to the form at the end,
   which asks for an email only and thanks the visitor; Explore the demo is gone; the sign-in page
   no longer says signing in makes an account.

## Look out for

- A screen or mail that says how many organizations a day are given, or when the next day starts:
  the number is the deployment's.
- Start using WhatBuild leading anywhere that is not one of: Welcome, the overview with the line saying the
  organization is on its way, or the form at the end of the page.
- Explore the demo leading anywhere after sign-in but the demo's product, or a screen that waits
  on "Opening the demo…".
- Someone in line who is never told, or two people given the same place.
- `?landing=` or `button=` staying on an address after sign-in.
