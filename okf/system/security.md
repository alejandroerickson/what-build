---
type: System Concept
title: WhatBuild keeps each organization's material to its own people, and treats agent-written HTML, uploads and source text as hostile
description: The threat model: what is protected, who the attackers are, the trust boundaries, and each control with where it lives in code and the decision that governs it.
tags: [security, threat-model, tenancy, identity, oauth, sandbox, uploads]
generated: {by: agent:claude, at: 2026-10-10}
status: draft
---

# WhatBuild keeps each organization's material to its own people, and treats agent-written HTML, uploads and source text as hostile

Many organizations share one deployment, one database and one bucket, and people let agents act as
them. This page says what WhatBuild protects, from whom, where the boundaries are, and which code
holds each one; the linked decisions say why. Observed in the code on 2026-10-10.

## What is protected

- **Discovery material and what is built from it**: sources, files, passages, outcomes,
  assumptions, mockups and the Story. Transcripts carry customers' words and personal data.
- **The boundaries** between organizations, between products in one, and between roles.
- **Who people are** (in the public sandbox, which visitor is which), and **credentials**:
  sessions, OAuth tokens, grants, invitation links.
- **The record of who did what**, and whether an agent did it; and the service's availability.

## Who the attackers are

| Attacker | Holds | Wants |
|---|---|---|
| Anyone on the internet | The public endpoints: sign-in, OAuth discovery and registration, the site, a sandbox invitation's page | An account, a foothold, the service down |
| A member of another organization | An account, a session or an agent's token | Another organization's material |
| A member with a lower role | A reader, viewer or product-only grant | More than the role allows; another product |
| A sandbox visitor | A sandbox invitation link | Other visitors' identities, staff powers, resources |
| A misled or malicious agent | Its person's token; instructions possibly planted in a source | What its person can reach, used against them |
| An author of hostile content | A Story or mockup page, an uploaded or fetched file | Script in the app's origin; the parsers; the network behind the server |
| An MCP client passing as another | A registration of its own | A person's consent |

## Trust boundaries

1. **Browser and server**: a session cookie, and an `Origin` check on every write that carries one.
2. **Agent and server**: an OAuth token bound to the MCP endpoint a person approved; REST takes none.
3. **Server and database**: one tenant per transaction, under forced row-level security.
4. **Agent-written HTML and the app**: pages run in an opaque origin with no network access.
5. **Uploads and the server**: a signed grant per file; parsing in the worker, never in a request.
6. **Server and the internet**: the URL fetcher, the identity providers, mail.
7. **Edge and service**: the Cloudflare Worker passes requests through; the controls are in the service.
8. **Repository and production**: approved releases only; no credential in the repository or image.

## Controls

**Identity and sessions** in `apps/server/src/auth/` ([decision](../decisions/built-in-identity-and-oauth.md),
[decision](../decisions/invitations-belong-to-their-address.md), [§3.2, §3.8](../spec/03-accounts-teams-and-identity.md)).

- No passwords. An email link is marked used on first use, lasts 15 minutes, five an hour per
  address. Google needs `email_verified` and WhatBuild as audience; Microsoft accepts one
  configured directory (`aud`, `tid`, `iss`). Both use PKCE S256 and a random `state` in an
  `HttpOnly` cookie scoped to the flow for ten minutes. Development sign-in is refused in production.
- Sessions are 256-bit random tokens in `wb_session` (`HttpOnly`, `SameSite=Lax`, `Secure` on
  HTTPS), stored as SHA-256 hashes, for 30 days, deleted on sign-out.
- A write other than GET, HEAD or OPTIONS that carries a `wb_` cookie is refused when its `Origin`
  is another site (`apps/server/src/app.ts`); REST checks again (`checkOrigin` in `rest.ts`).
- Invitations are 256-bit links stored as hashes, for 7 days, accepted only by the account with the
  invited address. Only instance owners, and addresses they give an allowance, create organizations
  ([decision](../decisions/only-instance-owners-decide-who-creates-organizations.md)).

**Agents and OAuth** ([decision](../decisions/built-in-identity-and-oauth.md),
[decision](../decisions/a-scoped-mcp-connector-is-a-fence.md)). `apps/server/src/auth/oauth.ts`.

- Dynamic registration; authorization code with PKCE S256 required; codes for ten minutes and
  once, bound to client, redirect URI and challenge; one-hour access tokens; 30-day refresh tokens
  that rotate, reuse revoking the connection; every token stored as a hash. Redirect URIs are
  `https`, loopback `http` or a private-use scheme, matched exactly.
- The consent page names the client, the person and what the agent will reach; it cannot be
  framed, its form carries a token from a `SameSite=Strict` cookie, and it posts only to WhatBuild
  and the client's registered callback.
- A token serves its own MCP endpoint and those inside it (`resourceCovers`, `connector-reach.ts`);
  a scoped endpoint refuses every call outside it with `403 outside_connector_scope` before any
  handler runs (`packages/core/src/connector-scope.ts`).

**Tenancy and access** ([decision](../decisions/shared-schema-tenancy-with-row-level-security.md),
[decision](../decisions/access-is-per-product-roles.md), [decision](../decisions/a-reader-reads-only-the-story.md)).

- Every operation, REST or MCP, goes through `execute` (`packages/core/src/execute.ts`): authorize
  the scope (`404` without a role, before validation), apply a connector's fence and a sandbox's
  limits, validate strictly, then run in a transaction with `app.tenant_id` set. Roles are in
  `packages/core/src/policy.ts`; a reader's Story reads are trimmed by `readsOnlyTheStory`.
  `apps/server/test/access.test.ts` requires `404` from every operation for a non-member.
