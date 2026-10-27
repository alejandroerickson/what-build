# Mockups

Mockup canvases: their pages and the rules a page meets, prototypes, shared files, versions, uploads and downloads, limits, and promoting a page to the Story.

## What a mockup is

A mockup is a canvas of HTML pages (screens, flows or alternatives side by side), each page with
design notes, under a Markdown **brief** that says what the canvas explores. People pan and zoom
around it in Exploration, read a page's notes beside it, and click through a page in its sandbox. The
web app shows, downloads and promotes mockups, and lets a product's admins archive or delete one; it
cannot publish or restore a mockup, which agents do.

`mockups_read` lists them (`list`, which leaves archived ones out and counts them in
`archived_hidden`), reads one (`get`), and reads its versions (`list_versions`, `get_version`).

## Pages

A page is one self-contained HTML document, or an entry into the version's prototype (below), shown
in a sandbox with no network at the size it gives: a `width` (1280 for a desktop screen, 390 for a
phone) and a `height` (at most 4000). A page taller than its `height` scrolls inside its frame: on the
canvas people see its first `height` pixels until they switch to interact mode. A long document can
be one page that scrolls or several pages side by side (`columns`).

A page's rules are looser than a Story page's, so a working prototype fits:

- Allowed: inline CSS; inline scripts and event handlers of any number and length; forms and their
  controls (their `submit` handlers run, but submissions go nowhere, so a handler calls
  `preventDefault()`, and a form has no `target`); images, fonts and media as `data:` URIs.
- Refused: anything loaded from elsewhere (a `src` or CSS `url()` that is not `data:`, `@import`,
  `<script src>`, `<link>`), frames and embeds (`<iframe>`, `<embed>`, `<object>` and the like),
  `<base>` and `<meta http-equiv>`. A page holds at most 1,000,000 characters.

A refusal lists every problem, each with the page, the rule and the element. A refused publish
changes nothing and leaves an upload unused, so publishing also checks a canvas. A page is never
assembled from shared parts: each page carries what it needs inline. A mockup carries its own look
and does not follow the Story style.

**Notes** belong to a page: Markdown design notes, shown beside it.

## Prototypes

A clickable prototype of several files (HTML documents that link to one another, scripts,
stylesheets, fonts, images, media, fixtures such as JSON or PDFs, iframes of its own documents) goes
in as it is, under `prototype/` in the canvas ZIP. A canvas page then gives an `entry` in
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
- **`prototype_warnings`** in publish's result names each file and what will not work there (a
  root-relative or remote address, an address the prototype does not hold, a script that uses
  storage or cookies). A warning never refuses.
- `poster` (an image in the prototype, at most 2 MB) is what the Story's print view shows for an
  entry page.
- Limits: 2,000 files and 64 MB a prototype, 25 MB a file, 500 MB of distinct prototype bytes in a
  product. A version published without an upload keeps its base's prototype.

## Files

A version carries text `files` for collaborators, such as a DESIGN.md, components and tokens. People
see them in the inspector, and they come with the download under `files/`. Like `pages`, `files` is
the whole set when sent: a path kept without `content` keeps its text, and a path left out is dropped.
At most 50 files and 2,000,000 characters a version.

## Versions

A version is the whole canvas, and every version stays readable.
`mockups_write(action="publish")` without `mockup_id` creates the mockup. A later version takes the
mockup's etag (from `get`) and only what changes: `pages` is the whole canvas in order; a page that
keeps its `page_id` keeps its title, notes, size and HTML unless they are sent, and a page left out is
dropped from that version. `from_version: N` starts from an earlier version. Each publish makes a
version.

## Download and upload

`mockups_read(action="get_download")` gives a version as a ZIP through a short-lived grant (its header
is a credential): `brief.md`, `manifest.json`, each page as `pages/<page_id>.html` with
`pages/<page_id>.notes.md`, the version's files under `files/`, and its prototype under `prototype/`,
every file byte for byte with its `sha256` in the manifest.

To publish from files, zip the canvas in the same layout, call `mockups_write(action="request_upload")`,
PUT the ZIP to its `url` with its `headers`, then `publish` with `upload_id` (and `mockup_id` and the
etag for a later version). An upload publishes once (`409 upload_used`).

- `manifest.json` lists every page in order, an object each: `page_id`, and `title`, `width`,
  `height` for a new page or a change, `entry` and `poster` for one that enters the prototype. A page
  whose HTML or notes the ZIP leaves out keeps them, so a later version's ZIP need hold only the pages
  that changed.
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

A version holds at most 48 pages and 8,000,000 characters of HTML. A product holds at most 50 mockups,
archived ones included; `list` gives `quota` with `used` and `limit`.

## Promoting a page to the Story

`story_write(action="promote_mockup", params={mockup_id, mockup_page_id})` makes a Story page that shows
that page as it is in the mockup's current version (or `version: N`), under the `page_id` given, or
named after the mockup page. Nothing is copied, and the Story page stays on that version: promoting
again with the Story page's `page_id` and its etag shows a newer version as the page's next version.
`mockups_read(action="get")` lists the Story pages that show its pages (`story_pages`).

A promoted page joins the end of the Story's **Published mockups**, a section after the page tree where
readers flip through them in order; it never goes in the tree. A promoted entry shows its prototype,
and a reader can move through that version's whole prototype from it, but sees nothing else of the
mockup. `set_hierarchy`'s `mockups`, every promoted page's id in order, reorders the section. People
can promote a page from the mockup in the web app too.
