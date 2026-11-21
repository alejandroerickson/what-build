---
title: Two people's agents work through one product's Playbook, and only those who should reach it do
organizations: [standard, example, synthetic]
people: [riley, sam, jordan, morgan, guest]
surfaces: [web, mcp]
---

# The Playbook

Each product keeps a Playbook that the agents of everyone working on it read and write together. Its
files are kept as revisions and its links name the product's objects. Messages pass between
people's agents beside it. People see it only as a section of Settings, where an admin turns it off
and on. This plan has Sam's agent and Riley's agent work through one product's Playbook: the starter
copied in on first write, a correction kept as a lesson, a conflict merged, a message passed,
a linked source archived and restored, several changes at once. It then checks the web app's
side, the switch, the levels and roles, and that one organization's Playbook reaches nobody outside it.
It writes only files it makes itself, in products of the standard organization.

## Steps

1. **Run folder.** Pick a product of the standard organization with sources, and note its path.
   Write a short synthetic lesson into the run's folder: frontmatter with `type: Lesson`, a
   `title`, a `description` and `applies_to: [story]`, then a few lines in a phrase of its own that
   appears nowhere in the product (search first). Pick a live source of the product, and put a
   `whatbuild:sources/<record_id>` link to it and a `whatbuild:product` link in the lesson.
2. **MCP, as Sam, in the standard organization, at the default level.** Connect, list the tools,
   and read `guide(topic="playbook")`. *Expect:* `playbook_read` and `playbook_write`, and no `playbook_delete`. The
   server's instructions and `guide(topic="start")` say WhatBuild is used through each product's
   Playbook. Every answer gives `tools_version` 0.68.0. `products_read(action="get")` on the product
   gives `playbook` with `read_first` (titles and descriptions), `by_area`, and how many files it holds.
   `playbook_read(action="index")` lists the starter (`using-this-playbook.md`, four files under `how-to/` and
   two under `product/`), each at revision 0 and marked `from_starter`, with `index_md`.
   `playbook_read(action="read", path="using-this-playbook.md")` gives its text and etag.
3. **MCP, as Sam: refused writes first.** Write `index.md`, a file with no frontmatter, a Markdown
   file whose frontmatter has no `type`, and a path with a space in it. *Expect:* `422
   playbook_reserved_path`, `422 playbook_frontmatter_missing`, `422 playbook_type_missing` and `422
   invalid_playbook_path`, which says what a path may hold. Each message says what to do. `playbook_read(action="index")` still shows the
   starter at revision 0.
