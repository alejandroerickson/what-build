---
type: Process
title: The abuse test
description: pnpm abuse-test floods a local instance of the checkout through every abuse limit and the bot check, while a second organization works, and reports what got through, what was stopped and by what, the mail that left, and the second organization's answers and times.
tags: [operations, security, abuse, testing, limits]
generated: {by: agent:claude, at: 2026-11-25}
status: stable
---

# The abuse test

What a script can make WhatBuild do before anyone lets it in, tried for real: sign-in links,
sign-ups, the waitlist, agent registrations, invitations and the mail they send, with and without
the bot check's token, from one client address and from many, while someone in another
organization goes on working. It checks the abuse limits and the bot check
([§9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas),
[decision](../decisions/abuse-limits-count-a-client-address-only-where-the-edge-key-vouches-for-it.md),
[decision](../decisions/the-bot-check-is-cloudflare-turnstile-and-a-deployment-may-leave-it-off.md))
together, end to end, as the server's tests check each alone.

It runs against a local instance of the checkout it is run from, which it starts and stops itself,
and nothing else: never a deployment, production or dev. A flood there would fill its ceilings for
its real people, mail strangers, and spend its database's compute.

## Running it

```sh
corepack pnpm install
corepack pnpm abuse-test
```

[`apps/server/src/abuse-test.ts`](../../apps/server/src/abuse-test.ts) starts, on this machine:

- a Postgres of its own in `.what-build/abuse-pg`, on port 54341 (`WHATBUILD_ABUSE_PG_PORT` moves
  it), and a fresh database in it, dropped at the end (`--keep` leaves it, to look at afterwards);
- a mail catcher, a few lines of SMTP that keep every message, so the report counts the mail that
  actually left;
- the server, in development mode on a free port, with sign-up open to anyone (no allowlist), the
  example plans file and new organizations on its Free plan, an edge key, and Cloudflare's
  always-passing Turnstile test keys. Each token is checked with Cloudflare's siteverify, so the
  run needs the network.

The test keys let every token through, so the floods meet the limits as a script that got past
the bot check would. With real keys a script needs a solved challenge for every request, and most
never get that far.

Every request goes to the server as the Cloudflare Worker would pass it on: with the edge key, and
the client's address in `X-WhatBuild-Client-Address`, sealed with the key in
`X-WhatBuild-Client-Seal`, taken from the ranges kept for tests (198.18.0.0/15, and 2001:db8::/32
for IPv6). So the limits per client count here as behind the Worker.

`WHATBUILD_ABUSE_LIMITS=… corepack pnpm abuse-test` runs it with other numbers, as a deployment
would set them; the report says which it used. A run takes a few minutes, most of it the
invitation churn and the Cloudflare checks.

## What it does, in order

The phases share one database and one hour, as a flood would: the deployment's ceilings are spent
by everything before them.

1. **No token.** Sign-in links and the waitlist without the bot check's token. All refused
   (`403 bot_check_failed`), nothing counted, nothing stored, no mail.
2. **Sign-in links from one client**, for a hundred strangers' addresses. As many as
   `sign_in_links_per_address` get through and are mailed; the rest are refused.
3. **Sign-ups from one client**: a link asked for each new address, from anywhere, and followed
   from one client. As many as `new_accounts_per_address` accounts are made; the rest end on
   `/signin?error=too_many_accounts`. Every link is mailed, since the address could sign in.
4. **Sign-ups from many clients**, each its own. Accounts are made until `new_accounts_per_hour`
   (what the hour has left after phase 3).
5. **The waitlist**: from one client (`waitlist_per_address`), a bot filling in the hidden field
   (thanked, never stored), then from many (`waitlist_per_hour`).
6. **Agent registrations**: from one client (`agent_registrations_per_address`), from a hundred
   /64s of one IPv6 /48 (`agent_registrations_per_ipv6_48`), then from more clients than the
   deployment keeps waiting (`agent_registrations_waiting`): every one is answered, the number kept
   never passes it however many arrive together, and an agent registering after the flood still
   goes on to sign its person in.
7. **Invitations.** From a new organization on the Free plan: a hundred addresses in one call,
   refused whole by the plan's people total; then inviting and cancelling, again and again, for 65
   seconds, which the plan's calls and writes a minute pace. From an organization no plan limits
   (an instance owner's): a hundred, then fifty, then ten one at a time, of which
   `invitations_per_organization` are made and mailed and the rest refused, all or nothing.
8. **The hour's mail**: sign-in links for strangers from many clients, until `mail_per_hour` is
   used. Then what a person meets: their own sign-in link refused until the next hour, and an
   invitation from the second organization made with its link and not emailed.

All along, a person in a second organization reads their product every second and a half and adds
an outcome every few, under their own plan's limits, from before the floods to the end.

## Reading the report

It prints a line for each step, and writes the whole as JSON in `.what-build/abuse-test/` (ignored
by git):

- **got through / stopped**: how many requests did what they asked, and for the rest, the status
  and what stopped them: an abuse limit by name, a plan's total by name, a plan's limit a minute, or
  `bot_check_failed`.
- **mails**: what reached the catcher in that step; the total, at the end, never passes
  `mail_per_hour`.
- **Ceilings that filled, as logged**: the `abuse_ceiling_reached` lines the server wrote, which a
  deployment's alert mails ([Cloud Run](cloud-run.md#abuse-limits)).
- **The second organization**: its requests, their median, 95th percentile and slowest times,
  before the floods and during them, and any it was refused. It should be refused nothing: a flood
  stays out of other organizations. Its times rise during the floods only as much as one machine
  running the floods, the server and the Cloudflare checks together slows everything.

A mail total past `mail_per_hour`, more registrations kept waiting than
`agent_registrations_waiting`, an agent that could not sign in after the flood, or a refusal for
the second organization makes the run fail: it says which, and exits with an error after writing
the report. A step that lets through more than its limit is a failure too: compare each line with
the limits the report names, and say which, with the report.

## What it does not cover

- **Uploads and writes inside an organization**, which a plan's limits pace and the server's tests
  flood (`apps/server/test/hostile-uploads.test.ts`, `limits.test.ts`, `tenant-isolation.test.ts`).
- **Cloudflare in front**: the zone's rate limit and the Worker are not there, so the test meets the
  service's own limits alone. The Worker's part (naming and sealing the client, dropping a forged
  name) is in `apps/server/test/cloudflare-worker.test.ts`.
- **A slow mail server**: the catcher answers at once. That an organization's invitations never
  hold up anyone's sign-in link while a mail server is slow is in
  `apps/server/test/abuse-limits.test.ts`.
- **A deployment's numbers**: it runs with the defaults, or with what `WHATBUILD_ABUSE_LIMITS` says.
  To try a deployment's own, pass them the same way.
