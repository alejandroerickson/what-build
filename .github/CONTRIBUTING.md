# Contributing to WhatBuild

Thank you for helping. This page is short: it says what a contribution needs and points into the
documentation for the rest.

## Run it

Node (24, the version in `.nvmrc`) and pnpm through Corepack are all you need. No account
anywhere, no Docker, no API key.

```sh
corepack pnpm install && corepack pnpm dev   # http://localhost:5273, one-click dev sign-in
```

`pnpm dev` starts an embedded Postgres, seeds a synthetic sample product and serves the app;
sign-in links are printed in the terminal. [Local development](../okf/operations/local-development.md)
has the rest: the tests, the browser scripts, a second instance.

## Make a change

Read [working in this repository](../okf/process/working-in-this-repository.md) first. In short:

- Anything the web app or an agent needs is an operation in `packages/core/src/ops/`, served over
  both REST and MCP, with server tests in `apps/server/test/`.
- A schema change is a new migration in `apps/server/src/migrations/`, never an edit to one
  already there.
- The interface follows [`DESIGN.md`](../apps/web/DESIGN.md).
- The words are fixed: source, derived text, attachment, outcome, mockup, assumption, Story,
  archive ([product specification](../okf/spec/01-product.md)).

Before you open a pull request, these pass:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
python3 okf/tools/validate_okf.py   # when you change anything in okf/
```

A dependency you add or upgrade also leaves `corepack pnpm security` clean.

## The repository is public

Everything in it is published, history included. `pnpm install` turns on git hooks that refuse a
commit or a push carrying secrets, paths from your machine, email addresses or files where the
repository keeps none, and CI checks every pull request the same way
([security checks](../okf/operations/security-checks.md)). When a check refuses, change the
content; don't skip it with `--no-verify`.

Two of its rules catch people out:

- **Commit with GitHub's no-reply address.** A commit whose author is a personal email address is
  refused. Use the `…@users.noreply.github.com` address from your
  [GitHub email settings](https://github.com/settings/emails): `git config user.email <it>` in
  your clone.
- **Describe the change, not the work.** A commit message or pull request description says what
  changes and why, what a deployment must do (if anything), and what was checked. An account in
  the first person (*I tried*, *we found*) is refused.

Sample content is synthetic, with `example.com` addresses.

## Documentation

It is all in [`okf/`](../okf/index.md), a bundle of linked Markdown; start at the
[overview](../okf/system/overview.md). A change that makes something there untrue corrects it in
the same pull request, and a new durable choice gets a [decision](../okf/decisions/index.md).

## Issues

Issues are for reports from people who use, run or contribute to WhatBuild: a bug, a request or a
question. Choose a template when you open one.

## A vulnerability

Never in an issue or a pull request. Report it privately, as the [security policy](SECURITY.md)
says.

## Licence

WhatBuild is [MIT](../LICENSE)-licensed
([decision](../okf/decisions/whatbuild-is-mit-licensed.md)), and what you contribute is under the
same licence.
