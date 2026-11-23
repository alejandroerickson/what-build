---
title: From the landing pages to the demo, an organization of one's own, or a place in line
organizations: [example]
people: [riley, guest]
surfaces: [web]
---

# Starting to use WhatBuild

What a stranger meets after pressing a button on the public site: Explore the demo lets them in as
a guest, where every screen invites them to start using WhatBuild; Start using WhatBuild takes one
of the day's places and opens their own organization, or puts them in line and lets them into the
demo meanwhile; the line gets the next places first, by email; and with nobody let in, the site
asks for an email instead. Each step signs in as a new address, so each is a new person.

**Trying it yourself.** Serve the instance (`pnpm dev:e2e`), open `http://localhost:5283/site/` and
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
   example's first product), a large Explore the demo, "Or start using WhatBuild", and the plans'
   prices with Compare plans. Nothing promises "free" or "now". No number of places anywhere. While
   scrolling, the page asks the service nothing (the browser's requests). The same on
   `/site/what-to-build/`, on a dark stage.
3. **Web, from `/site/what-to-build/`, as `new1@example.com`.** Press Start using WhatBuild.
   *Expect:* the sign-in page, titled **Start using WhatBuild**, says signing in creates their
   account and its foot has only
   Privacy and Cookies, with no line about a free preview. Sign in: *Expect:* the address has no
   `?landing=` left in it, the Welcome screen asks for an organization and a first product, and
   starting it opens the product's Idea with **Connect your agent** first.
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
7. **Web, as Riley, then as `new4@example.com`.** Riley sets New organizations a day to 3; then
   `new4` presses Start using WhatBuild on `/site/` and signs in. *Expect:* the place freed goes to `new3`, who
   was first in line: the instance's output prints the mail "Your place on WhatBuild is ready" to
   `new3@example.com`, with a link to `/welcome`; `new4` is told their organization is on its way.
   Signing in again as `new3` and opening `/welcome` lets them start one.
8. **Web, from `/site/`, as `new5@example.com`.** Press **Explore the demo** and sign in.
   *Expect:* the overview with the demo, as a guest. Its products open with "Like what you see?" and
   "Start using WhatBuild and engineer your next product.", with **Start using WhatBuild**; pressing
   it says the organization is on its way (no places left
   today), and the banner says the same from then on.
9. **Web, as Riley, then signed out.** Riley sets New organizations a day to 0 and turns guests'
   sign-up off; reload `/site/`. *Expect:* Start using WhatBuild now leads to the form at the end,
   which asks for an email only and thanks the visitor; Explore the demo is gone; the sign-in page
   no longer says signing in makes an account.

## Look out for

- A screen or mail that says how many organizations a day are given, or when the next day starts:
  the number is the deployment's.
- Start using WhatBuild leading anywhere that is not one of: Welcome, the overview with the line saying the
  organization is on its way, or the form at the end of the page.
- Someone in line who is never told, or two people given the same place.
- `?landing=` staying on an address after sign-in.
