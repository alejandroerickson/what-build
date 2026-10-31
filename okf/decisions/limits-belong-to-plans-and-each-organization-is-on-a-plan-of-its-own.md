---
type: Decision
title: Limits belong to plans, never to one organization, and each organization is on a plan of its own
description: A plan sets every limit, the totals an organization holds included; an instance owner moves an organization between plans and changes no organization's limits.
tags: [decision, limits, plans, tenancy, billing, cost]
generated: {by: agent:claude, at: 2026-10-31}
status: stable
---

# Limits belong to plans, never to one organization, and each organization is on a plan of its own

## Context

It replaces [an earlier decision](free-organizations-meet-limits-that-only-instance-owners-change.md),
under which an instance owner could change any limit of one organization and the free plan bounded
only a day. Limits set one organization at a time cannot be explained, priced or compared, and a
free organization that kept within its days still grew without end. The maintainer chose on
2026-10-26 that limits are set per plan, that a paid plan sits beside the free one with more plans to
come, and that one plan covers exactly one organization. The same day they chose that each person
has one organization at a time on the plan new ones start on, what becomes of a paid organization
that stops being paid for, and that the plans themselves are the deployment's
([decision](the-deployment-defines-its-plans-and-billing-stays-outside-the-repository.md)).

## Decision

- **Plans:** the ones the deployment defines (`WHATBUILD_PLANS`), each setting every limit, and
  `unlimited`, never offered, which sets none: the deployment's own organizations, and every
  organization of a deployment that defines no plans.
- **An instance owner changes a plan's limits and price** (`products.set_plan_limits`,
  `/instance`), in the web app and never through an agent
  ([decision](running-the-instance-is-done-in-the-web-app-never-by-an-agent.md)), for every
  organization on it, and raises them as the deployment grows. What they set is stored with the
  deployment (`instance_settings`), over what its configuration defines.
- **Totals beside the days:** people with more than the Story-only reader role (an invitation holds
  a place), products and sources, archived or not, and storage (files, and text as stored, every
  version), all per organization; and the bytes sent to each person a day.
- **Archived products and sources count.** Otherwise someone archives what they hold, adds as much
  again, and restores what they need in turn, and a plan's totals limit nothing. Deleting is how to
  make room, so restoring adds nothing and no total refuses it.
- **One organization, one plan.** A second organization is a second plan, billed on its own.
- **One organization each on the starting plan** (the one new organizations start on, Free in the
  example file). An allowance counts the organizations someone started that are still on it and
  not read-only: one moved to another plan frees its place, and only payment limits how many paid
  organizations anyone has. Being invited to any number of organizations never counts.
- **A paid organization no longer paid for** goes back to the starting plan, keeping everything
  and adding nothing past its totals, if its creator has no other there (or room for another an
  instance owner gave them), even with no allowance to start one. Otherwise it is
  **read-only**, kept a year with the date shown to its people: they read, export, delete and take
  people out, and nobody adds to it until it moves to another plan. Rejected: making the creator
  choose which of two organizations to keep, which asks them to give up work before they can see it.
- **Only instance owners move an organization to another plan** (`products.set_plan`); nobody
  changes one organization's limits. A move never removes anything an organization holds past the
  new plan's totals.
- **Never blocked:** reading, searching, deleting and export, by a total or a day's writes; calls
  and writes a minute pace them. A person is told to delete to make room, so a day's writes must not
  stop them, nor removing someone or cancelling an invitation, and none of those is counted as a
  write, so one person's clearing up takes nothing from anyone's day. Whoever reads the refusal is told
  who can delete, since an editor who adds and archives cannot. An export is counted against the bytes
  sent and always sent. A total never stops archiving or restoring; a day's writes do, because
  archiving makes no room, and an operation that archives may restore as well, so sparing it would
  leave writes without a limit.
- **A total never makes an organization read-only.** One past a total keeps everything and goes on
  working; only adding more of that kind is refused.
- **A plan's price is the deployment's**, as people read it, in its configuration or set by an
  instance owner; the repository never holds one. Billing, when it comes, is a service of its own.
- **Who runs the deployment sees** an organization's name and plan, and the name and email of
  everyone in it, to bill the organization and write to its people; where the deployment offers
  plans, the new-organization form, an organization's Plan page and the privacy page say so.

## Consequences

- A plan can be explained and compared in one table (`/plans`, and the public site's).
- Changing what an organization may do means changing its plan, or every organization on a plan.
- Someone who stops paying loses nothing for a year, and the deployment stores a read-only
  organization's data that long; nothing erases it at the end yet.
- What an organization holds is measured when asked, from the rows and sizes it has, rather than
  from a counter kept beside each write.

## Constrains

- Every limit is a field of `Limits` in `packages/core/src/plans.ts`, listed in `LIMITS` with its
  unit, what it is counted over and its refusal; `products.limits`, `/api/v1/plans` and the web
  app are built from them.
- An allowance is counted by `tenantsCreatedBy` (`packages/core/src/tenant-allowance.ts`), and
  whether the starting plan would be read-only is decided in `products.set_plan`, with the tenant's
  `read_only_since` and `kept_until`; `execute` refuses a write there unless the operation is
  marked `allowReadOnlyOrganization`.
- Totals are checked in `execute` (`checkTotals`), in `members.grant` (`checkMembers`) and when an
  upload grant is issued; bytes sent are counted on the routes that send files, exports and
  mockup downloads (`admitSend`).
- A plan's limits are read through `readPlans` (`packages/core/src/settings.ts`), never from the
  configured definitions directly, so what an instance owner set applies everywhere.

Specified in: [§3.3](../spec/03-accounts-teams-and-identity.md#33-tenants-and-teams), [§9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas), [§9.7](../spec/09-data-lifecycle.md#97-plans-and-limits).
