---
type: Decision
title: A source carries a summary written for people, freeform notes and comments on the whole source, and no outline
description: Beside its words, a source has a short summary people read, notes agents and people keep, and comments on the source as a whole, because outlines, passage-anchored comments and agent-only notes added granularity nobody used.
tags: [decision, sources, evidence, comments, notes, web, mcp, product]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# A source carries a summary written for people, freeform notes and comments on the whole source, and no outline

## Context

Beside its words, a source held agent notes (a summary, an outline and working notes, written
only by agents), the parser's own outline of a document's headings or a transcript's turns, and
comments anchored to passage ranges. The source page showed the outline and notes together, and
comments inline under passages and in the Notes section. The outline did nothing a reader needed,
comments tied to passage numbers broke the page into fragments, and the summary heading the page
was often written for agents (segment numbers, internal codes). The maintainer chose on
2026-10-16 to simplify what accompanies a source, and on 2026-10-17 to make the summary what
people browse: the page clamped the summary and showed the whole text under it, the reverse of
how people read a source.

## Decision

- The **summary** heads a source's page and is written for people: a few short sentences in plain
  words saying what the source is and what it tells the team, with no ids or codes. People write
  and edit it in the app; agents write it with `derived.write_note`.
- The summary is **what people browse**: the page shows it whole, then the source's images, then
  its text folded to its first lines; the Evidence list unfolds each row's summary to three lines.
  Agents are told it is the part people read, to be succinct and high in signal.
- The **notes** are one freeform Markdown document: whatever is worth keeping about the source
  that is not its words, structured as the writer likes. Agents and people both write them.
- A **comment** is on the source as a whole, never on a part of its text; the page lists comments
  in a Comments section of their own.
- The summary, the notes and the comments are searched with the source's words, its derived text
  ([decision](a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)); an
  archived comment is not.
- There is **no outline**: no agent outline note, no `outline.md` sidecar, no `derived.outline`.
- Rejected: keeping comments on passages beside whole-source ones. Two kinds of comment, one of
  them tied to numbering a re-parse can move, is the granularity this removes.

## Consequences

- Migration `0029_simplify_source_details.sql` deletes agent outlines and drops comments'
  segment ranges and anchors, keeping their text.
- A summary or notes may be written by a person or an agent; the latest writer is shown.
- An agent finds its way through a long source by search and by reading windows of its derived
  text, not by an outline.

## Constrains

- `derived.write_note` and `derived.read_note` take `note_kind` `summary` or `notes` only
  (`packages/core/src/ops/derived.ts`); `sources.annotate` takes no range
  (`packages/core/src/ops/sources.ts`). The agent skill tells agents who the summary is for.
- `sources.list` returns summaries only with `include_summary`, cut at 1,000 characters, so a
  plain list stays small for agents.

Specified in: [04-data-model §4.6](../spec/04-data-model.md), [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [07-web-app §7.6](../spec/07-web-app.md), [08-search](../spec/08-search.md).
