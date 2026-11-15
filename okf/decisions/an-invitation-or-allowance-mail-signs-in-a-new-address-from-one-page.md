---
type: Decision
title: The mail that invites someone, or lets them start an organization, signs in an address with no account from one page with one button
description: Proposed. Each of these mails carries a single-use link of its own that signs in only an address with no account yet, so a newcomer reads one mail and presses one button; the cost is that whoever holds the mail can act as that address until the link is used.
tags: [decision, identity, invitations, allowances, security, onboarding]
generated: {by: agent:claude, at: 2026-11-15}
status: draft
---

# The mail that invites someone, or lets them start an organization, signs in an address with no account from one page with one button

## Context

Proposed by the change that introduces it; the maintainer decides whether to accept it when that
change is merged, and the status says draft until then. Before it, the invitation and the mail that
lets someone start an organization linked to pages that need a session: someone signed out typed
their address on Sign in, waited for a second mail, opened it, pressed Sign in on its page, and
only then reached Welcome or the invitation. Both first mails go to the address in question, so
their link can carry the sign-in. The link an inviter is given to pass on stays a pointer that
signs nobody in ([decision](invitations-belong-to-their-address.md)).

## Decision

- Each of these mails carries a link of its own (`/auth/start?token=…`), single use, for 7 days
  (an invitation's own time), kept as sign-in links are: by its hash, never readable back.
- Opening it changes nothing and shows one page with one button. Pressing it, from this origin
  only, uses it up and makes the account and its session, as a first sign-in does, then opens
  Welcome or the invitation, which the person still accepts or declines.
- It signs in only an address with no account yet. For one that has an account it leads to Sign
  in, then on to the same place: a link never opens an existing account.
- What stops a sign-in or an invitation still does: who may join, an invitation cancelled,
  declined, replaced, past its time or answered, an allowance taken away. A link used, past its
  time or revoked lands on Sign in with the expired notice.
- Nobody has to use it: signing in the usual way finds the same invitation or allowance, and the
  mail says so.
- Rejected: one link for both the inviter and the mail. The inviter's copy would sign them in as
  the person they invited.

## Consequences

- A newcomer reads one mail and presses one button where they read two mails and pressed through
  three screens.
- Until the link is used, whoever holds the mail can act as that address: a forwarded invitation
  becomes a way in, where before it was useless to anyone who could not sign in as the address. The
  person it was forwarded to could accept the invitation or start the organization in the other's
  name. The no-existing-account rule limits this to brand-new accounts, which hold nothing.
- Opening a link tells its holder whether the address has an account, by where it leads. Only the
  address's mail holds the link.

## Constrains

- Entry links are made only by `makeEntryLink` (`packages/core/src/entry-link.ts`), under purposes
  of their own in `email_tokens`; the sign-in link's routes take only `sign_in` rows, and only
  `sign_in` rows count against an address's hourly sign-in links.
- Their routes are in `apps/server/src/auth/routes.ts`; the inviter's `/invite/<token>` never signs
  in.

Specified in: [03-accounts-and-identity](../spec/03-accounts-and-identity.md#32-accounts-and-sign-in).
