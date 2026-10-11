---
type: Specification
title: The web app is a person's way to run the same operations an agent runs, one screen at a time.
description: Principles, the shell and product switching, the overview, routes, first run, and the behavior of every screen (Idea, Evidence, Exploration, Story, Activity, archive and delete, organization and account screens).
tags: [spec, web, ui, routes, shell]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# 7. Web application

This section specifies behavior and information architecture of `apps/web`. The visual design — the Studio
design system: tokens, type, components and the rules for using them — is documented in
[DESIGN.md](../../DESIGN.md).

## 7.1 Principles

- The UI uses only registry operations, through the REST routes of
  [§6.4](06-operations-and-adapters.md) and one small client (`apps/web/src/lib/api.ts`). If the UI
  needs something, it becomes an operation, and agents get it too. The exceptions are the
  person's own session, connected agents and invitations (`/api/v1/me…`), which are not content.
- **State that matters lives in the URL**: product, screen, filters, search query, selected
  page, passage position. Reload and share always work.
- Every write path handles `409 stale_etag` explicitly: show what changed, keep the person's
  unsaved text, offer reload-and-reapply. Never discard input; never overwrite silently: a
  teammate or their agent may be editing the same object.
- `409 quota_exceeded` is shown as a fact with a number and a next step, never as a failure of the
  person. (Enforced today: Story pages and mockups per product, [§9.2](09-data-lifecycle.md), and a
  public sandbox's daily allowances, [§9.7](09-data-lifecycle.md).)
- **No request the app knows will be refused.** Where the app can tell in advance that the server
  would refuse (a Story-only reader asking for members, an organization that is not a sandbox, an
  address whose id is not an id at all), it says so without asking. Where it cannot, it asks, and
  REST answers honestly: a source, assumption or other object that does not exist answers `404`,
  and its page says it was not found while the browser's console reports the `404` of the request.
  ◆ Decision: that console line is by design; the API is not bent to hide it.
- Works on narrow screens. Meets WCAG 2.2 AA. Fully keyboard-operable.
- **Interface text says one thing once.** A heading states the fact, the body adds only what the
  heading did not, and a rule is explained where it applies, not ahead of time. Words are plain and
  the same everywhere: an email address is an "email", a URL given to a person is a "link" (a
  passage keeps its "address"), people "start" an organization and "can" do things, and something
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

- **Top of the panel:** the W mark and the "WhatBuild" wordmark, linking to the overview (`/`)
  from every screen, with the button that hides the panel at the row's far end. Only the mark and
  wordmark are the link, so a click that misses the hide button does not leave the screen. Then the
  product switch, showing the product and its organization and team.
- **L1**, exactly and in this order: **Idea, Evidence, Exploration, Story**, each with its count:
  every item the stage holds (`stage_counts`, [§4.2](04-data-model.md),
  [decision](../decisions/each-stage-counts-every-item-it-holds.md)). Idea counts outcomes, Evidence
  sources, Exploration mockups and current assumptions together, and Story its pages, those in the
  tree and the Published mockups alike.
  Below them, quieter: **Connect an agent**, **Activity** (§7.9) and the product's **Settings**.
  Exploration opens on its mockups; the mockups, then the assumptions, are listed in its panel. Search belongs to Evidence. The app's URLs follow the areas
  (`/evidence`, `/exploration/…`); REST and MCP name the objects (`sources`, `mockups`).
  Exploration was called Synthesis, and a link to `/synthesis/…` opens the same path under
  `/exploration/…`. Exploration once listed insights and decisions too; a link to one opens the
  source it became ([§4.7](04-data-model.md)), and a link to either list opens Exploration.
- **A reader** ([§3.5](03-accounts-teams-and-identity.md)) has only the Story: L1 is **Story**
  alone with its count, and the quiet group is gone. The product opens on the Story, and any other
  product screen, opened by a link or typed, takes a reader to the Story, with a toast saying they
  can read only this product's Story.
- **A context slot** under the navigation, which the screen fills: the page tree on Story, find
  and filters on Evidence, the mockups and the three lists with their filters on Exploration.
- **The footer** holds the account menu, which is about the person: their email; each
  organization they belong to, with their role in it and a link to its **Members** (an organization
  where they read only the Story is left out, since its members are not shown to them); the theme
  (Light, Dark or System, which is the default; remembered per browser); **New organization**,
  while they may still create one; **Organization creators**, for an owner of the instance;
  **Settings** (their own display name); and Sign out. Last, under a hairline, is the release this
  WhatBuild runs, from `/api/v1/meta`: "Release v0.3.1", or "Commit 1a2b3c4" for a
  build that is not a release, linking to the release notes or the commit on GitHub in a new tab;
  the commit and build time stay in `/api/v1/meta`. A development
  server says so instead. Nothing in it is also in the panel.
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
  ellipsis), then a quiet link to Connect an agent, with the current
  screen marked. It never offers a way "back" to a product, because it cannot know the person came
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
   Settings. Inside one, no control offers a change the server would refuse: an outcome's actions
   menu becomes its Earlier versions button, as for a viewer. Roles are access, not content, and
   `members.grant` and `members.revoke` still work on an archived product, so its Settings keep
   People on this product for admins and say so above the list.
