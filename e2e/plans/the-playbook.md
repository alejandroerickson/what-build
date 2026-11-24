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
a linked source archived and restored, several changes at once, a folder downloaded as a ZIP and
sent back as one. It then checks the web app's
side, the switch, the levels and roles, and that one organization's Playbook reaches nobody outside it.
It writes only files it makes itself, in products of the standard organization.

## Steps

1. **Run folder.** Pick a live product of the standard organization with sources (not the archived
   one, where every write is refused), and note its path.
   Write a short synthetic lesson into the run's folder: frontmatter with `type: Lesson`, a
   `title`, a `description` and `applies_to: [story]`, then a few lines in a phrase of its own that
   appears nowhere in the product (search first). Pick a live source of the product, and put a
   `whatbuild:sources/<record_id>` link to it and a `whatbuild:product` link in the lesson.
2. **MCP, as Sam, in the standard organization, at the default level.** Connect, list the tools,
   and read `guide(topic="playbook")`. *Expect:* `playbook_read` and `playbook_write`, and no `playbook_delete`. The
   server's instructions and `guide(topic="start")` say WhatBuild is used through each product's
   Playbook by those who work on it, and that someone who only reads a product's Story does not
   reach it. Every answer gives `tools_version` 0.71.0. `products_read(action="get")` on the product
   gives `playbook` with `read_first` (titles and descriptions), `by_area`, and how many files it holds.
   `playbook_read(action="index")` lists the starter (`using-this-playbook.md`, four files under `how-to/` and
   two under `product/`), each at revision 0 and marked `from_starter`, with `index_md`.
   `playbook_read(action="read", path="using-this-playbook.md")` gives its text and etag.
3. **MCP, as Sam: refused writes first.** Write `index.md`, a file with no frontmatter, a Markdown
   file whose frontmatter has no `type`, and a path with a space in it. *Expect:* `422
   playbook_reserved_path`, `422 playbook_frontmatter_missing`, `422 playbook_type_missing` (which spells out
   the Open Knowledge Format, not only "OKF") and `422 invalid_playbook_path`, which says what a path
   may hold. Each message says what to do. `playbook_read(action="index")` still shows the
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
   the Story. `playbook_read(action="search")` for the lesson's phrase finds it, with a snippet that is the line
   holding the phrase and the nearest line before and after it that isn't blank (blank lines
   between left out), each on a line of its own, and no frontmatter.
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
    three applied. The moved file keeps its history under its new path. `playbook_read(action="read")` and
    `playbook_read(action="history")` of its old path answer `404` saying it was moved and naming its
    new path (`moved_to`), never that the path has had no file. Restore the removed file
    from `playbook_read(action="history")` with `playbook_write(action="restore")`, and it is listed again.
    `playbook_read(action="starter")` says which files differ from WhatBuild's starter.
11. **MCP, as Sam: a folder downloaded.** `playbook_read(action="get_download", prefix="how-to/")`, then
    `get_download` without a prefix. GET each `url` with the `headers` given, into a folder of its
    own in the run's folder, and unzip. *Expect:* every file at its Playbook path (only those under
    `how-to/` in the first), and a `_manifest.json` whose `etag`, `revision`, `size` and `sha256` for
    each file equal what `playbook_read(action="read")` gives for it. The sha256 of each file's bytes
    (`shasum -a 256`) equals that value, and `playbook_read(action="index")` gives `size` and `sha256`
    for every file.
