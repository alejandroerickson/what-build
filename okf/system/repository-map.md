---
type: System Concept
title: Where things are in the repository
description: The workspace layout and the files an engineer or agent reaches for first.
tags: [repository, layout, orientation]
generated: {by: agent:claude, at: 2026-10-09}
status: stable
---

# Repository map

A pnpm workspace: two apps and two libraries.

| Path | What it is |
|---|---|
| `packages/core/src/` | The domain. `registry.ts` (operation definitions), `ops/*.ts` (the 125 operations by area), `policy.ts` (roles and access), `public-sandbox.ts` (the public sandbox: settings, limits, the schedule, a visitor's made-up name), `public-sandbox-baseline.ts` (saving a baseline and resetting to one), `citations.ts`, `text-edits.ts` (exact edits, diffs, word counts), `id-aliases.ts` (accepted id aliases), `story-html.ts` (Story validation and headers), `story-guidance.ts` (agent authoring guidance: style workflow, taste, design passes), `story-styles.ts` (the house styles), `story-theme.ts` (what the app's frame adds to a page), `story-print.ts` (PDF print view), `kinds.ts` (source kinds), `db.ts` (table types), `skill/` (the agent skill). |
| `packages/parsers/src/` | Pure parsers from bytes to passages: text and Markdown, VTT/SRT cues, DOCX, legacy Word `.doc`, PDF, HTML, XLSX, CSV/TSV, XML; shared speaker-turn and table-row rules. |
| `apps/server/src/` | The Hono server. `app.ts` (composition), `rest.ts` and `mcp.ts` (the two front doors, generated from the registry), `auth/` (sign-in, sessions, tokens, OAuth server), `uploads.ts`, `site.ts` (the public site's host and interest form), `worker.ts` (job queue), `public-sandbox.ts` (naming the sandbox at start-up, running a reset that is due, what an invitation link shows), `migrations/*.sql`, `seed.ts` and `seed-content.ts` (the synthetic sample product), `dev.ts` (local development), `main.ts` (CLI: serve, worker, migrate, seed). |
| `apps/server/test/` | Server tests against an embedded Postgres. |
| `apps/web/src/` | The React app. `main.tsx` (routes), `routes/` (screens), `shell/` (panel, inspector, theme), `ui/` (primitives; `glyph.tsx` wraps the icons), `styles/` (`tokens.css`, `base.css`, `ui.css`, `shell.css`, `screens/*.css`), `lib/` (API client, session, formatting, Markdown), `system/` (a development-only specimen of every primitive at `/_system`), `site/` (the public site's page; its HTML entry is `apps/web/site/index.html`). |
| `scripts/` | `e2e.mjs` and `shots.mjs` (Playwright scripts against a running `pnpm dev`), `gen-skill.mjs` (embeds `SKILL.md` into core). |
| `deploy/cloud-run/` | `setup.sh` for the Cloud Run deployment ([guide](../operations/cloud-run.md)). |
| `deploy/azure/` | `containerapp.yaml`, the container app's definition for a self-hosted deployment on Azure, which an agent sets up with the Azure CLI ([guide](../operations/azure.md)). |
| `deploy/cloudflare/` | `worker.js` and `wrangler.toml`: on Cloudflare's free plan, the public site from the edge and the app's domain from the Cloud Run service. |
| `Dockerfile`, `cloudbuild.yaml` | The production image and its build. |
| `okf/` | This bundle: all documentation. |
| `.agents/skills/` | Skills for agents working on this repository: `okf-orient`, `okf-update`, `okf-decision` ([decision](../decisions/agent-guidance-is-tool-neutral.md)), `azure-self-host`, the procedure for [hosting on Azure](../operations/azure.md), `make-a-release`, for [releasing](../operations/releasing.md), and `recover-a-deployment`, for [recovering from a bad release](../operations/recovering-from-a-bad-release.md). `.claude/skills` links here. |
| `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` | Product and design records, read by design tooling. |
