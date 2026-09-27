---
type: Decision
title: The repository is public; okf/ is the single source of documentation
description: Documentation describes the system as it is; session history and private context stay out of the repository.
tags: [decision, okf, process, agents]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# The repository is public; okf/ is the single source of documentation

## Context

The repository is public and MIT-licensed. Agents and people need one accurate place to orient, and nothing private may leak into it or its history.

## Decision

- `okf/` is the source of truth for documentation: charter, system concepts, decisions, specification, operations and process.
- Outside it only: `README.md` (for people), `AGENTS.md` (agent orientation; `CLAUDE.md` links to it), `.agents/skills/` (how agents read and maintain this bundle; [decision](agent-guidance-is-tool-neutral.md)), `PRODUCT.md` and `DESIGN.md` (design records read by tools), and short READMEs where a tool needs one.
- No logs, session notes, requests or to-do lists. Planned work goes in the [roadmap](../spec/10-roadmap.md).
- No private names, local paths, secrets or references to other private work.

## Consequences

- A change that makes a concept untrue updates that concept in the same change.
- `okf/log.md` is gitignored as a guard.

## Constrains

- Run `python3 okf/tools/validate_okf.py` before committing a change to the bundle.

Specified in: [README](../README.md), [working-in-this-repository](../process/working-in-this-repository.md).
