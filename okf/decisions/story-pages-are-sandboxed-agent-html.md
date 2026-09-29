---
type: Decision
title: Story pages are agent-authored HTML shown only in a sandbox
description: Agents publish self-contained HTML pages; the server validates them and serves them into an isolated frame.
tags: [decision, story, security]
generated: {by: agent:claude, at: 2026-09-29}
status: stable
---

# Story pages are agent-authored HTML shown only in a sandbox

## Context

Stakeholder pages benefit from rich layout that agents can write, but that HTML is untrusted.

## Decision

- Pages are one self-contained document: no external resources, forms or frames, bounded inline scripts, at most 1 MB, validated at publish.
- They are served with a sandbox CSP (opaque origin, no network) into an `<iframe sandbox>`.
- Pages follow the product's Story style, never the app's look ([decision](story-pages-follow-the-teams-design-system.md)).
- The app's frame asks for a page with a small script added inside the sandbox: it passes the focus-mode keys to the app and opens links in a new tab. If a page still loads another address in its place, the app puts the page back and says so.
- App pages send `Cross-Origin-Opener-Policy: same-origin`, so a page cannot keep a handle to an app tab it opened and later send it elsewhere.
- Each publish is a new version; the page tree has its own etag; each page keeps notes for agents ([decision](story-notes-are-agent-memory.md)).

## Consequences

- The app cannot style or measure page content directly; the page follows the app theme through a `theme` parameter.
- Pages are untrusted and may still link anywhere, so a page can point a reader at a lookalike site in a new tab; the sandbox keeps it from reaching the app, its session or its data.

## Constrains

- Limits: 50 pages per product, nesting depth 6.

Specified in: [04-data-model](../spec/04-data-model.md), [07-web-app](../spec/07-web-app.md).
