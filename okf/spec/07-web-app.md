---
type: Specification
title: The web app is a person's way to run the same operations an agent runs, one screen at a time.
description: Principles, the shell and product switching, the overview, routes, first run, and the behavior of every screen (Idea, Evidence, Exploration, Story, Activity, archive and delete, Settings, Instance admin).
tags: [spec, web, ui, routes, shell]
generated: {by: agent:claude, at: 2026-11-23}
status: stable
---

# 7. Web application

This section specifies behavior and information architecture of `apps/web`. The visual design — the Studio
design system: tokens, type, components and the rules for using them — is documented in
[DESIGN.md](../../apps/web/DESIGN.md).

## 7.1 Principles

- The UI uses only registry operations, through the REST routes of
  [§6.4](06-operations-and-adapters.md) and one small client (`apps/web/src/lib/api.ts`). If the UI
  needs something, it becomes an operation, and agents get it too. The exceptions are the
  person's own session, connected agents and invitations (`/api/v1/me…`, `/api/v1/invitations/…`),
  which are not content.
- **State that matters lives in the URL**: product, screen, filters, search query, selected
  page, a source's section and the words found in its text. Reload and share always work.
- Every write path handles `409 stale_etag` explicitly: show what changed, keep the person's
  unsaved text, offer reload-and-reapply. Never discard input; never overwrite silently: a
  teammate or their agent may be editing the same object.
- **What someone else changes reaches an open tab**, from a stream that says only which part of the
  product changed ([decision](../decisions/open-tabs-hear-of-changes-through-a-stream-the-server-itself-serves.md)).
  Idea, Evidence with a search's results, a source, the list of mockups, the Story's
  tree and activity refresh by themselves, at most every thirty seconds, and never while someone is
  typing, holding something in mid-drag, or in a dialog, or on a form that saves over what it opened:
  they refresh once that is over. A long list someone has read more than three pages into is read
  again when next opened, and a read that fails changes nothing on screen. A Story page and a mockup's
  canvas never change by themselves. When theirs changes, a toast that has no timer says "This page was
  updated. Refresh to see the latest." (or "This mockup"), Refresh brings it without loading the app
  again, and closed, it comes back only for a newer change. A change to another page of the Story
  brings no toast, nor does the person's own edit. A Story reader hears only of the Story. A tab listens
  while it is in view and used in the last ten minutes, for two minutes once hidden, and looks for
  what it missed when it listens again. A screen that is no product's own (the overview, Instance
  admin) does not listen, whatever product its panel shows. Where a deployment
  turned this off, or a guest of the example organization reads, nothing is different but that people
  refresh to see a change.
