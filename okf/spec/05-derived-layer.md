---
type: Specification
title: Every source's primary file is parsed into immutable, passage-addressable text that any client can read by segment or time.
description: Derivations and when they run, the four sidecars, derivation statuses, the parsers by format, the read_passage contract, and the other derived reads.
tags: [spec, derived-layer, parsers, passages, sidecars]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# 5. The derived layer

Every source's primary file is parsed into passage-addressable text. This is what makes the
product's signature read possible: **any passage of any source, addressable by cue timestamp,
speaker, segment number, or character offset, from any client.** Parsers are in
[`packages/parsers/src`](../../packages/parsers/src); the derivation job and the reads are in
[`packages/core/src/ops/derived.ts`](../../packages/core/src/ops/derived.ts).

## 5.1 Derivations

A **derivation** is one immutable parse of one version of a source's primary file, identified by
a `derivation_id`. A source has zero or more derivations and at most one **current** one.

A new derivation is produced when: a primary file is first added; a new version of the primary is
uploaded; a different file becomes primary; a source is copied to another product; or
`derived.rederive` is called (for example after a parser upgrade). Earlier derivations are
retained and readable by id. `rederive` returns `previous_derivation_id`; the current derivation
stays in place until the new parse finishes, so a caller knows it is done when
`derived.manifest` reports a different `derivation_id`.

**Where it runs.** Always on the Postgres job queue, in the worker
([`apps/server/src/worker.ts`](../../apps/server/src/worker.ts)), in every environment. The
transaction that adds the file enqueues the job, and the worker wakes after the commit. The upload
response is never held while a file is parsed, and a slow PDF cannot occupy a request. Running
derivation inline in the request would be an observable behavior difference and is forbidden
([§1.5 rule 12](01-product.md)). A derivation row is written only when the parse finishes, so
until then the source reports `derived_status: "pending"`. Callers observe progress through
`derived_status`, and the activity log records the outcome under the system actor.

**Each parse has a thread and limits of its own**
([decision](../decisions/each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits.md)).
The worker hands the file's bytes to a new worker thread
([`parse-thread.ts`](../../apps/server/src/parse-thread.ts)), which parses them into the sidecars
and returns their bytes, so the server keeps answering requests while any file is parsed. The
thread's JavaScript heap is held to `WHATBUILD_PARSE_MEMORY_MB` (384 MB by default), the buffers it
holds outside the heap to half as much again, and its run to `WHATBUILD_PARSE_TIMEOUT_SECONDS`
(120 by default). A parse past any of them is stopped, and its derivation is `failed` with the
limit and its value in `status_detail`. A job is tried at most five times, counting the times the
process stopped while running it; a derivation whose job stopped the process all five times is
given up and recorded as `failed` with parser `none`, and `rederive` tries once more.

Writing a derivation's segments and making it current happen in one transaction, so search never
returns a passage `read_passage` cannot serve.

## 5.2 Sidecars

Each derivation consists of four sidecars, stored as immutable blobs under
`t/<tenant_id>/r/<record_id>/d/<derivation_id>/` ([§4.15](04-data-model.md)).

### `segments.jsonl`

One JSON object per line, ordered by `seq` (0-based, dense):

```json
{"seq": 41, "text": "We export to a spreadsheet every Friday because…", "speaker": "Dana",
 "start_ms": 1815000, "end_ms": 1829500, "char_start": 10432, "char_end": 10987}
```

- `speaker`, `start_ms`, `end_ms` are `null` unless the source provides them.
- `char_start` / `char_end` index into `text.md`: **half-open, counted in Unicode code points**
  (not UTF-16 units, not bytes), and `text.md[char_start:char_end]` equals the segment's `text`.
  Implementations MUST test this with astral-plane characters.
- A paragraph or cue longer than 2,000 code points is split into several segments that share
  speaker and timing, preferring sentence boundaries, then the last space, then a hard cut.
- Inverted cues (end before start) are skipped and counted in the manifest's `facts`.
- Optional `heading_level` (1–6) marks a heading segment, and `page` (PDF, 1-based) locates a
  segment on its page. Levels agree across formats: a Markdown `#` title and a DOCX Title are
  level 1, and the sections under them (`##`, or Heading 1 below a Title) level 2.

