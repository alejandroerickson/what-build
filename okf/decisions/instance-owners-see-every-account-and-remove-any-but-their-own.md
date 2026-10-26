---
type: Decision
title: An instance's owners see every account and may remove any but an instance owner's, which forgets the address and keeps the name on what it wrote
description: People lists every account for the instance's owners; removing one, in the web app only, signs it out everywhere, takes its roles with a record in each organization, and forgets its address.
tags: [decision, identity, accounts, instance, privacy, security]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# An instance's owners see every account and may remove any but an instance owner's, which forgets the address and keeps the name on what it wrote

## Context

The instance's owners decide who may create organizations and on which plan
([decision](only-instance-owners-decide-who-creates-organizations.md),
[decision](free-organizations-meet-limits-that-only-instance-owners-change.md)), but nobody could
see who had an account or take one away: removing a test account, or someone who should no longer
be in, meant changing the database by hand. The maintainer asked on 2026-10-25 for a page that
manages people across the instance.

## Decision

- **People** (`/people`) lists every account for the instance's owners (`products.accounts`): its
  name and address, the organizations it is in with its roles, when it was last seen, its sessions
  and agents, and its address's allowance. Through either door; it holds no organization's content.
- **Removing an account is an instance owner's act in the web app** (`products.remove_account`,
  web only), with the address typed exactly. An instance owner's account cannot be removed there,
  and neither can the only owner of an organization until someone else owns it or it is deleted.
- **Removing** ends every session and agent connection, takes every role (each organization's
  access log records it), cancels the invitations and the allowance at the address, deletes what is
  kept about the person, forgets the address and emails it a confirmation: exactly what a person deleting
  their own account does ([decision](a-person-deletes-their-own-account-after-a-recent-sign-in.md)).
  The row stays, marked removed and nameless, so its id is never taken again; what the account
  wrote keeps the name copied onto it.
- Rejected: letting an organization's owners remove accounts (an account is not theirs, and is in
  other organizations), and deleting the row (attribution and logs name the account by id).

## Consequences

- The address may sign up again only if something lets it in again: an allowance, an invitation or
  the sign-up allowlist.
- Content the account wrote, and the activity log, still show its name.

## Constrains

- `endSignIns` (`packages/core/src/accounts.ts`) is the one way an account is signed out of
  everything; Sign out everywhere and removal both use it.
- Code that reads an account for sign-in, admission or mail skips one with `deleted_at` set.

Specified in: [§3.2](../spec/03-accounts-teams-and-identity.md#32-accounts-and-sign-in), [§6](../spec/06-operations-and-adapters.md), [§7](../spec/07-web-app.md).
