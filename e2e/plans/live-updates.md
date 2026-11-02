---
title: An open tab hears what changes, and nobody hears what they may not read
organizations: [standard, example]
people: [riley, sam, jordan, guest]
surfaces: [web, mcp]
---

# Live updates

A tab left open on a product follows what someone else or an agent changes. Lists and cards follow by
themselves; a Story page and a mockup's canvas wait for the person, and nothing is lost to a change
that came while they were typing. Run it with a browser left open while another person or agent writes.

## Steps

1. **Web, as Riley, in the standard organization, on Evidence.** Leave it open. **MCP, as Sam:** add a
   source. *Expect:* it appears in Riley's list within about half a minute, with no reload. Filter the
   list by a word in a new source's title and add another that matches: it appears, and the filter stays.
2. **Web, as Riley, on Idea.** **MCP, as Sam:** add an outcome. *Expect:* its card appears by itself.
3. **Web, as Riley, on a Story page, scrolled down.** **MCP, as Sam:** publish a new version of that page.
   *Expect:* a toast says the page was updated and offers Refresh. The page does not move or change, and
   the toast is still there a minute later. Refresh brings the new version, and the toast goes.
4. **MCP, as Sam:** publish a different Story page. *Expect:* no toast for the page Riley is on.
5. **Web, as Riley, on a mockup's canvas, with something typed into a form in one of its pages.** **MCP, as
   Sam:** publish a new version of the mockup. *Expect:* the toast, and what Riley typed is still there
   until they press Refresh.
6. **Web, as Riley, on a source, with Edit details open and its title changed but not saved.** **MCP, as
   Sam:** change the source's title. *Expect:* what Riley typed stays, and saving says someone changed
   it meanwhile rather than overwrite it.
7. **Web, as Jordan, who reads only the Story, on a Story page.** **MCP, as Sam:** add a source.
   *Expect:* in the browser's network panel, Jordan's tab asks for nothing. Publish that Story page:
   Jordan gets the toast.
8. **Web, as a guest, in the example organization.** *Expect:* the tab holds no `live` request open.

## Look out for

- In the network panel: one `live` request per tab, staying open, receiving a line every 25 seconds, and
  closing a couple of minutes after the tab is hidden or ten minutes after it was last used.
- What `live` receives holds no name, id or word of anyone's, only `story`, `idea`, `evidence`,
  `exploration` or `other`.
- Anything that loses someone's place or their typing, and calls a minute running out on a screen left open.
