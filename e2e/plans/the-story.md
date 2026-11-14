---
title: An agent publishes a Story page from the evidence, a person finds what it drew on, a Story reader reads only the Story
organizations: [standard]
people: [sam, riley, jordan]
surfaces: [web, mcp]
---

# The Story

The loop the product exists for: an agent turns evidence into a Story page, a person finds the
evidence behind it again by searching, and a stakeholder who may read only the Story reads the
result. Roles, what a Story reader can and cannot reach, and that assumptions are gone for good are all
checked on the way.

## Steps

1. **MCP, as Sam, in the standard organization.** List the tools. Then call
   `assumptions_read(action="list")` and `assumptions_write(action="create")` by name, as a client
   holding an older tool list would. *Expect:* no tool for assumptions is listed; each call is
   refused, saying assumptions are retired and WhatBuild no longer keeps them, and nothing is
   written (the activity log is unchanged).
2. **MCP, as Sam.** In a product that has sources, find words in a source's text that bear on what
   its users need (search, then read the text around a hit with `derived_read(action="text")`).
   Then search again with `scope: "assumptions"`, and in plain mode with `kind: "assumption"`.
   *Expect:* the first finds the source, saying where the words are; the other two are refused
   (`422`), each with a hint that WhatBuild no longer keeps assumptions, and nothing is searched.
3. **Web, as Riley.** Open Exploration. *Expect:* its panel lists the mockups and nothing else,
   and its count is the number of mockups. Then open the product's `/exploration/assumptions`
   address at the top level. *Expect:* Exploration's mockups, with a toast saying WhatBuild no
   longer keeps assumptions.
4. **Web, as Riley.** Search for a few of the words Sam used. *Expect:* the search finds the
   source, saying where they are, and opening the hit shows the source's Text with the words
   marked, standing on the place the hit showed. Search for "assumptions" with one of those words.
   *Expect:* no area or kind of result is brought first, and no result is an assumption.
5. **MCP, as Sam.** Read the Story guidance and the house style, then preview a new Story page that
   tells stakeholders what the source means for what the team builds, drawing on it however suits
   the page (quoting, paraphrasing or linking it), open the preview's url in the browser with its
   grant (`open <url> --header "<name>: <value>"`) at desktop and phone width (`viewport 390
   844`), light and dark (`theme dark`, or `?theme=dark` on the url), then publish the same call
   and place the page under the overview page in the hierarchy. *Expect:* the guidance's link
   templates name no assumption; the preview creates no page (the Story does not list it) and opens
   in the house style; the page is published as version 1 with the preview's `html_sha256`, and the
   hierarchy shows it where it was placed.
6. **Web, as Jordan (Story reader).** Open the Story. *Expect:* the new page is in the tree where step 5
   put it; it renders in the house style, with its HTML as published; the page's details show its
   About alone, without the notes for agents, which a Story reader is not given (the decision on
   Story readers). Where the page links into Evidence, check that link: a driver cannot click inside
   the page's sandboxed frame, so open the address the link points to at the top level, as Jordan.
   *Expect:* Jordan is taken back to the Story, with the toast "You can only read this product's
   Story."
7. **Web, as Jordan.** Try to open the source from step 2 by its address. *Expect:* refused, with a
   clear message.
8. **MCP, as Jordan.** Try to preview and to publish a Story page. *Expect:* both refused with a
   permission error, and nothing written (check the activity log as Sam).
9. **MCP, as Sam.** Publish a second version of the page with a small change. **Web, as Jordan.**
   Reload the page. *Expect:* the new version shows, and the earlier version is still reachable
   from its history.
10. **Web, as Sam.** Export the Story to PDF from the Story screen (or open its print view).
    *Expect:* the print view lists the new page in hierarchy order, readable on paper.
11. **Web, as Sam.** Open a mockup in Exploration and use **Promote canvas to Story**. In the Story's
    tree, drag the new page under a Story page, and a mockup page under the canvas. *Expect:* one new
    Story page, however many pages the canvas has, at the end of the tree until it is moved; every row
    moves alike, keeps its place after a reload, and has an icon that names it on hover: Story page,
    Mockup page, Mockup canvas. The mockup's inspector names the Story page and the version it shows.
12. **Web, as Jordan.** Open that canvas in the Story, pan, zoom and step through its pages. Then try
    the mockup's own address. *Expect:* the board and its page titles draw as on the mockup's screen,
    with no brief, notes or files; the mockup itself is refused, with the Story's toast.

## Look out for

- Anything that still shows or names assumptions: a section of Exploration's panel, a count, a
  kind in search, an outcome's menu or delete dialog, the guide, an operation's description, the
  Story guidance.
- Anything that still shows citations, references, "Cited in", "Cited by" or "Built from".
- Story guidance, the guide or an operation's description that still tells an agent how to quote, attribute or link on a Story
  page (exact quotations only, attribution by role, no links to the evidence); the Story sets no
  such rule.
- Anything a Story reader can see that the decision on Story readers says they cannot
  (`okf/decisions/a-story-reader-reads-only-the-story.md`).
- A Story page that looks different in the app's frame and in the print view.
