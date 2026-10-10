---
type: Decision
title: "Agent guidance is tool-neutral: AGENTS.md and .agents/skills"
description: Orientation and the documentation procedures live in files any agent can read, with links for tools that look elsewhere.
tags: [decision, agents, skills, okf, process]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# Agent guidance is tool-neutral: AGENTS.md and .agents/skills

## Context

Agents of different kinds work on this repository, and each tool looks for guidance in its own
place. The documentation holds up only if every agent reads it before working and updates it
after, whichever tool it runs in.

## Decision

- `AGENTS.md` is the single orientation file. `CLAUDE.md` is a symlink to it.
- Procedures for agents are skills in `.agents/skills/<name>/SKILL.md`, in the open Agent Skills
  format (a `name` and a `description` in frontmatter, with optional `references/`).
  `.claude/skills` is a symlink to `.agents/skills`.
- There are three skills for the bundle: `okf-orient` (what to read), `okf-update` (keep it true,
  with an impact map from code to concepts and a template per type) and `okf-decision` (record
  decisions).
- A procedure for operating a deployment is a skill of the same kind: `azure-self-host` conducts
  [hosting on Azure](../operations/azure.md), and `recover-a-deployment` conducts
  [recovering from a bad release](../operations/recovering-from-a-bad-release.md). `audit-for-leaks`
  and `triage-security-findings` conduct the [security checks](../operations/security-checks.md).
- Tools that install their own instructions (memory, routing or workflow tools) keep them in the
  user's own configuration, never in `AGENTS.md`, `.agents/skills/` or `okf/`.
- Skills hold procedure. Knowledge about the system stays in `okf/`, and a skill links to it
  rather than copying it.

## Consequences

- Any agent finds the same guidance, and no tool-specific copy can drift.
- A tool that does not load skills can still read the `SKILL.md` files, which `AGENTS.md` names.
- CI runs `python3 okf/tools/validate_okf.py`, so a structurally broken bundle fails the build.

## Constrains

- Do not add guidance under a tool-specific folder. Add it to `.agents/skills/` and link to it if a
  tool needs the file elsewhere.
- When the bundle's layout, types or rules change, update the skills in the same change.
- The product's own agent skill (`packages/core/src/skill/SKILL.md`) is separate. It teaches agents
  to *use* WhatBuild, not to work on this repository.

Specified in: [working in this repository](../process/working-in-this-repository.md).