7. On the overview, an organization where the person has no team or product role says so, and that
   there is nothing to open until an admin gives them one.
8. Organization-level screens (the overview, Connect an agent, Settings, Members) use a different
   panel, so they are not mistaken for belonging to one product.

**The overview** (`/`, [decision](../decisions/the-overview-is-the-front-door.md)). The page that
introduces WhatBuild and is good to share as a screenshot. An intro sheet carries the mark and
wordmark, the question "What to build?", the tagline "Product discovery at the speed of AI
Engineering.", two sentences on what the app does, and a link to Connect an agent. Beside it, small and
quiet, the WhatBuild journey: Idea, Evidence, Exploration and Story, each with a line on what
it holds. It carries no counts; those are on each product below. Below, one sheet per organization, headed by its name alone, lists its active products (name,
product concept as plain words clamped to two lines, its Markdown markers dropped, last update, and the team only when the organization has more than one), each
with links to Idea, Evidence, Exploration and Story and their counts, so any section of any product
is one click away. A product where the person is a reader says "You read this product's Story."
in place of its concept, and links to the Story alone, with its count. Team admins get **New product**, a dialog on the overview (`?create=1`), so
cancelling leaves the person there; it asks for a team only when they can create in more than one.
An organization with no product the person can see says so, and says who can create one. The
overview is the only list of products: `/products` redirects to it. Roles are not shown here; the
person's organization role is in the account menu, and who has which role is on Members.

## 7.3 Routes

```
/signin  /welcome  /invite/:token             sign-in, first run, accepting an invitation
/join/:code                                   the page behind an invitation to the public sandbox
/cookies                                      Cookies: what they are for, and the analytics choice; readable signed out
/                   ?archived=1&create=1      the overview: what WhatBuild is, and every product; new product; first run with no organization
/products                                     → / (with its query)
/t/:tenant/members                            people and roles in an organization
/t/:tenant/sandbox  ?visitor                  the public sandbox: its controls for staff, what it is for a visitor
/connect            ?product                  Connect an agent: the MCP server URL for a product or all, and the agents connected now
/settings                                     Settings: the person's display name
/instance                                     Organization creators: who may create organizations (instance owners)

/t/:tenant/:team/:product                     → …/idea
  /idea               ?status                 the product concept, outcomes with counts
  /evidence           ?tags&added_by&added&query&include_archived&sort&order
                      (added: 1, 7, 30, 60 or 90 days; query: the title search)
  /evidence/new                               intake: describe it, add files, create
  /evidence/:record   ?view=passages|original|notes|files &seq=N &file=<path>
  /search             ?q&mode&scope&record_id
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
page with the overview's intro and a form to hear when WhatBuild opens, and every other path
redirects to the app. Without a site host it is at `/site/` (in development,
`http://localhost:5273/site/`)
([decision](../decisions/the-public-site-is-one-page-built-with-the-app.md)). When the deployment
uses Google Analytics, whoever serves the page writes the measurement ID into it (a
`whatbuild-analytics` meta tag), and the page shows the same cookie choice as the app, with Cookies
in its footer to change it; a request to hear from us is counted as `generate_lead`
([§9.1](09-data-lifecycle.md)).

Source links with `?tab=` resolve too: `passages`, `preview`, `files` and `notes` become
`?view=passages|original|files|notes`, and `connected` opens the inspector, where "Cited in"
lives. A product path without the `/t/` prefix (`/<tenant>/<team>/<product>[/…]`, as people type
or paste it) redirects to the same path under `/t/`.

The document title is "<screen> · <section> · <product> · WhatBuild", with a screen named after
its section ("Evidence") said once.

