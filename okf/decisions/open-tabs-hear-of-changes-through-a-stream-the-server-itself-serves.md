---
type: Decision
title: Open tabs hear of changes through a stream the server itself serves, which says only which part of a product changed
description: A one-way stream built into the one image, on every host alike, with no new service and no tab polling; lists refresh by themselves, and a Story page or mockup waits for the person.
tags: [decision, architecture, live-updates, security, cost, web-app]
generated: {by: agent:claude, at: 2026-11-13}
status: stable
---

# Open tabs hear of changes through a stream the server itself serves, which says only which part of a product changed

## Context

A person reading a Story while an agent updates it had no way to know without reloading. Tabs asking
over and over would keep a database that suspends when idle awake, and count against people's calls
a minute. Postgres `LISTEN/NOTIFY` does not survive a database that scales to zero. A realtime
service, Neon's or a Cloudflare Durable Object, adds a tier of state and authorization outside
`execute`, a second deploy and rollback, and would still need this for a deployment without it. The
maintainer chose, on 2026-11-01, the stream in the container, so that every host has the same
feature, and chose how each screen treats a change.

## Decision

- **One-way, in the server.** `GET P/live` is a stream of server-sent events, read with `fetch`, from
  a hub in the serving process (`apps/server/src/live.ts`) behind the port `LiveChanges`. No new
  service, table or dependency. `WHATBUILD_LIVE_UPDATES=0` turns it off with a change of setting,
  and then the app works as it did before, with people refreshing. Rejected: WebSocket, whose
  handshake is a `GET` the origin check does not see, for a channel that only ever goes one way.
- **A message says only which part changed:** `story`, `idea`, `evidence`, `exploration` or `other`.
  No id, title or name of anyone's. The tab reads what changed through the operations it reads
  everything else through, which decide what it may see. `liveMessage` writes every message from
  that list, so a mistake elsewhere cannot put anything else on the wire.
- **Who hears.** Opening a stream is the check a read of the product's Story meets, for a browser's
  session only (no agent's token) and from the app's own pages only. Its channel is the product that
  check resolved, never a name from the address. Before anything is sent, the session and the role
  are asked again, so someone signed out, expired, deleted or taken out hears nothing and their stream
  ends, and any failure in asking ends it too. A Story reader hears `story` alone. A kind of operation
  nobody labelled is `other`, which no Story reader hears. A guest of the example organization gets no stream.
- **What it costs.** A tab listens only while it is in view and used in the last ten minutes, and for
  two minutes after it is hidden. A stream that hears nothing asks the database nothing; the questions
  above come only after a write, when the database is awake. Changes to a product are gathered for
  five seconds, and a tab reads what changed at most every thirty. A stream ends after
  `WHATBUILD_LIVE_STREAM_MINUTES`, 4 by default to end before the five-minute limit a deployment may
  still have (which would read as a failed request), 50 where `deploy/cloud-run/setup.sh` allows it,
  and opening one is what can wake a database. Starting to listen wakes no worker. A tab that keeps
  failing to listen gives up until the page is loaded again, and one still on a revision a deploy
  replaced moves on at its next answer from the new one.
- **What each screen does,** by what a person may be in the middle of. Lists and cards (Idea, Evidence
  with a search's results, the list of mockups, the Story's tree, activity) refresh by themselves, and never
  while someone is typing, dragging or in a dialog. A Story page and a mockup's canvas never change by
  themselves: a toast that stays says this one was updated, and Refresh brings it, since a reload
  would lose someone's place and whatever they entered in a mockup.

## Consequences

- Every host runs the same code, and differs only in the settings around it. An instance stays up
  while anyone is working, which is the cost: [Cloud Run](../operations/cloud-run.md#what-it-costs),
  [Azure](../operations/azure.md#what-it-costs). A deployment that finds it too much turns it off.
- The hub is state in one process, the one exception to [one stateless
  image](one-stateless-image.md). It holds no tenant's data, only which streams are open, and nothing
  is lost when it goes: tabs reconnect and read what changed.
- With more than one instance, a tab hears only of changes made on its own, and people refresh to see
  the rest. A shared channel would be needed before running more than one with live updates on;
  Postgres cannot be it where it scales to zero.
- The platform's request limit is raised for the streams, so the server itself ends any other request
  that takes over five minutes (`REQUEST_LIMIT_MS` in `apps/server/src/app.ts`).

## Constrains

- `changed` takes a product and an area and nothing else (`LiveChanges` in
  `packages/core/src/ports.ts`), and is called after the commit. Nothing but `liveMessage` and a
  heartbeat is ever written to a stream.
- Areas are `LIVE_AREAS` and `liveArea` in `packages/core/src/live.ts`; the web app's list in
  `apps/web/src/lib/live.tsx` matches it, which a test holds. A new kind of operation is `other` until
  someone chooses, and a test lists any that is.
- A query refreshes by itself only if `AUTOMATIC` in `apps/web/src/lib/live.tsx` names it.
- A form outside a dialog that names the etag of what it opened calls `useHoldRefresh`: a refresh
  beneath it would move that etag past a change the person has not seen, and their save would
  overwrite it unseen.

Specified in: [02-architecture](../spec/02-architecture.md) §2.3, [07-web-app](../spec/07-web-app.md) §7.1,
[security](../system/security.md).