### `text.md`

The full derived text the offsets index into: the segments' text joined by blank lines, ending
with one newline.

- Timed sources: one cue per paragraph. The speaker is carried on the segment, not written into
  the text.
- Untimed transcripts (plain text, Markdown, DOCX): one turn per segment, the speaker on the
  segment and the `Name:` label removed from the text, as for timed sources.
- Documents: headings kept as their own segments; a `# Page N` heading per PDF page; each list
  item its own segment, a numbered item keeping its number (`1.`) and a bullet dropping its
  marker; tables (DOCX, HTML, Markdown pipe tables) one segment per row with the header repeated
  as `header: cell` pairs; tracked insertions kept and tracked deletions dropped; reviewer
  comments appended under `# Review comments`; XLSX a `# Sheet: <name>` heading per worksheet and
  one segment per non-empty row, prefixed `[<Sheet>, row N]`; CSV and TSV one segment per
  non-empty row, prefixed `[row N]`.
- Tables in DOCX, HTML and Markdown share one rule
  ([`tables.ts`](../../packages/parsers/src/tables.ts)). A matrix whose top-left header cell is
  empty still labels its columns, and each row's first cell leads unlabelled as the row's name:
  `Reached the saved view | Plan A: 4 of 5 | Plan B: 0 of 5`. A table with only one row, or with an
  empty header cell anywhere after the first, has no usable header, and its rows' cells are joined
  with ` | `.

### `outline.md`

Document headings with the segment each starts at, or, for timed sources, speaker turns with time
ranges and segment ranges. Small enough to read whole; it is how a person or an agent decides
where to look.

### `manifest.json`

```json
{
  "derivation_id": "01J…", "record_id": "01J…",
  "parser": "vtt", "parser_version": "1",
  "source_path": "call.vtt", "file_version_id": "01J…",
  "segment_count": 412, "char_count": 58211, "duration_ms": 3540000,
  "facts": { "inverted_cues": 0 },
  "status": "ready", "status_detail": null,
  "created_at": "2026-09-19T17:02:11Z",
  "inference": "none"
}
```

`duration_ms` is the last cue end for a timed source (VTT, SRT) and, for a recording, its playing
time read from the container headers without decoding audio: MP4, M4A and MOV (`mvhd`), WAV,
FLAC and MP3 (a Xing, Info or VBRI frame count, else the constant bitrate). It is null for other
sources and for a container that cannot be read. A recording over the parse cap is not downloaded;
only the byte ranges holding those headers are read.

`facts` holds format-specific counts (pages and text-layer characters for PDF; tables, tracked
changes and comments for DOCX; `doc_format` and tables for DOC; sheets for XLSX; rows and the
delimiter for CSV; skipped cues for VTT and SRT; `transcript_turns` for a text, Markdown, DOCX or DOC
file read as a transcript). `inference: "none"`
states that no model produced or altered the text.

