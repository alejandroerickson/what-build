---
type: Decision
title: Copies outside production hold only organizations an instance owner owns, and synthetic ones; customers' organizations never leave production
description: The local copy, the end-to-end golden master, the Docker host and the dev deployment take from production only organizations every owner of which is an instance owner, the example organization among them, and a pull refuses any other; moving an organization into another production deployment of its own is not such a copy.
tags: [decision, privacy, production, dev, testing, tenancy, operations]
generated: {by: agent:claude, at: 2026-10-27}
status: stable
---

# Copies outside production hold only organizations an instance owner owns, and synthetic ones; customers' organizations never leave production

## Context

Testing and rehearsal use copies of production: a pull on the maintainer's machine, the golden
master built from it and served on a Docker host, and the dev deployment
([decision](releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)). Each took
the example organization or whichever organizations were named, and a pull could take every
organization. A cloud copy on dev had been judged acceptable until public sign-up opens, to be
decided again before then. The maintainer decided it on 2026-10-27: a copy outside production holds
no production data but organizations an instance owner owns, and synthetic organizations. This
replaces [the copy that held whichever organizations it was for](a-copy-of-production-holds-only-the-organizations-it-is-for.md).

## Decision

- **Outside production** are the dev deployment, the golden master and its exports, the Docker host
  that serves it, and local copies (`pnpm fixture pull`, the `fixture` database).
- **An instance owner owns an organization** when it has owners and every one of them is among the
  deployment's instance owners (`WHATBUILD_INSTANCE_OWNERS`). One a customer owns, alone or beside an
  instance owner, is the customer's. The example organization is one an instance owner owns.
- **A copy takes organizations, not the deployment**: their rows, read in one snapshot through the
  read-only backup role, and their folders of files, `t/<tenant_id>/`; the deployment's own rows
  (sessions, connections, sign-in links, allowances, the waitlist, usage, feedback counts) stay. It is
  an ordinary dump, restored as any dump is.
- **The pull checks the owners** against the deployment's instance owners, refuses an organization
  that fails and says why, and records that it checked. `--all` takes every organization the
  instance owners own. Loading a pull, building or exporting the golden master and loading an export
  on a Docker host refuse a copy without that record.
- **Every copy outside production can start from one dataset**, `pnpm dataset`: a pull beside
  synthetic organizations of a size and shape chosen for testing, made through the operations,
  written as a pull ([the non-production dataset](../operations/the-non-production-dataset.md)).
- **Not a copy outside production:** moving an organization into another production deployment of
  its own (`--for-another-deployment`, through a directory only its operator reads), a restore into
  production after a bad release, a deployment's own backups, and the restore drill, which uses a
  scratch database and bucket in production's own accounts ([backups](../operations/backups.md#the-restore-drill)).
- Rejected: **a cloud copy of any organization named, until public sign-up**, which puts customers'
  data in a second place for testing's sake; **a pull of every organization** for a migration's
  shapes, which synthetic organizations shaped like them give instead.

## Consequences

- No one's naming it brings a customer's organization into a copy.
- Rehearsals see real data only in the instance owners' organizations, with the accounts their rows
  name; shapes those lack come from synthetic organizations.
- A pull needs the deployment's instance owners: its Cloud Run service's, or
  `WHATBUILD_FIXTURE_INSTANCE_OWNERS`. Copies made before the check are refused, and `pnpm attention`
  names them until they are deleted or made again.
- A copy restores into an empty database; adding one to a database that holds others is not built
  ([roadmap](../spec/10-roadmap.md)).

## Constrains

- `apps/server/src/organization-copy.ts`: `organizationsToPull` refuses for every copy outside
  production. A table without `tenant_id` is copied whole (`tenants`, `accounts`, `schema_migrations`)
  or listed in `DEPLOYMENT_TABLES`, so a new table gets a decision; a file key outside `t/<tenant_id>/`
  stops the copy.
- `apps/server/src/fixture.ts` (pull, load), `apps/server/src/dataset.ts` (the dataset, whose
  synthetic part is made through the operations), `apps/server/src/e2e.ts` (golden master,
  export), `deploy/docker/whatbuild-e2e.sh load` and `scripts/attention.mjs` keep the record's rule.

Specified in: [copying an organization](../operations/copying-an-organization.md).
