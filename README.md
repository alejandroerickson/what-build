# WhatBuild

**Turn a pile of discovery material into something you can act on.** Interviews, sales calls,
research exports, documents and decks go in; objectives, cited insights, reviewed assumptions and
decisions, and a stakeholder-readable story come out — with every claim pointing at the exact
passage it came from.

A person works through a web application. An agent works through a Model Context Protocol (MCP)
server exposing the same operations. The product is agent-first: the MCP surface is the most
complete control panel, and the web UI is how a person does the same things.

There is no LLM inside WhatBuild and it needs no model API key. Intelligence arrives through
whatever agent you connect.

> **Status: draft 0.2 specification. Nothing is built yet.**
> The specification in [`docs/spec/`](docs/spec/) is what we build from. Start with
> [the overview](docs/spec/README.md).

## What it is

- **A hosted, multi-tenant service.** You sign up, create a team, invite colleagues, and try it for
  free within [published limits](docs/spec/09-data-lifecycle.md#92-quotas-and-the-free-tier).
- **Open source, MIT.** You can run the same image against your own Postgres and bucket using the
  same deployment guide we use. It is not a separate mode.
- **Honest about data.** It is a free, pre-1.0 service on rented infrastructure. We say exactly
  what that means, take no product analytics, train no model on your content, and make export
  complete and always available. The full statement is
  [§9.1](docs/spec/09-data-lifecycle.md#91-what-we-tell-people).

## Running it locally

The whole application runs on a laptop with one command — **no accounts, no API keys, no cloud
services to provision.** This is how it is developed, and how CI runs it.

```sh
git clone https://github.com/<owner>/what-build.git
cd what-build
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres in a container, runs migrations, seeds a team with two accounts and a
fully derived sample project, then runs the API, the job worker and Vite. Verification and
magic-link emails are printed to your terminal.

| Command | |
|---|---|
| `pnpm test` | Unit tests, integration tests against a throwaway Postgres schema, Playwright over the UI |
| `pnpm dev --no-docker` | Use whatever `DATABASE_URL` points at |
| `pnpm dev --s3` | Add a MinIO container to exercise the S3 adapter and presigned uploads |

The full contract, including what this places on the design, is
[§2.6](docs/spec/02-architecture.md#26-running-it-locally--the-development-contract).

*(These commands are the Phase 0 deliverable and do not work yet — Phase 0 is accepted precisely
when they do.)*

## The specification

| # | Document | What it settles |
|---|---|---|
| 1 | [Product](docs/spec/01-product.md) | The core loop, principles, non-negotiable behaviors, vocabulary |
| 2 | [Architecture](docs/spec/02-architecture.md) | Stack, ports, production and development, repository layout |
| 3 | [Accounts, teams, identity](docs/spec/03-accounts-teams-and-identity.md) | Sign-up, teams, invitations, projects, isolation |
| 4 | [Data model](docs/spec/04-data-model.md) | Every object, field, limit, and invariant |
| 5 | [Derived layer](docs/spec/05-derived-layer.md) | Parsers, sidecars, passage reads |
| 6 | [Operations and adapters](docs/spec/06-operations-and-adapters.md) | The operation registry, REST, MCP tools, uploads |
| 7 | [Web application](docs/spec/07-web-app.md) | Screens, routes, behavior |
| 8 | [Search and retrieval](docs/spec/08-search.md) | Lexical now, the improvements planned |
| 9 | [Data lifecycle](docs/spec/09-data-lifecycle.md) | Quotas, backups, export, archive and delete, what we tell people |
| 10 | [Roadmap](docs/spec/10-roadmap.md) | Build phases with acceptance criteria, and open questions |

## Contributing

Contribution guidelines, a code of conduct and a security policy are Phase 0 deliverables. Until
then, the most useful contribution is a careful read of the specification and an issue where it is
wrong.

## Licence

[MIT](LICENSE) © Alejandro Erickson
