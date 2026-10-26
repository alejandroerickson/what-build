---
type: Decision
title: With a content site, every page and inline file is served from it under a short-lived address the app's own route hands off to
description: The app's routes keep their addresses and checks and answer 302 to the content site, under a grant for one document and its requester that is checked again there; uploaded HTML is previewed from a sandboxed route, so the app's policy allows no inline style.
tags: [decision, security, sandbox, story, mockups, cards, attachments, content-site, csp]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# With a content site, every page and inline file is served from it under a short-lived address the app's own route hands off to

## Context

Story and mockup pages, Idea card fronts, a style's specimen, the print view and agents' previews
are HTML that people's agents write, and PDFs and HTML files are what people upload. Each runs in a
sandbox with an opaque origin and no network ([decision](story-pages-are-sandboxed-agent-html.md));
what is left is a browser bug that escapes the sandbox, and every one of them was served from the
app's origin, beside the person's session and the app's API. `WHATBUILD_CONTENT_URL` already gave a
deployment a site of its own for prototypes alone
([decision](mockups-carry-prototypes-served-from-a-capability-path.md)), and the uploaded-HTML
preview, a `srcdoc` frame, kept the app's policy at `style-src 'unsafe-inline'`.

## Decision

- **One switch.** With a content site, no route on the app's origin answers with a document of
  people's or agents' HTML, or a PDF to show inline. Without one, everything is served as before.
- **The app's addresses hand off.** Each route keeps its address and every check it makes, then
  answers `302` to `<content>/documents/<grant>/<name>` with `no-store` and `no-referrer`. Every
  load mints a fresh grant, so the web app, `print_view`'s `url` and `mockups`' `html_path` need no
  change and nothing refreshes an address. Rejected: addresses in operations' results, as
  `prototype_url` is, which would change many result shapes, put capabilities in agents' results
  and make the web app refresh them.
- **A grant per document and requester**: one purpose per kind, the tenant, the product, one
  immutable version (or the digest of a front or a style that changes in place) and the account,
  for the grant lifetime. The content route checks the requester again before the first byte
  (`requesterMayRead`), so losing access stops loads at once, a guest's too once the example
  organization is no longer the example, and does not count the load against the requester's limit
  on calls a minute a second time; it reads no session and never redirects. One prefix,
  `/documents/`, for every kind.
- **The same lookups and headers.** Both routes find a document with the same function
  (`apps/server/src/documents.ts`) and serve it with the same headers, except `frame-ancestors`,
  which names the app's origin, and CORP `cross-origin` and `private, no-store`.
- **Uploaded HTML from a route of its own**, in both modes, in a sandbox that runs no script, so
  the app's pages allow no inline style or script and ZAP rule 10055 fails the scan.
- Agents' previews give their `url` on the content site and keep their header grant.
- Not decided here, and on the [roadmap](../spec/10-roadmap.md): ending an address with its
  session, stable cacheable addresses for immutable versions, images and media from the content
  site, a shorter print address.

## Consequences

- A sandbox escape lands on a site with no session and no API, wherever a deployment has one.
- Each document costs a redirect and a few queries more; a canvas of 48 pages makes 48 of each.
- A document's address is a grant in a URL, as a prototype's is, readable by its own page.

## Constrains

- A route that serves a document of people's HTML or a PDF inline hands off with `handOff`
  (`apps/server/src/content-documents.ts`) when `config.contentUrl` is set, and finds its document
  with a function both routes call.
- The content host answers `/prototypes/`, `/documents/`, the two preview paths and `/health`, and
  nothing else (`createApp`); the app's `frame-src` names its `/prototypes/` and `/documents/`.
- No HTML from an upload is made inside an app page (`srcdoc`), and the app's policy keeps no
  `'unsafe-inline'`.

Specified in: [§6.4](../spec/06-operations-and-adapters.md), [§4.11](../spec/04-data-model.md),
[§2](../spec/02-architecture.md), [security](../system/security.md).
