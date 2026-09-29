---
type: Decision
title: The public sandbox is one organization the deployment names, where invited visitors edit under made-up names and a daily reset puts a saved baseline back
description: One shared organization instead of a copy per visitor; admission by invitation links with places and a cap on seats; visitors never see each other; limits are settings enforced in one layer.
tags: [decision, sandbox, tenancy, roles, privacy, limits, invitations]
generated: {by: agent:claude, at: 2026-09-29}
status: stable
---

# The public sandbox is one organization the deployment names, where invited visitors edit under made-up names and a daily reset puts a saved baseline back

## Context

A stranger could not try WhatBuild on a real discovery without being invited into someone's
organization. The maintainer asked on 2026-09-29 for one organization to be open to the public as
a sandbox people work in: invite-only, with the number of people under control, no visitor able to
see another, a role that edits content and administers nothing, limits on how often and how much,
a control panel showing every limit, and a reset every 24 hours at 2 a.m. Pacific. A private copy
of the products for each visitor was the alternative; it keeps strangers apart, and costs a copy
of every row and a product-cloning feature that does not exist.

## Decision

- **One organization, named by the deployment** (`WHATBUILD_SANDBOX_TENANT`). The server writes
  the choice to `tenants.sandbox` at start-up, and policy reads it from there.
- **Its owners and admins are its staff. Everyone else there is a visitor**, whatever role they
  hold: their role stops at editor, they meet the limits, and they cannot delete permanently.
- **A visitor writes under a made-up name** (`Visitor 4F2A9C`, from a hash of the tenant and the
  account). The name goes into the actor snapshot at the moment of writing, so no visitor's name or
  address is ever stored in the organization. `members.list` shows a visitor only themselves.
- **Admission is by invitation link with a number of places**, under a cap on seats. The link is
  a bearer credential: whoever holds it may take a place, with any address. This is the choice
  [rejected for ordinary invitations](invitations-belong-to-their-address.md), made here because
  the link gives the least role there is, in a place that is public by design, and a link for forty
  people cannot name forty addresses.
- **An account that an invitation alone created is for the sandbox.** While sign-up is limited it
  cannot create an organization.
- **A baseline is the organization's content held as JSON rows; a reset deletes the content and
  inserts the baseline**, ids included. People and access are never part of a baseline.
- **Limits are settings, enforced in `execute`**, so REST and MCP cannot differ.

## Consequences

- Visitors see and can change each other's work until the next reset; the notice on every screen
  says so. One visitor can archive what the next came to see, within the limits.
- The visitor role fails closed: without the deployment's setting, a visitor's grant gives nothing.
- Staff changes are erased by a reset too, unless a baseline is saved after them.
- A blob is deleted only when no row and no kept baseline refers to it.

## Constrains

- Every write in a sandbox holds `lockSandbox` shared; saving a baseline and resetting hold it
  alone (`exclusive` on the operation).
- A table that carries `tenant_id` is listed in `BASELINE_TABLES` or `NOT_IN_BASELINE`
  (`packages/core/src/public-sandbox-baseline.ts`); a test fails otherwise.
- Code that writes attribution uses `ctx.actor`, never the account's own name.

Specified in: [§3.10](../spec/03-accounts-teams-and-identity.md), [§9.7](../spec/09-data-lifecycle.md), [§6](../spec/06-operations-and-adapters.md).
