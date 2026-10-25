---
type: Decision
title: The repository is public; okf/ is the single source of documentation
description: Documentation describes the system as it is; session history and private context stay out of the repository.
tags: [decision, okf, process, agents]
generated: {by: agent:claude, at: 2026-10-24}
status: stable
---

# The repository is public; okf/ is the single source of documentation

## Context

The repository is public and MIT-licensed. Agents and people need one accurate place to orient, and nothing private may leak into it or its history. Its GitHub page is also where most people first meet WhatBuild, so since 2026-10-24 its root is kept short and its README is written for people, with the detail in `okf/`.

## Decision

- `okf/` is the source of truth for documentation: charter, system concepts, decisions, specification, operations and process.
- Outside it only: `README.md` (for people), `AGENTS.md` (agent orientation; `.claude/CLAUDE.md` links to it), `.agents/skills/` (how agents read and maintain this bundle; [decision](agent-guidance-is-tool-neutral.md)), `apps/web/PRODUCT.md` and `apps/web/DESIGN.md` (design records read by tools, which look for them from the web app upward), `.github/SECURITY.md` (how to report a vulnerability, which GitHub shows), the end-to-end test plans in `e2e/plans/` (steps an agent follows, which name nothing private; [decision](end-to-end-tests-are-plans-an-agent-runs-on-a-golden-master.md)), and short READMEs where a tool needs one.
- `README.md` is the landing page for people. It says what WhatBuild is and how to try, run and host it, and links into `okf/` for everything longer; it does not repeat the operations guides.
- The root holds only what a tool looks for there: the workspace's own files, the ignore files git, Docker and `gcloud` read from the root, `README.md`, `AGENTS.md` and `LICENSE`. Everything else is in a folder: the image and its build in `deploy/`, the git hooks in `scripts/githooks/`, the design records with the web app, `SECURITY.md` in `.github/`. GitHub lists the root above the README, so every entry there pushes the README down.
- No logs, session notes, requests or to-do lists. Planned work goes in the [roadmap](../spec/10-roadmap.md). Private working material goes in `_private/` at the root of a checkout, which is ignored.
- No private names, local paths, secrets or references to other private work, in files, commit messages or pull requests.

## Consequences

- A change that makes a concept untrue updates that concept in the same change.
- `okf/log.md` and `_private/` are gitignored as guards, and a check at commit, at push and in CI refuses what this decision rules out ([decision](privacy-and-security-checks-live-in-the-repository.md)).
- `scripts/check-publishable.mjs` lists the places files may be, the root's entries among them (`TOP_LEVEL`); a new one is added there. Pictures for the README live in `.github/assets/`.

## Constrains

- Run `python3 okf/tools/validate_okf.py` before committing a change to the bundle.

Specified in: [README](../README.md), [working-in-this-repository](../process/working-in-this-repository.md), [security checks](../operations/security-checks.md), [repository map](../system/repository-map.md).