| `status` | Meaning |
|---|---|
| `ready` | Segments available. |
| `needs_transcript` | The primary is a recording (an audio or video media type or extension); no text can be derived until a transcript is added and made primary. `duration_ms` gives its playing time when the container states it. |
| `unsupported` | No parser for this file's extension or media type. |
| `too_large` | Too large to parse: over the parse cap, 25 MiB by default for every format (`WHATBUILD_PARSE_CAP_BYTES`), in which case the file is not read; a DOCX, XLSX or DOC package whose parts unpack to more than the cap; a PDF of more than 2,000 pages; or a file that would make more than 200,000 passages. The file is stored; `status_detail` says which. |
| `failed` | The parser errored, **or** it kept almost nothing: a text-like file (plain text, Markdown, VTT, SRT, CSV, TSV) that kept under 10% of at least 200 characters, a PDF with no text layer (a scan; there is no OCR), or an HTML page with no readable text (a page whose text is drawn by scripts, such as a single-page app's shell); **or** the parse needed more memory or time than the deployment gives one file, or stopped the server five times (§5.1). `status_detail` says which. |

Every status is terminal for its derivation. A source whose current derivation is not `ready` is
fully usable as a stored, downloadable source; it simply has no passages.

## 5.3 Parsers

A parser is chosen by file extension, falling back to the media type when the name has no known
extension ([`packages/parsers/src/index.ts`](../../packages/parsers/src/index.ts)).

| Format | Notes |
|---|---|
| Plain text (`.txt`, `.text`) | Paragraphs split on blank lines; ATX headings become heading segments and feed the outline; each list item (`-`, `*`, `+`, `1.`) and each pipe-table row is its own segment. A transcript is read one turn per segment with its speaker (below). |
| Markdown (`.md`, `.markdown`) | Everything plain text does, plus setext headings; blockquote markers and thematic breaks dropped; inline emphasis and code markers (`**`, `__`, `*`, `_`, backticks) stripped where they are clearly markup, never inside words or code spans. `**Name:** words` is a speaker turn. |
| WebVTT, SRT | Cue timing; speakers from `<v Name>` voice tags and from `Name:` prefixes; caption markup stripped. |
| DOCX | Headings (a Title above Heading 1), paragraphs, tables, the accepted view of tracked changes, comments. A paragraph in a decimal Word list (numbered directly or by its style) starts with its number as Word counts it (`2.`, `1.1.`); bullets and other number formats (letters, roman numerals) get no marker. `Name: words` paragraphs, including a bold `Name:` run, are speaker turns in a transcript (below). |
| DOC (`.doc`, `application/msword`) | The format is read from the file's first bytes, never from its name, and the `doc_format` fact records it. A **Word binary document** (an OLE2 compound file) from Word 97-2003 (`word97`), or from Word 6.0 or Word 95 (`word6`), gives its main text through the piece table, with 8-bit Windows-1252 and UTF-16 pieces: one segment per paragraph, built-in heading styles (Title, Subtitle, Heading 1-9) as headings at DOCX's levels, tables one segment per row with the header repeated as in DOCX, field results kept and field codes dropped, page and section breaks as paragraph breaks, and `Name: words` paragraphs as speaker turns in a transcript. Word 97 tables come from the paragraphs' table flags; Word 6 tables are inferred from cell marks, the first row setting the width. Headers, footnotes, comments and list numbers are not read. Encrypted documents, fast-saved Word 6 and Word 95 documents and Word 2 and older documents fail with the reason. A **DOCX package** under a `.doc` name is read by the DOCX parser (`docx`); a **MIME HTML** file (Word's "Web Page" save, wiki Word exports) has its first `text/html` part, quoted-printable or base64, read by the HTML parser (`mhtml`); **plain HTML** is read by the HTML parser in the character set its `<meta>` declares (`html`). Rich Text Format and anything else fail with the reason, as does HTML with no readable text. |
| XLSX | Sheets and rows; the first all-text row with two or more cells near the top becomes the header, and later rows render `label: value` pairs in column order. A header column that a row leaves empty renders `label: (blank)`, so a missing value reads differently from a column that does not exist; this applies to a row that fills at least one header column, and a lone cell outside the header columns (a side note) stays unlabelled. A number whose cell format is a date or time (the built-in formats 14–22 and 45–47, or a custom format with day, month, year, hour or second codes outside quotes and brackets) renders in ISO 8601: `2026-04-10`, `2026-04-10 12:00`, `13:30`, or elapsed hours `30:00:00`, in the workbook's 1900 or 1904 date system. Other numbers keep their stored value, not their displayed format. |
| CSV, TSV (`.csv`, `.tsv`) | Read like a one-sheet workbook, with the same header rule and `label: value` rows, including `(blank)` for an empty header column. Quoted fields may hold delimiters and line breaks; the delimiter (comma, semicolon or tab) is taken from the first line. |
| PDF | Text layer only, per page, for a PDF of at most 2,000 pages. No OCR; images are never decoded. |
| HTML | Main-content text with headings; scripts, styles, navigation, forms and frames dropped; tables one segment per row with header pairs; adjacent elements (labels, breadcrumbs) kept apart by a space. A page that nests elements more than 512 deep, or would make far more elements than it has tags, fails with the reason. |

