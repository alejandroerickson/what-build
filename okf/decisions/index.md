---
type: Index
title: Decisions
description: Architectural decision records, each with its context, the choice, and what it constrains.
tags: [index, decisions, adr]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# Decisions

Architectural decision records. If work contradicts a decision here, the
decision wins, or it is revisited explicitly: mark the old record `deprecated`,
name what replaced it, and date the change. Smaller decisions are marked
`◆ Decision` inside the [specification](../spec/index.md).

- [WhatBuild contains no AI; agents bring the intelligence over MCP](no-ai-in-the-product.md)
- [Postgres is the only database: rows, search and the job queue](postgres-is-the-only-database.md)
- [One stateless container image serves everything and runs the worker](one-stateless-image.md)
- [Every capability is one registered operation, exposed through both REST and MCP](one-registry-two-front-doors.md)
- [MCP exposes 16 tools, grouped by the kind of object, with an action parameter](mcp-tools-grouped-by-noun.md)
- [Tenants share one schema, partitioned by key and enforced three times](shared-schema-tenancy-with-row-level-security.md)
- [Access is decided in the application, per product, by role](access-is-per-product-roles.md)
- [WhatBuild runs its own sign-in and its own OAuth 2.1 server for agents](built-in-identity-and-oauth.md)
- [Every write is attributed, and human or agent authorship is declared](attribution-and-declared-authorship.md)
- [Only a source's primary file is parsed and searched](only-the-primary-file-is-searched.md)
- [Citations freeze a snapshot and report drift; they are never repaired silently](citations-snapshot-and-report-drift.md)
- [Story pages are agent-authored HTML shown only in a sandbox](story-pages-are-sandboxed-agent-html.md)
- [Each Story page keeps notes for agents, separate from its versions](story-notes-are-agent-memory.md)
- [Marking an insight reviewed applies to the revision that was read](insight-review-marks-a-revision.md)
- [Story PDF export is a composed print view saved by the browser](pdf-export-uses-browser-print.md)
- [Archive is the reversible default; delete is permanent and guarded](archive-by-default-delete-guarded.md)
- [Local development may substitute adapters, never behavior](development-substitutes-adapters-never-behavior.md)
- [A product starts with its idea, a product concept and the outcomes its users should achieve](a-product-starts-with-an-idea-concept-and-outcomes.md)
- [The web app uses the Studio design system](studio-design-system.md)
- [The overview is WhatBuild's front door, and the one screen with display type](the-overview-is-the-front-door.md)
- [The repository is public; okf/ is the single source of documentation](public-repository-reference-docs.md)
- [Agent guidance is tool-neutral: AGENTS.md and .agents/skills](agent-guidance-is-tool-neutral.md)
