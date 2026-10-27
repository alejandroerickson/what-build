---
title: Every screen opens for each role in both organizations, and an agent can connect and read
organizations: [standard, example]
people: [riley, sam, jordan, guest]
surfaces: [web, mcp]
---

# Smoke

The quickest check that a build works at all: each person signs in, every screen they can reach
opens without errors in both organizations, the screens they cannot reach turn them away cleanly,
and an agent connects over MCP and reads what the person can read. Run it first; when it fails, the
other plans will too.

## Steps

1. **Web, as Sam (editor).** Sign in. *Expect:* the overview lists the example and the standard
   organization, each with the same live products, and the synthetic organization, where Sam reads
   one product's Story; no archived product is among them.
2. **Web, as Sam, in the standard organization.** Open a product that has sources and visit each
   section from the panel: Idea, Evidence, Exploration (mockups and assumptions), Story, Activity,
   the product's settings, and Connect an agent; and search from the panel's Search field. Open one
   item in each list that has any: a source, a mockup, an assumption, a Story page. *Expect:* each
   screen loads with content or a designed empty state, and no command prints a `!` problem.
   Connect an agent gives `/mcp` first, with **Limit this agent to one organization or product**
   closed; opening it and choosing **One product** gives this product's address, and closing it
   gives `/mcp` again.
3. **Web, as Sam, in the example organization.** Open the same product and repeat a short tour:
   Idea, Evidence, a source, Story. *Expect:* the same content as in step 2, and one line above
   each screen saying that everyone who signs in reads what Sam writes there.
4. **Web, as Sam.** On a source, open each of its sections, Text, Notes, Comments and Attachments,
   then search for a word you can see in its text, from the panel's Search field. *Expect:* the
   search finds the source as you type, saying the word is in its text, and opening the hit shows
   its Text with the word marked.
5. **Web, as Riley (owner).** Sign in. Open each organization's members page, and Organizations
   from the account menu (Riley owns the instance). *Expect:* all load; Riley can manage members,
   and the members page lists the organization's access changes; Organizations lists both
   organizations with their plans, the example marked as such, and who may create organizations.
6. **Web, as Riley.** Find an archived product among archived products, in either organization. If
   neither has one, archive a product in the standard organization first, from its Settings.
   *Expect:* it is listed as archived and can be opened; only its Settings offers to delete it,
   to Riley as an admin: under the heading "Delete this product", a button reads "Delete <product
   name> permanently…", and its dialog asks for the product's name to be typed.
7. **Web, as Jordan (reader).** Sign in, then open the product's Evidence, Exploration and a source
   by their addresses. *Expect:* Jordan reaches the Story and reads its pages; every other address
   takes Jordan back to the Story (`okf/decisions/a-reader-reads-only-the-story.md`), without
   errors or a broken screen on the way.
8. **MCP, as Sam.** `info`, then `tools`. *Expect:* the server names itself `whatbuild` with its
   tools version; each kind of object has a `_read` and a `_write` tool, and no `_delete` tool at
   the default level; `attachments_write` is among them and there is no `files`, `sandbox`,
   `read_passage`, `sources` or `get_skill`; every tool has a title, and each `_read` tool is marked
   read-only and each `_write` tool destructive. The instructions name `products_read(action="list")`
   and the `guide` tool, and ask nothing to be installed. Call `guide` and compare its
   `tools_version` with the server's.
9. **MCP, as Sam.** List products, then list sources, assumptions, mockups and Story pages
   (`story_read` `list_pages`) in the product from step 2, and read the first window of one source's
   text with `derived_read(action="text")`. *Expect:* the same items the web showed in step 2, with the
   same titles and counts, and the same words the source's Text showed.
10. **Web and MCP, as a guest.** Sign in as `guest@example.com` on the web, then connect over MCP as
    the same address. *Expect:* the overview lists the example organization, marked Example
    organization and Read only, and, since the guest may not start one, says organizations open a
    few at a time and offers **Ask for your own organization**; pressing it says they are on the
    waitlist since today, and the button is gone after a reload. Its products open with a notice that
    it is a worked example nothing in it can change; its Members shows no people.
    `products_read(action="list")` lists the example's products with `your_role` guest and the tenant
    `example: true`; the tool list offers no write but `submit_feedback`, and no `create_tenant`;
    reading a source works, and its `scope` says `your_role` guest; creating one anyway is refused
    with `403 example_read_only`, which says that, since the guest may not start an organization,
    they ask whoever runs this WhatBuild for one, and not to call `create_tenant`.
11. **MCP, as Jordan.** List the tools and the products, then try to list sources in a product, and
    to search it. *Expect:* the tools are `story_read` and `products_read` (with `guide` and
    `submit_feedback`), and no `sources_`, `outcomes_` or `members_` tool and no `search`; the products are listed
    with the role reader; both calls are refused with a clear error naming reader and viewer, not
    an empty result and never `unknown_action` or `unknown_tool`.
12. **Web, any person.** At phone width (390 × 844) and in the dark theme, revisit the overview, a
    source and a Story page. *Expect:* nothing overflows, overlaps or becomes unreadable, and the
    overview's tiles under each product show each section's name and count whole.
13. **Web, as Sam.** On a source, choose Submit feedback in the account menu, choose Bug, write a
    line saying it is an end-to-end test, and send it. *Expect:* the dialog says it sends the
    words, "its kind" once a kind is chosen (not before), the release (on a development server
    that names none, such as `pnpm dev:e2e`, "that it is a development server" instead; on the
    Docker host, the release its image is) and
    the screen, "Evidence, a source"; and not Sam's name or address unless the box to share it
    with the developer of WhatBuild is ticked; the dialog never shows Sam's address; it closes
    with a thank-you toast. Do not tick the box.

## Look out for

- Counts that differ between the overview, the panel, the lists and MCP, or between the two
  organizations, which hold the same content.
- A screen that stays on a loading state, or flashes an error before it loads.
- `!` problems on screens that look fine.
