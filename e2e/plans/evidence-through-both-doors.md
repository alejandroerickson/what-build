---
title: A source added by an agent is read, corrected and commented on by a person, and the reverse
organizations: [standard, example]
people: [sam, riley, guest]
surfaces: [web, mcp]
---

# Evidence through both doors

An agent and a person share one product. What the agent adds over MCP must appear for the person
on the web, its attachment read into the source's text and that text searchable; what the person
writes on the web, the text included, must be what the agent reads; an attachment beside the text
is kept and never searched; and the activity log must say who did what, through which door. Then
a guest of the example organization reads it and changes nothing, and the free plan's limits are
tried.

## Steps

1. **Run folder.** Write a short synthetic interview transcript as a text file in the run's
   folder: an interviewer and one crew lead named Dana, four or five turns, one of which mentions
   "the van checklist". Write a second short text file, the interviewer's notes on the call, that
   holds a made-up word (synthetic, such as "quorvel") and does not mention the van checklist.
   Search the product first to make sure neither phrase appears anywhere yet.
2. **MCP, as Sam, in the standard organization.** In a product that has sources, read the
   product's tags (`sources` `facets`), then create a source for the transcript, tagged as an
   interview with the tag the product already uses for interviews, with an upload
   (`attachments` `create_upload`), and PUT the file's bytes to the grant's URL with its headers.
   *Expect:* each step answers as the skill describes; the PUT answers `201` with the
   `attachment`, whose `note` says it is being read and will become the source's text, and that
   it is kept and never searched; no `complete_upload` is needed.
3. **Web, as Sam.** Open Evidence. *Expect:* the new source is listed with its title and tags;
   the panel's filters are Tags and Archived, with Added by only when more than one person has
   added sources (a fresh golden master shows Tags and Archived alone; Sam's source may bring Added
   by); opening the source shows its Text once the attachment has been read (the page updates by
   itself), with "Read from" naming the file, each turn starting with **Dana** or the interviewer
   in bold, and Attachments listing the file as read, with its length, as the source's text.
4. **Web, as Sam.** Search for "van checklist" from the panel's Search field. *Expect:* the source
   is found, and only it, saying the words are in its text; opening the hit shows its Text with
   the words marked, and the find field holding them, counting the matches ("1 of …") and stepping
   through them.
5. **Web, as Sam.** On the source, edit the text: correct one word in Dana's turn, then save. Open
   Comments and comment on the source, then add a summary under its title. *Expect:* the text
   now says it was written by Sam, just now, and keeps the correction; the comment is listed in Comments, on the
   whole source; the summary shows under the title, attributed to Sam. Then archive the comment
   from its menu, saying why, and restore it. *Expect:* archived, it leaves Comments, which offer
   "Show 1 archived comment"; that lists it muted, marked Archived, with when and why; Restore in
   its menu puts it back among the comments.
6. **MCP, as Sam.** Read the source (`sources` `get` with `detail: "full"`), its comments, its
   summary (`derived` `read_note`) and its text (`derived` `text`). Then `search` for the
   corrected word, and read the text around the hit with `derived(action="text")` from a little
   before its `char_start`. *Expect:* `derived_status` is `ready` and `text.taken_from` is null,
   and `warnings` says the text was written or edited, so it follows no attachment and the
   transcript's own reading is kept but never searched;
   the comment from step 5, attributed to Sam on the web; the summary as Sam wrote it; the text
   with Sam's correction and its speakers in bold; the hit names `field: "text"`, and the window
   around it holds the corrected word.
7. **MCP, as Sam.** Upload the notes file as a second attachment of the same source
   (`attachments` `request_upload`, then the PUT). Once it is read, `search` for the made-up word,
   then read what was read from it with `derived(action="text", path=…)`. *Expect:* the upload's
   note says the source already has a text, so this one is kept beside it and never searched;
   search finds nothing, and its `coverage` says "Attachments are never searched."; the
   attachment's own text holds the made-up word, and `sources(action="get")`'s `warnings` names
   both files as text the source's text does not use. On the web, Attachments lists both files,
   neither marked as the source's text, since Sam edited it in step 5, under a line saying the
   source's text was written here and follows no attachment.
