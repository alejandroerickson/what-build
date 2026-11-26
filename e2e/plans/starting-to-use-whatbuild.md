---
title: From the landing pages to the demo, an organization of one's own on one of the day's places, or a place in line
organizations: [example]
people: [riley, guest]
surfaces: [web]
---

# Starting to use WhatBuild

What a stranger meets after pressing a button on the public site: Explore the demo lets them in as
a guest, straight into the demo, where every screen invites them to start using WhatBuild; Start
using WhatBuild opens the Welcome form while one of the day's places is open, and the place is used
only when they start their organization, so someone who looks and leaves uses none; whoever presses
Start organization after the last place went is told so and put in line; the line gets the next
places first, by email; and with nobody let in, the site asks for an email instead. Each step signs
in as a new address, so each is a new person.

**Serve it with sign-up closed.** `pnpm dev:e2e` sets no sign-up allowlist, and with none anyone
can make an account whatever the guests' settings say, so step 12 could never close it. Serve the
instance for the whole plan with Riley alone on the allowlist:
`WHATBUILD_SIGNUP_ALLOWLIST=riley@example.com pnpm dev:e2e`. Steps 1 to 11 hold the same with it:
from step 1, guests' sign-up and New organizations a day each let anyone make an account.

**Two people at once.** Step 7 needs two people signed in at the same time: one in the plan's
browser (`pnpm e2e browser`), the other in a second browser of your own, such as a private window,
signed in the same way.

**The tutorials.** Riley, in step 1, and each new person after is offered the tutorial's welcome,
over a darkened screen, on the first screen with a product's panel they reach, and someone offered
it in the example is offered it once more on their own new product. As the plans'
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
   organization without waiting, up to this many each UTC day, that past it they join the
   waitlist, and that someone who looks and leaves uses no place. `GET /api/v1/plans` says
   `sign_up: true` and nothing gives the day's number of places: no `organizations_per_day`, nor
   any other field for it. A 2 among the plans' limits (Free's people) is a plan's limit, not the
   day's places.
