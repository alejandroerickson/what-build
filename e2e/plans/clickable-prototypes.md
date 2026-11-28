---
title: A canvas's pages link to each other, fly on the board, view as a clickable prototype and download, inside the sandbox
organizations: [synthetic, standard, example]
people: [casey, avery, sam, jordan, riley, guest]
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
`frame-eval`, `frame-click`'s lookup, the driver's `screenshot`, and Playwright's `evaluate`, `waitFor`,
`boundingBox`, `getAttribute`, `exposeBinding`, `screenshot` (with any options) and `addInitScript` all count as a
person's gesture**, and a page flooding with requests moves for a few seconds after any of them, so none may touch
the page during step 15: find coordinates in a throwaway browser, sample `page.url()` from outside, see the page
through Chrome's own screencast or `Page.captureScreenshot` over a CDP session, and read the history through
`Page.getNavigationHistory`, or `history.length` once the flood is over. Back in these numbers is `page.goBack`,
which walks every entry; the browser's own button may skip some. A new person's welcome tutorial needs a click to
close, and that click is a gesture too: before a trial with no click, turn that person's tutorials off first, in
another browser (Turn off tutorials on the welcome) or through Settings → Tutorials.

## Steps

### The screen

1. **Web, as Casey, in the synthetic organization.** Open Exploration. Signing in starts the browser
   afresh, so the first of the mockups and Story pages to open is in focus mode, and pressing **Show
   panels** is remembered for both: here the canvas Exploration opens first (the tree's first, which
   may not be that mockup), both panels hidden with a hint that F brings them back, which goes after
   a few seconds, so look for it straight after arriving. Press **Show panels** (or F), then reload,
   and open a Story page. *Expect:* the panels shown after the reload and on the Story page, with no
   hint. Open that mockup. *Expect:* the inspector's **View** offers Canvas and
   Clickable prototype, Canvas chosen, and **Download as ZIP**. It has no page picker, Fit or Fill.
   The toolbar has no view or download control, and has a menu of the pages. Nothing draws a line
   between pages or counts links, and the mockup's row in the panel carries no extra icon.
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
   at no more than its own size, at once, and Crew message shows at phone width. A page you used (clicked or
   typed in) opens afresh when you return to it; one you only looked at is as you left it. No blank or white
   page shows between them (sample frame by frame, as for the fade).
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
13. **Web, as Sam.** Open the canvas at step 12's `url` (the board, not `clickable.url`). Click the link to `gone.html`. *Expect:* a message says the page isn't on
    this canvas, and the page stays. Click the link to `three.htm#end`. *Expect:* that page, scrolled to the place.
    Do the same in the clickable view once every page has loaded. *Expect:* that page, scrolled
    to the place. Then open the clickable view afresh at the first page with that third page's HTML held back (in a
    `playwright-core` script, a route that answers its request a few seconds late), and click the link before
    the page has loaded. *Expect:* the page shows its sheet saying it is loading, then opens scrolled to the place. Click in it, leave it by the arrows and come back by them. *Expect:* it opens at its top: a place
    a link named is not kept for later. Back on the canvas, click `#local`,
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
    `{ whatbuild: "story-key", key: "ArrowRight" }` and `ArrowLeft`, and one naming as its page a long sentence of its own,
    which no page is called, with the same sentence in an `href` field of the message. Promote each canvas
    whole to the Story, for the Story's canvas, and one page of each alone, and publish two Story pages that do
    the same with `{ whatbuild: "story-page", page: "other" }`. Try each on the board, in the clickable view, on the
    Story's canvas and on the Story page, each in a fresh browser: by address with no click, then with one real click.
    *Expect:* with no click nothing moves at all. After a click it moves for a few seconds only, no faster than four
    times a second: on the board, in the clickable view and on the Story's canvas only among this version's pages; on
    a Story page among the Story's pages, as its arrows move a reader there, so a page's `story-key` may leave the
    reader on the next Story page, which may show another mockup. The other name goes nowhere, the page's own words
    never appear in WhatBuild's messages, and about six presses of Back at most leave it (seven from a page promoted
    alone): a move is a step for Back at most once a second, so a flood of a few seconds adds about five, beside the
    entry the page opened at. Those steps can hold the address
    already on show, so the first presses may change nothing to see before one leaves the canvas. In two fresh
    browsers on the same page, click a link in one and plain text in the other, and once each flood is over read
    `history.length`. *Expect:* the same in both: during a flood a click on a link adds no step of its own (it is
    the first of those); steps 3, 7 and 13 show that a link adds one when nothing floods.
