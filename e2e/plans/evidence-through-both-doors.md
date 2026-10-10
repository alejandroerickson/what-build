---
title: A source added by an agent is read and annotated by a person, and the reverse
organizations: [standard, sandbox]
people: [sam]
surfaces: [web, mcp]
---

# Evidence through both doors

An agent and a person share one product. What the agent adds over MCP must appear, parsed and
searchable, for the person on the web; what the person adds on the web must be what the agent
reads; and the activity log must say who did what, through which door. Then the same is tried in
the sandbox, where the sandbox's limits apply.

## Steps

1. **Run folder.** Write a short synthetic interview transcript as a text file in the run's
   folder: an interviewer and one crew lead named Dana, four or five turns, one of which mentions
   "the van checklist". Search the product first to make sure the phrase appears nowhere yet.
2. **MCP, as Sam, in the standard organization.** In a product that has sources, read the
   product's tags (`sources` `facets`), then create a source for the file, tagged as an interview
   with the tag the product already uses for interviews, with an upload (`files.create_upload`), PUT the file's
   bytes to the grant's URL with its headers, and complete the upload. *Expect:* each step answers
   as the skill describes, and the completion's note says the primary is being parsed or is ready.
3. **Web, as Sam.** Open Evidence. *Expect:* the new source is listed with its title and tags;
   opening it shows its passages, one per turn, with Dana as a speaker, once parsing has finished
   (the page updates by itself).
4. **Web, as Sam.** Search for "van checklist". *Expect:* the passage from step 1 is found, and only
   it.
5. **Web, as Sam.** Select that passage and comment on it. *Expect:* the comment is saved and shown
   on the passage.
6. **MCP, as Sam.** List the source's annotations, and read the passage with `read_passage`.
   *Expect:* the comment from step 5, attributed to Sam on the web; the passage text is exactly
   what the file said.
7. **Web, as Sam.** Create a second source through the upload flow on the web, with a title and tags, with
   another short synthetic file. *Expect:* it is created, parsed and listed.
8. **MCP, as Sam.** Search for a phrase from the second file. *Expect:* found, in the right source.
9. **Web, as Sam.** Open Activity. *Expect:* entries for both sources and the comment, each saying
   who did it and whether it came from the web or from an agent; parsing each file is WhatBuild's,
   "on the server", never "in the app"; the comment names its passage as ¶N.
10. **MCP, as Sam.** Update the first source's title with an `expected_etag` from before the last
    change (read the source, change it once, then change it again with the old etag). *Expect:* the
    second write is refused with `409 stale_etag`, and nothing changed.
11. **Web, as Sam.** Archive the second source, then find it among archived sources and restore it.
    *Expect:* archiving is reversible, and the words used are archive and restore, never delete.
12. **The sandbox organization, as Sam.** Repeat steps 2 to 4 in the same product there. Then
    check that nothing from steps 2 to 11 appears in the sandbox organization, nor anything from the
    sandbox in the standard one. *Expect:* the upload works within the sandbox's limits (read them
    with `sandbox(action="status")`), and the two organizations stay separate.
13. **The sandbox organization, as Sam.** Try what the sandbox's settings forbid, for example
    exporting the product or fetching a URL into a source, if the status says they are off.
    *Expect:* refused with an error that names the sandbox's limit; the same action is allowed in
    the standard organization.

## Look out for

- A source that stays "parsing" for more than a few seconds.
- Passages split oddly: a turn cut in two, or a speaker lost.
- Attribution that says web for something the agent did, or the reverse.
- Anything that leaks between the two organizations.
