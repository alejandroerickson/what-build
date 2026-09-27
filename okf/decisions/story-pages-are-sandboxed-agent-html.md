---
type: Decision
title: Story pages are agent-authored HTML shown only in a sandbox
description: Agents publish self-contained HTML pages; the server validates them and serves them into an isolated frame.
tags: [decision, story, security]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Story pages are agent-authored HTML shown only in a sandbox

## Context

Stakeholder pages benefit from rich layout that agents can write, but that HTML is untrusted.

## Decision

- Pages are one self-contained document: no external resources, forms or frames, bounded inline scripts, at most 1 MB, validated at publish.
- They are served with a sandbox CSP (opaque origin, no network) into an `<iframe sandbox>`.
- Styling guidance for agents (`packages/core/src/story-guidance.ts`) derives its tokens from the design system; a test fails if they drift.
- Each publish is a new version; the page tree has its own etag; each page keeps notes for agents ([decision](story-notes-are-agent-memory.md)).

## Consequences

- The app cannot style or measure page content directly; the page follows the app theme through a `theme` parameter.

## Constrains

- Limits: 50 pages per product, nesting depth 6.

Specified in: [04-data-model](../spec/04-data-model.md), [07-web-app](../spec/07-web-app.md).
