---
type: Decision
title: Sources are described by a title, a date and tags; there are no kinds, folders, organization field, dimensions, participants, source system or provenance
description: What a source is, whom it concerns and what it bears on are tags, which people and agents reuse through sources.facets, because a closed list of kinds slowed intake and changed nothing about storage or search, and the other fields said what a tag or the source's notes say.
tags: [decision, sources, evidence, tags, mcp, web, product]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Sources are described by a title, a date and tags; there are no kinds, folders, organization field, dimensions, participants, source system or provenance

## Context

Every source had a kind from a closed list of 17, a logical folder derived from its kind and date,
and an optional organization field, and intake asked for the kind first. Discovery evidence does
not fit such a list: a meeting transcript, someone's account of a call, an internal write-up of a
customer problem, whiteboard photos from a workshop, a diagram. Every kind was stored, parsed and
searched the same way, so choosing one changed nothing but a label. People look for sources by who
added them, when, words in the title, and what the material concerns. The maintainer chose on
2026-10-10 to replace the taxonomy with tags, which work the same for people and agents.

Sources and assumptions also carried three optional dimensions: a customer, a product area and a
lifecycle stage (discovery, sales or research). The web app never showed them, so only agents
could set them or filter by them, and each said what a tag says. The maintainer chose on
2026-10-16 to remove them.

Sources also carried their participants, the system they came from (`source_system`) and a
provenance depth (primary, derived, analysis of analysis, unknown), and assumptions a provenance
depth too. Intake hid them behind a disclosure, agents filled them unevenly, and none changed how
a source was stored, searched or cited; the details panel showed them as noise. The maintainer
chose on 2026-10-16 to remove them, keeping a source's tags and its three dates.

## Decision

- A source is described by its title, its date and its tags. Tags say what the material is
  (`interview`, `workshop`, `deck`, `analysis`), whom it concerns (an organization, a segment) and
  what it bears on. Sources have no `kind`, `folder` or `organization`; a call that names one is
  refused with `422` and a hint to use tags.
- `sources.facets` lists the product's tags, most used first, and the people who added sources.
  Agents read it before tagging and reuse the team's tags; the app offers the most used tags
  wherever tags are written.
- Sources are found by tags, by who added them (an agent's additions count as its person's), by
  when they were added, by their own date, and by words in the title, tags and attachment names.
- Migration `0017_sources_are_tagged.sql` turns each kind and organization into tags in front of a
  source's own (`other` adds none), in sandbox baselines too, then drops the three columns.
- Sources and assumptions have no `dimensions`, and `sources.list` and `search` no `customer`,
  `product_area` or `lifecycle_stage` filter; a call that names one is refused with `422` and a
  hint to use tags. Migration `0027_drop_dimensions.sql` drops both columns, and the field in
  sandbox baselines, without keeping the values anywhere: they were rarely set and never shown.
- Sources have no `participants`, `source_system` or `provenance_depth`, and assumptions no
  `provenance_depth`; `sources.list` and `search` have no provenance filter. A call that names one
  is refused with `422` and a hint that a source is described by its title, date and tags, and
  that anything else worth keeping goes in its notes. Migration
  `0029_simplify_source_details.sql` drops the four columns, and the fields in sandbox baselines,
  without keeping the values anywhere.
- Rejected on 2026-10-16: a per-product registry of dimension values with aliases. Tags reused
  through `sources.facets` do the same work; tags drifting apart is an open question on the
  [roadmap](../spec/10-roadmap.md).
- Rejected: a shorter list of kinds. It is still a choice at intake that changes nothing about
  storage or search.
- Rejected on 2026-10-13: a structured field for where a file came from outside WhatBuild (a
  repository, a commit range). The source's notes say so in words; attachments carry no
  provenance ([decision](a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
- Rejected on 2026-10-13: importing agents' session transcripts as sources. A whole session holds
  far more than a team should share; an agent can upload a digest of what its session found instead,
  as a source like any other.
- Rejected: keeping organization as a field. It is one more thing to fill in, and a tag filters
  the same.

## Consequences

- Intake asks for a title, and optionally a date and tags. What a source's kind and organization
  said survives as tags.
- What sources' and assumptions' dimensions said is gone; nothing kept it. So are sources'
  participants, source systems and provenance, and assumptions' provenance. Who took part, where
  material came from and how far it sits from the evidence go in a source's title, tags or notes.
- Intake and the details panel show a source's title, date captured, tags, and when it was added
  and updated, and nothing else.
- Tags are free text, so the vocabulary can drift (`interview`, `interviews`). Reading facets first
  and offering the tags in use are the guard; nothing merges or renames a tag across sources yet
  ([roadmap](../spec/10-roadmap.md)).
- The folder browse facet is gone; tags are the only grouping.
- Going back past the release that carries `0017`, `0027` or `0029` means restoring the
  database, because each migration drops columns
  ([recovering](../operations/recovering-from-a-bad-release.md)).

## Constrains

- No closed classification of sources (a kind, type or category field), and no structured field
  for whom material concerns, what it bears on, who took part, where it came from or how derived
  it is, without a new decision. Describe material with tags, and write the rest in its notes.
- A source keeps no closed vocabulary of its own: attachments have no role either.
  `sources.facets` is in `packages/core/src/ops/sources.ts`; the hint for retired fields is in
  `packages/core/src/execute.ts`.

Specified in: [04-data-model §4.3, §4.4 and §4.8](../spec/04-data-model.md), [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [07-web-app §7.6](../spec/07-web-app.md), [08-search §8.1 and §8.3](../spec/08-search.md).
