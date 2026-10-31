---
type: Decision
title: Agents write the Story; people read it, and may arrange, archive and delete its pages by hand
description: Only agents write a Story page's content, notes and style; in the web app people also drag pages into place, archive, restore and delete them, which is often quicker by hand than through an agent.
tags: [decision, story, agents, web]
generated: {by: agent:claude, at: 2026-10-30}
status: stable
---

# Agents write the Story; people read it, and may arrange, archive and delete its pages by hand

## Context

The Story is agent-authored HTML ([decision](story-pages-are-sandboxed-agent-html.md)). From
2026-09-28 the web app read it and changed nothing, so a person asked an agent to move a page,
archive one or take one out ([superseded decision](agents-maintain-the-story-people-read-it.md)).
Arranging a tree and clearing out pages are small, visual acts that are quicker to do by hand,
the way a wiki's page tree is rearranged, than to describe to an agent. The maintainer chose on
2026-10-14 to bring back dragging pages into place, and to let people archive and delete pages in
the app.

## Decision

- **Agents write.** A page's content, title, versions, notes for agents and the Story style come
  only from agents. The app has no add, rename, publish, note editing or style setting.
- **People arrange.** An editor drags a page by its handle, or moves it with Alt and the arrow
  keys, to reorder it or nest it in the tree (at most six levels), whatever the page shows: its own
  HTML, a mockup page or a whole canvas. A save places every page the tree shows, so a page no agent
  had placed stays where the person sees it.
- **People archive, restore and delete.** An editor archives a page from its row's menu or the
  inspector, with an Undo that puts the page back where it stood, and restores one from the
  Archived pages or the archived page's notice. An admin deletes one permanently through the one
  delete dialog ([decision](archive-by-default-delete-guarded.md)).
- A person may still promote a mockup page or a whole canvas from the mockup
  ([decision](mockups-are-versioned-canvases-in-exploration.md)).
- Carried over unchanged: pages not yet placed sit at the end of the tree; a version has no change
  note; **the Story is where agents present anything to people**, served by a page, not by a new
  type and screen (the maintainer's choice of 2026-10-13).

## Consequences

- A person without a connected agent can tidy the Story but not write it.
- Agents and people both change the tree, guarded by the hierarchy's etag: a move that meets a
  newer tree is applied to it again once, and otherwise the person is told.

## Constrains

- The tree's moves are pure functions in `apps/web/src/routes/story-model.ts`, saved through
  `story.set_hierarchy`; the page actions are in `apps/web/src/routes/story-actions.tsx`. No write
  control for a page's content, notes or style goes into `apps/web/src/routes/story*.tsx`.
- The guide says that people may move, archive and delete pages by hand, and that a person may have
  moved pages since an agent last read the hierarchy.

Specified in: [07-web-app §7.8](../spec/07-web-app.md), [04-data-model §4.11](../spec/04-data-model.md).
