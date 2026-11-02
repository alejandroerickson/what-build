---
type: Decision
title: A file past the relay goes straight to the bucket, from the web app too and on any plan
description: A plan's largest file must be one a person can upload, and Cloud Run refuses a request over 32 MiB, so the web app sends what the relay cannot take to an address the bucket signs.
tags: [decision, architecture, uploads, plans, security, cost]
generated: {by: agent:claude, at: 2026-11-02}
status: stable
---

# A file past the relay goes straight to the bucket, from the web app too and on any plan

## Context

Plans sell a largest file (Pro's is 100 MB in the example plans). The web app uploaded through the
service's relay, which takes 25 MiB because Cloud Run refuses a request over 32 MiB, and direct
addresses went only to agents outside plans. So a plan's promise could not be kept: a person could
not upload a file the plan said it took.

## Decision

- **Past the relay, the bucket.** A grant carries a `direct` address when the store signs them and the
  file may not fit the relay. The web app sends such a file there and calls
  `attachments.complete_upload`; everything else keeps the relay.
- **On any plan.** The address is signed for what the grant takes (`x-goog-content-length-range`), so
  the bucket enforces a plan's file limit, the day's bytes and the storage left, as they stand when
  the grant is issued. Bytes are counted when they are attached, as the relay's are.
- **A deployment asks for it.** `SIGNED_URLS=1` lets the runtime identity sign, lets the app's origin
  `PUT` to the bucket and names the bucket in the app's `connect-src`. Without it the most a deployment
  takes is the relay's limit, and its plans table, site and limits say so rather than promise more. A
  deployment whose service takes larger requests, as Azure's does, raises the relay's limit instead.
- **It comes back in chunks.** Downloads stay on the service's own route, where they are checked and
  counted. Cloud Run refuses a response past 32 MiB unless it is chunked or streamed, so past that a
  response says it is chunked, and a browser's download shows no total.
- **The server reads what landed, with no connection held.** `complete_upload` takes the object's size
  and hash before its transaction, since 100 MB takes seconds to read.
- **What nobody completes goes.** Bytes under a grant that was never completed are deleted a day after
  it expires. Until then they count against nobody's allowance: the cost of an upload the server does
  not see, accepted because it takes a paying account deliberately spending its writes, and each
  object lasts a day.

## What this rules out

- **Pieces through the relay**, which needs no deployment setting, but passes every byte through the
  one instance that also serves everyone else, and needs a new protocol and a new port for agents and
  stores to learn.
- **Raising the limit on Cloud Run with HTTP/2 end to end**, which the service's server does not speak.
- **Reading more than 25 MiB of a file.** A larger file is kept and shown, not read and not pictured:
  those limits follow the instance's memory, and are their own decision.
