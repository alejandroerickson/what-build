---
type: Decision
title: An invitation shows names plainly, with the inviter's confirmed address beside their name
description: Invitation mail and screens write people's, organizations' and products' names as names, without quotation marks; what no chosen name can fake is the inviter's account address beside it.
tags: [decision, invitations, mail, security, web, words]
generated: {by: agent:claude, at: 2026-11-15}
status: stable
---

# An invitation shows names plainly, with the inviter's confirmed address beside their name

## Context

An invitation's email and screens name the inviter, the organization and the product, and each name
is someone's choice: a display name can read "WhatBuild Security", an organization's name can try to
close a sentence. They were shown in quotation marks a name could not close, with a sentence saying
these were names people gave WhatBuild. That made a newcomer read about quotation marks before
reading what they were asked, and still let a name pose as someone else. The maintainer chose on
2026-11-15 to write names as names, and to show what a name cannot fake instead.

## Decision

- An invitation's email and its screens (the invitation's page, the invitations waiting, the
  declined and accepted states) show the inviter, the organization and the product as plain names:
  no quotation marks, and no sentence about them.
- The inviter's name is followed by their own account's address in parentheses, "Maya
  (maya@example.com)": the address WhatBuild confirmed at sign-in, which no chosen name can fake.
  The web app reads it as `invited_by_email`, the account's address now, or null once the account
  is deleted, when the name stands alone.
- Every name stays on one line, without control or direction-changing characters, bounded (60
  characters for a display name, 100 for an organization or product), so none reaches another
  header or line of the email (`oneLine`, `plainName` in `packages/core/src/util.ts`).
- The email that lets someone start an organization, which only an instance owner sends, names
  them plainly too.
- Not this: the OAuth consent page, which names a client by the name it gave itself, keeps that
  name in quotation marks as unverified ([§3.8](../spec/03-accounts-and-identity.md#38-identity-of-the-caller)).

## Consequences

- A newcomer reads who asked and for what in one sentence.
- A name made to look like WhatBuild or another person sits beside an address that says whose
  account sent it.
- The invitation endpoints look up the inviter's account to give its address.

## Constrains

- A new message or screen that names the sender of an invitation shows their confirmed address
  beside the name, and every chosen name on one line and bounded.

Specified in: [§3.2 Invitations](../spec/03-accounts-and-identity.md#invitations), [§3.5 Roles](../spec/03-accounts-and-identity.md#35-roles) (membership administration), [§7.11](../spec/07-web-app.md#711-settings-instance-admin-and-the-persons-own-screens).
