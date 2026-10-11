---
type: Decision
title: Story pages are agent-authored HTML shown only in a sandbox
description: Agents publish self-contained HTML pages; the server validates them and serves them into an isolated frame.
tags: [decision, story, security]
generated: {by: agent:claude, at: 2026-10-09}
status: stable
---

# Story pages are agent-authored HTML shown only in a sandbox

## Context

Stakeholder pages benefit from rich layout that agents can write, but that HTML is untrusted.

## Decision

- Pages are one self-contained document: no external resources, forms or frames, bounded inline scripts, at most 1 MB, validated at publish.
- They are served with a sandbox CSP (opaque origin, no network) into an `<iframe sandbox>`.
- Pages follow the product's Story style, never the app's look ([decision](story-pages-follow-the-teams-design-system.md)).
- The app's frame asks for a page with a small script added inside the sandbox: it passes the focus-mode keys to the app, hands a link to another page of the same Story to the app, and opens every other link in a new tab. If a page still loads another address in its place, the app puts the page back and says so.
- The frame sends the app a key's name or a page's slug and nothing else, and the app checks both. A page can therefore ask the app to show another page of its own Story, and cannot send the app anywhere else.
- App pages send `Cross-Origin-Opener-Policy: same-origin`, so a page cannot keep a handle to an app tab it opened and later send it elsewhere.
- Each publish is a new version; the page tree has its own etag; each page keeps notes for agents ([decision](story-notes-are-agent-memory.md)).
- Mockup pages are untrusted in the same way and go through the same rules and the same sandbox, without the app's theme ([decision](mockups-are-versioned-canvases-in-exploration.md)).

## Consequences

- The app cannot style or measure page content directly; the page follows the app theme through a `theme` parameter.
- Pages are untrusted and may still link anywhere, so a page can point a reader at a lookalike site in a new tab; the sandbox keeps it from reaching the app, its session or its data.
- A page's own script can post the same message the frame script does, so a page can move a reader to another page of the same Story without a click. Both pages are the same team's, in the same product, and the reader's back button returns.
- On a mockup's canvas, a page's own script can likewise post the canvas's keys, a zoom or a press, so it can move, zoom or select on the canvas around it. That reaches nothing beyond the view; the app accepts only key names it knows and finite numbers.

## Constrains

- Limits: 50 pages per product, nesting depth 6.

Specified in: [04-data-model](../spec/04-data-model.md), [07-web-app](../spec/07-web-app.md).
