---
type: Decision
title: Behind Cloudflare, the service answers only requests that carry the Worker's key
description: With WHATBUILD_EDGE_KEY set, every request but the health check must carry the key the Cloudflare Worker adds, so nobody reaches the service by going around the Worker to its run.app address.
tags: [decision, deployment, security, cloudflare, cloud-run]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Behind Cloudflare, the service answers only requests that carry the Worker's key

## Context

On Cloud Run the Cloudflare Worker sends each request to the service's `run.app` address, which
also answers anyone who finds it. Whoever does goes around everything Cloudflare does: its DDoS
protection, the zone's rate limit, and the Worker's own answers to scanners. They can keep the
instance and the database awake, and flood the service, at the deployment's expense. Cloud Run's
ingress setting closes the address only behind a Google load balancer (about US$18 a month), and
Cloud Run filters by caller address only there too, with Cloud Armor.

## Decision

- A secret shared by the Worker and the service. With `WHATBUILD_EDGE_KEY` (32 characters or more)
  set, the service refuses with `403` every request but `/health` whose `X-WhatBuild-Edge-Key`
  header is not that key, compared in constant time, before any other middleware runs
  (`apps/server/src/edge-key.ts`). The Worker sets the header from its secret `EDGE_KEY` on
  every request it passes on, and drops one a caller sent when it has none
  (`deploy/cloudflare/worker.js`).
- Unset, nothing is refused: local development, the dev deployment on its `run.app` address, Azure
  and any deployment without the Worker.
- Rejected: a load balancer with internal ingress, or with Cloud Armor allowing only Cloudflare's
  addresses, which costs a fixed sum each month for what a header does.

## Consequences

- Behind the Worker, the `run.app` address serves nothing but the health check, so a page there is
  no longer redirected to the public URL; it is refused
  ([decision](the-app-has-one-address-and-pages-on-other-hosts-move-to-it.md)).
- A refused request reads nothing and writes no trace or log line, but still runs the instance,
  one at most. Cloud Run's own request log line for it is dropped by a log exclusion for `403` and
  `429` ([Cloud Run](../operations/cloud-run.md)), so the metrics are its only record.
- The key is set in two places, in order: the Worker first, then the service. Changing it refuses
  requests for the moments between the two.

## Constrains

- Anything that calls the service (a scheduler job, a script, a probe) calls the public URL,
  through the Worker, or `/health`.

Specified in: [§2.3](../spec/02-architecture.md#23-the-shape-of-the-deployment),
[Cloud Run](../operations/cloud-run.md).
