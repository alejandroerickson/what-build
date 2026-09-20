# 5. The derived layer

Every record's primary file is parsed into passage-addressable text. This is what makes the
product's signature read possible: **any passage of any source, addressable by cue timestamp,
speaker, segment number, or character offset, from any client.**

## 5.1 Derivations

A **derivation** is one immutable parse of one version of a record's primary file, identified by
a `derivation_id`. A record has zero or more derivations and at most one **current** one.

A new derivation is produced when: a primary file is first added; a new version of the primary is
uploaded; a different file becomes primary; `derived.rederive` is called (for example after a
parser upgrade). Earlier derivations are retained and readable by id.

Where it runs: inline in the worker (browser profile); in-process immediately after the upload
completes (server profile; large files are queued so the upload response is not held); from a
queue (cloud profile). Callers observe progress through `record.derivation.status`.

## 5.2 Sidecars

Each derivation consists of four sidecars.

### `segments.jsonl`

One JSON object per line, ordered by `seq` (0-based, dense):

```json
{"seq": 41, "text": "We export to a spreadsheet every Friday because…", "speaker": "Dana",
 "start_ms": 1815000, "end_ms": 1829500, "char_start": 10432, "char_end": 10987}
```

- `speaker`, `start_ms`, `end_ms` are present only where the source provides them.
- `char_start` / `char_end` index into `text.md`: **half-open, counted in Unicode code points**
  (not UTF-16 units, not bytes). Implementations MUST test this with astral-plane characters.
- A paragraph or cue payload longer than 2,000 characters is split at sentence boundaries into
  several segments that share speaker and timing.
- Inverted cues (end before start) are skipped and counted in the manifest.
- Optional `page` (PDF) and `heading_path` (documents) locate a segment structurally.

### `text.md`

The full derived text the offsets index into.

- Timed sources: one cue per paragraph, prefixed by speaker where known.
- Documents: structure-preserving Markdown — headings kept; `# Page N` per PDF page; DOCX tables
  flattened to rows of text; tracked insertions kept and tracked deletions dropped; reviewer
  comments appended in a final section with their authors.

### `outline.md`

Document headings with segment ranges, or — for timed sources — speaker turns with time ranges.
Small enough to read whole; it is how a person or an agent decides where to look.

### `manifest.json`

```json
{
  "derivation_id": "01J…", "record_id": "01J…",
  "parser": "vtt", "parser_version": "1.0.0",
  "source_path": "call.vtt", "source_version_id": "01J…",
  "segment_count": 412, "char_count": 58211, "duration_ms": 3540000,
  "skipped": { "inverted_cues": 0 },
  "status": "ready", "status_detail": null,
  "created_at": "2026-09-19T17:02:11Z"
}
```

| `status` | Meaning |
|---|---|
| `pending` | Queued or running. |
| `ready` | Segments available. |
| `needs_transcript` | The primary is a recording; no text can be derived until a transcript is added and made primary. |
| `unsupported` | No parser for this media type. |
| `too_large` | Exceeds the parse cap (default 25 MB for text-like formats, 100 MB for PDF/DOCX; configurable). |
| `failed` | The parser errored, **or** it kept almost nothing (for example a scanned PDF with no text layer). `status_detail` says which. |

Every status except `pending` is terminal for that derivation. A record whose current derivation
is not `ready` is fully usable as a stored, downloadable source; it simply has no passages.

## 5.3 Parsers

| Format | Notes |
|---|---|
| Plain text, Markdown | Paragraph segmentation; Markdown headings feed the outline. |
| WebVTT, SRT | Cue timing; speakers from `<v Name>` voice tags and from `Name:` prefixes. |
| DOCX | Headings, paragraphs, tables, tracked changes, comments. |
| PDF | Text layer only, per page. No OCR. |
| HTML | Main-content text with headings; scripts, styles, and navigation dropped. |

- No speech-to-text and no OCR in the product. A recording is stored, playable, and awaits a
  transcript. (An agent with its own transcription tool can add one as a file with
  `derived_from` provenance.)
- Parsers are pure functions of bytes → sidecars, with no I/O, so they run identically in a worker
  and in Node. Each has golden-file tests; a parser change that alters golden output MUST bump
  `parser_version`.

## 5.4 Passage reads

`read_passage` takes a record and **one** window:

- a **segment window** `{ seq_start, seq_end }` — always available; or
- a **time window** `{ start_ms, end_ms }` — timed sources only (`422` otherwise); returns every
  segment overlapping the window.

Optional: `derivation_id` (default: current), `speaker` filter.

Bounds: at most 200 segments **and** at most 10 minutes per call. A wider request is **refused**
with `422 window_too_large` stating the limits — it is not silently clipped.

Response:

```json
{
  "record": { "record_id": "01J…", "title": "…", "kind": "interview_transcript" },
  "derivation_id": "01J…", "source_version_id": "01J…", "is_current_derivation": true,
  "total_segments": 412, "duration_ms": 3540000,
  "requested": { "seq_start": 400, "seq_end": 450 },
  "returned":  { "seq_start": 400, "seq_end": 411 },
  "out_of_range": true,
  "segments": [ { "seq": 400, "text": "…", "speaker": "…", "start_ms": 0, "end_ms": 0,
                  "char_start": 0, "char_end": 0 } ]
}
```

A window that runs past the end returns what exists and sets `out_of_range: true`. A window
entirely outside the source returns no segments, `out_of_range: true`, and the valid range. It is
never a silent empty success.

## 5.5 Other derived reads

- `derived.manifest`, `derived.outline` — whole.
- `derived.text` — a window of `text.md` by code-point `offset` and `limit` (≤ 20,000), with
  `truncated` and `total_chars`.
- `derived.list` — a record's derivations, newest first.
- All accept `derivation_id`, so a passage cited against an old derivation stays readable exactly
  as it was cited.
