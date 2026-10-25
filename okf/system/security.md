---
type: System Concept
title: WhatBuild keeps each organization's material to its own people, and treats agent-written HTML, uploads and source text as hostile
description: The threat model: what is protected, who the attackers are, the trust boundaries, and each control with where it lives in code and the decision that governs it.
tags: [security, threat-model, tenancy, identity, oauth, sandbox, uploads]
generated: {by: agent:claude, at: 2026-10-25}
status: draft
---

# WhatBuild keeps each organization's material to its own people, and treats agent-written HTML, uploads and source text as hostile

Many organizations share one deployment, one database and one bucket, and people let agents act as
them. This page says what WhatBuild protects, from whom, where the boundaries are, and which code
holds each one; the linked decisions say why. Observed in the code on 2026-10-10.

## What is protected

- **Discovery material and what is built from it**: sources, their attachments and text, outcomes,
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
| A misled or malicious agent | Its person's token; instructions possibly planted in a source, by a stranger in the public sandbox | What its person can reach, used against them; from the sandbox, only the sandbox |
| An author of hostile content | A Story or mockup page, an uploaded or fetched file | Script in the app's origin; the parsers; the network behind the server |
| An MCP client passing as another | A registration of its own | A person's consent |

## Trust boundaries

1. **Browser and server**: a session cookie, and an `Origin` check on every write that carries one.
2. **Agent and server**: an OAuth token bound to the MCP endpoint a person approved; REST takes none.
3. **Server and database**: one tenant per transaction, under forced row-level security.
4. **Agent-written HTML and the app**: pages run in an opaque origin with no network access.
5. **Uploads and the server**: a signed grant per file; parsing in a worker thread held to a memory
   and a time limit, never in a request.
6. **Server and the internet**: the URL fetcher, the identity providers, mail.
7. **Edge and service**: the Cloudflare Worker passes requests through; the controls are in the service.
8. **Repository and production**: approved releases only; no credential in the repository or image.

## Controls

**Identity and sessions** in `apps/server/src/auth/` ([decision](../decisions/built-in-identity-and-oauth.md),
[decision](../decisions/invitations-belong-to-their-address.md), [§3.2, §3.8](../spec/03-accounts-teams-and-identity.md)).

- No passwords. Opening an email link changes nothing: it shows a page with one button, so a mail
  scanner that fetches the link leaves it unused. The button's POST signs in, and is refused unless
  it comes from the app's own origin, so another site cannot sign a person in to an account it
  chose (login CSRF). The link works once, however many requests bring it at the same moment: one
  conditional update marks it used, and only the request that made it signs in. It lasts
  15 minutes, five an hour per address; its page is never framed or cached and sends no referrer
  off its origin.
- Google needs `email_verified` and WhatBuild as audience. Microsoft accepts one configured
  directory (`aud`, `tid`, `iss`), and from it only an address whose domain has evidence: the
  token's `xms_edov` (Entra's word that the domain's owner verified it), or a domain the
  deployment lists in `WHATBUILD_MICROSOFT_DOMAINS`, the only domains in which a user principal
  name is taken; so a directory's administrator cannot sign in as an address in someone else's
  domain by giving it to a directory user. A refused Microsoft sign-in logs which check failed
  as claim names and booleans, under a random reference the sign-in page shows; never the token,
  an address, a name or a claim's value. Both use PKCE S256 and a random `state` in an
  `HttpOnly` cookie scoped to the flow for ten minutes.
- Development sign-in, the fixed development grant key and printed mail exist only when
  `NODE_ENV` is exactly `development` or `test`; a server started with it unset, or set to anything
  else, runs as production (`config.ts`).