16. **Web, as Sam.** On a page whose script sets `location.href = "second.html"` after a click, and one that
    sets it to another site; then on two pages that do each from a script in their `<head>`, while they still
    load; and on a page that enters a prototype document holding a `<meta http-equiv="refresh">` to another site
    (publish refuses one in a page's own HTML, so it can only be in a prototype, uploaded as a ZIP as in step 18;
    if the organization's plan refuses a canvas as a ZIP, this one is not checked: say so).
    *Expect:* WhatBuild puts each page back within a couple of seconds and says so. A page of its own HTML that
    keeps doing it is put back three times in a minute, then waits for the next minute with a note in its place,
    and after three such waits in a row stops with Try again, about three and a half minutes from the first: watch
    that long. Meanwhile the note above the board counts the pages that keep reloading, and the count holds still
    while they take turns and as they stop one after the other: while one has stopped and the other is still put
    back it still says two, and says WhatBuild stopped bringing 1 of them back. A prototype's documents cost no calls, so the page with the meta refresh is put back at
    once each time for as long as it is open, and is never held or stopped. The browser refuses another site in
    the frame before that (a console line naming `frame-src`). Nothing is left blank or showing a raw error, and
    the app's own address never changes to theirs.

### Prototypes, uploads and round trips

17. **MCP, as Sam, in the standard organization, if its plan takes a canvas as a ZIP.** Download the canvas from
    step 12 (`get_download`), and upload that ZIP as it is. *Expect:* it publishes, `index.html` and all. If the
    plan refuses it, `403 plan_restricted` is the answer, and steps 18 and 19 are not checked: say so.
18. **MCP, as Sam.** Upload a canvas with a prototype of three documents, where two canvas pages enter
    the first two and the third has no page of its own. *Expect:* `clickable` is `viewable`, even with no links
    between its own pages. **Web:** on the board, a link to the document the other page enters flies there; a
    link to the third stays in its frame. In the clickable view, the first changes the page and the second
    moves within it. An entry page has no download button on its label. Upload too a canvas of 4 pages that
    each enter a document loading 25 files. *Expect:* `422 invalid_input` names that document once, with the 4
    pages, and points to the guide's ways of bringing a prototype within the limits; `guide(topic="mockups")`
    describes them under What a page loads. Then 40 pages that each enter a document of 10
    files and 200 KB. *Expect:* it publishes. **Web:** the selected page draws first and the others fill in,
    each a sheet saying Loading until it has, never white, until every page has drawn; press **2**, then the
    arrows, and each page shows drawn at once. In the clickable view the arrows show the next page at once,
    never white, and so does the page menu choosing the first page or one shown just before (sample frame by
    frame). A page shown just before tests that rule only when it is neither next to the page on show nor the
    first page: for example, the arrows to page 4, the page menu to page 1, then the menu back to page 4. The
    page menu choosing a page far from those may show it white for a frame or two, no more.
19. **Web, as Sam.** Download that ZIP and open its `index.html` from disk. *Expect:* it links into `prototype/`,
    and a plain document opens.

### Who may

20. **Web, as Avery, in the synthetic organization.** Open the Story page that shows Jobs board alone, and click
    **Plan by day**. *Expect:* the Story page showing Day planner opens, or the whole canvas at Day planner, with
    Back returning. No tab opens. (Every page of this canvas has a Story page, so the message for a page that
    isn't in the Story is checked in step 21.)
    Open the Story's whole-canvas page, choose **Interact** (it opens in Pan, where a click selects, as in
    step 4) and click **Plan by day**. *Expect:* the view flies there too, and Back returns. There is no View control and no page download, and nothing of the mockup but its
    pages. **Show panels** is on the screen. Press it. *Expect:* the Story's navigation and the **Focus** control
    appear. Try the mockup's own address and that page's `?download=1` at the
    mockup's address. *Expect:* both are refused.
21. **MCP, as Sam, and web, as Jordan, in the standard organization.** Sam first promotes the first page of
    the canvas from step 12 alone, before anything else of that canvas is on the Story. *Expect:* the promote
    answer names in `links_off_story` the pages it links to that no Story page shows (those `two.html` and
    `three.htm` name). Sam
    publishes a Story page linking to that Story page and to a Story page that doesn't exist. *Expect:* publish
    names the missing page in `links_to_no_page`. As Jordan, on the first page's Story page, click the link to
    `two.html`. *Expect:* a message says the page isn't in the Story, and the page stays. Sam then promotes the
    whole canvas. *Expect:* as Jordan, the same link opens the whole canvas at that page, with Back returning; on Sam's
    Story page the link to the first page's Story page opens it, and the missing one opens its address and
    shows the screen saying the page isn't in the Story.
    Then the same as Avery in step 20 (if Jordan's panels are shown already, press **Focus** first), and
    `mockups_read` is refused.
22. **MCP, as Riley, then web, as a guest of the example organization.** Riley first publishes in the
    example organization a canvas of two pages that don't link (each run starts from the golden master, so
    it goes with this run). As Riley, open it. *Expect:* Clickable
    prototype is disabled, with its line and **Copy a request for your agent**. As the guest, open it.
    *Expect:* Clickable prototype is disabled with the same line, and Copy a request for your agent is not
    offered. Open another mockup. *Expect:* whatever Download as ZIP does for a guest, a page's download does
    too. Then go past a guest's calls a minute with a throwaway guest. A guest's calls are counted by the
    calendar minute, so press both downloads within the minute their calls ran out. *Expect:* both buttons say
    the same thing, and it names the limit. Then, with another throwaway guest, go past their 10 MB of downloads
    a day by downloading the largest canvas again and again, paced to stay under the calls a minute, and carry
    on until a page's download is refused too. *Expect:* near the limit the ZIP may be refused while
    the smaller page download still goes; once both are refused they say the same thing, and it names the limit.
23. **Web, as Sam.** Compare the example and standard organizations on the same mockup. *Expect:* they behave
    alike, but for what the example's being read-only explains.

### Pages as tall as their content

24. **MCP and web, as Sam, in the standard organization.** Publish a canvas of three pages, each about 800
    wide with `height: "auto"`: one whose document is clearly taller than 800 (a table of 40 rows), one far
    taller than 4,000 (400 rows), and one with a first section `100vh` tall and rows after it. *Expect:*
    `get` gives `"height": "auto"` for each. **Web:** open it in Exploration without moving the view.
    *Expect:* each label says `800 × auto`; each frame opens short and grows. The first grows to its
    content's height (not 240 or 800), its last row showing with nothing to scroll inside it; the second
    stops at 4,000 and scrolls inside its frame past that; the third stops growing soon after it opens,
    not without end, and scrolls inside its frame. The view stays fitted as they grow: the whole canvas
    in view, no page cut off. Fit one page from its label. *Expect:* it fits at its grown height.
25. **MCP and web, as Sam.** Promote the canvas to the Story, and its first page alone
    (`story_write(action="promote_mockup")`). *Expect:* on the Story's canvas the pages grow as on
    Exploration's, and the view stays fitted; the Story page showing the first page grows its frame to the
    content, which reads to its last row without scrolling inside the frame.

### Everywhere

26. **Web, as Casey.** Do steps 3 and 7 at phone width, and steps 1 and 6 in the dark theme, and reach View, then
    Download as ZIP, by keyboard alone. *Expect:* the toolbar stays on the screen and usable, View is in the
    details panel, focus is always visible, and buttons are named for the screen reader by what they do.

## Look out for

- More than one way to do the same thing, or a control back in the toolbar that belongs in the inspector.
- Anything that shows a count of links, or a line between pages.
- A link that replaces the page on the board instead of flying, or that leaves WhatBuild in the same tab.
- A second copy of a page's frame, a page reloading on the board when nothing asked it to, or a page's calls
  a minute running out from clicking around (a page opened afresh costs a call).
- Web and MCP disagreeing about whether a version is clickable.
- On a canvas of many prototype entries, a page left white for good, or the board asking for every page's
  files at once.
- A page with `height: "auto"` left at 240 or 800, cut off, or a canvas that stops being fitted as its
  frames grow.
- A broken link that says nothing, or a message of WhatBuild's holding anything a page wrote.
