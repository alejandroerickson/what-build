---
type: Decision
title: A deployment's capacity is load-tested on a dev deployment, signed in as synthetic people, never on production
description: A load test finds where a deployment breaks, so it runs where breaking hurts nobody, with sessions made for synthetic people at example.com, reading the example organization and writing only in an organization of its own.
tags: [decision, operations, load-test, capacity, dev, production, privacy]
generated: {by: agent:claude, at: 2026-11-25}
status: stable
---

# A deployment's capacity is load-tested on a dev deployment, signed in as synthetic people, never on production

## Context

Before traffic grows, a deployment needs to know how much one instance takes, what gives out first
and what more of anything would buy. Finding out means pushing past the point where people wait.
On production that is an outage for real people, a bill, and a share of a database plan's monthly
allowance that can suspend the database until the month ends. A
[dev deployment](../operations/dev-deployment.md) runs the same image and settings on a copy of the
instance owners' organizations ([decision](releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)),
and its only sign-in is a real identity provider's, which a load generator cannot use.

## Decision

- **A load test runs on a dev deployment, never on production**, with dev's service and database
  set as production's for the test and put back afterwards
  ([load testing](../operations/load-testing.md)).
- **It signs in as synthetic people**: accounts at `example.com`, with sessions and access tokens
  made in dev's database by `scripts/load-test/accounts.mjs`, all removed afterwards. They read the
  example organization, which every account reads, and write only in an organization made for the
  test. Nothing is written into the instance owners' organizations.
- **It is sized against the database's month and the spending cap** before it runs, and stops at
  the first step past its limits.
- **The tool is k6**, installed on its own; the repository holds the test, not a dependency.
- Rejected: testing production at a quiet hour, which still breaks it for whoever is there and
  spends production's allowances; and signing in through the identity provider, which a load
  generator cannot do without a real person's account.

## Consequences

- A test's figures describe the deployment it ran on. They are kept with that deployment's own
  notes, never in this repository.
- Differences between dev and production that stay (a Worker in front, traces, the database's
  region) are accounted for in reading the result, not hidden.
- `accounts.mjs` writes rows the schema defines; a migration that changes `accounts`, `sessions`,
  `memberships`, `tenants` or the OAuth tables changes it in the same change.
