---
type: Decision
title: Mail is set up through Cloudflare Email Sending over SMTP, any SMTP provider can take its place, and a dev deployment sends none
description: The Cloud Run guide sends sign-in links, invitations and allowance notices through Cloudflare Email Sending, which already holds a domain put behind Cloudflare, with no change to the code; a dev deployment, which holds real people's addresses, never sends mail.
tags: [decision, mail, operations, cloud-run, cloudflare, privacy, dev]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Mail is set up through Cloudflare Email Sending over SMTP, any SMTP provider can take its place, and a dev deployment sends none

## Context

Without mail, a deployment offers no email sign-in, and an invitation is a link the person
inviting has to pass on. The server speaks SMTP to any provider ([§2](../spec/02-architecture.md)),
so the choice is a provider, not code. The live options were a service built for application mail
(Resend, Postmark, Amazon SES), a mailbox sold with the domain's registrar, a mail server at home,
and Cloudflare, which already holds the zone of a domain put in front of the service as the
[Cloud Run guide](../operations/cloud-run.md#setting-it-up) does first, and offers SMTP to Email
Sending. The maintainer chose Cloudflare Email Sending on 2026-10-11.

## Decision

- The guide's mail is Cloudflare Email Sending over SMTP (`smtp.mx.cloudflare.net:465`), as
  `WhatBuild <noreply@<domain>>`, with an account-owned token that holds only Email Sending: Edit
  ([mail](../operations/mail.md#cloudflare-email-sending)). Any other SMTP provider works the same
  way, and an Azure deployment may use Azure Communication Services instead.
- A dev deployment has no mail settings and never gets them: it holds a copy of production, so
  its invitations and sign-in links would reach real people.
- Rejected: a registrar's mailbox, which is built for people and is moving off the password logins
  the server uses; a home server, whose mail is refused or marked as spam; Resend, Postmark and
  SES, each a new account and a new set of DNS records for the same result.

## Consequences

- One account holds the domain, its DNS and its mail; onboarding the domain adds its records.
- It needs Cloudflare's Workers Paid plan, with 3,000 messages a month included. Email Sending is
  in beta.
- Cloudflare sees every recipient's address and message, and the privacy page names it for mail.
- Changing provider is a new SMTP URL and the new provider's DNS records, with no code change.

## Constrains

- A deployment's token lives only in its own `whatbuild-smtp-url` secret and its operator's ignored
  `.env`; no other deployment holds it.
- Nothing copies a deployment's mail settings to a dev deployment: not `setup.sh`, not the
  `rehearse-on-the-dev-deployment` skill, not a person.
- The sender's domain is one the provider sends for; re-running `setup.sh` on a deployment that
  sends mail passes `MAIL_FROM`.

Specified in: [Mail](../operations/mail.md), [§3](../spec/03-accounts-teams-and-identity.md).
