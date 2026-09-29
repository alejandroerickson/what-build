---
type: System Concept
title: Running WhatBuild locally, testing it, and checking the interface
description: The one-command development setup, the test and build commands, and the browser scripts.
tags: [development, testing, local]
generated: {by: agent:claude, at: 2026-09-29T00:00:00Z}
status: stable
---

# Local development

Node 22 or later (CI uses the version in `.nvmrc`) and pnpm through Corepack are all you need. No accounts, keys, Docker or cloud
services ([decision](../decisions/development-substitutes-adapters-never-behavior.md)).

```sh
corepack pnpm install
corepack pnpm dev
```

`pnpm dev` (`apps/server/src/dev.ts`) starts an embedded Postgres on `:54329` (data in
`.what-build/pg`), runs migrations and seeds the synthetic Crewboard product, then runs the API on
`:8787`, the job worker in-process, and Vite on `:5273`. Open http://localhost:5273 and use the
development sign-in (Riley Chen or Sam Okafor). Files go to `.what-build/blobs`; sign-in links are
printed to the terminal.

Environment overrides: `DATABASE_URL` (your own Postgres instead of the embedded one), `PORT`,
`WHATBUILD_WEB_PORT`, `WHATBUILD_PG_PORT`, `WHATBUILD_BLOB_DIR`. To run a second instance
beside the first (another checkout, for example), change `PORT`, `WHATBUILD_WEB_PORT` and
`WHATBUILD_PG_PORT`; in the same checkout, also point `DATABASE_URL` at a fresh database. The web
app proxies to its own instance's API (`WHATBUILD_API` overrides it).

## Checks

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc` over parsers, core, server and web. |
| `pnpm test` | Vitest: parsers, server (against an embedded Postgres) and web projects. `pnpm vitest run --project web` runs one. |
| `pnpm build` | The web bundle and the server bundle. |
| `pnpm gen:skill` | Re-embeds `packages/core/src/skill/SKILL.md`; CI fails if it is stale. |
| `pnpm db:migrate`, `pnpm db:seed` | Run migrations or the seed against `DATABASE_URL`. |
| `python3 okf/tools/validate_okf.py` | Checks the documentation bundle: frontmatter, types, links, indexes. |

CI (`.github/workflows/ci.yml`) runs the documentation check, the skill check, typecheck, test and build on every push to
`main` and every pull request.

## In the browser

- `node scripts/e2e.mjs [baseUrl]` drives a real Chrome through sign-in, intake, a comment on a
  passage, search, activity and export against a running `pnpm dev`. It creates data, so run it on
  a database you don't mind changing.
- `node scripts/shots.mjs <outdir> [baseUrl]` captures every screen in light and dark, at desktop
  and phone width. `SHOTS=name,name` limits it to some screens.
- `/_system` (development builds only) renders every design token and primitive in both themes.
