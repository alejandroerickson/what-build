---
type: Decision
title: One search covers the whole product and reads plain words, with no model and no index of its own
description: People search everything in a product from one place, as they type, by deterministic word matching on the database's own text search, so no search calls a model or needs an index built for it.
tags: [decision, search, web]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# One search covers the whole product and reads plain words, with no model and no index of its own

## Context

Search was split by screen: Evidence's panel searched passages on Enter or narrowed titles as you
typed, assumptions could be found only through an advanced ranked grammar, and mockups, outcomes and
the Story could not be searched at all. A person had to know where something lived, and learn a
boolean grammar, before they could find it. Semantic search would forgive more, but it needs a model
and an index of embeddings, which WhatBuild does not have ([decision](no-ai-in-the-product.md)) and
which would cost money on every search. The maintainer chose one plain-word search on 2026-10-11.

## Decision

- One search over everything in a product: sources (what each says: its title, tags, summary,
  derived text, notes and comments, [decision](a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)),
  assumptions, outcomes, mockups, Story pages and the product concept. In the web app it is the palette (⌘K, `/`, or the
  panel's Search field, on every product screen) and the Search screen, where results sit under
  the four areas, Idea, Evidence, Exploration and Story.
- It reads words the way people type them, deterministically: any order, forgiving endings, the
  last word as a prefix, typos corrected from the product's own words and said so, and partial
  matches named when nothing holds every word. It is `search`'s `plain` mode, so agents have it too.
- It runs on the text search already in Postgres (stored `tsvector`s and `pg_trgm`), over the
  same index of sources' texts the other modes read (`text_chunks`): no model, no embeddings, no
  index built for it, no call that costs per search.
- Rejected: semantic search as the default, which needs a model and an index of embeddings; and
  separate searches per screen, which make people know where something lives first.

## Consequences

- Anything typed finds something across the product, and results arrive while typing.
- It matches words, not meaning: a synonym the product never uses finds nothing.
- Each search scans the pieces of the product's sources' texts and its pages; a very large
  product would need its candidate query bounded more tightly.

## Constrains

- The query reading lives in `packages/core/src/plain-query.ts` and the search in
  `packages/core/src/ops/plain-search.ts`, served as `search`'s `plain` mode, not a new operation.
- A new kind of thing a person can find joins plain search and an area on the Search screen.

Specified in: [08-search §8.2](../spec/08-search.md), [07-web-app §7.2](../spec/07-web-app.md).
