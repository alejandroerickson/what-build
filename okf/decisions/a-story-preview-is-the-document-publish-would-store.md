---
type: Decision
title: A Story preview is the document publish would store, made by publish's own code, held for its grant's life and served in the page sandbox
description: story.preview takes publish's input, runs publish's checks without writing, keeps the document in a short-lived row and serves it under a download grant exactly as a published page is served.
tags: [decision, story, mcp, security, sandbox]
generated: {by: agent:claude, at: 2026-11-03}
status: stable
---

# A Story preview is the document publish would store, made by publish's own code, held for its grant's life and served in the page sandbox

## Context

The guidance asks agents to look at a page at desktop and phone width, in light and dark, before
publishing. A page published with `body` is wrapped in the product's Story style on the server,
so an agent could not see that document until a version existed, and every look cost a version.
The maintainer chose to build a preview. Alternatives were a stylesheet download for agents to
wrap pages themselves, a dry run that only validated, and a document returned inside the tool
result.

## Decision

- `story.preview` takes exactly `story.publish`'s input. Both call `draftVersion` in
  `packages/core/src/ops/story.ts`, which makes every check and builds the document; publish then
  writes, preview does not. A refusal is publish's own error.
- The document is held in `story_previews`, a row with row-level security, for as long as its
  grant lasts (`WHATBUILD_GRANT_TTL_SECONDS`, 30 minutes by default). A product keeps its 20
  newest, trimmed in one statement that never drops a preview another call made meanwhile, and the
  worker removes expired rows. Rejected: the
  object store (a row is simpler for at most 1 MB of text) and holding nothing (the grant cannot
  carry the document).
- It is served under a grant, never a session, with the same function as a version's HTML: the
  Story's sandbox from `packages/core/src/page-sandbox.ts` (a mockup page's when the version keeps
  showing one), the carried typefaces and `?theme`. Without a content site,
  `GET /api/v1/downloads/story-preview/{id}` takes the grant in a header. With one, the preview's
  `url` is an address there that carries its grant, and the app's host serves no preview
  ([decision](on-a-content-site-a-preview-opens-at-an-address-that-carries-its-grant.md)).
- Preview needs what publish needs (editor, an Edit connection, a product not archived, a plan
  that has not switched writing off), but it is not a write: it records no activity and takes
  nothing from a free organization's daily allowances.
- `get_style` gets no download grant: a preview's document carries the stylesheet as publish
  would place it, so an agent never needs the stylesheet on its own to see a page in the style.

## Consequences

- An agent looks at the exact page before it exists, as often as it likes, without versions.
- Without a content site, a headless browser must send the grant as an extra header, and a tool
  that can only open a URL cannot open a preview; with one, any browser or fetch tool opens it.
- Every preview stores up to about a megabyte for half an hour.

## Constrains

- A check or a change to the document belongs in `draftVersion`, never in publish's handler alone.
- Both preview routes serve through `storyHtml` (`apps/server/src/documents.ts`), as every Story HTML route does.
- Room for a new preview is made by `makeRoomForPreview` (`packages/core/src/previews.ts`), which ranks and deletes in one statement.

Specified in: [04-data-model §4.11](../spec/04-data-model.md), [06-operations-and-adapters](../spec/06-operations-and-adapters.md), [09-data-lifecycle](../spec/09-data-lifecycle.md).
