---
type: Decision
title: Story PDF export is a composed print view saved by the browser
description: The server composes the chosen pages into one print document; the browser's print dialog makes the PDF.
tags: [decision, story, export]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# Story PDF export is a composed print view saved by the browser

## Context

Rendering PDF on the server would need a headless browser in the image, against the small-image, cheap-to-run goal.

## Decision

- The person picks exactly which pages to export in a dialog. A page's menu can open it with the page's subpages selected too, but every selected page is shown and can be cleared before printing.
- Each page prints at its current version. The dialog says what the PDF leaves out: what a page draws on, its citations and notes, and earlier versions.
- Pages print in tree order; each starts with its title as a heading whose level follows its depth among the chosen pages; a contents list comes first.
- Each page is isolated in its own shadow root under a strict CSP; page scripts do not run, so script-drawn content is left out and the dialog says so.

## Consequences

- No PDF engine to maintain.
- Output depends a little on the browser.

## Constrains

- Single-file HTML export is out of scope; the browser can save pages.

Specified in: [07-web-app](../spec/07-web-app.md).
