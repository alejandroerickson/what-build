---
type: Decision
title: Abuse limits count a client address only where the edge key vouches for it, and the deployment's ceilings stand behind them
description: The Worker names the client's address in a header the service trusts only beside the edge key; limits per address bound one client, ceilings for the deployment bound many, and an organization's invitations are capped a day; numbers are each deployment's.
tags: [decision, security, abuse, cloudflare, limits]
generated: {by: agent:claude, at: 2026-11-25}
status: stable
---

# Abuse limits count a client address only where the edge key vouches for it, and the deployment's ceilings stand behind them

## Context

Agent registrations and the waitlist were limited for the whole deployment, because the service
had no client address it could trust: behind the Cloudflare Worker every request comes from
Cloudflare, and any header a client sends can say anything. So one script could fill a limit and
refuse everyone. Sign-in links were limited per email address, so a script could ask for links to
thousands of addresses, each a mail to a stranger; invitations had no cap of their own; and nothing
limited new accounts once sign-up opens.

## Decision

- **The client's address travels in `X-WhatBuild-Client-Address`**, which the Worker sets from
  `CF-Connecting-IP` (set by Cloudflare, never by the client) and replaces on every request it
  passes on. The service believes it only on a request that carries the edge key
  ([decision](behind-cloudflare-the-service-answers-only-requests-that-carry-the-workers-key.md)).
  Anywhere else the address is unknown.
- **One client is an IPv4 address, or an IPv6 /64**, since one subscriber holds a whole /64. Its
  counts are kept under an HMAC keyed from the grant key, never the address, and go after two days.
- **Limits per address, ceilings behind them.** A client meets a limit on sign-in links, new
  accounts, the waitlist and agent registrations in an hour; the deployment meets a ceiling on the
  sign-in links and invitations it emails, on new accounts, on the waitlist and on registrations
  waiting to connect. An organization meets a cap on invitations a day, on any plan. Where the
  address is unknown, only the ceilings and the organization's cap apply.
- **Counted alike for every address.** A sign-in link counts against the client and the hour's
  mail whether or not it is sent, so neither says whether an address may sign in. New accounts for
  people someone let in (the allowlist, an instance owner, an allowance, an invitation) are never
  counted, so a flood cannot keep out the people a team invited.
- **Fixed windows in Postgres** (`abuse_counters`): an hour from the top of the hour or a UTC day,
  one conditional upsert per request, so a refused request adds nothing, every instance shares the
  count, and a refusal inside a transaction gives back what the call took.
- **Each deployment sets the numbers** (`WHATBUILD_ABUSE_LIMITS`), with defaults meant for a small
  deployment open to the public; a name or number it does not take stops the server at start.
- **A filled ceiling is logged** (`abuse_ceiling_reached`), and the Cloud Run alerts mail it.
- Rejected: trusting `X-Forwarded-For`, which a client writes; counters in memory, which a restart
  or a second instance loses; sliding windows, which cost more per request for a bound that is
  only twice as tight at a window's edge.

## Consequences

- A deployment without the Worker and its key counts no client: one script there can fill a
  ceiling for everyone until the window ends. Another proxy that names the client may be trusted
  the same way later; until then such a deployment relies on its ceilings and its own front.
- People behind one address (an office, a carrier's NAT) share its limits.
- A flood that fills a ceiling refuses everyone under it until the window ends: a person's sign-in
  link is refused, and an invitation is made but not emailed, until the next hour.
- The abuse test (`pnpm abuse-test`) floods a local instance through every limit, as the Worker
  would pass requests on.

## Constrains

- A new way for anyone to make WhatBuild mail someone, or make something before they are let in,
  gets an abuse limit, counted per client and for the deployment.

Specified in: [§9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas),
[security](../system/security.md), [the abuse test](../operations/abuse-test.md).
