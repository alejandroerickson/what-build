---
type: Decision
title: Each Story page keeps notes for agents, separate from its versions
description: A per-page Markdown note records purpose, what is still to fold in and structural choices, so the next agent can maintain the page.
tags: [decision, story, agents]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# Each Story page keeps notes for agents, separate from its versions

## Context

Story pages are revised by different agents over weeks. Without shared memory each agent re-derives why the page is shaped as it is.

## Decision

- `story.write_notes` stores Markdown notes on the page, with their own etag, not versioned with the HTML.
- `story.get_page` returns them. The guide says what they are and how they are written.
- People read them in the Story inspector; only agents write them ([decision](agents-write-the-story-people-arrange-it.md)).

## Consequences

- Editing notes and publishing never block each other.

## Constrains

- Notes are for maintenance context, not stakeholder content.

Specified in: [04-data-model](../spec/04-data-model.md).
