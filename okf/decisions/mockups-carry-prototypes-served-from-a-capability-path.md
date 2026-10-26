---
type: Decision
title: A mockup version may carry a team's prototype as it is, served in the sandbox from a short-lived capability path
description: Multi-file prototypes come in unchanged, stateless, and canvas pages enter them; every file is served under a signed path that the sandbox policy confines the prototype to, on the app's origin until a separate content site is set.
tags: [decision, mockups, prototype, security, sandbox, storage, story, web, agents]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# A mockup version may carry a team's prototype as it is, served in the sandbox from a short-lived capability path

## Context

The maintainer chose on 2026-10-14 that mockups import real multi-file prototypes: a team's
clickable prototype (scripts, stylesheets, fonts, images, binary fixtures such as PDFs, several
HTML documents that link to one another, iframes of its own documents, forms that never leave the
browser) comes in as it is, and no agent flattens it into self-contained pages. A self-contained
page is served one document at a time with only `data:` resources
([decision](story-pages-are-sandboxed-agent-html.md)), so a relative address has nothing to resolve
to, and a sandboxed page's own loads carry no session cookie to authorize them. The maintainer named
the multi-file part a mockup's **prototype** (the name "bundle" already names a product's export);
the [mockups decision](mockups-are-versioned-canvases-in-exploration.md) still rejects "prototype"
as the name of a whole mockup. This record amends three rules: a page is one self-contained
document; grants travel in a header, never a URL ([security](../system/security.md)); a Story reader
sees the promoted page and nothing else of the mockup ([decision](a-reader-reads-only-the-story.md)).

## Decision

- **A prototype.** A version may carry one: files at relative paths, any bytes, stored and given
  back byte for byte (the same SHA-256). A canvas page is self-contained HTML or an **entry**: the
  path of one of the prototype's HTML documents, with a query and a fragment if wanted. Several
  pages may enter one prototype; it carries forward like pages and files. It arrives only under
  `prototype/` in the canvas ZIP, so an organization on the free plan, which uploads no canvas, cannot add one.
- **Confined, not checked.** Its files are not held to a page's HTML rules: publish warns, naming
  each file, about what will not work there, and refuses only unsafe archives. The policy holds.
- **Stateless.** `localStorage`, `sessionStorage`, IndexedDB and `document.cookie` behave as the
  sandbox makes them: unavailable, and touching one throws; no stand-in is injected. The maintainer
  chose this on 2026-10-14, rejecting per-frame in-memory stand-ins, which would make a prototype
  behave unlike its local run without saying so. Publish warns about each script that uses one.
- **A capability path.** Each file is served at `<origin>/prototypes/<grant>/<path>`. The grant is
  HMAC-signed for one tenant and one immutable version, names no account, and expires after 8 hours
  rounded up to the hour, so the address stays put. The route answers GET and HEAD only, never
  reads a cookie or an Authorization header, never sets a cookie, never redirects, owns its whole
  prefix, and finds each path as a row of that version, so a deleted mockup is gone at once.
- **Every response** carries a CSP `sandbox allow-scripts allow-forms allow-popups
  allow-popups-to-escape-sandbox` (an opaque origin) whose only source for scripts (with
  `'unsafe-inline' 'unsafe-eval'`), styles, images, fonts, media, `connect-src`, frames and
  `base-uri` is that path; workers, objects and form submissions get `'none'`. With it: `nosniff`,
  a type from an allowlist fixed at publish (else an `octet-stream` attachment), `no-referrer`,
  `private, no-store`, CORP `cross-origin` and `Access-Control-Allow-Origin: *` without credentials
  (an opaque origin's loads are cross-origin, and it fetches modules and fonts with CORS), and COEP
  `credentialless`. No `frame-ancestors`: it refuses any frame under an opaque origin, which would
  break the prototype's own iframes. A service worker's script is refused.
- **The app's origin, by default.** A prototype reaches nothing today's pages cannot, so the
  separate origin need not come first. Two harms that need the app's address are refused there: a
  document at the top level (`Sec-Fetch-Dest: document`) and `alert`, `confirm` and `prompt`.
  `WHATBUILD_CONTENT_URL` moves the route to a content site of its own (another registrable domain,
  never a subdomain), lifting both refusals and keeping a sandbox escape away from the app. The
  maintainer chose on 2026-10-14 to register that domain later. The content site now serves every
  page and inline file as well, never anything of the app's
  ([decision](with-a-content-site-every-page-and-inline-file-is-served-from-it.md)).
- **Frames.** `mockups.get` and the Story's read give a frame its address; the route adds the
  frame script to every HTML document. Links within the prototype move in place; a load that does
  not announce itself as one of its documents is put back.
- **On the Story** a reader of a promoted entry reaches that version's whole prototype, which is
  what the prototype is, and nothing else of the mockup (the maintainer's choice, 2026-10-14).
  Print shows the page's poster, or a notice.
- **Limits** (accepted 2026-10-14): 48 pages a canvas; 2,000 files and 64 MB a prototype, 25 MB a
  file; 500 MB of distinct prototype bytes a product.
- Rejected: flattening prototypes into pages; asset routes that take the session; the separate
  origin first.

## Consequences

- A prototype runs on the canvas and the Story as at home, if it uses relative addresses, no
  network and no browser storage; publish names what does not.
- Browsers may cache nothing an opaque origin loads, so each frame fetches every file it uses.
- New bytes are stored once per mockup by hash, so a version that changes one file costs one file.
- A grant in a URL reads one immutable version, names nobody and lasts hours; a prototype can send
  its own address away, and with it only what it already holds.

## Constrains

- `apps/server/src/prototype.ts` alone serves prototype files, with `prototypeResponseHeaders`
  (`packages/core/src/prototype.ts`); nothing under `/prototypes/` reads a session.
- Prototype files are rows of `mockup_prototype_files` with row-level security, blob keys under
  `t/<tenant_id>/` that hold ids and a hash and never a path.
- `apps/server/test/mockup-prototypes.test.ts` holds the headers, the refusals and the route's
  blindness to cookies; `scripts/prototype-check.mjs` checks them in Chrome.

Specified in: [04-data-model §4.12](../spec/04-data-model.md#412-mockups), [07-web-app §7.7](../spec/07-web-app.md#77-exploration), [09-data-lifecycle §9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas).
