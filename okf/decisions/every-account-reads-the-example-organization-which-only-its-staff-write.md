---
type: Decision
title: Every account reads the example organization, which only its staff write
description: The public sandbox is gone. One organization the deployment names is a read-only worked example every signed-in account can always open, and people work in organizations of their own.
tags: [decision, example, tenancy, roles, security, mcp]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Every account reads the example organization, which only its staff write

## Context

The public sandbox let invited strangers edit one shared organization. Text in a source can carry
instructions, so what one visitor wrote reached every other visitor's agent, along with whatever
else that agent held; the shared space was also no place for anyone's real material. A private
copy of the sandbox for each visitor, or per-visitor row-level security inside it, would have kept
strangers apart at the cost of a copy of every row per visitor, or a column and a policy on every
table with the worked example turned read-only anyway. The maintainer chose on 2026-10-25 to drop
the shared writable space instead: the worked example becomes content everyone reads and nobody but
its authors changes, and people write only in organizations of their own. This replaces
[the public sandbox decision](the-public-sandbox-is-one-organization-with-pseudonymous-visitors.md)
and [its connector rule](the-public-sandbox-is-reached-only-through-its-own-connector.md).

## Decision

- **One organization the deployment names is the example** (`WHATBUILD_EXAMPLE_TENANT`). The server
  writes the choice to `tenants.example` at start-up, and policy reads it from there.
- **Only the maintainer's public deployment names one.** A self-hosted deployment serves its own
  people, leaves the setting out and has no example organization; no self-hosting instruction
  sets it.
- **Every signed-in account with no grant there is its guest**: a viewer of every product in it.
  The grant is never stored, so a guest is in no list of members and sees no member, and it counts
  only while the deployment names the organization.
- **A guest changes nothing.** Every call that writes is refused with `403 example_read_only`,
  which tells the caller how to create an organization of their own. Exporting is a write: the
  example is read where it is.
- **Its members are an ordinary organization's.** Staff write under their own names, and guests see
  those names on content and in the activity log.
- **The unscoped connector reaches it**, beside the person's own organizations: only its staff
  write there, so it carries nothing a stranger wrote.
- **Admission is unchanged.** Signing up needs the allowlist, an invitation or an instance owner's
  allowance; giving an address an allowance is how it is let in and what lets it create an
  organization ([decision](only-instance-owners-decide-who-creates-organizations.md)).

## Consequences

- No person reads what a stranger wrote, so planted instructions cannot travel between people.
- Nobody writes before they have an organization. A new account lands in the example and creates
  its own when ready, within its allowance and, on a deployment that names the free plan, the
  [free plan's limits](free-organizations-meet-limits-that-only-instance-owners-change.md).
- Visitors, made-up names, invitation links with places, seats, baselines and the daily reset are
  gone. The example changes only when its staff change it.
- Each guest meets the example's limit on calls a minute: the free plan's, unless an instance owner
  changed it.
- The example organization cannot be deleted while the deployment names it.

## Constrains

- The guest grant is made in `membershipsFor` (`packages/core/src/policy.ts`); nothing else grants
  access to the example. `execute` refuses a guest's write before the input is read.
- Code that lists people or invitations reads `memberships` and `invitations`, never
  `membershipsFor`, so no guest is ever listed.

Specified in: [§3.10](../spec/03-accounts-teams-and-identity.md), [§6](../spec/06-operations-and-adapters.md), [§9.7](../spec/09-data-lifecycle.md).