2. **Web, signed out, on `/site/`, in a fresh browser** (see Reading the site again, above: one
   kept from before step 1 can show the site as it was then, closed). Read the first screen and
   scroll to the end. *Expect:* Start **Explore the demo** as the filled button under the headline
   and Start using WhatBuild beside it as the quiet one, a small Scroll prompt at the foot of the
   first screen that goes once the page moves, and, at the end, a line saying what a team builds in
   the demo (the first sentence of the example's first product), a large Explore the demo, and "Or
   start using WhatBuild". Where any plan has a price, a line of the priced plans follows with
   Compare plans; this instance's plans (`deploy/plans.example.json`) have none, so there is no
   such line. Nothing promises "free" or "now". No number of places anywhere. While scrolling, the
   page asks the service nothing (the browser's requests); pressing a button sends one
   `POST /api/v1/pressed` with the page and the button. No words run across WhatBuild or Sign in at
   the top while scrolling, and at the end nothing of the last scene's picture shows above "Find
   out what’s worth building.", at 390 and 1280 wide. The same on `/site/what-to-build/`, on a dark
   stage. Then open `/site/plans/`: *Expect:* under the plans, "Find out what’s worth building",
   the same line about the demo, Explore the demo as the filled button and Start using WhatBuild
   beside it; nothing says people are let in a few at a time. Each link to sign in carries
   `landing=/plans/` and its button; pressing one sends no `POST /api/v1/pressed`.
3. **Web, from `/site/what-to-build/`, as `new1@example.com`.** Press Start using WhatBuild.
   *Expect:* the sign-in page, titled **Start using WhatBuild**, says signing in creates their
   account and its foot has only
   Privacy and Cookies, with no line about a free preview. Sign in: *Expect:* the address has no
   `?landing=` or `button=` left in it, and the Welcome screen asks for an organization and a first
   product. Leave without starting one: close the browser (`pnpm e2e browser stop`).
4. **Web, as Riley.** Open Instance admin → Starting organizations. *Expect:* `new1` is not there:
   no allowance and not on the waitlist. Looking used no place.
5. **Web, from `/site/`, as `new2@example.com`.** As step 3, and start the organization.
   *Expect:* starting it opens the product's Idea with **Connect your agent** first, once the
   tutorial's welcome over it is turned off.
6. **Web, as Riley, then from `/site/` as `waiting@example.com`.** Riley sets **Guests in at once**
   to 0 in Instance admin → Guests, so no guest comes into the example, and New organizations a day
   to 3, which leaves two places open today. With no guest let in, `/site/` offers no **Explore the
   demo** (it shows it only while guests can sign up and are let in): in a fresh browser, check it
   is gone, then open the address it leads to,
   `/signin?next=%2Fdemo%3Flanding%3D%2F%26button%3Dexplore`, as someone holding an old link would,
   and sign in as `waiting`. *Expect:* the waiting page, "WhatBuild isn’t letting guests in right
   now", with **Start your own organization** as a link. Following it opens the Welcome form.
   Starting the organization opens the product's Idea, not the waiting page, and moving to Evidence
   and back stays in the app. Riley then sets Guests in at once back to what it was.
7. **Web, from `/site/`, as `new3@example.com` and, in a second browser, `new4@example.com`.** Each
   presses Start using WhatBuild and signs in. *Expect:* both see the Welcome form. `new3` fills it
   in and starts their organization, which takes the day's last place. Then `new4`, whose form is
   still open, fills it in and presses Start organization. *Expect:* nothing is started; the form
   gives way to "The last open place was taken just before you." and "Your organization is on its
   way. We’ll email new4@example.com as soon as it’s ready.", with no number of places or day. Its
   overview, and the example's products, then say their organization is on its way.
8. **Web, from `/site/`, as `new5@example.com`.** Press Start using WhatBuild and sign in.
   *Expect:* the overview, with the demo to read and a line saying their organization is on its way
   and that `new5@example.com` will hear as soon as it is ready; no Welcome form, and no number of
   places or day. The example's products open with "Your organization is on its way", the address
   they will hear at, and that nothing here can be changed.
9. **Web, as Riley.** Open Instance admin → Starting organizations. *Expect:* `new2`, `waiting`
   and `new3` each with an allowance of 1, given by "New organizations a day", not by Riley, and one
   organization started; still no `new1`; `new4` first on the waitlist, with the organization's
   name they typed, and `new5` after.
10. **Web, as Riley, then as `new6@example.com`.** Riley sets New organizations a day to 4, which
    makes one more place today but gives it to nobody yet: it goes to the first in line when someone
    next asks for an organization, or when the worker next looks (as it starts, then at most every
    ten minutes). Then `new6` presses Start using WhatBuild on `/site/` and signs in. *Expect:* the
    place goes to `new4`, who was first in line, by the time `new6` is answered (at `new6`'s asking,
    unless the worker gave it first): the instance's output prints the mail "Your place on WhatBuild
    is ready" to `new4@example.com`, with a link to `/welcome`, once; `new6` is told their
    organization is on its way, and `new5` stays first in line. Signing in again as
    `new4` and opening `/welcome` shows the form, and starting the organization works: the place was
    held for them.
11. **Web, from `/site/`, as `new7@example.com`, at 1280 wide and again at 390 as `new8@example.com`.**
    Press **Explore the demo**. *Expect:* the sign-in page, titled **Explore the demo**, says "Sign
    in to open the demo. New here? Signing in creates your account." Sign in. *Expect:* the demo
    itself, as a guest: the example's first product on its Idea, its product concept in view without
    scrolling, and the address with no `?landing=` or `button=` left in it; never the overview. At
    1280, the tutorial's welcome over it (turn it off, as above); at 390, none. The Idea opens with
    "Like what you see?" and "Start using WhatBuild and engineer your next product.", with **Start
    using WhatBuild**; pressing it says the organization is on its way (no places left today), and
    the banner says the same from then on. On `/site/plans/`, **Explore the demo** under "Find out
    what’s worth building" leads to the same sign-in page.
12. **Web, as Riley, then signed out.** Riley sets New organizations a day to 0 and turns guests'
    sign-up off; open `/site/` again in a fresh browser (see Reading the site again, above). This
    holds only on an instance served with a sign-up allowlist, as above: with none, sign-up stays
    open. *Expect:* Start using WhatBuild now leads to the form at the end, with the cursor in its
    email field, which is as tall as Request access at 320 and 390 wide; the form
    asks for an email only and thanks the visitor; Explore the demo is gone; the sign-in page
    no longer says signing in makes an account. `/site/plans/` says people are let in a few at a
    time, with Hear when you can start, and offers no Start using WhatBuild.

## Look out for

- A screen or mail that says how many organizations a day are given, or when the next day starts:
  the number is the deployment's.
- Start using WhatBuild leading anywhere that is not one of: Welcome, the overview with the line saying the
  organization is on its way, or the form at the end of the page.
- Explore the demo leading anywhere after sign-in but the demo's product (or, while no guest is let
  in and its address is opened directly, the waiting page), or a screen that waits on "Opening the
  demo…".
- Someone in line who is never told, two people given the same place, or more organizations
  started on the day's places than the number.
- A place used by someone who only opened the Welcome form: an allowance given by "New
  organizations a day" with nothing started, for anyone not let in from the waitlist.
- Someone who pressed Start organization after the last place went left with their organization
  half started, or with no word that they are in line.
- Someone who started their organization from the waiting page shown the waiting page again over
  their own product.
- `?landing=` or `button=` staying on an address after sign-in.
