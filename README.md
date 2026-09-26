# WhatBuild

**Turn a pile of discovery material into something you can act on.** Interviews, sales calls,
research exports, documents and decks go in; objectives, cited insights, reviewed assumptions and
decisions, and a stakeholder-readable story come out — with every claim pointing at the exact
passage it came from.

A person works through a web application. An agent works through a Model Context Protocol (MCP)
server exposing the same operations. The product is agent-first: the MCP surface is the most
complete control panel, and the web UI is how a person does the same things.

There is no AI inside WhatBuild and it needs no model API key. Intelligence arrives through
whatever agent you connect.

> **Status: early build, specification draft 0.3.** The whole loop works end to end — sign-in,
> organizations and roles, kind-first intake, parsing, passages, search, insights, reviewed
> assumptions and decisions, the Story, activity, and agents over MCP with OAuth. The web app runs
> on a deliberately provisional look while the design system is chosen. See the
> [roadmap status](docs/spec/10-roadmap.md) for exactly what is and is not done.

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
[deployment guide](deploy/cloud-run/README.md) and [`setup.sh`](deploy/cloud-run/setup.sh) set it
up from nothing; afterwards every push to `main` builds, migrates and deploys.

## Layout

```
packages/parsers   bytes → passages with exact offsets (text, Markdown, VTT, SRT, HTML, DOCX, PDF, XLSX)
packages/core      every operation, defined once: schemas, access policy, handlers, the skill
apps/server        Hono: REST and MCP generated from the operations, OAuth, uploads, worker, CLI
apps/web           React: the web app (provisional look — see apps/web/src/styles/tokens.css)
deploy/cloud-run   Cloud Run setup and guide
docs/spec          the specification
```

## The specification

| # | Document | What it settles |
|---|---|---|
| 1 | [Product](docs/spec/01-product.md) | The core loop, principles, non-negotiable behaviors, vocabulary |
| 2 | [Architecture](docs/spec/02-architecture.md) | Stack, ports, production and development, repository layout |
| 3 | [Accounts, tenants, teams, products, roles](docs/spec/03-accounts-teams-and-identity.md) | Sign-in, hierarchy, roles, isolation, OAuth |
| 4 | [Data model](docs/spec/04-data-model.md) | Every object, field, limit, and invariant |
| 5 | [Derived layer](docs/spec/05-derived-layer.md) | Parsers, sidecars, passage reads |
| 6 | [Operations and adapters](docs/spec/06-operations-and-adapters.md) | The operation registry, REST, MCP tools, uploads |
| 7 | [Web application](docs/spec/07-web-app.md) | Screens, routes, behavior |
| 8 | [Search and retrieval](docs/spec/08-search.md) | Lexical now, the improvements planned |
| 9 | [Data lifecycle](docs/spec/09-data-lifecycle.md) | Quotas, backups, export, archive and delete, what we tell people |
| 10 | [Roadmap](docs/spec/10-roadmap.md) | Build phases, status, and open questions |

## Licence

[MIT](LICENSE) © Alejandro Erickson
