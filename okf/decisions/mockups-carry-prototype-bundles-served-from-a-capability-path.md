---
type: Decision
title: A mockup version may carry a team's prototype as it is, a bundle of files served in the sandbox from a short-lived capability path
description: Multi-file prototypes come in unchanged and canvas pages enter them; every file is served under a signed path the sandbox policy confines the bundle to, on the app's origin until a separate content site is set.
tags: [decision, mockups, security, sandbox, storage, story, web, agents]
generated: {by: agent:claude, at: 2026-10-14}
status: draft
---

# A mockup version may carry a team's prototype as it is, a bundle of files served in the sandbox from a short-lived capability path

## Context

The maintainer chose on 2026-10-14 that mockups import real multi-file prototypes: a team's
clickable prototype (scripts, stylesheets, fonts, images, binary fixtures such as PDFs, several
HTML documents that link to one another, iframes of its own documents, forms that never leave the
browser) comes in as it is, and no agent flattens it into self-contained pages. Today a version is
a canvas of self-contained pages checked by the Story's HTML rules and served one document at a
time with `connect-src 'none'` and only `data:` resources
([decision](mockups-are-versioned-canvases-in-exploration.md),
[decision](story-pages-are-sandboxed-agent-html.md)), so a relative address has nothing to resolve
to, and a sandboxed page's own loads carry no session cookie to authorize them. Accepting this
record amends three rules: a page is one self-contained document; grants travel in a header, never
a URL ([security](../system/security.md)); a Story reader sees the promoted page and nothing else
of the mockup ([decision](a-reader-reads-only-the-story.md)). Draft until it is built; the design
is on the [roadmap](../spec/10-roadmap.md#planned--prototype-bundles-in-mockups).

## Decision

- **A bundle.** A version may carry one bundle: files at relative paths, any bytes, stored and
  given back byte for byte (the same SHA-256). A canvas page is either self-contained HTML, as now,
  or an **entry**: the path of one of the bundle's HTML documents, with a query and a fragment if
  it wants them. Several pages may enter one bundle. A bundle carries forward like pages and files.
- **Uploaded, never sent in a call.** A bundle arrives in the canvas ZIP under `bundle/`, and the
  manifest gives each page its `entry`. A public sandbox's visitors, who cannot upload a ZIP,
  cannot add or change one.
- **Confined, not checked.** Bundle files are not held to the Story's HTML rules. Publish warns
  about what will not load (root-relative and remote addresses) and refuses only unsafe archives;
  the response policy is the boundary.
- **A capability path.** Each file is served at `<content origin>/bundles/<grant>/<path>`. The
  grant is HMAC-signed for one tenant, one immutable version and an expiry hours away, rounded so
  the address stays put, and names no account, so a bundle cannot tell who views it. The route
  answers GET and HEAD only, never reads a cookie or an Authorization header, never sets a cookie,
  never redirects, owns its whole prefix, and finds each path as a row of that version, so a
  deleted mockup is gone at once. No blob key contains a bundle's path.
- **Every response** carries a CSP `sandbox allow-scripts allow-forms allow-popups
  allow-popups-to-escape-sandbox` (an opaque origin) whose only source, for scripts (with
  `'unsafe-inline' 'unsafe-eval'`), styles, images, fonts, media, `connect-src`, frames and
  `base-uri`, is that path; `worker-src`, `object-src` and `form-action` are `'none'`. With it:
  `nosniff`; a type from an allowlist fixed at publish, anything else an `octet-stream`
  attachment; `no-referrer`; `private, no-store`; `Cross-Origin-Resource-Policy: cross-origin`
  and `Access-Control-Allow-Origin: *` without credentials, because an opaque origin's own loads
  are cross-origin and it fetches module scripts and fonts with CORS; and
  `Cross-Origin-Embedder-Policy: credentialless`. Bundle documents set no `frame-ancestors`: it
  refuses any frame with an opaque-origin ancestor, which would break the bundle's own iframes, and
  a bundle document holds nothing to protect. A service worker's script is refused.
- **The app's origin is safe enough, by default.** Nothing a bundle runs is same-origin with the
  app, its scripts' requests carry no credentials and the route reads none, and its policy keeps it
  to one version's immutable bytes, so it reaches nothing today's pages cannot. Two harms that need the app's address are refused there:
  a bundle document opened at the top level (`Sec-Fetch-Dest: document`), which would show the
  team's page under WhatBuild's own address, and `alert`, `confirm` and `prompt`, which would name
  it. A setting for a separate content site (a registrable domain of its own, never a subdomain of
  the app's, which would be same-site) moves the route there and changes nothing else; it lifts both
  refusals and keeps a browser bug that escapes the sandbox away from the app, as every page's
  move there will. The maintainer decides when.
- **The frames.** The app gets a version's bundle address from `mockups.get`, and a promoted
  page's from the Story's read of it. The frame script goes into every HTML document the route
  serves; a link within the bundle navigates in place, any other opens a new tab as now, and a
  document that loads without the script is put back.
- **On the Story.** A promoted entry shows its bundle; a reader's address reaches that version's
  whole bundle, which is what the prototype is, and nothing else of the mockup. Print shows the
  page's poster, an image the manifest names, or says it is a prototype to open in WhatBuild.
- **Rejected:** flattening prototypes into self-contained pages (they stop being the team's);
  asset routes that take the session (an opaque origin's loads carry none, and loads that did
  would carry authority); the separate origin first (what it adds, it adds for every page today,
  and a capability route moves there by a setting).

## Consequences

- A prototype runs on the canvas and the Story as it does at home, if it uses relative addresses
  and no network.
- An opaque origin has no `localStorage`, `sessionStorage`, IndexedDB or cookies, so a prototype
  keeping state in them loses it between documents unless the frame script stands in for them.
- Browsers may cache nothing an opaque origin loads, so each frame fetches every file it uses.
- Storage grows: new bytes are stored once per mockup by hash, so a version that changes one file
  costs one file.
- A grant in a URL reads one immutable version, names nobody and lasts hours; a bundle can send its
  own address away, and with it only what it already holds.

## Constrains

- One route serves bundle files with one set of headers (`apps/server/src/`); nothing under its
  prefix reads a session, and no other route serves them.
- Bundle files are rows of `mockup_bundle_files` with row-level security and blob keys under
  `t/<tenant_id>/`, carried forward as rows.
- `apps/server/test/` holds the headers, the traversal refusals, the route's blindness to cookies
  and the top-level refusal.

Specified in: [10-roadmap](../spec/10-roadmap.md#planned--prototype-bundles-in-mockups), until built.