- Where a sign-in returns to (`next`) is a path on this origin or `/` (`safeNext`,
  `packages/core/src/safe-next.ts`, which the server and the web app's sign-in page both apply): a
  scheme or host, a backslash, whitespace or a control character anywhere, or an encoded slash,
  backslash, percent sign or control character in the path, sends the person to `/`, and so does a
  path that normalizes to begin with `//`.
- Sessions are 256-bit random tokens, stored as SHA-256 hashes, for 30 days, deleted on sign-out.
  Over HTTPS the cookie is `__Host-wb_session` (`HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`, no
  `Domain`), which only the app's own host can set, so no host under the same parent domain can
  plant a session; `wb_session` is taken only for a session issued before the prefix, which is then
  moved to the new name (`identity.ts`). Over HTTP, in local development, it is `wb_session`. When
  the public URL is `https`, every response carries `Strict-Transport-Security: max-age=31536000`,
  for the app's own host: not `includeSubDomains`, since the parent domain also names the public
  site, and not preloaded (`app.ts`).
- Bodies sent to `/auth/*` and `/oauth/*` are refused past 64 KB, before they are read, whether
  or not they declare a length (`app.ts`).
- A write other than GET, HEAD or OPTIONS that carries a `wb_` or `__Host-wb_` cookie is refused
  when its `Origin` is another site (`apps/server/src/app.ts`); REST checks again (`checkOrigin` in
  `rest.ts`), and so does the sign-in link's POST, cookie or none (`isOwnOrigin`, `identity.ts`).
- Invitations are 256-bit links stored as hashes, for 7 days, accepted only by the account with the
  invited address. Only instance owners, and addresses they give an allowance, create organizations
  ([decision](../decisions/only-instance-owners-decide-who-creates-organizations.md)).

**Agents and OAuth** ([decision](../decisions/built-in-identity-and-oauth.md),
[decision](../decisions/a-scoped-mcp-connector-is-a-fence.md)). `apps/server/src/auth/oauth.ts`.

- Dynamic registration, open to anyone and bounded: at most 10 redirect URIs of 500 characters
  each, and a name of 100 printable characters (control and format characters removed); at most
  50 registrations an hour that have not yet led to a connection, then `429 rate_limited` with
  `Retry-After`; and the worker forgets a registration that never led to one after seven days.
- Authorization code with PKCE S256 required; codes for ten minutes and once, bound to client,
  redirect URI and challenge; one-hour access tokens; 30-day refresh tokens that rotate, reuse
  revoking the connection; every token stored as a hash. A code is spent, and a refresh token
  rotated, by one conditional update, so of requests that arrive together one succeeds; the
  exchange and the rotation are each one transaction, so a concurrent second use is reuse, and
  revokes what the first one issued. A code presented again revokes the connection it made, which
  its row records (RFC 6749 §4.1.2). Redirect URIs are `https`, loopback `http` or a private-use
  scheme, matched exactly.
- The consent page names the client in quotation marks as the name it gave itself, which WhatBuild
  has not verified, and says where Allow hands the connection: the redirect URI's host, or an app
  on this computer for loopback and private-use schemes. It names the person and what the agent
  will reach; it cannot be framed or cached, and it posts only to WhatBuild and the client's
  registered callback. Its form carries a token from a `SameSite=Strict` cookie that also holds an
  HMAC, keyed with the server's secret, over the request the page showed and the account it showed
  it to: an Allow whose resource, code challenge, `state` or client differs, or that another
  account posts, is refused. The connected-agents list says who holds each connection the same
  way.
- A connection has the level the person chose on the consent page (Read only, Edit by default,
  or Admin), stored on its tokens. It caps the person's role, never adds to it: `execute` refuses
  an operation above it (`403 connection_level`) before resolving any scope, and MCP lists only
  what it allows, so an agent on an Edit connection is never offered a permanent delete. Only a
  web session changes a level (`PATCH /api/v1/me/agents/…`); REST refuses bearer tokens, so an
  agent cannot raise its own. The person's feedback switch on a connection works the same way: off,
  `submit_feedback` is neither listed nor answered (`403 feedback_off`). Deleting an organization is refused to anything but a person in the
  web app (`403 web_only`) and never listed to an agent.
- Feedback names nobody: a report keeps no account, only an address its sender chose to share,
  and a person with their agents sends at most 10 a day, a deployment taking at most 200
  ([§4.13](../spec/04-data-model.md#413-feedback)).
- Nothing goes to a client's redirect URI before the person chooses Allow or Deny: an error in an
  authorization request (response type, PKCE, resource) is said on WhatBuild's own page, signed in
  or not, so no registered URI is reached from WhatBuild's domain without a person's choice
  ([RFC 9700 §4.11.2](https://www.rfc-editor.org/rfc/rfc9700#section-4.11.2)).
- A token serves its own MCP endpoint and those inside it (`resourceCovers`, `connector-reach.ts`);
  a scoped endpoint refuses every call outside it with `403 outside_connector_scope` before any
  handler runs (`packages/core/src/connector-scope.ts`). Over MCP the fence and the caller's role
  are checked before the tool's input is validated; only a call that names no product, team or
  tenant is told first that its input is malformed.
- The unscoped connector reaches no public sandbox, where strangers write the content: a call
  through `/mcp` that lands in one is refused with `403 sandbox_needs_its_own_connector` before any
  handler runs, staff's included, and `products.list` there names a sandbox only by its name and
  its own address ([decision](../decisions/the-public-sandbox-is-reached-only-through-its-own-connector.md)).
  So a connection that reads what a stranger planted in the sandbox holds nothing else of
  WhatBuild. An agent may still hold a second connector in the same session; the skill and the
  server's instructions tell it not to, and that is a request, not a boundary.

**Tenancy and access** ([decision](../decisions/shared-schema-tenancy-with-row-level-security.md),
[decision](../decisions/access-is-per-product-roles.md), [decision](../decisions/a-reader-reads-only-the-story.md)).

- Every operation, REST or MCP, goes through `execute` (`packages/core/src/execute.ts`): authorize
  the scope (`404` without a role, before validation, on both doors, so a non-member's malformed
  MCP call gets `404` as over REST), apply a connector's fence and a sandbox's limits, validate
  strictly, then run in a transaction with `app.tenant_id` set. Roles are in
  `packages/core/src/policy.ts`; a reader's Story reads are trimmed by `readsOnlyTheStory`.
  `apps/server/test/access.test.ts` requires `404` from every operation for a non-member, and
  `tenant-isolation.test.ts` calls every operation from another organization over both doors.
- Only an owner changes or removes an owner's role. Below an owner or admin of the organization,
  `members.list` shows only the people on the teams and products the caller reads, with those
  grants, and the invitations they could cancel (`partial: true`); every `members` operation
  answers a team or product the caller has no role on with the same `404` as one that does not
  exist (`packages/core/src/ops/products.ts`).
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

- At publish a page must be one self-contained document: no external resources, frames, `<link>`,
  `<base>` or `<meta http-equiv>`, 1 MB. A Story page also has bounded inline scripts and no
  forms; a mockup page has neither limit, so a working prototype fits
  (`packages/core/src/html-rules.ts`, one `PageRules` for each surface). This helps authors; the
  response is the boundary. The script budget is no control: inside the sandbox a few lines of
  script do whatever a long one does, and the policy allows neither `eval` nor WebAssembly (no
  `'unsafe-eval'` or `'wasm-unsafe-eval'`).
- No form submission goes anywhere: every response that serves a page says
  `form-action 'none'`, the print view's too, which stops a submission whatever its `target`,
  `formaction`, `formtarget` or method, a `javascript:` action and `form.submit()` included. A
  mockup page's sandbox adds `allow-forms`, in its responses and the app's frames, so a
  prototype's `submit` handler runs; a Story page's has none. Forms add no capability: a page's
  script already reads what is typed into an input, which a Story page may hold, and could already
  open a tab at any address it builds (`allow-popups`). Each surface's sandbox is one constant
  (`packages/core/src/page-sandbox.ts`) that the headers and the frames both take
  (`apps/server/test/mockups.test.ts` holds them).
- Every response serving page HTML carries `STORY_RESPONSE_HEADERS`: a CSP `sandbox` without
  `allow-same-origin` (an opaque origin), `default-src 'none'`, `connect-src 'none'`,
  `form-action 'none'`, `frame-ancestors 'self'`, `no-store`, `nosniff`, `no-referrer`: a Story
  page and a style's specimen; a mockup page, on its canvas and on the Story, carries
  `MOCKUP_RESPONSE_HEADERS`, the same with `allow-forms` (`pageResponseHeaders`). The print view
  has a policy of its own, without `allow-forms`, and drops forms and scripts. A
  version's ZIP and a product export are attachments, never rendered.
- A Story preview (`story.preview`) is checked by the same code as a publish and served by the
  same function as a version's HTML (`storyHtml` in `apps/server/src/rest.ts`), in the same
  sandbox, so nothing reaches a browser through a preview that publishing would refuse. Its
  document opens only under a download grant of its own purpose (`story_preview`), never with a
  session, and lives no longer than the grant
  ([decision](../decisions/a-story-preview-is-the-document-publish-would-store.md)).
- The app frames pages with `<iframe sandbox>` and takes only a key name or a page slug from the
  frame it made (`apps/web/src/routes/story.tsx`). App pages send `Cross-Origin-Opener-Policy:
  same-origin`, `X-Frame-Options: DENY`, `frame-ancestors 'none'` and `script-src 'self'`
  (`apps/server/src/public-routes.ts`).
  The print view is sandboxed and runs one nonce'd script (`packages/core/src/story-print.ts`).
- A mockup's **prototype**, a team's multi-file prototype, is served by one route,
  `/prototypes/<grant>/<path>` (`apps/server/src/prototype.ts`,
  [decision](../decisions/mockups-carry-prototypes-served-from-a-capability-path.md)). The grant
  in the path is its only authority: HMAC-signed for one tenant and one immutable version, naming no
  account, for 8 hours. The route reads no cookie or Authorization header, sets none, never
  redirects (a policy's path is not checked after a redirect), decodes a path part by part and looks
  it up as a row of that version, and refuses a service worker's script. Every response carries
  `prototypeResponseHeaders` (`packages/core/src/prototype.ts`): a CSP `sandbox` without
  `allow-same-origin`, every source limited to the version's own address, `worker-src`,
  `object-src` and `form-action` `'none'`, `nosniff` with a type fixed at publish from an
  allowlist (anything else an attachment), `no-referrer`, `private, no-store`, CORP `cross-origin`
  and `Access-Control-Allow-Origin: *` without credentials (its own loads come from an opaque
  origin), and COEP `credentialless`. A prototype's loads carry no session: an opaque origin's
  requests are cross-site, `credentialless` strips the credentials of the rest, and CORS ones send
  none cross-origin. On the app's origin a prototype's document is never served at the top level
  (`Sec-Fetch-Dest: document`), where it would stand under WhatBuild's own address, and it gets
  no `allow-modals`; `WHATBUILD_CONTENT_URL` moves the route to a site of its own, which answers
  nothing else. The app frames a prototype in the sandbox the server names and puts back a load
  that is not one of its documents (each says so through the frame script).
- Markdown becomes React elements from a lexer: no HTML from the text reaches the DOM, and only
  web, mail, fragment and same-origin links are live (`apps/web/src/lib/markdown.tsx`). A link into
  the product being read opens in place whatever origin it was written with, so a copy of a
  deployment's content never sends a reader back to the original.
- A page opened on another name for the deployment (`run.app`, Container Apps' default host) is
  redirected to `WHATBUILD_PUBLIC_URL`, where the session cookie and the own-origin check for
  writes live; machines' paths are answered on any host (`apps/server/src/canonical-host.ts`).

**Uploads, parsing and files served back** ([derived layer](../spec/05-derived-layer.md)).

- Bytes move only under an HMAC-SHA256 grant bound to one purpose and object, for 30 minutes;
  production refuses a key under 32 characters (`apps/server/src/adapters/misc.ts`). The relay
  ignores cookies and enforces the grant's size as bytes arrive (`apps/server/src/uploads.ts`),
  and checks again then that whoever requested the grant can still write; the stored object's own
  size and hash decide the attachment's entry. A direct-to-bucket URL is signed for at most the grant's
  size (`x-goog-content-length-range`, `directUploadSigning` in `blobs-gcs.ts`), and
  `attachments.complete_upload` reads the object's size before its bytes, discards one over the grant
  with `413`, and hashes the bytes as it streams them.
- A mockup canvas uploaded as a ZIP comes through the relay only, under a grant of its own purpose
  (`mockup_upload`), and is refused to a visitor to the public sandbox, whose text is capped field
  by field. Publish unpacks it with the parsers' `zipEntries`, which stops at 96 MB unpacked
  however the archive claims its sizes and refuses more than 2,148 entries before inflating any;
  publish takes only the canvas's own entries, refuses a name used twice and a symbolic link, and
  checks every page by a mockup page's rules as if it had been sent in the call
  (`packages/core/src/ops/mockups.ts`). A prototype's paths are normalised to NFC and refuse dot
  parts, absolute paths, `\ : * ? " < > | #`, control characters and names that collide once case
  is set aside (`prototypePath`); its bytes are stored under ids and their hash, never their path.
- File paths refuse traversal, backslashes and control characters (`packages/core/src/media.ts`).
- A null character (U+0000) is refused in every request's path, query, form fields and JSON body
  before any route reads it (`apps/server/src/null-characters.ts`), and in an operation's input by
  its own check, naming the field either way, so none reaches Postgres, which keeps none in text,
  or a file path; nothing strips it. Uploaded bytes and the MCP endpoint's body are not read by
  the middleware, and an MCP call's input meets the operation's check.
- Parsing is a pure function of bytes, run by the worker in a worker thread of its own for each
  file, with an empty environment (`apps/server/src/parse-thread.ts`,
  [decision](../decisions/each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits.md)).
  The thread's heap is held to `WHATBUILD_PARSE_MEMORY_MB` (384 MB by default), its buffers to
  half as much again and its run to `WHATBUILD_PARSE_TIMEOUT_SECONDS` (120 s); a parse past any of
  them is stopped and its derivation recorded as failed with the reason, while the server goes on
  answering. A job that stops the process anyway is given up after five attempts and recorded as
  failed (`apps/server/src/worker.ts`).
- Parsers bound what a file can make them do (`packages/parsers/src/`). A file over the parse cap
  (25 MiB) is stored but not read; DOCX, XLSX and DOC packages count the bytes they unpack against
  the cap and stop past it, whatever sizes they declare; a PDF of more than 2,000 pages, and a file
  that would make more than 200,000 paragraphs, are too large; pdf.js decodes no images; HTML nests
  at most 512 deep and makes elements in proportion to its length; patterns that could backtrack
  are single passes, so text is read in time linear in its length. XML is read with saxes, which
  expands no DTD entities, internal or external. A parser's error becomes a status.
- Files are served back with `nosniff`, `private, no-store` and a CSP `sandbox` with
  `default-src 'none'`, except PDFs, which browsers will not render sandboxed; only the app may
  frame them (`frame-ancestors 'self'`); HTML, XHTML and SVG only as an
  `application/octet-stream` attachment (`streamFile` in `apps/server/src/rest.ts`). Agents send
  download grants in a header, never a URL. REST and MCP bodies are limited to 5 MB; `/mcp`
  reads one only once the caller's token is checked (`MCP_BODY_MAX_BYTES` in `apps/server/src/mcp.ts`).
- Source text is quoted material: the MCP server's instructions and the skill tell agents never to
  follow it (`apps/server/src/mcp.ts`).

**Headers on every response** (`RESPONSE_HEADERS` in `apps/server/src/app.ts`, held by
`apps/server/test/response-headers.test.ts` and the weekly OWASP ZAP scan,
[security checks](../operations/security-checks.md)).

- Every response says `Cross-Origin-Resource-Policy: same-origin`, so no other site can load it
  into its pages, and its process; `Cross-Origin-Embedder-Policy: credentialless`, so a page loads
  from other sites only what it can fetch without credentials and frames only documents that say
  the same; `nosniff`; and a `Permissions-Policy` that turns off the browser features WhatBuild
  never uses (camera, microphone, location, payment, devices and sensors; `PERMISSIONS_POLICY` in
  `packages/core/src/story-html.ts`). Full screen and the clipboard, which the app uses, keep
  their defaults. A route that sets one of these keeps its own.
- Responses under `/api`, `/mcp`, `/auth` and `/oauth` say `Cache-Control: no-store` unless the
  route says otherwise, so no cache, the browser's included, keeps people's material, who they
  are, or a credential. Hashed assets are cached for a year; the shell is checked each time.
- Every HTML response's policy defines `frame-ancestors`, `form-action` and `base-uri`, which have
  no fallback; an HTML response whose route set no policy gets `default-src 'none'` and all three
  at `'none'`. The Cloudflare Worker sends the site's page with the same headers
  (`deploy/cloudflare/worker.js`).

**Outbound fetches.** `attachments.fetch_url` (`SafeUrlFetcher`, `apps/server/src/adapters/misc.ts`)
fetches `https` only, without credentials. An address written in the URL, in any notation, is
checked before connecting; a name is resolved through a lookup that refuses any non-public
address; both again on every redirect. Public means outside every special-purpose IPv4 range and,
for IPv6, inside global unicast outside its special parts (`isPublicAddress`). It verifies
certificates, caps size, waits at most 30 seconds between bytes and 60 for the whole fetch, runs
three at once per person, downloads before the operation's transaction (the registry's `prepare`
step), and answers every network failure with one plain `fetch_failed`. Sandbox visitors cannot
use it unless staff turn it on.

**The public sandbox** ([decision](../decisions/the-public-sandbox-is-one-organization-with-pseudonymous-visitors.md),
[§3.10](../spec/03-accounts-teams-and-identity.md), [§9.7](../spec/09-data-lifecycle.md)).
In a sandbox every role stops at editor except its owners' and admins', and a visitor's grant counts
only while the deployment names the sandbox (`effectiveRole`, `membershipsFor`). A visitor writes
under a made-up name `execute` puts in the actor snapshot, sees only themselves in `members.list`,
and cannot delete permanently, which needs admin. Admission is by 144-bit codes stored as hashes, with places and a
cap on seats. Limits on calls, writes, sources, bytes, sizes, formats and exports are settings
enforced in `execute` and the upload path (`packages/core/src/public-sandbox.ts`). The daily reset
holds the sandbox's lock alone, drops its pending jobs and puts the baseline back. A visitor's
mockup page has a mockup page's rules, with no script budget: the budget is no control (above),
and the cap on what one field holds (200,000 characters by default) already bounds a page, and
the daily writes bound how many.

**Secrets, logs and delivery.** Configuration comes from the environment (`config.ts`); secrets
live in Secret Manager or Key Vault (`deploy/cloud-run/setup.sh`, `deploy/azure/containerapp.yaml`),
and the runtime identity reaches only the files bucket, its secrets and its database. Without a mail
provider, email links are off rather than logged, and production refuses to start with a mailer
that would print them or deliver nothing (`WHATBUILD_MAILER` other than `smtp` or `none`), or with
one it does not know (`config.ts`). Log lines hold method, masked path, status and time, never
bodies, query strings or headers: the path's ids are masked, and so are the two links that are
credentials themselves, `/invite/:token` and `/join/:code`. An unexpected error answers `500`
without detail (`app.ts`). Emails show a sender's chosen name on one line, quoted and bounded
(`quotedName`). The web app's files are served only from inside their folder (`insideRoot`).
`pnpm fixture pull` gives `pg_dump` the password in `PGPASSWORD`, and reads only the rows of the organizations it copies ([copying an organization](../operations/copying-an-organization.md)). The image is built from an allow-list (`.dockerignore`) and runs as `node` with
`NODE_ENV=production`; a server started without it is production all the same. CI gives pull requests a read-only token; production moves only on an
approved release ([decision](../decisions/production-runs-releases-after-approval.md)). The Worker
(`deploy/cloudflare/worker.js`) sets `X-Forwarded-Host`, which `site.ts` uses only to pick a page.

**Accepted, by decision.** An agent acts with its person's full role, made visible by attribution
and declared authorship ([decision](../decisions/attribution-and-declared-authorship.md)). A page
may link anywhere, open new tabs and navigate its own frame. Sandbox visitors see and change each
other's work until the reset, and each visitor's agent reads what the others wrote, through a
connector that reaches the sandbox alone; a private copy of the sandbox for each visitor is
planned ([roadmap](../spec/10-roadmap.md)). These trade-offs are deliberate; each names what would change it:

- In invite-only mode the sign-in form tells an address that it may not sign up (`403
  invite_only`, [§6.2](../spec/06-operations-and-adapters.md)), and adding someone grants an
  existing account at once but sends an invitation otherwise ([§3.5](../spec/03-accounts-teams-and-identity.md)):
  both say whether an address has an account or an invitation, for a message people can act on.
- Two refreshes of one agent connection at the same moment end it, as any reuse of a refresh token
  does ([§3.8](../spec/03-accounts-teams-and-identity.md)).
- The limit on agent registrations is counted for the whole deployment, because behind the edge
  the service has no client address it can trust; per-client limits wait for one
  ([roadmap](../spec/10-roadmap.md)).
- The limit on concurrent URL fetches is counted per instance; a deployment runs one.
- PDFs open inline on the app's origin, since browsers will not render a sandboxed PDF; serving
  page HTML and uploaded files from a separate origin is planned ([roadmap](../spec/10-roadmap.md)).
- A prototype's address is a grant in a URL, unlike every other grant, because a frame sends no
  header and relative addresses must carry it. It reads one immutable version, names nobody and
  lasts 8 hours; a prototype can send its own address away (a popup may open any URL), and with it
  only what it already holds, and the platform's request logs keep it as they keep invitation
  links. A prototype's scripts may use `eval`, which reaches nothing their own code cannot.
- Prototypes are served from the app's origin until a content site is set, as every Story and
  mockup page is: a browser bug that escapes the sandbox would land on the app's origin
  ([decision](../decisions/mockups-carry-prototypes-served-from-a-capability-path.md),
  [roadmap](../spec/10-roadmap.md#planned--mockups-prototypes-next)).
- Files are parsed one at a time, each for at most the parse time limit, so one person's uploads
  can delay another's parsing; a budget per sandbox visitor is planned ([roadmap](../spec/10-roadmap.md)).
