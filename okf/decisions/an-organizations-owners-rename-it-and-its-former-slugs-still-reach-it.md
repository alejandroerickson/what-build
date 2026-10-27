---
type: Decision
title: An organization's owners, and the instance's owners, rename it and change its slug; a slug it had before still reaches it
description: products.rename_tenant changes an organization's name and slug, for its owners and for an instance owner in any organization, and every address written with a former slug keeps working because no other organization may ever take it.
tags: [decision, tenancy, roles, identity, operations]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# An organization's owners, and the instance's owners, rename it and change its slug; a slug it had before still reaches it

## Context

An organization's name and slug were set when it was created and nothing changed them afterwards,
so a misspelled name stayed, and so did the example organization's names from when it was a
sandbox. The slug is in every product's path (`/t/<org>/…`), in a scoped connector's address
(`/mcp/t/<org>`), in an OAuth token's resource, and in the absolute links Story pages hold, so a
slug that simply changed would break all of them. The instance's owners already see every
organization and set its plan, but hold no role in most of them.

## Decision

- **`products.rename_tenant` changes the name, the slug, or both.**
- **A slug it had before still reaches it.** Former slugs are kept (`tenant_slugs`) and resolved
  wherever a slug is (`tenantNamed`, `packages/core/src/policy.ts`), so REST, MCP, a scoped
  connector and its token keep working unchanged; their answers give the current slug. The web app
  takes an address with a former slug to the current one, once `products.list` shows the person
  that slug among the organization's `former_slugs`.
- **No organization takes a slug another has or had** (`409 slug_taken`), so an old link never
  leads into another organization; one may take back its own. Deleting an organization frees its
  slugs.
- Rejected: HTTP redirects from the old address. An MCP client or a token bound to the old
  resource would not follow one, and a redirect would show the new slug to anyone holding the old,
  member or not.
- **Its owners change them**, the example organization's owners as any others, through both doors;
  an agent needs an admin connection. **An instance owner changes them in any organization**, as
  one of its owners, member or not, in the web app only: an operation opts in with
  `allowInstanceOwners`, which lets them in to that operation alone and gives no grant. Their agent
  renames only what their own roles reach, as anyone's does
  ([decision](running-the-instance-is-done-in-the-web-app-never-by-an-agent.md)).
- Name and slug share one etag, `tenants.name_etag`. A change is recorded in the organization's
  access log (`members.activity`).

## Consequences

- Text written with the old name or slug keeps it: earlier log entries, a Story page that names
  them in its own words. Its links still work.
- `WHATBUILD_EXAMPLE_TENANT` may name a former slug: the server finds the example by it and warns.
- A slug, once used, stays with its organization until the organization is deleted.

## Constrains

- Every lookup of a tenant by slug uses `tenantNamed`; slugs change only under the lock in
  `ops/products.ts`, checked against both tables.
- An instance owner's way into a tenant operation is given in `resolveScope` alone, for an
  operation that sets `allowInstanceOwners`. Another operation that sets it needs a reason here.

Specified in: [§3.3](../spec/03-accounts-teams-and-identity.md#33-tenants-and-teams).
