# WhatBuild: agent orientation

This file is for any agent working in this repository. `.claude/CLAUDE.md` is a symlink to it; keep
one copy.

## At the start of every session

Run `corepack pnpm attention`. It prints what is waiting in this repository: Dependabot's pull
requests and the alerts nobody has accepted, a failed run on `main`, an accepted vulnerability whose
time is up, changes production lacks, git hooks that are off, copies outside production that may
hold an organization no instance owner owns. If it prints anything, tell the person in a line or two before you start their task,
and offer to handle each item with the skill it names. This is how the maintainer hears of these
chores. Do not act on an item unasked. An accepted vulnerability has been looked at already: its
line gives the reason, which says what fixes it and when. Say that, and offer the fix only once it
can be made, not a new triage.

## Who does what

The maintainer decides: what to build, what is good enough, what may be published, what to spend.
Agents carry out the work and operate the deployments, and never rely on the maintainer to remember
how something was done or what was set up. Whatever an agent sets up, changes or settles is written
where the next agent will look before the work is reported done: in this repository when any
deployment needs it (`okf/`, `.agents/skills/`, `deploy/`), and outside it when it is true only of
the maintainer's own deployments, whose values are in `.env`.

## This repository is public

`alejandroerickson/what-build` is public and MIT-licensed. Everything committed, every commit
message, every pull request's text and every issue and comment is published, and history keeps it.

- No session memory in the repository: no logs, handoff notes, records of requests, or to-do lists.
  Keep those in `_private/` at the root of your checkout (ignored) or in your own memory, never
  anywhere else. Planned work belongs in `okf/spec/10-roadmap.md`.
- Issues are for reports from people who use, run or contribute to WhatBuild, which agents triage
  when asked ("Issues" in `okf/process/working-in-this-repository.md`). The maintainer's own work
  is never an issue here: an agent working for the maintainer opens none.
- Commit messages and pull request descriptions describe the change, never the conversation: no
  prompts, no quoted requests, no account of who said what, no first-person account of the work,
  no link to a session. What goes in them instead is in `okf/process/working-in-this-repository.md`.
- Never name private projects, clients, employers or files elsewhere on a machine, even when they
  shaped a change. A change stands on its own.
- No secrets, tokens, absolute local paths or personal details. Sample content is synthetic, with
  `example.com` addresses.
- Nothing true only of the maintainer's own deployments: their amounts and costs, IDs, which
  providers they use, what they have set up, their traffic. Documentation gives the step any
  deployment takes (`CAP=<amount>`, `my-whatbuild` in examples and tests); those facts stay outside
  the repository.
