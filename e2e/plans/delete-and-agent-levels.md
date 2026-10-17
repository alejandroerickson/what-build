---
title: Admins delete permanently, editors archive, and an agent does only what its connection's level allows
organizations: [standard, sandbox]
people: [riley, sam]
surfaces: [web, mcp]
---

# Deleting, and an agent's level

Archive is the reversible default and editors' alone; permanent delete is admins', behind a
preview, a reason and the words "delete permanently", and an agent deletes only on a connection
its person set to Admin. This plan checks both doors against each other, and that an agent cannot
raise its own level. It deletes only what it made itself in the run.

## Steps

1. **Run folder.** Write three short synthetic texts in the run's folder, each with a phrase of
   its own that appears nowhere in the product (search first).
2. **MCP, as Sam, in the standard organization, at the default level.** Connect with no `--level`,
   then list the tools. *Expect:* no delete action anywhere (`sources`, `assumptions`, `outcomes`,
   `story`, `mockups`, `products`), and no `members` write. `products(action="list")` says
   `connection_level: "editor"`.
3. **MCP, as Sam.** In a product with sources, add the first text as a source, then call
   `sources(action="delete")` on it anyway with its etag, a reason and `confirm: "delete
   permanently"`. *Expect:* `403 connection_level`, naming Admin and Connect an agent; the source
   is still there.
4. **MCP, as Sam, at `--level admin`.** Repeat the delete. *Expect:* `403 forbidden` naming editor
   and admin: Sam's own role is editor, and the level never adds to it. Archive the source instead;
   it leaves the list and search.
5. **Web, as Sam.** On that source's page, and on an assumption's. *Expect:* Archive is offered,
   Delete permanently is not.
6. **MCP, as Riley, at the default level.** Add the second text as a source. Then on the web, as
   Riley, open Connect an agent: the connection says Edit. Raise it to Admin there.
   *Expect:* the change is confirmed with Undo, and listing the tools again as Riley, still without
   `--level` (the same connection), now shows the delete actions.
7. **MCP, as Riley, on the same connection, now at Admin.** `sources(action="delete_impact")` on the second source, then
   delete it with the impact's etag. *Expect:* the impact lists what goes; the delete answers
   `deleted: true`; reading the source answers `410 record_deleted` with the reason; Activity on
   the web shows the delete, attributed to Riley through the agent.
8. **Web, as Riley.** Add the third text as a source, comment on it, and
   create an assumption and an outcome. Delete each from its own screen: the comment
   from the comment, the assumption and the outcome from their menus, the source from its menu.
   *Expect:* every dialog says it can't be undone, shows what goes, needs a reason, offers Archive
   instead where the thing can be archived, and only the source asks for its title typed. After
   each, the thing is gone and a toast says the activity log records it.
9. **Web, as Riley.** On a mockup that a Story page shows, open Delete permanently from the
   inspector. *Expect:* the dialog names the Story page that shows it, and the delete stays
   disabled. Cancel.
10. **Web, as Riley.** Open the product's Settings and the organization's Members page.
    *Expect:* Delete this product and Delete this organization are there, each asking for the
    name to be typed; open each dialog, check the counts look right, and cancel. Do not delete.
11. **The sandbox organization, as Riley.** Open its Members page. *Expect:* no Delete this
    organization. As Sam there, nothing offers a permanent delete.
12. **Web, as Riley, then MCP on the same connection.** On Connect an agent, untick Can submit
    feedback on the connection from step 6, then list the tools and call `submit_feedback` anyway.
    *Expect:* the change is confirmed with Undo; `submit_feedback` is not listed, the call answers
    `403 feedback_off`, and the server's instructions say the person turned it off. Tick it again.

## Look out for

- Any screen or message that calls archiving deleting, or deleting removing.
- A delete that succeeds without a reason, the exact words, or the latest etag.
- An agent offered an action its level does not allow, or a level the agent could change itself.
- Anything deleted that was not made in this run.