- **A field's limit never cuts what is typed or pasted.** Past a limit the text stays as it is, the
  field is invalid and says how many characters are over ("140 characters over the limit of 1,000.
  Shorten it to save."), and the form refuses to save it, as MCP refuses the same text with an
  error. All of the text counts, in characters as the server's limits count them, so an emoji is one, and what the server would trim counts too. A screen reader reads it with the field and
  hears it once typing rests. ◆ Decision: `TextField` and `TextArea` take `maxLength` and never hand
  it to the browser, which cuts a paste without a word, and a form tests its text with `tooLong`
  (`apps/web/src/ui/field.tsx`).
- **A page left open across a release loads the release.** A tab keeps the app it loaded, while
  the server may by then answer in shapes that app does not know. The app knows the commit it was
  built from (`WHATBUILD_COMMIT` at build time) and every response names the server's
  ([§2](02-architecture.md)); once they differ, the next screen is a full page load (a query string
  changing is not a next screen), and an error loads the release at once, saying "WhatBuild was
  updated while this page was open" with Reload (`apps/web/src/lib/new-release.ts`). A tab loads
  each release once, so a page that is still old once loaded (a cache kept it) is not loaded
  again at every screen. ◆ Decision: never sooner than the next screen or an error, so nobody
  loses what they are typing.
- `409 quota_exceeded` is shown as a fact with a number and a next step, never as a failure of the
  person. (Enforced today: Story pages and mockups per product, [§9.2](09-data-lifecycle.md), and the
  daily allowances and totals of a plan the deployment defines, [§9.7](09-data-lifecycle.md).) A
  plan's total, reached (people in Add people, products in New product, sources in a new source,
  storage when an upload is refused), is said in the app's own words from the refusal's `details`,
  never the message written for agents: the organization and its plan by name with what the plan
  holds ("Fieldnote’s Free plan holds 2 people"), a few words on how to make room ("No places are
  left for nora@example.com. Cancel an invitation. Story readers don’t count."), and
  Compare plans, opening `/plans` in a new tab, where the deployment offers plans
  (`apps/web/src/shell/limit-reached.tsx`). People past the total are told how many places are
  left, that nothing was saved when only some of the addresses fit ("Nothing was saved. There’s
  room for 1 more person. Add fewer people."), and only the ways to make room that exist there:
  adding fewer people while some fit, cancelling an invitation while one is open, removing someone
  while someone besides the person adding holds counted roles only where the person adding can
  take them off, so removing them frees a place (nothing is offered on a guess: not while the app
  doesn't yet know who is adding, and not to a product's admin, whose list leaves out roles on
  products they can't open). A list longer than one call's 100 addresses, refused after an
  earlier call saved, says so ("The first 100 addresses are saved and off the list, and none after
  them."; when the later call got no answer, nothing is said of the rest), counting the room from
  the first address still listed. New product says the same before anything is typed when the
  organization already holds its plan's products. A limit a minute or a day keeps the
  server's words.
- **Calls a minute running out is a wait, not a failure.** A read refused for them
  (`429 rate_limited` with `retry_after_seconds`, [§9.7](09-data-lifecycle.md)) asks again once it
  may succeed, each read at a moment of its own within five seconds of that, three times at most, and only
  then shows the refusal with **Try again** (`retryRead`, `readRetryDelay` in `apps/web/src/lib/api.ts`). Meanwhile
  whatever is loading says *Waiting for the next minute* and that WhatBuild carries on by itself. A read that
  otherwise asks only when the person does, search as you type and a source's title on a chip, asks
  again for this alone. A hidden tab, or a screen the person has left, asks nothing. A write
  refused is never asked again: it shows the refusal, and what they typed stays.
  A product the app holds stays on screen while a re-check of it is refused, since that says nothing of the person's
  access; every other answer to the re-check stands, and a `403` or a `404` takes the product away at once, the one after a refusal too.
  One the app does not hold waits, then past the bound says it couldn't be loaded, with **Try again**.
- **A frame refused for its call comes back by itself too** (the frames of a Story page, a canvas's pages, an
  Idea card and a style's specimen; `apps/web/src/lib/minute.ts`). The server answers a short page saying so
  in place of the JSON ([§6.4](06-operations-and-adapters.md#routes-outside-the-registry)), which also tells the app, and the
  app asks again by making a new frame at the page's own address. That is how a page replaced in its frame is
  put back too, so a second load of one frame is never let through, whatever a page says of itself. Nor is a
  first whose document never says it has loaded: every document the app frames says so as its load event
  fires (`frame-ready`: the frame script, and WhatBuild's own short pages for a refusal or another failure,
  [§6.4](06-operations-and-adapters.md#routes-outside-the-registry)), and a page that sends its frame elsewhere
  while it is still loading never gets that far, so 1.5 seconds after a load with no word the page is put back,
  and said to be. Frames take
  turns after the minute has turned and the screen's reads have had theirs, one every 2.4 seconds, half of a 50-call
  minute. No message changes that pace: a deployment with a much lower limit gets refused again, and one refused again stops the turns until
  the next minute. Nothing takes a turn while the tab is hidden; it takes them up at the same pace when visible. Each refused frame is
  asked for three times at most, then **Try again** stands in its place; on a canvas, the board
  says so above the pages at screen size, whatever the zoom. An attachment's preview runs no script to say so, so its short
  page asks the person to close and open it again.
- **A page that keeps reloading costs a bounded number of calls, and is never gone for good.** A page's own reload
  reaches the server without the session, since a sandboxed document has an opaque origin, and spends nothing; putting the page back
  does spend a call. A screen puts back at most 10 frames a minute in all, and any one page at most 3. Past either, the page waits with
  a short note and no frame, what took its place gone at once, and then comes back. After 3 such waits in a row without settling (staying in its frame for a minute)
  it stops, saying *This page keeps reloading*, which blames no one, since a person's own button can do it, and offers **Try again**, which starts it
  afresh; so does leaving the screen. Nothing is put back while the tab is hidden: it takes turns when visible, at the pace of frames, not all at once.
  A prototype's route meets no limit, so a prototype's frames cost no calls: they take none of this budget, take no word of a refusal from
  what is in them, and are put back at once, always, as a link to a missing file inside one needs.
  ◆ Decision: the short page never reloads itself, and only the app asks again. A document can still spend the person's calls by reloading itself,
  within these bounds. While the screen stays visible and it stays unsettled, that costs at most 10 calls a minute on a screen, and one page
  makes at most 10 new frames before it stops (3 in each of three minutes, and the one after the last wait). Within the bounds it never waits, so it never stops: a single page reloading
  slower than 3 times a minute goes on costing that for as long as the screen stays visible. The person can leave it, and a person's calls a minute start again each minute.
- **No request the app knows will be refused.** Where the app can tell in advance that the server
  would refuse (a Story reader asking for members or the plan, a guest of the example organization asking
  for its people, an address whose id is not an id at all), it says so without asking. Where it cannot, it asks, and
  REST answers honestly: a source, mockup or other object that does not exist answers `404`,
  and its page says it was not found while the browser's console reports the `404` of the request.
  A `404` is final, so the app never asks for it again (a request that did not reach WhatBuild,
  or a `5xx`, is asked again twice). A product that answers `404`, or an organization
  (`/t/<organization>`) that is not among the person's, says at once that it doesn't exist or the
  person can't see it, as the server does of both, with a way back to their products.
  ◆ Decision: that console line is by design; the API is not bent to hide it.
- **Times are shown in the viewer's own time zone**, though the API gives them in UTC, except the
  days the server states too (a read-only organization's since and kept until, the allowances'
  midnight UTC), which are UTC days here as in a refusal
  ([decision](../decisions/times-are-utc-in-data-and-local-where-shown.md)).
- Works on narrow screens. Meets WCAG 2.2 AA. Fully keyboard-operable.
- **A title kept to one line is cut after a whole word, in reading order.** Wherever a title or a
  name keeps to one line (the crumbs, the panel's Story tree, filters, mockups, products and
  organizations, the inspector's title, the search palette's results, a filter chip), it takes
  its own direction, and one too long ends in an ellipsis after its last whole word that leaves
  room for it. A title that mixes English and Arabic keeps the words it begins with, where clipping
  it at a pixel would keep the end of the Arabic or cut a letter in half; one in Arabic reads right
  to left with the ellipsis at its left. In the search palette, a title starts at a word nearer the place that
  holds the most of the words searched, after an ellipsis, when that place ends past that cut. Of
  places holding as many, it is the one where they stand closest, the first of equals; words further
  apart than about 60 characters are not held together, and a word alone keeps its first place. So a
  result always shows words that found it, as many of them as the line holds, and a word said twice
  does not hide another that stands by its second. It is measured before it is drawn, and again only when
  its room or the fonts change. The whole title stays in the page for assistive technology and
  shows on hover (the Whole Word Rule in [DESIGN.md](../../apps/web/DESIGN.md)).
- **Interface text says one thing once.** A heading states the fact, the body adds only what the
  heading did not, and a rule is explained where it applies, not ahead of time. Words are plain and
  the same everywhere: an email address is an "email", a URL given to a person is a "link", a
  source's files are its "attachments" and its words its "text", people "start" an organization
  and "can" do things, and something
  happens "right away". Contractions and typographic apostrophes are used throughout. A role's
  place is written as a person would say it: "editor on all products", "editor on Crewboard"
  (`scopeWords` in `apps/web/src/lib/format.ts`). Screens and mail say what to do next and leave
  out what nobody has asked about yet, name a plan once and a limit when it is reached, write
  names without quotation marks, and each stands on its own, since its reader may not connect it
  to the step before (the rules under Words in [DESIGN.md](../../apps/web/DESIGN.md)).
- Agents are teammates: attribution in the UI shows who wrote something **and through which
  surface** (for example "Sam · via claude-desktop").

## 7.2 The shell, and product switching

**The shell.** Every signed-in screen sits on one stage: a floating left panel, the canvas, and —
only on a Story page, a mockup and a source page — an inspector on the right. Everywhere else the content
takes the full width. There are no in-app tabs: one screen at a time, and rows are real links, so
the browser's back button and "open in new tab" both work.

- **Top of the panel:** the W mark ([decision](../decisions/the-mark-is-a-w-in-a-panel-with-a-title-bar.md))
  and the "WhatBuild" wordmark, linking to the overview (`/`)
  from every screen, with the button that hides the panel at the row's far end. Only the mark and
  wordmark are the link, so a click that misses the hide button does not leave the screen. Then the
  product switch, showing the product and its organization (Switching, below), and under it the **Search**
  field, "Search <product>" with its shortcut, or for a Story reader "Search the Story", which opens the search palette (below).
- **L1**, exactly and in this order: **Idea, Evidence, Exploration, Story**, each with its count:
  every item the stage holds (`stage_counts`, [§4.2](04-data-model.md),
  [decision](../decisions/each-stage-counts-every-item-it-holds.md)). Idea counts outcomes, Evidence
  sources, Exploration mockups, and Story its pages, of every kind.
  Below them, quieter: the **empty seat** while the person has no agent connected, the product's
  **Activity** (§7.9) and **Settings**, which opens the Settings dialog (§7.11) over the screen, at
  the product's General. The empty seat
  ([decision](../decisions/the-panel-keeps-an-empty-seat-until-an-agent-is-connected.md)) is a card,
  for everyone, saying "No agent connected", with Connect an agent as the panel's one accent button,
  which opens Settings at Agents. Nothing
  dismisses it; it goes once an agent is connected (the account-wide list, `GET /api/v1/me/agents`,
  which while empty is read again when the person comes back to the tab, with no polling), and
  nothing takes its place: agents are in Settings. A hidden panel is shown for the seat once a visit,
  never on a phone, where the drawer opens only by hand; while the panel is away the pill carries a
  mark with the same words.
  Exploration opens on its mockups, which are listed in its panel. The app's URLs follow the areas
  (`/evidence`, `/exploration/…`); REST and MCP name the objects (`sources`, `mockups`).
  Exploration was called Synthesis, and a link to `/synthesis/…` opens the same path under
  `/exploration/…`. Exploration once listed insights and decisions too; a link to one opens the
  source it became ([§4.7](04-data-model.md)), and a link to either list opens Exploration. It once
  held assumptions too: a link to one or to their list opens Exploration's mockups with a toast
  saying WhatBuild no longer keeps assumptions (§7.7).
- **Search** covers the whole product in one place, by plain words ([§8.2](08-search.md), plain
  mode); for a Story reader, the Story alone, with the Search screen under the Story's panel. A page from a
  mockup is listed once: as the mockup, under Exploration, or for a Story reader on the Story. The **palette** opens from the panel's Search field, ⌘K / Ctrl+K, or `/` when not typing,
  on any product screen. It springs into place with a small overshoot (it simply appears with
  reduced motion), and if it is left untouched for three seconds it flashes white once and settles
  to the lifted shadow. It opens as the field alone, with up to six **recent searches** under it
  when it is empty: searches followed through in that product (a result opened, or every result),
  newest first, kept in the browser and cleared at sign-out (§9.1); picking one fills the field, and
  Clear empties the list. Results come as you type, best match first (a kind named in the query
  before the rest), at most eight: each with its
  kind's glyph, its title with the words marked, what it is (Source with its date and its number
  of matches, counted as its Find in the text counts them for the same words, so opening it in its
  text shows "… of" that number; Mockup with the page), and a source's
  best place,
  saying where it is ("In its text", "In its summary", "In its notes", "In a comment"), or another
  result's matching text, in two lines; at phone width that text starts a few words before its
  first marked word, so the words it matched stay in view. Arrows (or Ctrl+N and Ctrl+P) move; Enter opens the selected result (a
  source matched in what it says opens at the place its line shows, even when its title holds the
  words too: its Text, which the summary heads, with the words marked when they are in the text;
  its Notes; or its Comments). The **All N results**
  button at the field's end (⌘Enter / Ctrl+Enter) opens the Search screen with the words, and
  empties the palette. Closing it (Escape or a click outside) keeps the words for next time; another
  product starts empty. A line under the field says how the words were read: a corrected word
  ("Showing results for quote."), a kind brought first, or that nothing holds every word. A search
  typed past or left behind is cancelled, on the server too ([§8.8](08-search.md)), and one that
  fails is not asked again by itself: the palette says what the server said, the Search screen has
  "Search didn't finish" with its message and a button to try again, and the next word typed asks anew.
  The **Search screen** (`/search?q`) has the same field, searching as you type, and lists the
  results under the product's four areas, each a sheet in the panel's order: **Idea** (the product
  concept, then outcomes), **Evidence** (sources, each with the best three places it says the
  words, each saying where and opening there as the palette's do, and "N more places in this
  source"), **Exploration** (mockups) and
  **Story**. A kind named in the query brings its area first. When nothing holds every word, each
  result also names the words it lacks ("Missing: …"), which the palette leaves to its line,
  "Nothing has all your words.". The panel shows Everything and each
  area with its count (`?show=idea|evidence|exploration|story`). With `record_id` it lists every
  place one source says the words, each opening at its own match, with a link back to searching
  everything. A corrected word
  offers "Search for <word> instead" (`?strict=1`). When more match than the 60 listed, it says
  "Showing the best 60 of N. Add a word to narrow them.", and the palette's All N results counts
  every match. Nothing holding the words says "Nothing matches" and suggests another word or fewer
  words. An outcome found opens Idea scrolled to it and marked (`?outcome`). A Story reader searches the Story alone ([§8.2](08-search.md)).
- **A Story reader** ([§3.5](03-accounts-and-identity.md)) has only the Story: L1 is **Story**
  alone with its count, and the quiet group holds only the empty seat, until they have an agent
  connected, and Settings, which opens at Account. The product opens on the Story, and any other
  product screen, opened by a link or typed, takes a Story reader to the Story, with a toast saying they
  can read only this product's Story.
- **A context slot** under the navigation, which the screen fills: the page tree on Story, the
  filters on Evidence, the mockups and the three lists with their filters on Exploration.
  Each of its sections is a group named by its title, a heading, so a screen reader can move
  between them as it does between the inspector's groups.
- **The footer** holds the account menu, which is only about the person: their email; on a
  product where they get the tutorials, its one item first ([§7.4](#the-tutorial)): **Take the
  <page> tutorial** for the page on screen (Idea, Evidence, Exploration or Story, a source's own
  screen counting as Evidence), or **Take the WhatBuild tutorial** elsewhere, with its number of
  stops under it; **Settings**, which opens the Settings dialog at Account; the theme (Light, Dark or System, which
  is the default; remembered per browser); **Instance admin**, for an owner of the instance only
  (§7.11); **Submit feedback**; and **Sign out**. Joining an organization adds nothing to it: an
  organization's people and plan are in Settings, and starting another organization is in the
  product switch. Last, under a hairline, is the release this
  WhatBuild runs, from `/api/v1/meta`: "Release v0.3.1", or "Commit 1a2b3c4" for a
  build that is not a release, linking to the release notes or the commit on GitHub in a new tab;
  the commit and build time stay in `/api/v1/meta`. A development
  server says so instead.
- **Submit feedback** opens a dialog: a kind (Bug, Improvement, Feature request or Other; none
  chosen sends Other, and choosing one again clears it), the message, whose label and prompt follow
  the kind, and a well that says what is sent (their words, the kind, the release and the part of
  the app they are on, such as "Evidence, a source", never an organization, product or item) and
  what is not (their name, their address, their organizations and anything in them), with a box to
  share their address with the developer of WhatBuild so they can reply; the dialog never shows the
  address itself. The well changes as they choose. `⌘↵` / `Ctrl+↵`
  sends; a draft survives closing the dialog; past the day's limit the dialog says so
  ([§6.9](06-operations-and-adapters.md#69-feedback)).
- **Hiding.** The panel hides completely, never to an icon rail, with its button or `⌘\` / `Ctrl+\`
  (ignored while typing in a field), and the choice is remembered per browser. While it is hidden
  a small floating pill with the mark brings the panel back. It is the same size whatever the
  product is called, and its accessible name gives the product and the current section.
- **The content does not move up or down** when either panel hides or shows, or in focus mode: the
  canvas keeps clear of the pill and the square at the sides.
- **The inspector** hides and shows the way the panel does: a hide button in its head, `⇧⌘\` /
  `Ctrl+Shift+\`, and, while it is hidden, a small square at the top right that brings it back.
  Shown, it docks beside the content at every width above a phone, so the page still scrolls and
  works beside it. Above 1100px the choice is remembered per browser; at 1100px and below it
  starts hidden, and it hides again whenever the window crosses 1100px.
- **On a phone** (760px and below) the panel and the inspector are drawers with a scrim, one open
  at a time: focus is trapped, Esc closes the open one, and it closes on navigation.
- **One panel everywhere**
  ([decision](../decisions/the-panel-shows-one-product-and-everything-else-is-in-settings.md)). The
  panel always shows one product of one organization, with the same rows on every screen and for
  every role, an instance owner's included; it never turns into another panel, and only Instance
  admin, a place of its own, has a different one (§7.11). On a screen that is
  no product's own (the overview, a page that wasn't found) it shows the product the person was last
  in, or else their first, their own organizations' before the example organization's, and marks
  none of its rows current; its Search reaches that product. An organization with no product the
  person can open (`/t/<organization>`, or the overview for someone with no product at all) shows
  the organization's name in the switch, over "No products yet", and where the four sections would
  be, **Start your first product** with **Create a product** for its owners, admins and product
  creators, or "Nothing to open yet. An admin of <organization> can give you a role on a product."
  for anyone else; then the empty seat while no agent is connected, and Settings, at the
  organization's General (its People for someone who is not an owner or admin).
- A skip link leads to the content; on a route change focus moves to the new heading and the page
  is announced politely.

**Switching.** An account may belong to several organizations (tenants), and an organization
holds several products. A person must always know where they are, and move without losing their
place.

1. The current product, with its organization, is shown at the top of the panel on every
   screen but Instance admin's.
2. The product switch is one interaction away on every screen, and shows one organization: its
   products, the current one checked; **New product** where the person may create products there,
   which opens in place on that organization; then **Switch organization**, the person's other
   organizations (their own before the example organization, which is left out for a guest who
   chose to hide it), each opening the product they last had open there, or else its first; and
   **New organization** while they may start one (`/welcome`).
3. **Switching product keeps the section**: from Evidence in product A to Evidence in product B.
   Idea, Evidence, Exploration, Story, Activity and Search carry over; anything else
   (a record id, a mockup) lands on Idea. Switching to a product where the person is a Story reader
   lands on its Story.
4. The product is in the URL path (`/t/<tenant>/<product>/…`). Opening a link to another
   product simply works, and becomes the remembered one. An address written when products were in
   teams (`/t/<tenant>/<team>/<product>/…`) is taken to the product's address with the rest of its
   path, its query and its fragment, once `products.list` has loaded: to the product whose
   `former_paths` names it, and otherwise to the same address without the middle part
   (`FormerProductAddress`, `apps/web/src/routes/addresses.tsx`;
   [§3.11](03-accounts-and-identity.md#311-when-there-were-teams)). A path that is neither answers
   Not found.
5. `/` opens the overview for anyone in an organization, and first run for anyone in none. The
   last-used product is remembered per browser, and so is the last one in each organization, until
   the person signs out or their session ends ([§9.1](09-data-lifecycle.md)); Connect an agent
   names it in its example request. `/t/<organization>` opens the product the person last had open
   in that organization, or else its first, keeping the address's query (so
   `/t/<organization>?settings=organization/people` opens Settings over it); with none they can
   open, it is the organization's own screen (One panel everywhere, above), whose page says the same.
6. Archived products appear only on the overview, behind "Show archived products" under each
   organization that has any, which opens that organization's alone (`?archived=<organization
   slug>`, repeated for each organization opened), read-only, and an admin restores them in the product's
   Settings, under General. Inside one, no control offers a change the server would refuse: outcomes are not
   dragged and have no actions menu, as for a viewer. Roles are access, not content, and
   `members.grant` and `members.revoke` still work on an archived product, so its Settings keep
   People for admins and say so above the list.
   A read-only organization, one moved back to the plan new organizations start on while whoever
   started it has another there ([§3.3](03-accounts-and-identity.md#33-tenants)),
   says so above every screen of its products: that nothing new can be added, what everyone can
   still do there (one sentence the server's refusal shares, `packages/core/src/read-only.ts`:
   read, export and delete what it holds, and take people out, as their roles allow), how long it
   is kept, and **See plan** for anyone who reads more than the Story there. Inside one, as on an archived product, no control offers a change the
   server would refuse (`409 organization_read_only`), and a screen that would invite one (Add a
   source, a new entry) says why in its place; deleting and export stay. **See plan** opens
   Settings at the organization's Plan. Its People in Settings says so
   too, and offers only what still works there: removing a role, taking someone out and cancelling
   an invitation, with no Add people, no change of role and no change of its name.
7. On the overview, an organization where the person has no product role says so, and that
   there is nothing to open until an admin gives them one.
8. No screen but Instance admin has a panel of its own, and nothing about an organization or the
   person is a screen in the panel: it is in Settings (§7.11).

**The overview** (`/`, [decision](../decisions/the-overview-is-the-front-door.md)). The page that
introduces WhatBuild and is good to share as a screenshot. An intro sheet carries the mark and
wordmark, the question "What to build?", the tagline "Product engineering at the speed of AI
engineering.", the sentence the public site's landing pages open with on what WhatBuild is, and a link to Connect an agent, which opens
Settings at Agents over it. Beside the overview the panel shows the product the person was last in
(One panel everywhere, above), marking no row current. Beside the intro, small and
quiet, "From idea to story": Idea, Evidence, Exploration and Story, each with a line on what a
team does there. It carries no counts; those are on each product below. Below, one sheet per organization, headed by its name alone, lists its active products (name,
product concept as plain words clamped to two lines, its Markdown markers dropped, last update), each
with links to Idea, Evidence, Exploration and Story and their counts, so any section of any product
is one click away. A product where the person is a Story reader says "You can read its Story."
in place of its concept, and links to the Story alone, with its count. An organization's owners,
admins and product creators get **New product**, a dialog on the overview
(`?create=<organization slug>`, or `?create=1` for the first organization they may create in), so
cancelling leaves the person there; it asks for the organization only when they can create in more
than one; a product creator is told they will be its admin;
and when the organization already holds all the products its plan allows it says so in the words
of a plan's total reached ([§7.1](#71-principles)), with Compare plans, and Create stays disabled.
An organization with no product the person can see says so, and, to someone who cannot create
one, whom to ask. The
overview is the only list of products: `/products` redirects to it. Roles are not shown here: who
has which role, the person's own included, is in Settings under the organization's People.

## 7.3 Routes

```
/signin  /welcome  /invite/:token             sign-in, first run, answering an invitation
/join/:code                                   → / (the public sandbox's retired invitation links)
/cookies                                      Cookies: what they are for, and the analytics choice; readable signed out
/plans                                        Plans: the plans offered side by side, with their prices; readable signed out
/                   ?archived=1&create=1      the overview: what WhatBuild is, and every product; new product; first run with no organization
/products                                     → / (with its query)
/account-deleted                              Your account has been deleted (signed out)

any screen          ?settings=<section>       Settings, the dialog over the screen (§7.11): product, product/people,
                                              product/export, organization, organization/people, organization/plan,
                                              organization/access, account, agents; a section keeps its own query
                                              (agents: ?reach&product&org; account: ?delete=account)

/admin                                        → /admin/organizations (Instance admin, instance owners only; anyone else: Not found)
  /organizations    ?org=<slug>               every organization with its plan; org: the plan dialog over the list
  /people                                     every account, and removing one
  /plans                                      the plans, every limit with its refusal, this deployment's limits (where plans are offered)
  /guests                                     how guests come into the example organization (where there is one)
  /starting                                   who can start organizations, and the waitlist

/t/:tenant                                    → the product last open in it, or its first, query kept; with none, the organization's own screen
/t/:tenant/members                            → /t/:tenant?settings=organization/people (#delete-org-title: ?settings=organization)
/t/:tenant/plan  /t/:tenant/limits            → /t/:tenant?settings=organization/plan
/connect                                      → /?settings=agents, query kept
/settings                                     → /?settings=account, query kept; a page of its own for a guest still
                                              waiting for a place, or someone in no organization
/instance                                     → /admin/organizations, query kept
/people                                       → /admin/people

/t/:tenant/:product                           → …/idea
  /idea               ?status&outcome         the product concept, outcomes with counts (outcome: one a search opened, marked)
  /evidence           ?tags&added_by&date_from&date_to&query&include_archived&sort&order
                      (date_from, date_to: the date captured; query: words in titles, tags or attachment
                      names; both from a link)
  /evidence/new                               intake: describe it, add attachments, create
  /evidence/:record   ?view=text|notes|comments|attachments &find=<words>&at &include_archived
                      (at: where the match a search hit's line shows starts, so the find starts there;
                      include_archived: Comments lists the archived comments too)
  /search             ?q&show&record_id&strict
  /exploration                                → …/exploration/mockups
  /exploration/mockups                        → the mockup last opened here, or the most recent; first use with none
  /exploration/mockups/:id  ?v=N &page=<page_id>  a mockup's canvas, at a version, with a page selected
  /exploration/assumptions[/…]                → /exploration/mockups, with a toast: WhatBuild no longer keeps assumptions
  /exploration/insights/:id  /exploration/decisions/:id   → /evidence/:id (the source it became)
  /exploration/insights  /exploration/decisions          → /exploration
  /synthesis/…                                → the same path and query under /exploration
  /story[/:page]      ?v=N &page=<page_id>  a page, at a version; on a whole canvas, with one of its pages selected
  /activity           ?entity_type &entity_id
  /connect                                    → the product's first screen ?settings=agents, query kept
  /settings                                   → the product's first screen ?settings=product (#people: product/people)
```

An address from before Settings was a dialog opens it at the section that took the old screen's
place, with the old address's query kept (`apps/web/src/routes/addresses.tsx`), so links in mail
already sent, and bookmarks, keep working.

**The public site** is not part of the app: on the site's domain (served by the Cloudflare Worker,
or by the image on the host named by `WHATBUILD_SITE_URL`), `/` and `/what-to-build` are landing
pages, `/plans` the plans side by
side, `/privacy` the privacy notice ([§9.1](09-data-lifecycle.md),
[decision](../decisions/the-privacy-page-is-a-page-of-the-public-site.md)), and every other path
redirects to the app. Whoever serves a page writes into it what only the
service knows (`whatbuild-site`, the answer of `GET /api/v1/plans`): the plans as an instance owner
set them, whether anyone may sign up as a guest, and who runs the deployment, where to write and who
else handles the data, for the privacy page. The Worker asks the service for it through
Cloudflare's cache, an hour at a time; without it, a page shows the plans as the build has them,
and the privacy page says it did not load.

**The landing pages** ([decision](../decisions/the-site-opens-on-landing-pages-the-scroll-tells.md))
tell the same six steps, one plain statement per screen with a sentence under it, beside a picture
the scroll moves: "Product engineering at the speed of AI engineering"; everything you know about
your users in one place; your agents work on the evidence itself; explore product concepts; tell the
story of what you are building; your coding agent builds straight from the concept. At `/` the
words scroll up beside a picture that stays put; `/what-to-build` is always dark and pins its stage,
the window, while the scroll runs each scene, under "What to build?". On a narrow or upright window
the picture takes the top and the words the foot. A Scroll prompt bobs gently at the foot of the
first screen and goes once the page moves; with reduced motion each scene shows settled. Where
anyone may make an account (`sign_up` in what the page is told), **Start using WhatBuild** signs them in and
goes to `/start`, which starts their organization or puts them on the waitlist
([§3.2](03-accounts-and-identity.md#32-accounts-and-sign-in)), and the last screen repeats it as a
large button; where nobody may yet, it leads to the form at the foot, which asks for an email only
and records it (`POST /api/v1/interest`, with the page it was sent from). The price of each plan
with one and Compare plans sit under it. Links to sign in carry `?landing=<the page's path>` through
sign-in, which the app sends once (`POST /api/v1/me/came-from`). Nothing on either page asks the
service anything until someone sends the form or follows a link to sign in. Behind Cloudflare the
Worker sends a share of the visitors to `/` (`LANDING_SPLIT`) to `/what-to-build/`, the same
visitors each time and never a crawler, to compare the two
([decision](../decisions/the-landing-pages-are-compared-by-a-split-at-the-edge.md)). While guests
may sign up, looking comes first: **Explore the demo** (sign-in, then the example organization as a
guest) is the filled button, with Start using WhatBuild beside it as the quiet one, and the last
screen says what a team builds in the demo, from the deployment (`example_about`: the first sentence
of its first product's concept), over a large Explore the demo and "Or start using WhatBuild"; the
plans page says the same. The newcomer's words promise neither "free" nor "now". On the app's origin, which is where a deployment without a site
host has them, they are at `/site/`, `/site/plans/`, `/site/privacy/` and `/site/what-to-build/` (in development,
`http://localhost:5273/site/`, where the pages ask the local server)
([decision](../decisions/the-public-site-is-pages-built-with-the-app.md)). When the deployment
uses Google Analytics, whoever serves the page writes the measurement ID into it (a
`whatbuild-analytics` meta tag), and the page shows the same cookie choice as the app, with Cookies
in its footer to change it; a request to hear from us is counted as `generate_lead`
([§9.1](09-data-lifecycle.md)).

An address under `/t/:tenant` that names an organization by a slug it had before moves to the same
address with its current slug, query and fragment kept (`CurrentTenantAddress`), once the person's
organizations have loaded and show that slug among the organization's `former_slugs`; meanwhile
the server answers the old slug too ([§3.6](03-accounts-and-identity.md#36-addressing-and-isolation)).

Older source links resolve too: `?view=passages` opens Text, and `?view=original` and
`?view=files` open Attachments, where an attachment is shown; `?tab=passages` opens Text,
`?tab=preview` and `?tab=files` Attachments, `?tab=notes` Notes, and `?tab=connected` the
inspector. A product path without the `/t/` prefix (`/<tenant>/<product>[/…]`, as people type
or paste it, or the three-part path from when products were in teams) redirects to the same path
under `/t/`.

The document title is "<screen> · <section> · <product> · WhatBuild", with a screen named after
its section ("Evidence") said once. A screen shown in place of another names itself, never the one
it stands in for: an address the app doesn't know is "Not found · WhatBuild", a product that
answers `404` "Product not found · WhatBuild", and an error no screen handles "Something went
wrong · WhatBuild". Instance admin's screens are "<section> · Instance admin · WhatBuild". Settings
leaves the title of the screen under it as it is.

The Story print view is served by the API, not the app: `GET
/api/v1/p/<tenant>/<product>/story/print?page_ids=…` returns one HTML document, opened in a
new tab ([§7.8](#78-story), [§6](06-operations-and-adapters.md)).

## 7.4 Sign-in, and the first ten minutes

1. **Sign in** (`/signin`) with an email link, Microsoft or Google, whichever the deployment configures
   ([§3.2](03-accounts-and-identity.md)); in development, one click signs in as any account on
   the server (`GET /auth/dev-accounts`): the sample's people first, then the newest, each with what
   it is there ("Owns Fieldnote Studio (Pro)", "Guest, on the waitlist"), the first 40 of them, or as
   any address typed above. Asking for an email link answers, under "Check your email", "Look
   in <address> for an email from WhatBuild called “Your WhatBuild sign-in link”. Its link works
   for 15 minutes.", the mail's own subject, so the person knows which mail to look for among the
   rest, and never that a link was sent, since the page doesn't say who can sign in (in
   development, a note that the link is printed in the server's terminal follows), with Use
   another email. An email link opens a page the server renders, "You’re about to sign in as
   <address>.", whose one button, Sign in as <address>, signs in and returns to `next`, with "Not
   you? Close this tab and nothing happens." under it. A sign-in refused as invite-only says to
   ask someone who uses WhatBuild for an invitation, and, on a deployment with a public site, to
   join the waitlist at its address, linked to the site's form. A refused Microsoft sign-in says to
   write to the deployment's contact, where it names one, with the reference. Wherever sign-in returns to is a path on this origin or `/`,
   by the server's rule (`safeNext`). Under the form are links to Privacy and Cookies. Where anyone
   may make an account (`open` in `/auth/methods`), a line says signing in creates their account;
   arriving from Start using WhatBuild (`next` is `/start`), the title is "Start using WhatBuild". Privacy is the notice
   of what is kept and why ([§9.1](09-data-lifecycle.md)).
2. **The example organization first.** A new account with no organization of its own lands on the
   overview, where the example organization ([§3.10](03-accounts-and-identity.md)) is listed,
   tagged Example organization and Read only, under a sheet, **Your own organization**, that says
   "Your team’s work goes in an organization of your own." and offers **Start your own
   organization**: a link to `/welcome` where the account may create one, or, where it may not, a
   button that takes one of the day's places and goes to `/welcome`, or puts them on the waitlist
   ([§3.2](03-accounts-and-identity.md#32-accounts-and-sign-in)). Once they are on it, the sheet
   says only "Your organization is on its way. We’ll email <their address> as soon as it’s
   ready.", as every screen that says they are on the waitlist does.
3. **First run** (`/welcome`): name the organization and the first product in one form, for an
   account that may create one ([§3.3](03-accounts-and-identity.md)). The sheet holds the heading
   ("Welcome, <first name>"), "Name your organization and its first product.", the Organization
   ("Your company or group."), Product ("The product you’re working on.") and Product concept
   fields, and Start organization; under the button, for someone who is not an instance owner,
   where the deployment offers plans, one muted line names the plan the organization starts on,
   "It starts on the Free plan.", with Compare plans opening `/plans` in a new tab so what is typed
   stays. The plan's limits wait until one is reached, and what whoever runs this WhatBuild sees of
   an organization is on its Plan page; a deployment that offers no plans shows no line. Under the
   sheet are Privacy and, for someone with an organization of their own, Back to your products.
   The same form, titled New organization, starts another. An account in no organization that may
   not start one reads "You’re not in an organization yet." (with "Accept an invitation to join
   one." when one waits) and the same **Start your own organization** as the overview, or the
   waitlist line once asked. One that has started all it may reads, under "You can’t start another
   organization", "To start another organization, write to <contact>." where the deployment names
   a contact (`WHATBUILD_PRIVACY_CONTACT`, as the organization's Plan page uses it), or "ask this
   WhatBuild’s owners" where it names none. Its link back leads to the example organization for
   someone with none of their own. A person who was invited
   finds the invitation wherever they land once signed in, here too, or follows its link
   (`/invite/:token`), and joins by accepting it.
4. Invite colleagues with **Add people**, in Settings under the organization's People or the
   product's, by email or a single-use link.
5. **Connect an agent.** The new product opens on Idea, whose first sheet, for someone who can
   write there and has no agent connected, is **Connect your agent** (§7.5): the steps for the
   agent they choose, the same as in Settings → Agents (which the empty seat opens, and `/connect`
   leads to). They copy one address (for Claude Code, a command), add it in their agent, sign in on
   the WhatBuild page it opens, and come back ([§6.8](06-operations-and-adapters.md)).

No page is readable without an account. Someone who wants to look before committing to anything
signs up and reads the example organization as a guest while there is room
([decision](../decisions/guests-come-into-the-example-organization-while-there-is-room.md)). The
synthetic sample `pnpm db:seed` creates is visible only to its seeded accounts.

### The tutorial

Spotlight tutorials (`apps/web/src/tutorial/`) show someone around a product: the screen darkens
around one thing at a time and a small bubble names it. There are five short ones rather than one
long one ([decision](../decisions/the-tutorial-is-five-short-ones-each-starting-the-first-time-its-page-is-opened.md)):
the **WhatBuild** tutorial, a welcome to the app as a whole, and one for each of a product's four
pages, **Idea**, **Evidence**, **Exploration** and **Story**, each on its own page.

- **Who.** Someone who can edit the product they are in (an editor or admin, the product not
  archived, the organization not read-only), and a guest of the example organization. Viewers and
  Story readers given those roles get nothing, and nobody in a window narrower than 1024 pixels,
  the narrowest its layout was designed and checked for (`TUTORIAL_MIN_WIDTH`, its own query, not
  the app's phone width): no offer, nothing starting by itself and no menu item, and a tutorial
  that is up closes where it is, with the toast "The tutorial is in your account menu." (none at
  phone width, where the panel is a drawer).
- **The welcome first.** Offered once per person, on the first screen they land on that shows the
  panel of a product where they get it, the overview included, before they click anything: a
  welcome over the darkened screen, "Take the WhatBuild tutorial?", "Under a minute: the four
  pages, and an agent at work.", beside their avatar "Each page has a short tutorial of its own the
  first time you open it. They stay in your account menu.", with **Turn off tutorials** (quiet, at
  its left), **Not now** and **Start the tutorial**. On a screen beside the product (the overview, a
  page not found), what decides is the product its panel shows, and Start the tutorial goes to that
  product's Idea and begins there; with no product in the panel, nothing is offered until there is
  one. A guest is offered it on their first screen with a product of the example organization in
  the panel; someone offered it as a guest is not offered it again on a product of their own. The
  rule is one function (`tutorialFor`), fed by the product's own screens and by the panel beside
  them.
- **Then each page's own, the first time.** Once the welcome has been offered, each page's
  tutorial starts by itself, a moment after the person arrives, the first time they open that page
  (Idea and Evidence at their own address, so a source's own screen starts nothing; Exploration and
  Story at any of theirs), with nothing else up and no Settings dialog open. Each arrival at a page
  decides once, and closing a tutorial is no arrival: the welcome closed on Idea leaves Idea's own
  for the next time the person opens Idea. Nothing starts by itself on a screen beside the product
  but the welcome. The rule is one function (`dueTutorial`).
- **Shown once.** A tutorial counts as shown as soon as it starts (the welcome as soon as it is
  offered), so none starts by itself twice; closed part-way, it is taken again from the start.
  Afterwards each is in the account menu (§7.2), which every screen with such a panel has: **Take
  the <page> tutorial** for the page on screen, a source's own screen counting as Evidence (taken
  there, it goes to the list of sources first), or **Take the WhatBuild tutorial** elsewhere, with
  its number of stops under it. Taken on a screen beside the product, the WhatBuild tutorial goes
  to the product's Idea and begins there.
- **Turning tutorials off.** **Turn off tutorials**, at the left of the welcome and of every
  stop's foot but the seat's, closes the tutorial and keeps on the account that tutorials are off,
  with the toast "Tutorials are off. Turn them on again in Settings." and **Undo**. Off, nothing
  starts by itself, the welcome included; every tutorial stays in the account menu, and a tutorial
  taken from there while they are off has no Turn off tutorials. Settings → Account (§7.11) turns
  them on again.
- **Remembered on the account**, not in the browser: which tutorials have been shown, and whether
  tutorials are off, which `GET /api/v1/me` gives as `tutorial` and `PATCH /api/v1/me` keeps when a
  tutorial starts and when they are turned off or on
  ([§3.2](03-accounts-and-identity.md#32-accounts-and-sign-in),
  [decision](../decisions/the-tutorial-is-remembered-on-the-account-and-reached-by-no-agent.md)).
  A reload, a sign-out, leaving the product, the browser's Back to another page, or a guest's gate
  taking over closes a tutorial that is up, without a word; the screen arrived at decides what
  starts next.
- **The stops** (`stops.ts`), each a thing's own name and at most one line:
  - **WhatBuild**: the main navigation (**Main navigation**, "Four stages of product discovery."),
    then the agent stage (**Agents**). It lights the product's own screen, with no examples, on
    whatever page it starts on.
  - **Idea**: Idea in the navigation ("Your product’s elevator pitch."), the product concept, its
    **More info** button ("Each card has text behind its picture."), its text, open ("The same
    concept in words, for agents to read."), and the outcome (scrolled to).
  - **Evidence**: Evidence in the navigation, the example source's row in the list (**Sources**,
    "Select a source to preview it."), and its preview, open on its whiteboard photo (**Preview**,
    "What’s visual in a source: whiteboard photos, slides, recordings.").
  - **Exploration**: Exploration in the navigation, the canvas, its toolbar as a labelled diagram
    (**Toolbar**, "The same commands, and their keys."), the inspector's View, Download as ZIP,
    and Promote canvas to Story.
  - **Story**: Story in the navigation, the list of Story pages, and Export to PDF.

  While the person has no agent connected, every tutorial ends on the "No agent connected" seat
  (**Connect an agent**, "It takes about a minute."), so the longest, Exploration's, is seven stops;
  with an agent connected there is no seat, and each ends on its own last stop, whose button reads
  Finish. A bubble has a bar of one segment a stop, "2 of 4", the thing's own name, at most one
  line, then Turn off tutorials, Back (from the second stop) and Next, or Finish on the last stop;
  the seat's stop has Back, Finish and **Connect an agent**, which finishes it and opens Settings at
  Agents. A small close button at its top right closes the tutorial. Back and the primary button are
  the only ways to move, and no tutorial leaves its page.
- **What opens is pressed in front of the person, one stop at a time.** The More info stop lights
  the button alone with the text closed, and the source's stop the row alone, not selected, with
  the preview closed; each waits for Next. Next presses it: the button shows its press (its open
  state, with a brief pulse) and the text unfolds with the card's own fold as the light grows to the
  head and the text, or the row is selected and the preview opens beside the list as the app opens
  it and the light moves to it. The bubble's beak stays on the More info button at both of its
  stops. Back to the button folds the text and brings the light back to it; Back to the row closes
  the preview. Coming back to an open stop with Back shows its own state at once. With reduced motion the changes are made at once. Leaving the open stop closes
  what it opened.
- **The page holds still.** Nothing under the dark or in the light can be clicked, scrolled or
  opened; clicking the dark points at the close button (Not now on the welcome). No app shortcut reaches the page, and search (/,
  ⌘K) does not open, even with focus on what is there to be tried. Two things are there to be tried: at the canvas
  stop the canvas works, with its keys 1, 2, 3, V, H and F (each key cap in the bubble turns green
  with a check once that key or its toolbar button is used), and the View switch two stops on.
  Entering the canvas stop puts the canvas back whole, in Canvas view and pan mode. F, and the
  Focus control beside the canvas (Show panels, in Focus), which the light takes in, go in and out of
  Focus there as on a canvas: the panels hide, the canvas takes the window, the light follows it,
  and the bubble moves inside the light at its top left, clear of the toolbar and of Show panels.
  Leaving the stop in any way (Next, Back, the close button, Esc) ends Focus first. That Focus is the
  tutorial's own: the person's Focus choice is never changed, as pan and interact are not kept. F
  works at no other stop.
- **The toolbar diagram.** The stop after the canvas lights the canvas's toolbar, shown and not
  live, and labels every control with its name and key, all at once: Pan H, Interact V, Zoom out −,
  Zoom in +, Fit the page 2, Fill the width 3, Fit the canvas 1, Previous page ←, Next page → and
  Keyboard shortcuts, the names and keys taken from the toolbar's own definitions (`CANVAS_TOOLS`)
  and the controls' places from the toolbar on the screen. The labels are the tutorial layer's, not
  the toolbar's: they stand in rows above the bar on its two sides, split where one of its groups
  ends, each on a thin leader line that rises from its control and turns to it, the outermost
  control's lowest, so none crosses another or a label; where the bar has wrapped its last group
  onto a second row (at 1024 wide), that control's line leaves along its row past the bar's edge
  first. The bubble sits above, clear of the bar and every label. A screen reader hears the controls
  and their keys as a list, once, with the stop. The canvas arrives at it in Canvas view with the
  panels showing, whatever was done at the stop before. No other shortcut works
  while it is up. The panel and the inspector are shown and Focus is off while it runs, but for F
  at the canvas stop; the person's own choices come back after.
- **Its examples** are fixed content that ships with the web app, one object per page
  (`content/`), which each page's tutorial (not the WhatBuild tutorial) draws through the components that draw a product's own (the Idea cards, the list
  of sources and its preview, the canvas and its inspector, the Story's tree, page and inspector)
  in place of the product's own content, which comes back when it closes. They are drawn as an
  editor sees them, for a guest too, and inert. The product's name, organization and counts in the
  navigation stay its own. Each carries a **Tutorial** badge, and every page says, in place of the
  example organization's banner, "**Tutorial examples.** They disappear when you close the
  tutorial. Agents never see them." No request for them reaches the server, and no agent can
  reach them
  ([decision](../decisions/the-tutorials-examples-are-fixed-content-shipped-with-the-web-app.md)).
- **The agent stage** takes most of the screen: on the left a chat with the person's own agent, in
  the opposite theme to the app's so it reads as another application; on the right a small
  WhatBuild, in the app's theme, whose pages fill in as the agent calls one MCP tool for each;
  under them the four pages with the tools that write them. It is played back and loops; Replay
  starts it again. Its foot has Turn off tutorials, "Agents never see the tutorial examples.",
  Replay, Back and the primary button.
- **Closing.** The close button and Esc close it: the bubble shrinks to a pill ("Tutorial · 2 of
  4"), the dark lifts, the examples fade and the product's own content comes back, and the pill
  flies into the account button, which pulses once; then the toast "The tutorial is in your account
  menu." with **Show me**, which opens the account menu. Not now does the same with "Tutorial", and
  Turn off tutorials with its own toast. Taking a tutorial from the account menu flies the pill back
  out to its first stop. Finishing says "Tutorial finished. It stays in your account menu." With
  reduced motion nothing flies and the stage shows its last frame; the account button still pulses.
- **Access.** The bubble, the welcome and the stage are dialogs named by their title and described
  by their line; focus goes to the primary button at each stop, stays in the bubble and what is
  there to be tried, and goes back where it was when the tutorial closes. Each stop is announced
  politely. Within the window the bubble keeps beside what it names, on another side or narrower
  where its own side has no room.
- **In step with the screens.** The tutorial shows the app's own screens, so a change to anything
  it lights or names (a screen, a control's name, a canvas key, an agent's tool) changes the
  tutorial in the same change. `apps/web/test/tutorial-screens.test.ts` fails when one of them has
  moved from under it:
  - every class and attribute a stop lights is still drawn by the app's own code;
  - every control a stop names is still written there;
  - every key the canvas stop asks for is still a canvas key;
  - every tool and action the agent stage plays is still offered to agents.

## 7.5 Idea

The screen's model and names are a decision: [A product starts with its idea](../decisions/a-product-starts-with-an-idea-concept-and-outcomes.md).

The landing screen, built of cards
([decision](../decisions/idea-cards-have-a-front-for-people-and-a-back-for-agents.md)). The
product concept's card first, across the content band; then **Outcomes** with their count, and the
outcomes' cards one under another, in order, each as wide as the concept's and as tall as what it
shows.

**Connect your agent** ([decision](../decisions/idea-leads-with-connect-your-agent-until-an-agent-is-connected.md)).
For someone who can write in the product while their account has no agent connected, the first
sheet on Idea, above the product concept, is Connect your agent, with "Not connected yet" at the
right of its head (the neutral mark and word). One sentence: "Your agent does the writing here: it
reads your material and drafts outcomes, mockups and the Story." Then a choice of agent, **Claude**,
**Claude Code** or **Another agent** (a segmented control, remembered on the device,
`whatbuild.agent`), and four numbered steps for it, each saying where it happens:

1. "Copy WhatBuild’s address:" with `/mcp` and Copy; for Claude Code, "Copy this command:" with
   `claude mcp add --scope user --transport http whatbuild <address>`.
2. Where it goes. Claude: "In Claude, open Customize, then Connectors. Choose Add, then Add custom
   connector, name it WhatBuild and paste the address.", with a muted note that on a Team or
   Enterprise plan an owner adds it in Organization settings, then Connectors, and each person then
   chooses Connect beside it. Claude Code: "Run it in a terminal, then start Claude Code, type
   /mcp, choose whatbuild and choose Authenticate." Another agent: "In your agent’s settings, add it
   as a remote MCP server. Some call this a custom connector or an integration."
3. "<Agent> opens a WhatBuild page in your browser. Sign in there and choose what <agent> may do."
4. "Come back to this page. It says Connected once <agent> is in."

The steps are those of Settings → Agents (§7.11), from one component, with the plain address: the
agent is limited to one organization or product there. Nothing dismisses the sheet. It goes once an
agent is connected, which the account's list of agents (`GET /api/v1/me/agents`, read again while
it is empty whenever the person comes back to the tab or the window) tells it, with a toast,
"Connected. Ask your agent to start.", focus staying on the screen; it does not come back while
they have an agent. While it loads its address it shows skeleton lines, and a failed load offers
Try again.

- **A card.** Its head holds the title (the outcome's, with its place in the order, or "Product
  concept"), **More info**, and on an outcome its menu. Under the head is the front: the
  agent-drawn picture, in a sandboxed frame ([§4.2.1](04-data-model.md)), as tall as it is up to
  560px, the concept's and an outcome's alike, scrolling within beyond that (on a phone the
  card is as tall as its front, so no scroller sits inside the page's). More info opens the back,
  the Markdown agents read, between the head and the front, so both are in view: up to 420px tall
  on the concept and 300px on an outcome (and at most 56% of the window), scrolling within beyond
  that (on a phone it runs its full length), and closed, on an outcome, by who changed it last and
  when ("Updated by Riley Chen · via Claude, 2 h ago"), a move included. The button says whether it is open (`aria-expanded`). The text
  unfolds: its well grows from under the head over 320ms, the picture moving down with it, and
  its words fade in a beat behind; it folds back in 200ms, from wherever it is if reversed mid-way.
  With reduced motion the well appears and goes at once and only the words fade. Nothing on the screen names who a side is
  for.
- **No editing.** Agents write both sides of every card; the screen has no create or edit control
  for the concept or an outcome, and product Settings has no concept field. A card with no front
  yet opens on its text, over "No picture yet". For someone who can write, that box waits until
  they have an agent connected (Connect your agent is above until then, and the card shows its text
  alone), and then holds "In your agent, ask:" over the request to copy, shown as an empty list's
  request is. While the product has no concept, the concept card's request asks for the concept,
  with its picture, rather than for a picture of nothing; while the outcomes list is empty, its
  request asks for the concept and outcomes together, and the concept card asks nothing, so one
  request shows.
- **Dragging outcomes into order**, as photos are ordered in a listing, for anyone who can write,
  while archived ones are hidden. With a mouse the whole head drags a card (the outcome's number
  turns into a grip while the pointer is over it); on touch the number, which always shows its
  grip, drags it, since the head scrolls the page there. The card lifts and follows the pointer,
  its landing place stays marked with a dashed outline, the other cards glide aside (240ms) once
  the pointer passes their middle, and the page scrolls near its top and bottom edges. Released,
  the card glides into its place and the new order is saved once; Escape puts it back. Without
  dragging, the number is a button: pressed, it picks the card up (ringed in the accent, with a
  line under **Outcomes** saying how to move it); the arrow keys, Home and End, or a click on
  another card's head move it there; Enter or another press places it; Escape, wherever the
  focus is, puts it back; clicking or tabbing away from the cards places it where it is. Each step
  is announced. Nothing is saved until the card is placed. With reduced motion nothing glides.
- **An outcome's menu:** Archive or Restore, and Delete permanently for admins, whose dialog
  names what goes with the outcome, its picture and its text, only those it has. A viewer has no menu. Earlier versions are kept, and agents read and
  restore them (`outcomes_read(action="revisions")`); the screen does not offer them.
- A card holds nothing that points away from it: no links or counts of the mockups or Story pages
  that serve it ([§4.2](04-data-model.md)).

The panel's **Archived** section offers Hide archived (the default) and Include archived
(`?include_archived=1`), as Evidence does for sources; an archived outcome shows an Archived badge
and a quieter card, and offers Restore. With no current outcomes but archived ones, the list
offers to include them. With no outcomes, the list says what an outcome is ("An outcome is what the
product’s users should be able to achieve.") and gives the request to copy for an agent (interview
the person, then write the concept and outcomes, each a card with its picture and text).

**Empty lists** ([decision](../decisions/empty-lists-lead-with-the-agent.md)). Outcomes, Sources,
Mockups and the Story share one first-use state: "No … yet", what belongs
there, and a request naming the product for the person to copy to their agent, with Copy and no
other button. The line over the request says where to ask it: "In your agent, ask:" once they have
an agent connected; until then, on Idea, under Connect your agent, "Then, in your agent, ask:", and
on Evidence, Exploration and the Story "Connect an agent, then ask it:", Connect an agent a link
opening Settings at Agents, with this product chosen. Each request stands on its own, as a person
would paste it with nothing else (Evidence's asks the agent to add the notes and documents the
person gives it), and what belongs there names nothing the organization's plan refuses (Evidence's
leaves out photos on a plan that takes only documents). Where people add by hand, that
is the header's create action, a default button, as when the list has items; outcomes have none,
since agents write them. A filter over a list
with nothing in it shows the same state. Viewers see the words without the request.

## 7.6 Evidence

The sources, and everything for reading them.


- **Intake.** **Add source**, a plain button in the sheet's header, opens it. Three steps:
  **Describe it** asks for the title, the **date captured** (optional, with help text
  distinguishing it from today) and tags, offering the product's most used tags to add with one
  click ([§4.4](04-data-model.md)), and nothing else. **Add attachments** is one drop zone, optional,
  that takes any number of files, with no role to choose, and keeps out one past the largest file
  that can be uploaded, and a video, which WhatBuild does not keep
  ([decision](../decisions/whatbuild-takes-no-video-for-now.md)), saying so as it is picked (for a
  video, to add its transcript, or a link to where it lives in the source's summary, instead), so
  that no source is made for it; the same holds where attachments are added to a source. It says that they are read in the order
  listed and the first in which WhatBuild finds text becomes the source's text, which search reads
  ([§5.4](05-derived-layer.md)), which formats it reads, that a recording needs its transcript too,
  that no words are read from images or scanned pages, and that it keeps no video. **Create** makes the source and uploads each
  attachment with its progress, then opens the source, whose Text says how its attachment is being
  read ([decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
  Nothing asks what kind of material it is or where to file it.
- **Browse.** The panel's context slot, "Filter sources", holds single-select filters, each a
  link that sets a URL param: **Tags** (All tags and
  the eight most used, each with its count, and "All N" for the rest; `?tags`), **Added by**
  (Anyone and each person who added sources, with counts, shown when more than one person has or
  while the filter is on; `?added_by`) and **Archived** (Hide archived, Include archived; `?include_archived`). The
  tags and people come from `sources.facets`. While any filter is on, a "Clear filters" link sits
  above Tags. On a source page the same links lead back to the list.
  Paged. The sheet is titled **Sources** (the section stays Evidence). The filters in use,
  among them the words a link searched for (`?query`, matched in titles, tags and attachment
  names: "“…” in titles, tags or attachment names"), show as removable chips above the rows.
  Three dates are named the same everywhere: **date captured** (the source's own date: when the
  interview or call happened, or the date the document carries), **date added** (when it came
  into WhatBuild) and **details updated** (when its details, its title, date captured or tags,
  last changed, or it moved here from another product, or was archived or restored: the date
  updated of [§4.3](04-data-model.md), named for what it covers; its text, summary, notes,
  comments and attachments each say when they were written, and leave it alone). "Sort by" and
  a segmented control in the header order the list by date captured (the default, undated last),
  date added, details updated or title (`?sort=date|added|updated|title`). A small triangle beside the current order shows its
  direction; choosing it again reverses it (`?order=asc|desc`; dates start newest first, title A
  to Z). When the sheet is narrower than 680px the same choices sit in a menu. Each row shows what
  the source looks like (below), its title, its tags under the title, and at its end a paperclip
  with its number of attachments and one date: the one the list is ordered by. That is the date
  captured ("No date" when it has none), or "2 h ago" when ordered by date added or details updated,
  with who did it and the full time in its tooltip; ordered by title, it is the date added. The list
  loads a page at a time as its end comes near. The header
  counts the sources listed, with "of N" live sources while filters narrow the list (left out once archived
  sources are included). While more pages wait to load, the count is still exact when
  `sources.facets` knows it: with no filter, one tag or one person; only otherwise is it the rows
  loaded so far with a plus ("50+"). Archived rows are muted and marked Archived; a row says
  Reading while its text is read and Couldn't be read when that failed, and otherwise nothing of
  its text, whose status its source's page explains. Rows whose titles match
  another listed row also name the attachment their text was read from (or how many attachments
  they have, or none yet), so the twins can be told apart.
- **A source's face** in a row ([decision](../decisions/evidence-is-a-list-of-what-sources-look-like-with-a-preview-beside-it.md)):
  the first it can show of its first image's picture, then a PDF's first page, a deck's own picture
  or a picture of an HTML page, or the frame a video stored before has; a deck's card, drawn from slide one's title and its theme's colour; the
  **card** an agent drew of the source ([§4.6](04-data-model.md), [decision](../decisions/a-source-has-a-card-people-recognise-it-by.md));
  a small page of its own words; and an icon of what it holds. A recording's length, or a label such as
  "VTT" for words read from anything but a page of text, marks the corner. A face is paper in dark
  mode too, but for a source's card, which is WhatBuild's picture of the source rather than the
  thing itself and follows the theme, as the Idea's cards do. A card is framed from its route in
  the Idea cards' sandbox, on its 640 × 480 board scaled to the face, out of reach of the pointer
  and the keyboard, and loaded only once its row comes into view: each counts as a call, as every
  frame does ([§9.7](09-data-lifecycle.md)).
- **The preview beside the list.** The list opens alone. A click on a row opens the preview beside
  it, and a click that opens a new tab, **Open source** and Enter go to the source's page. The
  address holds what it shows (`?source=<id>&page=<n>`); a source further down than what has loaded
  is loaded on to, and one not in this list is said to be. Beside a preview a row keeps only its
  face, title and date, the sort is a menu and each column scrolls its own. On a phone the preview
  takes the screen, with a button back to the list. Up and down arrows (and J and K) move through
  sources, with the preview open or not; left and right through its pages; Space opens and closes
  it; Esc closes it. Keys leave a field, a menu, a dialog and a player alone.
  The header gives the title, then on one line the date, who added it and the source's tags.
  Its pages are the card, as large as the preview allows on its board, with the summary under it,
  whole (one page, its thumbnail the card); the source's own text when it is no attachment's; and each
  attachment, with its name, type and a download. An image shows its preview copy, and opens the
  image viewer on its original. A PDF shows page one and **Show all N pages**. A deck shows its
  picture or card above its slides' text. A Word document, a workbook, a transcript and a text show
  the words read from them. An HTML page is framed from its own route, with no scripts and nothing
  from elsewhere, which the preview says; past 4 MB it is treated as any other file. Whoever may give
  it a picture (anyone who reads the sources, but not a guest of the example organization) sends one
  drawn in their browser when they stop on a page that has none. A recording (audio) plays in the
  browser's own audio player, which fetches nothing until someone presses play, and says when it can't
  play here, with a download. A video stored before WhatBuild stopped taking video is never played:
  it shows the picture it has, if any, and says that WhatBuild no longer plays video, with a download. Anything else is an icon, its name, what WhatBuild can and can't do
  with it, and a download. A thumbnail for each page runs along the foot when there is more than one.
  Moving through sources costs no call: `sources.list` with `include_preview` holds what shows
  first, and what needs a call waits until someone has stopped on it for a moment.
- **Source page.** A source is the busiest object in the app, so the page is dense on purpose.
  - **Header:** the title and the actions menu, nothing else; every property is in the inspector.
    Below it the source's **card**, when an agent has drawn one, 480 pixels wide at most; then the **summary** ([§4.6](04-data-model.md)), whole: rendered Markdown, attributed to
    whoever wrote it last, with Edit for an editor. It is what people read of a source, so nothing
    above it competes and the text below starts folded. With no summary,
    an editor sees "Add a summary" and everyone else nothing. Both open a dialog holding the
    Markdown; saving it empty removes the summary. Saving names the etag of what the dialog opened
    (none for the first summary), so a change made meanwhile is never overwritten unseen: when
    someone changed it, the dialog says so ("Someone changed the summary while you were
    editing"), keeps the person's text in its box, shows theirs read-only under it as "Their
    version" to compare and copy from, and saves over it only with "Save mine over theirs"; when
    someone removed it, it says so and "Save" puts the person's back. Nothing keeps an earlier
    summary, so the notice says that saving replaces theirs. Editing the details (title, date and tags,
    offering the product's tags), adding attachments, archive, restore and delete (§7.10) are in
    the page's actions menu.
  - **Images.** When the source has image attachments, the image viewer (the one Attachments
    opens, below) sits right under the summary, before everything else: the first image fitted
    to a stage four-thirds as tall as it is wide (at most 56% of the window, and 640px), named,
    with its download, and the others a step away. It is a sheet of its own, flush on a phone.
  - **Sections**, a segmented control held in the URL as `?view=` (links, not tabs): **Text**
    (`text`, the default), **Notes**, **Comments** and **Attachments**, the last two with their
    counts. There is no outline, and no passage reader.
  - **Text** is the source's derived text ([§5.4](05-derived-layer.md)), rendered as Markdown,
    under a line saying where it came from and how long it is: "Read from interview.vtt" while it
    is still an attachment's text, "Written by Riley, 2 days ago" once someone wrote or edited it.
    It opens **folded** to its first nine lines, the last two fading into the sheet, when it
    runs longer; a click on the fade, or on "Show the whole text" under it, unfolds it for the
    rest of the visit. Its header holds **Find in the text**, which unfolds it, marks the words,
    says "1 of 4" and steps through the matches (the Previous and Next match buttons, or Enter and
    Shift+Enter), the words held in the URL as `?find=`, so a search hit opens here with them
    marked, from the match its line shows: `&at=` says where that match starts (its `match_start`,
    [§8.2](08-search.md)), and the find starts at the first match it marks from there, counted as
    they are drawn, so a word in a link's address moves nothing (without it, at the first). The find
    marks each word with any ending from the root search reads, but narrower where a root alone would
    mark unrelated words: a word whose ending doubled a letter marks its own forms ("planning" marks
    "plan", "plans" and "planned", not "plane"), a word of four letters, or one whose root would be
    shorter, stays whole ("note" and "notes" mark notes, not every word that starts with "not"), and an
    id is taken as written. What a line marks and the find does not (`data` for `date`, whose root is
    `dat`; `moving` for `move`; a word that differs by its accents; an id written as its words; a phrase
    with punctuation or a bold mark between its words; an image's description) has no mark to stand on,
    and the find starts at the next it marks. A very long text,
    unfolded, shows its first 300,000 characters and "Show all N characters", unless a find is on. Editors get **Edit**, once the text has
    loaded, a dialog holding the Markdown (saving it empty removes the text; it names the etag of
    the text it opened, and when someone changed or removed the text meanwhile it does what the
    summary's dialog does), and, when another attachment has text, a menu **Use an
    attachment's text** listing them, each confirmed in a dialog that says what it replaces; if
    the text changed while that dialog was open, it replaces nothing, says so, and offers "Load
    the latest" to say again what it would replace.
    A source with no text says why here, not in a status callout over the page: "Reading its attachment"
    while it is read, or what its status means and what to do (a recording needs its transcript
    as another attachment; its attachments are pictures, images or a PDF whose pages are pictures,
    from which no words are read, and an agent that can see them can write the summary and the
    text; a format not read; too large; could not be read; no attachment yet; or an attachment
    whose text it does not use), with the server's `status_detail` only where it says more (a size
    or an error). A source whose attachments are not read as text is labelled "Not read as text",
    never as a failure. Editors get "Use the text of <attachment>", "Add attachments" and "Write
    the text".
  - **Notes** (the source's notes, rendered Markdown attributed to whoever wrote them last, with
    "Edit notes" for an editor; with none, an empty state that says what notes are for, and
    "Write notes" for an editor; both open the summary's dialog, with its etag and its handling of
    a change made meanwhile) and **Comments** (every comment on the source, newest first, and
    "Comment" for an editor, which opens a form for a comment on the whole source with optional
    tags). Each comment's menu is named by who wrote the comment, when, and its first words, so
    that two by one person at the same time are told apart (where they start alike too, by which
    of them each is: "(1 of 2)"), and offers an editor **Archive…**, a
    dialog asking why, optionally (the reason stays with the comment; the activity log records
    only that it was archived), and an admin **Delete permanently…** (§7.10). Archived comments are left out until "Show N
    archived comments", at the section's foot, lists them under the others (`?include_archived=1`):
    muted, marked Archived with when and why, and with Restore in their menu for an editor. On an
    archived source, which is read-only until it is restored ([§4.6](04-data-model.md)), comments
    have no menu, an admin's Delete permanently… included.
  - **Attachments** lists every attachment under a line saying that each one's text is read and
    kept, that the source's text is taken from one of them (once someone wrote or edited it, that
    it was written here and follows no attachment; without a text, neither), and that attachments
    are never searched. Each row gives its name, how its text was read ("Text read · 12,345 characters",
    "Recording, 12:03 · no text", "Image · no text", "Scan · no text" for a PDF whose pages are
    pictures, "Format not read", "Too large to read", "Couldn't be read", or "Reading"), with the
    server's `status_detail` under it except for pictures, "The source's text" on the one it came
    from, its type in words (such as "Word document", not its media type), size, versions, and who
    added it when, adding "via <surface>" when it was not the web, as About does, with Download,
    and a menu with **Show it** (a PDF, an image, a recording, Markdown, HTML in a sandbox, or
    plain text, in a dialog; a recording with its length; never a stored video, which only
    downloads; an HTML page framed from its own route,
    `…/attachment/view`, in `<iframe sandbox="">`, never fetched into the app's page), **Use
    its text…** and **Read it again** for editors, the last not for pictures, which no reading
    finds words in. An image opens in a viewer with zoom (buttons, `+` `-`, `0` to fit, `1` for actual
    size, double-click, a pinch or Ctrl/Cmd and the wheel), drag to pan, full screen (`F`), and,
    when the source has several images, previous and next (the arrow keys) and a strip of
    thumbnails. **Add attachments** adds more, with no roles.
  - **Inspector,** titled Details: **About** (the three dates together — Date captured
    (or "No date"), Date added and Details updated, the last two each with "by <who>", adding "via
    <surface>" when it was not the web, the person who added it linking to the list filtered to
    what they added, and Details updated saying "Not changed since it was added" while neither
    its details nor its archiving changed; Tags,
    each a link to the list filtered to it; nothing else), "Activity on this source", and
    Archive.
- **Evidence links.** A Markdown link to a source is set as a quiet evidence token and opens the
  source ([§4.7](04-data-model.md)). A source mentioned by its id alone ("source <id>") is shown as
  written, not as a link.

## 7.7 Exploration

Exploration holds the team's **mockups**, and opens on them. The panel's context slot, headed
**Mockup canvases**
([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)), lists every
mockup that is not archived, by name ([decision](../decisions/lists-filter-from-the-panel.md)), as
the team arranged them
([decision](../decisions/mockups-are-arranged-by-hand-in-folders-one-level-deep.md),
[§4.12](04-data-model.md)): the mockups in no folder first, then each folder with its own, one
level deep. Each mockup opens its canvas. With none, one quiet line says so and opens the
first-use state.

- **A folder** is a row with a caret, a folder icon, its name and how many mockups it holds;
  pressing it opens or closes it. Which folders are closed is each person's own, kept in the
  browser (`whatbuild.mockup-folders-collapsed.<product>`); the folder of the mockup on screen is
  always open, so a link never lands on a row that is folded away. An open folder with nothing in
  it says "No mockups in this folder".
- **Arranging**, for anyone who can write. A mockup or a folder is dragged by the handle its row
  shows on hover and focus (always on touch): a mockup onto the upper or lower half of another
  mockup to go before or after it, or onto a folder to go last in it; a folder onto the upper or
  lower half of another folder. While a mockup that is in a folder is dragged, a dashed row under
  the mockups in no folder reads "Move out of its folder". The row dims where it stands and a
  lifted copy of it follows the pointer, held where it was taken hold of, under a grabbing hand; a
  bar or a ring shows where it would land, Escape cancels, and a toast names where it went, with Undo. With a row focused, Alt and
  Up or Down move a mockup among those beside it, or a folder among the folders, and Alt and Left
  take a mockup out of its folder; each move, or why none was made, is announced. A mockup's "…"
  menu has **Rename…**; then names the folder it is in (No folder, or one of the folders) and puts
  it in another; then **New folder…**, which makes a folder and puts the mockup in it; and last
  **Archive** (§7.10). A folder's menu has **Rename…**
  and **Remove folder**, which asks first when the folder holds mockups and says that they stay,
  in no folder. **New folder**, an icon button on the section's head, asks for a name.
- A move shows at once and is saved after; if what it named has gone, because someone else
  rearranged the mockups at the same time, a toast says so and the list shows them as they are.
  A viewer sees the same arrangement, opens and closes folders, and is offered nothing that
  changes it. Up, Down, Home and End move between rows, Right opens a folder or goes into it,
  and Left closes it or returns to it.
- **Renaming**, for anyone who can write, from a mockup's menu or its inspector: a dialog asks for
  the title (at most 200 characters), says that its versions, pages and place stay as they are, and
  saves it with `mockups.rename` under the mockup's etag. It makes no version
  ([decision](../decisions/renaming-a-mockup-or-story-page-makes-no-version.md)); the list, the
  crumbs and the inspector follow, and a toast says the new title. If someone changed the mockup
  meanwhile, the dialog says so and the next try starts from the mockup as it is.
- **Archiving**, for anyone who can write, from a mockup's menu, its inspector or its delete
  dialog: the mockup leaves the list at once, and a toast names it with **Undo**, which restores
  it to the place it kept. **Archived mockup canvases** folds away under the list, with how many
  there are; it reads them once it is opened, and opens by itself when the mockup on screen is
  archived. Each row opens its mockup, and its menu offers **Restore** to whoever can write and
  **Delete permanently…** to an admin. A viewer sees the section and restores nothing.
- **Deleting**, for a product's admins: a live mockup's menu offers **Delete permanently…** after
  Archive, as an archived one's does after Restore, and opens the dialog the inspector opens
  (§7.10). Deleting the mockup on screen goes back to the list.
- **Emptying the archive**, for a product's admins: the foot of the opened **Archived mockup
  canvases** offers **Delete all archived…**, a quiet row with a trash glyph that turns the danger
  colour only under the pointer or the keyboard. Its accessible name, "Delete all archived mockup
  canvases permanently…" (on the Story, "Delete all archived Story pages permanently…"), holds the
  words it shows and no count, since the dialog may delete fewer than the list holds. Its dialog,
  "Delete all archived mockup canvases permanently?", lists every canvas that goes by title
  (scrolling in its own box past six), counts
  their versions, and names each one a Story page shows, with links to those pages, as staying
  archived; it asks why, offers Cancel and no Archive instead, and deletes the set it showed with
  `mockups.delete_archived` (§9.4). When every archived canvas is held by a Story page, it says so
  and deletes nothing.
- The crumbs above a canvas name the folder the mockup is in: Exploration, Mockup canvases, the
  folder, the mockup.

Exploration once held an assumption register too. Assumptions are removed
([decision](../decisions/assumptions-are-removed-and-every-one-is-deleted.md)): an address under
`/exploration/assumptions/…`, from a Story page or a bookmark, say, opens Exploration's mockups
with a toast saying WhatBuild no longer keeps assumptions.

### Mockups

([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)) A mockup opens as a
canvas the full width of the window and its height below the crumbs, so the screen itself does not
scroll: every page of the shown version at its own size in its sandboxed frame ([§4.12](04-data-model.md)), laid out `columns` to a row (one row when null),
on a dotted board. Agents publish mockups; the screen never publishes one or changes its pages,
brief or notes. Its writes are promoting a page to the Story; **Rename…**, **Archive** and
**Restore**, for whoever can write; and, for a product's admins, **Delete permanently…** under
Version in the inspector, whose dialog offers **Archive instead** (§7.10).

- **Opening.** `…/exploration/mockups` opens the mockup last opened in this product in this
  browser, otherwise the most recent; with none, the first-use state gives the request to copy for
  an agent. A mockup opens fitted to the window, and stays fitted as the window changes until the
  person moves it. From then on its pages stay where they are on the screen when the board's edges
  move, as they do when a panel hides or shows and when focus mode begins or ends.
- **Labels.** Above each page, drawn at screen size so it reads at any zoom: its number, its title,
  its size (`390 × auto` for a page whose height is its content's), a button that fits that page to the window, and one that downloads that page's HTML (a
  page that enters a prototype has none to give). A narrow label drops the size, then
  the title, then, where it would run into the next page's label, the buttons. Whatever it has
  room to show, its button is named for the page's title. The gap between rows scales with the zoom
  and a label does not, so at a low zoom a label lies over the bottom of a taller page above it,
  where it keeps the board's tone so that it reads on a page of any colour, in either theme.
- **Links between pages** ([decision](../decisions/a-canvas-whose-pages-link-is-viewed-as-a-clickable-prototype.md)). A page links to another with `<a href="checkout.html">`,
  the other page's `page_id`. In interact mode a click flies the view to that page and selects it;
  the page clicked stays as it was, and the browser's Back returns. A link to a page the canvas does
  not hold goes nowhere and a toast says so, in the app's words and never the page's, at most every
  few seconds. A click a page handled itself is left alone, and one with a modifier key does what a
  plain click does, since a new tab has no address for another page of a canvas. A link to a document of the version's prototype that another canvas page enters
  moves to that page; any other link within the prototype stays in its frame. A link to a place
  within a page (`checkout.html#total`) moves to the page and scrolls to the place inside the page
  alone. The board clips its pages and nothing can scroll it, so no page scrolling something of its
  own into view moves the board, and a page the view flies to is where the view shows it.
- **Viewed as a clickable prototype** (`?view=clickable`, chosen under **View** in the inspector). One
  page at a time on the plain board, at its own size or smaller, in interact mode, with no labels or
  outline. The others fade as the view glides to the page, and back again on the way out. A link,
  the arrows and the page menu change the page in place and open it afresh, as a link to a file in a
  folder does. A page's request moves nothing unless a person did something moments ago, and then at
  most four times a second, since each opening spends one of the person's calls. A move is a step the
  browser's Back returns from at most once a second; otherwise it moves without one. The same holds on
  the board and for every page on the Story, for links and for keys a frame passes on. It starts at the selected page, or the first. The toolbar keeps fit, fill,
  the arrows, the page menu and the list of keys. A version whose pages do not link ignores the
  address's `view`.
- **Pan and interact.** A toolbar at the bottom of the canvas holds two modes. **Pan** (the hand,
  `H`, the default): a drag anywhere moves the canvas and a click selects a page; the pages take no
  pointer. **Interact** (the pointer, `V`): the pages take the pointer, each once it has loaded, so
  their links, buttons and scrolling work, a drag on the board still moves the canvas, and a press
  on a page selects it.
  Holding Space pans from either mode. The browser remembers the mode (`whatbuild.mockup.mode`).
  A page's frame is its width × height: content taller than the height scrolls inside the frame.
  A page whose height is `"auto"` opens 240 tall and grows to its content's height as its frame
  measures it, up to 4,000 ([§4.12](04-data-model.md)); the canvas lays its pages out again, and a
  view nobody has moved stays fitted, the whole canvas or the page it showed. A Story page that shows
  such a page grows its frame the same way.
  In pan mode the canvas shows the page's first `height` pixels and a scroll over it moves the
  canvas; in interact mode a scroll over the page scrolls the page, and at its end stops there
  without moving the canvas.
  On a touch screen one finger drags the canvas and two pinch it: the point under the fingers
  stays under them as they spread and move, and when one lifts, the other carries on as a drag
  from where it is. In interact mode a touch that begins on a page is the page's.
- **Scroll and zoom.** Scroll moves the canvas up and down, and Shift with scroll sideways; ⌘ or
  Ctrl with scroll, or a pinch, zooms about the pointer, from 5% to 400%, over a page in interact
  mode too, over a page still loading, and over the toolbar: the browser never zooms the app from the
  canvas. A notch of a mouse wheel moves the zoom by about 10% at most, and a pinch follows the
  fingers. The toolbar has zoom out, the zoom level (a menu: Fit the canvas, Fit the selected page,
  Fill the width with the selected page, 50%, 100%, 200%), zoom in, fit and fill the selected
  page, fit the canvas, the previous and next page, a menu of the pages that says which is selected,
  and a list of every key (each one also runs
  from the list). Keys: `+` and `−`, `0` for 100%, `1` fits the canvas, `2` fits the selected page
  to the screen and `3` fills the screen's width with it, its top at the top, to scroll down
  through a long page (with none selected, either selects the page nearest the middle of the
  screen); `←` and `→` select the previous or next page (with none selected, the last or the
  first) and show it the way `2` or `3` last did. Fit and fill sit together in the toolbar with
  the one in use marked, and the browser remembers which (`whatbuild.mockup.page-view`, fit until
  chosen). Every control names its key in its tooltip. Moves glide
  unless the person prefers reduced motion. Where a finger is the pointer, the toolbar's controls
  are 44px tall, and zoom in, zoom out and the list of keys give way: a pinch zooms, and there is
  no keyboard to list. A pinch that begins on the toolbar does not zoom the app. The toolbar stays
  inside the board however narrow the board is, as docked panels can make it in a wide window too:
  short of room its rules go, and then its groups of controls wrap onto a second row, every control
  still there.
- **Keys from inside a page.** Once someone is working inside a page, its keys go to the page's
  frame, not the app. The frame script ([§4.12](04-data-model.md)) knows the page is on a canvas
  from the frame's name as soon as it runs, as each document of a prototype does as it opens, and
  passes the canvas's keys on, with Space held and let go and a pinch over the page, so they
  work the same from inside a page; while typing in a page they stay with it.
- **A page that enters a prototype** ([§4.12](04-data-model.md#412-mockups)) is framed at its
  entry's address, in the sandbox the server names for it, and works as the prototype does at
  home: its links move between its documents inside the frame, its scripts, styles, fonts, images
  and fixtures load from the prototype, and its nested iframes show its own documents. Every one of
  its documents carries the frame script, so the canvas's keys work from each, and each says it
  has loaded; a load that does not within a moment is another address in its place, and is put
  back. The frame keeps the address it opened with until the address nears its expiry, so reading
  the mockup again does not reload the frames; a tab that comes back with the address nearly spent
  reads the version again.
- **Selection.** Clicking a page, its label or its name in the inspector selects it: an accent
  outline that keeps its width at any zoom. The selection is in the address (`?page=`), so a link
  can open a mockup at one page; Esc clears it, and a second Esc leaves focus mode.
- **Focus mode** works as on the Story (§7.8) and shares its remembered choice, except that the
  board takes the whole window: the crumbs, the version and any notice above the board step aside,
  and only the focus control (floating at the top right) and the toolbar remain. It is offered on a
  phone too, where the board gains the whole screen; there it never turns on by itself, the
  remembered choice still holds, and the control names no key.
- **The inspector:** **View** (Canvas or Clickable prototype, for a canvas of more than one page;
  while its pages do not link, Clickable prototype is disabled, with a line that says so and, for
  whoever can publish, **Copy a request for your agent**); **Version** (a menu of every version with
  its date, who published the shown one and when, its page count, its prototype's files and size
  when it carries one, **Download as ZIP** for the whole canvas, which a person opens from its
  `index.html` and an agent builds the next version from, [§4.12](04-data-model.md), and under it
  **Rename…** and **Archive** for whoever can write, or **Restore** alone on an archived mockup,
  and **Delete permanently…** for an admin); the selected
  page, under its title, once one is selected (where it enters the prototype, if it does, where it
  stands in the Story, below, and its notes as Markdown); **Brief** (the
  version's brief as Markdown); and **Files** (the files the version carries, each with its
  length; one opens in a dialog as rendered Markdown or as source text, never as HTML, with Copy).
- A callout above the canvas appears only for a state the person must know: the mockup is
  archived (with **Restore** for whoever can write), an earlier version is shown (with **Show the current version**), or the version asked
  for does not exist.
- **Downloading.** A toast says that a page runs its own code outside WhatBuild, with every download.
- **On the Story** ([decision](../decisions/agents-write-the-story-people-arrange-it.md)). Under
  the selected page's title, each Story page that shows the selected page is named and linked with the
  mockup version it shows. An editor whose page is not on the Story gets **Promote to Story**: a
  dialog says that a new Story page at the end of the tree will show the page as it is in
  the version shown, that a Story reader sees it but not the brief or the notes, and that it stays on that
  version until someone promotes a newer one, and asks for its title (the page's own by default). Where a
  Story page shows the selected page at another version, **Show version N** moves it to the version
  shown, as its next version. Under the version's details, the same goes for the whole canvas:
  **Promote canvas to Story**, with the mockup's title by default, and **Show version N**. A toast
  confirms that it is on the Story and says to drag it where it belongs, with Open to go to the page.

## 7.8 Story

The Story reads like a wiki: the page tree on the left, the page in the middle, its details on
the right. Agents write its pages; people read them, and arrange, rename, archive, restore and
delete them by hand as agents can ([decision](../decisions/agents-write-the-story-people-arrange-it.md)). A
page of a mockup reaches it by promotion, from the mockup (§7.7).

- **Reader first.** The page tree sits in the panel's context slot, and the canvas holds the crumbs
  (the current one is the screen's heading), the focus mode control, and then the page, with
  nothing between them. The crumbs sit on the line of the panels' heads, and the page fills the
  window down to the panels' bottom edge and scrolls inside its frame, so the canvas does not
  scroll and the crumbs stay in view; if the window is too short for the page, the crumbs stay
  pinned at the top. Opens
  the last page this browser read in this product, otherwise the first root page. Pages render
  only in the sandboxed frame ([§4.11](04-data-model.md)); the frame follows the app's theme.
  The frame's address is always the app's own route for the version; on a deployment with a
  content site that route hands the frame to the content site
  ([§6.4](06-operations-and-adapters.md)), which counts as the frame's own load, not a page that
  replaced itself. The same holds for a mockup page on its canvas, an Idea card's front, a style's
  specimen, a PDF, an uploaded HTML page and the print view's tab, so the app keeps and refreshes
  no address of the content site's but a prototype's.
  Until the frame has its document, skeleton lines stand in for the page, and the inspector stays
  in place with skeleton lines of its own, so moving between pages never slides it away and back.
  A callout appears above
  the page only for a state the reader must know: the page is archived (with **Restore** for an
  editor), an earlier version is
  shown (with **Show the current version**), or the page tried to open another address in its
  place, and was put back (past what a minute allows, it waits for the next, §7.1).
- **A page from a mockup** ([§4.11](04-data-model.md)) is shown at its own size, scaled down and
  never up, on paper as on the canvas, without the app's theme. Content taller than the page's
  height scrolls inside its frame, scaled with it. A control beside the crumbs, and `2` and `3` (from inside the page too), choose between
  **fit**, the whole page within the room under the crumbs, and **fill**, the page's width filling
  the measure with its top at the top, to scroll down through it. The choice holds while flipping,
  and the browser remembers it (`whatbuild.story.mockup-view`, fill until chosen). A promoted entry
  into a prototype is framed at its entry's address, as on the canvas, for a Story reader too: the
  prototype's links move between its documents inside the frame, and a load that is not one of
  them is put back. A link to another page of its canvas opens the Story page that shows that page,
  or a whole canvas holding it at that page (`mockup.story_links`, [§4.11](04-data-model.md)), as a
  step for Back; with none, a message says *This link leads to a page that isn't in the Story*, at
  most every 4 seconds, and no tab opens. A page's own request goes only just after a person did
  something, as on the canvas (§7.7).
- **A whole canvas** ([§4.11](04-data-model.md)) opens as the mockup's board (§7.7), the width of
  the window, for a Story reader too: pan, zoom, interact, fit and fill, the keys and focus mode work as
  they do there, with the selected page in the address (`?page=`) and each page's title above it.
  The board holds the pages alone: the Story shows no brief, notes or files, which the team reads on
  the mockup, linked from the inspector.
- **Flipping through the mockup pages.** On a page that shows a mockup page, a small control beside the
  crumbs gives its place among the Story's mockup pages, in the tree's order ("2 of 5"), between
  buttons to the previous and next one, and ← and →
  flip to them, in focus mode or not, from the app or from inside the page (the frame passes the
  keys on unless the page used them). Not while typing, with a dialog or menu open, or in a control
  that uses the arrows itself, such as the page tree. It stops at the first and the last; focus
  mode stays as it was.
- **Links.** A link in a page to another page of the same Story shows that page in place, written
  with the Story's address or as it was when products were in teams (`/t/<tenant>/<team>/<product>/story/…`): the
  address, the tree and the inspector follow, and focus mode stays as it was. A click with a
  modifier key, and every other link, opens in a new tab ([§4.11](04-data-model.md)).
- **Focus mode.** Both side panels and their show buttons step aside so the rest of the app falls
  away. The page keeps the canvas's ordinary measure (`--content-max`): on a wide screen it stays
  the width it was and does not reflow, and on a narrow one it gains only the room the panels
  held. **F** toggles it and **Esc** leaves it, from the app or from inside the
  page (the frame passes the keys on); not while typing or with a dialog or menu open. The
  first time a browser opens a Story that has a page, focus mode turns on by itself, with a hint
  beside the control that F or Esc brings the panels back; after that the browser remembers the
  last choice (`whatbuild.story.focus`). The control beside the crumbs (**Focus**, or **Show
  panels** in focus mode, each with an F keycap) is always there; a screen with no page to show
  (a page loading, one that isn't in the Story or was deleted, a Story with no pages or that couldn't
  be loaded, a mockup that isn't there) offers no
  focus mode, but while it is on keeps **Show panels** and the keys there. The panel shortcuts (⌘\ and
  ⇧⌘\) also leave focus mode, and leaving the Story ends it; the panels come back as they were.
  At phone width, where the panels are drawers already, there is no focus mode.
- **The tree.** A keyboard tree (one tab stop, arrow keys to move and to open or close a branch)
  with "Find a page", the current page marked and its ancestors kept open. **Story pages** is one
  tree of every kind of page, with pages not placed yet at its end, and **Archived pages** folds away
  below. Each row's icon says what the page is, and hovering over it names it: a page for a **Story
  page**, a screen for a **Mockup page**, a grid for a **Mockup canvas**. A screen reader hears the
  last two after the title.
- **Arranging by hand.** For an editor, each row has a handle (shown on hover, focus and the
  current row, always on touch): dragging it puts the page before or after another, or inside one
  to nest it, with a bar or a ring showing where it lands, and a strip at the end of the tree for
  the end of the top level; Esc cancels. While it is dragged the row dims where it stands and a
  lifted copy of it follows the pointer, held where it was taken hold of, under a grabbing hand. With a row focused, Alt and ↑ or ↓ swap it with its
  neighbour, Alt and → nests it under the page above, and Alt and ← moves it out to follow its
  parent; the move is announced and the page keeps focus. Every kind of page moves alike, and any
  may hold any other. A move shows at once and saves the whole arrangement
  with `story.set_hierarchy`, placing every page the tree shows; a drag confirms with a toast with
  **Undo**. A move refused (a page into its own subpages, deeper than six levels) says why. If the
  Story changed meanwhile, the move is applied to the newer tree and saved again once; if it no
  longer fits, the tree shows the Story as it is and a notice above it says so. Moving is off while
  "Find a page" filters the tree.
- **Row actions.** Each row's menu offers **Rename…** for an editor, then **Export this page to
  PDF…** and, for a page with subpages, **Export with its subpages…**; then **Archive** for an
  editor and **Delete permanently…** for an admin, as everywhere (§7.10). An archived page's row
  offers **Restore**, export and delete, and no rename. For an admin, the foot of the opened
  **Archived pages** offers **Delete all archived…**, as Exploration's archived list does: its
  dialog, "Delete all archived Story pages permanently?", lists every archived page by title and
  counts their versions, and deletes them all with `story.delete_archived_pages` (§9.4). **Rename…** asks for the title (at most 200
  characters) in a dialog that says the page keeps its versions and its place and that what it says
  stays as it is, and saves it with `story.rename_page` under the page's etag. It makes no version
  ([decision](../decisions/renaming-a-mockup-or-story-page-makes-no-version.md)): the tree, the
  crumbs and the inspector follow, and a heading inside the page keeps its words until an agent
  publishes the next version. Archiving moves the page's subpages up into its place, and its toast's
  **Undo** restores the page and puts the navigation back as it was; a restored page returns at
  the end of the tree. Under the tree, **Story style** names the product's
  Story style ("A house style", "Adapted from Clear", "Your design system", or "None yet") and
  opens the style dialog.
- **The style dialog** lists the style in use and every house style, and shows the chosen one
  on the same sample page (the front page of a release plan that uses the whole vocabulary), in
  the Story sandbox, laid out at desktop width and scaled to fit, with a link to open it full size.
  Two segmented controls switch the preview between light and dark (starting from the app's
  theme, which they leave alone) and between desktop and a 390px phone. For a house style it says what it is best for and its character,
  and gives a sentence to copy and send to an agent ("Adopt the Clear house style for our
  WhatBuild Story."); a second sentence asks an agent to follow the company's own design system.
  The dialog changes nothing itself ([decision](../decisions/story-pages-follow-the-teams-design-system.md)).
- **The inspector** carries everything else about the page:
  - **About:** who published the shown version and when, and its version number. With more than
    one version, the number is a menu of every version with its date, and choosing one shows it
    (`?v=N`). **Export to PDF…** opens the export with this page selected; beside it, **Rename…**
    (on a page that is not archived) and **Archive** (or **Restore**) for an editor, and **Delete
    permanently…** for an admin.
  - **Shows:** for a page from a mockup, the mockup page, linked to it on the canvas, the mockup and
    the version shown; when the mockup has a newer version, a line says so and to promote it from
    the mockup.
  - **Notes for agents:** the page's Markdown notes, which agents read before revising the page and
    update after publishing (what it is for, sources still to fold in, choices about its structure).
    Read-only here, and not versioned with the page.
  - A Story reader gets About alone: Shows and Notes for agents are left out, since the server sends a
    Story reader neither ([§3.5](03-accounts-and-identity.md)). The Story
    style row under the tree is left out too, and so are **Archived pages** in the tree and the
    export, since the server gives a Story reader no archived page; a Story with no pages says that they
    appear once the product's team publishes them. A Story reader or viewer arranges, renames,
    archives and deletes nothing: the tree has no handles, and its menus only export.
- **Export to PDF.** The dialog lists every page as checkboxes, in the Story's order, then archived pages, with Select all, Clear and a count; it opens with the page or pages it was
  asked for already selected, and the person can change the selection. The count and Select all
  cover the pages the Story shows; an archived page goes in only when ticked, and the count adds it
  ("3 of 24 pages selected, and 1 archived"). A print view takes 50 pages (`story.print`), so where
  more are chosen the count says that the first 50, in the Story's order, open. One line says that each page's current version opens
  in a new tab, to save as PDF from the browser's print dialog. The PDF holds a contents list, then
  each selected page at its current version under its title, with its version number and publish
  date; it leaves out a page's notes, earlier versions, and anything a page draws with scripts. **Open print view**
  opens the print view in a new tab ([§7.3](#73-routes)), which opens the browser's print dialog to
  save it as PDF. In the print view each page's own headings sit one level under its title in the
  outline (`aria-level`; the tags, and so the page's styling, stay as they are).
- ◆ Decision: **a page may lay out differently on paper.** A page's media queries answer to the
  width it is shown at. In the app's frame that is the canvas's measure (up to 900px); on paper
  it is the printable width, about 670 to 700px on A4 or Letter, below the house styles' 48rem
  breakpoint, so a page's narrow layout applies there (grids stack into one column). The print
  view does not pretend the paper is wider: a layout made for 900px would be cramped or clipped
  at 680px, and the narrow layout is the one the page's author made for that width. A mockup page
  is drawn at one size, so it lays out in its frame, with what its stylesheet asks of the viewport
  (width in a media query, `vw` and `vh`) answered for the frame, and is scaled down to the printable
  width (and on screen, to the window), kept on one sheet where it fits. On any page, what a page fixes to the window stays within that page, so an
  open dialog's backdrop never repeats on every sheet.
- An empty Story uses the first-use state ([§7.5](#75-idea)): agents write it, so the request to
  copy is the only path. It says pages follow the company's design system or a house style, and
  offers **Preview Story styles**.

## 7.9 Activity

A quiet **Activity page** (`…/activity`), not a drawer and not a destination: it is reached from
**Activity** in the product's panel, and from a source's details, which open the page filtered to that
source. It is one log for people and agents together, newest first ([§4.10](04-data-model.md)).
Each entry reads as a sentence with the actor, the surface, and a link to the object: "Sam, via
claude-desktop, published a new version of a mockup — 14:02". The surface is "in the app", "through the API" or
"via <client>"; what WhatBuild does by itself, such as reading an attachment, has no surface and
reads "on the server", however the attachment was uploaded, and says what came of it in a
person's words: "Read the text of call.vtt; it is the source’s derived text", never the parser's
internal label (events recorded with one are read without it, over MCP as in the app). An edit says
what changed in the words the app uses, "Changed the title and the tags", never a
field's name (events recorded with field names are read in the same words). The kind of object changed (`?entity_type=`) or
one object (`&entity_id=`) narrows it, held in the URL. Entries are grouped by day, each with its
count of changes under a heading one level below the section's own (h2 under Activity's h1, h3
under Access changes' h2, §7.11, and the same size in both), and load 50 at a time under "Show older changes"; the oldest day loaded may go on
past them, so while older changes wait its count says only what is loaded ("37+ changes").

Changes to the product's Playbook are entries too, naming the file's path ("Sam, via claude-code, added
to the Playbook lessons/canvas-titles.md"), one for each file changed, several changed at once
included, with no link, since the app shows no file of it; they filter as Playbook. Turning the Playbook off
or on is a change to the product's settings, filtered with them, and links to Settings → Playbook.

This is how a person answers "what did my colleague's agent just do to my product" without reading
a diff. It is also the first place to look when a `409` surprises someone.

## 7.10 Archiving and deleting

One pattern, used identically wherever an object can be removed
([§9.5](09-data-lifecycle.md)). Archive is offered to editors; permanent delete to admins only, on
a product that isn't archived (`canDelete`). One dialog serves every delete
([`delete-dialog.tsx`](../../apps/web/src/routes/delete-dialog.tsx)).

| Object | Archive | Delete |
|---|---|---|
| Source | its actions menu | its actions menu |
| Comment | its menu, with an optional reason, and in its delete dialog | its menu |
| Outcome | its card's menu on Idea | its card's menu |
| Story page | its row's menu in the tree, and the inspector's About | its row's menu, and the inspector's About |
| Mockup | its row's menu in the panel, the inspector's Version, and its delete dialog | the inspector's Version, under Download |
| Product | Settings → the product's General, Archive this product, and in its delete dialog | Settings → the product's General, Delete this product |
| Organization | — | Settings → the organization's General, Delete this organization, for owners; Delete on its row in Instance admin → Organizations, for an instance owner; never the example organization |

1. The visible control is **Archive**. It is a plain, ordinary action with no confirmation beyond
   an undo toast, because it is reversible. Its tooltip says what archiving does: takes this out of
   your views and out of what an agent can search, keeps everything. A comment, which keeps why
   it was archived, asks for that reason first, optionally, and then has the same undo toast.
   ◆ Decision: the reason is asked in a dialog rather than offered after archiving, since
   `update_annotation` takes it only with the archive; Archive instead, in a comment's delete
   dialog, archives at once without one.
2. **Delete** sits inside the same menu, below a separator when anything is above it, styled as
   destructive, never pre-selected and never the primary button of any dialog. No menu begins or
   ends with a separator, or shows two together (`apps/web/src/styles/ui.css`).
3. Choosing it opens a dialog titled as a question ("Delete this source permanently?"), that
   says it can't be undone and shows the object's preview as plain sentences before any control:
   *This deletes its attachments (4 stored versions, 218 MB), its text, summary and notes, and 1
   comment.* A count of none is left out. A mockup a Story page shows lists those pages, and its
   delete stays disabled.
4. The dialog asks for a reason, which the button needs. A source also needs its title typed, and
   a whole product or organization its name. Every delete dialog has Cancel, and wherever the
   object can be archived, Archive instead beside it, offering it again; for what is already
   archived it is left out, and the dialog says nothing of archiving.
5. Afterwards, a toast states what was deleted and that the activity log records who, when and
   why. Nothing is silently gone.

Copy rules: the word is **delete**, never "remove", "dismiss", "clear" or "hide". "Archive" is
never described as deleting. A list row showing an archived object says *Archived*, not
*Deleted*.

## 7.11 Settings, Instance admin, and the person's own screens

- **Settings** (`apps/web/src/shell/settings-dialog.tsx`,
  [decision](../decisions/the-panel-shows-one-product-and-everything-else-is-in-settings.md)) is
  one large dialog over the screen the person is on, for everything that is not the product's own
  work. It is addressed by `?settings=<section>` on whatever screen it is opened over, so a link
  opens it and reload keeps it; closing it (Esc, its close button or the scrim) takes `?settings`,
  and what its sections keep in the address, away and leaves the screen as it was, with focus back
  where it was. Esc first closes a menu or a dialog opened from inside it. Its sections are listed
  down its left, grouped by whose they are, each group headed by its name; only the sections the
  person may use are listed:
  - **the product** the panel shows (not for someone who reads only its Story): General
    (`product`), People (`product/people`), Playbook (`product/playbook`) and Export (`product/export`);
  - **its organization** (not for someone who reads only the Story there, nor for a guest of the
    example organization): General (`organization`) and Access changes (`organization/access`) for
    its owners and admins, People (`organization/people`) for everyone, and Plan
    (`organization/plan`) where the deployment offers plans;
  - **You**: Account (`account`) and Agents (`agents`).

  A section asked for that the person can't use opens the first of its group they can, else the
  first of all, and the address follows: it is replaced with the section shown, the rest of it
  kept, so a reload, Back or a copied link opens what is on screen. It is opened from the panel's Settings (the product's General; a Story reader's Account;
  for an organization with no product, its General, or its People for someone who is not an owner
  or admin), the account menu's Settings (Account), the empty seat and the first-use states'
  Connect an agent link (Agents), the read-only notice's See plan (Plan), Activity entries about the product's
  settings or its people, Delete account's ways out and Instance admin's organization names, links
  between sections, and the older addresses that lead to it (§7.3). Another section starts at its top. On a phone it fills the screen and the sections are a
  select at its head. Over the overview or a page that wasn't found, it is about the product the
  panel shows there.
- **The product's General** (`?settings=product`). The product's name and its short name in links
  (the slug), which its admins change (`products.update`, in the web app only), and its
  organization, read-only; for admins, archive or restore and **Delete this
  product**, whose dialog counts everything in it, needs a reason and the product's name typed, and
  offers Archive instead while the product is live (§7.10). A new short name moves the screen under
  Settings to the product's new address when that screen is the product's own.
- **The product's People** (`?settings=product/people`), titled "People on this product". It lists
  everyone who can reach this product and how, in words: a product role, or a role that comes from
  all products ("Editor through all products") or from the organization (`members.list` with
  `product`). Product admins get a role picker (Admin, Editor, Viewer, Story reader, each with what it reaches in a few words: a viewer reads everything and changes nothing, a Story reader reads only the Story's live pages) for product roles,
  **Add people** (the people editor, below, for the product), Remove (revokes the product role
  only), and outstanding invitations with a cancel control. An inherited role links to People in
  the organization, where it is changed; so does the head, for someone who is not an admin. Access
  is per product; nothing is granted per page or per source.
- **The product's Playbook** (`?settings=product/playbook`,
  [decision](../decisions/each-product-keeps-a-playbook-its-agents-write.md)). What the Playbook is,
  in a sentence: where the agents of everyone working on the product keep what they learn, which
  they read before they start and add to as they go. Then what it holds, as a key of a word and a
  muted line each: Current work, Lessons, Kits and People. Then that WhatBuild doesn't show it, so
  to see what it says (and, for an editor or admin, to change it) people ask their agent, and that
  every change is kept and can be undone. A muted line gives how many files it holds, or that it
  holds WhatBuild's starter files until an agent first writes to it (only while it is on), and that
  an export of the product includes it, in the Open Knowledge Format. A guest of the example
  organization, which isn't exported, is told neither that nor that changes are kept. Below a
  hairline, **Keep a Playbook for this product**, a choice its admins turn off and on
  (`products.set_playbook`, in the web app only), saying that off, agents can't read or change it
  and nothing in it is lost. Anyone else reads the choice disabled, with a note above it that only
  admins change it (a guest, that the example can't be changed); it is disabled too while the
  product is archived, with a note to restore it under General, or its organization read-only. No
  file of the Playbook is shown anywhere in the app; the activity log names its changes (§7.9).
- **The product's Export** (`?settings=product/export`): a copy of the whole product to download
  ([§9.4](09-data-lifecycle.md)).
- **The organization's General** (`?settings=organization`, for its owners and admins).
  **Organization name**: the name and its short name in links (the slug), each in a field, the
  short name checked as typed against the server's rule and saying that every product's address
  begins with it and that links with the old one still lead here. Owners Save changes
  (`products.rename_tenant`, under the name's etag) or Discard changes; a new short name is
  confirmed in a toast. Admins read both, told only its owners change them. A change made elsewhere
  starts the form again from what it is now. Then, for its owners (never the example
  organization), **Delete this organization**: the dialog lists its products and counts its
  sources, files (with their size, the files its Plan counts) and people, and needs a reason and the
  organization's name typed (§7.10, [§9.5](09-data-lifecycle.md)). Afterwards the overview opens.
- **The organization's People** (`?settings=organization/people`). A key to the roles
  (organization: owner, admin, product creator, which creates products and is admin of each one it
  creates, and member; all products or a product: admin, editor, viewer, which reads everything and
  changes nothing, and Story reader, which reads only the Story's live pages), then everyone in
  the organization in two layers: their **organization** role (member when they have none of their
  own) and their **access**, the roles on all products and on each product that decide which
  products they can open. A member with no access says so. Each role on all products or on a
  product someone may manage (only the organization's owners and admins manage roles on all
  products) has **Change**, a menu of the roles there, each described in words (granting again at
  that scope replaces the role, with Undo), and **Remove role**. Removing one takes effect at once
  with Undo, except a person's only role: that asks first, because it also takes them out of the
  organization, and a tenant admin may instead keep them as a member; the dialog then asks to
  remove the role, and offers both. Tenant admins get a menu per person: the organization role,
  and **Remove from the organization**, which asks first and lists every role they lose
  (`members.revoke` with `whole_tenant`). Outstanding invitations ("Waiting to join") show their
  expiry and a cancel control. **Add people** opens the people editor (below), titled for where it
  adds ("Add people to all products", "Add people to Crewboard", "Add people to <organization>"),
  with **Where** above it: all products (every product, including ones made later) first, then each
  product, then the organization, whose roles are owner, admin, product creator and member, the
  last saying that it opens no product. It opens on all products for the organization's owners and
  admins; a product admin is offered only their products. Your own organization role is not
  changed there. The person's writes and their attribution stay after any removal.
  Someone who is not an owner or admin of the organization sees only the people on the products
  they can open, those with a role on all products, and the owners and admins, as the section
  says; since they may not see every role a person holds, removing one never asks as if it were
  the last ([§3.5](03-accounts-and-identity.md)).
- **The people editor** (`apps/web/src/routes/people-editor.tsx`), a wide dialog that changes who
  has a role on one product, on all products or on the organization, many people at a time. On the left, under a
  segmented head: **From the organization**, everyone in it the person can see who has no role
  there, each with a checkbox (a find field above more than six, and **Select all**); or **Paste
  addresses**, a field that reads any list of addresses as it is pasted (separated by commas,
  semicolons, new lines or tabs; `Name <address>`; Outlook's `"Last, First" <address>`; a
  spreadsheet's name and address columns; `mailto:`), saying under it what was left out as not an
  address, then listing each address once with its name and what happens to it (in the
  organization, gets an invitation, invited already, already there). With nobody left to pick, it
  opens on Paste addresses. Under either, **Join as**, the role they arrive with, described in
  words. Two arrow buttons between the lists move the people chosen across, and back. On the
  right, everyone there, in groups: **To add**, each with a role picker; **Already here**, each
  with their role (a picker where the person may change it); and those with access through all
  products or the organization ("Through all products", "Through <organization>"), each with that
  role, and a picker that gives them a role of their own here. A group is labelled when there is more than one, and always when its access
  is inherited. Choosing people on the right puts **Set role…** for all of them in its head, and
  the left arrow takes them off (struck through, with **Keep**; on all products or a product only, saying
  "Taken off when you save" and when it is their only role there). Nothing changes until **Add N
  people** or **Save changes**, which the foot summarizes beside it: one `members.grant_many` for
  every role given or changed (100 a call), then `members.revoke` for each person taken off once
  every call has succeeded. A refusal changes nothing in its call and names the address; it is
  forgotten once the choice changes. A refusal after earlier calls saved says how many addresses
  they saved, whatever the reason (the server's "Nothing was changed" is left out, being true only
  of the refused call): those addresses and role changes leave the lists, so saving again sends
  only the rest; the people list is read again to show them; the invitations they made are listed
  in the dialog, each with **Copy link**; and Cancel becomes Close. A save
  that only adds says so in a toast ("Added 3 people to Crewboard"; after a refused save kept
  some, "Saved the changes to Crewboard"); invitations made are then listed (with any an earlier
  refused save made), each with **Copy link**, and **Copy every link**; one that could not be
  emailed says so.
  At phone width the lists stack and the arrows point down and up.
- **The organization's Plan** (`?settings=organization/plan`, where `/t/<organization>/plan` and
  `…/limits` lead; listed where the deployment offers plans; `apps/web/src/routes/limits.tsx`). It
  is the same for everyone who reads it, an instance owner included. What a person sees is said in
  words, for someone using WhatBuild rather than running it. **Plan**: the plan's name and price,
  what it is for, that everyone in the organization meets its limits, owners and their agents
  included (an unlimited organization has none, and one on a plan the deployment no longer defines
  meets none until it is moved); for a read-only organization, a Read-only mark and a note headed
  with how long it is kept ("Kept until 26 Oct 2027 · 365 days left", the day in UTC, as every
  refusal and Instance admin's Organizations give it) that says it went back to the
  starting plan while whoever started it already has an organization there, what everyone can still
  do there (the sentence every read-only notice gives), and how to move it to another plan, in place of **What you can add**; on
  the starting plan, where there is another, how to move to another plan (write to the deployment's
  contact, or ask whoever runs this WhatBuild) and that each organization has a plan of its own; and,
  where the deployment offers plans, that the organization's name and plan, and the name and email
  of everyone in it, are visible to whoever runs this WhatBuild, who uses them to write to its
  people, and to bill the organization where a plan has a price, with a link to Privacy. **What** the organization **holds**: people (counting
  invitations not yet accepted; Story readers don't count), products and sources (archived
  ones count, and deleting one makes room), and storage (split into files, which are attachments, the text read from each, kept as a file of its own, and prototypes, and text; archiving keeps it, deleting frees it), each
  as "6 of 50" over a thin bar, with "Nearly full" from 80% and "Full", with its mark, when it is
  reached, or "no limit". **Today**, with when it starts over (midnight UTC): **You** (changes,
  sources added, files uploaded, data sent to you, exports) and **Everyone in** the organization
  (changes, files uploaded), in the same form. **What you can add**: the largest file that can be
  uploaded (the lower of the plan's and the deployment's `upload_max_bytes`, which past the upload
  relay's limit needs a store that signs direct uploads), the size above which a file is kept but not read when that is
  smaller, attachments on a source, the mockups and Story pages a product holds, archived ones
  included (the plan's, or their defaults on Unlimited), and, where the plan says
  so, that files must be in a format WhatBuild reads (a plan with `documents_only` off keeps any
  file) or that adding a file from a link is off. Then **Plans**, the plans side by side with this
  one marked **Your plan**. Nothing here changes a plan or a limit: an instance owner moves an
  organization to another plan, and reads every limit with the refusal a call over it gets, in
  Instance admin. Settings knows from `products.list`'s `story_only` whom to leave Plan out for, so
  it never asks for a plan it would be refused.
- **The organization's Access changes** (`?settings=organization/access`, for its owners and
  admins): the organization's access log (`members.activity`), drawn as the Activity feed is
  (§7.9), newest first, with a rename as "renamed the organization to …", someone whose last role
  was removed, or every role at once, as "removed … from the organization" (one role of several
  as "removed a role from …"), someone who deleted their own account as "deleted
  their account and left the organization", and an instance owner's removal of an account as
  "removed the account of …". An invitation to all products, sent or declined, reads "invited
  someone to all products" and "declined an invitation to all products", in lower case, as the
  server gives its title. An entry from before teams were removed or the Story reader was
  named so reads in today's words, as the server gives it ([§4.10](04-data-model.md)).
- **Account** (`?settings=account`). Display name, and the email the person signs in with
  (read-only); for a guest of the example organization, **Example organization**, whether the
  product switch offers it ("It stays on the overview either way"; the account's `hide_example`);
  **Tutorials**, one checkbox, "Start each page’s tutorial the first time you open it", with
  "When this is off, they start only from your account menu." under it, checked unless the person
  turned tutorials off (the account's `tutorials_off`, [§7.4](#the-tutorial)); **Delete account**
  (below); then quiet links to Cookies and Privacy.
- **Delete account**, in Settings under Account (`apps/web/src/routes/delete-account.tsx`).
  Closed, one line says it deletes the account permanently and that the person sees what happens
  before anything is deleted, over **Delete account…**, which opens it in place
  (`?delete=account`, so signing in again comes back to it) and reads
  `products.delete_account_impact`. Open, it says what deleting will do, in the words of
  `packages/core/src/account-deletion.ts`, naming the organizations the person loses access to,
  and what stays. Below that, the one step left: every block at once (owning the instance; being
  the only owner of an organization, each with **Make someone else owner**, opening Settings at that
  organization's People, and **Delete organization**, at its General); otherwise, for a browser that signed
  in more than 15 minutes ago, **Sign in again to continue**, with each sign-in method the
  deployment offers (the section reads again when a recent sign-in lapses while it is open); then
  the address typed exactly and **Delete account**, the one danger button, beside **Cancel**,
  which closes it. A refused delete says the account wasn't deleted, where the form was. Deleted,
  the browser forgets the person's state and opens **Your account has been deleted**
  (`/account-deleted`, signed out), which says what stays and that a confirmation was emailed
  ([§3.2](03-accounts-and-identity.md#32-accounts-and-sign-in)).
- **Agents** (`?settings=agents`, where `/connect` leads). **Connect an agent**
  ([§6.8](06-operations-and-adapters.md)): the plain statement about where an agent sends what it
  reads, then the choice of agent and the same four steps as Connect your agent on Idea (§7.5),
  from the same component. The first step gives the one address to paste, `/mcp` (or Claude Code's
  command with it), then, behind a quiet button under it, what the agent can reach (one product,
  one organization, or everything), giving the MCP server URL for that scope in its place, the
  product Settings is open over chosen first; a limited connection is named after what it reaches
  in the steps (Claude's "name it WhatBuild <name>", Claude Code's `whatbuild-<slug>`), and for
  another agent a line suggests the name. The sign-in step adds the three levels an agent may have
  (Read only, Edit, the default, or Admin); the last adds a first request to try. Then **Connected agents**, each with
  what it can reach, who holds the connection, its level with a menu to change it, a **Can submit
  feedback** checkbox under its details (when a tool fails or confuses it, it may tell the
  developer of WhatBuild), and disconnect. Connected agents appear here and nowhere else. Last,
  **Sign out everywhere**: every browser the person is signed in on and every agent they
  connected, at once, which asks first and offers Everywhere else to keep this browser signed in;
  signed out here too, the person lands on sign-in. The choice of reach is held in the address
  (`?reach=product|organization|all`, with `&product=<path>` or `&org=<slug>`).
- **`/settings` as a page of its own**, for someone with no product to open Settings over (a guest
  still waiting for a place, or someone in no organization on a WhatBuild without an example
  organization): Account and Sign out everywhere, on the plain stage.
- **Invitation** (`/invite/:token`). Opening the link changes nothing: it asks "Join <organization>?"
  and says who invited them and as what, and nothing else: "Maya (maya@example.com) invited you as an
  editor.", the product added for a product's invitation ("as a viewer on Crew scheduling"), with
  **Accept** (the primary action), **Decline** and **Not now**. Names are shown as names, without
  quotation marks; the inviter's account address (`invited_by_email`), which no chosen name can
  fake, follows their name, or only the name once that account is deleted ◆
  [decision](../decisions/an-invitation-shows-names-plainly-beside-the-inviters-confirmed-address.md).
  A read-only organization's invitation adds that it can't take anyone new yet, and offers no
  Accept. Accepting opens the overview with the note "You’re in Fieldnote, as an editor." (with
  the product for a product's invitation). Declining stays here and says what it did: they won't
  join, the link no longer works, the organization's admins see that an invitation was declined
  and not by whom, and they can ask for a new one. A link they accepted earlier says they are
  already in, with their role. Otherwise it names why the link can't be used and offers signing in with another address,
  which returns to the link; an invitation for another address makes that the primary action. Its
  loading state names nothing, and a failed load offers Try again. Signed out, the link opens
  sign-in titled "Sign in to see your invitation". It stands outside the guests' gate, so someone
  invited takes no guest's place to read it and never waits in line for it.
- **Invitations waiting** ([§3.2](03-accounts-and-identity.md#invitations)). Once signed in, a
  person sees the invitations waiting for them wherever they land, without the emailed link: above
  the content of every screen in the shell, in a sheet titled Invitations for you on the first-run
  screen (`/welcome`) and on the guests' waiting page, where accepting ends the wait. Each row asks
  "Join <organization>?" in the same words as the link's page, with **Accept** and **Decline**; a
  screen shows three, and Show more invitations brings the rest. It says nothing while it loads or
  when none wait, and a failed load offers Try again. Accepting opens the overview with the same
  toast. Declining says in a toast what the organization sees, and focus moves to the next row's
  Accept, or to the screen once none is left. A refusal (cancelled meanwhile, say) says why in a
  toast, and the list is asked for again. On a phone the buttons take a line under the words.
- **The waiting page** (any signed-in address, for a guest account that is not in; `GuestGate` in
  `apps/web/src/shell/guest-gate.tsx`). A guest account sees the app only while it holds a place
  (`GET /api/v1/me/guest-pass`). The app asks only when the guest does something: when it opens,
  when they move to another screen or come back to the tab once the last answer is a minute old,
  and when they press **Try again**; never on a timer, so a tab left open neither holds a place
  nor keeps the database awake. The server decides the place on every call the guest makes, and a
  call refused with `guest_waiting` brings the waiting page at once, from the refusal's own
  details. Otherwise one sheet says why, under any invitation waiting for them, in its title and
  badge: **WhatBuild is full right now** with its place in line and the progress mark, then "Try
  again within two minutes to keep your place." and **Try again**; **Today's places for new guests
  are taken** or **You've used today's time**, the badge saying when it opens again, and no line
  under it; or that no guests are let in, "Try again later.", with **Try again**. Then **Ask for
  your own organization** (or, once asked, the waitlist line), **Sign out** and **Settings**
  (`/settings`, a page of its own for them), which a waiting guest still reaches. A guest that is in sees, on the example's one-line notice, the time
  left today.
- **Cookies** (`/cookies`, readable signed out; `apps/web/src/routes/cookies.tsx`). What cookies
  are for, by kind: needed for WhatBuild to work (always on), and, when the deployment uses
  analytics, Google Analytics, its caption saying where the person's choice stands (Not chosen yet,
  Declined or Accepted). The page has no Decline or Accept of its own: the cookie notice, which shows
  on every screen until answered, this one included, is where the choice is made, and once there is
  a choice, **Change** beside the caption brings the notice back to make it again there. Then
  how the server counts use without cookies, and how to clear them ([§9.1](09-data-lifecycle.md)).
  It lists no individual cookies.
- **Privacy** is not a screen of the app: it is a page of the public site
  ([§7.3](#73-routes), [§9.1](09-data-lifecycle.md)), at the address `privacy_url` in
  `GET /api/v1/meta` gives (`apps/web/src/shell/privacy-link.tsx`). The sign-in page, Account in
  Settings, Cookies, an organization's Plan, the first-run screen (under its form) and the account-deletion page
  link to it, opening it in a new tab.
- **The cookie notice** (`apps/web/src/shell/CookieNotice.tsx`). When the deployment sets an
  analytics ID (`analytics_id` from `GET /auth/methods`), every screen, signed in or not, carries a
  small note at the bottom-right inset (flush along the bottom on phones) until the person presses
  Accept or Decline, which carry equal weight and are remembered in the `wb_cookies` cookie, shared
  with the public site. It says that cookies keep the person signed in and asks whether analytics
  cookies may also be used to see how WhatBuild is used, so Accept and Decline plainly answer the
  analytics question, with a Cookies link to `/cookies`. It blocks nothing and never takes focus by
  itself; brought back by the Cookies page's Change, it comes at once and takes focus, which returns
  to Change once a choice is made. The app works the same whichever is pressed. Without an analytics ID it does not appear; the
  server gives none to the instance's owners, or on an address that is not the deployment's own.
  After Accept, each screen is a page view with its path masked, sent once the screen has stayed a
  moment so that a redirect is not counted; each change the app makes is an event named by the
  operation the server ran (`X-WhatBuild-Operation`); and search is counted by what was opened and
  followed, never by its words (`apps/web/src/lib/analytics.ts`, [§9.1](09-data-lifecycle.md)).
- **Instance admin** (`/admin`, for the instance's owners only; `apps/web/src/routes/admin.tsx`,
  [decision](../decisions/the-panel-shows-one-product-and-everything-else-is-in-settings.md)).
  Running this WhatBuild is a place of its own, outside every product, reached from the account
  menu's Instance admin. Anyone else at any address under `/admin` is told the page wasn't found, so
  nobody else learns it exists. It has its own panel: a head, "Instance admin", over "Only this
  WhatBuild's owners see this"; its sections, **Organizations**, **People**, **Plans** where the
  deployment offers plans, **Guests** where it has an example organization, and **Starting
  organizations**, with how many people are waiting for an organization beside it; then **Back to**
  the product the person was last in (or Back to WhatBuild, the overview); and the account menu at
  its foot. `/admin` opens Organizations.
  - **Organizations** (`/admin/organizations`): every organization on the
  instance (`products.organizations`), under a line saying each is on a plan of its own and what
  plan a new organization starts on here, or, where the deployment offers no plans, that every
  organization is Unlimited, both set where the service is deployed (`WHATBUILD_PLANS` and
  `WHATBUILD_NEW_ORGANIZATION_PLAN`): each row its name (a link opening Settings at its Plan where the instance owner is in it and reads more than the Story), whether it is
  the example, what it holds (people besides Story readers, whom the plan doesn't count, with
  invitations waiting; products, sources and storage), who
  created it and when, how long a read-only one is kept, and today's writes, ending in a Read-only
  badge where it is, "Plan no longer defined" for one on a plan the deployment no longer defines,
  its plan's badge and **Change plan** where the deployment offers plans, **Rename** and, but for the example,
  **Delete**, which opens the dialog an owner's Settings use (what goes, why, its name typed;
  `products.delete_tenant`, which an instance owner may call in any organization); the line above the rows
  adds, where new organizations start on a plan the deployment defines, that each person has one
  organization on it, that moving it to another plan lets them start another, and that one moved
  back while they have another is read-only for a year; a row says the short names in links it had before. Rename opens a dialog with the name
  and the short name in links (with those it had before beneath), which says links with its current
  short name keep leading to it and its access log records the change, and saves under the name's
  etag (`products.rename_tenant`; an instance owner renames any organization, member or not).
  Change plan opens **Plan of** the organization, a dialog over the list (`?org=<slug>`): what it
  holds, then a choice between the deployment's plans and Unlimited, each with its price where the
  deployment names one, what it is for and its totals in words, the current one marked; when the
  organization holds more than the chosen plan's totals, a note says by how much and that nothing
  is removed; when the starting plan would make it read-only (`starting_plan_is_read_only`), a
  note says so instead: its creator already has an organization on that plan, its people keep
  reading, exporting and deleting for a year, and another plan makes it writable again; a
  read-only organization says since when and until when, and choosing the starting plan once its
  creator has a place for it offers **Make it writable**;
  **Move to** the chosen plan saves under the plan's etag (`products.set_plan`), and the toast says
  when it is read-only and until when; closing it takes
  `org` off the address and leaves the list as it was.
  - **People** (`/admin/people`; `apps/web/src/routes/people.tsx`): every account, below.
  - **Plans** (`/admin/plans`, where the deployment offers plans; elsewhere it says this WhatBuild
    offers none and every organization is Unlimited): that limits belong to
  plans, never to one organization, to raise as WhatBuild grows; the plans side by side (below);
  and in the head a button for each plan, which opens **The** plan: its price, as people read it,
  then every limit in a field (bytes in MB; a total, or the bytes sent a day, with **No limit**
  beside it), what each product holds among them (mockups, Story pages, the Playbook's files and
  size), next to what the deployment's configuration sets, saved under the plan's etag
  (`products.set_plan_limits`) for every organization on it, with **Back to the configured
  limits**. Then **Limits of the** plan of one of the owner's own organizations (one row each: what
  it counts and over what, what it allows, what is used, the refusal a call over it gets; on
  Unlimited, **None** but for what a product holds, at its defaults) and
  **Limits of this deployment**, with what sets each, which are the same for every organization;
  an owner in no organization of their own has the plans side by side only.
  - **Guests** (`/admin/guests`, where the deployment has an example organization): what a guest is, a badge for whether anyone can sign up as one,
  how many are in (of the places), waiting, new today (of the day's) and ever, refreshed every half
  minute, then each setting in a field next to its default, saved together under their etag
  (`products.set_guests`).
  - **Starting organizations** (`/admin/starting`; `apps/web/src/routes/instance.tsx`): **Who can start
  organizations**: what the rule is, the default for every other address and who the owners are;
  then each address with an allowance: its person or "no account yet", how many it may create and
  has created, who gave it and when, the note, and what is left. **Let someone start
  organizations** opens a dialog for an address, a number, a note and whether to tell them by
  email; Change edits the number and note under the row's etag; Remove returns the address to the
  default after a confirmation. An allowance counts the organizations the address's account
  started that are not read-only, and where new organizations start on a plan the deployment
  defines, only those on it, named by the plan, so moving one to another plan frees its place; the
  dialog says so, as the list does, once the plans are known, and Change says how many of theirs
  count now. Then, where the deployment has an example organization or someone is on it, **Waitlist**:
  the people who asked for
  an organization of their own, in the app or on the public site, earliest first, each with their
  name and address, their organization, when they asked, whether they have signed up, and what
  they wrote; **Let them start one** gives them an allowance of 1 and emails them, which takes
  them off it.
- **People** in Instance admin (`/admin/people`; `apps/web/src/routes/people.tsx`), whose line
  says that letting someone in is an allowance under Starting organizations. Every account (`products.accounts`): its name and address,
  where it stands in each organization, when it joined and was last seen, how many browsers and
  agents it has signed in, and its address's allowance, with a badge for the person themselves and
  for an owner of the instance; a find field once the list is long. **Remove** (on every account
  but an instance owner's) opens a dialog that says what removing does (signed out everywhere, every
  role taken with a record in each organization, invitations and allowance cancelled, the address
  forgotten, their usage data deleted, a confirmation emailed, the name kept on what they wrote)
  and asks for the address typed exactly. For an account that is the only owner of organizations,
  a note above says they are deleted too, one line each with what it holds (its products by name,
  sources, files) and how many other people lose their roles there, and the button says "Remove
  account and delete" them; the only owner of the example organization can't be removed
  ([§3.2](03-accounts-and-identity.md#32-accounts-and-sign-in)).
- **Plans** (`/plans`, readable signed out; `apps/web/src/routes/plans.tsx`, and the public site's
  `/plans`). The plans the deployment offers side by side (`GET /api/v1/plans`), as one table
  (`apps/web/src/routes/plan-comparison.tsx`) the site, the app's page, an organization's Plan and
  Instance admin's Plans all show: each plan's name, its price as the deployment writes it (none shown
  where it gives none: "No charge" is a price a deployment may write), what it is for; then a few rows anyone reads at
  a glance (people, products, sources, storage, the largest file, whether recordings, images and
  any file are kept, an agent through MCP, Story readers, who see only the Story, taking everything out,
  changes a day), each with a short note where a word needs it, an included feature as a check and
  one left out as a dash, each read aloud as a word; a line that each organization has a plan of its
  own, billed on its own where a plan has a price; and **Every limit** behind a disclosure, every limit of every plan with
  what it is counted over. The app's `/plans` widens its column with the number of plans (300px
  and 200px a plan), so every plan shows without scrolling sideways at desktop widths; on a phone
  the labels and heads wrap so two plans fit, and more scroll inside the sheet. Where the
  deployment offers no plans, `/plans` says so and compares nothing, and the public site leaves out
  its link to Plans.
- **The example organization** ([§3.10](03-accounts-and-identity.md)), in
  `apps/web/src/shell/ExampleBanner.tsx`. Every screen of a product in it carries a notice above
  its content. To a guest with no organization of their own it is an invitation: "Like what you
  see?", "Start using WhatBuild and engineer your next product. This demo is here to read: nothing in
  it can be changed.", with **Start using WhatBuild** (to
  `/welcome` where they may create one; otherwise it takes one of the day's places or puts them on
  the waitlist), and once they are on it, "Your organization is on its way" with the address they
  will hear at. To a guest with one of their own, "This is the demo", "A demo to learn from.
  Nothing here can be changed." It shows in full until they press Got
  it, then as one line, "Demo · read only", keeping the button (remembered per
  organization in the browser). To the organization's own people, whatever their role, it says in one line
  "Example organization. Everyone who signs in sees what its authors change." It shows nothing while it loads, so no screen waits for it. The
  overview lists the example organization after the person's own, headed **Example organization**
  with its name after it and Read only for a guest, over a line on what it is for (to a guest: a
  demo: a team's work to read in order, Idea, Evidence, Exploration and Story); a guest's head offers **Hide from the switcher** or **Show in the switcher**,
  whether the product switch offers it under Switch organization, the account's own choice
  (`hide_example`), and so does **Example organization** in Settings under Account. Inside a
  product of the example, the product switch's line says "Example organization · " and its name.
  Settings leaves the organization's sections out for a guest.
- **Planned:** organization settings with usage against every limit shown as fractions
  ([§9.2](09-data-lifecycle.md)), organization export, and a danger zone
  holding only owner-gated actions (transfer ownership, close the organization), each behind a
  typed confirmation; active sessions in the person's Settings.
