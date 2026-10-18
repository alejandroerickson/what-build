---
type: Specification
title: Every attachment is read into readable Markdown and kept, and each source has one derived text that people and agents read, edit and search.
description: Reading attachments (when a reading runs, its thread and limits, what it stores, its statuses), the parsers and how they lay text out, the derived text and how it follows its attachment, and the reads and writes of the derived layer.
tags: [spec, derived-layer, parsers, derived-text, attachments]
generated: {by: agent:claude, at: 2026-10-18}
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
attachments are read afresh there), when `derived.rederive` asks for it (for example after a parser
upgrade), and when a public sandbox's reset puts back a reading that this version's parsers would
make afresh, such as one an older parser made ([§9.7](09-data-lifecycle.md#the-reset)). Earlier
readings are retained and readable by id. `rederive` returns `previous_derivation_id`; the
attachment's latest reading stays in place until the new one finishes, so a caller knows it is done
when `derived.manifest` for that attachment reports a different `derivation_id`.

**Where it runs.** Always on the Postgres job queue, in the worker
([`apps/server/src/worker.ts`](../../apps/server/src/worker.ts)), in every environment. The
transaction that adds the attachment enqueues the job, and the worker wakes after the commit. The
upload response is never held while a file is read, and a slow PDF cannot occupy a request. Reading
inline in the request would be an observable behavior difference and is forbidden
([§1.5 rule 12](01-product.md)). A reading's row is written only when it finishes, so until then
the attachment's text status is `pending`, unless its name, type and size already settle how it
will be read (§5.5).

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
changes and comments for DOCX; `doc_format` and tables for DOC; for XLSX, sheets, hidden sheets
(`hidden_sheets`), the hidden rows and columns read (`hidden_rows`, `hidden_columns`), the values
other than zero a format shows as nothing (`hidden_values`) and the formulas saved without a value
(`formulas_without_values`); rows and the delimiter for CSV; skipped
cues for VTT and SRT; `transcript_turns` for a text, Markdown, DOCX or DOC file read as a
transcript). `inference: "none"` states that no model produced or altered the text.

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
| Plain text (`.txt`, `.text`) | Read as written. Paragraphs split on blank lines and keep their lines: each line stays a line (a Markdown hard break, two spaces before the line end), unless it only wraps a sentence onto the next (below). List items keep their markers: `-`, `*` and `+` bullets and `1.` and `1)` numbers as Markdown lists, nested as they are indented (at most eight deep), and other bullets (`•`, `–`, a check box, Word's `o` and `§`) as written. ATX headings stay headings; pipe tables become tables; a rule or an underline (`-----`, `=====`) stands on its own, so it never makes the line above it a heading. A transcript is read turn by turn with its speakers (below). |
| Markdown (`.md`, `.markdown`) | Kept as written. Parsed as plain text is, plus setext headings, with blockquote markers, thematic breaks and inline emphasis and code markers set aside, so `**Name:** words` is a speaker turn and `**Name** (14:02 UTC):` on a line of its own a timed label (below). |
| WebVTT, SRT | Cue timing; speakers from `<v Name>` voice tags and from `Name:` prefixes; caption markup stripped. |
| DOCX | Headings (a Title above Heading 1), paragraphs, tables, the accepted view of tracked changes (insertions kept, deletions dropped), and reviewer comments under `# Review comments`, each `Author: words`. A paragraph in a decimal Word list (numbered directly or by its style) starts with its number as Word counts it (`2.`, `1.1.`); bullets and other number formats (letters, roman numerals) get no marker. `Name: words` paragraphs, including a bold `Name:` run, are speaker turns in a transcript (below). |
| DOC (`.doc`, `application/msword`) | The format is read from the file's first bytes, never from its name, and the `doc_format` fact records it. A **Word binary document** (an OLE2 compound file) from Word 97-2003 (`word97`), or from Word 6.0 or Word 95 (`word6`), gives its main text through the piece table, with 8-bit Windows-1252 and UTF-16 pieces: one paragraph per paragraph, built-in heading styles (Title, Subtitle, Heading 1-9) as headings at DOCX's levels, tables as tables, field results kept and field codes dropped, page and section breaks as paragraph breaks, and `Name: words` paragraphs as speaker turns in a transcript. Word 97 tables come from the paragraphs' table flags; Word 6 tables are inferred from cell marks, the first row setting the width. Headers, footnotes, comments and list numbers are not read. Encrypted documents, fast-saved Word 6 and Word 95 documents and Word 2 and older documents fail with the reason. A **DOCX package** under a `.doc` name is read by the DOCX parser (`docx`); a **MIME HTML** file (Word's "Web Page" save, wiki Word exports) has its first `text/html` part, quoted-printable or base64, read by the HTML parser (`mhtml`); **plain HTML** is read by the HTML parser in the character set its `<meta>` declares (`html`). Rich Text Format and anything else fail with the reason, as does HTML with no readable text. |
| XLSX | Sheets and rows, laid out as above, each value as the sheet shows it, through its cell's number format ([`numfmt.ts`](../../packages/parsers/src/numfmt.ts)): percentages, decimals, thousands separators and scaling (`#,##0,`), currency, explicit signs (`+0.0%`), negatives in brackets, fractions, scientific notation, conditions (`[>=1000]0.0,"K"`), a text section (`@" (est.)"`), and dates and times (`5 Mar 2026`, `1:30 PM`, elapsed `30:00:00`) in the workbook's 1900 or 1904 date system: a date alone is the day its value falls in, and a time is rounded to the finest part it shows, into the next day if need be. A negative in a section that shows it only by a colour (`#,##0;[Red]#,##0`) gets the minus the colour stood for. The locale's own formats, which a file does not record, read in ISO 8601: the short date (14) and the date and time (22) as `2026-04-10` and `2026-04-10 12:00`, the system long date and time (`[$-F800]`, `[$-F400]`) as a date and `13:30:00`; the currency formats that show the locale's symbol (5 to 8, 42, 44) read without one. A negative date, a date alone on a day before the 1900 system's first, and a number in a text format read as General shows them; a time under one day in a format that shows a date and a time shows as the time alone (`0.5` under `m/d/yyyy h:mm` is `12:00`). A hidden sheet, column or row is read, so search finds it, and marked: `# Sheet: Workings (hidden)`, a column `Rate (hidden)`, a row `3 (hidden)`; so is a value its format shows as nothing (`;;;`, or `0;;0` for a negative), read as General: `42 (hidden)`. A zero its format shows as nothing (`0;-0;;@`, `#,##0;(#,##0);`, `;;;`) is the blank the sheet shows, an empty cell, as hiding zeros hides no information. A formula the file holds without its value, as libraries that never calculate write it, reads `=SUM(B2:B3) (no stored value)` rather than 0 or nothing. |
| CSV, TSV (`.csv`, `.tsv`) | Read like a one-sheet workbook, with the same header rule. Quoted fields may hold delimiters and line breaks; the delimiter (comma, semicolon or tab) is taken from the first line. |
| PDF | Text layer only, page by page, for a PDF of at most 2,000 pages; a page's lines are joined into paragraphs that end at sentence punctuation. No OCR; images are never decoded. A PDF with no text layer, its pages pictures as a scan's are, is `unsupported`, as an image is (§5.5). |
| HTML | Main-content text with headings; scripts, styles, navigation, forms and frames dropped; tables as tables; adjacent elements (labels, breadcrumbs) kept apart by a space. A page that nests elements more than 512 deep, or would make far more elements than it has tags, fails with the reason. |

**Line breaks in plain text** ([`plaintext.ts`](../../packages/parsers/src/plaintext.ts)). Only
prose joins lines. A paragraph is prose when a sentence in it ends before the paragraph does and the
next starts with a capital (`… yesterday. She`), or when it is one sentence, ended, that wraps at
every break between its lines; notes and a log's lines, which end no sentence, are not. In prose, a
break between two lines is a wrap, and joins them with a space, when the first does not end a
sentence (`.`, `!`, `?`, `:`), the next starts with a lower-case letter and not with a label
(`warning: …`), the paragraph's longest line is at least 40 characters, and the next line's first
word would not have fitted on the first within that width: what a text wrapped to a width looks
like. A paragraph of prose in which more than half the breaks are wraps (not counting those before a
list item) is hard-wrapped, and reads as one paragraph: all of those breaks join. Every other break
is kept, so lists of names, one item per line, line-broken notes and a log read as written, and a
short line is never joined to the next. A line after a Markdown list that is not indented under its
last item ends the list, and a line after quoted lines (`> …`, as in a reply to an email) that is
not quoted ends the quote, each with a blank line before it, so Markdown never reads it into the
list or the quote. A quoted line is never joined to the line before or after it, so a reply in lower
case under a quote is not read as its wrap.

◆ Decision: a workbook reads as the sheet displays it, not as its stored values: a reader quotes
`+14.0%` where the sheet shows it, not `0.14`. Its hidden sheets, columns, rows and values are
read, so their content is found, and marked, so a reader knows the sheet hides them.

◆ Decision: a plain-text file reads as its author laid it out, its lines and list markers kept,
rather than reflowed into paragraphs: a list, a file of one item per line or a block of notes means
its lines. Only prose that is plainly hard-wrapped is joined, so a phrase across a wrap is still
found by a substring search.

**Untimed transcripts.** Plain text, Markdown, DOCX and DOC share one rule
([`speakers.ts`](../../packages/parsers/src/speakers.ts)), so a transcript reads the same whatever
it was saved as. A file is a transcript when it has at least four lines (paragraphs, for DOCX and DOC), at
least 60% of them are `Name:` turns (a capitalised name of up to 41 characters, or a bracketed
label, optionally after a timestamp), and at least half of those turns come from a name that speaks
more than once. The last condition keeps field lines such as `Project:`, `Date:` and `Location:`, and
an occasional `Note:`, as prose. A short aside in brackets may stand between the name and the colon,
`Dana (14:02 UTC): words`; the aside is dropped and the speaker is `Dana`. In plain text a turn's
later lines are laid out as a paragraph's are: kept, or joined where they wrap its sentence.

Plain text and Markdown also read a transcript whose turns start with a **timed label on a line of
its own**, the words in the paragraphs below it: `Dana (14:02 UTC):` (in Markdown also
`**Dana** (14:02 UTC):`) or `[14:02] Dana:`. The name may say what the speaker is, with a comma:
`Sam, agent (14:03 UTC):`. The time, in the aside or before the name, is required, so a line such as
`Attendees:` is never taken for a label. A file is read this way when it has at least four such
labels and at least half of them are by a name that recurs. Each paragraph and list item after a
label then belongs to that speaker, until the next label, an inline turn, a heading or a thematic
break. In such a file an inline `Name: words` line is a turn only when `Name` is one of the labels'
speakers, so a line like `Decision: ship it` inside a turn stays that speaker's words. A speaker
whose words open with a list has the label as a paragraph of its own above it, so a list numbered
from 3 reads as a list, which in Markdown could not interrupt the label's line. (A Markdown file
keeps its own text; the speakers count in its facts.)