12. **MCP, as Sam: a folder sent back.** In the whole download, change one file of `how-to/`, and zip
    the folder as it is, manifest and all. `playbook_write(action="request_upload")`, PUT the ZIP to
    its `url` with its `headers`, then `apply` with `upload_id`: first a write step without `content`
    for the changed file (with the manifest's etag) and one for a path the ZIP lacks. *Expect:* `422
    playbook_upload_missing` naming only the missing path, and nothing changed. Then the good step
    alone. *Expect:* the file written at its next revision, its `sha256` equal to the edited file's,
    the answer's `upload` giving the ZIP's `size` and `sha256` (equal to the file's on disk), and no
    other file of the ZIP written (the index shows no other revision moved). `apply` the same upload
    again. *Expect:* `409 upload_used`. PUT to the same grant again. *Expect:* `409
    already_uploaded`, saying the upload was applied and that a new change needs a new upload.
13. **Web, as Riley, in the standard organization.** Open the product's Activity and filter it to
    the Playbook. *Expect:* each change above, said in words ("added to the Playbook", "changed in the Playbook",
    "moved in the Playbook", "removed from the Playbook", "restored in the Playbook", "sent a message to the
    agents of"), one entry for each file step 10's change touched, each naming its path. Each is
    attributed to Sam or Riley through the agent, and none of them shows the
    message's text. Open Settings → the product → Playbook. *Expect:* the section says what the Playbook is
    and holds, that it isn't shown in WhatBuild, and that an export includes it, in the Open Knowledge
    Format. It says how many files it holds, and
    the count matches `playbook_read(action="index")`. "Keep a Playbook for this product" is ticked and can be
    changed. Check it at phone width and in the dark theme too.
14. **Web, as Riley, with Settings → Playbook open; MCP, as Sam.** Write a new file over MCP while the
    section is open. *Expect:* the section's count of files goes up by one without a reload.
15. **Web, as Riley: off.** First, over MCP as Sam, send Riley's agents another message, and as
    Riley call a read in the product. *Expect:* its `scope` gives `playbook_messages_waiting: 1`.
    Also as Sam, take a `get_download` grant, and `request_upload` and PUT a ZIP holding one new
    file under `lessons/`, without applying it. Then untick "Keep a Playbook for this product". *Expect:* a toast says the Playbook is
    off. Over MCP, as Sam: `playbook_read(action="index")`, `playbook_read(action="messages")` and an
    `playbook_write` each answer `409 playbook_off` and say an admin turns it on in Settings. So do
    `get_download`, `request_upload`, a GET under the download grant taken before, and an `apply`
    with the pending upload, whether its steps name only the ZIP's file or also one the ZIP lacks. Over MCP,
    as Riley, the same read as before gives no `playbook_messages_waiting`, though Riley's message is
    still unread. `products_read(action="get")` gives no `read_first`: its `playbook` is
    `enabled: false` with a `how` that says the product's admins turn it on in Settings and nothing
    in it is lost, naming none of the Playbook's tools;
    `story_read(action="guidance")` lists no Playbook files, and archiving and restoring a source that a
    file links to gives no `playbook_cited_by`. Tick it again. *Expect:* a toast says it is on, and
    every file is back at the revision and etag it had, and the pending upload applies, writing its
    file. Riley's read gives
    `playbook_messages_waiting: 1` again. Activity shows the message sent, and the Playbook turned off
    and on by Riley among the product's settings, each of those two entries opening Settings → Playbook.
16. **Web, as Sam, in the standard organization.** Open Settings → the product → Playbook. *Expect:* the
    same text, a note that only admins of this product turn it off or on, and the switch disabled.
17. **MCP, as Sam, at `--level viewer`, then as Jordan.** As Sam on a Read only connection, list
    the tools. *Expect:* `playbook_read` and no `playbook_write`. Reading the index and Sam's sent messages
    works, and so does `get_download`; `playbook_write(action="request_upload")` called anyway is refused `403
    connection_level`. As Jordan, a Story reader, on the unscoped connector and on one scoped to the product:
    *Expect:* no Playbook tool is listed, and `playbook_read(action="index")` called anyway is refused `403
    forbidden`, saying Jordan is a Story reader and it needs viewer, and so is `get_download`. `products_read(action="get")`
    gives Jordan no `playbook`.
18. **MCP, as Riley, then Sam, on an Admin connection.** As Riley at `--level admin`, purge the
    file moved in step 10 with `playbook_delete(action="purge")`: first without `confirm`, then with its
    etag, a reason and `confirm: "delete permanently"`. *Expect:* the first is refused `422`, naming
    what is missing. The second deletes it, and its history is gone too: reading the path, and its
    history, answer `410 playbook_file_deleted` with Riley's reason. Activity on the web shows "deleted from the Playbook",
    attributed to Riley. As Sam at `--level admin`: no `playbook_delete` is offered, and calling it
    anyway on another file made in the run is refused `403 forbidden` naming editor and admin, and
    the file stays.
19. **MCP, as Sam: the export.** `products_export(action="export")` on the product, then download
    it when it is ready. *Expect:* the ZIP holds `playbook/files/` with every file not removed, at its
    path, and `playbook/revisions.jsonl`, and no message. Its README or manifest says what each holds.
20. **The example organization, as a guest** (`guest@example.com`). Over MCP, read
    `playbook_read(action="index")` on a product of the example organization, then try `playbook_write` there.
    *Expect:* the index answers (the starter, or what the example's authors wrote). No `playbook_write`
    is offered; called anyway, a write, a message and `request_upload` are each refused `403
    example_read_only`. `get_download` gives a grant, and its ZIP downloads. On the web, Settings → the product
    → Playbook says it is the demo, to read, and the switch is disabled.
21. **The synthetic organization, as Morgan; the standard organization's Playbook from outside.** Over
    MCP as Morgan, read Crewboard's Playbook. *Expect:* the sample's files (a lesson, what is current, a
    person's page) and, for whoever it was sent to, a message waiting. As Morgan, call
    `playbook_read(action="index")` and `playbook_read(action="read")` of the lesson from step 4 on the standard
    organization's product. *Expect:* `404`, no such product visible, the same as any tool answers
    there, with no file named. As Sam, who reads only Crewboard's Story, `playbook_read` on Crewboard is refused, and
    no Playbook tool is offered on a connector scoped to Crewboard.

## Look out for

- An agent pointed at the Playbook when it is off, or not pointed at it when it is on: in the server's
  instructions, `products_read(action="get")`, each part's guidance, and the messages waiting (a
  count shown while it is off, with a message really waiting, or not shown again once it is on).
- A conflict that loses either person's text, or an `apply` that writes part of a change.
- A ZIP whose files or manifest differ from what `playbook_read` gives, or an `apply` from an upload
  that writes a file no step named.
- The starter copied in twice, or its etags changed by the copy, so that an agent's etag from
  before the first write turns stale.
- A message's text, or anything from the Playbook, shown in the web app, which shows only its
  Settings section and its activity.
- Activity naming a file as something other than its path, or not saying who wrote it through
  which agent.
- One organization's Playbook, or whether a file exists in it, reaching anyone outside it.
- Guidance in the guide, the starter or a tool's description that led the agent astray.