The Story print view is served by the API, not the app: `GET
/api/v1/p/<tenant>/<team>/<product>/story/print?page_ids=…` returns one HTML document, opened in a
new tab ([§7.8](#78-story), [§6](06-operations-and-adapters.md)).

## 7.4 Sign-in, and the first ten minutes

1. **Sign in** (`/signin`) with an email link, Microsoft or Google, whichever the deployment configures
   ([§3.2](03-accounts-teams-and-identity.md)); in development, "sign in as" a seeded account. An
   email link opens a page the server renders, naming the address, whose one button, Sign in,
   signs in and returns to `next`. Wherever sign-in returns to is a path on this origin or `/`,
   by the server's rule (`safeNext`). The
   data statement ([§9.1](09-data-lifecycle.md)) is on the sign-in page, in full, not behind a link,
   followed by one line on cookies that links to `/cookies`.
2. **First run** (`/welcome`): name the organization and the first product in one form, for an
   account that may create one ([§3.3](03-accounts-teams-and-identity.md)). The same form, titled
   New organization, starts another. An account that may not says so: the people who run the
   instance decide who may, and someone can invite them instead. A person who was invited follows
   their invitation link (`/invite/:token`) and lands in the inviter's organization.
3. Invite colleagues from the organization's Members or the product's Settings, by email or a
   single-use link.
4. **Connect an agent** (`/connect`): paste one address into an MCP client and sign in when it asks
   ([§6.8](06-operations-and-adapters.md)).

**Planned:** a public, read-only sample product at `/sample`, readable with no account — a
synthetic discovery, fully derived, with real passages, citations, assumptions, a mockup and a
published Story, every write control absent except one "copy this into my own organization" call
to action. Today the synthetic sample is created by `pnpm db:seed` and is visible only to its
seeded accounts.

## 7.5 Idea

The screen's model and names are a decision: [A product starts with its idea](../decisions/a-product-starts-with-an-idea-concept-and-outcomes.md).

The landing screen. The product concept first; then outcomes as aligned cards in a centered
content band that adapts to narrow screens. Create, edit inline, reorder, change status. Each card
shows how many assumptions point at it, linking to the assumptions filtered by that outcome; the
number is the one the linked list shows (current ones, [§4.2](04-data-model.md)). The default view, **Current**, lists active and achieved outcomes; Active, Achieved and
Archived are filters (`?status=`). With no outcomes, the list says what an outcome is and gives
the request to copy for an agent (interview the person, then write the concept and outcomes); New
outcome and Write the product concept stay in their headers. Nothing on the screen prescribes an
order of steps.

**Empty lists** ([decision](../decisions/empty-lists-lead-with-the-agent.md)). Outcomes, Sources,
Mockups, Assumptions and the Story share one first-use state: "No … yet", what belongs
there, and a request naming the product for the person to copy to their agent, with Connect an
agent (opening Connect an agent for this product) until they have one connected. Adding by hand is
the header's create action, a default button, as when the list has items. A filter over a list
with nothing in it shows the same state. Viewers see the words without the request.

## 7.6 Evidence

The sources, and everything for reading them.


- **Intake.** **Add source**, a plain button in the sheet's header, opens it. Three steps:
  **Describe it** asks for the title, the **date captured** (optional, with help text
  distinguishing it from today) and tags, offering the product's most used tags to add with one
  click ([§4.4](04-data-model.md)); participants, where it came from (the source system) and its
  relationship to the evidence (`provenance_depth`) wait behind "Participants, origin and
  relationship". **Add files** takes files and assigns roles with sensible defaults (a transcript
  beside a recording becomes primary). **Create** makes the source. Nothing asks what kind of
  material it is or where to file it. Multi-file drag-and-drop is supported;
  progress and derivation status are shown until `ready` or a terminal status with a
  plain-language explanation and next step (`needs_transcript` → "add a transcript").
- **Browse.** The panel's context slot opens with the search: one find field and a **Passages |
  Titles** toggle under it. Passages (the default) opens Search on Enter. Titles narrows the list
  as you type (`?query`, which also matches tags and file names; on a source page, Enter opens the
  list narrowed). Switching takes the words along, and switching to Passages drops the title
  search from the list. Then single-select filters, each a link that sets a URL param: **Tags** (All tags and
  the eight most used, each with its count, and "All N" for the rest; `?tags`), **Added by**
  (Anyone and each person who added sources, with counts, shown when more than one person has or
  while the filter is on; `?added_by`) and **Archived** (Hide archived, Include archived; `?include_archived`). The
  tags and people come from `sources.facets`. While any filter is on, a "Clear filters" link sits
  above Tags. On a source page the same links lead back to the list.
  Paged. The sheet is titled **Sources** (the section stays Evidence). The filters in use,
  the title search among them ("Titles matching …"), show as removable chips above the rows.
  Three dates are named as
  dates everywhere: **date captured** (the source's own date: when the interview or call
  happened, or the date the document carries), **date added** (when it came into WhatBuild) and
  **date updated** (when its details were last edited). "Sort by" and a segmented control in the
  header order the list by date captured (the default, undated last), date added, date updated or
  title (`?sort=date|added|updated|title`). A small triangle beside the current order shows its
  direction; choosing it again reverses it (`?order=asc|desc`; dates start newest first, title A
  to Z). When the sheet is narrower than 680px the same choices sit in a menu. Each row shows its
  tags and its date captured under the title, and at its end "Added <when> by <who>", or "Updated
  <when> by <who>" when the list is sorted by date updated. The header
  counts the sources listed, with "of N" live sources while filters narrow the list (left out once archived
  sources are included). While more pages wait to load, the count is still exact when
  `sources.facets` knows it: with no filter, one tag or one person; only otherwise is it the rows
  loaded so far with a plus ("50+"). Archived rows are muted and marked Archived. Rows whose titles match
  another listed row also name their primary file, so the twins can be told apart.
- **Source page.** A source is the busiest object in the app, so the page is dense on purpose.
  - **Header:** the title and the actions menu, nothing else; every property is in the inspector.
    Below it the **description**: the agent's summary note, rendered Markdown clamped to four
    lines with "Show all" and attributed, and nothing at all when there is none. Editing the
    details (title, date, tags, offering the product's tags, and the rest), adding files,
    archive, restore and delete (§7.10) are in the page's actions menu.
  - **Sections**, a segmented control held in the URL as `?view=` (links, not tabs):
    **Passages** (the default once the source is parsed), **Original** (a preview of the origin
    file, or of the primary when there is no origin, with a line saying whether it is searched and
    naming its type in words, such as "Word document", not its media type; the file shown is held
    in the URL as `&file=`, and an image opens in a viewer with zoom (buttons, `+` `-`, `0` to fit,
    `1` for actual size, double-click, a pinch or Ctrl/Cmd and the wheel), drag to pan, full screen
    (`F`), and, when the source has several images, previous and next (the arrow keys) and a strip
    of thumbnails),
    **Notes** (an "Outline and notes" sheet with the agent's outline and notes — with no agent
    outline, a document's own headings, each linking to its passage; a timed transcript's
    speaker-turn outline is left out, since the passages already show speaker and time; the sheet
    is left out when there is nothing to show — then every comment on the source, each linking to
    its passage) and **Files** (every file with its role, "Searched" or "Kept, not searched",
    versions, download, and add file, each previewable file's name opening it in Original; with
    files besides the primary, one line: "Only the
    primary file is searched. The others are kept for download."). A non-primary file's role changes from its row menu,
    confirmed in a dialog that says what the change does. Original states a recording's length
    beside the player when the parse read one.
  - **Inspector,** titled Details: **About** (the three dates together — Date captured
    (or "No date"), Date added and Date updated, the last two each with "by <who>", adding "via
    <surface>" when it was not the web, the person who added it linking to the list filtered to
    what they added, and Date updated saying "Not since it was added" when nothing changed; Tags,
    each a link to the list filtered to it; Participants; Provenance; Came from, the source
    system), **Built from** for a view with lineage
    (below), a **Files** summary (each file's role and whether it is searched, adding the number
    of stored versions only when there are more versions than files), **Cited in** (assumptions,
    mockups and Story pages, each citation linking to its exact passage or range, and the sources
    that list it as related; a Story page or mockup is judged by its current version, and says so), "Activity on this source", and
    Archive.
  - **Lineage:** a view's **Built from** group says what it was built from, by kind ("12 sources
    and 3 assumptions"), when and by whom, how the inputs were chosen, and whether it is Up to date
    or how many inputs changed since. Each changed input is listed by name, linked, with what
    changed ("Changed: title, 28 Sept 2026", "Archived", "Deleted"). When `lineage.check` finds any
    input changed, archived, deleted or missing, the page also shows an attention callout, "This
    view may be out of date", saying when it was built, from what, how many inputs changed since,
    that views are not rebuilt automatically, and "See what changed", which opens the inspector
    at Built from.
  - **Status:** a source that is not `ready` shows a callout with the status's explanation and next
    step. The server's `status_detail` is added only where it says more (a size or an error).
- **Passage reader.** Paged segments with address (¶n), speaker and cue time; heading passages
  are shown without their Markdown markers (the stored text, which citations quote, keeps them); go
  to a passage number; the URL tracks position (`?seq=N`, and `&to=M` for a range: the whole range
  is marked, on a page that starts at the range when it would otherwise cross a page boundary);
  "Search this source" at the top. Selecting a passage (Shift for a range) offers: comment, or
  copy a citation reference for an agent; the selection bar docks above the pager and never
  covers it. Reading aids:
  - a passage cited by assumptions, mockups or Story pages carries "Cited by N", a menu of
    them;
  - a passage that cites other sources the bare way (a view or digest: "source <id>, segments
    4–6") shows each citation as a "Title ¶4–6" token, and a "Cites" line of links to them;
  - a table stored as a header passage and one passage per row ("A: x | B: y") is laid out in
    columns (up to six), each row still its own passage to select and cite.
- **Citation tokens** in Markdown, views and search read "Title ¶N". A title is cut at its em-dash
  qualifier; where two cited sources on the page would read alike, each adds its qualifiers in
  brackets ("Usability study (crew) ¶29"), and identical titles are numbered. A range token links
  to the whole range.
- **Comments** (annotations) are shown inline under the passage they belong to, and listed in the
  Notes section. A comment on a range also tints every passage it covers.
- **Search.** Free-text passage search; results are passages in context with speaker and time,
  under their source's title, linking into the reader at that position. Exact-text results mark the whole
  phrase; ranked results mark each word. The UI states what was searched
  ([§8.4](08-search.md)). Assumption results carry their status, as the list does.

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
canvas the full width of the window: every page of the shown version at its own size in its
sandboxed frame ([§4.12](04-data-model.md)), laid out `columns` to a row (one row when null),
on a dotted board. Agents publish mockups; the screen reads them and offers nothing that changes
them. Its one write is promoting a page to the Story.

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
  scrolling work, and a drag on the board still moves the canvas. Holding Space pans from either
  mode. The browser remembers the mode (`whatbuild.mockup.mode`).
- **Scroll and zoom.** Scroll moves the canvas up and down, and Shift with scroll sideways; ⌘ or
  Ctrl with scroll, or a pinch, zooms about the pointer, from 5% to 400%. The toolbar has zoom out,
  the zoom level (a menu: Fit the canvas, Fit the selected page, 50%, 100%, 200%), zoom in, and fit
  the canvas. Keys: `+` and `−`, `0` for 100%, `1` fits the canvas, `2` fits the selected page.
  Moves glide unless the person prefers reduced motion.
- **Selection.** Clicking a page, its label or its name in the inspector selects it: an accent
  outline that keeps its width at any zoom. The selection is in the address (`?page=`), so a link
  can open a mockup at one page; Esc clears it, and a second Esc leaves focus mode.
- **Focus mode** works as on the Story (§7.8) and shares its remembered choice.
- **The inspector:** **Version** (a menu of every version with its date, who published the shown
  one and when, its page count, **Download version N** for the ZIP an agent builds the next version
  from, [§4.12](04-data-model.md)); **Page** (a menu of the pages with a Fit button, then the
  selected page's notes as Markdown, or a line asking the person to select a page; and where the
  page stands in the Story, below); **Brief** (the
  version's brief as Markdown); **Files** (the files the version carries, each with its length;
  one opens in a dialog as rendered Markdown or as source text, never as HTML, with Copy);
  **Explores** (the outcomes, assumptions and sources it links, with
  their state in words, as the Story's Draws on); and **Cited passages**, each with its
  `mockups.check_citations` status in words, as on a Story page.
- A callout above the canvas appears only for a state the person must know: the mockup is
  archived, an earlier version is shown (with **Show the current version**), or the version asked
  for does not exist.
- **On the Story** ([decision](../decisions/agents-maintain-the-story-people-read-it.md)). Under
  the page picker, each Story page that shows the selected page is named and linked with the
  mockup version it shows. An editor whose page is not on the Story gets **Promote to Story**: a
  dialog says that a new Story page will show the page as it is in the version shown, that nothing
  is copied, that it stays on that version until someone promotes a newer one, and that it joins
  the end of the Story's Published mockups, which agents keep in order, and asks for its title (the page's own by default). Where a
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
  entry page shows the statement, body, citations with their **snapshot text** and live
  `check_citations` status in words (which also says when a quote matched only ignoring
  formatting, when the primary file has a newer version, and when the source was parsed again
  since the citation), links grouped by type, and the full review history. Actions: review
  (status + required note, optional confidence; before the first review the form says that saving
  freezes the statement, body and citations), link, supersede (opens a prefilled new entry).
  Frozen fields ([§4.8](04-data-model.md)) are shown as such, with "supersede" as the path to
  change them.
- **New and edit entries** ([decision](../decisions/register-entries-may-start-uncited.md)):
  New assumption (`…/assumptions/new`, with `?outcome_id=` preselecting an outcome) take a statement, an optional why (Markdown) and the outcomes it bears
  on, and need no citation. An entry nobody has reviewed has Edit in its actions menu
  (`…/:id/edit`); a reviewed one is frozen. Citations come from agents; an entry without any says
  "No passages cited yet" on its page and its row. When every entry in the default view is refuted
  or replaced, the list says so and links to that view.

## 7.8 Story

The Story reads like a wiki: the page tree on the left, the page in the middle, its details on
the right. Agents write, arrange, archive and restore it; the screen reads it and offers nothing
that changes it ([decision](../decisions/agents-maintain-the-story-people-read-it.md)). A page of a
mockup reaches it by promotion, from the mockup (§7.7).

- **Reader first.** The page tree sits in the panel's context slot, and the canvas holds the crumbs
  (the current one is the screen's heading), the focus mode control, and then the page, with
  nothing between them. The crumbs sit on the line of the panels' heads, and the page fills the
  window down to the panels' bottom edge and scrolls inside its frame, so the canvas does not
  scroll and the crumbs stay in view; if the window is too short for the page, the crumbs stay
  pinned at the top. Opens
  the last page this browser read in this product, otherwise the first root page. Pages render
  only in the sandboxed frame ([§4.11](04-data-model.md)); the frame follows the app's theme.
  Until the frame has its document, skeleton lines stand in for the page. A callout appears above
  the page only for a state the reader must know: the page is archived, an earlier version is
  shown (with **Show the current version**), or the page tried to open another address in its
  place, and was put back.
- **A page from a mockup** ([§4.11](04-data-model.md)) is shown at its own size, scaled down to the
  measure and never up, on paper as on the canvas, without the app's theme. Its crumbs read Story ›
  Published mockups › the page.
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
  tree, with pages an agent has not placed yet at its end; **Published mockups** lists every page
  promoted from a mockup, in the order agents set, each with a screen glyph; and **Archived
  pages** folds away below. The only row
  action is export: each row's menu offers **Export this page to PDF…** and, for a page with
  subpages, **Export with its subpages…**. Under the tree, **Story style** names the product's
  Story style ("A house style", "Adapted from Tufte", "Your design system", or "None yet") and
  opens the style dialog.
- **The style dialog** lists the style in use and the four house styles, and shows the chosen one
  on the same sample page, in the Story sandbox, laid out at desktop width and scaled to fit, with
  a link to open it full size. For a house style it says what it is best for and its character,
  and gives a sentence to copy and send to an agent ("Adopt the Tufte house style for our
  WhatBuild Story."); a second sentence asks an agent to follow the company's own design system.
  The dialog changes nothing itself ([decision](../decisions/story-pages-follow-the-teams-design-system.md)).
- **The inspector** carries everything else about the page:
  - **About:** who published the shown version and when, and its version number. With more than
    one version, the number is a menu of every version with its date, and choosing one shows it
    (`?v=N`). A line says that agents write and maintain the Story, and **Export to PDF…** opens
    the export with this page selected.
  - **Shows:** for a page from a mockup, the mockup page, linked to it on the canvas, the mockup and
    the version shown; when the mockup has a newer version, a line says so and that the page stays
    on its version until someone promotes the newer one.
  - **Draws on:** the version's references — outcomes, sources, assumptions — each linked.
  - **Cited passages:** each citation as the source title, its address (¶8–9, linking to the
    passage) and a snapshot quote, with its `story.check_citations` status in words, worded as
    on an assumption.
  - **Notes for agents:** the page's Markdown notes, which agents read before revising the page and
    update after publishing (what it is for, sources still to fold in, choices about its structure).
    Read-only here, and not versioned with the page.
  - A reader gets About alone: Shows, Draws on, Cited passages and Notes for agents are left out, since
    the server sends a reader none of them ([§3.5](03-accounts-teams-and-identity.md)). The Story
    style row under the tree is left out too, and so are **Archived pages** in the tree and the
    export, since the server gives a reader no archived page; a Story with no pages says that they
    appear once the product's team publishes them.
- **Export to PDF.** The dialog lists every page as checkboxes, in the Story's order (the tree,
  then the published mockups), then archived pages, with Select all, Clear and a count; it opens with the page or pages it was
  asked for already selected, and the person can change the selection. The count and Select all
  cover the pages the Story shows; an archived page goes in only when ticked, and the count adds it
  ("3 of 24 pages selected, and 1 archived"). It says what the PDF holds:
  a contents list, then each selected page at its current version under its title, with its
  version number and publish date. It says what it leaves out: what a page draws on, its cited
  passages and notes, earlier versions, and anything a page draws with scripts. **Open print view**
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
"via <client>"; what WhatBuild does by itself, such as parsing a file, has no surface and reads "on
the server", however the file was uploaded, and says what came of it in a person's words:
"Parsed call.vtt into 412 passages", never the parser's internal label (events recorded with one
are read without it, over MCP as in the app). A note's passages read as the app writes them, ¶4 or
¶4–6. The kind of object changed (`?entity_type=`) or
one object (`&entity_id=`) narrows it, held in the URL.

This is how a person answers "what did my colleague's agent just do to my product" without reading
a diff. It is also the first place to look when a `409` surprises someone.

## 7.10 Archiving and deleting

One pattern, used identically wherever an object can be removed
([§9.5](09-data-lifecycle.md)). Permanent delete exists for sources today; every other object
offers archive only.

1. The visible control is **Archive**. It is a plain, ordinary action with no confirmation beyond
   an undo toast, because it is reversible. Its tooltip says what archiving does: takes this out of
   your views and out of what an agent can search, keeps everything.
2. **Delete** sits inside the same menu, below a separator, styled as destructive, never
   pre-selected and never the primary button of any dialog.
3. Choosing it opens a dialog that leads with **"Delete permanently. This cannot be undone."** and
   shows the `delete_impact` result as plain sentences before any control: *4 files (218 MB), 2
   derivations, 1 annotation, 3 revisions. **2 citations in 2 assumptions point at this
   record** and will be left pointing at a tombstone — their quoted text will be kept.* When
   Story versions cite the source, it counts them, earlier versions included, and lists each page
   with which of its versions do ("Current version and 2 earlier").
4. The dialog asks for a reason, and requires the person to type the object's title to enable the
   button. Archive is offered again, in the dialog, as the secondary action.
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
  offers Give access. Removing a team or product role takes effect at once with Undo, except a
  person's only role: that asks first, because it also takes them out of the organization, and a
  tenant admin may instead keep them as a member. Tenant admins get a menu per person: give access,
  change the organization role, and **Remove from the organization**, which asks first and lists
  every role they lose (`members.revoke` with `whole_tenant`). Outstanding invitations ("Waiting
  to join") show their expiry and a cancel control. **Give access** takes an email, a team,
  product or the organization itself (teams first; the organization's member role warns that it
  opens no product), and a role described in words; someone without an account gets a
  single-use link. The person's writes and their attribution stay after any removal.
  Someone who is not an owner or admin of the organization sees only the people on the teams and
  products they can open, and the owners and admins, as the page says; since they may not see
  every role a person holds, removing one never asks as if it were the last
  ([§3.5](03-accounts-teams-and-identity.md)). Below, owners and admins of the organization see
  **Access changes**: the organization's access log (`members.activity`), drawn as the Activity
  feed is (§7.9), newest first; in a sandbox its entries about the sandbox lead to its controls.
  Someone who reads only the Story in the organization who opens the address gets a page saying
  that members aren't shown to Story readers, with a way back to their products
  ([§3.5](03-accounts-teams-and-identity.md)). The page knows this from `products.list`'s
  `story_only` and asks for the members only once that has loaded, so it is never refused.
- **Invitation** (`/invite/:token`). Accepts the invitation and opens the overview with a toast
  naming the organization and role. A link already accepted by the same person (signing in accepts
  it) is the same success. Otherwise it names why the link can't be used and offers signing in
  with another address, which returns to the link; an invitation for another address makes that
  the primary action. Signed out, the link opens sign-in titled "Sign in to accept your
  invitation".
- **Connect an agent** (`/connect`, or `…/connect` inside a product). [§6.8](06-operations-and-adapters.md):
  what the agent can reach (one product, one organization, or everything) and the MCP server URL for
  that scope, with a sentence saying WhatBuild refuses anything outside it; sign-in; a first request
  to try; connected agents, each with what it can reach and who holds the connection, and
  disconnect; the plain statement about
  where an agent sends what it reads, and an optional skill download. Connected agents appear here
  and nowhere else.
- **Product settings** (`…/settings`, in the product's shell): name, slug and product concept; **People**;
  export; the organization; and archive or restore. **People** lists everyone who can reach this
  product and how, in words: a product role, or a role inherited from the team or the
  organization (`members.list` with `product`). Product admins get a role picker (admin, editor,
  viewer, reader) for product roles, **Add people** (pick someone already in the organization whom
  they can see, or invite by email; `members.grant` with the product scope), Remove (revokes the product role only), and
  outstanding invitations with a cancel control. An inherited role links to the organization's
  Members, where it is changed. Access is per product; nothing is granted per page or per source.
- **Settings** (`/settings`, from the account menu). Display name, and the email the person signs
  in with (read-only); below them, a link to Cookies.
- **Cookies** (`/cookies`, readable signed out; `apps/web/src/routes/cookies.tsx`). What cookies
  are for, by kind: needed for WhatBuild to work (always on), and, when the deployment uses
  analytics, Google Analytics with the person's choice, which they change here at any time. Then
  how to clear them ([§9.1](09-data-lifecycle.md)). It lists no individual cookies.
- **The cookie notice** (`apps/web/src/shell/CookieNotice.tsx`). When the deployment sets an
  analytics ID (`analytics_id` from `GET /auth/methods`), every screen, signed in or not, carries a
  small note at the bottom-right inset (flush along the bottom on phones) until the person presses
  Accept or Decline, which carry equal weight and are remembered in the `wb_cookies` cookie, shared
  with the public site. It says that cookies keep the person signed in and asks whether analytics
  cookies may also be used to see how WhatBuild is used, so Accept and Decline plainly answer the
  analytics question, with a Cookies link to `/cookies`. It blocks nothing and never takes focus;
  the app works the same whichever is pressed. Without an analytics ID it does not appear. After
  Accept, each screen is a page view with its path masked, and each change the app makes is an
  event named from a fixed word list (`apps/web/src/lib/analytics.ts`, [§9.1](09-data-lifecycle.md)).
- **Organization creators** (`/instance`, from the account menu, for the instance's owners only;
  `apps/web/src/routes/instance.tsx`). What the rule is, the default for every other address and
  who the owners are; then each address with an allowance: its person or "no account yet", how
  many it may create and has created, who gave it and when, the note, and what is left.
  **Let someone create organizations** opens a dialog for an address, a number, a note and whether
  to tell them by email; Change edits the number and note under the row's etag; Remove returns the
  address to the default after a confirmation. Anyone else reaching the address is told only
  instance owners decide this.
- **The public sandbox** ([§3.10](03-accounts-teams-and-identity.md),
  [§9.7](09-data-lifecycle.md)), in `apps/web/src/routes/public-sandbox.tsx` and
  `apps/web/src/shell/PublicSandboxBanner.tsx`:
  - **The notice.** Every screen of a product in the sandbox carries it above its content: that
    the organization is public, the name the person writes under, and when everything added is
    erased. It shows in full until the person presses Got it, and as one line from then on
    (remembered per organization in the browser). It is hidden in the Story's focus mode. Staff
    get their own words and a link to the controls. It shows nothing while it loads or if it
    fails, so no screen waits for it.
  - **The invitation** (`/join/:code`) is readable signed out. It says what the sandbox is, that
    it is public and erased, what a visitor can and cannot do, and the day's main limits, then
    offers Sign in to enter, or Enter the sandbox when signed in. Opening the link never enters
    by itself. An invitation that admits nobody else says why. Sign-in reached from it is titled
    "Sign in to enter the sandbox".
  - **The controls** (`/t/:tenant/sandbox`, for owners and admins; Sandbox controls in the
    account menu). The address of an organization the person is in that is not a sandbox says so
    without asking the server, which would refuse it. State at a glance, with two switches that act at once: what visitors may do
    (writing, reading only, closed) and whether their agents may connect. Then seats, the next
    and last reset, and today's use. **Limits** is one table of every limit: what it counts, what
    it is counted over, its value in a field, its default, and the error a call over it gets.
    Below it are the reset's hour, time zone and switch. One Save changes button saves the table
    and the schedule together. Then **Baselines** (Save baseline; Reset to this one),
    **Invitations** (New invitation shows the link once; Withdraw), **Visitors** (found by name,
    address or made-up name with `?visitor=`; Remove) and **Limits of this deployment**, read
    only. Reset now and Reset to this one ask first and list what is erased.
  - **For a visitor** the same address (About this sandbox in the account menu) shows the notice,
    the name they write under, what they can do, and every allowance with what is used today. A
    member whom staff gave a role sees the same page, with the notice and what they can do
    written for a member. A member who reads only the Story sees **You read: The Story** and that
    they write nothing, in place of the name they write under. A daily allowance set to 0 shows as
    Off, and `sandbox.status` gives its refusal as `403 sandbox_restricted`. The notice above every
    screen says who sees what the person adds: other visitors, for a visitor; everyone there, for a
    member; visitors, under their own name, for staff. A member who reads only the Story is told
    instead that they read the Story and write nothing, and its one-line form says "You read the
    Story." Where exports are set to 0, a product's Export sheet says exporting is off for visitors
    and offers no Export button, except to staff.
  - **Members** in the sandbox shows anyone but staff only themselves, and shows staff the
    organization's own people with the visitors as a count and a link to the controls; no visitor
    is listed, even one given a role on a team or product. The account
    menu leaves Members out for a visitor. An organization that is a sandbox is tagged Public
    sandbox on the overview.
  - **First run** (`/welcome`) for an account made for the sandbox that is not in it says so, and,
    unless an instance owner gave it an allowance, offers no organization to create.
- **Planned:** organization settings with usage against every limit shown as fractions
  ([§9.2](09-data-lifecycle.md)), the data statement, organization export, and a danger zone
  holding only owner-gated actions (transfer ownership, close the organization), each behind a
  typed confirmation; active sessions and delete account in the person's Settings.
