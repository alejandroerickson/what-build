---
type: System Concept
title: Where things are in the repository
description: The workspace layout and the files an engineer or agent reaches for first.
tags: [repository, layout, orientation]
generated: {by: agent:claude, at: 2026-09-27}
status: stable
---

# Repository map

A pnpm workspace: two apps and two libraries.

| Path | What it is |
|---|---|
| `packages/core/src/` | The domain. `registry.ts` (operation definitions), `ops/*.ts` (the 99 operations by area), `policy.ts` (roles and access), `citations.ts`, `story-html.ts` (Story validation and headers), `story-guidance.ts` (agent styling guidance, derived from the design tokens), `story-print.ts` (PDF print view), `kinds.ts` (source kinds), `db.ts` (table types), `skill/` (the agent skill). |
| `packages/parsers/src/` | Pure parsers from bytes to passages: text and Markdown, VTT/SRT cues, DOCX, PDF, HTML, XLSX, CSV/TSV, XML; shared speaker-turn and table-row rules. |
| `apps/server/src/` | The Hono server. `app.ts` (composition), `rest.ts` and `mcp.ts` (the two front doors, generated from the registry), `auth/` (sign-in, sessions, tokens, OAuth server), `uploads.ts`, `worker.ts` (job queue), `migrations/*.sql`, `seed.ts` and `seed-content.ts` (the synthetic sample product), `dev.ts` (local development), `main.ts` (CLI: serve, worker, migrate, seed). |
| `apps/server/test/` | Server tests against an embedded Postgres. |
| `apps/web/src/` | The React app. `main.tsx` (routes), `routes/` (screens), `shell/` (panel, inspector, theme), `ui/` (primitives; `glyph.tsx` wraps the icons), `styles/` (`tokens.css`, `base.css`, `ui.css`, `shell.css`, `screens/*.css`), `lib/` (API client, session, formatting, Markdown), `system/` (a development-only specimen of every primitive at `/_system`). |
| `scripts/` | `e2e.mjs` and `shots.mjs` (Playwright scripts against a running `pnpm dev`), `gen-skill.mjs` (embeds `SKILL.md` into core). |
| `deploy/cloud-run/` | `setup.sh` for the Cloud Run deployment ([guide](../operations/cloud-run.md)). |
| `Dockerfile`, `cloudbuild.yaml` | The production image and its build. |
| `okf/` | This bundle: all documentation. |
| `.agents/skills/` | Skills for agents working on this repository: `okf-orient`, `okf-update`, `okf-decision` ([decision](../decisions/agent-guidance-is-tool-neutral.md)). `.claude/skills` links here. |
| `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` | Product and design records, read by design tooling. |
