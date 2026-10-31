---
type: Decision
title: Checks that keep private material out and find known vulnerabilities live in the repository, with pinned tools, and no separate service
description: Git hooks and CI run one publishable check; pinned scanners and GitHub's own features find vulnerabilities; nothing else is hosted or installed.
tags: [decision, security, public, privacy, ci, agents, process]
generated: {by: agent:claude, at: 2026-10-31}
status: stable
---

# Checks that keep private material out and find known vulnerabilities live in the repository, with pinned tools, and no separate service

## Context

The repository is public ([decision](public-repository-reference-docs.md)), and agents write most
of its commits. Written rules alone let a stray note, a local path or a pasted secret through, and
history keeps it. WhatBuild is also a multi-tenant service open to people it lets in, so its
dependencies, workflows and running app need scanning. The maintainer chose on 2026-10-10 to keep
all of this in the repository itself, so that a contributor needs no other account, service or
install, and so that it runs well before the repository becomes public.

## Decision

- **One publishable check**, `scripts/check-publishable.mjs`, runs in git hooks (`pre-commit`,
  `commit-msg`, `pre-push`) that `pnpm install` installs through `core.hooksPath`, and in CI on
  every pull request and push, and on a pull request's text whenever it is edited. It refuses
  secrets (gitleaks), home-directory paths, real email addresses in text and as a commit's author,
  talk about a session and links to one, first-person accounts of the work in commit messages and
  pull request text, and any file outside the places the repository keeps files.
- **What GitHub holds beside the code is checked too**: weekly, the past week's pull request and
  issue text, comments, reviews, release notes, Actions logs and artifacts, with the same rules;
  all of it in an audit.
- **A rule added later holds from the day it is added.** What was published before is audited by
  hand that day, and what is kept is named in the guide; history is not rewritten for what is no
  secret.
- **Private working material has a place**: `_private/` at the root of a checkout, which is
  ignored, so an agent that wants to keep notes has somewhere to keep them.
- **Scanners are pinned** by version and SHA-256 in `scripts/tools.mjs`, downloaded on first use
  into the user's cache: gitleaks, osv-scanner for the dependencies, zizmor for the workflows.
- **A release waits a week** before it enters `pnpm-lock.yaml`: Dependabot's cooldown and pnpm's
  `minimumReleaseAge` for an upgrade made by hand give a hijacked release time to be found. Every
  install in the image takes what that file says and resolves nothing
  ([decision](one-stateless-image.md)).
- **GitHub's own features** do the rest: Dependabot alerts, security updates and weekly grouped
  updates; CodeQL, and secret scanning with push protection, once the
  repository is public. An OWASP ZAP baseline scans the app, built as in production, weekly in CI.
- **What is waiting reaches the maintainer through agents.** `pnpm attention` lists Dependabot's
  pull requests and the alerts nobody has accepted, failed runs, accepted vulnerabilities near expiry and changes
  production lacks, and `AGENTS.md` has every agent run it at the start of a session and say what
  it found. The maintainer chose this on 2026-10-10, so that nothing depends on anyone
  remembering a project's chores.
- Rejected: a hosted scanning service or a dependency-tracking server, which would be another
  account and another thing to run; a git-hook framework, which `core.hooksPath` makes needless;
  and rewriting published history for what is no secret (an author's address, a session link),
  which would change every commit since and leave the old ones in pull request refs anyway.

## Consequences

- A leak is refused before it leaves the machine, with no care needed from whoever commits. The
  push and CI check the same commits again, so `--no-verify` gains nothing.
- No check is required to merge: `main` takes direct pushes, and a new advisory should not stop
  unrelated work. A failure is visible, not blocking.
- Updating a scanner is a commit that changes its version and hashes.

## Constrains

- A new top-level entry or document location is added to the lists in
  `scripts/check-publishable.mjs` in the same commit.
- Every action in `.github/workflows/` is pinned to a commit; checkouts do not persist credentials.
- A known vulnerability is fixed or accepted in `.github/osv-scanner.toml` with a reason and an
  expiry.

Specified in: [security checks](../operations/security-checks.md),
[working in this repository](../process/working-in-this-repository.md).
