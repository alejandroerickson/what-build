---
title: Every screen opens for each role in both organizations, and an agent can connect and read
organizations: [standard, sandbox]
people: [riley, sam, jordan]
surfaces: [web, mcp]
---

# Smoke

The quickest check that a build works at all: each person signs in, every screen they can reach
opens without errors in both organizations, the screens they cannot reach turn them away cleanly,
and an agent connects over MCP and reads what the person can read. Run it first; when it fails, the
other plans will too.

## Steps

1. **Web, as Sam (editor).** Sign in. *Expect:* the overview lists both organizations, each with
   the same live products; the archived product is not among them.
2. **Web, as Sam, in the standard organization.** Open a product that has sources and visit each
   section from the panel: Idea, Evidence, Exploration (mockups and assumptions), Story, Activity,
   the product's settings, and Connect an agent; and search from the panel's Search field. Open one
   item in each list that has any: a source, a mockup, an assumption, a Story page. *Expect:* each
   screen loads with content or a designed empty state, and no command prints a `!` problem.
3. **Web, as Sam, in the sandbox organization.** Open the same product and repeat a short tour:
   Idea, Evidence, a source, Story. *Expect:* the same content as in step 2, and the sandbox's
   notice wherever the product says it is a public sandbox.
4. **Web, as Sam.** On a source, open each of its sections, Text, Notes, Comments and Attachments,
   then search for a word you can see in its text, from the panel's Search field. *Expect:* the
   search finds the source as you type, saying the word is in its text, and opening the hit shows
   its Text with the word marked.
5. **Web, as Riley (owner).** Sign in. Open each organization's members page, Organization creators
   from the account menu (Riley owns the instance), and the sandbox organization's sandbox page.
   *Expect:* all load; Riley can manage members, and the members page lists the organization's
   access changes; the sandbox page shows its settings, baseline and
   invitations, and the standard organization has no sandbox page.
6. **Web, as Riley.** Find the archived product among archived products, in either organization.
   *Expect:* it is listed as archived and can be opened; only its Settings offers to delete it,
   to Riley as an admin: under the heading "Delete this product", a button reads "Delete <product
   name> permanently…", and its dialog asks for the product's name to be typed.
7. **Web, as Jordan (reader).** Sign in, then open the product's Evidence, Exploration and a source
   by their addresses. *Expect:* Jordan reaches the Story and reads its pages; every other address
   takes Jordan back to the Story (`okf/decisions/a-reader-reads-only-the-story.md`), without
   errors or a broken screen on the way.
8. **MCP, as Sam.** `info`, then `tools`. *Expect:* the server names itself `whatbuild` with a
   skill version; there are fourteen tools, `attachments` among them and no `files` or
   `read_passage`; the instructions say to start with `products(action="list")`. Call `get_skill`
   and compare its version with the server's.
9. **MCP, as Sam.** List products, then list sources, assumptions, mockups and Story pages
   (`story` `list_pages`) in the product from step 2, and read the first window of one source's
   text with `derived(action="text")`. *Expect:* the same items the web showed in step 2, with the
   same titles and counts, and the same words the source's Text showed.
10. **MCP, as Sam.** Read `sandbox(action="status")` for each organization through `/mcp`, then
    for the sandbox organization through its own endpoint (`--endpoint /mcp/t/<sandbox org>`).
    *Expect:* through `/mcp` the standard organization's call is refused with an error that says it
    is not a public sandbox, and the sandbox's with `403 sandbox_needs_its_own_connector`, naming
    the sandbox's own address; `products(action="list")` through `/mcp` lists none of the sandbox's
    products, only the sandbox under `public_sandboxes`. Through its own endpoint the sandbox
    answers with its notice and that address as `connect_at`.
11. **MCP, as Jordan.** List products, then try to list sources in a product, and to search it.
    *Expect:* the products are listed with the role reader; both are refused with a clear error, not
    an empty result.
12. **Web, any person.** At phone width (390 × 844) and in the dark theme, revisit the overview, a
    source and a Story page. *Expect:* nothing overflows, overlaps or becomes unreadable, and the
    overview's tiles under each product show each section's name and count whole.
13. **Web, as Sam.** On a source, choose Submit feedback in the account menu, choose Bug, write a
    line saying it is an end-to-end test, and send it. *Expect:* the dialog says it sends the
    words, "its kind" once a kind is chosen (not before), the release (on a development server,
    such as the end-to-end instance, "that it is a development server" instead of a release) and
    the screen, "Evidence, a source"; and not Sam's name or address unless the box to share it
    with the developer of WhatBuild is ticked; the dialog never shows Sam's address; it closes
    with a thank-you toast. Do not tick the box.

## Look out for

- Counts that differ between the overview, the panel, the lists and MCP, or between the two
  organizations, which hold the same content.
- A screen that stays on a loading state, or flashes an error before it loads.
- `!` problems on screens that look fine.
