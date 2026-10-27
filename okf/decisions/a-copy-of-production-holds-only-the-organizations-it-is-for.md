---
type: Decision
title: A copy of production holds only the organizations it is for, by default the example organization, and nothing of any other leaves production
description: Pulls, the golden master and the dev deployment take the organizations named (the example organization unless others are), read from production in one snapshot, so that an organization kept private never reaches a copy.
tags: [decision, development, testing, dev, production, privacy, operations, tenancy]
generated: {by: agent:claude, at: 2026-10-27}
status: deprecated
---

# A copy of production holds only the organizations it is for, by default the example organization, and nothing of any other leaves production

Superseded on 2026-10-27 by [Copies outside production hold only organizations an instance owner owns, and synthetic ones; customers' organizations never leave production](copies-outside-production-hold-only-organizations-an-instance-owner-owns.md).

## Context

The local copy, the end-to-end golden master and the dev deployment each took all of production,
although the golden master keeps only one organization. A deployment also holds organizations that
are no one's test material, such as private work and, later, customers'. The
maintainer chose on 2026-10-11 to copy the public sandbox, or the organizations named, and nothing
else, and to be able to take one organization out of a deployment into another database. The
example organization took the sandbox's place as the default when it replaced the sandbox
([decision](every-account-reads-the-example-organization-which-only-its-staff-write.md)).

## Decision

- **A pull takes organizations, not the deployment**: the example organization, or those named with
  `--org`. Their rows are read in one snapshot through the read-only backup role, and only theirs
  leave production: teams, products, content, jobs, the accounts their rows refer to, and the
  record of migrations. The deployment's own rows stay: sessions, connections, sign-in links,
  allowances, the interest list, usage counts, and feedback with its daily counts. Their files are their folders, `t/<tenant_id>/`.
- **A pull is an ordinary dump** of a database holding only them, so the local copy, the golden
  master and the dev deployment restore it as they restore any dump.
- **The dev deployment holds the organizations `.env` names** (`NEON_DEV_COPY_ORGANIZATIONS`), the
  example organization by default.
- **`--all` stays** for a migration that needs every organization's shapes. `pnpm attention`
  reports each pull of everything until it is deleted, and a dev copy that names no organizations.
- Rejected: **dumping everything and deleting the rest locally**, which still brings every
  organization to the machine; **`pg_dump` with table filters**, which cannot filter rows.

## Consequences

- An organization that is kept private reaches no copy unless someone names it.
- Migrations are rehearsed on the copied organizations' shapes only. A migration that rewrites
  content the example organization lacks is tried on an `--all` pull locally, or on dev with more organizations named.
- A copy restores into an empty database. Adding one to a database that holds other organizations
  is not built ([roadmap](../spec/10-roadmap.md)).

## Constrains

- `apps/server/src/organization-copy.ts`: a table without `tenant_id` is either copied (`tenants`,
  `accounts`, `schema_migrations`) or listed in `DEPLOYMENT_TABLES`; the copy refuses one that is
  neither, so a new table gets a decision.
- Every stored file an organization's rows name is under `t/<tenant_id>/`; the copy refuses a key
  outside it.
- Narrows [the copy on the maintainer's machine](qa-uses-a-private-copy-of-production.md) and
  [the dev deployment's copy](releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md).

Specified in: [copying an organization](../operations/copying-an-organization.md).
