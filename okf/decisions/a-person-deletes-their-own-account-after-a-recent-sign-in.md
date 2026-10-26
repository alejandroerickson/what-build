---
type: Decision
title: A person deletes their own account in the web app after a recent sign-in, and ending an account either way deletes what is kept about them and forgets their address
description: Self-serve deletion is a web-only act behind a sign-in from the last 15 minutes and the typed address; it does exactly what an instance owner's removal does, which deletes the person's counts and name and mails a record.
tags: [decision, identity, accounts, privacy, security]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# A person deletes their own account in the web app after a recent sign-in, and ending an account either way deletes what is kept about them and forgets their address

## Context

Only an instance owner could end an account
([decision](instance-owners-see-every-account-and-remove-any-but-their-own.md)), so a person who
wanted to leave had to write to whoever runs the deployment. Ending an account also left behind
what was kept about the person: revoked tokens, their counts against limits and feedback, their
counted days of use, their name on the account row, and their address on an interest request or a
feedback reply. Deletion is rare and final, and a browser left signed in must not be enough for it.
The maintainer chose, on 2026-10-26, a section of Settings that opens in place, any recent sign-in
as the re-confirmation, forgetting the address everywhere it is kept, a confirmation mail on both
paths, and telling the person nothing about backups.

## Decision

- **A person deletes their own account** in the Delete account section of Settings
  (`products.delete_account_impact`, `products.delete_account`), web only, never through an agent.
  It needs a browser session that signed in within the last 15 minutes (`403 sign_in_again`), by
  any method the deployment offers, the address typed exactly, and `confirm`.
- **Both ways of ending an account do the same thing** (`endAccount` in
  `packages/core/src/ops/accounts.ts`): sign-ins end; roles go with a record in each organization;
  invitations, allowance and sign-in links at the address go; the person's tokens and OAuth codes,
  counts against limits and feedback, and counted days of use are deleted; the address is cleared
  from interest requests and feedback replies; the row keeps no name and no address. What they
  wrote keeps the name copied onto it. A confirmation goes to the address.
- The same refusals hold on both: an instance owner (`409 instance_owner`) and the only owner of an
  organization (`409 last_owner`, naming each).
- The words are one text (`packages/core/src/account-deletion.ts`), said before deleting and
  after. They promise nothing about backups, whose windows are the operator's
  ([erasure](../operations/erasure.md)).
- Rejected: a mailed link as the only re-confirmation (a deployment without mail could not offer
  deletion); deleting content with the account (it is the organization's record).

## Consequences

- A borrowed browser whose Google or Microsoft session is still open can sign in again; a mailed
  link asks more, and either is offered.
- The address may come back only as a new, empty account, let in like anyone else.

## Constrains

- An agent is never offered either operation (`webOnly`).
- Anything new that keeps data about a person is deleted or cleared in `endAccount`, and the
  terms say so.

Specified in: [§3.2](../spec/03-accounts-teams-and-identity.md#32-accounts-and-sign-in), [§9.5](../spec/09-data-lifecycle.md#delete-an-account), [§7.11](../spec/07-web-app.md#711-organization-product-and-account-screens).
