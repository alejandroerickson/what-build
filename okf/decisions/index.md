---
type: Index
title: Decisions
description: Architectural decision records, each with its context, the choice, and what it constrains.
tags: [index, decisions, adr]
generated: {by: agent:claude, at: 2026-10-07}
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
- [Self-hosting on Azure is done by an agent with the Azure CLI, from instructions in the repository, and shares nothing with the Cloud Run deployment](self-hosting-on-azure-is-agent-led-and-shares-nothing-with-cloud-run.md)
- [Every capability is one registered operation, exposed through both REST and MCP](one-registry-two-front-doors.md)
- [MCP exposes 17 tools, grouped by the kind of object, with an action parameter](mcp-tools-grouped-by-noun.md)
- [Tenants share one schema, partitioned by key and enforced three times](shared-schema-tenancy-with-row-level-security.md)
- [Access is decided in the application, per product, by role](access-is-per-product-roles.md)
- [A reader reads only the Story, never the evidence behind it](a-reader-reads-only-the-story.md)
- [WhatBuild runs its own sign-in and its own OAuth 2.1 server for agents](built-in-identity-and-oauth.md)
- [A scoped MCP connector is a fence, not a default](a-scoped-mcp-connector-is-a-fence.md)
- [An invitation is accepted only by the account with the address it was sent to](invitations-belong-to-their-address.md)
- [The public sandbox is one organization the deployment names, where invited visitors edit under made-up names and a daily reset puts a saved baseline back](the-public-sandbox-is-one-organization-with-pseudonymous-visitors.md)
- [Only the instance's owners decide who may create organizations, and how many](only-instance-owners-decide-who-creates-organizations.md)
- [WhatBuild asks once whether a person accepts cookies, and runs Google Analytics only for those who do](analytics-only-for-people-who-accept-cookies.md)
- [WhatBuild stores only what it needs, says so once, and keeps anything optional off until a person agrees](only-necessary-cookies-and-optional-ones-wait-for-consent.md) (superseded)
- [Every write is attributed, and human or agent authorship is declared](attribution-and-declared-authorship.md)
- [Only a source's primary file is parsed and searched](only-the-primary-file-is-searched.md)
- [Citations freeze a snapshot and report drift; they are never repaired silently](citations-snapshot-and-report-drift.md)
- [Story pages are agent-authored HTML shown only in a sandbox](story-pages-are-sandboxed-agent-html.md)
- [Each Story page keeps notes for agents, separate from its versions](story-notes-are-agent-memory.md)
- [Agents write and arrange the Story; the web app reads it](agents-maintain-the-story-people-read-it.md)
- [Story pages follow the team's design system, never WhatBuild's](story-pages-follow-the-teams-design-system.md)
- [Marking an insight reviewed applies to the revision that was read](insight-review-marks-a-revision.md)
- [Story PDF export is a composed print view saved by the browser](pdf-export-uses-browser-print.md)
- [Archive is the reversible default; delete is permanent and guarded](archive-by-default-delete-guarded.md)
- [Local development may substitute adapters, never behavior](development-substitutes-adapters-never-behavior.md)
- [A product starts with its idea, a product concept and the outcomes its users should achieve](a-product-starts-with-an-idea-concept-and-outcomes.md)
- [The web app uses the Studio design system](studio-design-system.md)
- [The overview is WhatBuild's front door, and the one screen with display type](the-overview-is-the-front-door.md)
- [The public site is one page built with the app, served from Cloudflare's edge or by host from the image](the-public-site-is-one-page-built-with-the-app.md)
- [Lists filter from the panel; a table's header only sorts or searches](lists-filter-from-the-panel.md)
- [An empty list says what belongs in it and what to ask an agent; adding by hand stays in the header](empty-lists-lead-with-the-agent.md)
- [An assumption or decision may be recorded before any evidence cites it](register-entries-may-start-uncited.md)
- [The repository is public; okf/ is the single source of documentation](public-repository-reference-docs.md)
- [Agent guidance is tool-neutral: AGENTS.md and .agents/skills](agent-guidance-is-tool-neutral.md)
- [A release is a tag on main with its image published; deploying it is the deployment's own pipeline](releases-are-tags-with-a-published-image.md)
- [The Cloud Run deployment runs releases only; a release's tag starts its deploy, which waits for approval](production-runs-releases-after-approval.md)
- [Each Cloud Run deploy on Neon branches the database before migrating, as a restore point](each-deploy-branches-the-neon-database-before-migrating.md)
