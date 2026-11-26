---
type: Decision
title: Abuse limits count a client address only where the edge key vouches for it, and the deployment's ceilings stand behind them
description: The Worker names the client's address, sealed with the edge key; limits per address and per IPv6 /48 bound one client, ceilings for the deployment bound many, agent registrations waiting to connect are kept to a number by forgetting the oldest, and an organization's invitations are capped a day; numbers are each deployment's.
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

- **The client's address travels in `X-WhatBuild-Client-Address`, sealed in
  `X-WhatBuild-Client-Seal`.** The Worker sets the address from what Cloudflare saw
  (`CF-Connecting-IPv6`, or else `CF-Connecting-IP`, which no client can set) and the seal, an
  HMAC of the address keyed with the edge key
  ([decision](behind-cloudflare-the-service-answers-only-requests-that-carry-the-workers-key.md)),
  replacing both on every request it passes on. The service believes the address only on a request
  that carries the edge key and a seal that matches. A Worker from before the client address passed
  on every header a client sent, a made-up address included; no client knows the edge key, so none
  can seal one, and the service never trusts a made-up address, whichever of the Worker and the
  service a deployment updates first. Anywhere else the address is unknown.
- **One client is an IPv4 address, or an IPv6 /64, and an IPv6 /48 is counted too.** A /64 is the
  network one subscriber's devices share, and its addresses are as easy to change as a port. But a
  provider commonly gives one home or office a /56 or a /48, and a tunnel broker gives anyone a /48
  for free, so counting by /64 alone let one person act as 256 or 65,536 clients and fill every
  ceiling. Each limit per address therefore has one per IPv6 /48 beside it, three times larger by
  default: a few people's /64s in one /48 share it without meeting it, and one person's /48 acts as
  three clients. An IPv4 address is counted whole, since one person rarely holds many. Counts are
  kept under an HMAC keyed from the grant key, never the address, and go after two days.
- **Limits per client, ceilings behind them.** A client meets a limit on sign-in links, new
  accounts, the waitlist and agent registrations in an hour, per address and per /48; the
  deployment meets a ceiling on the sign-in links and invitations it emails, on new accounts and on
  the waitlist. An organization meets a cap on invitations a day, on any plan. Where the address is
  unknown, only the ceilings and the organization's cap apply.
- **Agent registrations waiting to connect are kept to a number, never refused for it.** No agent
  can solve a bot check, so registration has none, and a ceiling that refused new registrations
  let a few clients fill it and stop every new agent from connecting, the attack these limits were
  made for. The number now bounds only what is stored: past it the oldest registration that never
  connected is forgotten, so a flood pushes out only its own, while a real agent, which connects
  within minutes of registering, keeps its place. A registration that connected, or holds a code
  it is exchanging, is never forgotten. The default (1,000) is larger than a refusing ceiling
  could be, since a larger number means a flood must be faster to push out an agent mid-sign-in.
- **Counted alike for every address.** A sign-in link counts against the client and the hour's
  mail whether or not it is sent, so neither says whether an address may sign in. New accounts for
  people someone let in (the allowlist, an instance owner, an allowance, an invitation) are never
  counted, so a flood cannot keep out the people a team invited.
- **Fixed windows in Postgres** (`abuse_counters`): an hour from the top of the hour or a UTC day,
  one conditional upsert per request, so a refused request adds nothing, every instance shares the
  count, and a refusal inside a transaction gives back what the call took. A deployment's ceiling is
  taken from in a short transaction of its own, never one that waits on anything else: the upsert
  locks its row until the transaction ends, so an invitation is emailed after its call commits.
- **Each deployment sets the numbers** (`WHATBUILD_ABUSE_LIMITS`), with defaults meant for a small
  deployment open to the public; a name or number it does not take stops the server at start.
- **What goes wrong is said.** A filled ceiling is logged (`abuse_ceiling_reached`), and the Cloud
  Run alerts mail it. A request with the edge key and no sealed address means the Worker in front
  is older than the service and every limit per client is off: the server logs it as an error once
  an instance, which the log's alert mails.
- Rejected: trusting `X-Forwarded-For`, which a client writes; counters in memory, which a restart
  or a second instance loses; sliding windows, which cost more per request for a bound that is
  only twice as tight at a window's edge; counting IPv6 by /48 alone, which would make a campus or
  an office on one /48 a single client; a release order (the Worker before the service) in place of
  the seal, which every deployment behind Cloudflare would have to remember.

## Consequences

- A deployment without the Worker and its key counts no client: one script there can fill a
  ceiling for everyone until the window ends. Another proxy that names the client may be trusted
  the same way later; until then such a deployment relies on its ceilings and its own front.
- People behind one address (an office, a carrier's NAT) share its limits, and people in one
  IPv6 /48 (a campus, a large office) share its limits too.
- A flood that fills a ceiling refuses everyone under it until the window ends: a person's sign-in
  link is refused, and an invitation is made but not emailed, until the next hour.
- A flood of agent registrations faster than the number kept, in the minutes between an agent
  registering and its person choosing Allow, can still push that agent out; it registers again.
- The abuse test (`pnpm abuse-test`) floods a local instance through every limit, as the Worker
  would pass requests on, and fails when one is passed.

## Constrains

- A new way for anyone to make WhatBuild mail someone, or make something before they are let in,
  gets an abuse limit, counted per client and for the deployment.
- Nothing that waits on another service (a mail server, a provider) runs while a deployment-wide
  count is held in the same transaction.

Specified in: [§9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas),
[security](../system/security.md), [the abuse test](../operations/abuse-test.md).