- A copy of production outside production (`.what-build/fixtures/`, the `fixture` database, the
  golden master and its exports, the Docker host, the dev deployment) is real people's data, and
  holds only organizations an instance owner owns, beside synthetic ones: customers'
  organizations never leave production, whoever names them, and the pull refuses them
  ([decision](okf/decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)).
  Pulling the example organization to this machine is routine and needs no go-ahead. Never
  commit a copy, and never quote it in the repository, a commit, an issue or a pull request
  ([a copy of production](okf/operations/a-copy-of-production.md#what-may-be-done-with-it)).
- Tools that install their own instructions (memory, routing or workflow tools) keep them in your
  user-level configuration, never in this file, `.agents/skills/` or `okf/`.
- Stage files by name. `pnpm install` turns on git hooks that refuse a commit or push carrying any
  of the above (`okf/operations/security-checks.md`). When one blocks, fix the content; never
  `--no-verify`. A false positive is fixed in `scripts/check-publishable.mjs` in the same commit.
- If you are unsure whether something may be published, leave it out and ask.

## What this is

WhatBuild turns a product team's discovery material into outcomes, mockups, reviewed assumptions
and a Story for stakeholders. People use a React web app; agents use an MCP server exposing 101 of
the same 118 operations: all but running the instance (plans, organizations, guests, allowances,
accounts and usage, which only an instance owner does), renaming an organization or a product,
which its owners or admins do, deleting an organization and its preview, which only its owners or
an instance owner do, and deleting one's own account and its preview, which only its person does,
all in the web app. There is no AI inside. One stateless image on Cloud
Run, Postgres, and object storage.

The domain is **what-build.com**, with a hyphen: the public site at `what-build.com`, the app at
`app.what-build.com`. Never write `whatbuild.com`. The product name, WhatBuild, has no hyphen.

| Path | What it is |
|---|---|
| `okf/` | **All documentation.** Start at `okf/index.md`, then `okf/system/overview.md`. |
| `packages/core` | Operations (defined once, served over REST and MCP), policy, domain rules, the guide agents read. |
| `packages/parsers` | Pure parsers from a file's bytes to readable Markdown. |
| `packages/server-external` | The packages the server leaves out of its bundle, which the image installs from `pnpm-lock.yaml`. |
| `apps/server` | Hono server: REST, MCP, identity and OAuth, uploads, worker, migrations, seed. |
| `apps/web` | React app on the Studio design system, with `PRODUCT.md` and `DESIGN.md`, the product and design records design tooling reads. |
| `e2e/plans` | End-to-end test plans an agent runs through the web app and MCP (`okf/operations/end-to-end-tests.md`). |

## Skills

The skills in `.agents/skills/` apply to any agent. For Claude Code, `.claude/skills` is a link to
that folder. If your tool does not load skills, read the `SKILL.md` files directly.

| Skill | Use it |
|---|---|
| `okf-orient` | At the start of a task: what to read in `okf/` and where each answer lives. |
| `okf-update` | Before finishing any change: which concepts it affects, and how to write each type. |
| `okf-decision` | When a change makes, revises or reverses a durable choice. |
| `azure-self-host` | When asked to host, update or repair a self-hosted copy on Azure with the Azure CLI. |
| `make-a-release` | When asked to release a version or move production: publish the release, approve the deploy. |
| `rehearse-on-the-dev-deployment` | Before production runs a release that migrates, or when asked to deploy to dev, refresh or reset dev's copy of production, change which organizations dev holds, or set dev up. |
| `perform-the-restore-drill` | When asked to perform or rehearse the restore drill, or to test that a deployment's backups restore. |
| `recover-a-deployment` | When a new version broke a deployment (Cloud Run or Azure): roll back, restore the database. |
| `test-on-a-copy-of-production` | When asked to pull the example organization (or another of the instance owners') and run the app locally on it, to QA or test end to end on real data, or to try migrations on a copy of production. |
| `copy-an-organization` | When asked to dump, export, extract or move an organization or the example organization, to keep an organization out of a copy, or to give an organization a deployment of its own. |
| `audit-for-leaks` | When asked to check the repository or its history for secrets or private material, when something may have leaked, or to make the repository public. |
| `triage-security-findings` | When `pnpm security`, the Security or CodeQL workflow, or Dependabot reports something; when adding or upgrading a dependency; before a release. |
| `run-end-to-end-tests` | When asked to run the end-to-end, smoke or acceptance tests or a test plan, to test a release (on the Docker host), to QA the app through the browser and MCP, or to build the golden master. |
| `read-usage` | When asked how a deployment is used: which features, through the app and agents, whether people come back, what fails; for analytics or insights; or to connect a deployment to its analytics. |
| `run-the-instance` | When asked about a deployment's plans, prices or limits, the plan new organizations start on, moving an organization to another plan, a read-only organization, the waitlist, guests, who can start organizations, or deleting an organization or removing a person. |
| `set-up-mail` | When asked to set up, check or repair a deployment's email; when invitations or sign-in links do not arrive or fail; to rotate the mail token or change provider. |

## Before you change anything

Read `okf/process/working-in-this-repository.md`. In short: capabilities start as operations with
server tests; migrations are new forward-only files with row-level security; UI follows
`apps/web/DESIGN.md`; the vocabulary is fixed; `pnpm typecheck`, `pnpm test` and `pnpm build` pass;
and a dependency you add or upgrade leaves `pnpm security` clean.

```sh
corepack pnpm install && corepack pnpm dev   # http://localhost:5273, one-click dev sign-in
```

## Operating production

Every procedure for running a deployment is in `okf/operations/`, with exact commands, and a skill
conducts each one that changes something:

| To | Read | Skill |
|---|---|---|
| set up or change the Cloud Run deployment: sign-in, domain, settings, alerts and traces, the Cloudflare Worker | `cloud-run.md` | |
| publish a release, move production | `releasing.md` | `make-a-release` |
| know what a deployment must do when it takes a release; add a line for a change that asks something of one | `upgrading.md` | `make-a-release` |
| run the end-to-end tests on the golden master | `end-to-end-tests.md` | `run-end-to-end-tests` |
| serve the golden master on a Docker host (a NAS) with each release, and test there | `end-to-end-on-a-docker-host.md` | `run-end-to-end-tests` |
| check for known vulnerabilities and private material | `security-checks.md` | `triage-security-findings`, `audit-for-leaks` |
| rehearse a release on the dev deployment; refresh or reset its copy of production; set it up | `dev-deployment.md` | `rehearse-on-the-dev-deployment` |
| know what is backed up, check that backups run, restore a dump, perform the restore drill | `backups.md` | `perform-the-restore-drill` (the drill) |
| go back after a release broke a deployment | `recovering-from-a-bad-release.md` | `recover-a-deployment` |
| test on a copy of production on this machine | `a-copy-of-production.md` | `test-on-a-copy-of-production` |
| build the non-production dataset (the instance owners' organizations beside synthetic ones) that the local copy, the golden master and dev load | `the-non-production-dataset.md` | `test-on-a-copy-of-production` |
| copy some organizations out of a deployment (the example organization by default): to test on or to dev (only the instance owners' organizations), or into another production deployment's new database | `copying-an-organization.md` | `copy-an-organization` |
| find out how a deployment is used (features, agents, people coming back, the site); connect its analytics | `analytics.md` | `read-usage` |
| know what mail a deployment sends and through what; set it up, check it, rotate its token, change provider | `mail.md` | `set-up-mail` |
| define or change a deployment's plans, their limits and prices (`WHATBUILD_PLANS`; its file's path is `PLANS_FILE` in `.env`), or offer none; move organizations between plans; let people in from the waitlist; set the guests' limits | `cloud-run.md` (Plans), spec §9.7 | `run-the-instance` |

Production runs releases only: it moves when a release is published and its build approved,
never on a merge, and a release that migrates is rehearsed on the dev deployment first. The
deployments' values and credentials are in `.env` at the root of the maintainer's clone, never in
the repository: production's (`GCP_PROJECT`, `NEON_PROJECT`, …) and the dev deployment's
(`GCP_DEV_PROJECT`, `NEON_DEV_PROJECT`, …). Their secrets are in each project's Secret Manager, and
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
