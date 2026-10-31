---
type: Specification
title: The web app is a person's way to run the same operations an agent runs, one screen at a time.
description: Principles, the shell and product switching, the overview, routes, first run, and the behavior of every screen (Idea, Evidence, Exploration, Story, Activity, archive and delete, organization and account screens).
tags: [spec, web, ui, routes, shell]
generated: {by: agent:claude, at: 2026-10-27}
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
  person's own session, connected agents and invitations (`/api/v1/me…`), which are not content.
- **State that matters lives in the URL**: product, screen, filters, search query, selected
  page, a source's section and the words found in its text. Reload and share always work.
- Every write path handles `409 stale_etag` explicitly: show what changed, keep the person's
  unsaved text, offer reload-and-reapply. Never discard input; never overwrite silently: a
  teammate or their agent may be editing the same object.
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
  daily allowances of a plan the deployment defines, [§9.7](09-data-lifecycle.md).)
- **No request the app knows will be refused.** Where the app can tell in advance that the server
  would refuse (a Story-only reader asking for members, a guest of the example organization asking
  for its people, an address whose id is not an id at all), it says so without asking. Where it cannot, it asks, and
  REST answers honestly: a source, assumption or other object that does not exist answers `404`,
  and its page says it was not found while the browser's console reports the `404` of the request.
  A `404` is final, so the app never asks for it again (a request that did not reach WhatBuild,
  or a `5xx`, is asked again twice). A product, or an organization's Members or Plan,
  that answers `404` says at once that it doesn't exist or the person can't see it, as the server
  does of both, with a way back to their products.
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
  to left with the ellipsis at its left. It is measured before it is drawn, and again only when
  its room or the fonts change. The whole title stays in the page for assistive technology and
  shows on hover (the Whole Word Rule in [DESIGN.md](../../apps/web/DESIGN.md)).
- **Interface text says one thing once.** A heading states the fact, the body adds only what the
  heading did not, and a rule is explained where it applies, not ahead of time. Words are plain and
  the same everywhere: an email address is an "email", a URL given to a person is a "link", a
  source's files are its "attachments" and its words its "text", people "start" an organization
  and "can" do things, and something
  happens "right away". Contractions and typographic apostrophes are used throughout. A role's
  place is written as a person would say it: "editor on the Core team", "editor on Crewboard"
  (`scopeWords` in `apps/web/src/lib/format.ts`).
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
  product switch, showing the product and its organization and team, and under it the **Search**
  field, "Search <product>" with its shortcut, which opens the search palette (below).
- **L1**, exactly and in this order: **Idea, Evidence, Exploration, Story**, each with its count:
  every item the stage holds (`stage_counts`, [§4.2](04-data-model.md),
  [decision](../decisions/each-stage-counts-every-item-it-holds.md)). Idea counts outcomes, Evidence
  sources, Exploration mockups and current assumptions together, and Story its pages, those in the
  tree and the Published mockups alike.
  Below them, quieter: **Connect an agent**, **Activity** (§7.9) and the product's **Settings**.
  Exploration opens on its mockups; the mockups, then the assumptions, are listed in its panel. The app's URLs follow the areas
  (`/evidence`, `/exploration/…`); REST and MCP name the objects (`sources`, `mockups`).
  Exploration was called Synthesis, and a link to `/synthesis/…` opens the same path under
  `/exploration/…`. Exploration once listed insights and decisions too; a link to one opens the
  source it became ([§4.7](04-data-model.md)), and a link to either list opens Exploration.
- **Search** covers the whole product in one place, by plain words ([§8.2](08-search.md), plain
  mode). The **palette** opens from the panel's Search field, ⌘K / Ctrl+K, or `/` when not typing,
  on any product screen. It springs into place with a small overshoot (it simply appears with
  reduced motion), and if it is left untouched for three seconds it flashes white once and settles
  to the lifted shadow. It opens as the field alone, with up to six **recent searches** under it
  when it is empty: searches followed through in that product (a result opened, or every result),
  newest first, kept in the browser and cleared at sign-out (§9.1); picking one fills the field, and
  Clear empties the list. Results come as you type, best match first (a kind named in the query
  before the rest), at most eight: each with its
  kind's glyph, its title with the words marked, what it is (Source with its date and its number
  of matches, counted as its Find in the text counts them for the same words, so opening it in its
  text shows "… of" that number; Assumption with its status, Mockup with the page), and a source's
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
  ("Showing results for quote."), a kind brought first, or that nothing holds every word.
  The **Search screen** (`/search?q`) has the same field, searching as you type, and lists the
  results under the product's four areas, each a sheet in the panel's order: **Idea** (the product
  concept, then outcomes), **Evidence** (sources, each with the best three places it says the
  words, each saying where and opening there as the palette's do, and "N more places in this
  source"), **Exploration** (mockups, then assumptions, each with its status as a badge, said once) and
  **Story**. A kind named in the query brings its area first. When nothing holds every word, each
  result also names the words it lacks ("Missing: …"), which the palette leaves to its line,
  "Nothing has all your words.". The panel shows Everything and each
  area with its count (`?show=idea|evidence|exploration|story`). With `record_id` it lists every
  place one source says the words, each opening at its own match, with a link back to searching
  everything. A corrected word
  offers "Search for <word> instead" (`?strict=1`). When more match than the 60 listed, it says
  "Showing the best 60 of N. Add a word to narrow them.", and the palette's All N results counts
  every match. Nothing holding the words says "Nothing matches" and suggests another word or fewer
  words. An outcome found opens Idea scrolled to it and marked (`?outcome`). Readers have no search.
- **A reader** ([§3.5](03-accounts-teams-and-identity.md)) has only the Story: L1 is **Story**
  alone with its count, and the quiet group is gone. The product opens on the Story, and any other
  product screen, opened by a link or typed, takes a reader to the Story, with a toast saying they
  can read only this product's Story.
- **A context slot** under the navigation, which the screen fills: the page tree on Story, the
  filters on Evidence, the mockups and the three lists with their filters on Exploration.
  Each of its sections is a group named by its title, a heading, so a screen reader can move
  between them as it does between the inspector's groups.
- **The footer** holds the account menu, which is about the person: their email; each
  organization they belong to, with their role in it, a link to its **Members** (left out where they
  read only the Story) and, where the deployment offers plans, to its **Plan**; the example
  organization is left out for its guests,
  who see neither its members nor any allowance there, unless the guest is an owner of the
  instance, who sees its Plan;
  the theme (Light, Dark or System, which is the default; remembered
  per browser); **New organization**, while they may still create one; **Organizations** and
  **People**, for an owner of the instance;
  **Settings** (their own display name, and **Sign out everywhere**, which asks first and offers
  Everywhere else to keep this browser signed in; signed out here too, the person lands on sign-in;
  and, closed until opened, **Delete account**);
  **Submit feedback**; and Sign out. Last, under a hairline, is the release this
  WhatBuild runs, from `/api/v1/meta`: "Release v0.3.1", or "Commit 1a2b3c4" for a
  build that is not a release, linking to the release notes or the commit on GitHub in a new tab;
  the commit and build time stay in `/api/v1/meta`. A development
  server says so instead. Nothing in it is also in the panel.
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
- **Outside a product** (the overview, Connect an agent, the person's Settings, organization
  Members) the panel is the same on every screen, whatever the person came from: each
  organization's name, over the label "Products" and then its products (a long name ends in an
  ellipsis after a whole word, §7.1); the example organization last, headed **Example organization** with the library glyph,
  on a neutral wash, over its name and "read only" (to its authors, "you're an author"), with a ×
  that hides it from the panel for a guest; then a quiet link to Connect an agent and, for an owner of the instance, to
  **Organizations** and **People**, with the current screen marked. It never offers a way "back" to a product, because it cannot know the person came
  from one; the product is in the list.
