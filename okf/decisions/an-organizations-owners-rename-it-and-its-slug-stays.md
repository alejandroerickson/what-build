---
type: Decision
title: An organization's owners, and the instance's owners, rename it; its slug stays
description: products.rename_tenant changes only an organization's name, for its owners and for an instance owner in any organization, so no address that holds its slug breaks.
tags: [decision, tenancy, roles, identity, operations]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# An organization's owners, and the instance's owners, rename it; its slug stays

## Context

An organization's name was set when it was created and nothing changed it afterwards, so a
misspelled name stayed, and so did the example organization's name from when it was a sandbox.
Its slug is in every product's path (`/t/<org>/…`), in a scoped connector's address
(`/mcp/t/<org>`) and in the absolute links Story pages hold, so changing the slug would break
those unless the old one redirected. The instance's owners already see every organization and set
its plan, but hold no role in most of them.

## Decision

- **A rename changes the name only.** `products.rename_tenant` leaves the slug as it is, so
  nothing addressed by it breaks. Changing a slug is not offered
  ([roadmap](../spec/10-roadmap.md#open-questions)).
- **Its owners rename it**, the example organization's owners as any others, through both doors;
  an agent needs an admin connection. Its admins and members do not.
- **An instance owner renames any organization**, as one of its owners, member or not. An
  operation opts in with `allowInstanceOwners`; it lets them in to that operation alone, and gives
  them no grant and no sight of the organization's content.
- The name has an etag of its own, `tenants.name_etag`, as the limits have theirs.
- A rename is recorded in the organization's access log (`members.activity`), with the old name.

## Consequences

- Text written with the old name keeps it: earlier entries in the organization's logs, a Story
  page or a source that names the organization in its own words.
- An instance owner's rename in an organization on the free plan counts as a write there, as
  anyone's does.

## Constrains

- An instance owner's way into a tenant operation is given in one place, `resolveScope`
  (`packages/core/src/policy.ts`), for an operation whose definition sets `allowInstanceOwners`;
  `execute` decides whether the caller is one. Another operation that sets it needs a reason here.

Specified in: [§3.3](../spec/03-accounts-teams-and-identity.md#33-tenants-and-teams).