- No speech-to-text and no OCR in the product. A recording is stored and playable, never
  transcribed: its transcript is another attachment, or the source's derived text written by an
  agent with its own transcription tool. An image, or a PDF whose pages are pictures, is stored and
  shown, and no words are read from it: an agent that can see it describes it in the source's
  summary and, if search should find its words, writes them as the derived text.
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

So a source's text is the text of the first of its attachments whose reading finishes `ready` with
some text. Attachments are queued to be read as they arrive (the web app uploads them one after
another, in the order listed) and read in that order, so it is usually the first to arrive in a
format WhatBuild reads; where several instances read at once, a short file can finish before a
longer one that arrived first. A reading that is not `ready`, or holds no text, never touches it,
so a recording, an image or a format no parser reads is passed over. The text follows that
attachment through new versions and readings, and stops following it once someone writes it;
`from_attachment` (below) takes another attachment's text, which it then follows. Once someone
removes the text, the next reading with text fills it again.

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

None, or more than one, is `422 invalid_input`. `expected_etag` is the text's own etag, left out
for the first text and required once the source has one, whichever way it is written, removing it
included ([§4.1](04-data-model.md)). Without it, with a stale one, or with another of the source's
etags in its place, the write is `409 stale_etag` with `current_etag` and a message saying where to
read the text's etag. The source's own etag, its summary's and its notes' are each named in the
refusal while they are current; any other etag, an older one of any part included (the source's
from before an attachment was added, say), is refused as not the text's current etag, without
saying the text changed, which it may not have. One sent when the source has no text is
`409 stale_etag` with `current_etag: null`, saying to leave it out for the first write. An archived source refuses it (`409 record_archived`). It answers `{ record_id, chars, etag, updated_at, taken_from, diff? }`,
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
  `{ record_id, of: "attachment", path, derivation_id, file_version_id, status, status_detail,
  offset, total_chars, truncated, text }`, its text empty when the reading is not `ready`, and its
  status said as this version says it, as every read of a reading does (§5.5). An attachment not
  read yet answers `404`. An attachment's text is kept, never searched.

