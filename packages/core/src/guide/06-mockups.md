# Mockups

Mockup canvases: their pages and the rules a page meets, prototypes, shared files, versions, the folders they are arranged in, uploads and downloads, limits, and promoting a page or a whole canvas to the Story.

## What a mockup is

A mockup is a canvas of HTML pages (screens, flows or alternatives side by side), each page with
design notes, under a Markdown **brief** that says what the canvas explores. People pan and zoom
around it in Exploration, read a page's notes beside it, and click through a page in its sandbox. The
web app shows, downloads and promotes mockups; lets anyone who can write arrange them in folders,
rename them, and archive and restore them; and lets a product's admins delete one. It cannot publish
a mockup or change its pages, which agents do.

`mockups_read` lists them in the order the team arranged them, with their folders (`list`, which
leaves archived ones out and counts them in `archived_hidden`), reads one (`get`), and reads its
versions (`list_versions`, `get_version`).

## Pages

A page is one self-contained HTML document, or an entry into the version's prototype (below), shown
in a sandbox with no network at the size it gives: a `width` (1280 for a desktop screen, 390 for a
phone) and a `height` (at most 4000). A page taller than its `height` scrolls inside its frame: on the
canvas people see its first `height` pixels until they switch to interact mode. A long document can
be one page that scrolls or several pages side by side (`columns`).

`height: "auto"` makes the frame as tall as the page's content, up to 4000: wherever the page is
shown, its frame opens 240 tall and grows to the document's height, which WhatBuild measures in the
frame, so nothing is measured before publishing; the print view lays the page out at its content's
height. It suits a page as tall as what it holds (a document, a list, a form). A page laid out
against the window (an app shell, a section `100vh` tall) needs a height of its own: auto would leave
it at 240, or at the height it had when it began to grow with its frame. `get` and a download give
`"height": "auto"`, and an upload's `manifest.json` takes it.

A page's rules are looser than a Story page's, so a working prototype fits:

- Allowed: inline CSS; inline scripts and event handlers of any number and length; forms and their
  controls (their `submit` handlers run, but submissions go nowhere, so a handler calls
  `preventDefault()`, and a form has no `target`); images, fonts and media as `data:` URIs.
- A typeface WhatBuild carries needs no font file: name its family in quotes in `font-family`
  (`font-family: "Inter", system-ui, sans-serif`) and WhatBuild embeds the face when it shows or
  prints the page. It carries Inter and the Story's faces (`carried_typefaces` in
  `story_read(action="guidance")`); `publish`'s description lists them. The stored page, and what
  `get` and a download give back, stay without the face, so a page opened on its own outside
  WhatBuild renders in its fallbacks.
- Refused: anything loaded from elsewhere (a `src` or CSS `url()` that is not `data:`, `@import`,
  `<script src>`, `<link>`), frames and embeds (`<iframe>`, `<embed>`, `<object>` and the like),
  `<base>` and `<meta http-equiv>`. A page holds at most 1,000,000 characters.

A refusal lists every problem, each with the page, the rule and the element. A refused publish
changes nothing and leaves an upload unused, so publishing also checks a canvas. A page is never
assembled from shared parts: each page carries what it needs inline. A mockup carries its own look
and does not follow the Story style.

**Notes** belong to a page: Markdown design notes, shown beside it.

## Clickable prototypes

Pages link to each other with ordinary relative links: `<a href="checkout.html">`, where `checkout` is
the other page's `page_id`, as files side by side in a folder do. They work the same in the ZIP once it
is unzipped. On the canvas a link flies the view to the page it names. People can then view the canvas
as a clickable prototype: one page at a time in the web app, a link changing the page in place, starting
at the first page.

- `clickable` in `publish` and `get` says whether a version can be viewed that way (`viewable`), counts
  `links_between_pages`, lists `broken` links that name no page, and from `publish` gives the `url` to
  hand the person. A version with no links says `how`.
- Use real links, for a person to click: only an `<a href>` counts (not an image map's
  `<area href>`, nor an `<a download>`, which are not followed). A script that goes to an address
  (`location.href = ...`, in a `<script>` or an `onclick`) is no link, is not followed on its own,
  and moves nothing unless a person did something moments ago.
- A `#fragment` moves within the page a link opens. A `?query` does not reach it, and browser storage is
  unavailable, as everywhere in the sandbox.
