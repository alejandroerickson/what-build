---
type: System Concept
title: Where things are in the repository
description: The workspace layout and the files an engineer or agent reaches for first.
tags: [repository, layout, orientation]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# Repository map

A pnpm workspace: two apps and two libraries.

| Path | What it is |
|---|---|
| `packages/core/src/` | The domain. `registry.ts` (operation definitions), `ops/*.ts` (the 108 operations by area), `policy.ts` (roles and access), `public-sandbox.ts` (the public sandbox: settings, limits, the schedule, a visitor's made-up name), `public-sandbox-baseline.ts` (saving a baseline and resetting to one), `evidence-move.ts` (moving retired insights and decisions into Evidence, run by the worker), `citations.ts`, `text-edits.ts` (exact edits and diffs), `id-aliases.ts` (accepted id aliases), `story-html.ts` (Story validation and headers), `story-guidance.ts` (agent authoring guidance: style workflow, taste, design passes), `story-styles.ts` (the house styles), `story-theme.ts` (what the app's frame adds to a page), `story-print.ts` (PDF print view), `source-fields.ts` (the closed vocabularies a source keeps: provenance depth, lifecycle stage, file role), `safe-next.ts` (where a sign-in may return to; the web app imports it as `@whatbuild/core/safe-next`), `db.ts` (table types), `skill/` (the agent skill). |
| `packages/parsers/src/` | Pure parsers from bytes to passages: text and Markdown, VTT/SRT cues, DOCX, legacy Word `.doc`, PDF, HTML, XLSX, CSV/TSV, XML; shared speaker-turn and table-row rules. |
| `apps/server/src/` | The Hono server. `app.ts` (composition), `rest.ts` and `mcp.ts` (the two front doors, generated from the registry), `auth/` (sign-in, sessions, tokens, OAuth server, and `page.ts`, the pages they render), `uploads.ts`, `site.ts` (the public site's host and interest form), `worker.ts` (job queue), `parse-thread.ts` and `parse-worker.ts` (the worker thread each file is parsed in, with its limits), `public-sandbox.ts` (naming the sandbox at start-up, running a reset that is due, what an invitation link shows), `migrations/*.sql`, `seed.ts` and `seed-content.ts` (the synthetic sample product), `dev.ts` (local development), `fixture.ts` (pulling and loading a copy of production), `e2e.ts`, `e2e-golden.ts`, `e2e-browser.ts` and `e2e-mcp.ts` (the instance and its golden master, the browser driver and the MCP client of the [end-to-end tests](../operations/end-to-end-tests.md)), `main.ts` (CLI: serve, worker, migrate, seed). |
| `apps/server/test/` | Server tests against an embedded Postgres. |
| `apps/web/src/` | The React app. `main.tsx` (routes), `routes/` (screens), `shell/` (panel, inspector, theme), `ui/` (primitives; `glyph.tsx` wraps the icons), `styles/` (`tokens.css`, `base.css`, `ui.css`, `shell.css`, `screens/*.css`), `lib/` (API client, session, formatting, Markdown), `system/` (a development-only specimen of every primitive at `/_system`), `site/` (the public site's page; its HTML entry is `apps/web/site/index.html`). |
| `e2e/plans/` | The [end-to-end test plans](../operations/end-to-end-tests.md) an agent runs through the web app and MCP, and their format (`README.md`). |
| `scripts/` | `e2e.mjs` and `shots.mjs` (Playwright scripts against a running `pnpm dev`), `gen-skill.mjs` (embeds `SKILL.md` into core), `check-publishable.mjs` (nothing private is published), `security.mjs` (`pnpm security`), `tools.mjs` (the pinned scanners), `attention.mjs` (`pnpm attention`: what is waiting) ([security checks](../operations/security-checks.md)). |
| `.githooks/` | The git hooks `pnpm install` turns on: `pre-commit`, `commit-msg` and `pre-push` run the publishable check. |
| `.github/` | Workflows (`ci.yml`, `security.yml`, `codeql.yml`, `release.yml`), `dependabot.yml`, and the scanners' settings: `gitleaks.toml`, `osv-scanner.toml` (accepted vulnerabilities), `zap-rules.tsv`. |
| `deploy/cloud-run/` | `setup.sh` for the Cloud Run deployment ([guide](../operations/cloud-run.md)). |
| `deploy/azure/` | `containerapp.yaml`, the container app's definition for a self-hosted deployment on Azure, which an agent sets up with the Azure CLI ([guide](../operations/azure.md)). |
| `deploy/cloudflare/` | `worker.js` and `wrangler.toml`: on Cloudflare's free plan, the public site from the edge and the app's domain from the Cloud Run service. |
| `Dockerfile`, `cloudbuild.yaml` | The production image and its build. |
| `okf/` | This bundle: all documentation. |
| `.agents/skills/` | Skills for agents working on this repository: `okf-orient`, `okf-update`, `okf-decision` ([decision](../decisions/agent-guidance-is-tool-neutral.md)), `azure-self-host`, the procedure for [hosting on Azure](../operations/azure.md), `make-a-release`, for [releasing](../operations/releasing.md), `rehearse-on-the-dev-deployment`, for [the dev deployment](../operations/dev-deployment.md) and the restore drill in [backups](../operations/backups.md), `recover-a-deployment`, for [recovering from a bad release](../operations/recovering-from-a-bad-release.md), `test-on-a-copy-of-production`, for [a copy of production](../operations/a-copy-of-production.md), and `audit-for-leaks` and `triage-security-findings`, for the [security checks](../operations/security-checks.md), and `run-end-to-end-tests`, for the [end-to-end tests](../operations/end-to-end-tests.md). `.claude/skills` links here. |
| `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` | Product and design records, read by design tooling. |
| `SECURITY.md` | How to report a vulnerability. |
| `_private/` (ignored) | A checkout's private working material: notes, logs, scratch. Never committed. |