Offsets and lengths are Unicode code points, not UTF-16 units and not bytes, and a window never
splits a character; implementations MUST test this with astral-plane characters. `truncated` says
more follows: page with consecutive offsets. A `limit` over 20,000 is refused (`422`), never
clipped. Sent `start`, `end`, `unit`, `seq` or `length`, `derived.text` refuses them with a hint
that it reads by `offset` and `limit` (where the window starts and how many characters it holds)
and that there are no passages to read by number.

## 5.5 Statuses

Each reading has a `status`, terminal for that reading:

| `status` | Meaning |
|---|---|
| `ready` | Text read. |
| `needs_transcript` | A recording (an audio or video media type or extension): stored and playable, never transcribed. Its transcript is another attachment. `duration_ms` gives its playing time when the container states it. |
| `unsupported` | No words to read: no parser reads this attachment's extension or media type, or it is pictures, an image or a PDF with no text layer (a scan's pages are pictures; there is no OCR). It is no failure, and reading it again changes nothing. For an image or a PDF of pictures, `status_detail` says that an agent that can see it should describe it in the source's summary and write its words as the text with `derived(action="write_text")` if search should find them. |
| `too_large` | Too large to read: over the parse cap, 25 MiB by default for every format (`WHATBUILD_PARSE_CAP_BYTES`), in which case the file is not read at all; a DOCX, XLSX or DOC package whose parts unpack to more than the cap; a PDF of more than 2,000 pages; or a file that would make more than 200,000 paragraphs. The attachment is stored; `status_detail` says which. |
| `failed` | The parser errored, **or** it kept almost nothing: a text-like file (plain text, Markdown, VTT, SRT, CSV, TSV) that kept under 10% of at least 200 characters, or an HTML page with no readable text (a page whose text is drawn by scripts, such as a single-page app's shell); **or** the parse needed more memory or time than the deployment gives one file, or stopped the server five times (§5.1). `status_detail` says which. |

◆ Decision: a PDF with no text layer is `unsupported`, as an image is, not `failed`: its pages are
pictures, and reading it again cannot find words in them. A failure is worth retrying; a picture
needs someone who can see it.

An attachment's `text.status` ([§4.5](04-data-model.md)) is its latest reading's. Until its current
version has been read, it is what the attachment's name, media type and size already settle
(`settledReading` in [`packages/parsers/src/index.ts`](../../packages/parsers/src/index.ts), the
rule `derive` follows, so the reading then records the same): `too_large` over the parse cap,
`needs_transcript` for a recording, and `unsupported` for a format no parser reads, an image among
them. Anything else is `pending` until it is read.

A reading is never rewritten, but one an earlier version made is said as this version would say it,
wherever it is read (`currentReading` in [`statuses.ts`](../../packages/parsers/src/statuses.ts)),
so a backup or a public sandbox's baseline brings no retired words back: a recording that asked for
"a transcript as a new source" asks for one as another attachment, a PDF of pictures once recorded
as `failed` reads `unsupported`, and an image once said to be "a format no parser reads" says how an
agent gives it its words. None of them needs reading again, and a public sandbox's reset leaves them
as they are: it reads again only what this version's parsers would read differently (§5.1), never a
reading that failed or found a recording, nor one in which this version's parser found only
pictures. A recording's detail beside the source's derived text says where that text comes from
instead of asking for a transcript.

A source's `derived_status` says where its derived text stands (`derivedStatuses` in
[`ops/sources.ts`](../../packages/core/src/ops/sources.ts)):

| `derived_status` | Meaning |
|---|---|
| `ready` | It has a derived text. `warnings` names each attachment with text that the derived text does not use, which search never reads. |
| `pending` | It has none yet, and an attachment is arriving (an unexpired upload grant) or being read. One whose name, type and size settle its reading is never being read. |
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
  ([§4.6](04-data-model.md)), searched with the rest of it, each with an etag of its own that a
  write over it names once it exists ([§4.1](04-data-model.md)).
- Every reading stays readable by id, unless the source was deleted, in which case a read returns
  `410 record_deleted` with the tombstone ([§9.5](09-data-lifecycle.md)).
