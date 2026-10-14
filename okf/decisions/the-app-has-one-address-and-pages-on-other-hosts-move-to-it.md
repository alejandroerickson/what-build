---
type: Decision
title: The app has one address, and a page opened on another of the deployment's names moves to it
description: WHATBUILD_PUBLIC_URL is the canonical address; a browser's page load on any other host the deployment answers on is redirected there, while probes, agents and API clients are answered wherever they ask.
tags: [decision, deployment, configuration, links, security]
generated: {by: agent:claude, at: 2026-10-14}
status: stable
---

# The app has one address, and a page opened on another of the deployment's names moves to it

## Context

A deployment answers on more than one name: Cloud Run's `run.app` address beside a custom domain,
Container Apps' default host beside an organization's domain, an earlier domain still pointed at
it. Everything the server writes (OAuth metadata and callbacks, sign-in links, upload grants, the
Story's link templates) uses `WHATBUILD_PUBLIC_URL`, but agents copy whatever address they were
given, so stored content can link to another name. On that name a person has no session (the
cookie is the public host's), cookie-carrying writes are refused as cross-origin, and a sign-in
started there loses its state at the public URL's callback.

## Decision

- `WHATBUILD_PUBLIC_URL` is the deployment's one address. A `GET` or `HEAD` that the browser marks
  as a navigation (`Sec-Fetch-Mode: navigate`) on any other host is redirected, `302`, to the same
  path and query there (`apps/server/src/canonical-host.ts`). The host is `X-Forwarded-Host` when a
  proxy sends it (the Cloudflare Worker), else `Host`.
- Never redirected: `/health`, `/api` (with its upload and download grants), `/mcp`, `/oauth` and
  `/.well-known`; any request without a navigation header (probes, agents, `curl`); loopback hosts;
  the public site's host; every request when the public URL is itself a loopback address (a
  deployment not yet told its address). `WHATBUILD_REDIRECT_TO_PUBLIC_URL=0` turns it off, for a
  proxy that sends its own host name and no `X-Forwarded-Host`, which would otherwise loop.
- `302`, not `301`: a browser keeps no record, so changing the public URL later strands nobody.
- The MCP server's instructions name the address and tell agents to write links with it.
- Rejected: refusing other hosts outright, which would cut off probes and agents connected there;
  rewriting stored links, which the Story's stored HTML never is.

## Consequences

- Old links on another name keep working for as long as that name reaches the deployment, and land
  people signed in. A link on a name that no longer reaches it is dead; inside the product being
  read, the web app and the Story frame already open such links in place
  ([§4.11](../spec/04-data-model.md#411-story)).

## Constrains

- A new route that machines call on any host belongs under one of the exempt prefixes. A
  mockup's prototype (`/prototypes/`) is one: a frame moves between its documents with navigations,
  answered where the prototype's address points; and a content site (`WHATBUILD_CONTENT_URL`) is
  never redirected, since it serves prototypes and nothing else
  ([decision](mockups-carry-prototypes-served-from-a-capability-path.md)).

Specified in: [§2.3](../spec/02-architecture.md#23-the-shape-of-the-deployment).
