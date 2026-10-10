---
title: An agent records an assumption and publishes a Story page, a person reviews them, a reader reads them
organizations: [standard]
people: [sam, riley, jordan]
surfaces: [web, mcp]
---

# Assumptions and the Story

The loop the product exists for: an agent turns evidence into a cited assumption and a Story page,
a person reviews the assumption, and a stakeholder who may read only the Story reads the result.
Citations, roles and what a reader can and cannot reach are all checked on the way.

## Steps

1. **MCP, as Sam, in the standard organization.** In a product that has sources, find a passage
   that supports a claim about its users (read a source, or search). Create an assumption that
   cites that passage.
   *Expect:* it is created unconfirmed, with the citation's quoted text matching the passage.
2. **Web, as Riley.** Open Exploration, then assumptions. *Expect:* the new assumption is listed;
   opening it shows the statement, the citation, and the agent as its author.
3. **Web, as Riley.** Follow the citation. *Expect:* it opens the cited passage in its source.
4. **Web, as Riley.** Review the assumption: mark it confirmed (or whatever review the screen
   offers), with a short note. *Expect:* its status changes, and the review is attributed to Riley
   on the web.
5. **MCP, as Sam.** Get the assumption. *Expect:* the review from step 4, with Riley as reviewer.
6. **MCP, as Sam.** Read the Story guidance and the house style, then publish a new Story page that
   summarizes the assumption and cites the same passage, and place it under the overview page in the
   hierarchy. *Expect:* the page is published as version 1, and the hierarchy shows it where it was
   placed.
7. **Web, as Jordan (reader).** Open the Story. *Expect:* the new page is in the tree where step 6
   put it; it renders in the house style, with its HTML as published; the page's details offer no
   citations or references, which a reader is not given (the decision on readers); a link in the
   page that points into Evidence takes Jordan back to the Story with a toast saying they can read
   only the Story.
8. **Web, as Jordan.** Try to open the assumption from step 1 by its address. *Expect:* refused,
   with a clear message.
9. **MCP, as Jordan.** Try to create an assumption, and to publish a Story page. *Expect:* both
   refused with a permission error, and nothing written (check the activity log as Sam).
10. **MCP, as Sam.** Publish a second version of the page with a small change. **Web, as Jordan.**
    Reload the page. *Expect:* the new version shows, and the earlier version is still reachable
    from its history.
11. **Web, as Sam.** Export the Story to PDF from the Story screen (or open its print view).
    *Expect:* the print view lists the new page in hierarchy order, readable on paper.

## Look out for

- A citation whose quoted text differs from the passage, or that opens the wrong place.
- Anything a reader can see that the decision on readers says they cannot
  (`okf/decisions/a-reader-reads-only-the-story.md`).
- A Story page that looks different in the app's frame and in the print view.
