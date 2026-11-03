---
title: A canvas's pages link to each other, fly on the board, view as a clickable prototype and download, inside the sandbox
organizations: [synthetic, standard, example]
people: [casey, avery, sam, jordan, guest]
surfaces: [web, mcp]
---

# Clickable prototypes from a canvas

A canvas's pages link to each other with ordinary relative links. On the board a link flies the view
to the page it names; viewed as a clickable prototype, one page shows at a time and a link changes it
in place. A canvas downloads whole, and a page on its own. All of it runs in the sandbox pages have
always run in, so the plan also tries what a hostile page would.

In the synthetic organization, Crewboard's mockup "Planning the week: jobs first or days first" has no
links in version 1, and links its pages in version 2. Pages this plan publishes elsewhere are synthetic,
and files go in the run's folder. `pnpm e2e browser frame-click <page's title> <text>` clicks inside a
page with the real mouse, and `frame-eval` reads it. The driver has no hover, Forward, new tabs or captured
downloads: use a short script with `playwright-core` in the run's folder for those. **In Chrome, `eval`,
`frame-eval`, `frame-click`'s lookup and Playwright's `evaluate`, `waitFor`, `boundingBox`, `getAttribute` and
`exposeBinding` all count as a person's gesture**, so none may touch the page during step 15: find coordinates in a
throwaway browser, sample `page.url()` from outside, and read `history.length` once the flood is over. Back in these
numbers is `page.goBack`, which walks every entry; the browser's own button may skip some.

## Steps

### The screen

1. **Web, as Casey, in the synthetic organization.** Open that mockup in Exploration, with the panels
   showing. *Expect:* the inspector's **View** offers Canvas and Clickable prototype, Canvas chosen, and
   **Download as ZIP**. It has no page picker, Fit or Fill. The toolbar has no view or download control,
   and has a menu of the pages. Nothing draws a line between pages or counts links, and the mockup's row
   in the panel carries no extra icon.
2. **Web, as Casey.** Select a page, then hover another's label. *Expect:* each label has a fit button and
   a download button; the inspector shows the selected page's title, notes and way to the Story, with no
   controls for moving between pages. Choose a page from the toolbar's menu. *Expect:* the view goes to it.

### Links on the canvas

3. **Web, as Casey.** In interact mode, click **Plan by day** on Jobs board. *Expect:* the view flies to Day
   planner and selects it. Jobs board still shows Jobs board, and no new tab opens. Use the browser's Back.
   *Expect:* the view returns to Jobs board, with it selected.
4. **Web, as Casey.** In pan mode, click where **Plan by day** is. *Expect:* it selects the page and follows
   no link.
5. **Web, as Casey.** Choose version 1. *Expect:* **Clickable prototype** is disabled, with a line saying the
   pages don't link and **Copy a request for your agent**, which copies a sentence naming the mockup. Show
   the current version again.

### The clickable view

6. **Web, as Casey.** With Jobs board selected, choose **Clickable prototype**. *Expect:* the others fade as
   the view settles on one page, with the board's dots, labels and outline gone. The address says
   `view=clickable`. The fade needs sampling frame by frame, since a screenshot cannot show it. The rails stay, and the toolbar keeps fit, fill, the arrows, the page menu and the keys,
   with no pan, interact or zoom. No page label means no page download here.
7. **Web, as Casey.** Click through to Crew message and back. *Expect:* each click changes the page in place,
   at no more than its own size, and Crew message shows at phone width. A page you return to opens afresh.
   Use Back and Forward, the arrows and the page menu. *Expect:* each moves between pages and the address
   follows. Reload. *Expect:* the same page, in the same view.
8. **Web, as Casey.** Press **F**, then **Show panels**. *Expect:* the page takes the window with the toolbar
   still there; the panels return with the same page showing. Choose **Canvas**. *Expect:* the pages come back
   around the page you were on, selected.

### Downloads

9. **Web, as Casey.** Choose **Download as ZIP**, in the canvas and again in the clickable view. *Expect:* one
   ZIP each time, and a message that pages can run their own code outside WhatBuild. Unzip one into the run's
   folder and open its `index.html` from disk. *Expect:* it names the mockup and version, starts at the first
   page, lists every page and carries the same warning; the pages' links work from disk with no server.
10. **Web, as Casey.** Download a page from its label. *Expect:* `<page_id>.html`, the page's HTML, the same
    warning, and the page opening by itself from disk.

### What an agent is told

11. **MCP, as Sam, in the standard organization.** Knowing only the tool list and the guide, find out how to
    make a canvas clickable, and how its links behave on the Story. *Expect:* `mockups_write`'s description and the guide's mockups topic say it.
    Publish a canvas with two pages and no links. *Expect:* `clickable` says it is not `viewable`, and `how`.
12. **MCP, as Sam.** Publish its next version with three pages: `<a href="two.html">` and
    `<a href="./three.htm#end">` on the first, and on another a link back, `<a href="gone.html">`,
    `<a href="#local">`, a link to `https://example.com/`, a link whose `onclick` calls `preventDefault()`, and
    a button that a script handles. *Expect:* `clickable` is `viewable`, counts the links between pages, names
    `gone.html` under `broken` and gives a `url`. `mockups_read` says the same; a version before stays as it was.
