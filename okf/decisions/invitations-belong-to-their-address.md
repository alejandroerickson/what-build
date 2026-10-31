---
type: Decision
title: An invitation is accepted only by the account with the address it was sent to, and only by that person's choice
description: Invitation links are pointers to an invitation, not bearer credentials; the verified address says who may answer, and signing in accepts nothing, so a person joins an organization only by choosing to.
tags: [decision, identity, invitations, security, roles]
generated: {by: agent:claude, at: 2026-10-31}
status: stable
---

# An invitation is accepted only by the account with the address it was sent to, and only by that person's choice

## Context

Granting a role to someone not already in the organization creates an invitation, whether or not
they have an account ([decision](a-role-is-given-at-once-only-to-someone-already-seen-in-the-organization.md)), emailed where mail is
configured and always returned to the inviter as a link to pass on. Links get forwarded, pasted in
the wrong chat and opened in a browser signed in as someone else, so the maintainer chose on
2026-09-28 to require the address to match. Signing in then accepted every invitation addressed to
the verified email, so someone who already used WhatBuild could simply find a new organization in
their panel, and be counted and named in it without having been asked. The maintainer chose on
2026-10-31 that a person joins only by choosing to.

## Decision

- Signing in never accepts anything, by any method. An invited address may still sign in where the
  allowlist would otherwise stop it.
- A person answers with Accept or Decline, from the invitations shown to them wherever they land
  once signed in, or from the link's page. Opening a link changes nothing, so a mail scanner or a
  forwarded link answers nothing.
- Both grant or end something only while the invitation is open and the signed-in account's
  verified email equals the invitation's, ignoring letter case. By a link, any other account gets
  `403 invitation_wrong_address`, with the address masked (`l••••@example.com`), and the invitation
  stays open.
- A link opened by the person who already accepted it says so (`already: true` on accepting).
- Declining ends the invitation as cancelling does, frees its place and gives no role. The access
  log says an invitation was declined and where, under the name Someone: the person never joined,
  so the organization learns nothing more of them than that the invitation was declined.
- Rejected: links as bearer credentials. They would let anyone holding a forwarded link join, and
  make "who can join this organization?" depend on where a link travelled.
- Rejected: accepting on sign-in because the verified address is the proof. It proves who someone
  is, not that they want to be there.
- Rejected: a state of its own for a declined invitation. An ended invitation answers
  `invitation_expired` whatever ended it, and the access log tells a decline from a cancellation.

## Consequences

- Inviting a work address and signing in with a personal one does not work: invite the address the
  person signs in with. The web app's invitation page offers signing in with another address and
  returns to the link.
- Someone invited takes one more step, and until then is a guest account if they are in no
  organization. Their agent reaches the organization only once they have accepted.
- Whoever invited someone who declines cannot read from the log which address it was, when several
  are waiting; the invitation leaving Waiting to join says so.

## Constrains

- Every way of answering goes through `acceptInvitation` and `declineInvitation`
  (`apps/server/src/auth/identity.ts`), whose one statement checks the invitation is open and the
  account's verified address. Tests and tools bring people in the same way.
- Accepting and declining are a person's, in the web app: the routes take a browser's session alone,
  and neither is an operation, so no agent is offered them.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md#invitations).
