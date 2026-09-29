# WhatBuild

**Turn a pile of discovery material into something you can act on.** Interviews, sales calls,
research exports, documents and decks go in; outcomes, cited insights, reviewed assumptions and
decisions, and a stakeholder-readable story come out — with every claim pointing at the exact
passage it came from.

A person works through a web application. An agent works through a Model Context Protocol (MCP)
server exposing the same operations. The product is agent-first: the MCP surface is the most
complete control panel, and the web UI is how a person does the same things.

There is no AI inside WhatBuild and it needs no model API key. Intelligence arrives through
whatever agent you connect.

> **Status: early build.** The whole loop works end to end — sign-in,
> organizations and roles, kind-first intake, parsing, passages, search, insights, reviewed
> assumptions and decisions, the Story, activity, and agents over MCP with OAuth. See the
> [roadmap](okf/spec/10-roadmap.md) for exactly what is and is not done.

## Running it locally

Node 22 or later. Nothing else: no Docker, no accounts, no API keys.

```sh
git clone https://github.com/<owner>/what-build.git
cd what-build
corepack pnpm install
corepack pnpm dev
```

`pnpm dev` starts Postgres from an npm package (in `.what-build/pg`), runs migrations, seeds a
synthetic sample product with two people, and starts the API (with its job worker) and the web app.
Open <http://localhost:5273> and sign in as either sample person with one click. Sign-in links and
invitation emails are printed in the terminal.

To connect an agent to your local copy:

```sh
claude mcp add --transport http whatbuild-dev http://localhost:5273/mcp
```

| Command | |
|---|---|
| `pnpm test` | Parser tests, server tests against a throwaway Postgres (every operation, isolation, roles, MCP, OAuth), web unit tests |
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm build` | The web app and the production server bundle |
| `DATABASE_URL=… pnpm dev` | Use your own Postgres instead of the embedded one |
| `node scripts/e2e.mjs` | Walk the web app through the loop in headless Chrome, against a running `pnpm dev` |

## Deploying

One image on Google Cloud Run, Postgres, and a Cloud Storage bucket. The
[deployment guide](okf/operations/cloud-run.md) and [`setup.sh`](deploy/cloud-run/setup.sh) set it
up from nothing; afterwards every push to `main` builds, migrates and deploys.

## Layout

```
packages/parsers   bytes → passages with exact offsets (text, Markdown, VTT, SRT, HTML, DOCX, PDF, XLSX)
packages/core      every operation, defined once: schemas, access policy, handlers, the skill
apps/server        Hono: REST and MCP generated from the operations, OAuth, uploads, worker, CLI
apps/web           React: the web app, on the Studio design system (see DESIGN.md)
deploy/cloud-run   Cloud Run setup script (the guide is in okf/operations)
okf                all documentation: overview, decisions, specification, operations
.agents/skills     skills for agents working on this repository (.claude/skills links here)
```

## Documentation

Everything lives in [`okf/`](okf/index.md), a small bundle of linked Markdown:

- [WhatBuild at three altitudes](okf/system/overview.md): the system from the top down.
- [Decisions](okf/decisions/index.md): the architectural decision records.
- [Specification](okf/spec/index.md): product, architecture, identity and tenancy, data model,
  derived layer, operations and MCP, web app, search, data lifecycle, and the roadmap.
- [Working in this repository](okf/process/working-in-this-repository.md): how to change it.

Agents start at [`AGENTS.md`](AGENTS.md) and use the skills in [`.agents/skills`](.agents/skills)
to read and maintain the bundle.

## Licence

[MIT](LICENSE) © Alejandro Erickson