4. **MCP, as Sam: the first write.** Write the lesson from step 1 at `lessons/<slug>.md`, with a
   `message` saying why. *Expect:* it is created at revision 1, with no warning about its links.
   The index now holds the starter's files, copied in at revision 1 by WhatBuild with their etags
   unchanged and no longer marked `from_starter`, beside the lesson. `playbook_read(action="read")` of the lesson gives both
   links with what they name now (the source's title, `live`; the product). `story_read(action=
   "guidance")` lists the lesson under `playbook`. Writing `Lessons/<slug>.md`, the same path in other
   capitals, is refused `409 playbook_path_taken`. A second write of the lesson without
   `expected_etag` is refused `409 stale_etag`. Writing a new file with a link to
   `whatbuild:sources/<an id the product does not hold>` is created with a warning that the link
   names nothing.
5. **MCP, as Riley, on the same product.** Connect, and read the lesson. *Expect:* Sam's text,
   with the same etag and links Sam saw. `products_read(action="get")` lists it under `by_area` for
   the Story. `playbook_read(action="search")` for the lesson's phrase finds it, with lines around it.
6. **MCP, as Riley and as Sam: a conflict.** Both read `product/now.md` and keep its etag. Riley
   writes it first, with a line of their own and a `message`. Sam then writes it with the same old
   etag. *Expect:* Riley's write succeeds. Sam's is refused `409 stale_etag`, whose details give
   `current_content` (Riley's text), `current_etag`, the revision and who wrote it (Riley, through
   the agent). Sam merges both lines and writes again with `current_etag`. *Expect:* it succeeds.
   `playbook_read(action="history", path="product/now.md")` lists the revisions newest first, each with
   its author and message. `playbook_read(action="read")` with an earlier `revision` gives that text.
7. **MCP, as Sam: a message to Riley's agents.** Find Riley's `account_id` with
   `members_read(action="list")` on the product (it takes the organization's and the product's
   slugs), and send Riley a message. *Expect:* it is sent, with when it expires (60 days on).
   Sending one to Sam's own account is refused `422 playbook_message_to_self`. Sending one to Jordan,
   who reads only the Story, is refused `404`, saying messages go to the product's viewers, editors
   and admins and never to someone who reads only its Story. `playbook_read(action="messages", box="sent")` lists Sam's
   message.
8. **MCP, as Riley.** Call any read in the product, such as `sources_read(action="list")`.
   *Expect:* the answer's `scope` gives `playbook_messages_waiting: 1`. `playbook_read(action="messages")`
   lists Sam's message, unread, from Sam. `playbook_write(action="mark_read")` with its id marks it, and
   the next answer gives no messages waiting.
9. **MCP, as Sam: a linked source archived.** Archive the source the lesson links to. *Expect:*
   the archive answers `playbook_cited_by` naming the lesson, with `playbook_note`.
   `playbook_read(action="backlinks")` for the source lists the lesson. Reading the lesson gives that
   link as `archived`. `playbook_read(action="housekeeping")` lists the lesson under `broken_links`,
   along with the file from step 4 that links to nothing. Restore the source. *Expect:* the
   lesson's link reads `live` again.
10. **MCP, as Sam: several changes at once.** `playbook_read(action="read_files", prefix="how-to/")`
    gives each file with its text and etag. Send one `playbook_write(action="apply")` that changes one
    of them, moves the file from step 4 to `lessons/<another-slug>.md` and removes another, with
    one etag deliberately stale. *Expect:* `409 playbook_stale` listing that file with its current text,
    and nothing written: the index is as before. Send it again with the right etag. *Expect:* all
    three applied. The moved file keeps its history under its new path. Restore the removed file
    from `playbook_read(action="history")` with `playbook_write(action="restore")`, and it is listed again.
    `playbook_read(action="starter")` says which files differ from WhatBuild's starter.
11. **Web, as Riley, in the standard organization.** Open the product's Activity and filter it to
    the Playbook. *Expect:* each change above, said in words ("added to the Playbook", "changed in the Playbook",
    "moved in the Playbook", "removed from the Playbook", "restored in the Playbook", "sent a message to the
    agents of"), one entry for each file step 10's change touched, each naming its path. Each is
    attributed to Sam or Riley through the agent, and none of them shows the
    message's text. Open Settings → the product → Playbook. *Expect:* the section says what the Playbook is,
    that it isn't shown in WhatBuild, and the format its files are in. It says how many files it holds, and
    the count matches `playbook_read(action="index")`. "Keep a Playbook for this product" is ticked and can be
    changed. Check it at phone width and in the dark theme too.
12. **Web, as Riley, with Settings → Playbook open; MCP, as Sam.** Write a new file over MCP while the
    section is open. *Expect:* the section's count of files goes up by one without a reload.
13. **Web, as Riley: off.** Untick "Keep a Playbook for this product". *Expect:* a toast says the Playbook is
    off. Over MCP, as Sam: `playbook_read(action="index")`, `playbook_read(action="messages")` and an
    `playbook_write` each answer `409 playbook_off` and say an admin turns it on in Settings, and no answer
    gives `playbook_messages_waiting`. `products_read(action="get")` gives no `read_first`,
    `story_read(action="guidance")` lists no Playbook files, and archiving and restoring a source that a
    file links to gives no `playbook_cited_by`. Tick it again. *Expect:* a toast says it is on, and
    every file is back at the revision and etag it had. Activity shows it turned off and on, by
    Riley, among the product's settings, each entry opening Settings → Playbook.
14. **Web, as Sam, in the standard organization.** Open Settings → the product → Playbook. *Expect:* the
    same text, a note that only admins of this product turn it off or on, and the switch disabled.
15. **MCP, as Sam, at `--level viewer`, then as Jordan.** As Sam on a Read only connection, list
    the tools. *Expect:* `playbook_read` and no `playbook_write`. Reading the index and Sam's sent messages
    works. As Jordan, a Story reader, on the unscoped connector and on one scoped to the product:
    *Expect:* no Playbook tool is listed, and `playbook_read(action="index")` called anyway is refused `403
    forbidden`, saying Jordan is a Story reader and it needs viewer. `products_read(action="get")`
    gives Jordan no `playbook`.
16. **MCP, as Riley, then Sam, on an Admin connection.** As Riley at `--level admin`, purge the
    file moved in step 10 with `playbook_delete(action="purge")`: first without `confirm`, then with its
    etag, a reason and `confirm: "delete permanently"`. *Expect:* the first is refused `422`, naming
    what is missing. The second deletes it, and its history is gone too: reading the path answers
    `410 playbook_file_deleted` with Riley's reason. Activity on the web shows "deleted from the Playbook",
    attributed to Riley. As Sam at `--level admin`: no `playbook_delete` is offered, and calling it
    anyway on another file made in the run is refused `403 forbidden` naming editor and admin, and
    the file stays.
17. **MCP, as Sam: the export.** `products_export(action="export")` on the product, then download
    it when it is ready. *Expect:* the ZIP holds `playbook/files/` with every file not removed, at its
    path, and `playbook/revisions.jsonl`, and no message. Its README or manifest says what each holds.
18. **The example organization, as a guest** (`guest@example.com`). Over MCP, read
    `playbook_read(action="index")` on a product of the example organization, then try `playbook_write` there.
    *Expect:* the index answers (the starter, or what the example's authors wrote). No `playbook_write`
    is offered; called anyway, a write and a message are each refused `403 example_read_only`. On the web, Settings → the product
    → Playbook says it is a worked example to read, and the switch is disabled.
19. **The synthetic organization, as Morgan; the standard organization's Playbook from outside.** Over
    MCP as Morgan, read Crewboard's Playbook. *Expect:* the sample's files (a lesson, what is current, a
    person's page) and, for whoever it was sent to, a message waiting. As Morgan, call
    `playbook_read(action="index")` and `playbook_read(action="read")` of the lesson from step 4 on the standard
    organization's product. *Expect:* `404`, no such product visible, the same as any tool answers
    there, with no file named. As Sam, who reads only Crewboard's Story, `playbook_read` on Crewboard is refused, and
    no Playbook tool is offered on a connector scoped to Crewboard.

## Look out for

- An agent pointed at the Playbook when it is off, or not pointed at it when it is on: in the server's
  instructions, `products_read(action="get")`, each part's guidance, and the messages waiting.
- A conflict that loses either person's text, or an `apply` that writes part of a change.
- The starter copied in twice, or its etags changed by the copy, so that an agent's etag from
  before the first write turns stale.
- A message's text, or anything from the Playbook, shown in the web app, which shows only its
  Settings section and its activity.
- Activity naming a file as something other than its path, or not saying who wrote it through
  which agent.
- One organization's Playbook, or whether a file exists in it, reaching anyone outside it.
- Guidance in the guide, the starter or a tool's description that led the agent astray.
