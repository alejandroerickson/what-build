---
type: Specification
title: The web app is a person's way to run the same operations an agent runs, one screen at a time.
description: Principles, the shell and product switching, routes, first run, and the behavior of every screen (Idea, Evidence, Synthesis, Story, Activity, archive and delete, organization and account screens).
tags: [spec, web, ui, routes, shell]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
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
  person's own session, tokens and invitations (`/api/v1/me…`), which are not content.
- **State that matters lives in the URL**: product, screen, filters, search query, selected
  page, passage position. Reload and share always work.
- Every write path handles `409 stale_etag` explicitly: show what changed, keep the person's
  unsaved text, offer reload-and-reapply. Never discard input; never overwrite silently: a
  teammate or their agent may be editing the same object.
- `409 quota_exceeded` is shown as a fact with a number and a next step, never as a failure of the
  person. (The only quota enforced today is Story pages per product, [§9.2](09-data-lifecycle.md).)
- Works on narrow screens. Meets WCAG 2.2 AA. Fully keyboard-operable.
- Agents are teammates: attribution in the UI shows who wrote something **and through which
  surface** (for example "Sam · via claude-desktop").

## 7.2 The shell, and product switching

**The shell.** Every signed-in screen sits on one stage: a floating left panel, the canvas, and —
only on a Story page and a source page — an inspector on the right. Everywhere else the content
takes the full width. There are no in-app tabs: one screen at a time, and rows are real links, so
the browser's back button and "open in new tab" both work.

- **Top of the panel:** the W mark and the "WhatBuild" wordmark, linking to the product's
  Idea screen, with the button that hides the panel beside them; then the product switch, showing
  the product and its organization and team.
- **L1**, exactly and in this order: **Idea, Evidence, Synthesis, Story**, each with its count
  (Idea counts outcomes).
  Below them, quieter: **Agents** (the Connect page) and **Settings**. Synthesis opens on
  Insights; assumptions and decisions are its other sub-views, reached as quiet links from it.
  Search belongs to Evidence. The app's URLs follow the areas (`/evidence`, `/synthesis/…`); REST
  and MCP name the objects (`sources`, `insights`).
- **A context slot** under the navigation, which the screen fills: the page tree on Story, find
  and filters on Evidence.
- **The footer** holds the account menu: Activity (§7.9), the theme (Light, Dark or System, which
  is the default; remembered per browser), Account and tokens, All products, and Sign out.
- **Hiding.** The panel hides completely, never to an icon rail, with its button or `⌘\` / `Ctrl+\`
  (ignored while typing in a field), and the choice is remembered per browser. While it is hidden
  a small floating pill shows the mark, the product name and the current section, and brings the
  panel back.
- **The inspector** docks at the right on wide screens. At 1100px and below it becomes an overlay,
  opened by a "Details" button, with a focus trap and Esc to close.
- **On a phone** (760px and below) the panel is a drawer with a scrim: focus is trapped, Esc
  closes it, and it closes on navigation.
- **Outside a product** (Agents, Account and tokens, organization Members, All products) the panel
  offers "Back to <product>" for the product the person came from, then those screens.
- A skip link leads to the content; on a route change focus moves to the new heading and the page
  is announced politely.

**Switching.** An account may belong to several organizations (tenants) and teams, and a team
holds several products. A person must always know where they are, and move without losing their
place.

1. The current product, with its organization and team, is shown at the top of the panel on every
   product screen.
2. The product switch is one interaction away on every product screen. It lists every reachable
   product grouped by organization and team, and links to New product, the organization's members,
   and All products.
3. **Switching product keeps the section**: from Evidence in product A to Evidence in product B.
   Idea, Evidence, Synthesis, Story, Activity, Search and Settings carry over; anything else
   (a record id, an insight) lands on Idea.
4. The product is in the URL path (`/t/<tenant>/<team>/<product>/…`). Opening a link to another
   product simply works, and becomes the remembered one.
5. The last-used product is remembered per browser. `/` opens it; otherwise the first reachable
   product; otherwise All products if the person belongs to an organization; otherwise first run.
6. Archived products appear only in All products, behind a "With archived" filter, read-only, and
   an admin restores them from the product's Settings.
7. Organization-level screens (Agents, Account and tokens, Members, All products) use a different
   panel, so they are not mistaken for belonging to one product.

## 7.3 Routes

```
/signin  /welcome  /invite/:token             sign-in, first run, accepting an invitation
/                                             the last product this browser used, else the first, else first run
/products           ?archived=1&create=1      every product you can reach, by organization and team; new product
/t/:tenant/members                            people and roles in an organization
/connect                                      Agents: connect an agent (MCP URL, the skill, tokens)
/account                                      display name, tokens, connected agents