- Row-level security is forced on every table of product content (`apps/server/src/migrations/`),
  and the server refuses to start in production as a role with `SUPERUSER` or `BYPASSRLS`
  (`apps/server/src/database.ts`). Directory tables (accounts, sessions, OAuth, tenants, teams,
  products, memberships, invitations, jobs) sit outside it; code that reads them filters by tenant.
- Inside a tenant, handlers load an object by its id and its product (`loadRecord` and its kin),
  and references never cross products (`422 cross_product_reference`). The worker, baselines and
  resets each run in a transaction scoped to one tenant. Blob keys begin `t/<tenant_id>/`.
- A read-only backup role that bypasses row-level security takes the nightly dump and the QA copy;
  the service never runs as it ([decision](../decisions/qa-uses-a-private-copy-of-production.md)).

**Agent-written HTML** ([decision](../decisions/story-pages-are-sandboxed-agent-html.md),
[decision](../decisions/mockups-are-versioned-canvases-in-exploration.md)).

- At publish a page must be one self-contained document: no external resources, forms, frames,
  `<base>` or `<meta http-equiv>`, bounded inline scripts, 1 MB (`packages/core/src/story-html.ts`).
  This helps authors; the response is the boundary.
- Every response serving page HTML carries `STORY_RESPONSE_HEADERS`: a CSP `sandbox` without
  `allow-same-origin` (an opaque origin), `default-src 'none'`, `connect-src 'none'`,
  `form-action 'none'`, `frame-ancestors 'self'`, `no-store`, `nosniff`, `no-referrer`.
- The app frames pages with `<iframe sandbox>` and takes only a key name or a page slug from the
  frame it made (`apps/web/src/routes/story.tsx`). App pages send `Cross-Origin-Opener-Policy:
  same-origin`, `X-Frame-Options: DENY` and `script-src 'self'` (`apps/server/src/public-routes.ts`).
  The print view is sandboxed and runs one nonce'd script (`packages/core/src/story-print.ts`).
- Markdown becomes React elements from a lexer: no HTML from the text reaches the DOM, and only
  web, mail, fragment and same-origin links are live (`apps/web/src/lib/markdown.tsx`).

**Uploads, parsing and files served back** ([derived layer](../spec/05-derived-layer.md)).

- Bytes move only under an HMAC-SHA256 grant bound to one purpose and object, for 30 minutes;
  production refuses a key under 32 characters (`apps/server/src/adapters/misc.ts`). The relay
  ignores cookies and enforces the grant's size as bytes arrive (`apps/server/src/uploads.ts`);
  the stored object's own size and hash decide the file entry.
- File paths refuse traversal, backslashes and control characters (`packages/core/src/media.ts`).
- Parsing is a pure function of bytes in the worker. A file over the parse cap (25 MiB) is stored
  but not parsed; a parser's error becomes a status. XML is read with saxes, which expands no DTD
  entities, internal or external (`packages/parsers/src/`).
- Files are served back with `nosniff` and a CSP `sandbox` with `default-src 'none'`, except PDFs,
  which browsers will not render sandboxed; HTML, XHTML and SVG only as an
  `application/octet-stream` attachment (`streamFile` in `apps/server/src/rest.ts`). Agents send
  download grants in a header, never a URL. REST bodies are limited to 5 MB.
- Source text is quoted material: the MCP server's instructions and the skill tell agents never to
  follow it (`apps/server/src/mcp.ts`).

**Outbound fetches.** `files.fetch_url` (`SafeUrlFetcher`, `apps/server/src/adapters/misc.ts`)
fetches `https` only, without credentials; resolves host names through a lookup that refuses a
name with any private, loopback, link-local or multicast address; re-checks every redirect;
verifies certificates; caps size and time; and sends no cookie or credential. Sandbox visitors
cannot use it unless staff turn it on.

**The public sandbox** ([decision](../decisions/the-public-sandbox-is-one-organization-with-pseudonymous-visitors.md),
[§3.10](../spec/03-accounts-teams-and-identity.md), [§9.7](../spec/09-data-lifecycle.md)).
In a sandbox every role stops at editor except its owners' and admins', and a visitor's grant counts
only while the deployment names the sandbox (`effectiveRole`, `membershipsFor`). A visitor writes
under a made-up name `execute` puts in the actor snapshot, sees only themselves in `members.list`,
and cannot delete permanently. Admission is by 144-bit codes stored as hashes, with places and a
cap on seats. Limits on calls, writes, sources, bytes, sizes, formats and exports are settings
enforced in `execute` and the upload path (`packages/core/src/public-sandbox.ts`). The daily reset
holds the sandbox's lock alone, drops its pending jobs and puts the baseline back.

**Secrets, logs and delivery.** Configuration comes from the environment (`config.ts`); secrets
live in Secret Manager or Key Vault (`deploy/cloud-run/setup.sh`, `deploy/azure/containerapp.yaml`),
and the runtime identity reaches only the files bucket, its secrets and its database. Without a mail
provider, email links are off rather than logged. Log lines hold method, masked path, status and
time, never bodies, query strings or headers; an unexpected error answers `500` without detail
(`app.ts`). The image is built from an allow-list (`.dockerignore`) and runs as `node` with
`NODE_ENV=production`. CI gives pull requests a read-only token; production moves only on an
approved release ([decision](../decisions/production-runs-releases-after-approval.md)). The Worker
(`deploy/cloudflare/worker.js`) sets `X-Forwarded-Host`, which `site.ts` uses only to pick a page.

**Accepted, by decision.** An agent acts with its person's full role, made visible by attribution
and declared authorship ([decision](../decisions/attribution-and-declared-authorship.md)). A page
may link anywhere and open new tabs. Sandbox visitors see and change each other's work until the
reset. Serving page HTML from a separate origin is planned ([roadmap](../spec/10-roadmap.md)).
