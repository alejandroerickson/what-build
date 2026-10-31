---
type: System Concept
title: Running WhatBuild locally, testing it, and checking the interface
description: The one-command development setup, the test and build commands, and the browser scripts.
tags: [development, testing, local]
generated: {by: agent:claude, at: 2026-10-31}
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
development sign-in, which offers every account on the server with what it is there: the sample's
people first (Riley Chen, Sam Okafor, or Jordan Ellis, a reader who sees only Crewboard's Story),
then anyone you have signed in as since, newest first. Riley is the instance's owner
(`WHATBUILD_INSTANCE_OWNERS` defaults to Riley's address here), so Riley sees **Organization
creators**, where the seed lets Sam create one organization. Files go to `.what-build/blobs`; sign-in links are
printed to the terminal.

Environment overrides: `DATABASE_URL` (your own Postgres instead of the embedded one), `PORT`,
`WHATBUILD_WEB_PORT`, `WHATBUILD_PG_PORT`, `WHATBUILD_BLOB_DIR`. To run a second instance
beside the first (another checkout, for example), change `PORT`, `WHATBUILD_WEB_PORT` and
`WHATBUILD_PG_PORT`; in the same checkout, also point `DATABASE_URL` at a fresh database. The web
app proxies to its own instance's API (`WHATBUILD_API` overrides it). A database keeps the
migrations a later commit ran on it, and the worker of an earlier commit then takes no jobs, as it
would in a deployment, and says so in its log: run that commit on a fresh database, or delete
`.what-build/pg` to start again.

## The local Postgres

Each embedded cluster (`.what-build/pg` for `pnpm dev` and a copy of production,
`.what-build/test-pg` for the tests, `.what-build/e2e/pg` for the end-to-end instance) is made in
UTF-8 with the C.UTF-8 locale, as Neon's databases are by default: text functions count
characters, text sorts by code point, and full-text search and trigrams read letters beyond ASCII
as production does ([`testing/pg.ts`](../../apps/server/src/testing/pg.ts),
[decision](../decisions/development-substitutes-adapters-never-behavior.md)). macOS and CI's Linux
have a C.UTF-8 locale; a system without one gets PostgreSQL's own (`builtin`) C.UTF-8, which sorts
and changes case the same way but whose search and trigrams take only ASCII letters for letters.

A cluster made before local clusters were UTF-8 is SQL_ASCII, where `left()` and `length()` count
bytes:

- The tests' cluster holds nothing to keep, and is made again when the tests start.
- The end-to-end instance's is made again when its golden master is built
  ([end-to-end tests](end-to-end-tests.md#the-golden-master)).
- The development cluster holds your work, so it is kept as it is, and `pnpm dev` says at start
  that it is SQL_ASCII. For a UTF-8 one, stop `pnpm dev`, move the old cluster aside
  (`mv .what-build/pg .what-build/pg-sql_ascii`), and start `pnpm dev` again: it makes a new
  cluster and seeds it, and `pnpm fixture load` puts a copy of production into it again.

Each checkout uses only its own clusters ([`testing/pg.ts`](../../apps/server/src/testing/pg.ts)).
A tool that finds a Postgres already answering on a cluster's port uses it only when its
`data_directory` is this checkout's; another checkout's cluster, or any other server, is refused
before anything is made, started or dropped, and the refusal names the other cluster's data
directory. So two checkouts side by side each need ports of their own: `WHATBUILD_PG_PORT` for
`pnpm dev`, a copy of production and `pnpm fixture`, `WHATBUILD_TEST_PG_PORT` for the tests, and
`WHATBUILD_E2E_PG_PORT` for the end-to-end instance.

## Development and production

The server behaves as a development server only when `NODE_ENV` is exactly `development` or
`test`: the development sign-in (anyone signs in as anyone), the fixed development grant key, the
console mailer, and writes from any `http://localhost` port. `pnpm dev`, `pnpm dev:fixture`,
`pnpm dev:e2e` and `pnpm dev:people` set `development`, and so do `pnpm db:migrate`, `pnpm db:seed`, the end-to-end
tools and the server package's `serve` script; the tests set `test`. Anything else, including no
`NODE_ENV` at all, a misspelling or `staging`, is production ([`config.ts`](../../apps/server/src/config.ts)):
`pnpm start` or `node main.js serve` on the built server needs `WHATBUILD_GRANT_KEY` (32
characters or more), takes only the `smtp`, `acs` or `none` mailer, offers no development sign-in, and
refuses to start as a database role that bypasses row-level security.

Over plain HTTP the session cookie is `wb_session`; a deployment served over HTTPS uses
`__Host-wb_session` ([§3.8](../spec/03-accounts-teams-and-identity.md#38-identity-of-the-caller)).

## The example organization and the plans, locally

`pnpm dev` makes the sample organization, `harbor-labs`, the example organization every account
reads ([§3.10](../spec/03-accounts-teams-and-identity.md#310-the-example-organization)), offers
the plans in [`deploy/plans.example.json`](../../deploy/plans.example.json), Free and Pro
(`WHATBUILD_PLANS`), and puts every organization someone other than an instance owner creates on
its `free` plan ([§9.7](../spec/09-data-lifecycle.md#97-plans-and-limits)), as a deployment open to
the public does. The sample people are members
of `harbor-labs` and work there as anywhere; to see it as a guest, use the development sign-in's "As
the email above" with any other address, such as `guest@example.com`. Sam Okafor may start one
organization, which starts on the example file's Free plan (two people, one product, 50 sources, 200 MB); Riley
Chen, the instance's owner, moves it to another plan on `/instance`, where the plans are compared too.
`WHATBUILD_EXAMPLE_TENANT=<slug>` names another organization, and an empty
`WHATBUILD_EXAMPLE_TENANT=` turns the example off; `WHATBUILD_PLANS=<path>` offers other plans,
and an empty `WHATBUILD_PLANS=` with `WHATBUILD_NEW_ORGANIZATION_PLAN=unlimited` offers none, as a
self-hosted deployment does, so every organization is unlimited and the app says nothing of plans. Riley sets a plan's price and
limits, and the guests' settings, on `/instance`. The plans page is at `/plans`, and the public
site's at `/site/plans/`. Guests: with **Anyone can sign up as a guest** on, the development
sign-in's "As the email above" with a new address is a guest account; with **Guests in at once** at
1, a second guest in another browser sees the waiting page.

## Many people

`pnpm dev:people` serves the sample and a hundred synthetic people, to try sign-up, admission,
invitations and the instance owner's screens at the size a deployment reaches. It keeps them in a
database of their own, `people`, in the same embedded Postgres, with its files in
`.what-build/people-blobs`, so `pnpm dev`'s database is left as it is; `--count <n>` (up to 1,000)
makes another number. The people stay for the next start; to begin again, stop it and drop the
database, or delete `.what-build/pg` (which holds `pnpm dev`'s work too).

The people ([`people.ts`](../../apps/server/src/people.ts)) are the same for the same count every
time, all at `example.com` or a `.example` domain:

| Who | Of 100 |
|---|---|
| Owners of the organizations they started on an allowance, one each; one organization big, a few middling, the rest small, each with a domain of its own and on the smallest of the example file's plans that holds its people, invitations included (Free, Pro, or unlimited past Pro) | 8 |
| Members of one organization or, at `example.com`, two or three; admins among them, and a second owner of the biggest | 46 |
| Signed in, in no organization, a third of them with an allowance unused | 10 |
| Invited, not signed in yet: the invitations are waiting | 12 |
| Given an allowance, not signed in yet | 6 |
| On the waitlist, asked through the public site's form, with an organization and a note | 18 |

They are made through the running instance, as its people would make them: each signs in through
the development sign-in, Riley Chen (the instance's owner) gives the allowances without their
notices, owners start their organizations, Riley moves each to the plan that holds its people, and
owners invite their people, and those with an account accept, as from the email; their writes meet their plan's limits, whose waits it sits out. So attribution, activity and limits are as in real use.
At the end it prints everyone by what they are. Sign in as any of them with the development
sign-in's "As the email above".

The instance is invite-only, as a deployment taking sign-ups is: `WHATBUILD_SIGNUP_ALLOWLIST`
lets in the biggest organization's domain (`@northwind.example`). The development sign-in lets
anyone in, so to try admission as a stranger would, sign out and ask for a sign-in link instead,
which is printed in the terminal with every invitation: an address at that domain, an invited
address or one with an allowance gets one, and any other (someone on the waitlist, say) gets the
same answer on the page and no link.

`pnpm people [--count <n>] [--url <address>] [--owner <instance owner>]` adds the same people to
an instance already running: `pnpm dev` (`http://localhost:5273`, the default), the end-to-end
instance (`http://localhost:5283`), or a [Docker host](end-to-end-on-a-docker-host.md) through its
tunnel. Running it again adds only what is missing. It refuses an address that is not on this
machine and a server without the development sign-in, so it never touches a deployment.

## A copy of production

`pnpm fixture pull`, `pnpm fixture load` and `pnpm dev:fixture` put a private copy of the
production deployment's example organization, or of other organizations its instance owners own, with their files, into the
database `fixture` and serve it, with the migrations it lacks applied
([a copy of production](a-copy-of-production.md), [copying an organization](copying-an-organization.md)).
The pull needs access to the deployment; nothing else does. `pnpm dataset` builds
[the non-production dataset](the-non-production-dataset.md) from a pull: the same organizations
beside Harbor Labs and these people's organizations, with products and sources in them, which the
local copy, the golden master and the dev deployment load as a pull.

## End-to-end tests

`pnpm e2e golden` builds a golden master from a pull of production (its example organization and a copy of it that is not the example), and `pnpm dev:e2e` serves a fresh copy of it on
`http://localhost:5283`, with its own Postgres and files, beside `pnpm dev`. An agent runs the
plans in `e2e/plans/` there through the browser and MCP and reports what it finds
([end-to-end tests](end-to-end-tests.md)).

## Checks

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc` over parsers, core, server and web. |
| `pnpm test` | Vitest: parsers, server (against an embedded Postgres 17) and web projects. `pnpm vitest run --project web` runs one. To run the server tests on another Postgres, such as the version a host offers, set `TEST_DATABASE_ADMIN_URL` (a superuser, which creates a database per test file, on a server in UTF-8, as the suite checks) and `TEST_DATABASE_APP_URL_TEMPLATE` (the same server as a role named `whatbuild` without `SUPERUSER` or `BYPASSRLS`, with `{db}` for the database). The embedded server listens on `:54331`; `WHATBUILD_TEST_PG_PORT` moves it, so two checkouts can run the suite at once. |
| `pnpm build` | The web bundle and the server bundle. |
| `pnpm gen:guide` | Re-embeds the guide agents read (`packages/core/src/guide/*.md`) as `guide-text.ts`; CI fails if it is stale. |
| `pnpm db:migrate`, `pnpm db:seed` | Run migrations or the seed against `DATABASE_URL`, as a development server. |
| `python3 okf/tools/validate_okf.py` | Checks the documentation bundle: frontmatter, types, links, indexes. |
| `pnpm security` | Known vulnerabilities in the dependencies (osv-scanner) and weaknesses in the workflows (zizmor), with pinned scanners downloaded on first use ([security checks](security-checks.md)). |
| `pnpm attention` | What is waiting in the repository: Dependabot's pull requests and the alerts nobody has accepted, failed runs on `main`, accepted vulnerabilities near expiry, changes production lacks, hooks that are off, copies outside production that may hold an organization no instance owner owns. Agents run it at the start of every session ([security checks](security-checks.md)). |
| `pnpm check:publishable --all` | Nothing private in the tree or the history. The git hooks `pnpm install` turns on run it on every commit and push. |

CI (`.github/workflows/ci.yml`) runs the documentation check, the guide check, typecheck, test and build on every push to
`main` and every pull request, and beside them a build of the image from `deploy/Dockerfile`,
pushed nowhere, so a change that breaks the image fails before a tag does, and the check that
nothing private is published; a
pull request's title and description are checked when it is opened and whenever they are edited
(`pull-request-text.yml`). The Security workflow runs `pnpm security` on the same events and
weekly, with a weekly OWASP ZAP scan of the app, a weekly check of the whole history, and a weekly
check of what GitHub holds beside the code; CodeQL runs once the repository is public; and
Dependabot opens updates ([security checks](security-checks.md)). A tag `v*` runs the Release workflow (`.github/workflows/release.yml`),
which publishes the image as `ghcr.io/<owner>/what-build:<tag>` and makes a GitHub release
([decision](../decisions/releases-are-tags-with-a-published-image.md)) whose notes list the
migrations it adds since the last earlier release that has an image, the fact an operator needs to
[recover from a bad release](recovering-from-a-bad-release.md). A release published on GitHub makes
its tag and so starts the same workflow; [releasing](releasing.md) is how to make one.

## In the browser

- `node scripts/e2e.mjs [baseUrl]` drives a real Chrome through sign-in, intake with an
  attachment until its text is read, an edit to the source's text, its summary and a comment,
  search and a hit that opens the text with the words marked, activity, a mockup canvas (focus mode
  leaves one placed by hand where it is, and its toolbar stays inside the board in a narrow window)
  and export against a running `pnpm dev`. It creates data, so run it on a database you don't mind
  changing.
- `node scripts/shots.mjs <outdir> [baseUrl]` captures every screen in light and dark, at desktop
  and phone width. `SHOTS=name,name` limits it to some screens.
- `node scripts/prototype-check.mjs [baseUrl]` publishes a synthetic multi-file prototype to the
  sample product (several documents, relative assets, a module and a classic script, a font, a
  nested iframe, a form with a submit handler, a document that guards `localStorage`) and checks
  it in a real Chrome on the canvas and the Story: everything loads inside the sandbox, no load
  carries the session cookie, a top-level open is refused, and a canvas of 25 entries is timed. It
  creates data, as `e2e.mjs` does.
- `node scripts/content-site-check.mjs [appUrl] [siteUrl]` checks a content site in a real Chrome,
  against the server serving the built web app itself, so the app's pages carry its own policy
  (Vite sends none). After `pnpm build`, start it with a content site on the same server under
  another host name, analytics on, and other ports than a running `pnpm dev`:

  ```sh
  PORT=8811 WHATBUILD_PG_PORT=54361 WHATBUILD_WEB_PORT=5311 WHATBUILD_PUBLIC_URL=http://localhost:8811 \
    WHATBUILD_CONTENT_URL=http://127.0.0.1:8811 WHATBUILD_WEB_DIST="$PWD/apps/web/dist" \
    WHATBUILD_SITE_URL=http://site.localhost:8811 WHATBUILD_ANALYTICS_ID=G-TEST1234 pnpm dev
  node scripts/content-site-check.mjs http://localhost:8811 http://site.localhost:8811
  ```

  It opens a Story page, the Story style dialog, a canvas, the Idea screen, the print view, a PDF
  and an uploaded HTML page, and checks that each renders from the content site in an opaque
  origin, that a root-relative link opens the app, that no request there carries a cookie, and
  that no page, the public site's included, reports a policy violation; it times a canvas of 25
  pages. It creates data, as `e2e.mjs` does. A PDF's rendering in Firefox and Safari is checked by
  hand.
- `pnpm e2e browser <command>` drives a Chrome kept open between commands, for an agent running an
  [end-to-end test plan](end-to-end-tests.md); `pnpm e2e mcp <command>` calls the MCP server as a
  connected agent.
- `/_system` (development builds only) renders every design token and primitive in both themes.
