---
type: Decision
title: Production sends its mail through Cloudflare Email Sending over SMTP, and the dev deployment sends none
description: Production's sign-in links, invitations and allowance notices go out from noreply@what-build.com through Cloudflare, which already holds the domain, with no change to the code; dev, which holds real people's addresses, never sends mail.
tags: [decision, mail, operations, cloud-run, cloudflare, privacy, dev]
generated: {by: agent:claude, at: 2026-10-11}
status: stable
---

# Production sends its mail through Cloudflare Email Sending over SMTP, and the dev deployment sends none

## Context

Without mail, production offered no email sign-in, and an invitation was a link the person
inviting had to pass on. The server speaks SMTP to any provider ([§2](../spec/02-architecture.md)),
so the choice is a provider, not code. The live options were a service built for application mail
(Resend, Postmark, Amazon SES), a mailbox sold with the domain's registrar, a mail server at home,
and Cloudflare, which holds the `what-build.com` zone and offers SMTP to Email Sending. The
maintainer chose Cloudflare on 2026-10-11, on the Workers Paid plan.

## Decision

- Production sends through Cloudflare Email Sending over SMTP (`smtp.mx.cloudflare.net:465`), as
  `WhatBuild <noreply@what-build.com>`, with an account-owned token that holds only Email
  Sending: Edit ([mail](../operations/mail.md#production)).
- The dev deployment has no mail settings and never gets them: it holds a copy of production, so
  its invitations and sign-in links would reach real people.
- Rejected: a registrar's mailbox, which is built for people and is moving off the password logins
  the server uses; a home server, whose mail is refused or marked as spam; Resend, Postmark and
  SES, each a new account and a new set of DNS records for the same result.

## Consequences

- One account holds the domain, its DNS and its mail; onboarding the domain adds its records.
- It costs the Workers Paid plan, with 3,000 messages a month included. Email Sending is in beta.
- Cloudflare sees every recipient's address and message, and the privacy page names it for mail.
- Changing provider is a new SMTP URL and the new provider's DNS records, with no code change.

## Constrains

- The token lives only in production's `whatbuild-smtp-url` secret and the maintainer's `.env`;
  no other deployment holds it.
- Nothing copies production's mail settings to dev: not `setup.sh`, not the
  `rehearse-on-the-dev-deployment` skill, not a person.
- Production's sender domain is `what-build.com`, which Cloudflare sends for; re-running `setup.sh`
  on production passes `MAIL_FROM`.

Specified in: [Mail](../operations/mail.md), [§3](../spec/03-accounts-teams-and-identity.md).
