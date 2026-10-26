---
type: Decision
title: Free organizations meet limits on how often and how much, and only instance owners change an organization's plan or limits
description: An organization someone other than an instance owner creates gets the plan the deployment names, unlimited unless it names free; the free plan's limits are enforced in one layer for everyone in it.
tags: [decision, limits, tenancy, sign-up, cost]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Free organizations meet limits on how often and how much, and only instance owners change an organization's plan or limits

## Context

Anyone an instance owner lets in may create an organization, and each one costs database rows,
storage and parsing, which a deployment on small free tiers soon runs out of. The public sandbox
already had limits on how often and how much a visitor did, enforced in one layer for both front
doors. The maintainer chose on 2026-10-25 that those limits move to free organizations when the
sandbox goes ([decision](every-account-reads-the-example-organization-which-only-its-staff-write.md)),
and that paid organizations will have limits too.

## Decision

- **Every organization has a plan**, `free` or `unlimited` (`tenants.plan`). One created on an
  allowance gets the plan the deployment names (`WHATBUILD_NEW_ORGANIZATION_PLAN`), unlimited
  unless it names free; one an instance owner creates is always unlimited. Organizations that
  existed before plans are unlimited. A paid plan, when there is one, is another value.
- **Who sets the deployment's plan.** A self-hosted deployment, whose organizations are its own
  people's, leaves the setting out and its organizations are unlimited. A deployment open to the
  public names `free`, and so does local development.
- **The free plan's limits are the sandbox's**: calls and writes a minute, writes, sources, exports
  and uploaded bytes a day for each person, writes and bytes a day for the whole organization, the
  size of a file, of a text field and of a batch, and switches for fetching from a URL and for
  formats the parsers do not read. Their defaults are in code (`FREE_LIMITS`).
- **Only instance owners change an organization's plan or any of its limits**
  (`products.set_limits`), and only they list every organization with its plan
  (`products.organizations`). An organization's owners read its limits, with what is used today,
  like every member (`products.limits`); they cannot raise them.
- **Everyone in a free organization meets them**, its owners included. A day is a UTC day.
- **Limits are enforced in `execute`**, so REST and MCP cannot differ. A call over one is refused
  with `429 rate_limited`, `409 quota_exceeded` or `413 too_large`; one a limit of 0 or a switch
  turns off is refused with `403 plan_restricted`.

## Consequences

- An organization's cost is bounded by day, not in total; a cap on what a free organization holds
  is planned ([roadmap](../spec/10-roadmap.md)).
- Raising one organization's limits is an instance owner's act, recorded on the organization with
  who made it.

## Constrains

- Every limit is a field in `packages/core/src/limits.ts`, listed with its unit, what it is counted
  over and its refusal; the control panel and `products.limits` are built from that list.
- Counters live in `limit_counters`, keyed by tenant, person, minute or UTC day; nothing else
  counts against a limit, and the worker drops counters past their day.

Specified in: [§3.3](../spec/03-accounts-teams-and-identity.md#33-tenants-and-teams), [§9.7](../spec/09-data-lifecycle.md).