- On the Story, a whole canvas keeps its links flying between its pages. A page promoted alone takes a
  link to another page of its canvas to the Story page that shows that page, or to a whole canvas that
  holds it; `links_off_story` in `promote_mockup`'s answer names the pages it links to that no Story
  page shows, which a reader's click would not reach. Promote them too, or the whole canvas.
- A comparison of alternatives needs no links.

## Prototypes

A clickable prototype of several files (HTML documents that link to one another, scripts,
stylesheets, fonts, images, audio, fixtures such as JSON or PDFs, iframes of its own documents) goes
in as it is, under `prototype/` in the canvas ZIP. It holds no video, which WhatBuild does not keep: a
ZIP with one is refused with `415 video_not_accepted`, listing every video and every other problem,
and the prototype links to where the video lives instead. A canvas page then gives an `entry` in
`manifest.json` instead of HTML: the path of one of its HTML documents, with a `?query` and
`#fragment` if the page starts somewhere particular (`app/checkout.html?plan=pro#step-2`). Several
pages may enter one prototype. Its files are kept byte for byte, are not held to a page's rules, and
load only one another.

- **Relative addresses only.** `./app.js`, `css/site.css` and `../img/logo.png` resolve inside it. A
  root-relative address (`/assets/app.js`) points outside the prototype and does not load (with Vite,
  `base: './'` builds relative addresses). `fetch()` resolves against the document.
- **No network.** Nothing loads from another site; a link elsewhere opens a new tab.
- **No storage.** `localStorage`, `sessionStorage`, IndexedDB and `document.cookie` are unavailable,
  and touching one throws. Each document load starts fresh; state survives across documents only in
  the address (its query or hash).
- **Forms** run their `submit` handlers and submit nowhere. A link between its documents moves within
  the page's frame; a PDF it links to does not open in the frame (browsers refuse a PDF in a sandbox),
  though its scripts can fetch the bytes.
- **What a page loads** is held to limits, below: every page loads its document and all it loads
  afresh, so a prototype entered by many pages costs its whole weight for each.
- **`prototype_warnings`** in publish's result names each file and what will not work there (a
  root-relative or remote address, an address the prototype does not hold, a script that uses
  storage or cookies). A warning never refuses.
- `poster` (an image in the prototype, at most 2 MB) is what the Story's print view shows for an
  entry page.
- Limits: 2,000 files and 64 MB a prototype, 25 MB a file, 500 MB of distinct prototype bytes in a
  product. A version published without an upload keeps its base's prototype.

## What a page loads

Every page of a canvas loads when the canvas opens, a few at a time outward from the page people are
on, and stays loaded, so moving between loaded pages shows the next one at once. A page that enters a
prototype loads its document and every file that document loads, and loads them again for each page
that enters it: browsers cache nothing a sandboxed frame loads, so pages share nothing. A page with
HTML of its own is one document.

- **What publish counts.** For each page that enters the prototype: the files its document names to
  load (a `<script src>`, a stylesheet or other `<link href>`, an `<img>`, a `srcset`, a `poster`, an
  SVG `href`) and the files its stylesheets name (`url()`, `@import`), each once, with their bytes and
  the document's own. A page with HTML of its own counts the bytes of its HTML. A file a script loads
  (`fetch`, `import()`, a script element it adds) is not counted, and still loads every time.
- **What publish refuses** (`422 invalid_input`): a page whose document loads more than 20 files, or
  more than 1 MB with itself, and a canvas whose pages load more than 12 MB together. The refusal
  names each document once, with the pages that enter it, the files and bytes it loads, and the
  canvas's total, so a publish is also a way to measure. A refused publish changes nothing, and the
  current version stays as it is.
- **What people see.** Within the limits a canvas opens in a few seconds on an ordinary connection,
  and a move between pages, by the arrows, the page menu or a link, shows the next page at once. A
  page still loading shows the progress mark and "Loading" in its place. What happens inside a page
  (a dialog, a menu, a tab, a field typed in) stays in that page, and in the clickable view a page
  someone used starts again from the beginning when they come back to it.

### Bringing a heavy prototype in

A prototype built as one app, with every canvas page entering it through a `?query` or `#fragment`
that opens one of its screens or states, loads the whole app for each page, and a canvas of many
such pages is past the limits. These ways bring it within them, each changing something different for
the people who view the canvas; they combine.

