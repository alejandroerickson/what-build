# The Story

Story pages and their versions, the Story style, publishing and previewing, the hierarchy, page notes, printing, and what people do in the app.

## What the Story is

The Story is the team's own communication with the people it works with (stakeholders, the team, the
person an agent works for): versioned, self-contained HTML pages arranged in a hierarchy. It is the
place WhatBuild presents things to people; there is no separate to-do list. Pages are shown in a
sandbox with no network. The app's components and theme are not available there, and a Story never
uses WhatBuild's own look.

A **reader** (the role that reads only the Story) opens links to Story pages and to places outside
WhatBuild; a link into the rest of the product takes them back to the Story (`links_note` in the
guidance).

`story_read(action="guidance")` is the reference for writing and designing pages: the house styles
with what each suits (`house_style` returns one in full, with a starter page), the shared vocabulary
of components (timelines, flows, diagrams, mockup snippets with pins, quotations, tallies), link
templates, compositions, design passes, writing rules, limits and a checklist. `section` narrows it
(`all`, `style`, `design`, `components`, `writing`, `checklist`).

## The Story style

`story_read(action="get_style")` returns the product's Story style: the design system every page
follows, with its rules and stylesheet, or `style: null` when none is set. `story_write(action="set_style")`
sets it: `{ house_style }` adopts a house style, or `name`, `rules` and `stylesheet` save the team's
own design system. People preview every house style in the web app, light and dark, desktop and phone.

- A `note` on the style says its house style has left the catalogue, and how to move to a current one.
- `carried_typefaces` names typefaces WhatBuild embeds when a page is shown: a style may name one, and
  no font file is sent for it.
- `specimen_html` is optional: without it the app previews the style on its own sample page, which
  uses the guidance's shared vocabulary. A specimen is a whole page in the style that shows each of a
  team style's own components once.

## Publishing

`story_write(action="publish")` publishes a new version of a page, creating the page on its first
version.

- **`body`** takes only the markup inside `<body>` (usually one `<main class="page">`) and wraps it in
  a document with the product's Story style, so every page carries the same stylesheet and none is
  sent. **`html`** is a whole document of one's own. After a style change, `restyle: true` gives a
  page the new stylesheet and keeps its content.
- A revision takes the page's etag from `story_read(action="get_page")`; only a new page omits it.
  `include_html: false` reads a page and its notes without its HTML.
- On a later version, the title, summary and page left out carry forward (`carried_forward` names
  them). `patch_html` fixes text by exact find and replace; `from_version: N` restores an earlier
  version as a new one. `html_sha256` on every version shows identical HTML without reading it.
- `summary` describes the page and shows in navigation.
- A page that shows a mockup page (`current.mockup` in `get_page`) has no HTML of its own: `patch_html`
  and `restyle` are refused there, and `html` or `body` replace the mockup page with a page of its own.
- In the app, a link to another page of the same Story (`links.story_page` in the guidance) shows that
  page in place; every other link opens in a new tab.

## Previewing

`story_read(action="preview")` takes the same params as `publish` and needs the same role. It refuses
what `publish` would refuse, with the same error, and publishes nothing. Otherwise it returns
`html_sha256` and a short-lived grant: GET its `url` with its `headers` (in a browser tool, a headless
browser, or a screenshot tool) to see the exact document `publish` would store, in the Story style and
the page sandbox. `?theme=light` and `?theme=dark` choose the theme; desktop and phone widths are
1280 and 390. The grant header is a credential.

## The hierarchy

Publishing never places a page. `story_read(action="get_hierarchy")` lists the tree as `items`, with
new pages in `unplaced`; `story_write(action="set_hierarchy")` takes the whole tree back with the
hierarchy's own etag, and nodes may keep the title and description `get_hierarchy` gave them. Pages
left out of the tree still appear, at its end. `set_hierarchy`'s `mockups` orders the Published
mockups (see `guide(topic="mockups")`).

## What people do in the app

The web app shows pages, their versions and their notes, and exports them to PDF. People drag pages
into place in the tree, reorder the Published mockups, archive, restore and delete pages, and promote
a mockup page. They cannot write, rename or publish a page, or edit its notes. A person may have moved
pages since the hierarchy was last read: its etag then refuses a stale `set_hierarchy`.

`story_read(action="list_pages")` leaves archived pages out and counts them in `archived_hidden`;
`include_archived` lists them, and `story_write(action="restore_page")` brings one back.

## Notes for agents

Each page has notes for agents (`get_page` returns them as `agent_notes`): Markdown that readers do
not see. `story_write(action="write_notes")` writes them with the notes etag, not the page etag:
`agent_notes_etag` from `publish`, or `agent_notes.etag` from `get_page`. While the notes are empty the
etag may be left out. The activity log already records what changed.

## Printing

`story_read(action="print_view")` plans a print view of chosen pages and returns a `url` that opens in
a browser to save as PDF. Content a page draws with JavaScript is left out there.
