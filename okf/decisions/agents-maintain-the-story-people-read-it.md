---
type: Decision
title: Agents write and arrange the Story; the web app reads it
description: Every change to a Story page or its tree goes through an agent over MCP; the web app shows pages, versions and their evidence, and exports them.
tags: [decision, story, agents, web]
generated: {by: agent:claude, at: 2026-09-29}
status: stable
---

# Agents write and arrange the Story; the web app reads it

## Context

The Story is agent-authored HTML ([decision](story-pages-are-sandboxed-agent-html.md)), and agents
keep its structure, notes and archive state as they revise it. Person-facing controls to add,
rename, move, drag, publish, archive or annotate pages duplicated what agents already do, crowded a
screen meant for reading, and let the tree drift from what the agents' notes describe. The owner
chose on 2026-09-28 to make the Story read-only in the web app.

## Decision

- The Story screen has no write controls: no add, rename, move or drag, publish, archive or
  restore, and no editing of notes for agents. A person asks their agent for any of these.
- The screen reads like a wiki: the page tree on the left, the page in the middle under crumbs,
  and its details, versions and export in the inspector. Export to PDF is the one action.
- A version has no change note. The activity log records each version, and the page's notes hold
  an agent's working context.
- The operations are unchanged apart from the note: agents, and REST clients with write access,
  still publish, arrange, archive and restore.

## Consequences

- The Story screen is simpler, and the tree always shows the arrangement agents chose.
- A person without a connected agent cannot change the Story at all.

## Constrains

- Story write controls stay out of `apps/web/src/routes/story*.tsx`; the skill tells agents they
  maintain the Story for people.
- The skill version (`SKILL_VERSION`) moves whenever an operation's input changes shape, as it did
  when `note` left `story.publish` and when `body` and `restyle` joined it.

Specified in: [07-web-app §7.8](../spec/07-web-app.md), [04-data-model §4.11](../spec/04-data-model.md).
