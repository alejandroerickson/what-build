# WhatBuild: agent orientation

This file is for any agent working in this repository. `CLAUDE.md` is a symlink to it; keep one
copy.

## This repository is public

`alejandroerickson/what-build` is public and MIT-licensed. Everything committed, and every commit
message, is published.

- No session memory in the repository: no logs, handoff notes, records of requests, or to-do lists.
  Keep those in your own private memory. Planned work belongs in `okf/spec/10-roadmap.md`.
- Never name private projects, clients, employers or files elsewhere on a machine, even when they
  shaped a change. A change stands on its own.
- No secrets, tokens, absolute local paths or personal details. Sample content is synthetic.
- If you are unsure whether something may be published, leave it out and ask.

## What this is

WhatBuild turns a product team's discovery material into outcomes, cited insights, reviewed
assumptions and decisions, and a Story for stakeholders. People use a React web app; agents use an
MCP server exposing the same 116 operations. There is no AI inside. One stateless image on Cloud Run,
Postgres, and object storage.

The domain is **what-build.com**, with a hyphen: the public site at `what-build.com`, the app at
`app.what-build.com`. Never write `whatbuild.com`. The product name, WhatBuild, has no hyphen.

| Path | What it is |
|---|---|
| `okf/` | **All documentation.** Start at `okf/index.md`, then `okf/system/overview.md`. |
| `packages/core` | Operations (defined once, served over REST and MCP), policy, domain rules, the agent skill. |
| `packages/parsers` | Pure bytes-to-passages parsers. |
| `apps/server` | Hono server: REST, MCP, identity and OAuth, uploads, worker, migrations, seed. |
| `apps/web` | React app on the Studio design system. |
| `PRODUCT.md`, `DESIGN.md` | Product and design records, read by design tooling. |

## Skills

The skills in `.agents/skills/` apply to any agent. For Claude Code, `.claude/skills` is a link to
that folder. If your tool does not load skills, read the `SKILL.md` files directly.

| Skill | Use it |
|---|---|
| `okf-orient` | At the start of a task: what to read in `okf/` and where each answer lives. |
| `okf-update` | Before finishing any change: which concepts it affects, and how to write each type. |
| `okf-decision` | When a change makes, revises or reverses a durable choice. |
| `azure-self-host` | When asked to host, update or repair a self-hosted copy on Azure with the Azure CLI. |
| `recover-a-deployment` | When a new version broke a deployment (Cloud Run or Azure): roll back, restore the database. |

## Before you change anything

Read `okf/process/working-in-this-repository.md`. In short: capabilities start as operations with
server tests; migrations are new forward-only files with row-level security; UI follows `DESIGN.md`;
the vocabulary is fixed; and `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

```sh
corepack pnpm install && corepack pnpm dev   # http://localhost:5273, one-click dev sign-in
```

## Operating production

Deploying, the Cloudflare Worker and analytics are in `okf/operations/` (start with
`cloud-run.md`). The deployment's values and credentials are in `.env` at the root of the
maintainer's clone, never in the repository; production secrets are in Google Secret Manager and
`.env` names them. Read `.env` before asking the maintainer for an ID or a token.

## When a release breaks a deployment

Any deployment, the maintainer's or someone else's: use the `recover-a-deployment` skill, which
follows `okf/operations/recovering-from-a-bad-release.md`. Code goes back by running the previous
image; the schema goes back only by restoring the database, so first find out whether the bad
release ran a migration.

## Self-hosting on Azure

A separate deployment an organization runs for itself, set up by an agent with the Azure CLI. Use
the `azure-self-host` skill, which reads `okf/operations/azure.md`. Its values are in `.env.azure`
(gitignored), its secrets in that deployment's Key Vault, and it never touches the Cloud Run
deployment, `.env`, or `gcloud`.

## Keep the documentation true

When a change makes something in `okf/` untrue, fix it in the same change. Use `okf-update`. A new
durable choice gets a record in `okf/decisions/`; use `okf-decision`. Run
`python3 okf/tools/validate_okf.py` before committing. CI runs it too.
