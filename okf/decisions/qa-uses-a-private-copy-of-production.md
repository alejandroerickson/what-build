---
type: Decision
title: Manual QA and end-to-end tests may use a copy of production that stays on the maintainer's machine
description: A copy of the deployment's example organization or other organizations its instance owners own, with their files, is pulled with a read-only role into an ignored folder, loaded into its own local database, and served with pending migrations applied; it is never committed, shared or quoted.
tags: [decision, development, testing, qa, production, privacy]
generated: {by: agent:claude, at: 2026-10-27}
status: stable
---

# Manual QA and end-to-end tests may use a copy of production that stays on the maintainer's machine

## Context

The synthetic sample product is small and tidy, so it cannot show how a migration or a screen
behaves on months of real work. The retirement of insights and decisions was the first migration
that rewrote existing content, and the maintainer wanted it tried on the deployment's own data
before production ran it. On 2026-10-09 they asked for a copy of production that manual QA and
agents could use again and again. The repository is public, and the copy is real people's data.

## Decision

- A copy is of the example organization or other organizations an instance owner owns, and of
  nothing else; a customer's organization never reaches it
  ([decision](copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)). Pulling
  the example organization, or the instance owners' organizations a test needs, to this machine is
  routine: an agent does it without asking. Their rows are read as the deployment's read-only
  backup role, and their files are copied with them, because a source's derived text is kept in
  files.
- Copies live under `.what-build/`, which git ignores, on the maintainer's machine. Nothing from a
  copy is committed, uploaded, shared or quoted in the repository, a commit, an issue or a pull
  request. The dev deployment takes its own copy from production through a temporary directory, never
  from a pull kept there
  ([decision](releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)).
- A copy is loaded into its own database, `fixture`, in the embedded Postgres, next to the
  synthetic `whatbuild` database, and is served with `pnpm dev:fixture`. That runs pending
  migrations and their jobs as a release would, prints mail instead of sending it, and uses only
  local files.
- The development sign-in's sample people are given their sample roles in every organization of
  the copy: Riley an owner, Sam an editor, Jordan a reader. One click signs in to real data, as it
  does to the sample.
- Rejected:
  - **An anonymized dump in the repository.** The repository is public, and free text cannot be
    anonymized reliably.
  - **A shared copy in the cloud for QA.** It would be one more place real data lives, behind one
    more credential. The one copy in the cloud is the dev deployment's, kept for rehearsing releases,
    which the maintainer chose on 2026-10-10, and it holds no more than this copy may
    ([decision](releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)).

## Consequences

- Pulling needs access to the deployment and Postgres client tools of its server's version.
  Ordinary development still needs neither
  ([decision](development-substitutes-adapters-never-behavior.md)).
- Tests in the repository, the seed and published screenshots stay synthetic. A copy is never a
  source of committed test content. The end-to-end golden master is made locally from a pull
  ([decision](end-to-end-tests-are-plans-an-agent-runs-on-a-golden-master.md)), so its plans name
  nothing in it.

## Constrains

- `apps/server/src/fixture.ts` (pull and load) and `apps/server/src/organization-copy.ts`, the `--fixture` mode of `apps/server/src/dev.ts`,
  and the end-to-end golden master built from a pull (`apps/server/src/e2e.ts`).
  The fixture mode must keep mail printed and files local, and must not seed sample content.

Specified in: [a copy of production](../operations/a-copy-of-production.md).
