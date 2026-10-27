---
type: Decision
title: An instance's owners see every account and may remove any but an instance owner's, which forgets the address and keeps the name on what it wrote
description: People lists every account for the instance's owners; removing one, in the web app only, signs it out everywhere, takes its roles with a record in each organization, forgets its address, and deletes the organizations it alone owns once each is named.
tags: [decision, identity, accounts, instance, privacy, security]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# An instance's owners see every account and may remove any but an instance owner's, which forgets the address and keeps the name on what it wrote

## Context

The instance's owners decide who may create organizations and on which plan
([decision](only-instance-owners-decide-who-creates-organizations.md),
[decision](limits-belong-to-plans-and-each-organization-is-on-a-plan-of-its-own.md)), but nobody could
see who had an account or take one away: removing a test account, or someone who should no longer
be in, meant changing the database by hand. The maintainer asked on 2026-10-25 for a page that
manages people across the instance, and chose on 2026-10-26 that an instance owner may also remove
the only owner of an organization, after a warning, and delete any organization.

## Decision

- **People** (`/people`) lists every account for the instance's owners (`products.accounts`): its
  name and address, the organizations it is in with its roles, when it was last seen, its sessions
  and agents, and its address's allowance. In the web app only, as all of running the instance is
  ([decision](running-the-instance-is-done-in-the-web-app-never-by-an-agent.md)); it holds no
  organization's content.
- **Removing an account is an instance owner's act in the web app** (`products.remove_account`,
  web only), with the address typed exactly. An instance owner's account cannot be removed there.
- **The only owner of an organization takes it with them.** The dialog says which organizations go,
  with what each holds and who else loses their roles there, and the call names each by slug
  (`delete_organizations`), or is refused (`409 last_owner`). An organization never stands without
  an owner. The example organization is never deleted this way.
- **An instance owner deletes any organization** but the example, as its owners do, in the web app
  only (`products.delete_tenant`, which they may call in any organization).
- **Removing** ends every session and agent connection, takes every role (each organization's
  access log records it), cancels the invitations and the allowance at the address, deletes what is
  kept about the person, forgets the address and emails it a confirmation: exactly what a person deleting
  their own account does ([decision](a-person-deletes-their-own-account-after-a-recent-sign-in.md)).
  The row stays, marked removed and nameless, so its id is never taken again; what the account
  wrote keeps the name copied onto it.
- Rejected: letting an organization's owners remove accounts (an account is not theirs, and is in
  other organizations), and deleting the row (attribution and logs name the account by id). Also
  rejected: leaving an only owner's organization without an owner, which nobody could then manage,
  or handing it to the instance owner, who would hold other people's work.

## Consequences

- The address may sign up again only if something lets it in again: an allowance, an invitation or
  the sign-up allowlist.
- Content the account wrote, and the activity log, still show its name.
- Removing an organization's only owner can erase other people's work there; the warning names the
  organizations and how many others lose their roles, and nothing goes unless named.

## Constrains

- `endSignIns` (`packages/core/src/accounts.ts`) is the one way an account is signed out of
  everything; Sign out everywhere and removal both use it.
- `destroyOrganization` (`packages/core/src/ops/deletes.ts`) is the one way an organization is
  deleted; deleting it and removing its only owner both use it.
- Code that reads an account for sign-in, admission or mail skips one with `deleted_at` set.

Specified in: [§3.2](../spec/03-accounts-teams-and-identity.md#32-accounts-and-sign-in), [§6](../spec/06-operations-and-adapters.md), [§7](../spec/07-web-app.md).
