---
type: System Concept
title: Running WhatBuild locally, testing it, and checking the interface
description: The one-command development setup, the test and build commands, and the browser scripts.
tags: [development, testing, local]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# Local development

Node 24.15 or later, or 22.22.2 or later on 22 (CI uses the version in `.nvmrc`, 24) and pnpm through Corepack are all you need. No accounts, keys, Docker or cloud
services ([decision](../decisions/development-substitutes-adapters-never-behavior.md)).

```sh
corepack pnpm install
corepack pnpm dev
```

`pnpm dev` (`apps/server/src/dev.ts`) starts an embedded Postgres on `:54329` (data in
`.what-build/pg`), runs migrations and seeds the synthetic Crewboard product, then runs the API on
`:8787`, the job worker in-process, and Vite on `:5273`. Open http://localhost:5273 and use the
development sign-in (Riley Chen, Sam Okafor, or Jordan Ellis, a reader who sees only Crewboard's
Story). Riley is the instance's owner
(`WHATBUILD_INSTANCE_OWNERS` defaults to Riley's address here), so Riley sees **Organization
creators**, where the seed lets Sam create one organization. Files go to `.what-build/blobs`; sign-in links are
printed to the terminal.

Environment overrides: `DATABASE_URL` (your own Postgres instead of the embedded one), `PORT`,
`WHATBUILD_WEB_PORT`, `WHATBUILD_PG_PORT`, `WHATBUILD_BLOB_DIR`. To run a second instance
beside the first (another checkout, for example), change `PORT`, `WHATBUILD_WEB_PORT` and
`WHATBUILD_PG_PORT`; in the same checkout, also point `DATABASE_URL` at a fresh database. The web
app proxies to its own instance's API (`WHATBUILD_API` overrides it).

## Development and production

The server behaves as a development server only when `NODE_ENV` is exactly `development` or
`test`: the development sign-in (anyone signs in as anyone), the fixed development grant key, the
console mailer, and writes from any `http://localhost` port. `pnpm dev`, `pnpm dev:fixture` and
`pnpm dev:e2e` set `development`, and so do `pnpm db:migrate`, `pnpm db:seed`, the end-to-end
tools and the server package's `serve` script; the tests set `test`. Anything else, including no
`NODE_ENV` at all, a misspelling or `staging`, is production ([`config.ts`](../../apps/server/src/config.ts)):
`pnpm start` or `node main.js serve` on the built server needs `WHATBUILD_GRANT_KEY` (32
characters or more), takes only the `smtp`, `acs` or `none` mailer, offers no development sign-in, and
refuses to start as a database role that bypasses row-level security.

Over plain HTTP the session cookie is `wb_session`; a deployment served over HTTPS uses
`__Host-wb_session` ([§3.8](../spec/03-accounts-teams-and-identity.md#38-identity-of-the-caller)).

## The public sandbox, locally

```sh
WHATBUILD_SANDBOX_TENANT=harbor-labs WHATBUILD_SIGNUP_ALLOWLIST=@example.com corepack pnpm dev
```

makes the sample organization the public sandbox ([§9.7](../spec/09-data-lifecycle.md)), saves
its content as the first baseline, and prints one invitation link, once. Riley Chen owns the
organization, so the development sign-in as Riley opens its controls at
`/t/harbor-labs/sandbox`. Sam Okafor is an editor there and so is treated as a visitor. To enter
as a stranger, open the invitation link signed out and use the development sign-in's "As the email
above" with any address outside the allowlist; the account is then one made for the sandbox.
Leave the variable out again and restart, and the organization is an ordinary one.

## A copy of production

`pnpm fixture pull`, `pnpm fixture load` and `pnpm dev:fixture` put a private copy of the
production deployment's public sandbox, or of the organizations named, with their files, into the
database `fixture` and serve it, with the migrations it lacks applied
([a copy of production](a-copy-of-production.md), [copying an organization](copying-an-organization.md)).
The pull needs access to the deployment; nothing else does.

## End-to-end tests

`pnpm e2e golden` builds a golden master from a pull of production (its public sandbox's
organization and a non-sandbox copy of it), and `pnpm dev:e2e` serves a fresh copy of it on
`http://localhost:5283`, with its own Postgres and files, beside `pnpm dev`. An agent runs the
plans in `e2e/plans/` there through the browser and MCP and reports what it finds
([end-to-end tests](end-to-end-tests.md)).

## Checks

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc` over parsers, core, server and web. |
| `pnpm test` | Vitest: parsers, server (against an embedded Postgres 17) and web projects. `pnpm vitest run --project web` runs one. To run the server tests on another Postgres, such as the version a host offers, set `TEST_DATABASE_ADMIN_URL` (a superuser, which creates a database per test file) and `TEST_DATABASE_APP_URL_TEMPLATE` (the same server as a role named `whatbuild` without `SUPERUSER` or `BYPASSRLS`, with `{db}` for the database). The embedded server listens on `:54331`; `WHATBUILD_TEST_PG_PORT` moves it, so two checkouts can run the suite at once. |
| `pnpm build` | The web bundle and the server bundle. |
| `pnpm gen:skill` | Re-embeds `packages/core/src/skill/SKILL.md`; CI fails if it is stale. |
| `pnpm db:migrate`, `pnpm db:seed` | Run migrations or the seed against `DATABASE_URL`, as a development server. |
| `python3 okf/tools/validate_okf.py` | Checks the documentation bundle: frontmatter, types, links, indexes. |
| `pnpm security` | Known vulnerabilities in the dependencies (osv-scanner) and weaknesses in the workflows (zizmor), with pinned scanners downloaded on first use ([security checks](security-checks.md)). |
| `pnpm attention` | What is waiting in the repository: Dependabot's pull requests and alerts, failed runs on `main`, accepted vulnerabilities near expiry, changes production lacks, hooks that are off, copies of production that hold every organization. Agents run it at the start of every session ([security checks](security-checks.md)). |
| `pnpm check:publishable --all` | Nothing private in the tree or the history. The git hooks `pnpm install` turns on run it on every commit and push. |

CI (`.github/workflows/ci.yml`) runs the documentation check, the skill check, typecheck, test and build on every push to
`main` and every pull request, and beside them the check that nothing private is published. The
Security workflow runs `pnpm security` on the same events and weekly, with a weekly OWASP ZAP scan
of the app and a weekly check of the whole history; CodeQL runs once the repository is public; and
Dependabot opens updates ([security checks](security-checks.md)). A tag `v*` runs the Release workflow (`.github/workflows/release.yml`),
which publishes the image as `ghcr.io/<owner>/what-build:<tag>` and makes a GitHub release
([decision](../decisions/releases-are-tags-with-a-published-image.md)) whose notes list the
migrations it adds since the previous tag, the fact an operator needs to
[recover from a bad release](recovering-from-a-bad-release.md). A release published on GitHub makes
its tag and so starts the same workflow; [releasing](releasing.md) is how to make one.

## In the browser

- `node scripts/e2e.mjs [baseUrl]` drives a real Chrome through sign-in, intake with an
  attachment until its text is read, an edit to the source's text, its summary and a comment,
  search and a hit that opens the text with the words marked, activity and export against a
  running `pnpm dev`. It creates data, so run it on a database you don't mind changing.
- `node scripts/shots.mjs <outdir> [baseUrl]` captures every screen in light and dark, at desktop
  and phone width. `SHOTS=name,name` limits it to some screens.
- `node scripts/prototype-check.mjs [baseUrl]` publishes a synthetic multi-file prototype to the
  sample product (several documents, relative assets, a module and a classic script, a font, a
  nested iframe, a form with a submit handler, a document that guards `localStorage`) and checks
  it in a real Chrome on the canvas and the Story: everything loads inside the sandbox, no load
  carries the session cookie, a top-level open is refused, and a canvas of 25 entries is timed. It
  creates data, as `e2e.mjs` does.
- `pnpm e2e browser <command>` drives a Chrome kept open between commands, for an agent running an
  [end-to-end test plan](end-to-end-tests.md); `pnpm e2e mcp <command>` calls the MCP server as a
  connected agent.
- `/_system` (development builds only) renders every design token and primitive in both themes.
