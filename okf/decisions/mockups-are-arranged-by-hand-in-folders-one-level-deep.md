---
type: Decision
title: Mockups are arranged by hand, in folders one level deep that everyone in the product shares
description: A mockup sits in one folder or in none, people and agents order the folders and the mockups in them by hand, and arranging changes no mockup, so a team keeps a busy Exploration legible without hiding work from one another.
tags: [decision, mockups, exploration, web, agents]
generated: {by: agent:claude, at: 2026-11-13}
status: stable
---

# Mockups are arranged by hand, in folders one level deep that everyone in the product shares

## Context

In practice much of a team's work happens on mockup canvases, made by several people for different
purposes. The panel listed them flat, most recently changed first, so a product with a few dozen
read as clutter, and the list reshuffled whenever anyone published. Three ways to tidy it were
live: limit who sees each mockup, tag them, or put them in folders. The maintainer chose folders on
2026-11-13, shared by the product, with the folders and their contents ordered by hand, and agents
able to arrange as people do.

## Decision

- A mockup sits in one folder or in none. A folder holds mockups and no folders, and a product holds
  as many as the team makes. People see the mockups in no folder first, then each folder with its own.
- The order is given by hand: the folders, the mockups in each, and the mockups in none. Nothing
  reorders them by itself. A new mockup goes first where it is put, so new work is seen.
- There is one arrangement, which everyone in the product sees and any editor changes, in the web
  app by dragging, with the keyboard or from a row's menu, and through the same operations an agent
  calls. Only which folders are folded away is a person's own, kept in their browser.
- Arranging is no change to a mockup: no version, no new etag, and the same address. A move names
  what it goes beside, not a whole order, and takes no etag.
- Removing a folder deletes nothing: its mockups go to no folder.
- Rejected: visibility limited to some people. A product's roles say who reads it, and a viewer
  reads everything; a mockup some cannot see would have to hold in search, export, the activity
  log, the Story and every agent connection, to tidy a list.
- Rejected: tags. A mockup belongs in one place, a product holds at most 50, and a list filtered
  by tag shows less at a glance than folders that open and close.
- Rejected: an arrangement of each person's own. A folder's name is how people and agents say
  where a mockup is, which only a shared one can do.
- Sources keep tags and no folders
  ([decision](sources-are-described-by-tags.md)): they run to thousands, concern several things
  at once and are found by searching, where mockups are few, browsed, and each made for one purpose.

## Consequences

- Someone may move a mockup another person is looking for. Its address is unchanged, search finds
  it by title, the activity log records each move, and its crumbs name its folder.
- A mockup an agent publishes lands in no folder unless the agent names one, for a person or an
  agent to file.
- The list no longer shows what changed most recently; the activity log does.

## Constrains

- The arrangement is `mockups.folder_id` and `position` and the `mockup_folders` table
  (`apps/server/src/migrations/0047_mockup_folders.sql`); its operations are in
  `packages/core/src/ops/mockup-folders.ts`, and no other write changes a mockup's place but
  `mockups.publish`, which places a new one.
- The panel's tree is `apps/web/src/routes/mockup-tree.tsx`, its moves pure functions in
  `mockup-folders-model.ts`. Folders are not nested, and no screen filters mockups by anything.
- The guide's `mockups` topic says that people arrange mockups by hand, so an order read earlier
  may have changed.

Specified in: [04-data-model §4.12](../spec/04-data-model.md), [07-web-app §7.7](../spec/07-web-app.md), [06-operations-and-adapters](../spec/06-operations-and-adapters.md).