- **The panel changes only on entering or leaving a product.** Connect an agent is in both panels,
  and inside a product it opens in the product's shell (`…/connect`), so the product's navigation
  stays put.
- A skip link leads to the content; on a route change focus moves to the new heading and the page
  is announced politely.

**Switching.** An account may belong to several organizations (tenants) and teams, and a team
holds several products. A person must always know where they are, and move without losing their
place.

1. The current product, with its organization and team, is shown at the top of the panel on every
   product screen.
2. The product switch is one interaction away on every product screen. It lists every reachable
   product grouped by organization and team, and offers New product, which opens in place.
3. **Switching product keeps the section**: from Evidence in product A to Evidence in product B.
   Idea, Evidence, Exploration, Story, Connect an agent, Activity, Search and Settings carry over; anything else
   (a record id, an assumption, a mockup) lands on Idea. Switching to a product where the person is a reader
   lands on its Story.
4. The product is in the URL path (`/t/<tenant>/<team>/<product>/…`). Opening a link to another
   product simply works, and becomes the remembered one.
5. `/` opens the overview for anyone in an organization, and first run for anyone in none. The
   last-used product is remembered per browser until the person signs out or their session ends
   ([§9.1](09-data-lifecycle.md)); Connect an agent names it in its example request.
6. Archived products appear only on the overview, behind "Show archived products" under each
   organization that has any, which opens that organization's alone (`?archived=<organization
   slug>`, repeated for each organization opened), read-only, and an admin restores them from the product's
   Settings. Inside one, no control offers a change the server would refuse: outcomes are not
   dragged and have no actions menu, as for a viewer. Roles are access, not content, and
   `members.grant` and `members.revoke` still work on an archived product, so its Settings keep
   People on this product for admins and say so above the list.
   A read-only organization, one moved back to the plan new organizations start on while whoever
   started it has another there ([§3.3](03-accounts-teams-and-identity.md#33-tenants-and-teams)),
   says so above every screen of its products: that nothing new can be added, what everyone can
   still do there (one sentence the server's refusal shares, `packages/core/src/read-only.ts`:
   read, export and delete what it holds, and take people out, as their roles allow), how long it
   is kept, and **See plan**. Inside one, as on an archived product, no control offers a change the
   server would refuse (`409 organization_read_only`), and a screen that would invite one (Add a
   source, a new entry) says why in its place; deleting and export stay. Its Members page says so
   too, and offers only what still works there: removing a role, taking someone out and cancelling
   an invitation, with no Give access, no change of role and no change of its name.
7. On the overview, an organization where the person has no team or product role says so, and that
   there is nothing to open until an admin gives them one.
8. Organization-level screens (the overview, Connect an agent, Settings, Members) use a different
   panel, so they are not mistaken for belonging to one product.

**The overview** (`/`, [decision](../decisions/the-overview-is-the-front-door.md)). The page that
introduces WhatBuild and is good to share as a screenshot. An intro sheet carries the mark and
wordmark, the question "What to build?", the tagline "Product discovery at the speed of AI
Engineering.", two sentences on what the app does, and a link to Connect an agent. Beside it, small and
quiet, "From idea to story": Idea, Evidence, Exploration and Story, each with a line on what a
team does there. It carries no counts; those are on each product below. Below, one sheet per organization, headed by its name alone, lists its active products (name,
product concept as plain words clamped to two lines, its Markdown markers dropped, last update, and the team only when the organization has more than one), each
with links to Idea, Evidence, Exploration and Story and their counts, so any section of any product
is one click away. A product where the person is a reader says "You can read its Story."
in place of its concept, and links to the Story alone, with its count. Team admins get **New product**, a dialog on the overview (`?create=1`), so
cancelling leaves the person there; it asks for a team only when they can create in more than one,
and when the organization already holds all the products its plan allows it says so, and how to
make room, in place of Create.
An organization with no product the person can see says so, and, to someone who cannot create
one, whom to ask. The
overview is the only list of products: `/products` redirects to it. Roles are not shown here; the
person's organization role is in the account menu, and who has which role is on Members.

## 7.3 Routes

```
/signin  /welcome  /invite/:token             sign-in, first run, accepting an invitation
/join/:code                                   → / (the public sandbox's retired invitation links)
/cookies                                      Cookies: what they are for, and the analytics choice; readable signed out
/plans                                        Plans: the plans offered side by side, with their prices; readable signed out
/                   ?archived=1&create=1      the overview: what WhatBuild is, and every product; new product; first run with no organization
/products                                     → / (with its query)
/t/:tenant/members                            people and roles in an organization
/t/:tenant/plan                               Plan: an organization's plan, what it holds against it, what is used today, and the plans side by side
/t/:tenant/limits                             the same page, at the address it had before plans set every limit
/connect            ?product                  Connect an agent: the MCP server URL for a product or all, and the agents connected now
/settings                                     Settings: the person's display name, Sign out everywhere, and Delete account (?delete=account opens it)
/account-deleted                              Your account has been deleted (signed out)
/instance                                     Organizations: every organization's plan and what it holds, the plans, and who may create organizations (instance owners)
/people                                       People: every account, and removing one (instance owners)

/t/:tenant/:team/:product                     → …/idea
  /idea               ?status&outcome         the product concept, outcomes with counts (outcome: one a search opened, marked)
  /evidence           ?tags&added_by&date_from&date_to&query&include_archived&sort&order
                      (date_from, date_to: the date captured; query: words in titles, tags or attachment
                      names; both from a link)
  /evidence/new                               intake: describe it, add attachments, create
  /evidence/:record   ?view=text|notes|comments|attachments &find=<words>&at &include_archived
                      (at: where a search hit's piece of the text starts, so the find starts there;
                      include_archived: Comments lists the archived comments too)
  /search             ?q&show&record_id&strict
  /exploration                                → …/exploration/mockups
  /exploration/mockups                        → the mockup last opened here, or the most recent; first use with none
  /exploration/mockups/:id  ?v=N &page=<page_id>  a mockup's canvas, at a version, with a page selected
  /exploration/assumptions[/new|/:id|/:id/edit]
                      the list takes ?show&outcome_id&q; new takes ?outcome_id
                      (show: unconfirmed, confirmed, refuted, archived; q: title search)
  /exploration/insights/:id  /exploration/decisions/:id   → /evidence/:id (the source it became)
  /exploration/insights  /exploration/decisions          → /exploration
  /synthesis/…                                → the same path and query under /exploration
  /story[/:page]      ?v=N
  /connect            ?product                Connect an agent, in the product's shell, with this product picked
  /activity           ?entity_type &entity_id
  /settings                                   name, slug, people, export, organization, archive
```

**The public site** is not part of the app: on the site's domain (served by the Cloudflare Worker,
or by the image on the host named by `WHATBUILD_SITE_URL`), `/` is a
page with the overview's intro and a form to hear when a team can start, `/plans` the plans side by
side, `/privacy` the privacy notice ([§9.1](09-data-lifecycle.md),
[decision](../decisions/the-privacy-page-is-a-page-of-the-public-site.md)), and every other path
redirects to the app. Whoever serves a page writes into it what only the
service knows (`whatbuild-site`, the answer of `GET /api/v1/plans`): the plans as an instance owner
set them, whether anyone may sign up as a guest, and who runs the deployment, where to write and who
else handles the data, for the privacy page. The Worker asks the service for it through
Cloudflare's cache, an hour at a time; without it, a page shows the plans as the build has them,
and the privacy page says it did not load.
While guests may sign up, the front page leads with **Explore a real discovery** (sign-in, then the
example organization as a guest), with **Start your team's own** beside it pointing at the form, and
the plans page says the same. On the app's origin, which is where a deployment without a site
host has them, they are at `/site/`, `/site/plans/` and `/site/privacy/` (in development,
`http://localhost:5273/site/`, where the pages ask the local server)
([decision](../decisions/the-public-site-is-pages-built-with-the-app.md)). When the deployment
uses Google Analytics, whoever serves the page writes the measurement ID into it (a
`whatbuild-analytics` meta tag), and the page shows the same cookie choice as the app, with Cookies
in its footer to change it; a request to hear from us is counted as `generate_lead`
([§9.1](09-data-lifecycle.md)).

An address under `/t/:tenant` that names an organization by a slug it had before moves to the same
address with its current slug, query and fragment kept (`CurrentTenantAddress`), once the person's
organizations have loaded and show that slug among the organization's `former_slugs`; meanwhile
the server answers the old slug too ([§3.6](03-accounts-teams-and-identity.md#36-addressing-and-isolation)).

Older source links resolve too: `?view=passages` opens Text, and `?view=original` and
`?view=files` open Attachments, where an attachment is shown; `?tab=passages` opens Text,
`?tab=preview` and `?tab=files` Attachments, `?tab=notes` Notes, and `?tab=connected` the
inspector. A product path without the `/t/` prefix (`/<tenant>/<team>/<product>[/…]`, as people type
or paste it) redirects to the same path under `/t/`.

The document title is "<screen> · <section> · <product> · WhatBuild", with a screen named after
its section ("Evidence") said once. A screen shown in place of another names itself, never the one
it stands in for: an address the app doesn't know is "Not found · WhatBuild", a product that
answers `404` "Product not found · WhatBuild", an organization that does "Organization not found"
with its section (Members, Plan), and an error no screen handles "Something went
wrong · WhatBuild".

The Story print view is served by the API, not the app: `GET
/api/v1/p/<tenant>/<team>/<product>/story/print?page_ids=…` returns one HTML document, opened in a
new tab ([§7.8](#78-story), [§6](06-operations-and-adapters.md)).

## 7.4 Sign-in, and the first ten minutes

1. **Sign in** (`/signin`) with an email link, Microsoft or Google, whichever the deployment configures
   ([§3.2](03-accounts-teams-and-identity.md)); in development, one click signs in as any account on
   the server (`GET /auth/dev-accounts`): the sample's people first, then the newest, each with what
   it is there ("Owns Fieldnote Studio (Pro)", "Guest, on the waitlist"), the first 40 of them, or as
   any address typed above. An
   email link opens a page the server renders, naming the address, whose one button, Sign in,
   signs in and returns to `next`. Wherever sign-in returns to is a path on this origin or `/`,
   by the server's rule (`safeNext`). Under the form, one line says WhatBuild is a free preview
   and links to Privacy, the notice of what is kept and why ([§9.1](09-data-lifecycle.md)), and
   to Cookies.
2. **The example organization first.** A new account with no organization of its own lands on the
   overview, where the example organization ([§3.10](03-accounts-teams-and-identity.md)) is listed,
   tagged Example organization and Read only, under a sheet, **Your own organization**, that says
   the example is there to read and to point an agent at, and offers **Start your organization**
   where the account may create one. Where it may not, it says organizations open a few at a time,
   to ask for one or be invited to someone's, and offers **Ask for your own organization**, which puts them on the
   waitlist with one click ([§3.2](03-accounts-teams-and-identity.md#32-accounts-and-sign-in));
   then it says since when they have been on it and that an email will tell them when they can
   start one.
3. **First run** (`/welcome`): name the organization and the first product in one form, for an
   account that may create one ([§3.3](03-accounts-teams-and-identity.md)); for someone who is not
   an instance owner, where the deployment offers plans, it adds which plan the organization starts
   on, with its totals and a link to compare the plans, and that whoever runs this WhatBuild sees
   its name and plan and the name and email of everyone in it, to write to its people, and to bill
   it where a plan has a price; a deployment that offers no plans says neither. The same form, titled
   New organization, starts another. An account that may not says so: the people who run the
   instance decide who may, and someone can invite them instead; its link back leads to the
   example organization for someone with none of their own. A person who was invited follows
   their invitation link (`/invite/:token`) and lands in the inviter's organization.
4. Invite colleagues from the organization's Members or the product's Settings, by email or a
   single-use link.
5. **Connect an agent** (`/connect`): paste one address into an MCP client and sign in when it asks
   ([§6.8](06-operations-and-adapters.md)).

No page is readable without an account. Someone who wants to look before committing to anything
signs up and reads the example organization as a guest while there is room
([decision](../decisions/guests-come-into-the-example-organization-while-there-is-room.md)). The
synthetic sample `pnpm db:seed` creates is visible only to its seeded accounts.

## 7.5 Idea

The screen's model and names are a decision: [A product starts with its idea](../decisions/a-product-starts-with-an-idea-concept-and-outcomes.md).

The landing screen, built of cards
([decision](../decisions/idea-cards-have-a-front-for-people-and-a-back-for-agents.md)). The
product concept's card first, across the content band; then **Outcomes** with their count, and the
outcomes' cards one under another, in order, each as wide as the concept's and as tall as what it
shows.

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
  yet opens on its text, over "No picture yet" and, for someone who can write, the request to copy
  for an agent.
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
  names what goes with the outcome, its picture and its text, only those it has, and the
  assumptions that serve it. A viewer has no menu. Earlier versions are kept, and agents read and
  restore them (`outcomes_read(action="revisions")`); the screen does not offer them.
- A card holds nothing that points away from it: no links or counts of the assumptions, mockups
  or Story pages that serve it ([§4.2](04-data-model.md)).

The panel's **Archived** section offers Hide archived (the default) and Include archived
(`?include_archived=1`), as Evidence does for sources; an archived outcome shows an Archived badge
and a quieter card, and offers Restore. With no current outcomes but archived ones, the list
offers to include them. With no outcomes, the list says what an outcome is and gives the request to
copy for an agent (interview the person, then write the concept and outcomes, each a card with its
picture and text). Nothing on the screen prescribes an order of steps.

**Empty lists** ([decision](../decisions/empty-lists-lead-with-the-agent.md)). Outcomes, Sources,
Mockups, Assumptions and the Story share one first-use state: "No … yet", what belongs
there, and a request naming the product for the person to copy to their agent, with Connect an
agent (opening Connect an agent for this product) until they have one connected. Where people add by hand, that
is the header's create action, a default button, as when the list has items; outcomes have none,
since agents write them. A filter over a list
with nothing in it shows the same state. Viewers see the words without the request.

## 7.6 Evidence

The sources, and everything for reading them.


- **Intake.** **Add source**, a plain button in the sheet's header, opens it. Three steps:
  **Describe it** asks for the title, the **date captured** (optional, with help text
  distinguishing it from today) and tags, offering the product's most used tags to add with one
  click ([§4.4](04-data-model.md)), and nothing else. **Add attachments** is one drop zone, optional,
  that takes any number of files, with no role to choose; it says that they are read in the order
  listed and the first in which WhatBuild finds text becomes the source's text, which search reads
  ([§5.4](05-derived-layer.md)), which formats it reads, that a recording needs its transcript too,
  and that no words are read from images or scanned pages. **Create** makes the source and uploads each
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
  to Z). When the sheet is narrower than 680px the same choices sit in a menu. Each row shows its
  tags under the title, and at its end a paperclip with its number of attachments and one date:
  the one the list is ordered by. That is the date captured ("No date" when it has none), or
  "2 h ago" when ordered by date added or details updated, with who did it and the full time in its
  tooltip; ordered by title, it is the date added. A row whose source has a summary leads with a chevron that unfolds the
  summary's first three lines, as plain words, under the tags
  ([decision](../decisions/a-source-carries-a-summary-notes-and-whole-source-comments.md)); the
  whole row stays a link to the source. **Show summaries** in the header unfolds every row (and
  **Hide summaries** folds them), a choice the browser keeps for the person
  (`whatbuild.sources.summaries`, forgotten at sign-out). The header
  counts the sources listed, with "of N" live sources while filters narrow the list (left out once archived
  sources are included). While more pages wait to load, the count is still exact when
  `sources.facets` knows it: with no filter, one tag or one person; only otherwise is it the rows
  loaded so far with a plus ("50+"). Archived rows are muted and marked Archived. Rows whose titles match
  another listed row also name the attachment their text was read from (or how many attachments
  they have, or none yet), so the twins can be told apart.
- **Source page.** A source is the busiest object in the app, so the page is dense on purpose.
  - **Header:** the title and the actions menu, nothing else; every property is in the inspector.
    Below it the **summary** ([§4.6](04-data-model.md)), whole: rendered Markdown, attributed to
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
    marked, from its own match: `&at=` says where the hit's piece of the text starts, and the find
    starts at the first match there (without it, at the first). A very long text,
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
    plain text, in a dialog; a recording with its length; an HTML page framed from its own route,
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

Exploration holds the team's **mockups** and its **assumptions**. It opens on the mockups. The
panel's context slot lists the mockups first, then the assumptions
([decision](../decisions/lists-filter-from-the-panel.md)) as a section with one set of filters and
a count on every filter, laid out like Evidence's filters:

- **Mockups:** every mockup that is not archived, by name, most recently changed first; each
  opens its canvas. With none, one quiet line says so and opens the first-use state.
- **Assumptions:** All, Unconfirmed, Confirmed, Refuted or replaced, Archived. "All" is the
  unconfirmed and confirmed ones, the ones every count of them in the app counts.

The list has one filter dimension, its review status. Its header holds only its title, its count
("n of N" once narrowed), a title search and its create action, New assumption. The search (`?q=`) matches titles as you type, forgiving
case, accents, punctuation and one wrong, missing or extra letter in a longer word, puts the best
matches first and marks the matched words. There are no filters in a list's header: where a
table has controls above it they sort, as Evidence's do, or search. Under the header, chips name
the filter and outcome in use, each removable, so the view stays legible while the panel is
hidden. Following an outcome's links from Idea lists the entries for that outcome, and the
panel's counts follow it. A product holds dozens of assumptions, so the list loads whole and the
counts, filters and search work on what is loaded.

### Mockups

([decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)) A mockup opens as a
canvas the full width of the window and its height below the crumbs, so the screen itself does not
scroll: every page of the shown version at its own size in its sandboxed frame ([§4.12](04-data-model.md)), laid out `columns` to a row (one row when null),
on a dotted board. Agents publish mockups; the screen reads them and never publishes, edits or
restores one. Its writes are promoting a page to the Story, and, for a product's admins,
**Delete permanently…** under Version in the inspector, whose dialog offers **Archive instead**
(§7.10).

- **Opening.** `…/exploration/mockups` opens the mockup last opened in this product in this
  browser, otherwise the most recent; with none, the first-use state gives the request to copy for
  an agent. A mockup opens fitted to the window, and stays fitted as the window changes until the
  person moves it.
- **Labels.** Above each page, drawn at screen size so it reads at any zoom: its number, its title,
  its size, and a button that fits that page to the window. A narrow label drops the size, then
  the title.
- **Pan and interact.** A toolbar at the bottom of the canvas holds two modes. **Pan** (the hand,
  `H`, the default): a drag anywhere moves the canvas and a click selects a page; the pages take no
  pointer. **Interact** (the pointer, `V`): the pages take the pointer, so their links, buttons and
  scrolling work, a drag on the board still moves the canvas, and a press on a page selects it.
  Holding Space pans from either mode. The browser remembers the mode (`whatbuild.mockup.mode`).
  A page's frame is its width × height: content taller than the height scrolls inside the frame.
  In pan mode the canvas shows the page's first `height` pixels and a scroll over it moves the
  canvas; in interact mode a scroll over the page scrolls the page, and at its end stops there
  without moving the canvas.
  On a touch screen one finger drags the canvas and two pinch it: the point under the fingers
  stays under them as they spread and move, and when one lifts, the other carries on as a drag
  from where it is. In interact mode a touch that begins on a page is the page's.
- **Scroll and zoom.** Scroll moves the canvas up and down, and Shift with scroll sideways; ⌘ or
  Ctrl with scroll, or a pinch, zooms about the pointer, from 5% to 400%, over a page in interact
  mode too. A notch of a mouse wheel moves the zoom by about 10% at most, and a pinch follows the
  fingers. The toolbar has zoom out, the zoom level (a menu: Fit the canvas, Fit the selected page,
  Fill the width with the selected page, 50%, 100%, 200%), zoom in, fit and fill the selected
  page, fit the canvas, the previous and next page, and a list of every key (each one also runs
  from the list). Keys: `+` and `−`, `0` for 100%, `1` fits the canvas, `2` fits the selected page
  to the screen and `3` fills the screen's width with it, its top at the top, to scroll down
  through a long page (with none selected, either selects the page nearest the middle of the
  screen); `←` and `→` select the previous or next page (with none selected, the last or the
  first) and show it the way `2` or `3` last did. Fit and fill sit together in the toolbar with
  the one in use marked, and the browser remembers which (`whatbuild.mockup.page-view`, fit until
  chosen). Every control names its key in its tooltip. Moves glide
  unless the person prefers reduced motion. Where a finger is the pointer, the toolbar's controls
  are 44px tall, and zoom in, zoom out and the list of keys give way: a pinch zooms, and there is
  no keyboard to list. A pinch that begins on the toolbar does not zoom the app.
- **Keys from inside a page.** Once someone is working inside a page, its keys go to the page's
  frame, not the app. The frame script ([§4.12](04-data-model.md)) is told the page is on a canvas
  and passes the canvas's keys on, with Space held and let go and a pinch over the page, so they
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
- **The inspector:** **Version** (a menu of every version with its date, who published the shown
  one and when, its page count, its prototype's files and size when it carries one, **Download
  version N** for the ZIP an agent builds the next version from, [§4.12](04-data-model.md));
  **Page** (a menu of the pages with Fit and Fill buttons, as `2` and `3`, then where the selected
  page enters the prototype, if it does, and its notes as Markdown, or a line asking the person to
  select a page; and where the page stands in the Story, below); **Brief** (the
  version's brief as Markdown); and **Files** (the files the version carries, each with its
  length; one opens in a dialog as rendered Markdown or as source text, never as HTML, with Copy).
- A callout above the canvas appears only for a state the person must know: the mockup is
  archived, an earlier version is shown (with **Show the current version**), or the version asked
  for does not exist.
- **On the Story** ([decision](../decisions/agents-write-the-story-people-arrange-it.md)). Under
  the page picker, each Story page that shows the selected page is named and linked with the
  mockup version it shows. An editor whose page is not on the Story gets **Promote to Story**: a
  dialog says that a new Story page at the end of Published mockups will show the page as it is in
  the version shown, and that it stays on that version until someone promotes a newer one, and asks
  for its title (the page's own by default). Where a
  Story page shows the selected page at another version, **Show version N** moves it to the version
  shown, as its next version. A toast confirms that the page is under Published mockups, with
  Open to go to the page.

### Assumptions

- **Revision history** ([§4.1](04-data-model.md)): a list of revisions with author, surface and
  time; a read-only view of any revision; and a restore that writes the old content as a new
  revision. It exists for outcomes, the one object whose revisions the operations expose. Planned:
  a diff against the current text, and the same control for the product concept, annotations and
  unreviewed assumptions once their revisions are exposed.
- **The register:** the assumptions list, filtered from the panel as above; the
  default lists unconfirmed and confirmed entries. Where a view lists a superseded entry under the
  entry that replaced it, it sits there, muted, marked "Replaced by the entry above"; while a
  search is typed, rows are in match order instead. Each row says who drafted or recorded it and
  when it was created, the same date its page shows, and adds "updated …" when it changed since. An
  entry page shows the statement, the body (which says why the team holds it), the outcomes it
  serves, links grouped by type, and the full review history. Actions: review
  (status + required note, optional confidence; before the first review the form says that saving
  freezes the wording, and always that reviews can't be edited), link, supersede (opens a prefilled new entry).
  Frozen fields ([§4.8](04-data-model.md)) are shown as such, with "supersede" as the path to
  change them.
- **New and edit entries** ([decision](../decisions/evidence-is-searched-not-cited.md)):
  New assumption (`…/assumptions/new`, with `?outcome_id=` preselecting an outcome) take a statement, an optional why (Markdown) and the outcomes it bears
  on. An entry nobody has reviewed has Edit in its actions menu
  (`…/:id/edit`); a reviewed one is frozen. When every entry in the default view is refuted
  or replaced, the list says so and links to that view.

## 7.8 Story

The Story reads like a wiki: the page tree on the left, the page in the middle, its details on
the right. Agents write its pages; people read them, and arrange, archive, restore and delete them
by hand as agents can ([decision](../decisions/agents-write-the-story-people-arrange-it.md)). A
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
  place, and was put back.
- **A page from a mockup** ([§4.11](04-data-model.md)) is shown at its own size, scaled down and
  never up, on paper as on the canvas, without the app's theme. Content taller than the page's
  height scrolls inside its frame, scaled with it. Its crumbs read Story › Published mockups › the
  page. A control beside the crumbs, and `2` and `3` (from inside the page too), choose between
  **fit**, the whole page within the room under the crumbs, and **fill**, the page's width filling
  the measure with its top at the top, to scroll down through it. The choice holds while flipping,
  and the browser remembers it (`whatbuild.story.mockup-view`, fill until chosen). A promoted entry
  into a prototype is framed at its entry's address, as on the canvas, for a reader too: the
  prototype's links move between its documents inside the frame, and a load that is not one of
  them is put back.
- **Flipping through the published mockups.** On a published mockup, a small control beside the
  crumbs gives its place ("2 of 5") between buttons to the previous and next one, and ← and →
  flip to them, in focus mode or not, from the app or from inside the page (the frame passes the
  keys on unless the page used them). Not while typing, with a dialog or menu open, or in a control
  that uses the arrows itself, such as the page tree. It stops at the first and the last; focus
  mode stays as it was.
- **Links.** A link in a page to another page of the same Story shows that page in place: the
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
  panels** in focus mode, each with an F keycap) is always there. The panel shortcuts (⌘\ and
  ⇧⌘\) also leave focus mode, and leaving the Story ends it; the panels come back as they were.
  At phone width, where the panels are drawers already, there is no focus mode.
- **The tree.** A keyboard tree (one tab stop, arrow keys to move and to open or close a branch)
  with "Find a page", the current page marked and its ancestors kept open. **Story pages** is the
  tree, with pages not placed yet at its end; **Published mockups** lists every page promoted from
  a mockup, in the order set, each with a screen glyph; and **Archived pages** folds away below.
- **Arranging by hand.** For an editor, each row has a handle (shown on hover, focus and the
  current row, always on touch): dragging it puts the page before or after another, or inside one
  to nest it, with a bar or a ring showing where it lands, and a strip at the end of the tree for
  the end of the top level; Esc cancels. With a row focused, Alt and ↑ or ↓ swap it with its
  neighbour, Alt and → nests it under the page above, and Alt and ← moves it out to follow its
  parent; the move is announced and the page keeps focus. Published mockups reorder the same way
  but never nest, and never enter the tree. A move shows at once and saves the whole arrangement
  with `story.set_hierarchy`, placing every page the tree shows; a drag confirms with a toast with
  **Undo**. A move refused (a page into its own subpages, deeper than six levels) says why. If the
  Story changed meanwhile, the move is applied to the newer tree and saved again once; if it no
  longer fits, the tree shows the Story as it is and a notice above it says so. Moving is off while
  "Find a page" filters the tree.
- **Row actions.** Each row's menu offers **Export this page to PDF…** and, for a page with
  subpages, **Export with its subpages…**; then **Archive** for an editor and **Delete
  permanently…** for an admin, as everywhere (§7.10). An archived page's row offers **Restore**,
  export and delete. Archiving moves the page's subpages up into its place, and its toast's
  **Undo** restores the page and puts the navigation back as it was; a restored page returns at
  the end of the tree, or of the Published mockups. Under the tree, **Story style** names the product's
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
    (`?v=N`). **Export to PDF…** opens the export with this page selected; beside it, **Archive**
    (or **Restore**) for an editor and **Delete permanently…** for an admin.
  - **Shows:** for a page from a mockup, the mockup page, linked to it on the canvas, the mockup and
    the version shown; when the mockup has a newer version, a line says so and to promote it from
    the mockup.
  - **Notes for agents:** the page's Markdown notes, which agents read before revising the page and
    update after publishing (what it is for, sources still to fold in, choices about its structure).
    Read-only here, and not versioned with the page.
  - A reader gets About alone: Shows and Notes for agents are left out, since the server sends a
    reader neither ([§3.5](03-accounts-teams-and-identity.md)). The Story
    style row under the tree is left out too, and so are **Archived pages** in the tree and the
    export, since the server gives a reader no archived page; a Story with no pages says that they
    appear once the product's team publishes them. A reader or viewer arranges, archives and
    deletes nothing: the tree has no handles, and its menus only export.
- **Export to PDF.** The dialog lists every page as checkboxes, in the Story's order (the tree,
  then the published mockups), then archived pages, with Select all, Clear and a count; it opens with the page or pages it was
  asked for already selected, and the person can change the selection. The count and Select all
  cover the pages the Story shows; an archived page goes in only when ticked, and the count adds it
  ("3 of 24 pages selected, and 1 archived"). One line says that each page's current version opens
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
  at 680px, and the narrow layout is the one the page's author made for that width.
- An empty Story uses the first-use state ([§7.5](#75-idea)): agents write it, so the request to
  copy is the only path. It says pages follow the company's design system or a house style, and
  offers **Preview Story styles**.

## 7.9 Activity

A quiet **Activity page** (`…/activity`), not a drawer and not a destination: it is reached from
**Activity** in the product's panel, and from a source's details, which open the page filtered to that
source. It is one log for people and agents together, newest first ([§4.10](04-data-model.md)).
Each entry reads as a sentence with the actor, the surface, and a link to the object: "Sam, via
claude-desktop, confirmed an assumption — 14:02". The surface is "in the app", "through the API" or
"via <client>"; what WhatBuild does by itself, such as reading an attachment, has no surface and
reads "on the server", however the attachment was uploaded, and says what came of it in a
person's words: "Read the text of call.vtt; it is the source’s derived text", never the parser's
internal label (events recorded with one are read without it, over MCP as in the app). The kind of object changed (`?entity_type=`) or
one object (`&entity_id=`) narrows it, held in the URL. Entries are grouped by day, each with its
count of changes, and load 50 at a time under "Show older changes"; the oldest day loaded may go on
past them, so while older changes wait its count says only what is loaded ("37+ changes").

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
| Assumption | its actions menu | its actions menu |
| Outcome | its card's menu on Idea | its card's menu |
| Story page | its row's menu in the tree, and the inspector's About | its row's menu, and the inspector's About |
| Mockup | in its delete dialog, as the alternative | the inspector's Version, under Download |
| Product | Settings, Archive this product, and in its delete dialog | Settings, Delete this product |
| Organization | — | Members, Delete this organization, for owners, never the example organization |

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
3. Choosing it opens a dialog titled as a question ("Delete this assumption permanently?"), that
   says it can't be undone and shows the object's preview as plain sentences before any control:
   *This deletes its attachments (4 stored versions, 218 MB), its text, summary and notes, and 1
   comment.* A count of none is left out. For an assumption it says how many other
   assumptions link to it, and that those links go with it; for an outcome, the assumptions it is
   taken from. A mockup a Story page shows lists those pages, and its delete stays disabled.
4. The dialog asks for a reason, which the button needs. A source also needs its title typed, and
   a whole product or organization its name. Every delete dialog has Cancel, and wherever the
   object can be archived, Archive instead beside it, offering it again; for what is already
   archived it is left out, and the dialog says nothing of archiving.
5. Afterwards, a toast states what was deleted and that the activity log records who, when and
   why. Nothing is silently gone.

Copy rules: the word is **delete**, never "remove", "dismiss", "clear" or "hide". "Archive" is
never described as deleting. A list row showing an archived object says *Archived*, not
*Deleted*.

## 7.11 Organization, product and account screens

- **Members** (`/t/<tenant>/members`, from the organization in the account menu, titled
  "Members"). A key to the roles (organization: owner, admin, member;
  team or product: admin, editor, viewer, reader), then everyone in the organization in two layers: their
  **organization** role (member when they have none of their own) and their **access**, the team
  and product roles that decide which products they can open. A member with no access says so and
  offers Give access. Each team or product role someone may manage has **Change**, a menu of the
  roles there, each described in words (granting again at that scope replaces the role, with
  Undo), and **Remove role**. Removing one takes effect at once with Undo, except a
  person's only role: that asks first, because it also takes them out of the organization, and a
  tenant admin may instead keep them as a member; the dialog then asks to remove the role, and
  offers both. Tenant admins get a menu per person: give access,
  change the organization role, and **Remove from the organization**, which asks first and lists
  every role they lose (`members.revoke` with `whole_tenant`). Outstanding invitations ("Waiting
  to join") show their expiry and a cancel control. **Give access** opens the people editor
  (below) for a team, a product or the organization itself, chosen first (teams first; the
  organization's member role says that it opens no product); from a person's own Give access,
  that person is already chosen. Your own organization role is not changed there. The person's writes and their attribution stay after any removal.
  Someone who is not an owner or admin of the organization sees only the people on the teams and
  products they can open, and the owners and admins, as the page says; since they may not see
  every role a person holds, removing one never asks as if it were the last
  ([§3.5](03-accounts-teams-and-identity.md)). Below, owners and admins of the organization see
  **Access changes**: the organization's access log (`members.activity`), drawn as the Activity
  feed is (§7.9), newest first, with a rename as "renamed the organization to …", and someone
  whose last role was removed as removed from the organization.
  Then **Organization name**, for its owners and admins: the name and its short name in links (the
  slug), each in a field, the short name checked as typed against the server's rule and saying that
  every product's address begins with it and that links with the old one still lead here. Owners
  Save changes (`products.rename_tenant`, under the name's etag) or Discard changes; a new short name
  is confirmed in a toast, and the page's own address then moves to it. Admins read both, told only
  its owners change them. A change made elsewhere starts the form again from what it is now.
  Someone who reads only the Story in the organization who opens the address gets a page saying
  that members aren't shown to Story readers, with a way back to their products
  ([§3.5](03-accounts-teams-and-identity.md)). The page knows this from `products.list`'s
  `story_only` and asks for the members only once that has loaded, so it is never refused.
  Someone outside the organization, or at an address that names none, is told at once that it
  doesn't exist or they can't see it (§7.1); until the members answer, the page for an
  organization that isn't theirs shows only that it is loading, not the key to the roles.
  A guest of the example organization sees a callout that it is the example organization and that
  its people aren't shown to its readers, and no list.
  Last, an organization's owners see **Delete this organization** (never the example organization):
  the dialog lists its products and counts its sources, files and people, and needs a reason and
  the organization's name typed (§7.10, [§9.5](09-data-lifecycle.md)). It is the only place an
  organization is deleted; afterwards the overview opens.
- **Invitation** (`/invite/:token`). Accepts the invitation and opens the overview with a toast
  naming the organization and role. A link already accepted by the same person (signing in accepts
  it) is the same success. Otherwise it names why the link can't be used and offers signing in
  with another address, which returns to the link; an invitation for another address makes that
  the primary action. Signed out, the link opens sign-in titled "Sign in to accept your
  invitation".
- **Connect an agent** (`/connect`, or `…/connect` inside a product). [§6.8](06-operations-and-adapters.md):
  what the agent can reach (one product, one organization, or everything) and the MCP server URL for
  that scope; sign-in; a first request
  to try, after saying the agent will ask what it may do (Read only, Edit or Admin); connected
  agents, each with what it can reach, who holds the connection, its level with a menu to change
  it, a **Can submit feedback** checkbox under its details (when a tool fails or confuses it, it may
  tell the developer of WhatBuild), and disconnect; the plain statement about
  where an agent sends what it reads. Connected agents appear here
  and nowhere else.
- **Product settings** (`…/settings`, in the product's shell): name, slug and product concept; **People**;
  export; the organization; and, for admins, archive or restore and **Delete this product**,
  whose dialog counts everything in it, needs a reason and the product's name typed, and offers
  Archive instead while the product is live (§7.10). **People** lists everyone who can reach this
  product and how, in words: a product role, or a role inherited from the team or the
  organization (`members.list` with `product`). Product admins get a role picker (admin, editor,
  viewer, reader) for product roles, **Add people** (the people editor, below, for the product),
  Remove (revokes the product role only), and
  outstanding invitations with a cancel control. An inherited role links to the organization's
  Members, where it is changed. Access is per product; nothing is granted per page or per source.
- **The people editor** (`apps/web/src/routes/people-editor.tsx`), a wide dialog that changes who
  has a role on one product, team or the organization, many people at a time. On the left, under a
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
  with their role (a picker where the person may change it); and those with access through the
  team or the organization, each with that role, and a picker that gives a team's people a role
  of their own here. A group is labelled when there is more than one, and always when its access
  is inherited. Choosing people on the right puts **Set role…** for all of them in its head, and
  the left arrow takes them off (struck through, with **Keep**; at a team or product only, saying
  "Taken off when you save" and when it is their only role there). Nothing changes until **Add N
  people** or **Save changes**, which the foot summarizes beside it: one `members.grant_many` for
  every role given or changed (100 a call), then `members.revoke` for each person taken off. A
  refusal changes nothing and names the address; it is forgotten once the choice changes. A save
  that only adds says so in a toast ("Added 3 people to Crewboard"); invitations made are then
  listed, each with **Copy link**, and **Copy every link**; one that could not be emailed says so.
  At phone width the lists stack and the arrows point down and up.
- **Settings** (`/settings`, from the account menu). Display name, and the email the person signs
  in with (read-only); Sign out everywhere; **Delete account**; below them, quiet links to Cookies
  and Privacy.
- **Delete account**, the last section of Settings (`apps/web/src/routes/delete-account.tsx`).
  Closed, one line says it deletes the account permanently and that the person sees what happens
  before anything is deleted, over **Delete account…**, which opens it in place
  (`?delete=account`, so signing in again comes back to it) and reads
  `products.delete_account_impact`. Open, it says what deleting will do, in the words of
  `packages/core/src/account-deletion.ts`, naming the organizations the person loses access to,
  and what stays. Below that, the one step left: every block at once (owning the instance; being
  the only owner of an organization, each with **Make someone else owner** and **Delete
  organization**, to its Members at Delete this organization); otherwise, for a browser that signed
  in more than 15 minutes ago, **Sign in again to continue**, with each sign-in method the
  deployment offers (the section reads again when a recent sign-in lapses while it is open); then
  the address typed exactly and **Delete account**, the one danger button, beside **Cancel**,
  which closes it. A refused delete says the account wasn't deleted, where the form was. Deleted,
  the browser forgets the person's state and opens **Your account has been deleted**
  (`/account-deleted`, signed out), which says what stays and that a confirmation was emailed
  ([§3.2](03-accounts-teams-and-identity.md#32-accounts-and-sign-in)).
- **Cookies** (`/cookies`, readable signed out; `apps/web/src/routes/cookies.tsx`). What cookies
  are for, by kind: needed for WhatBuild to work (always on), and, when the deployment uses
  analytics, Google Analytics with the person's choice, which they change here at any time. Then
  how the server counts use without cookies, and how to clear them ([§9.1](09-data-lifecycle.md)).
  It lists no individual cookies.
- **Privacy** is not a screen of the app: it is a page of the public site
  ([§7.3](#73-routes), [§9.1](09-data-lifecycle.md)), at the address `privacy_url` in
  `GET /api/v1/meta` gives (`apps/web/src/shell/privacy-link.tsx`). The sign-in page, Settings,
  Cookies, an organization's Plan page, the new-organization form and the account-deletion page
  link to it, opening it in a new tab.
- **The cookie notice** (`apps/web/src/shell/CookieNotice.tsx`). When the deployment sets an
  analytics ID (`analytics_id` from `GET /auth/methods`), every screen, signed in or not, carries a
  small note at the bottom-right inset (flush along the bottom on phones) until the person presses
  Accept or Decline, which carry equal weight and are remembered in the `wb_cookies` cookie, shared
  with the public site. It says that cookies keep the person signed in and asks whether analytics
  cookies may also be used to see how WhatBuild is used, so Accept and Decline plainly answer the
  analytics question, with a Cookies link to `/cookies`. It blocks nothing and never takes focus;
  the app works the same whichever is pressed. Without an analytics ID it does not appear; the
  server gives none to the instance's owners, or on an address that is not the deployment's own.
  After Accept, each screen is a page view with its path masked, sent once the screen has stayed a
  moment so that a redirect is not counted; each change the app makes is an event named by the
  operation the server ran (`X-WhatBuild-Operation`); and search is counted by what was opened and
  followed, never by its words (`apps/web/src/lib/analytics.ts`, [§9.1](09-data-lifecycle.md)).
- **Organizations** (`/instance`, from the panel and the account menu, for the instance's owners
  only; `apps/web/src/routes/instance.tsx`). First **Organizations**, every organization on the
  instance (`products.organizations`), under a line saying each is on a plan of its own and what
  plan a new organization starts on here, or, where the deployment offers no plans, that every
  organization is Unlimited, both set where the service is deployed (`WHATBUILD_PLANS` and
  `WHATBUILD_NEW_ORGANIZATION_PLAN`): each row its name (a link to its Plan page where the instance owner is in it), whether it is
  the example, what it holds (people, with invitations waiting, products, sources and storage), who
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
  Change plan is a link to `/instance?org=<slug>`, which opens **Plan of** the organization: what it
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
  `org` off the address. Then, where the deployment offers plans, **Plans**: that limits belong to
  plans, never to one organization, to raise as WhatBuild grows; the plans side by side (below);
  and in the head a button for each plan, which opens **The** plan: its price, as people read it,
  then every limit in a field (bytes in MB; a total, or the bytes sent a day, with **No limit**
  beside it) next to what the deployment's configuration sets, saved under the plan's etag
  (`products.set_plan_limits`) for every organization on it, with **Back to the configured
  limits**. Then, where the deployment has an example organization, **Guests**: what a guest is, a badge for whether anyone can sign up as one,
  how many are in (of the places), waiting, new today (of the day's) and ever, refreshed every half
  minute, then each setting in a field next to its default, saved together under their etag
  (`products.set_guests`). Then **Who can start
  organizations**: what the rule is, the default for every other address and who the owners are;
  then each address with an allowance: its person or "no account yet", how many it may create and
  has created, who gave it and when, the note, and what is left. **Let someone start
  organizations** opens a dialog for an address, a number, a note and whether to tell them by
  email; Change edits the number and note under the row's etag; Remove returns the address to the
  default after a confirmation. Where new organizations start on a plan the deployment defines, an
  allowance counts organizations on it, named by the plan, and moving one to another plan frees its
  place. Then, where the deployment has an example organization or someone is on it, **Waitlist**:
  the people who asked for
  an organization of their own, in the app or on the public site, earliest first, each with their
  name and address, their organization, when they asked, whether they have signed up, and what
  they wrote; **Let them start one** gives them an allowance of 1 and emails them, which takes
  them off it. Anyone
  else reaching the address is told only instance owners see this.
- **Plan** (`/t/:tenant/plan`, and `/t/:tenant/limits` as before, in the account menu for every
  organization the person is in, where the deployment offers plans; `apps/web/src/routes/limits.tsx`). What a person sees is said in
  words, for someone using WhatBuild rather than running it. **Plan**: the plan's name and price,
  what it is for, that everyone in the organization meets its limits, owners and their agents
  included (an unlimited organization has none, and one on a plan the deployment no longer defines
  meets none until it is moved); for a read-only organization, a Read-only mark and a note headed
  with how long it is kept ("Kept until 26 Oct 2027 · 365 days left", the day in UTC, as every
  refusal and the Organizations page give it) that says it went back to the
  starting plan while whoever started it already has an organization there, what everyone can still
  do there (the sentence every read-only notice gives), and how to move it to another plan, in place of **What you can add**; on
  the starting plan, where there is another, how to move to another plan (write to the deployment's
  contact, or ask whoever runs this WhatBuild) and that each organization has a plan of its own; and,
  where the deployment offers plans, that the organization's name and plan, and the name and email
  of everyone in it, are visible to whoever runs this WhatBuild, who uses them to write to its
  people, and to bill the organization where a plan has a price, with a link to Privacy. **What** the organization **holds**: people (counting
  invitations not yet accepted; readers of the Story don't count), products and sources (archived
  ones don't), and storage (split into files, which are attachments, the text read from each, kept as a file of its own, and prototypes, and text; archiving keeps it, deleting frees it), each
  as "6 of 50" over a thin bar, with "Nearly full" from 80% and "Full", with its mark, when it is
  reached, or "no limit". **Today**, with when it starts over (midnight UTC): **You** (changes,
  sources added, files uploaded, data sent to you, exports) and **Everyone in** the organization
  (changes, files uploaded), in the same form. **What you can add**: the largest file the web app
  takes (the lowest of the plan's, the deployment's and the upload relay's, since the web app
  uploads through the relay), the size above which a file is kept but not read when that is
  smaller, attachments on a source, mockups and Story pages in a product, and, where the plan says
  so, that files must be in a format WhatBuild reads (a plan with `documents_only` off keeps any
  file) or that adding a file from a link is off. Then **Plans**, the plans side by side with this
  one marked **Your plan**, where the deployment offers plans.
  The refusal a call over a limit gets, the deployment's other limits and what sets them are shown
  only to an owner of the instance, who also sees **Change plan** where the deployment offers plans, a link to the organization's
  dialog on the instance's page, **Limits of the** plan (one row each: what it counts and over
  what, what it allows, what is used, the refusal) and **Limits of this deployment**, with what sets
  each. A guest of the example reaching the address is told its plan sets nothing for them but how
  often they can call.
- **The waiting page** (any signed-in address, for a guest account that is not in; `GuestGate` in
  `apps/web/src/shell/guest-gate.tsx`). A guest account sees the app only while it holds a place
  (`GET /api/v1/me/guest-pass`, asked every minute while in, which keeps the place). Otherwise one
  sheet says why, in words: **WhatBuild is full right now**, how many guests are exploring, its
  place in line with the progress mark, and that it comes in on its own while the page stays open
  (asked again every 20 seconds); **Today's places for new guests are taken** or **You've used
  today's time**, with when it starts again; or that no guests are let in. Then what a guest may
  do, that organizations of one's own open a few at a time, **Ask for your own organization** (or,
  once asked, since when they are on the waitlist), **Sign out** and **Settings**, which a waiting
  guest still reaches. A guest that is in sees, on the example's one-line notice, the time
  left today.
- **Plans** (`/plans`, readable signed out; `apps/web/src/routes/plans.tsx`, and the public site's
  `/plans`). The plans the deployment offers side by side (`GET /api/v1/plans`), as one table
  (`apps/web/src/routes/plan-comparison.tsx`) the site, the app's page, an organization's Plan and
  the instance's page all show: each plan's name, its price as the deployment writes it (none shown
  where it gives none: "No charge" is a price a deployment may write), what it is for; then a few rows anyone reads at
  a glance (people, products, sources, storage, the largest file, whether recordings, images and
  any file are kept, an agent through MCP, readers who see only the Story, taking everything out,
  changes a day), each with a short note where a word needs it, an included feature as a check and
  one left out as a dash, each read aloud as a word; a line that each organization has a plan of its
  own, billed on its own where a plan has a price; and **Every limit** behind a disclosure, every limit of every plan with
  what it is counted over. Where the deployment offers no plans, `/plans` says so and compares
  nothing, and the public site leaves out its link to Plans.
- **People** (`/people`, from the panel and the account menu, for the instance's owners only;
  `apps/web/src/routes/people.tsx`). Every account (`products.accounts`): its name and address,
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
  ([§3.2](03-accounts-teams-and-identity.md#32-accounts-and-sign-in)). Anyone else reaching the
  address is told only instance owners see it.
- **The example organization** ([§3.10](03-accounts-teams-and-identity.md)), in
  `apps/web/src/shell/ExampleBanner.tsx`. Every screen of a product in it carries a notice above
  its content. To a guest, under "This is the example organization", it says it is a worked
  discovery to read, search and point an agent at, and that nothing in it can be changed, with
  **Start your organization** while they have none of their own and may create one, or **Ask for
  your own organization** while they may not and are not on the waitlist yet; it shows in full until they
  press Got it, then as one line, "Example organization · read only" (remembered per organization
  in the browser). To the organization's own people, its authors, it says in one line that they are
  one of its authors and that what they change there is what everyone who signs in sees. It shows nothing while it loads, so no screen waits for it. The
  overview lists the example organization after the person's own, headed **Example organization**
  with its name after it and Read only for a guest, over a line on what it is for (to a guest: a
  worked discovery to read in order, Idea, Evidence, Exploration and Story); a guest's head offers **Hide from the panel** or **Show in the panel**, the
  account's own choice (`hide_example`), and so does **Example organization** in their Settings.
  Inside a product of the example, the product switcher's line says "Example organization · " and
  its name. The account menu leaves its Members out for a guest.
- **Planned:** organization settings with usage against every limit shown as fractions
  ([§9.2](09-data-lifecycle.md)), organization export, and a danger zone
  holding only owner-gated actions (transfer ownership, close the organization), each behind a
  typed confirmation; active sessions and delete account in the person's Settings.
