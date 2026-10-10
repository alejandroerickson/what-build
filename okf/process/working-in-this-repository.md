---
type: Process
title: How to change this repository
description: The rules every change follows, for people and agents, including what may never be committed.
tags: [process, agents, contributing, public]
generated: {by: agent:claude, at: 2026-09-29}
status: stable
---

# Working in this repository

Agents: the skills in `.agents/skills/` carry the procedures in this bundle. `okf-orient` says
what to read, `okf-update` keeps the bundle true, and `okf-decision` records decisions.

## The repository is public

Everything committed, including history, is published
([decision](../decisions/public-repository-reference-docs.md)).

- No session notes, logs, requests, handoff notes or to-do lists anywhere in the repository.
  Planned work goes in the [roadmap](../spec/10-roadmap.md).
- No secrets, tokens, absolute local paths, or personal details. No names of private projects,
  clients or employers, even when they shaped a change.
- Sample content is synthetic (the Crewboard product in `apps/server/src/seed-content.ts`). Never
  add real customer material, and never present invented material as real.

## Changing behavior

1. **Start from the operation.** Anything the web app or an agent needs is a registered operation
   in `packages/core/src/ops/` with a schema, an access level, activity recording and etags on
   writes ([decision](../decisions/one-registry-two-front-doors.md)). Add server tests in
   `apps/server/test/`, including permission and `409 stale_etag` cases.
2. **Schema changes** are a new forward-only file in `apps/server/src/migrations/`. Never edit an
   applied migration: deployments that ran it keep it, and deployments that restored past it run
   it again, so a fix is a new file after it
   ([recovering from a bad release](../operations/recovering-from-a-bad-release.md)). New content tables carry `tenant_id` and the row-level security policy
   ([decision](../decisions/shared-schema-tenancy-with-row-level-security.md)).
3. **Agents learn from the skill.** If agents should use a new operation differently, update
   `packages/core/src/skill/SKILL.md` and run `pnpm gen:skill`.
4. **Sample data.** Extend the seed so every feature has synthetic sample content.
5. **Interface changes** follow [`DESIGN.md`](../../DESIGN.md) and the
   [Studio decision](../decisions/studio-design-system.md): plain CSS on the tokens, primitives from
   `apps/web/src/ui/`, state in the URL, every state designed (loading, empty, error, archived, no
   permission), keyboard and screen-reader support, WCAG 2.2 AA, phone width, light and dark. Story pages
   never follow the app's tokens ([decision](../decisions/story-pages-follow-the-teams-design-system.md)).
6. **Vocabulary** is fixed ([product spec](../spec/01-product.md)): source, passage, segment,
   outcome, mockup, assumption, Story, archive. Archive is never called deleting.

## Before you finish

- `pnpm typecheck`, `pnpm test` and `pnpm build` pass; for interface changes, run
  `scripts/e2e.mjs` and look at `scripts/shots.mjs` captures
  ([local development](../operations/local-development.md)).
- Check `git status --ignored` for source files a global gitignore may hide (for example files
  named `Icon…`), and add them explicitly.
- Update the bundle: correct every concept the change made untrue, add a
  [decision](../decisions/index.md) for a new durable choice, and run
  `python3 okf/tools/validate_okf.py` (CI runs it too). The `okf-update` skill maps changed code
  to the concepts to check.
- A skill under `.agents/skills/` changes when the bundle's layout or rules change.
