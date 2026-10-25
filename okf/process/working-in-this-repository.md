---
type: Process
title: How to change this repository
description: The rules every change follows, for people and agents, including what may never be committed.
tags: [process, agents, contributing, public]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Working in this repository

Agents: the skills in `.agents/skills/` carry the procedures in this bundle. `okf-orient` says
what to read, `okf-update` keeps the bundle true, and `okf-decision` records decisions.

## The repository is public

Everything committed, including history, commit messages, pull requests' text, and every issue
and comment, is published ([decision](../decisions/public-repository-reference-docs.md)).

- No session notes, logs, requests, handoff notes or to-do lists anywhere in the repository. They
  go in `_private/` at the root of a checkout, which is ignored. Planned work goes in the
  [roadmap](../spec/10-roadmap.md), never in an issue ([below](#issues)).
- No secrets, tokens, absolute local paths, or personal details. No names of private projects,
  clients or employers, even when they shaped a change.
- Commit messages and pull request descriptions describe the change, never the conversation that
  produced it ([below](#commit-messages-and-pull-request-descriptions)).
- `pnpm install` turns on git hooks that refuse a commit or push carrying any of this, and CI
  checks again ([security checks](../operations/security-checks.md),
  [decision](../decisions/privacy-and-security-checks-live-in-the-repository.md)). When a hook
  blocks, fix the content; never `--no-verify`. A false positive, or a new place files may live, is
  fixed in `scripts/check-publishable.mjs` in the same commit.
- Sample content is synthetic (the Crewboard product in `apps/server/src/seed-content.ts`). Never
  add real customer material, and never present invented material as real.

## Commit messages and pull request descriptions

Both are published with the code, to readers who were not there. Write them so they stand alone:

- **What changes**, for whom, and why it is right.
- **What a deployment must do**, if anything: the line the change adds to
  [upgrading](../operations/upgrading.md).
- **What was checked**, as results: "`pnpm test` passes (572 tests); a page dragged in the tree
  keeps its place after a reload."

Never:

- **An account of the work.** No *I* or *we*, no order in which things were tried, no record of
  what was asked, by whom, or of what an agent was told.
- **References to material outside the repository**: a findings list, notes in `_private/`, labels
  such as *N3* from a report the reader cannot open, *the next session*.
- **A link to an agent's session or a chat.** Some tools add one, or a `Claude-Session:` trailer,
  by themselves; take it out.
- **Private names or real data**: private projects, clients, employers, machines; names, counts or
  quotes from a copy of production.

The hooks and CI refuse much of this (`identity`, `session-link`, `narration` in the
[security checks](../operations/security-checks.md#what-the-publishable-check-refuses)); the rest
is judgement. An edited pull request description is checked again.

## Issues

The repository's issues are for reports from people who use, run or contribute to WhatBuild: a bug,
a request, a question. The maintainer's own work is never an issue here, and an agent working for
the maintainer opens none. What it finds goes to the person, and planned work that may be public
goes in the [roadmap](../spec/10-roadmap.md).

Triaging a report, when asked:

- Read it, and reproduce it locally on the sample content (`pnpm dev`) where you can.
- With the person's agreement for each, label it (`bug`, `enhancement`, `documentation`,
  `question`), ask the reporter for what is missing, or close it with the reason: a duplicate, fixed
  in a release, or working as documented, with the link.
- A fix is a pull request whose description says `Fixes #<n>`.
- A report of a vulnerability: add nothing to it, and tell the person at once. It belongs in a
  private report ([security policy](../../.github/SECURITY.md)).
- A reply follows the rules for pull request text above: no account of the work, no link to a
  session, no private names, nothing from a copy of production.

## Changing behavior

1. **Start from the operation.** Anything the web app or an agent needs is a registered operation
   in `packages/core/src/ops/` with a schema, an access level, activity recording and etags on
   writes ([decision](../decisions/one-registry-two-front-doors.md)). Add server tests in
   `apps/server/test/`, including permission and `409 stale_etag` cases, and classify it in
   `apps/server/test/tenant-isolation.test.ts`, which fails until you do.
2. **Schema changes** are a new forward-only file in `apps/server/src/migrations/`. Never edit an
   applied migration: deployments that ran it keep it, and deployments that restored past it run
   it again, so a fix is a new file after it
   ([recovering from a bad release](../operations/recovering-from-a-bad-release.md)). New content tables carry `tenant_id` and the row-level security policy
   ([decision](../decisions/shared-schema-tenancy-with-row-level-security.md)); a table that may not
   have it is listed in `apps/server/test/row-level-security.test.ts` with the reason the
   specification gives.
3. **Agents learn from the skill.** If agents should use a new operation differently, update
   `packages/core/src/skill/SKILL.md` and run `pnpm gen:skill`.
4. **Sample data.** Extend the seed so every feature has synthetic sample content.
5. **Interface changes** follow [`DESIGN.md`](../../apps/web/DESIGN.md) and the
   [Studio decision](../decisions/studio-design-system.md): plain CSS on the tokens, primitives from
   `apps/web/src/ui/`, state in the URL, every state designed (loading, empty, error, archived, no
   permission), keyboard and screen-reader support, WCAG 2.2 AA, phone width, light and dark. Story pages
   never follow the app's tokens ([decision](../decisions/story-pages-follow-the-teams-design-system.md)).
6. **Vocabulary** is fixed ([product spec](../spec/01-product.md)): source, derived text,
   attachment, outcome, mockup, prototype (the multi-file part a mockup version may carry),
   assumption, Story, archive. Archive is never called deleting, and an attachment is never
   called a file.

## Before you finish

- `pnpm typecheck`, `pnpm test` and `pnpm build` pass; for interface changes, run
  `scripts/e2e.mjs` and look at `scripts/shots.mjs` captures; for a change across both doors,
  have an agent run the [end-to-end test plans](../operations/end-to-end-tests.md) it touches
  ([local development](../operations/local-development.md)).
- A change that asks something of a deployment (a setting, an identity provider step, a minimum
  version, a behaviour people will notice) has its line under Unreleased in
  [upgrading](../operations/upgrading.md).
- A dependency you added or upgraded leaves `pnpm security` clean, or its finding is accepted
  with a reason and an expiry ([security checks](../operations/security-checks.md)).
- Check `git status --ignored` for source files a global gitignore may hide (for example files
  named `Icon…`), and add them explicitly.
- Update the bundle: correct every concept the change made untrue, add a
  [decision](../decisions/index.md) for a new durable choice, and run
  `python3 okf/tools/validate_okf.py` (CI runs it too). The `okf-update` skill maps changed code
  to the concepts to check.
- A skill under `.agents/skills/` changes when the bundle's layout or rules change.