- **Bundle and trim.** Build each document to load one script and one stylesheet, minified, with the
  styles it does not use removed and small icons inlined, and load large data (fixtures, icon sets,
  sample records) only in the screens that show it. People see the same prototype, sooner. This is
  often enough for a document a little past the limits.
- **A document for each screen.** Build each screen as its own HTML document that loads only that
  screen's code, styles and data (a bundler's multi-page build, with what the screens share in a
  small common file, which counts for every page that loads it), and give each canvas page its
  screen's document. A link to another screen names that screen's document, so a click moves the
  canvas to its page. People see the same screens and move between them as pages of the canvas; what
  one screen changes reaches the next only if the address carries it.
- **A page of its own for each screen.** Save each screen as a page with HTML of its own, held to the
  rules under Pages: its markup as it shows, the styles it uses inline, its images as `data:` URIs,
  and only the small scripts its own controls need (a menu that opens, a dialog, a tab). Pages link
  to each other by `page_id`. Each is one document and shows at once. People see each screen as it
  looks, and its own controls work; what needed the app's logic (records that change across
  screens, a simulated assistant, a search) works only as far as the page's own script goes.
- **Fewer pages.** States of one screen that differ by a control (a menu open, a field filled) can be
  one page whose control works, instead of a page each. A canvas still past 12 MB can become several
  canvases, one for each part of the product. People see fewer pages in each canvas, and find the
  rest in the others.

## Files

A version carries text `files` for collaborators, such as a DESIGN.md, components and tokens. People
see them in the inspector, and they come with the download under `files/`. Like `pages`, `files` is
the whole set when sent: a path kept without `content` keeps its text, and a path left out is dropped.
At most 50 files and 2,000,000 characters a version.

## Versions

A version is the whole canvas. A mockup keeps its newest versions, as many as its organization's
plan says (10 unless it says otherwise; `list_versions` gives `versions_kept`), and every version a
Story page shows. Publishing past them deletes the oldest, and `versions_deleted` in the answer names
them. A deleted version's number is never used again, and reading it answers `410 version_deleted`
with the versions kept.
`mockups_write(action="publish")` without `mockup_id` creates the mockup: a title, a brief, and at
least one page, each with its `page_id` (a slug you choose, as `onboarding-a`), a title and HTML. A later version takes the
mockup's etag (from `get`) and only what changes: `pages` is the whole canvas in order; a page that
keeps its `page_id` keeps its title, notes, size and HTML unless they are sent, and a page left out is
dropped from that version. `from_version: N` starts from an earlier version. Each publish makes a
version.

## The title

The title is the mockup's name: the list, the canvas, search and a download use it. Each version
keeps the title it was published with (`current.title`, `list_versions`).
`mockups_write(action="rename")` changes the name with the mockup's etag and makes no version, and
people rename mockups in the web app too, so a title read earlier may have changed. A later version
keeps the mockup's title as it is now unless `publish` sends one, whichever version it starts from.
An archived mockup refuses a rename until it is restored.

## Folders and order

A product's mockups are arranged by hand, and everyone in the product sees the one arrangement. A
mockup sits in one folder or in none; folders are one level deep and hold no folders. People see the
mockups in no folder first, then each folder with its own, and `mockups_read(action="list")` gives
`items` in that order (each with its `folder_id`, null for none) and `folders` in theirs. Nothing
reorders them by itself: a new version leaves a mockup where it is.

- `mockups_write(action="create_folder")` makes a folder, after the others; `rename_folder` renames
  one, with the folder's etag; `move_folder` puts one in front of another folder, or last;
  `remove_folder` removes one and leaves its mockups in no folder, after those already there. No
  mockup is deleted with a folder.
- `mockups_write(action="move")` puts a mockup in a folder (`folder_id`, null for none; omitted, it
  stays in the folder it is in) in front of another mockup there (`before_mockup_id`), or last.
- A new mockup goes first among the mockups in no folder, or first in the folder
  `mockups_write(action="publish")` names in `folder_id`.

Arranging changes no mockup: it makes no version, and the mockup's etag and its address in the web
app stay as they were. People arrange the mockups in the web app too, by dragging, so an order read
earlier may have changed.

## Download and upload

