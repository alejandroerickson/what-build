---
type: Specification
title: Every attachment is read into readable Markdown and kept, and each source has one derived text that people and agents read, edit and search.
description: Reading attachments (when a reading runs, its thread and limits, what it stores, its statuses), the parsers and how they lay text out, the derived text and how it follows its attachment, and the reads and writes of the derived layer.
tags: [spec, derived-layer, parsers, derived-text, attachments]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# 5. The derived layer

A source's words are one **derived text**: a Markdown document that people read on the source's
page, agents read in windows, both can correct, and search reads ([§8](08-search.md),
[decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
It is usually taken from one of the source's attachments ([§4.5](04-data-model.md)): every version
of every attachment is **read** when it arrives, into readable Markdown that is kept with it, and
never searched. Parsers are in [`packages/parsers/src`](../../packages/parsers/src); reading an
attachment, the derived text and their operations are in
[`packages/core/src/ops/derived.ts`](../../packages/core/src/ops/derived.ts).

## 5.1 Reading an attachment

A **reading** (a `derivation` on the wire, identified by a `derivation_id`) is one immutable read of
one version of one attachment. Every version of every attachment is read: when the attachment is
added, when a new version arrives at its path, when a source is copied to another product (its
attachments are read afresh there), and when `derived.rederive` asks for it (for example after a
parser upgrade). Earlier readings are retained and readable by id. `rederive` returns
`previous_derivation_id`; the attachment's latest reading stays in place until the new one
finishes, so a caller knows it is done when `derived.manifest` for that attachment reports a
different `derivation_id`.

**Where it runs.** Always on the Postgres job queue, in the worker
([`apps/server/src/worker.ts`](../../apps/server/src/worker.ts)), in every environment. The
transaction that adds the attachment enqueues the job, and the worker wakes after the commit. The
upload response is never held while a file is read, and a slow PDF cannot occupy a request. Reading
inline in the request would be an observable behavior difference and is forbidden
([§1.5 rule 12](01-product.md)). A reading's row is written only when it finishes, so until then
the attachment's text status is `pending` (§5.5).

The activity log records each outcome under the system actor (WhatBuild, client `parser`):
`derived`, "Read the text of interview.vtt", with "; it is the source’s derived text" when its text
became the source's; or `derivation_<status>`, "Could not read the text of deck.key: unsupported".
A reading the system asks for itself (after a migration, or after a public sandbox's reset) records
nothing.

**Each reading has a thread and limits of its own**
([decision](../decisions/each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits.md)).
The worker hands the file's bytes to a new worker thread
([`parse-thread.ts`](../../apps/server/src/parse-thread.ts)), which parses them into the readable
Markdown and returns its bytes, so the server keeps answering requests while any file is read. The
thread's JavaScript heap is held to `WHATBUILD_PARSE_MEMORY_MB` (384 MB by default), the buffers it
holds outside the heap to half as much again, and its run to `WHATBUILD_PARSE_TIMEOUT_SECONDS`
(120 by default). A parse past any of them is stopped, and its reading is `failed` with the limit
and its value in `status_detail`. A job is tried at most five times, counting the times the process
stopped while running it; a reading whose job stopped the process all five times is given up and
recorded as `failed` with parser `none`, and `rederive` tries once more.

A reading, the derived text it becomes (§5.4) and that text's pieces in the search index
([§8.3](08-search.md)) are written in one transaction, so search never finds words the source's
text no longer holds.

## 5.2 What a reading stores

A row in `derivations`, and two immutable blobs under
`t/<tenant_id>/r/<record_id>/d/<derivation_id>/` ([§4.15](04-data-model.md)).

### `text.md`

The readable Markdown (§5.3), ending with one newline; empty when the reading is not `ready`. Its
length in code points is the reading's `text_chars`.

### `manifest.json`

```json
{
  "derivation_id": "01J…", "record_id": "01J…",
  "parser": "webvtt", "parser_version": "2",
  "source_path": "call.vtt", "file_version_id": "01J…",
  "char_count": 58211, "duration_ms": 3540000,
  "facts": { "inverted_cues": 0 },
  "status": "ready", "status_detail": null,
  "created_at": "2026-09-19T17:02:11Z",
  "inference": "none"
}
```

`duration_ms` is the last cue end for a timed transcript (VTT, SRT) and, for a recording, its
playing time read from the container headers without decoding audio: MP4, M4A and MOV (`mvhd`),
WAV, FLAC and MP3 (a Xing, Info or VBRI frame count, else the constant bitrate). It is null for
other files and for a container that cannot be read. A recording over the parse cap is not
downloaded; only the byte ranges holding those headers are read.

`facts` holds format-specific counts (pages and text-layer characters for PDF; tables, tracked
changes and comments for DOCX; `doc_format` and tables for DOC; sheets for XLSX; rows and the
delimiter for CSV; skipped cues for VTT and SRT; `transcript_turns` for a text, Markdown, DOCX or DOC
file read as a transcript). `inference: "none"` states that no model produced or altered the text.

Readings made while sources had passages also hold a `segments.jsonl`, which nothing reads any
more; a product export includes it ([§4.14](04-data-model.md)).

## 5.3 Parsers, and how the text is laid out

A parser is chosen by file extension, falling back to the media type when the name has no known
extension ([`packages/parsers/src/index.ts`](../../packages/parsers/src/index.ts)). It reads a file
into paragraphs, headings, turns and table rows, and those are laid out as one Markdown document
([`markdown.ts`](../../packages/parsers/src/markdown.ts)):

- Paragraphs are separated by a blank line, and the text ends with one newline.
- **Headings stay headings**, as `#` to `######`, at levels that agree across formats: a Markdown
  `#` title and a DOCX Title are level 1, and the sections under them (`##`, or Heading 1 below a
  Title) level 2. A PDF has a `# Page N` heading before each page's text, and a workbook a
  `# Sheet: <name>` heading before each sheet.
- **A timed transcript** (VTT, SRT) says who spoke and when in the text: a turn is
  `**Dana** (12:05): words`, its time `m:ss`, or `h:mm:ss` from an hour on. A speaker's consecutive
  cues run on as one paragraph until it holds about 1,200 characters; the next cue then opens a
  paragraph of its own, with its own time. A cue that names no speaker is `(12:05) words`. Inverted
  cues (end before start) are skipped and counted in `facts`.
- **An untimed transcript** (plain text, DOCX, DOC; below) labels a turn `**Dana:** words`; the
  later paragraphs of the same turn are not labelled again.
- **A table** of two or more rows (DOCX, DOC, HTML, a pipe table in plain text) is one GitHub pipe
  table under its first row, as wide as its widest row, each cell's spacing collapsed and its `|`
  escaped. A table of one row is a paragraph of its cells joined with ` | `.
- **A workbook** (XLSX, and CSV and TSV, read as a one-sheet workbook) is one table per sheet from
  its header row on (the first all-text row with two or more cells in the top 20): its first
  column, `Row`, is the sheet's row number, and the others are the header's labels, or the
  column's letter where the header has none. Rows above the header stay paragraphs, prefixed
  `[<Sheet>, row N]` (`[row N]` in a CSV). A sheet with no header row is one table whose columns
  are named by their letters.
- **A Markdown file is kept as written:** its own text is the readable text, with line endings
  made plain, a byte-order mark dropped and one closing newline. It is still parsed as plain text
  is, for the checks and facts below.
- A speaker's name is escaped where Markdown would read it as markup.

| Format | Notes |
|---|---|
| Plain text (`.txt`, `.text`) | Paragraphs split on blank lines; ATX headings stay headings; each list item (`-`, `*`, `+`, `1.`) is its own paragraph, a numbered item keeping its number (`1.`) and a bullet dropping its marker; pipe tables become tables. A transcript is read turn by turn with its speakers (below). |
| Markdown (`.md`, `.markdown`) | Kept as written. Parsed as plain text is, plus setext headings, with blockquote markers, thematic breaks and inline emphasis and code markers set aside, so `**Name:** words` is a speaker turn and `**Name** (14:02 UTC):` on a line of its own a timed label (below). |
| WebVTT, SRT | Cue timing; speakers from `<v Name>` voice tags and from `Name:` prefixes; caption markup stripped. |
| DOCX | Headings (a Title above Heading 1), paragraphs, tables, the accepted view of tracked changes (insertions kept, deletions dropped), and reviewer comments under `# Review comments`, each `Author: words`. A paragraph in a decimal Word list (numbered directly or by its style) starts with its number as Word counts it (`2.`, `1.1.`); bullets and other number formats (letters, roman numerals) get no marker. `Name: words` paragraphs, including a bold `Name:` run, are speaker turns in a transcript (below). |
| DOC (`.doc`, `application/msword`) | The format is read from the file's first bytes, never from its name, and the `doc_format` fact records it. A **Word binary document** (an OLE2 compound file) from Word 97-2003 (`word97`), or from Word 6.0 or Word 95 (`word6`), gives its main text through the piece table, with 8-bit Windows-1252 and UTF-16 pieces: one paragraph per paragraph, built-in heading styles (Title, Subtitle, Heading 1-9) as headings at DOCX's levels, tables as tables, field results kept and field codes dropped, page and section breaks as paragraph breaks, and `Name: words` paragraphs as speaker turns in a transcript. Word 97 tables come from the paragraphs' table flags; Word 6 tables are inferred from cell marks, the first row setting the width. Headers, footnotes, comments and list numbers are not read. Encrypted documents, fast-saved Word 6 and Word 95 documents and Word 2 and older documents fail with the reason. A **DOCX package** under a `.doc` name is read by the DOCX parser (`docx`); a **MIME HTML** file (Word's "Web Page" save, wiki Word exports) has its first `text/html` part, quoted-printable or base64, read by the HTML parser (`mhtml`); **plain HTML** is read by the HTML parser in the character set its `<meta>` declares (`html`). Rich Text Format and anything else fail with the reason, as does HTML with no readable text. |
| XLSX | Sheets and rows, laid out as above. A number whose cell format is a date or time (the built-in formats 14–22 and 45–47, or a custom format with day, month, year, hour or second codes outside quotes and brackets) renders in ISO 8601: `2026-04-10`, `2026-04-10 12:00`, `13:30`, or elapsed hours `30:00:00`, in the workbook's 1900 or 1904 date system. Other numbers keep their stored value, not their displayed format. |
| CSV, TSV (`.csv`, `.tsv`) | Read like a one-sheet workbook, with the same header rule. Quoted fields may hold delimiters and line breaks; the delimiter (comma, semicolon or tab) is taken from the first line. |
| PDF | Text layer only, page by page, for a PDF of at most 2,000 pages; a page's lines are joined into paragraphs that end at sentence punctuation. No OCR; images are never decoded. |
| HTML | Main-content text with headings; scripts, styles, navigation, forms and frames dropped; tables as tables; adjacent elements (labels, breadcrumbs) kept apart by a space. A page that nests elements more than 512 deep, or would make far more elements than it has tags, fails with the reason. |

**Untimed transcripts.** Plain text, Markdown, DOCX and DOC share one rule
([`speakers.ts`](../../packages/parsers/src/speakers.ts)), so a transcript reads the same whatever
it was saved as. A file is a transcript when it has at least four lines (paragraphs, for DOCX and DOC), at
least 60% of them are `Name:` turns (a capitalised name of up to 41 characters, or a bracketed
label, optionally after a timestamp), and at least half of those turns come from a name that speaks
more than once. The last condition keeps field lines such as `Project:`, `Date:` and `Location:`, and
an occasional `Note:`, as prose. A short aside in brackets may stand between the name and the colon,
`Dana (14:02 UTC): words`; the aside is dropped and the speaker is `Dana`.

Plain text and Markdown also read a transcript whose turns start with a **timed label on a line of
its own**, the words in the paragraphs below it: `Dana (14:02 UTC):` (in Markdown also
`**Dana** (14:02 UTC):`) or `[14:02] Dana:`. The name may say what the speaker is, with a comma:
`Sam, agent (14:03 UTC):`. The time, in the aside or before the name, is required, so a line such as
`Attendees:` is never taken for a label. A file is read this way when it has at least four such
labels and at least half of them are by a name that recurs. Each paragraph and list item after a
label then belongs to that speaker, until the next label, an inline turn, a heading or a thematic
break. In such a file an inline `Name: words` line is a turn only when `Name` is one of the labels'
speakers, so a line like `Decision: ship it` inside a turn stays that speaker's words. (A Markdown
file keeps its own text; the speakers count in its facts.)

- No speech-to-text and no OCR in the product. A recording is stored and playable, never
  transcribed: its transcript is another attachment, or the source's derived text written by an
  agent with its own transcription tool.
- Parsers are pure functions of bytes → readable Markdown (`derive`, then `toParsedFile` for the
  bytes a reading stores), with no I/O (the recording-duration reader
  takes a byte-range callback, so the worker can serve it ranges of a stored file), and never throw for a bad file:
  every outcome is a status. They bound what a file can make them do: unpacked bytes count against
  the parse cap, nesting and paragraphs are capped, and text is read in time linear in its length
  (patterns that could backtrack run as single passes, tested against the patterns they replace).
  They have fixture and hostile-file tests
  ([`packages/parsers/test`](../../packages/parsers/test)); golden-file tests for each format are
  planned. A parser change that alters its output, the layout included, MUST bump
  `parser_version`. No native
  dependencies: the image stays small, cold starts stay fast, and `pnpm install` cannot fail on a
  contributor's toolchain. They keep to TypeScript that erases, because Node loads them in the
  parse thread from source in development and tests.

## 5.4 The derived text

A source has at most one derived text (`source_texts`, [§4.15](04-data-model.md)): Markdown, with
its length in code points (`chars`), an `etag` of its own, who wrote it last and when
(`updated_by`, `updated_at`; WhatBuild, client `parser`, when a reading wrote it), and the
attachment version it is the text of (`from_file_version_id`, read as
`taken_from: { path, file_version_id }`), which is null once someone has written or edited it.

**It follows its attachment.** When a reading finishes `ready` with some text:

- a source with no derived text takes the reading's text as its own;
- a source whose derived text is still the text of a version of that same attachment takes the
  new reading's text in its place;
- any other source keeps its text: one someone wrote or edited, or one taken from another
  attachment. The reading is kept beside it.

So a source's text is taken from the first attachment whose text can be read, follows that
attachment through new versions and readings, and stops following it once someone writes it. A
reading that is not `ready`, or holds no text, never touches it.

**Writing it.** `derived.write_text { record_id, content | edits | from_attachment, expected_etag? }`
(`PUT …/sources/:record_id/derived/text`, editor; people use it in the app) takes exactly one of:

- `content`: the whole text, Markdown, at most 2,000,000 code points (`422 too_long`, which
  suggests uploading it as an attachment and taking its text). Empty content removes the text.
- `edits`: up to 20 exact replacements `{ field?, old_text, new_text }` (`field` is `text`, the
  only one), applied in order, each matching exactly once, as `assumptions.update`'s do
  ([§4.1](04-data-model.md)). `404` when the source has no text to edit. The result adds a `diff`.
- `from_attachment`: an attachment's path, to take the text of its latest reading of its current
  version, which the text then follows again; `404` for a path the source does not have, and
  `409 no_text` while the attachment is being read or when it was read as anything but `ready`. A
  text taken this way is not held to the 2,000,000.

None, or more than one, is `422 invalid_input`. `expected_etag` is optional; a stale one, or one
sent when the source has no text, is `409 stale_etag`. An archived source refuses it
(`409 record_archived`). It answers `{ record_id, chars, etag, updated_at, taken_from, diff? }`,
writes the text's pieces into the search index in the same transaction, and records `text_written`
in the activity log: "Wrote the derived text", "Rewrote the derived text", "Edited the derived
text", "Removed the derived text" or "Took the derived text from interview.vtt". The text keeps no
revisions; what each attachment was read as stays readable (below).

**Reading it.** `derived.text { record_id, offset = 0, limit ≤ 20,000, path?, derivation_id? }` reads
one window by code-point offset:

- Without `path` or `derivation_id`, the derived text:
  `{ record_id, of: "derived_text", offset, total_chars, truncated, text, etag, updated_at,
  updated_by, taken_from }`. A source with none answers `404`, pointing at its `derived_status` and
  at `write_text`. A search hit's `char_start` and `char_end` in field `text` are offsets into it
  ([§8.1](08-search.md)).
- With `path` (that attachment's latest reading of its current version) or `derivation_id` (any
  reading, exactly as it was): what was read from the attachment,
  `{ record_id, of: "attachment", path, derivation_id, file_version_id, status, offset,
  total_chars, truncated, text }`, its text empty when the reading is not `ready`. An attachment
  not read yet answers `404`. An attachment's text is kept, never searched.

Offsets and lengths are Unicode code points, not UTF-16 units and not bytes, and a window never
splits a character; implementations MUST test this with astral-plane characters. `truncated` says
more follows: page with consecutive offsets. A `limit` over 20,000 is refused (`422`), never
clipped. Sent `start`, `end` or `unit`, `derived.text` refuses them with a hint that it reads by
offset and that there are no passages to read by number.

## 5.5 Statuses

Each reading has a `status`, terminal for that reading:

| `status` | Meaning |
|---|---|
| `ready` | Text read. |
| `needs_transcript` | A recording (an audio or video media type or extension): stored and playable, never transcribed. Its transcript is another attachment. `duration_ms` gives its playing time when the container states it. |
| `unsupported` | No parser reads this attachment's extension or media type. |
| `too_large` | Too large to read: over the parse cap, 25 MiB by default for every format (`WHATBUILD_PARSE_CAP_BYTES`), in which case the file is not read at all; a DOCX, XLSX or DOC package whose parts unpack to more than the cap; a PDF of more than 2,000 pages; or a file that would make more than 200,000 paragraphs. The attachment is stored; `status_detail` says which. |
| `failed` | The parser errored, **or** it kept almost nothing: a text-like file (plain text, Markdown, VTT, SRT, CSV, TSV) that kept under 10% of at least 200 characters, a PDF with no text layer (a scan; there is no OCR), or an HTML page with no readable text (a page whose text is drawn by scripts, such as a single-page app's shell); **or** the parse needed more memory or time than the deployment gives one file, or stopped the server five times (§5.1). `status_detail` says which. |

An attachment's `text.status` ([§4.5](04-data-model.md)) is its latest reading's, or `pending`
until its current version has been read.

A source's `derived_status` says where its derived text stands (`derivedStatuses` in
[`ops/sources.ts`](../../packages/core/src/ops/sources.ts)):

| `derived_status` | Meaning |
|---|---|
| `ready` | It has a derived text. |
| `pending` | It has none yet, and an attachment is arriving (an unexpired upload grant) or being read. |
| `awaiting_file` | No attachment, and no text. |
| `awaiting_text` | An attachment has text the source does not use: its text was removed. `warnings` says to take an attachment's text or write one. |
| `needs_transcript`, `unsupported`, `too_large`, `failed` | No attachment could be read: how its newest attachment was read, with `status_detail`. |

A source without a derived text is fully usable: its attachments are stored and downloadable, and
search reads its title, tags, summary, notes and comments.

## 5.6 Other derived reads and writes

- `derived.manifest { record_id, path?, derivation_id? }`: how an attachment was read, whole:
  `derivation_id`, `record_id`, `path`, `file_version_id`, `status`, `status_detail`, `parser`,
  `parser_version`, `text_chars`, `duration_ms`, `facts`, `created_at` and `inference: "none"`.
  Without `path`, the attachment is the one the derived text was taken from, else the only one; a
  source with several and none of them the text's answers `422` naming them.
- `derived.list`: every reading of the source's attachments, newest first (at most 100), each with
  its `path` and `is_current` (the attachment's latest reading of its current version).
- `derived.rederive { record_id, path? }`: queues a reading of an attachment's current version,
  chosen as `manifest` chooses it, and answers `{ record_id, path, queued,
  previous_derivation_id }`; `409 no_file` when the attachment has no stored version yet. When the
  derived text is still that attachment's, the new reading replaces it (§5.4).
- `derived.write_note` and `derived.read_note`: a source's summary and notes
  ([§4.6](04-data-model.md)), searched with the rest of it.
- Every reading stays readable by id, unless the source was deleted, in which case a read returns
  `410 record_deleted` with the tombstone ([§9.5](09-data-lifecycle.md)).
