---
type: Decision
title: Only the instance's owners decide who may create organizations, and how many
description: Creating a tenant needs an allowance an instance owner gave the address, counted against the tenants it created; belonging to a tenant never grants one.
tags: [decision, identity, tenancy, roles, limits, sign-up]
generated: {by: agent:claude, at: 2026-10-01}
status: stable
---

# Only the instance's owners decide who may create organizations, and how many

## Context

Every signed-in account could create organizations, as many as it liked, except an account a
sandbox invitation alone had created, and that exception lapsed once anyone gave it a role in
another organization. So inviting someone into a private organization also let them start
organizations of their own, and nothing capped how many anyone started. Each organization costs
storage and support, and is the obvious unit for any future limit. The maintainer chose on
2026-10-01 that the people who run an instance decide who may create organizations and how many,
and that being in an organization never lets anyone create one.

## Decision

- **Instance owners** are the addresses in `WHATBUILD_INSTANCE_OWNERS`. They create any number and
  are the only ones who read or change allowances. A tenant owner is not an instance owner and
  cannot grant either.
- **Everyone else needs an allowance**: a number an instance owner gives an address, counted
  against the tenants that address's account created. Tenants someone belongs to never count.
- **An allowance belongs to an address**, as an invitation does, so it can be given before the
  account exists, and above 0 it admits the address while sign-up is limited.
- **The default for an address without one is the deployment's `WHATBUILD_TENANT_ALLOWANCE`**, 0
  unless set, so opening sign-up later is a configuration change.
- Rejected: letting tenant owners grant allowances (anyone could then multiply organizations), and
  keeping a special rule for sandbox accounts (an allowance of 0 already covers them).

## Consequences

- A deployment with no instance owner configured lets nobody create an organization; existing ones
  carry on. The deployment guide says to set it.
- Instance-level changes belong to no tenant, so they have no activity log; each allowance row
  keeps who gave it and who changed it last.

## Constrains

- `products.create_tenant` checks `requireTenantAllowance` (`packages/core/src/tenant-allowance.ts`)
  under a lock on the account; nothing else creates a tenant except the development seed.
- `accounts.sandbox_only` no longer bears on creating organizations.

Specified in: [§3.3](../spec/03-accounts-teams-and-identity.md#33-tenants-and-teams).
