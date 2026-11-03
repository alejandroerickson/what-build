---
type: Decision
title: On a deployment with a content site, an agent's preview opens at an address that carries its grant
description: Card and Story previews give a url on the content site that any browser or fetch tool opens, with no headers; without a content site they keep the app's route and the header grant.
tags: [decision, security, content-site, story, cards, mcp, agents]
generated: {by: agent:claude, at: 2026-11-03}
status: stable
---

# On a deployment with a content site, an agent's preview opens at an address that carries its grant

## Context

Agents look at a card's front or a Story page before writing it. A preview was served under a grant
in a header, which no ordinary browser or fetch tool sends, so an agent needed a headless browser
that sets extra headers, or a script for each card, and an agent with neither could not look. The
[Story preview decision](a-story-preview-is-the-document-publish-would-store.md) had rejected a
grant in the URL because agents send download grants in a header. Since then the content site
serves every document at an address that carries its grant
([decision](with-a-content-site-every-page-and-inline-file-is-served-from-it.md)), as prototypes
always were. The maintainer chose on 2026-11-03 to give previews such an address.

## Decision

- With a content site, `outcomes.card_preview`, `derived.card_preview` and `story.preview` give
  `url` as `<content>/documents/<grant>/preview.html` and `headers` empty. The grant's purpose is
  `card_preview` or `story_preview`; it names the tenant, the product, the preview (`cp`, `sp`) and
  the requester, and lasts as long as the preview's row.
- The content site's document route serves it as it serves every document: it checks the requester
  again before the first byte, reads no session, sets no cookie and never redirects. It finds the
  preview with the same function as the header route (`findCardPreview`, `findStoryPreview`). Its
  load counts against the requester's calls a minute, as it did, since no app route counted it first.
- Without a content site, previews keep the app's routes and the header grant: no address on the
  app's origin shows an agent's HTML to whoever is given it, which prototypes also refuse there.
- The header routes stay on the content host for grants given before this.
- Rejected: the document in the tool's answer, whose typefaces would fill the agent's context, and
  which still needs a browser to see; a one-time link exchanged for a cookie, which needs state for
  used links and a cookie on a site that holds none.

## Consequences

- Any browser, headless browser or fetch tool opens a preview, at the top level or in a frame.
- The address is a credential until it expires, readable by the preview's own page and kept in a
  browser's history, as a document's and a prototype's are.

## Constrains

- `packages/core/src/previews.ts` gives every preview's address (`previewGrant`) and the words the
  operations use for opening one.

Specified in: [§6.4](../spec/06-operations-and-adapters.md), [§4.11](../spec/04-data-model.md),
[security](../system/security.md).
