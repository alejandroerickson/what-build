---
type: Decision
title: A role is given at once only to someone the giver already sees in the organization; anyone else is invited, account or not
description: Giving a role never says whether an address has an account, here or in another organization, and nobody joins an organization without accepting.
tags: [decision, roles, invitations, privacy, security]
generated: {by: agent:claude, at: 2026-10-27}
status: stable
---

# A role is given at once only to someone the giver already sees in the organization; anyone else is invited, account or not

## Context

Giving a role used to add any address with an account at once, answering with its name and
account id, and invite only addresses with none. So an admin of any organization could learn
whether an address had an account on this WhatBuild, and whose it was, and add that person
without asking them; `members.grant_many` would do it a hundred addresses at a time. The security
model listed this as an accepted trade-off for a clearer message. The maintainer chose on
2026-10-27 that giving a role tells the giver nothing about someone outside their reach.

## Decision

- `members.grant` and `members.grant_many` give the role at once only to someone the giver already
  sees in the organization, as `members.list` shows them: anyone in it, to its owners and admins;
  the people on the teams and products they read, to anyone else.
- Anyone else is invited, whether or not they have an account, and joins by accepting (the link,
  or signing in with the address). The answer, the email, the people lists and the access log are
  the same for an address with an account anywhere and for one with none.
- Rejected: adding accounts at once and hiding only their names. The person would still appear in
  the organization, and nobody should be put in an organization without accepting.

## Consequences

- Someone with an account joins a new organization a click later than before.
- Tests and the synthetic-data tools bring a signed-in person into an organization by inviting
  them and accepting, as a person does.

## Constrains

- `grantOne` and `seenByCaller` in `packages/core/src/ops/products.ts` decide it; the members
  tests check the answer for an account elsewhere matches the one for no account.
- The sign-in form follows the same rule: it answers every address alike and mails a link only to
  one that may sign in ([§3.2](../spec/03-accounts-teams-and-identity.md)).
- Two people in one organization see each other as `members.list` shows them; that rule is
  unchanged ([§3.5](../spec/03-accounts-teams-and-identity.md)).

Specified in: [§3.5](../spec/03-accounts-teams-and-identity.md).