8. **MCP, as Sam.** Write the made-up word into the source's text with
   `derived(action="write_text")` and `edits`, passing the etag from step 6 as `expected_etag`;
   then again with the same old etag. *Expect:* the first answers with a new etag and a short
   `diff`; the second is refused with `409 stale_etag`, and nothing changed. `search` for the
   made-up word now finds the source, in `text`. Then rewrite the summary with
   `derived(action="write_note", note_kind="summary")`, first without `expected_etag`, then with
   the source's own etag as `sources(action="get")` gives it now (step 7's upload moved it on from
   step 6's), then with the etag `read_note` gave in step 6. *Expect:* the first two are refused
   with `409 stale_etag` and `current_etag`, the first saying to read the summary and pass its
   etag, the second that it is the source's etag; the third answers with a new etag, and the web
   shows the new summary under the title.
9. **Web, as Sam.** Create a second source through the upload flow on the web, with a title and
   tags, and a short synthetic file in its one drop zone for attachments. *Expect:* it is created
   with no role to choose, read and listed, and its Text shows the file's words.
10. **MCP, as Sam.** Search for a phrase from that file. *Expect:* found, in the right source, in
    field `text`.
11. **Web, as Sam.** Open Activity. *Expect:* entries for both sources, the attachments, the text
    edits and the comment, each saying who did it and whether it came from the web or from an
    agent; reading each attachment is WhatBuild's, "on the server", never "in the app", and reads
    "Read the text of <file>" without a parser's label; the comment reads "Added a comment", and
    archiving and restoring it read "archived a comment on" and "restored a comment on" the
    source, without the reason.
12. **MCP, as Sam.** Update the first source's title with an `expected_etag` from before the last
    change (read the source, change it once, then change it again with the old etag). *Expect:*
    the second write is refused with `409 stale_etag`, and nothing changed.
13. **Web, as Sam.** Archive the second source, then find it among archived sources and restore it.
    *Expect:* archiving is reversible, and the words used are archive and restore, never delete.
14. **The example organization, as a guest.** Over MCP as `guest@example.com`, find the same
    product in the example organization, read a source and search it; then try steps 2 and 3 there
    (create a source, request an upload) and an export. Check that nothing from steps 2 to 13
    appears in the example organization. *Expect:* reads and search work; every write and the
    export are refused with `403 example_read_only`, naming how to create an organization of one's
    own, and nothing changed; the two organizations stay separate.
15. **The free plan, as Riley and then Sam.** As Riley, on Organizations, put the standard
    organization on the free plan with Exports set to 0, and save. As Sam, read
    `products(action="limits")` for it over MCP, then export the product, then open Plan and limits
    from the account menu in the web app. Then sign in to the web app as `guest@example.com`, open
    the account menu, and go to the example organization's `/t/<slug>/limits`. *Expect:* the limits
    say the plan is free and that Sam meets them, with what Sam used today; the export is refused
    with `403 plan_restricted`, saying exporting is off on the plan; reading and search still work.
    Sam's page says in words what Sam used of each allowance today, under You and under Everyone in
    the organization (changes as "N of 500"), Exports as off on this plan, and what Sam can add, with
    no refusal codes, no limit on calls a minute and no settings. The guest's account menu lists
    nothing for the example organization, and its page says they have no allowances there. As
    Riley, put the organization back on the unlimited plan with the free plan's limits.

## Look out for

- A source that stays "Reading its attachment" for more than a few seconds.
- A text laid out oddly: a turn cut in two, a speaker lost, or a table broken into lines.
- Search finding the second attachment's words before they were written into the text, or a hit
  that opens the wrong section or marks the wrong words.
- Attribution that says web for something the agent did, or the reverse.
- Anything that leaks between the two organizations.