**Untimed transcripts.** Plain text, Markdown, DOCX and DOC share one rule
([`speakers.ts`](../../packages/parsers/src/speakers.ts)), so a transcript reads the same whatever
it was saved as. A file is a transcript when it has at least four lines (paragraphs, for DOCX and DOC), at
least 60% of them are `Name:` turns (a capitalised name of up to 41 characters, or a bracketed
label, optionally after a timestamp), and at least half of those turns come from a name that speaks
more than once. The last condition keeps field lines such as `Project:`, `Date:` and `Location:`, and
an occasional `Note:`, as prose.

- No speech-to-text and no OCR in the product. A recording is stored, playable, and awaits a
  transcript. (An agent with its own transcription tool can add one as a file with
  `derived_from` provenance.)
- Parsers are pure functions of bytes → sidecars (`derive`, then `toParsedFile` for the bytes a
  derivation stores), with no I/O (the recording-duration reader
  takes a byte-range callback, so the worker can serve it ranges of a stored file), and never throw for a bad file:
  every outcome is a status. They bound what a file can make them do: unpacked bytes count against
  the parse cap, nesting and passages are capped, and text is read in time linear in its length
  (patterns that could backtrack run as single passes, tested against the patterns they replace).
  They have fixture and hostile-file tests
  ([`packages/parsers/test`](../../packages/parsers/test)); golden-file tests for each format are
  planned. A parser change that alters its output MUST bump `parser_version`. No native
  dependencies: the image stays small, cold starts stay fast, and `pnpm install` cannot fail on a
  contributor's toolchain. They keep to TypeScript that erases, because Node loads them in the
  parse thread from source in development and tests.

## 5.4 Passage reads

`read_passage { record_id, start, end, unit?, speaker?, derivation_id? }` reads **one** window:

- `unit: "seq"`: segments `start`..`end` inclusive; always available.
- `unit: "ms"`: every segment overlapping `[start, end]`; timed sources only
  (`422 untimed_source` otherwise).
- Without `unit`, timed sources read by `ms` and others by `seq`.
- `speaker` keeps only that speaker's segments within the window (case-insensitive);
  `derivation_id` defaults to the current derivation. When the filter leaves nothing, `warning`
  says why: the derivation has no speaker data at all, or nobody by that name speaks in it (with
  the names that do), before any "No segments in this range".

Bounds: at most 200 segments **and** at most 600,000 ms (10 minutes) per call. A wider request is
**refused** with `422 window_too_large` stating the limits; it is not silently clipped. A source
whose derivation is not `ready` answers `404` naming its status.

Response:

```json
{
  "record": { "record_id": "01J…", "title": "…", "archived_at": null },
  "derivation_id": "01J…", "file_version_id": "01J…", "is_current_derivation": true,
  "unit": "seq", "total_segments": 412, "duration_ms": 3540000,
  "requested": { "start": 400, "end": 450 },
  "returned":  { "seq_start": 400, "seq_end": 411 },
  "out_of_range": true,
  "valid_range": { "start": 0, "end": 411 },
  "warning": null,
  "segments": [ { "seq": 400, "text": "…", "speaker": "…", "start_ms": 0, "end_ms": 0,
                  "char_start": 0, "char_end": 0, "heading_level": null, "page": null } ]
}
```

A window that runs past the end returns what exists, sets `out_of_range: true` and gives
`valid_range`. A window entirely outside the source returns no segments and the same flags. A
window inside the source that matches nothing (a gap between cues) says so in `warning`. When
`unit` was omitted on a timed source and the empty window would be valid segment numbers, the
warning asks whether `unit: "seq"` was meant. It is never a silent empty success.

## 5.5 Other derived reads

- `derived.manifest`, `derived.outline`: whole.
- `derived.text`: a window of `text.md` by code-point `offset` and `limit` (≤ 20,000), with
  `truncated` and `total_chars`.
- `derived.list`: a source's derivations, newest first.
- All accept `derivation_id`, and every derivation's segments stay in Postgres, so a passage cited
  against an old derivation stays readable exactly as it was cited, unless the source was deleted,
  in which case the read returns `410 record_deleted` with the tombstone
  ([§9.5](09-data-lifecycle.md)).
