---
title: A source added by an agent is read, corrected and commented on by a person, and the reverse
organizations: [standard, sandbox]
people: [sam]
surfaces: [web, mcp]
---

# Evidence through both doors

An agent and a person share one product. What the agent adds over MCP must appear for the person
on the web, its attachment read into the source's text and that text searchable; what the person
writes on the web, the text included, must be what the agent reads; an attachment beside the text
is kept and never searched; and the activity log must say who did what, through which door. Then
the same is tried in the sandbox, where the sandbox's limits apply.

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
   opening it shows its Text once the attachment has been read (the page updates by itself), with
   "Read from" naming the file, each turn starting with **Dana** or the interviewer in bold, and
   Attachments listing the file as read, with its length, as the source's text.
4. **Web, as Sam.** Search for "van checklist" from the panel's Search field. *Expect:* the source
   is found, and only it, saying the words are in its text; opening the hit shows its Text with
   the words marked, and the find field holding them, counting the matches ("1 of …") and stepping
   through them.
5. **Web, as Sam.** On the source, edit the text: correct one word in Dana's turn, then save. Open
   Comments and comment on the source, then add a summary under its title. *Expect:* the text
   now says it was written by Sam, just now, and keeps the correction; the comment is listed in Comments, on the
   whole source; the summary shows under the title, attributed to Sam.
6. **MCP, as Sam.** Read the source (`sources` `get` with `detail: "full"`), its comments, its
   summary (`derived` `read_note`) and its text (`derived` `text`). Then `search` for the
   corrected word, and read the text around the hit with `derived(action="text")` from a little
   before its `char_start`. *Expect:* `derived_status` is `ready` and `text.taken_from` is null;
   the comment from step 5, attributed to Sam on the web; the summary as Sam wrote it; the text
   with Sam's correction and its speakers in bold; the hit names `field: "text"`, and the window
   around it holds the corrected word.
7. **MCP, as Sam.** Upload the notes file as a second attachment of the same source
   (`attachments` `request_upload`, then the PUT). Once it is read, `search` for the made-up word,
   then read what was read from it with `derived(action="text", path=…)`. *Expect:* the upload's
   note says the source already has a text, so this one is kept beside it and never searched;
   search finds nothing, and its `coverage` says "Attachments are never searched."; the
   attachment's own text holds the made-up word. On the web, Attachments lists both files, and
   only the transcript is marked as the source's text.
8. **MCP, as Sam.** Write the made-up word into the source's text with
   `derived(action="write_text")` and `edits`, passing the etag from step 6 as `expected_etag`;
   then again with the same old etag. *Expect:* the first answers with a new etag and a short
   `diff`; the second is refused with `409 stale_etag`, and nothing changed. `search` for the
   made-up word now finds the source, in `text`. Then rewrite the summary with
   `derived(action="write_note", note_kind="summary")`, first without `expected_etag`, then with
   the source's own etag, then with the etag `read_note` gave in step 6. *Expect:* the first two
   are refused with `409 stale_etag` and `current_etag`, the first saying to read the summary and
   pass its etag, the second that it is the source's etag; the third answers with a new etag, and
   the web shows the new summary under the title.
9. **Web, as Sam.** Create a second source through the upload flow on the web, with a title and
   tags, and a short synthetic file in its one drop zone for attachments. *Expect:* it is created
   with no role to choose, read and listed, and its Text shows the file's words.
10. **MCP, as Sam.** Search for a phrase from that file. *Expect:* found, in the right source, in
    field `text`.
11. **Web, as Sam.** Open Activity. *Expect:* entries for both sources, the attachments, the text
    edits and the comment, each saying who did it and whether it came from the web or from an
    agent; reading each attachment is WhatBuild's, "on the server", never "in the app", and reads
    "Read the text of <file>" without a parser's label; the comment reads "Added a comment".
12. **MCP, as Sam.** Update the first source's title with an `expected_etag` from before the last
    change (read the source, change it once, then change it again with the old etag). *Expect:*
    the second write is refused with `409 stale_etag`, and nothing changed.
13. **Web, as Sam.** Archive the second source, then find it among archived sources and restore it.
    *Expect:* archiving is reversible, and the words used are archive and restore, never delete.
14. **The sandbox organization, as Sam.** Repeat steps 2 to 4 in the same product there. Then
    check that nothing from steps 2 to 13 appears in the sandbox organization, nor anything from
    the sandbox in the standard one. *Expect:* the upload works within the sandbox's limits (read
    them with `sandbox(action="status")`), and the two organizations stay separate.
15. **The sandbox organization, as Sam.** Try what the sandbox's settings forbid, for example
    exporting the product or fetching a URL into a source, if the status says they are off.
    *Expect:* refused with an error that names the sandbox's limit; the same action is allowed in
    the standard organization.

## Look out for

- A source that stays "Reading its attachment" for more than a few seconds.
- A text laid out oddly: a turn cut in two, a speaker lost, or a table broken into lines.
- Search finding the second attachment's words before they were written into the text, or a hit
  that opens the wrong section or marks the wrong words.
- Attribution that says web for something the agent did, or the reverse.
- Anything that leaks between the two organizations.
