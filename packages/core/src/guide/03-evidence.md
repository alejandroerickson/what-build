# Evidence: sources, attachments and their text

Sources and their attachments, getting files in, the derived text, summaries, notes, comments, finding and moving sources.

## Sources

A **source** is one piece of evidence: an interview, a call, a document, a deck, an export. It has a
title, a date, tags, attachments, one derived text, a summary, notes and comments. Sources have no
kind, organization, folder, participants, source system or provenance field: a call that sends one
is refused.

- `sources_read(action="facets")` gives the tags the product already uses, most used first, and the
  people who added sources.
- `sources_write(action="create")` creates a source with no attachment.
  `attachments_write(action="create_upload")` creates a source and returns an upload grant in one
  call; `create_uploads` does the same for up to 20 sources at once.
- `sources_read(action="get")` gives a source's details, its `derived_status`, `text_from` (the
  attachment its text came from) and `warnings`.

## Getting files in

A source's files are its **attachments**. File bytes, or base64 of them, never go in a tool call.
The ways in:

1. **An upload grant.** `attachments_write(action="request_upload")` returns `url`, `method: "PUT"`,
   `headers`, `max_bytes` and `expires_at` (`create_upload` returns them under `upload`, beside the
   new source's `record`). Send the file in exactly one request, with every header given:

       curl -sS -X PUT --data-binary @interview.docx \
         -H "X-WhatBuild-Upload-Grant: <token>" -H "Content-Type: <type>" "<url>"

   A `201` means the attachment is added; its `attachment.note` says what becomes of its text, and
   there is nothing more to call. If the file exceeds `max_bytes` and the grant has a `direct` block,
   PUT to `direct.url` with `direct.headers` instead, then call
   `attachments_write(action="complete_upload", params={"record_id": …, "path": …})`. A grant takes
   one file, once, and expires. Grant headers are credentials.
2. **A public HTTPS document:** `attachments_write(action="fetch_url")`.
3. **Words, not a file:** create the source and write its text with
   `derived_write(action="write_text", params={"record_id": …, "content": "…"})`.

The web app uploads files too, for an agent that cannot reach the upload URL.

Uploading to a path the source already has adds a new version of that attachment and keeps the
earlier ones. An attachment cannot be removed or renamed.
`attachments_read(action="get_download")` gives a short-lived grant to download an attachment.

**Intake warnings.** The grants (`request_upload`, `create_upload`, `create_uploads`) warn, before
any bytes move and without refusing, about a format no parser reads and about an image.
`create_upload`, `create_uploads` and `sources_write(action="create")` warn about a source with the
same title and date. `fetch_url` warns about a URL's `#fragment`, which never reaches the server. An
upload's own answer has no warnings: its `attachment.note` says what becomes of the text.

## What is read from a file

Every attachment's text is read and kept with the source. The source's **derived text** is the text
of the first of its attachments whose reading finds text, in the order they arrived. Search reads the
derived text, never the attachments: a second attachment's words are found only once they are in the
text, the summary or the notes, and `sources_read(action="get")` names such an attachment in its
`warnings`.

`sources_read(action="get")` shows `derived_status`: `ready`, or why there is no text
(`needs_transcript`, `unsupported`, `too_large`, `failed`).

- A recording is stored and playable but never transcribed: it has no text until its transcript is
  added as another attachment.
- An image, or a PDF whose pages are pictures (a scan), is kept and shown, but no words are read from
  it: its status is `unsupported`, and reading it again changes nothing. Its words can be written as
  the derived text with `write_text`.
- Over 25 MB an attachment is stored but not read.
- No parser reads .pptx or .key; a deck reads as its PDF export.

## The derived text

The derived text is the source's words as one Markdown document: what people read on its page, what
search reads, and what `derived_read(action="text")` returns, in windows of up to 20,000 characters
by code-point `offset` and `limit` (`total_chars` and `truncated` say how much there is).
`derived_read(action="text", path=…)` reads what was read from one attachment. How files read:

- Headings stay headings; paragraphs, numbered items and tables stay as they were. A PDF has a
  `# Page N` heading for each page; a spreadsheet is a table for each sheet, its first column the
  sheet's row number.
- In a PDF, a heading set larger than its text reads as a heading under the page's (`## Findings`),
  a label beside its value as `Samples: 79`, other cells of a line apart (` · `). A header or footer
  repeated on most pages is read once, where it first appears, and page numbers are left out;
  `facts.headers_and_footers` in `derived_read(action="manifest")` lists them.
- A text file keeps its lines and list markers; only prose wrapped to a width is joined.
- A spreadsheet's values read as the sheet shows them (`+14.0%`, not `0.14`); hidden sheets, columns
  and rows are read and marked `(hidden)`; a formula saved without its value reads
  `=SUM(B2:B3) (no stored value)`.
- A transcript says who spoke and when: `**Dana** (12:05): words` in a timed one, where a speaker's
  consecutive cues run on as one paragraph, and `**Dana:** words` in an untimed one. A text, Markdown
  or Word file reads as a transcript when most of its lines (paragraphs, in Word) are turns
  (`Name: words`). A text or Markdown file is one also when its turns start with a label and a time
  on a line of their own (`Dana (14:02 UTC):` or `[14:02] Dana:`, in Markdown also
  `**Dana** (14:02 UTC):`), at least four of them, most by names that speak more than once. A Word
  file takes no such labels.
- A Markdown attachment is kept as written.

The derived text **follows its attachment**: a new version of that attachment replaces it, until
someone writes or edits it. From then it is theirs, and new readings never touch it.

`derived_write(action="write_text")` takes exactly one of `content` (the whole text; empty removes it,
until the next reading of an attachment with text fills it again), `edits` (exact replacements) or
`from_attachment` (an attachment's path, to take the text read from it). Once the source has a
derived text, every write takes the text's own etag as `expected_etag` (from
`derived_read(action="text")`, or `text.etag` in `sources_read(action="get", detail="full")`; not the
source's etag). It is left out only for the first text, while `derived_read(action="text")` answers
`404`. People edit the text in the app too.

A reading keeps the layout of the parser version that made it (`parser_version` in
`derived_read(action="manifest")`). `derived_write(action="rederive")` reads an attachment again with
the current parser; it is done when `manifest` shows a `derivation_id` other than the
`previous_derivation_id` it returned.

## Summary, notes and comments

- The **summary** (`derived_write(action="write_note", note_kind="summary")`) heads the source's page
  and shows in the Evidence list. It is searched like the rest of the source.
  `sources_read(action="list", include_summary=true)` shows the summaries, and which sources lack one.
- The **notes** (`note_kind="notes"`) are freeform Markdown below it.
- People edit both in the app. The first summary or notes take no etag; after that, a write takes the
  etag `derived_read(action="read_note")` returns (or `agent_notes` in
  `sources_read(action="get", detail="full")`). Without it, with a stale one, or with the source's own
  etag, the write is refused (`409 stale_etag`, with `current_etag`).
- A **comment** is a remark on the whole source, for the team: `sources_write(action="annotate")`.
  `sources_read(action="list_annotations")` reads them, and `sources_write(action="update_annotation")`,
  with the comment's etag, edits one or archives it with an `archive_reason`.

## Finding sources

`sources_read(action="list")` finds sources by their details, never their text: `tags` (a source must
carry all of them), `added_by` (an `account_id` from `facets`; what an agent adds counts as its
person's), `added_since` (a date or a time), `date_from` and `date_to` (the source's own date), and
`query` (words in the title, tags or attachment names). `search` reads what sources say
(`guide(topic="search")`).

## Moving between products

`sources_write(action="copy_to_product")` copies a source, with its attachments and its derived text,
into another product in the same team, with a new id and a `copied_from` link; its summary, notes and
comments stay behind. `sources_write(action="move_to_product")`, with the source's etag, keeps the
id, and its attachments, text, summary, notes and comments go with it; a link to it from the product
it left stops opening.