`mockups_read(action="get_download")` gives a version as a ZIP through a short-lived grant (its header
is a credential): `index.html`, which a person opens to start at the first page, `brief.md`, `manifest.json`, each page as `pages/<page_id>.html` with
`pages/<page_id>.notes.md`, the version's files under `files/`, and its prototype under `prototype/`,
every file byte for byte with its `sha256` in the manifest.

To publish from files, zip the canvas in the same layout, call `mockups_write(action="request_upload")`,
PUT the ZIP to its `url` with its `headers`, then `publish` with `upload_id` (and `mockup_id` and the
etag for a later version). An upload publishes once (`409 upload_used`).

- `manifest.json` lists every page in order, an object each: `page_id`, and `title`, `width`,
  `height` for a new page or a change, `entry` and `poster` for one that enters the prototype. A page
  whose HTML or notes the ZIP leaves out keeps them, so a later version's ZIP need hold only the pages
  that changed.
- At its top level, beside `pages`, `manifest.json` may give the canvas's `title`, `summary` and
  `columns`, as `get_download` writes them; other keys, such as `format`, are not read. What the call
  gives wins over the manifest, and the brief comes from `brief.md` or the call, never both. A new
  mockup published from an upload alone needs a `title`, a `brief.md`, and at least one page with a
  `page_id`, a title and its HTML:

  ```json
  {
    "title": "Week planner",
    "summary": "Two ways to plan a crew's week.",
    "pages": [{ "page_id": "board", "title": "The board", "width": 1280, "height": 800 }]
  }
  ```

  with `brief.md` and `pages/board.html` beside it.
- The files it lists (`files: [{path}]`), or else the ones under `files/`, are the whole set. So is the
  prototype: the files `manifest.json` lists under `prototype` (`[{path, sha256?}]`; a listed path
  missing from `prototype/` keeps the base's bytes), or else the files under `prototype/`. With
  neither, the base's prototype carries forward; `"prototype": []` drops it. Bytes the base already
  holds are not stored again.
- A page's HTML may also be sent inline in `pages`. Uploading a canvas as a ZIP may be off on the free
  plan (`403 plan_restricted`).

Publish's result gives `mockup_id`, `current_version`, `etag`, `page_ids`, `url` (the canvas in the
web app) and, for an upload, the ZIP's `size` and `sha256`, not the canvas itself. `mockups_read(action="get")`
gives each page's `html_sha256` and each file's `sha256`: they hash the text as UTF-8, so they match
`shasum -a 256` of a UTF-8 file (one saved with a byte-order mark loses it). `html_chars` and a file's
`chars` count characters as a JavaScript string does, not bytes, and so do the limits.

## Limits

A version holds at most 48 pages and 8,000,000 characters of HTML. A product holds as many mockups,
archived ones included, as its organization's plan allows: 50 unless the plan says otherwise, and no
limit where `limit` is null. `list` gives `quota` with `used` and `limit`; publishing a new mockup at the
limit is refused with `409 quota_exceeded`, and a new version of one counts nothing. Folders are not
limited; each has a name of its own in its product, whatever its capitals.

## Promoting a page or a whole canvas to the Story

`story_write(action="promote_mockup", params={mockup_id, mockup_page_id})` makes a Story page that shows
that page as it is in the mockup's current version (or `version: N`), under the `page_id` given, or
named after the mockup page. Leave `mockup_page_id` out and the Story page shows the whole canvas, on
one Story page however many pages it has, named after the mockup. Nothing is copied, and the Story page
stays on that version: promoting again with the Story page's `page_id` and its etag shows a newer
version as the page's next version. `mockups_read(action="get")` lists the Story pages that show it
(`story_pages`, where `mockup_page_id` is null for a whole canvas).

A promoted page is a Story page like any other: unplaced at the end of the tree until `set_hierarchy`
places it, and free to sit under another page or hold others. Its `kind` in the hierarchy says what it
shows: `mockup_page` or `canvas`. On a mockup page readers flip through the Story's mockup pages, in
the tree's order, with the arrow keys. On a whole canvas they pan and zoom the board and the arrows
move between its pages; `get_page` gives its layout and pages under `current.mockup`. A promoted entry
shows its prototype, and a Story reader can move through that version's whole prototype from it. A
Story reader sees nothing else of the mockup: never its brief, notes, files or other versions. People can promote a
page or the whole canvas from the mockup in the web app too.
