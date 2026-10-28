---
type: Decision
title: An invitation is accepted only by the account with the address it was sent to
description: Invitation links are pointers to an invitation, not bearer credentials; the verified email address is what grants the role.
tags: [decision, identity, invitations, security, roles]
generated: {by: agent:claude, at: 2026-10-27}
status: stable
---

# An invitation is accepted only by the account with the address it was sent to

## Context

Granting a role to someone not already in the organization creates an invitation, whether or not
they have an account ([decision](a-role-is-given-at-once-only-to-someone-already-seen-in-the-organization.md)), emailed where mail is
configured and always returned to the inviter as a link to pass on. Links get forwarded, pasted in
the wrong chat and opened in a browser signed in as someone else. Signing in already accepts every
invitation addressed to the verified email, so the link adds nothing for its rightful owner except a
place to land. The maintainer chose on 2026-09-28 to require the address to match.

## Decision

- `POST /api/v1/invitations/accept` grants the role only when the signed-in account's email equals
  the invitation's, ignoring letter case. Otherwise it answers `403 invitation_wrong_address`, names
  the invited address masked (`l••••@example.com`), and leaves the invitation unused.
- A link opened by the person who already accepted it (usually by signing in) answers success with
  `already: true`.
- Rejected: links as bearer credentials. They would let anyone holding a forwarded link join, and
  make "who can join this organization?" depend on where a link travelled.

## Consequences

- Inviting a work address and signing in with a personal one does not work: invite the address the
  person signs in with.
- The web app's invitation page offers signing in with another address and returns to the link.

## Constrains

- Every way of accepting an invitation checks the address: sign-in (`acceptInvitationsForEmail`)
  and the link (`apps/server/src/auth/routes.ts`).

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md).