/t/:tenant/:team/:product                     → …/idea
  /idea               ?status                 the product concept, outcomes with counts
  /evidence           ?folder&kind&organization&date_from&date_to&tags&query&include_archived
  /evidence/new       ?kind                   kind-first intake
  /evidence/:record   ?view=passages|original|notes|files &seq=N
  /search             ?q&mode&scope&record_id
  /synthesis                                  → …/synthesis/insights
  /synthesis/insights ?review=unreviewed|reviewed &outcome_id&source_id&status&query
  /synthesis/insights/new  /synthesis/insights/:id  /synthesis/insights/:id/edit
  /synthesis/assumptions[/:id]  /synthesis/decisions[/:id]   lists take ?show&outcome_id
                      (show: current, unconfirmed, confirmed, all)
  /story[/:page]      ?v=N
  /activity           ?who=people|agents &entity_type&entity_id
  /settings                                   name, slug, people, export, organization, archive
```

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

1. **Sign in** (`/signin`) with an email link or Google, whichever the deployment configures
   ([§3.2](03-accounts-teams-and-identity.md)); in development, "sign in as" a seeded account. The
   data statement ([§9.1](09-data-lifecycle.md)) is on the sign-in page, in full, not behind a link.
2. **First run** (`/welcome`): name the organization and the first product in one form. A person
   who was invited follows their invitation link (`/invite/:token`) instead and lands in the
   inviter's organization.
3. Invite colleagues from the organization's Members or the product's Settings, by email or a
   single-use link.
4. **Agents** (`/connect`): paste one endpoint into Claude Desktop or Claude Code, install the
   skill ([§6.8](06-operations-and-adapters.md)).

**Planned:** a public, read-only sample product at `/sample`, readable with no account — a
synthetic discovery, fully derived, with real passages, citations, a filled register and a
published Story, every write control absent except one "copy this into my own organization" call
to action. Today the synthetic sample is created by `pnpm db:seed` and is visible only to its
seeded accounts.

## 7.5 Idea

The screen's model and names are a decision: [A product starts with its idea](../decisions/a-product-starts-with-an-idea-concept-and-outcomes.md).

The landing screen. The product concept first; then outcomes as aligned cards in a centered
content band that adapts to narrow screens. Create, edit inline, reorder, change status. Each card
shows how many insights, assumptions, and decisions point at it, linking into Synthesis filtered by
that outcome; each number is the one the linked list shows (current entries, [§4.2](04-data-model.md)). The default view, **Current**, lists active and achieved outcomes; Active, Achieved and
Archived are filters (`?status=`). An empty product presents this screen as
the first step of the loop: write the product concept, then the first outcome, then add material.

## 7.6 Evidence

The sources, and everything for reading them.


- **Upload, kind-first.** Step 1 asks what the material *is* (kinds grouped as in
  [§4.4](04-data-model.md), in plain language). Step 2 asks for title, the **date captured** (with
  help text distinguishing it from today), and optional metadata relevant to that kind. Step 3
  takes files and assigns roles with sensible defaults (a transcript beside a recording becomes
  primary). The person never sees or chooses a folder. Multi-file drag-and-drop is supported;
  progress and derivation status are shown until `ready` or a terminal status with a
  plain-language explanation and next step (`needs_transcript` → "add a transcript").
- **Browse.** Filters held in the URL: folder, kind, organization, date range, tags, title
  substring, archived — set from the panel's context slot, each a link that sets URL params.
  Paged. The sheet is titled **Sources** (the section stays Evidence). Three dates are named as
  dates everywhere: **date captured** (the source's own date: when the interview or call
  happened, or the date the document carries), **date added** (when it came into WhatBuild) and
  **date updated** (when its details were last edited). "Sort by" and a segmented control in the
  header order the list by date captured (the default, undated last), date added, date updated or
  title (`?sort=date|added|updated|title`). A small triangle beside the current order shows its
  direction; choosing it again reverses it (`?order=asc|desc`; dates start newest first, title A
  to Z). When the sheet is narrower than 680px the same choices sit in a menu. The panel's date
  filter is headed "Date captured". Each row's end says "Updated <when> by <who>". The header
  counts the sources listed, with "of N" live sources while filters narrow the list (left out once archived
  sources are included). Archived rows are muted and marked Archived. Rows whose titles match
  another listed row also name their primary file, so the twins can be told apart. A folder filter
  below a kind group (from a source's "Filed in") reads as the group and the rest of the path.
- **Source page.** A source is the busiest object in the app, so the page is dense on purpose.
  - **Header:** the title, then a meta line (kind, "Captured <date>", organization, and "Added by <who> · via
    <surface>, <date>"). Below it the **description**: the agent's summary note when there is one,
    rendered Markdown clamped to four lines with "Show all"; otherwise "No description yet. Ask your
    agent to summarize this source." linking to Agents. Editing the details (including kind —
    "reorganize" — without any mention of paths), adding files, archive, restore and delete
    (§7.10) are in the page's actions menu.
  - **Sections**, a segmented control held in the URL as `?view=` (links, not tabs):
    **Passages** (the default once the source is parsed), **Original** (a preview of the origin
    file, or of the primary when there is no origin, with a line saying whether it is searched and
    naming its type in words, such as "Word document", not its media type),
    **Notes** (the agent's outline and notes, then every comment on the source, each linking to its
    passage; with no agent outline, a document's own headings, each linking to its passage — a
    timed transcript's speaker-turn outline is left out, since the passages already show speaker
    and time) and **Files** (every file with its role, "Searched" or "Kept, not searched",
    versions, download, and add file). A non-primary file's role changes from its row menu,
    confirmed in a dialog that says what the change does. Original states a recording's length
    beside the player when the parse read one.
  - **Inspector:** **Details** (kind, the three dates together — date captured, date added, date
    updated, with who updated it when it has changed since it was added — organization,
    participants, tags, source system, evidence, where it is filed — a link to the list filtered to
    that folder — and added by), a **Files** summary ("2 files", adding stored versions only when there are more
    versions than files; only the primary is searched), **Cited in** (insights, assumptions,
    decisions and Story pages, each citation linking to its exact passage or range; a Story page
    is judged by its current version, and says so), "Activity on this source", and Archive. On a
    narrow screen the page stacks header, description and sections, and the inspector opens from
    "Details".
  - **Lineage:** a view with lineage says what it was built from: "Built from 17 inputs · none
    changed since" with an Up to date mark, or, when `lineage.check` finds inputs changed,
    archived, deleted or missing, an attention callout "Built from 17 inputs · 10 changed since"
    with the counts and when it was built. Nothing is rebuilt automatically.
  - **Status:** a source that is not `ready` shows a callout with the status's explanation and next
    step. The server's `status_detail` is added only where it says more (a size or an error).
- **Passage reader.** Paged segments with address (¶n), speaker and cue time; heading passages
  are shown without their Markdown markers (the stored text, which citations quote, keeps them); go
  to a passage number; the URL tracks position (`?seq=N`, and `&to=M` for a range: the whole range
  is marked, on a page that starts at the range when it would otherwise cross a page boundary);
  "Search this source" at the top. Selecting a passage (Shift for a range) offers: comment, or
  copy a citation reference for an agent; the selection bar docks above the pager and never
  covers it. Reading aids:
  - a passage cited by assumptions, decisions or Story pages carries "Cited by N", a menu of
    those entries;
  - a passage that cites other sources the bare way (a view or digest: "source <id>, segments
    4–6") shows each citation as a "Title ¶4–6" token, and a "Cites" line of links to them;
  - a table stored as a header passage and one passage per row ("A: x | B: y") is laid out in
    columns (up to six), each row still its own passage to select and cite.
- **Citation tokens** in insights, views and search read "Title ¶N". A title is cut at its em-dash
  qualifier; where two cited sources on the page would read alike, each adds its qualifiers in
  brackets ("Usability study (crew) ¶29"), and identical titles are numbered. A range token links
  to the whole range.
- **Comments** (annotations) are shown inline under the passage they belong to, and listed in the
  Notes section. A comment on a range also tints every passage it covers.
- **Search.** Same filters plus free-text passage search; results are passages in context with
  speaker and time, linking into the reader at that position. Exact-text results mark the whole
  phrase; ranked results mark each word. The UI states what was searched
  ([§8.4](08-search.md)). Insight results carry the same review badge as the Insights list.

## 7.7 Synthesis

Insights, the list of insight documents, is the landing view. Assumptions and decisions are
reached from it.


- **Insight documents:** list with status, summary, and reference counts; a reader with rendered
  Markdown; an editor with preview and a reference picker for outcomes, sources, insights,
  assumptions, decisions; explicit publish and unpublish.
- **Insight review** ([§4.7](04-data-model.md)): a person marks an insight **reviewed**; an insight
  edited after its review shows as **changed since review** until it is reviewed again. The list
  has a segmented filter **All / Unreviewed / Reviewed** (`?review=`; Unreviewed includes changed
  since review, and shows how many wait) and a review badge on each row. The insight page shows the
  state in words with who reviewed it and when, a **Mark reviewed** button, and Undo on a reviewed
  insight. Its **Connected** list marks each reference's state in words where the reader should
  know it (Archived, Achieved, a register entry's status, No longer in this product), as the Story
  inspector's Draws on does.
- **Revision history** ([§4.1](04-data-model.md)): a list of revisions with author, surface and
  time; a read-only view of any revision; and a restore that writes the old content as a new
  revision. The entry point is visible on the reader, because the most likely reason to look is
  that an agent rewrote something. It exists for insights and outcomes, the two objects whose
  revisions the operations expose, and looks and behaves identically in both. Planned: a diff
  against the current text, and the same control for the product concept, annotations and unreviewed
  register entries once their revisions are exposed.
- **Registers:** two lists, filterable by review status (`?show=`: Current, Unconfirmed,
  Confirmed, All statuses — named after the status chips on the rows) and outcome; the default
  is current entries, and the header counts the rows the view lists. Where a view lists superseded
  entries, each sits under the entry that replaced it, muted, marked "Replaced by the entry
  above". An
  entry page shows the statement, body, citations with their **snapshot text** and live
  `check_citations` status in words (which also says when a quote matched only ignoring
  formatting, when the primary file has a newer version, and when the source was parsed again
  since the citation), links grouped by type, and the full review history. Actions: review
  (status + required note, optional confidence; before the first review the form says that saving
  freezes the statement, body and citations), link, supersede (opens a prefilled new entry).
  Frozen fields ([§4.8](04-data-model.md)) are shown as such, with "supersede" as the path to
  change them.

## 7.8 Story

- **Reader first.** The page tree sits in the panel's context slot, and the canvas holds the page
  nearly on its own: the crumbs (the current one is the screen's heading), a quiet meta line
  "Version n · updated <date>", then the page. Nothing else is on the canvas. Opens the last page
  this browser read in this product, otherwise the first root page. Pages render only in the
  sandboxed frame ([§4.11](04-data-model.md)); the frame resizes to content and follows the app's
  theme. Until the frame has its document, skeleton lines stand in for the page.
- **The tree.** A keyboard tree (one tab stop, arrow keys) with "Find a page", expand and collapse
  all, the current page marked, add a page, and sections for **Unplaced pages** (published, not yet
  in the navigation) and **Archived pages**. Each row's menu: Rename… (a republish that creates a
  version, and the dialog says so), Add child page…, Move to…, Copy link, Export to PDF…, and
  Archive (reversible; its subpages move up into its place) or Restore.
- **Arrange:** drag a page by its handle to reorder or nest it, or with the page focused use Alt +
  arrow keys, or Move to… (a dialog picking the parent and the position — the single-pointer
  alternative to dragging). Drag and Move to… offer Undo. Every move saves the whole tree through
  `story.set_hierarchy` against the hierarchy's ETag. On `409` the tree is read again, the
  person's pending moves are re-applied and saved once more; if that fails too, the other
  arrangement is shown and the screen says what happened. The limits hold: 50 pages, depth 6.
- **The inspector** carries everything else about the page:
  - **About:** who published this version and when, the version selector (`?v=N`) listing each
    version's change note, the parent page, subpages as links, "Activity on this page", and
    Archive.
  - **Draws on:** the version's references — outcomes, sources, insights, assumptions,
    decisions — each linked.
  - **Cited passages:** each citation as the source title, its address (¶8–9, linking to the
    passage) and a snapshot quote, with its `story.check_citations` status in words, worded as
    on a register entry.
  - **Notes for agents:** the page's Markdown note, which agents read before revising the page and
    update after publishing (what it is for, sources still to fold in, decisions about structure).
    Not versioned with the page. People with write access edit it in a dialog; a `409` keeps their
    text.
- **Export to PDF.** "Export to PDF…" is in the tree's header menu and in each page's menu, with
  that page preselected. The dialog lists the tree as checkboxes, with Select all, Clear and a
  count; the person picks exactly the pages they want — subpages are never added for them. **Open
  print view** is a link that opens the print view in a new tab ([§7.3](#73-routes)): a title block
  with the product name and the export date, a contents list, then the chosen pages in tree order
  (unplaced pages after, by title), each under its title as a heading whose level follows the
  outline, at its current version. The person saves it as PDF from the browser's print dialog.
  Page scripts do not run there, and the dialog says that content drawn by a page's scripts is
  left out.
- Authoring HTML is primarily an agent task. The UI offers "Publish a new version…" by paste or
  file for people who want it, with validation errors shown precisely. No WYSIWYG editor.
- An empty Story explains how to ask a connected agent to draft it, and links to Agents.

## 7.9 Activity

A quiet **Activity page** (`…/activity`), not a drawer and not a destination: it is reached from
**Activity** in the account menu, and from an item through its "Activity on this …" link (a Story
page, a source), which opens the page filtered to that item. It lists events newest first
([§4.10](04-data-model.md)). Each entry reads as a sentence with the actor, the surface, and a link
to the object: "Sam, via claude-desktop, confirmed an assumption — 14:02". Filters, held in the
URL: **All / People / Agents** (`?who=`; Agents means everything done over MCP), and the kind of
object changed (`?entity_type=`), or one object (`&entity_id=`).

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
   derivations, 1 annotation, 3 revisions. **2 citations in the decision register point at this
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

- **Members** (`/t/<tenant>/members`). Everyone in the organization with every grant they hold
  (organization, team or product, and the role), outstanding invitations ("Waiting to join") with
  their expiry and a cancel control, invite by email or single-use link, and revoke a grant.
  Revoking takes effect at once; the person's writes and their attribution stay.
- **Agents** (`/connect`). [§6.8](06-operations-and-adapters.md): the endpoint, sign-in, the
  skill, connected agents, and the plain statement about where an agent sends your passages.
- **Product settings** (`…/settings`, in the product's shell): name, slug and product concept; **People**;
  export; the organization; and archive or restore. **People** lists everyone who can reach this
  product and how, in words: a product role, or a role inherited from the team or the
  organization (`members.list` with `product`). Product admins get a role picker (admin, editor,
  viewer) for product roles, **Add people** (pick someone already in the organization, or invite by
  email; `members.grant` with the product scope), Remove (revokes the product role only), and
  outstanding invitations with a cancel control. An inherited role links to the organization's
  Members, where it is changed. Access is per product; nothing is granted per page or per source.
- **Account and tokens** (`/account`). Display name, email (read-only), personal access tokens
  with last use and revoke, and connected agents with revoke.
- **Planned:** organization settings with usage against every limit shown as fractions
  ([§9.2](09-data-lifecycle.md)), the data statement, organization export, and a danger zone
  holding only owner-gated actions (transfer ownership, close the organization), each behind a
  typed confirmation; active sessions and delete account on the Account screen.
