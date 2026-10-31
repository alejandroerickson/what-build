---
title: Admins delete permanently, editors archive, and an agent is offered only what its connection's level and its person allow
organizations: [standard, example]
people: [riley, sam, jordan]
surfaces: [web, mcp]
---

# Deleting, and an agent's level

Archive is the reversible default and editors' alone; permanent delete is admins', behind a
preview, a reason and the words "delete permanently", and an agent deletes only on a connection
its person set to Admin. An agent is offered only what its person could do, and never what a
person does only in the web app (running this WhatBuild among it): on a scoped connector only what
the person's role there reaches, and on the unscoped one what their role in some organization
reaches, unless they may start one. This
plan checks both doors against each other, and that an agent cannot raise its own level. It
deletes only what it made itself in the run.

## Steps

1. **Run folder.** Write three short synthetic texts in the run's folder, each with a phrase of
   its own that appears nowhere in the product (search first).
2. **MCP, as Sam, in the standard organization, at the default level.** Connect with no `--level`,
   then list the tools. *Expect:* no `_delete` tool at all (`sources_delete`, `assumptions_delete`,
   `outcomes_delete`, `story_delete`, `mockups_delete`, `products_delete`), and no `members_write`:
   `members_read` offers `list` alone, and its description says nothing of granting, revoking or
   inviting. Every tool has a title; each `_read` tool is marked read-only and each `_write` tool
   destructive. `products_read(action="list")` says `connection_level: "editor"`. `products_write`
   offers `update_concept` and `outcomes_read` offers `card_preview`: an editor writes the Idea's
   cards. Preview a concept front with
   `outcomes_read(action="card_preview", kind="concept", card_html=<a short front>)` and open its `url` with its `headers` at 900
   and 390 wide. *Expect:* the front with a dashed line at 560px and a note on how tall it is; at
   390, no line, and a note below the front, clear of its last line, that a phone shows the whole
   front.
3. **MCP, as Sam.** In a product with sources, add the first text as a source, then call
   `sources_delete(action="delete")` on it anyway with its etag, a reason and `confirm: "delete
   permanently"`. *Expect:* `403 connection_level`, naming Admin and Connect an agent; the source
   is still there.
4. **MCP, as Sam, at `--level admin`.** Repeat the delete. *Expect:* `403 forbidden` naming editor
   and admin: Sam's own role is editor, and the level never adds to it. Archive the source instead;
   it leaves the list and search.
5. **Web, as Sam.** On that source's page, archived in step 4, then on a live source's page and on
   an assumption's. *Expect:* the archived source offers Restore; the live source and the
   assumption offer Archive; none offers Delete permanently.
6. **MCP, as Riley, at the default level.** Add the second text as a source. Then on the web, as
   Riley, open Connect an agent: the connection says Edit. Raise it to Admin there.
   *Expect:* the change is confirmed with Undo, and listing the tools again as Riley, still without
   `--level` (the same connection), now shows the `_delete` tools.
7. **MCP, as Riley, on the same connection, now at Admin.** `sources_read(action="delete_impact")` on the second source, then
   delete it with the impact's etag. *Expect:* the impact lists what goes; the delete answers
   `deleted: true`; reading the source answers `410 record_deleted` with the reason; Activity on
   the web shows the delete, attributed to Riley through the agent.
8. **Web, as Riley.** Add the third text as a source, comment on it, and
   create an assumption; have the agent create an outcome (the web app adds none). Delete each from its own screen: the comment from its
   menu, the assumption and the outcome from their menus, the source from its menu.
   *Expect:* every dialog asks "Delete this … permanently?", says it can't be undone, shows what
   goes, needs a reason, has Cancel and Archive instead (each of these can be archived, the
   comment too), and only the source asks for its title typed. After each, the thing is gone and
   a toast says the activity log records it, quoting a statement that ends with a full stop
   without a second one.
9. **Web, as Riley.** On a mockup that a Story page shows, open Delete permanently from the
   inspector. *Expect:* the dialog names the Story page that shows it, and the delete stays
   disabled. Cancel.
10. **Web, as Riley.** Open the product's Settings and the organization's Members page.
    *Expect:* Delete this product and Delete this organization are there, each asking for the
    name to be typed; open each dialog, check the counts look right, and cancel. The product's
    dialog, the product being live, has Archive instead beside Cancel; the organization's, which
    can't be archived, has Cancel alone. Do not delete or archive.
11. **The example organization, as Riley.** Open its Members page. *Expect:* no Delete this
    organization, since it is the example; Organization name shows its name and short name in
    links, and offers Save changes once either is changed. Do not change them. As a guest (`guest@example.com`) there, nothing offers
    an archive or a permanent delete.
12. **Web, as Riley, then MCP on the same connection.** On Connect an agent, untick Can submit
    feedback on the connection from step 6, then list the tools and call `submit_feedback` anyway.
    *Expect:* the change is confirmed with Undo; `submit_feedback` is not listed, the call answers
    `403 feedback_off`, and the server's instructions say the person turned it off. Tick it again.
13. **MCP, as Sam, then as Riley on the connection from step 6.** List the tools. *Expect:*
    neither's `products_read` or `products_write` offers `usage`, `organizations`, `accounts`,
    `set_plan` or the allowances, and their descriptions name none of them, though Riley owns this
    WhatBuild. `products_read(action="usage")` called anyway answers each `403 web_only`, saying
    whoever runs this WhatBuild reads it with its usage report, never `unknown_action`.
14. **MCP, as Jordan, on a connector scoped to a product of the standard organization**
    (`--endpoint /mcp/t/<org>/<team>/<product>`). List the tools. *Expect:* `story_read` and
    `products_read` and `search` (with `guide` and `submit_feedback`), and no `story_write`, no
    `sources_`, `outcomes_` or `members_` tool; `search` takes `plain` mode alone, over the Story;
    `sources_read(action="list")` called anyway answers `403`, naming reader and viewer.
    Then as Sam on the organization's connector (`--endpoint /mcp/t/<org>`): writes and archives,
    `members_read` `list`, and no `_delete` tool, no `members_write`, no `create_team`.
15. **MCP, as Jordan and as a guest, on the unscoped connector** (no `--endpoint`, `--level admin`;
    the guest is `guest@example.com`). List the tools. *Expect:* neither may start an organization,
    so neither is offered `create_tenant`. Jordan, a reader everywhere, is offered what step 14 lists;
    the guest every read of the example and no write but `submit_feedback`, and `story_read`'s
    description says nothing of publishing to Jordan. Casey, who may start an organization (the
    golden master's sample allowance goes to the synthetic organization's editor), is offered
    everything the level allows. Sam, who may not, is offered no `create_tenant`.

## Look out for

- Any screen or message that calls archiving deleting, or deleting removing.
- A delete that succeeds without a reason, the exact words, or the latest etag.
- An agent offered an action its level does not allow or its person could not do, or a level the
  agent could change itself.
- An agent told its tool list is old when an action is missing on purpose.
- Anything deleted that was not made in this run.
