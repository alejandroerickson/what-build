---
type: Decision
title: The repository is public; okf/ is the single source of documentation
description: Documentation describes the system as it is; session history and private context stay out of the repository.
tags: [decision, okf, process, agents]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# The repository is public; okf/ is the single source of documentation

## Context

The repository is public and MIT-licensed. Agents and people need one accurate place to orient, and nothing private may leak into it or its history.

## Decision

- `okf/` is the source of truth for documentation: charter, system concepts, decisions, specification, operations and process.
- Outside it only: `README.md` (for people), `AGENTS.md` (agent orientation; `CLAUDE.md` links to it), `.agents/skills/` (how agents read and maintain this bundle; [decision](agent-guidance-is-tool-neutral.md)), `PRODUCT.md` and `DESIGN.md` (design records read by tools), `SECURITY.md` (how to report a vulnerability, which GitHub shows), and short READMEs where a tool needs one.
- No logs, session notes, requests or to-do lists. Planned work goes in the [roadmap](../spec/10-roadmap.md). Private working material goes in `_private/` at the root of a checkout, which is ignored.
- No private names, local paths, secrets or references to other private work, in files, commit messages or pull requests.

## Consequences

- A change that makes a concept untrue updates that concept in the same change.
- `okf/log.md` and `_private/` are gitignored as guards, and a check at commit, at push and in CI refuses what this decision rules out ([decision](privacy-and-security-checks-live-in-the-repository.md)).
- `scripts/check-publishable.mjs` lists the places files may be; a new one is added there.

## Constrains

- Run `python3 okf/tools/validate_okf.py` before committing a change to the bundle.

Specified in: [README](../README.md), [working-in-this-repository](../process/working-in-this-repository.md), [security checks](../operations/security-checks.md).
