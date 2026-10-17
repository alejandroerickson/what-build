---
type: Decision
title: Evidence is found by searching, not kept as citations
description: Nothing structural points from an assumption, a Story page or a mockup to a source; agents search the evidence when they need it, and the Story explains in words.
tags: [decision, evidence, citations, assumptions, story, mockups, agents]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# Evidence is found by searching, not kept as citations

## Context

Assumptions, Story pages and mockups carried citations, each a quote frozen as a snapshot of its
passage and checked for drift, and around them sat a graph: a version's references, a source's
related sources, a view's lineage, and what used each source. Keeping it true cost agents effort on
every write, and its reports of drift were noise more often than news. An agent reads far more
than a team can keep linked, and finds what bears on a piece of work by searching; the
stakeholders who read the Story cannot open the evidence at all
([decision](a-reader-reads-only-the-story.md)). The maintainer chose on 2026-10-16 to remove
citations and the graph around them: WhatBuild is where a team collaborates and keeps its ideas,
not where it builds a case. This replaces [the citation snapshots](citations-snapshot-and-report-drift.md)
and [assumptions that start uncited](register-entries-may-start-uncited.md).

## Decision

- Assumptions, Story page versions and mockup versions cite no passage and list no references;
  sources name no related sources; a view keeps no lineage; nothing reports what uses a source.
- An assumption's body says in words why the team holds it, and it may be recorded before any
  evidence exists. People add and edit entries in the web app until the first review.
- A Story page explains in its own words. It quotes a person only where their words matter,
  attributed in words and without a link to the evidence; which sources it rests on goes in its
  notes.
- Prose may still mention a source by its id ("source 01K…"); the app shows it as a link to the
  source, and nothing records it. A source has no passages to point at
  ([decision](a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
- The citations assumptions held became quotes at the end of their bodies; those of Story and
  mockup versions were dropped, since a page's HTML holds what it quotes.
- Rejected: citations on Story pages alone. A reader cannot follow one, and the quote on the page
  is what a reader needs.

## Consequences

- Writing is cheaper, there is no drift to report, and a source moves between products freely.
- Nothing checks a quote against its source: whether a conclusion still holds is answered by
  reading and searching the evidence.

## Constrains

- No operation takes or returns citations, references, lineage or related sources; migration
  `0028_citations_refs_and_lineage_retired.sql` dropped them.
- The skill and the Story guidance (`packages/core/src/skill/SKILL.md`, `story-guidance.ts`)
  never ask an agent to cite.

Specified in: [§4.7 and §4.8](../spec/04-data-model.md), [§8](../spec/08-search.md).
