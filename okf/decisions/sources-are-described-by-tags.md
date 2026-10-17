---
type: Decision
title: Sources are described by a title and tags; there are no kinds, folders, organization field or dimensions
description: What a source is, whom it concerns and what it bears on are tags, which people and agents reuse through sources.facets, because a closed list of kinds slowed intake and changed nothing about storage or search, and dimensions only agents could see said what a tag says.
tags: [decision, sources, evidence, tags, mcp, web, product]
generated: {by: agent:claude, at: 2026-10-16}
status: stable
---

# Sources are described by a title and tags; there are no kinds, folders, organization field or dimensions

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

## Decision

- A source is described by its title, its date and its tags. Tags say what the material is
  (`interview`, `workshop`, `deck`, `analysis`), whom it concerns (an organization, a segment) and
  what it bears on. Sources have no `kind`, `folder` or `organization`; a call that names one is
  refused with `422` and a hint to use tags.
- `sources.facets` lists the product's tags, most used first, and the people who added sources.
  Agents read it before tagging and reuse the team's tags; the app offers the most used tags
  wherever tags are written.
- Sources are found by tags, by who added them (an agent's additions count as its person's), by
  when they were added, by their own date, and by words in the title, tags and file names.
- Migration `0017_sources_are_tagged.sql` turns each kind and organization into tags in front of a
  source's own (`other` adds none), in sandbox baselines too, then drops the three columns.
- Sources and assumptions have no `dimensions`, and `sources.list` and `search` no `customer`,
  `product_area` or `lifecycle_stage` filter; a call that names one is refused with `422` and a
  hint to use tags. Migration `0027_drop_dimensions.sql` drops both columns, and the field in
  sandbox baselines, without keeping the values anywhere: they were rarely set and never shown.
- Rejected on 2026-10-16: a per-product registry of dimension values with aliases. Tags reused
  through `sources.facets` do the same work; tags drifting apart is an open question on the
  [roadmap](../spec/10-roadmap.md).
- Rejected: a shorter list of kinds. It is still a choice at intake that changes nothing about
  storage or search.
- Rejected on 2026-10-13: a structured field for where a file came from outside WhatBuild (a
  repository, a commit range). A file's `derivation_note` says so in words.
- Rejected on 2026-10-13: importing agents' session transcripts as sources. A whole session holds
  far more than a team should share; an agent uploads a digest of what its session found instead.
- Rejected: keeping organization as a field. It is one more thing to fill in, and a tag filters
  the same.

## Consequences

- Intake asks for a title, and optionally a date and tags. What a source's kind and organization
  said survives as tags.
- What sources' and assumptions' dimensions said is gone; nothing kept it.
- Tags are free text, so the vocabulary can drift (`interview`, `interviews`). Reading facets first
  and offering the tags in use are the guard; nothing merges or renames a tag across sources yet
  ([roadmap](../spec/10-roadmap.md)).
- The folder browse facet is gone; tags are the only grouping.
- Going back past the release that carries `0017`, or the one that carries `0027`, means
  restoring the database, because each migration drops columns
  ([recovering](../operations/recovering-from-a-bad-release.md)).

## Constrains

- No closed classification of sources (a kind, type or category field), and no structured field
  for whom material concerns or what it bears on, without a new decision. Describe material with
  tags.
- `packages/core/src/source-fields.ts` holds the closed vocabularies a source keeps (provenance
  depth, file role). `sources.facets` is in `packages/core/src/ops/sources.ts`;
  the hint for retired fields is in `packages/core/src/execute.ts`.

Specified in: [04-data-model §4.3, §4.4 and §4.8](../spec/04-data-model.md), [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [07-web-app §7.6](../spec/07-web-app.md), [08-search §8.1 and §8.3](../spec/08-search.md).
