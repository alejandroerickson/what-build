---
type: Decision
title: Renaming a mockup or a Story page changes its name and makes no version, and a later version keeps the name
description: A mockup's or Story page's title is the name it is known by, held on the object; rename changes it in place, and publish keeps it unless it sends a title, so a rename is never a copy of every page and never lost.
tags: [decision, mockups, story, versions, web, agents]
generated: {by: agent:claude, at: 2026-11-18}
status: stable
---

# Renaming a mockup or a Story page changes its name and makes no version, and a later version keeps the name

## Context

A mockup and a Story page each keep a title on the object and one on every version, and until now
only publishing changed it, so only an agent could rename one. The maintainer chose on 2026-11-18
to let people rename both in the web app. A rename made by publishing would copy a whole canvas
(up to 48 pages and 8,000,000 characters of HTML) for a few words, add a version that changes
nothing anyone reads, and tell every Story page that shows the mockup that a newer version exists.

## Decision

- **The title is the object's name.** `mockups.rename` and `story.rename_page` change it on the
  mockup or the page, under its etag, and make no version. Each version keeps the title it was
  published with, as history; the name everything shows (the list, the tree, the crumbs, search,
  a download, a Story reader) is the object's.
- **A later version keeps the name.** `publish` without a title keeps the title the object has now,
  whichever version it starts from (`from_version` included); a title sent renames it. A download's
  manifest gives the mockup's name, so a ZIP published again keeps a rename.
- A rename leaves a Story page's HTML as it is: a heading in the page keeps its words until the next
  version, and a generated title page takes the new title then.
- An archived mockup or page refuses a rename, as it refuses a publish; restore it first.
- Both doors offer it: people in the web app, agents as `mockups_write(action="rename")` and
  `story_write(action="rename_page")`.
- Rejected: renaming by publishing a version with only a new title, for the copies and the noise
  above.

## Consequences

- A version's `title` and the object's can differ; readers of history see what a version was called.
- An agent holding an etag from before a rename is refused once (`409 stale_etag`) and reads again.

## Constrains

- `packages/core/src/ops/mockups.ts` (`renameMockup`, publish's title and `mockupBundle`) and
  `packages/core/src/ops/story.ts` (`renamePage`, `draftVersion`'s title) take an omitted title
  from the object, never from the base version.

Specified in: [04-data-model §4.11 and §4.12](../spec/04-data-model.md), [07-web-app §7.7 and §7.8](../spec/07-web-app.md).
