---
type: Decision
title: Story pages are agent-authored HTML shown only in a sandbox
description: Agents publish self-contained HTML pages; the server validates them and serves them into an isolated frame.
tags: [decision, story, security]
generated: {by: agent:claude, at: 2026-11-02}
status: stable
---

# Story pages are agent-authored HTML shown only in a sandbox

## Context

Stakeholder pages benefit from rich layout that agents can write, but that HTML is untrusted.

## Decision

- Pages are one self-contained document: no external resources, forms or frames, bounded inline scripts, at most 1 MB, validated at publish.
- They are served with a sandbox CSP (opaque origin, no network) into an `<iframe sandbox>`: from the app's origin, or, on a deployment with a content site, from there, under a short-lived address the app's own route hands off to ([decision](with-a-content-site-every-page-and-inline-file-is-served-from-it.md)).
- Pages follow the product's Story style, never the app's look ([decision](story-pages-follow-the-teams-design-system.md)).
- The app's frame asks for a page with a small script added inside the sandbox: it passes the focus-mode keys to the app, hands a link to another page of the same Story to the app, and opens every other link in a new tab. If a page still loads another address in its place, the app puts the page back and says so, while it loads as after: every document the app frames says it has loaded (`frame-ready`), and a load that does not is taken for something else.
- The app's own policy (`frame-src`) lets its frames hold only its own origin and its content site's documents and prototypes, so the browser refuses a frame sent to any other site, however and whenever a page sends it; the dev server sends the same. Putting a page back is what keeps WhatBuild's own frame showing that page.
- The frame sends the app a key's name or a page's slug and nothing else, and the app checks both. A page can therefore ask the app to show another page of its own Story, and cannot send the app anywhere else.
- On a mockup's canvas the frame hands over a relative link in the same way, as a page's name the app checks against that version's pages ([decision](a-canvas-whose-pages-link-is-viewed-as-a-clickable-prototype.md)).
- App pages send `Cross-Origin-Opener-Policy: same-origin`, so a page cannot keep a handle to an app tab it opened and later send it elsewhere.
- Each publish is a new version; the page tree has its own etag; each page keeps notes for agents ([decision](story-notes-are-agent-memory.md)).
- A preview of a publish is checked by the same code and served in the same sandbox, under a grant, before any version exists ([decision](a-story-preview-is-the-document-publish-would-store.md)).
- A mockup's prototype, a team's multi-file prototype, is served by a route of its own under a
  capability path, in the same opaque origin with no network beyond its own files, and the frame
  script goes into each of its documents ([decision](mockups-carry-prototypes-served-from-a-capability-path.md)).
- Mockup pages are untrusted in the same way and shown in the same sandbox, without the app's theme, under HTML rules of their own: scripts without a budget, and forms. Their sandbox alone adds `allow-forms`, so a prototype's submit handler runs ([decision](mockups-are-versioned-canvases-in-exploration.md)).
- The rules at publish help authors; the sandbox is the boundary. A page's script budget bounds no capability (a few lines of script can do anything a long one can inside the sandbox), and every response that serves a page says `form-action 'none'`, so no form submission goes anywhere, from either surface, whether the sandbox allows forms or not.

## Consequences

- The app cannot style or measure page content directly; the page follows the app theme through a `theme` parameter.
- Pages are untrusted and may still link anywhere, so a page can point a reader at a lookalike site in a new tab; the sandbox keeps it from reaching the app, its session or its data.
- A page's script can post `frame-ready` itself, then send its frame elsewhere while it loads, and its frame then keeps what it went to: only ever something the same deployment serves, in the same sandbox, or the browser's word that it refused the address, since `frame-src` lets in nothing else. The page could show any words in its own document anyway.
- A page's own script can post the same message the frame script does, so a page can move a reader to another page of the same Story, but only just after the reader did something, and not fast enough to fill the browser's history ([decision](a-canvas-whose-pages-link-is-viewed-as-a-clickable-prototype.md)).
- On a mockup's canvas, a page's own script can likewise post the canvas's keys, a zoom, a press or another page's name, so it can zoom or select on the canvas around it, and move between pages only just after a person did something. It gets a few steps in the browser's Back for each thing a person does, so it cannot fill the history, and the app shows none of its words. That reaches nothing beyond the view; the app accepts only key names it knows and finite numbers.
- A Story page that shows a mockup page shows what the mockup page holds, in the mockup page's sandbox, so the Story may show long scripts and a working form there; its submission goes nowhere, and the print view drops it with the scripts.

## Constrains

- Limits: 50 pages per product, nesting depth 6.

Specified in: [04-data-model](../spec/04-data-model.md), [07-web-app](../spec/07-web-app.md).
