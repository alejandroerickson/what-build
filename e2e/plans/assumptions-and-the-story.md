---
title: An agent records an assumption and publishes a Story page, a person reviews them, a reader reads them
organizations: [standard]
people: [sam, riley, jordan]
surfaces: [web, mcp]
---

# Assumptions and the Story

The loop the product exists for: an agent turns evidence into an assumption and a Story page, a
person reviews the assumption, and a stakeholder who may read only the Story reads the result.
Roles, finding the evidence again by searching, and what a reader can and cannot reach are all
checked on the way.

## Steps

1. **MCP, as Sam, in the standard organization.** In a product that has sources, find words in a
   source's text that support a claim about its users (search, then read the text around a hit
   with `derived(action="text")`). Create an assumption whose
   body says in a sentence or two why the team holds it. Then try the same call with a
   `citations` field.
   *Expect:* the first is created unconfirmed, with its statement and body as sent; the second is
   refused (`422`), naming the field, and creates nothing.
2. **Web, as Riley.** Open Exploration, then assumptions. *Expect:* the new assumption is listed;
   opening it shows the statement, the body, and the agent as its author, and nothing about
   citations.
3. **Web, as Riley.** Search for a few of the words Sam used. *Expect:* the search finds the
   source, saying where they are, and opening the hit shows the source's Text with the words
   marked.
4. **Web, as Riley.** Review the assumption: mark it confirmed (or whatever review the screen
   offers), with a short note. *Expect:* its status changes, and the review is attributed to Riley
   on the web.
5. **MCP, as Sam.** Get the assumption. *Expect:* the review from step 4, with Riley as reviewer.
6. **MCP, as Sam.** Read the Story guidance and the house style, then preview a new Story page that
   tells stakeholders what the assumption means for what the team builds, drawing on the source
   however suits the page (quoting, paraphrasing or linking it), open the preview's url in the browser with
   its grant (`open <url> --header "<name>: <value>"`) at desktop and phone width (`viewport 390
   844`), light and dark (`theme dark`, or `?theme=dark` on the url), then publish the same call and place the
   page under the overview page in the hierarchy. *Expect:* the preview creates no page (the Story
   does not list it) and opens in the house style; the page is published as version 1 with the
   preview's `html_sha256`, and the hierarchy shows it where it was placed.
7. **Web, as Jordan (reader).** Open the Story. *Expect:* the new page is in the tree where step 6
   put it; it renders in the house style, with its HTML as published; the page's details show its
   About alone, without the notes for agents, which a reader is not given (the decision on
   readers). Where the page links into Evidence, check that link: a driver cannot click inside
   the page's sandboxed frame, so open the address the link points to at the top level, as Jordan.
   *Expect:* Jordan is taken back to the Story, with the toast "You can only read this product's
   Story."
8. **Web, as Jordan.** Try to open the assumption from step 1 by its address. *Expect:* refused,
   with a clear message.
9. **MCP, as Jordan.** Try to create an assumption, and to preview and publish a Story page.
   *Expect:* all refused with a permission error, and nothing written (check the activity log as Sam).
10. **MCP, as Sam.** Publish a second version of the page with a small change. **Web, as Jordan.**
    Reload the page. *Expect:* the new version shows, and the earlier version is still reachable
    from its history.
11. **Web, as Sam.** Export the Story to PDF from the Story screen (or open its print view).
    *Expect:* the print view lists the new page in hierarchy order, readable on paper.

## Look out for

- Anything that still shows citations, references, "Cited in", "Cited by" or "Built from".
- Story guidance or a skill that still tells an agent how to quote, attribute or link on a Story
  page (exact quotations only, attribution by role, no links to the evidence); the Story sets no
  such rule.
- Anything a reader can see that the decision on readers says they cannot
  (`okf/decisions/a-reader-reads-only-the-story.md`).
- A Story page that looks different in the app's frame and in the print view.
