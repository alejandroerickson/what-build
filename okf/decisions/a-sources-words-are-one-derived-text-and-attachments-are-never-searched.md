---
type: Decision
title: A source's words are one derived text; its files are attachments, read and kept but never searched; search reads a source's title, tags, summary, derived text, notes and comments
description: Each source has one Markdown text that people and agents read, correct and search, taken from an attachment until someone writes it, because numbered passages of one primary file could not be corrected, moved with every parse and left everything else a source holds unsearched.
tags: [decision, sources, evidence, search, derived, attachments, mcp, web, product]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# A source's words are one derived text; its files are attachments, read and kept but never searched; search reads a source's title, tags, summary, derived text, notes and comments

## Context

A source's words were the passages of its primary file: the numbered segments of one parse, read
by number or by time with `read_passage`, and the only text search read. Its other files had a
role (`origin`, `supplement`) and provenance, were never parsed, and the app labelled each
"Searched" or "Kept, not searched". Nobody could correct a misheard name or a garbled table, words
an agent had needed a file uploaded first, the numbers that addressed a passage moved whenever the
file was parsed again, and the summary, notes and comments beside the text were not searched. The
maintainer chose on 2026-10-17 to make a source's words one readable document and to call its
files attachments everywhere. This replaces
[only a source's primary file is parsed and searched](only-the-primary-file-is-searched.md).

## Decision

- A source has at most one **derived text**: Markdown, its words as people read them
  (`source_texts`). People read and edit it on the source's page; agents read it in windows by
  code-point offset (`derived.text`) and write it whole, by exact edits, or from an attachment
  (`derived.write_text`).
- A source's files are **attachments** in the app, REST, the MCP tool `attachments`, the skill and
  the documentation, with no role and no provenance. Every version of every attachment is read when
  it arrives, and what was read is kept with it and stays readable, but is never searched.
- The derived text **follows its attachment**: the first reading with text becomes it, and a later
  reading of the same attachment replaces it, until someone writes or edits it.
- **Search reads** each source's title, tags, summary, derived text, notes and comments, and
  nothing else, through one index of their pieces (`text_chunks`). A hit names the field it is in
  and code-point offsets into it, and `coverage` says that attachments are never searched.
- There are no passages: no segments, no `read_passage`, no passage numbers or ¶ references.
- Rejected: searching every attachment's text. A recording's raw and cleaned transcripts would
  answer every query twice, and a hit in a file nobody reads as the source says less than one in
  the text its page shows.
- Rejected: keeping numbered passages as a view of the text. Numbers that move with every edit
  address nothing for long; an offset read around a hit does the same work.

## Consequences

- People and agents correct a source's words where they read them, and a source can be words alone.
- An edited text no longer follows its attachment; taking an attachment's text again is a choice
  (`from_attachment`, or "Use its text" in the app).
- Words only a second attachment holds are not found until someone takes or writes them into the
  source's text, summary or notes.
- The derived text keeps no revisions yet; what each attachment was read as stays readable.
- Migration `0030_one_derived_text_per_source.sql` turns each source's passages into its derived
  text, drops segments and file roles, and has every attachment read again; going back past it
  means restoring the database.

## Constrains

- Every write of a searched text indexes it again in the same transaction (`indexText` in
  `packages/core/src/text-index.ts`); a new searched field is a new `field` value and a migration.
- No operation searches an attachment's text, and an attachment takes no role: `role`,
  `derived_from`, `derivation_note` and `derived_by` are refused with a hint
  (`packages/core/src/execute.ts`).
- The tables keep the names `files` and `file_versions`; nothing people or agents see calls an
  attachment a file. Parsers lay the text out (`packages/parsers/src/markdown.ts`), and a change to
  that layout bumps `parser_version`.

Specified in: [§5](../spec/05-derived-layer.md), [§8](../spec/08-search.md), [§4.3, §4.5 and §4.6](../spec/04-data-model.md), [§6](../spec/06-operations-and-adapters.md), [§7.6](../spec/07-web-app.md).