13. **Web, as Sam.** Open that `url`. Click the link to `gone.html`. *Expect:* a message says the page isn't on
    this canvas, and the page stays. Click the link to `three.htm#end`. *Expect:* that page, scrolled to the place. Click `#local`,
    the link to another site with and without Cmd held, and the link its own script handles. *Expect:* the
    first moves within the page, the next two open a tab, leaving this one where it was, and the last goes nowhere.
    Hold Cmd on a link between pages, and on the one to `gone.html`. *Expect:* each does what a plain click does,
    with no new tab and no raw error.

### The sandbox

14. **MCP and web, as Sam.** Publish a page whose script, on load, tries `fetch` to another site,
    `document.cookie`, `localStorage`, `parent.document` and `top.location = "https://example.com/"`, writing
    each result on the page. *Expect:* on the board and in the clickable view each fails, and WhatBuild stays
    where it is. The page has no session, no storage and no way into the app.
15. **MCP and web, as Sam.** Publish canvases whose two pages hold real links and whose scripts, every 50 ms, send
    the reader to the other page: one with `{ whatbuild: "canvas-page", page: "other", hash: "" }`, one with
    `{ whatbuild: "story-key", key: "ArrowRight" }` and `ArrowLeft`, and one naming a page that does not exist, with
    a long sentence of its own in `href`. Promote one page of each to the Story, and publish two Story pages that do
    the same with `{ whatbuild: "story-page", page: "other" }`. Try each on the board, in the clickable view, on the
    Story's canvas and on the Story page, each in a fresh browser: by address with no click, then with one real click.
    *Expect:* with no click nothing moves at all; after a click it can only move among this version's pages for a few
    seconds, no faster than four times a second, the other name goes nowhere, the page's own words never appear in WhatBuild's messages, and about five presses of Back at most
    leave it. A real click on a link adds one step.
16. **Web, as Sam.** On a page whose script sets `location.href = "second.html"` after a click, and one that
    sets it to another site; then on pages that do each from a script in their `<head>`, while they still load,
    and one with a `<meta http-equiv="refresh">` to another site. *Expect:* WhatBuild puts each page back within
    a couple of seconds and says so, and a page that keeps doing it waits, then stops with Try again. The browser
    refuses another site in the frame before that (a console line naming `frame-src`). Nothing is left blank or
    showing a raw error, and the app's own address never changes to theirs.

### Prototypes, uploads and round trips

17. **MCP, as Sam, in the standard organization, if its plan takes a canvas as a ZIP.** Download the canvas from
    step 12 (`get_download`), and upload that ZIP as it is. *Expect:* it publishes, `index.html` and all. If the
    plan refuses it, `403 plan_restricted` is the answer, and steps 18 and 19 are not checked: say so.
18. **MCP, as Sam.** Upload a canvas with a prototype of three documents, where two canvas pages enter
    the first two and the third has no page of its own. *Expect:* `clickable` is `viewable`, even with no links
    between its own pages. **Web:** on the board, a link to the document the other page enters flies there; a
    link to the third stays in its frame. In the clickable view, the first changes the page and the second
    moves within it. An entry page has no download button on its label.
19. **Web, as Sam.** Download that ZIP and open its `index.html` from disk. *Expect:* it links into `prototype/`,
    and a plain document opens.

### Who may

20. **Web, as Avery, in the synthetic organization.** Open the Story page that shows Jobs board alone, and click
    **Plan by day**. *Expect:* the Story page showing Day planner opens, or the whole canvas at Day planner, with
    Back returning; where no Story page shows it, a message says the page isn't in the Story. No tab opens.
    Open the Story's whole-canvas page. *Expect:* a link flies
    there too, and Back returns. There is no View control and no page download, and nothing of the mockup but its
    pages. **Show panels** is on the screen. Try the mockup's own address and that page's `?download=1` at the
    mockup's address. *Expect:* both are refused.
21. **Web, as Jordan, in the standard organization, and MCP.** With Sam first promoting the canvas from step 12
    to the Story: the same as Avery, and `mockups_read` is refused. Sam also promotes that canvas's first page
    alone, then publishes a Story page linking to it and to a Story page that doesn't exist. *Expect:* the
    promote answer names in `links_off_story` the pages the first page links to that no Story page shows, and
    publish names the missing page in `links_to_no_page`; as Jordan, each link does what step 20 says.
22. **Web, as a guest of the example organization.** Open a mockup. *Expect:* Copy a request for your agent is
    not offered, and whatever Download as ZIP does for a guest, a page's download does too. Then go past a guest's
    calls a minute and their 10 MB of downloads a day, with a throwaway guest. *Expect:* both buttons say the same
    thing, and it names the limit.
23. **Web, as Sam.** Compare the example and standard organizations on the same mockup. *Expect:* they behave
    alike, but for what the example's being read-only explains.

### Everywhere

24. **Web, as Casey.** Do steps 3 and 7 at phone width, and steps 1 and 6 in the dark theme, and reach View, then
    Download as ZIP, by keyboard alone. *Expect:* the toolbar stays on the screen and usable, View is in the
    details panel, focus is always visible, and buttons are named for the screen reader by what they do.

## Look out for

- More than one way to do the same thing, or a control back in the toolbar that belongs in the inspector.
- Anything that shows a count of links, or a line between pages.
- A link that replaces the page on the board instead of flying, or that leaves WhatBuild in the same tab.
- A second copy of a page's frame, a page reloading on the board when nothing asked it to, or a page's calls
  a minute running out from clicking around (a page opened afresh costs a call).
- Web and MCP disagreeing about whether a version is clickable.
- A broken link that says nothing, or a message of WhatBuild's holding anything a page wrote.
