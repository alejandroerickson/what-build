---
type: Specification
title: Accounts belong to tenants, tenants hold teams, teams run products, and one role check decides every call.
description: The account → tenant → team → product hierarchy, sign-in, roles and what they grant, addressing and isolation, moving sources between products, caller identity, attribution, and who is who in the public sandbox.
tags: [spec, accounts, tenancy, roles, identity, oauth, isolation, sandbox]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# 3. Accounts, tenants, teams, products, roles

Roles are resolved in one policy module
([`packages/core/src/policy.ts`](../../packages/core/src/policy.ts)) that both front doors go
through; identity lives in [`apps/server/src/auth`](../../apps/server/src/auth). The schema is in
[`0001_init.sql`](../../apps/server/src/migrations/0001_init.sql).

## 3.1 The hierarchy

```
account              one person's sign-in; may belong to several tenants
tenant               an organization: the isolation and (later) billing boundary
└── team             a group of people and the products they run
    └── product      one discovery
        ├── outcomes
        ├── sources      records → files → derivations → segments; notes
        ├── assumptions  (the register)
        ├── mockups      versions, pages, files
        ├── Story        pages, versions, hierarchy
        ├── lineage
        └── activity     append-only event log
```

- Every object belongs to exactly one product (`product_id`), every product to one team, every team
  to one tenant. Every content row also carries `tenant_id`, which is what isolation keys on.
- **References never cross products.** A citation, link or reference to another product's object is
  refused with `422 cross_product_reference`, which keeps a product exportable as a closed bundle.
- **Moving and copying** a source between products is allowed **within one team**
  ([§3.7](#37-moving-and-copying-between-products)).
- In the UI the tenant is called the **organization**. The API and MCP say `tenant`.
  ◆ Decision: two words for one concept is a known cost; see open question 8 in the
  [roadmap](10-roadmap.md).

## 3.2 Accounts and sign-in

| Field | Rule |
|---|---|
| `account_id` | ULID, immutable. |
| `email` | Unique (case-insensitive), verified by the sign-in itself. |
| `display_name` | 1–100 chars. Appears in attribution. |

Sign-in methods, each optional per deployment:

- **Email link** — a single-use link valid 15 minutes, at most five per address per hour. Opening
  it (`GET /auth/verify?token=…`) changes nothing: mail scanners fetch every link in a message,
  so it answers a page that names the address and has one button, Sign in, whose form posts the
  link back (`POST /auth/verify`). That POST is what uses the link and signs in, and only from the
  app's own origin: one whose `Origin` is another site's, or `null`, answers
  `403 forbidden_origin` and leaves the link unused, so no other site can sign someone in to an
  account of its choosing. It answers `303` to `next`; a link that is unknown, used or expired
  goes to `/signin?error=link_expired`, from either request. Pressed several times at once, it
  signs in one of them. The page is server-rendered, never framed or cached, sends no referrer
  off its origin, and loads nothing. A server with no mail provider disables the method rather
  than log a link; in development the console mailer prints it, and a production server refuses
  to start with any mailer but `smtp` or `none`.
- **Google** — OpenID Connect, when a client id and secret are configured.
- **Microsoft work accounts** — OpenID Connect against one Microsoft Entra directory, when the
  directory, a client id and a secret are configured ([below](#sign-in-with-microsoft-work-accounts)).
- **Development** — "sign in as" an email, only when `NODE_ENV` is exactly `development` or
  `test` and `WHATBUILD_DEV_AUTH` is not `0`. Any other `NODE_ENV`, or none, is production
  ([local development](../operations/local-development.md#development-and-production)).

There is no password. First sign-in creates the account; every invitation addressed to that email
is accepted at once, because the verified address is the proof.

Every method returns to `next`, the path the person was on, only when it is a path on this origin:
one with a scheme or host, a backslash, whitespace or a control character, an encoded slash,
backslash, percent sign or control character in its path, or a path that normalizes to begin
with `//`, returns to `/` instead (`safeNext`,
[`packages/core/src/safe-next.ts`](../../packages/core/src/safe-next.ts)). The web app's sign-in
page applies the same function to the `next` it navigates to, so a person already signed in, or
signing in with the development sign-in, never leaves the origin either. Request bodies to
`/auth/*` are limited to 64 KB (`413 too_large`).

An invitation link (`/invite/:token`, `POST /api/v1/invitations/accept`) is single-use, lasts
7 days, and works only for the account whose email is the invited address, ignoring letter case
(◆ [decision](../decisions/invitations-belong-to-their-address.md)). Opened by any other account it
answers `403 invitation_wrong_address` with the invited address masked, and stays unused. Because
signing in with the invited address already accepts it, the link usually arrives accepted by that
same person: that answers with the invitation's role and `already: true`, not an error. Opened by a
different account once used, it answers `410 invitation_used`; expired or cancelled,
`410 invitation_expired`; an unknown token, `404`.

**Invite-only mode.** `WHATBUILD_SIGNUP_ALLOWLIST` (emails and `@domains`) limits who may create an
account. Existing accounts, invited addresses, the instance's owners and addresses with an
allowance above 0 to create organizations ([§3.3](#33-tenants-and-teams)) always may. Staging runs invite-only until public
sign-up opens ([§10 Phase 6](10-roadmap.md)).

**An invitation to the public sandbox** ([§3.10](#310-the-public-sandbox)) also lets an address
create an account in invite-only mode, when the sign-in is returning to the invitation's link
(`next` is `/join/<code>`) and the invitation still has a place. The check is made when the link
is asked for and again when it is followed, since an invitation can fill in between. An account
created this way is marked `sandbox_only`.

**A `sandbox_only` account is for the sandbox.** The mark brings the sandbox's limits to the calls
it makes outside any organization ([§9.7](09-data-lifecycle.md)). Like every account, it creates
organizations only as far as its allowance lets it ([§3.3](#33-tenants-and-teams)).

### Sign-in with Microsoft work accounts

A deployment
inside a Microsoft organization signs its people in with their work accounts
([Azure guide](../operations/azure.md#sign-in)). It is a third built-in method beside the email
link and Google, of the same shape as Google's, sharing its code flow
([`auth/routes.ts`](../../apps/server/src/auth/routes.ts)), and it changes nothing about sessions,
invitations, admission or the OAuth server for agents.

**Configuration.** Three settings, and the method is on only when all three are set, and a
fourth that is optional:

| Variable | Value |
|---|---|
| `WHATBUILD_MICROSOFT_TENANT` | The directory's ID, a GUID. The server MUST refuse to start on any other value (`common`, `organizations`, `consumers`, a domain name). |
| `WHATBUILD_MICROSOFT_CLIENT_ID` | The app registration's application (client) ID. |
| `WHATBUILD_MICROSOFT_CLIENT_SECRET` | One of its client secrets. |
| `WHATBUILD_MICROSOFT_DOMAINS` | Optional: email domains the directory is trusted for, separated by commas (`contoso.com,contoso.co.uk`; a leading `@` is allowed). Each is matched exactly, so a subdomain is listed on its own. The server MUST refuse to start on a value that is not a domain. |

The app registration is a single-tenant web application whose redirect URI is
`<WHATBUILD_PUBLIC_URL>/auth/microsoft/callback`, with the optional claims `email` and `xms_edov`
in its ID token. The directory may be a workforce directory or an Entra External ID one; guests
invited to it sign in through it, and their tokens carry its `tid`.

**Flow.** `GET /auth/microsoft?next=<path>` and `GET /auth/microsoft/callback`: the authorization
code flow with PKCE (`S256`) and a random `state`, both kept with the safe `next` in the `HttpOnly`
cookie `wb_oidc`, scoped to `/auth/microsoft`, for ten minutes. The endpoints are the directory's
own, `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize` and `…/token`; the scope
is `openid email profile`; `prompt=select_account`. A request to `/auth/microsoft` on a server
without the method answers `404`.

**What the callback accepts.** The ID token arrives from the token endpoint over TLS, so its
claims are read as issued, as Google's are. The callback MUST refuse the sign-in unless:

- `aud` is the client ID,
- `tid` is the configured directory, and `iss` is
  `https://login.microsoftonline.com/<tenant>/v2.0`,
- there is an address whose domain is verified, the first of:
  1. the `email` claim, when `xms_edov` is true: Entra's word that the domain's owner verified it
     (the domain is verified in the directory the account belongs to, or the address is a
     Microsoft or Google account's, or one a one-time passcode proved);
  2. the `email` claim, when its domain is one `WHATBUILD_MICROSOFT_DOMAINS` lists;
  3. `preferred_username`, the user principal name, when it has the form of an email address and
     its domain is one `WHATBUILD_MICROSOFT_DOMAINS` lists.

Entra issues no `email_verified` claim, and an app registration in one directory keeps addresses
with unverified domains in its tokens. A directory's administrators can give one of its people
any `email` attribute, someone else's address included, so an address is taken from the
directory only on its domain's evidence: Entra's `xms_edov`, or this deployment's statement that
the directory is the authority for that domain. With neither (the claim not configured and no
domains listed), every Microsoft sign-in is refused. The server MUST NOT accept a token from any
other directory, and MUST NOT offer a mode that admits many.

A refusal for a missing or mismatched claim, or an address without that evidence, redirects to
`/signin?error=microsoft_unverified`; a
missing cookie, a wrong `state`, a missing `code` or a failed token request, to
`/signin?error=microsoft_failed`. An accepted sign-in then does exactly what the others do:
admission (invite-only mode, invitations, a sandbox invitation), `findOrCreateAccount` with the
address and the `name` claim, acceptance of the invitations addressed to it, a session, and a
redirect to `next`.

**What reports it.** `GET /auth/methods` and the `auth` object of `GET /api/v1/meta` each gain
`microsoft: boolean`, true when the method is on.

**The sign-in screen** ([§7](07-web-app.md)) offers the method as it offers Google: a link to
`/auth/microsoft?next=…`. Its message for a failed sign-in MUST NOT point to the email link on a
deployment that has none.

◆ Decision: a named method bound to one directory, not a general OpenID Connect setting, because
what makes an address trustworthy differs between providers (Google says `email_verified`; Entra
says `xms_edov` only when asked for it, and a deployment may vouch for its directory's domains),
and a general setting could not know.

◆ Decision: an address from the directory needs its domain's evidence, `xms_edov` or a listed
domain, and is refused without it, rather than taken on the directory's word alone: a directory
admits the people its administrators choose, but only the owner of a domain decides who holds an
address in it, and an account in WhatBuild is its address.

◆ Decision: accounts stay keyed by address, as for every other method; the directory's object ID
(`oid`) is not stored. An address the directory gives to a different person later reaches the
earlier person's account, which is equally true of an email link.

*Accept* (`apps/server/test/microsoft-sign-in.test.ts`): with the token endpoint stubbed, server
tests show a sign-in creating an account and accepting its invitations; each refusal above (`aud`,
`tid`, `iss`, no address, wrong `state`); an address outside the listed domains refused whether
`xms_edov` is false or absent, taken when it is true, an address in a listed domain taken without
it, and the user principal name taken only in a listed domain; invite-only mode refusing an
address outside the allowlist; `404` when not configured; start-up refusing a tenant that is not a
GUID and a listed domain that is not a domain; and `microsoft` reported by both endpoints.

## 3.3 Tenants and teams

| Object | Fields |
|---|---|
| Tenant | `tenant_id`, `slug` (3–50, `[a-z0-9-]`, globally unique), `name`, `plan` (`free`), `status` |
| Team | `team_id`, `tenant_id`, `slug` (unique in the tenant), `name`, `archived_at` |

Creating a tenant (`products.create_tenant`) creates its first team and makes the creator the
tenant's **owner**. A new user's first-run flow is: name the organization, name the first product
and its product concept.

**Who may create a tenant** (◆ [decision](../decisions/only-instance-owners-decide-who-creates-organizations.md)):

- **The instance's owners**, the addresses in `WHATBUILD_INSTANCE_OWNERS`, create any number.
  Nothing else makes someone an instance owner: a tenant owner is not one.
- **Everyone else creates as many as their allowance**, counted against the tenants their account
  created (`tenants.created_by`). The tenants they belong to, however they came to belong, never
  count and never give an allowance. An allowance belongs to an address
  (`tenant_allowances`), like an invitation, so it can be given before the account exists, and an
  allowance above 0 lets that address sign up while sign-up is limited ([§3.2](#32-accounts-and-sign-in)).
- **An address without one has the deployment's default**, `WHATBUILD_TENANT_ALLOWANCE`, which is 0.
- Over it, `products.create_tenant` answers `403 tenant_allowance` with `allowed` and `created`.
  The check holds a lock on the account for the transaction, so two creations at once cannot both
  take the last place.
- Only instance owners read and change allowances: `products.tenant_allowances`,
  `products.set_tenant_allowance` (guarded by the row's etag once it exists; with `notify`, an
  address whose allowance grows is emailed a link to `/welcome`) and
  `products.remove_tenant_allowance`, which returns an address to the default. These belong to no
  tenant, so they write no activity event; each row keeps who gave it and who last changed it.
  `GET /api/v1/me` returns the caller's own `tenant_allowance`.
- Taking an allowance away or lowering it never touches the tenants already created.

## 3.4 Products

| Field | Rule |
|---|---|
| `product_id` | ULID, immutable. |
| `slug` | 3–50 chars, unique in the team. Mutable. |
| `name` | 1–100 chars. |
| `concept` | The product concept: Markdown, ≤ 2,000 chars, heads the Idea screen; overwrites keep revisions. |
| `archived_at` | Archived products are hidden from lists and read-only (`409 product_archived`) until restored. |

A product is addressed as `tenant/team/product` (slugs or ids at each level) or by `product_id`.

## 3.5 Roles

| Level | Roles | What the role grants |
|---|---|---|
| Tenant | `owner`, `admin`, `member`, `visitor` | owner and admin: admin of every team and product in the tenant; owner: tenant lifecycle. member: nothing by itself. visitor: editor of every product, in the public sandbox only ([§3.10](#310-the-public-sandbox)) |
| Team | `admin`, `editor`, `viewer`, `reader` | the same role on every product in the team |
| Product | `admin`, `editor`, `viewer`, `reader` | that product only |

- **Reader** reads only the Story: its pages, every version of them, the hierarchy, and the print
  view to export it (◆ [decision](../decisions/a-reader-reads-only-the-story.md)). These
  operations, and `products.get`, declare the access level `story` (`products.list` lists every
  product the caller holds a role on); every
  other product operation needs viewer and answers a reader `403` ("You are a reader on product
  Crewboard; sources.list needs viewer"), and so do a source's file, an export's file, a Story
  style specimen and a mockup's page. A reader's Story reads leave out `refs`, `resolved_refs`,
  `citations`, `citation_count` and `agent_notes`, and of a page promoted from a mockup keep only
  its size; their product reads leave out `concept` and count only `story_pages`. A page's HTML is
  served to a reader exactly as published, and a promoted mockup page through the Story's own
  route, so a reader sees that page and nothing else of the mockup ([§4.11](04-data-model.md)).
  Someone who reads only the Story everywhere in an organization (a reader on its teams or
  products, with nothing higher there and no organization role but member) sees none of its
  people: `members.list` answers `403`, and `products.list` marks that organization
  `story_only`. A reader writes nothing: the upload relay checks the role of whoever requested a grant again
  when the bytes arrive, so a grant given to an editor stores nothing once they are a reader.
- **Viewer** reads everything in the product. **Editor** also writes: sources, files, notes,
  outcomes, assumptions and reviews, mockups, the Story, and permanent deletes of sources
  (guarded, [§9.5](09-data-lifecycle.md)). **Admin** also manages the product (rename, archive) and
  its people. Creating a product needs admin of its team (tenant owners and admins are admins of
  every team); creating a team needs tenant admin.
- **The effective role is the highest that applies.** A product grant can raise access but never
  lower an inherited one. ◆ Decision: no negative overrides — they make "who can see this?"
  unanswerable at a glance.
- **Visibility:** with no role on a product, the product does not exist for you: `404`, never
  `403`, from every operation. With a role too low for an action, `403` names the role you have
  and the one needed ("You are a viewer on product Crewboard; outcomes.create needs editor").
- **Membership administration:** admins grant and revoke where they are admin: product admins on
  their product, team admins on their team, tenant admins on the tenant, and only owners grant
  owner or change or remove an owner's role. Granting someone without an account creates a 7-day
  invitation, emailed where mail is configured and always returned to the inviter as a
  single-use link. The email shows the inviter's display name on one line, without control or
  direction-changing characters, at most 60 characters and in quotation marks, and says it is the
  name they gave WhatBuild. A tenant keeps at least one owner (`409 last_owner`).
- **Who sees whom.** The tenant's owners and admins see all its people, their grants and its
  invitations. Anyone else, with a viewer role or above somewhere in it, sees only the people on
  the teams and products they read, with only those grants and their tenant role, and only the
  invitations they could cancel, where they are admin (`members.list` says `partial: true`). A
  team or product they have no role on stays hidden there too: the `members` operations answer it
  with the same `404` as one that does not exist.
- **Being in a tenant** means holding at least one grant in it: a tenant role, or a role on one of
  its teams or products. A tenant `member` grant adds nothing to that by itself. Revoking a person's
  last grant takes them out of the tenant; `members.revoke` with `whole_tenant` removes every grant
  at once.
- ◆ Decision: reviewing (confirm, refute) is an editor right; there is no separate reviewer role.
- ◆ Decision: every role but reader can read the product's activity log.

## 3.6 Addressing and isolation

The addressed tenant, team and product are always explicit. Nothing on the server remembers a
"current" product.

| Surface | Addressing |
|---|---|
| Web | `/t/<tenant>/<team>/<product>/<screen>` |
| REST | `/api/v1/p/<tenant>/<team>/<product>/…` for product operations; `/api/v1/teams/<tenant>/<team>/…`, `/api/v1/tenants/<tenant>/…` and `/api/v1/…` for the rest |
| MCP | `/mcp` for everything the account can reach; `/mcp/t/<tenant>` scoped to one organization; `/mcp/t/<tenant>/<team>/<product>` scoped to one product |

On MCP a product-scoped call resolves its product in this order: the `product` argument (an id or
`tenant/team/product`); the product the endpoint is scoped to; the only unarchived product the
caller can reach inside the endpoint's scope; otherwise `422 product_required` listing those
products ([`apps/server/src/mcp.ts`](../../apps/server/src/mcp.ts)). Every product-scoped MCP
result echoes `scope` (tenant, team, product, `your_role`) so an agent and the person reading its
transcript can see where a write landed.

**A scoped endpoint is a fence, not a default**
(◆ [decision](../decisions/a-scoped-mcp-connector-is-a-fence.md)). Whatever roles the person holds
elsewhere, a call through `/mcp/t/<tenant>` or `/mcp/t/<tenant>/<team>/<product>` that lands
outside it is refused with `403 outside_connector_scope` before any handler runs
([`connector-scope.ts`](../../packages/core/src/connector-scope.ts)), and the message names the
scope. A person who works in several organizations adds one connector per organization in their
agent and turns off the ones they are not using; for everything at once there is the unscoped
`/mcp`.

| Through | Answers | Refuses |
|---|---|---|
| an organization's endpoint | every product, team and tenant operation in that organization; `products.list` (narrowed to it), `get_skill`, `submit_feedback` | another organization; the other account-level operations (`products.create_tenant`, `sandbox.join`, the instance's allowances) |
| a product's endpoint | that product's operations; `products.list` (narrowed to it); `sandbox.status` for its organization; the account reads above | every other product; team and tenant operations (`members.*`, `products.create`, `products.create_team`, the sandbox's control panel); moving or copying a source to another product |

The scope is resolved for the caller on the first tool call; an endpoint naming an organization or
product they cannot reach answers `404` to every call, saying so.

Isolation is enforced three times:

1. **Authorization** resolves the caller's role for the addressed product, or answers `404`. It runs
   before input validation on both doors, so a non-member learns nothing — not even whether their
   input was valid. Over MCP a connector's fence also applies first; only a call that names no
   product, team or tenant at all, and so addresses nothing to hide, is told its input is malformed
   before it is told to name one (`apps/server/test/mcp.test.ts`).
2. **The core** receives a transaction already scoped to one tenant; handlers never see another.
3. **Postgres row-level security** on every content table keys on the transaction-local setting
   `app.tenant_id`, so a query that escaped the first two layers still returns nothing. The server
   refuses to start in production as a database role that bypasses row-level security, and warns
   elsewhere.

Blob keys begin `t/<tenant_id>/…`. A test ([`apps/server/test/access.test.ts`](../../apps/server/test/access.test.ts))
calls **every** product, team and tenant operation as someone with no membership and requires
`404` from each. [`tenant-isolation.test.ts`](../../apps/server/test/tenant-isolation.test.ts)
classifies every registered operation and calls each over REST and MCP as a member of another
organization, both at the other organization's address and from the caller's own with the other's
real ids, and requires a refusal, none of the other's data in the answer, and every one of its rows
unchanged; a new operation fails it until it is classified.
[`row-level-security.test.ts`](../../apps/server/test/row-level-security.test.ts) reads the
migrated schema and requires forced row-level security and a policy on the current tenant for
every table with `tenant_id`, except the directory tables it lists with their reasons.

## 3.7 Moving and copying between products

- **Copy** (`sources.copy_to_product`): a new record id in another product of the same team, with
  `copied_from`; files are shared (blobs are immutable) and parsed afresh in the target.
- **Move** (`sources.move_to_product`): keeps the record id, files, derivations and notes. Refused
  with `409 source_in_use` while anything in the current product cites or references the source
  (assumptions, views' lineage, related sources, the current version of a Story page or a
  mockup), listing what does, because references never cross products. Both products log the move.
- Both need editor on the source's product and on the target. Moving assumptions, outcomes,
  mockups and Story pages is planned, with the same closure rule.

## 3.8 Identity of the caller

| Surface | Credential | Recorded surface |
|---|---|---|
| Web | Session cookie, 30 days by default (`WHATBUILD_SESSION_DAYS`, reported as `session_days` by `GET /auth/methods`), `HttpOnly` and `SameSite=Lax`: `__Host-wb_session` (`Secure`, `Path=/`, no `Domain`) when the public URL is HTTPS, `wb_session` over HTTP in local development; cookie writes must come from the app's own origin | `web` |
| MCP | OAuth 2.1 access token issued by WhatBuild for its MCP endpoint | `mcp` |
| Upload relay | A signed, single-file grant; the file is attributed to whoever requested the grant | as requested |
| Job worker | none — internal | none; the actor is `WhatBuild` (system) |

**The session cookie's name.** The `__Host-` prefix makes a browser accept the cookie only from
the app's own host, over HTTPS, for the whole path: no other host under the same parent domain
(the public site's, for one) can set a cookie of that name. A session issued before the cookie
took the prefix (`sessions.legacy_cookie`, set by migration `0018` on every row there was) arrives
as `wb_session`; over HTTPS it is still taken under that name until it expires, at most
`WHATBUILD_SESSION_DAYS` after it was issued, and the response moves it to `__Host-wb_session` for
its remaining time and clears `wb_session`, so nobody is signed out by the change. A session
issued since is never taken under the old name. When both names arrive, the new one is the
session. Signing in over HTTPS clears `wb_session`; signing out ends the session under either
name and clears both ([`apps/server/src/auth/identity.ts`](../../apps/server/src/auth/identity.ts)).

**OAuth for agents.** WhatBuild is its own authorization server: protected-resource metadata
(RFC 9728) at `/.well-known/oauth-protected-resource/mcp`, authorization-server metadata (RFC 8414),
dynamic client registration (RFC 7591), authorization code with PKCE S256, resource indicators
(RFC 8707) limited to the MCP endpoint, one-hour access tokens and rotating 30-day refresh tokens
(both configurable; reusing a rotated refresh token revokes the whole connection)
([`apps/server/src/auth/oauth.ts`](../../apps/server/src/auth/oauth.ts)). A code is exchanged, and
a refresh token rotated, once: of requests that arrive together one succeeds, and a second use,
even a concurrent one, is reuse. A code's exchange is one transaction that records the connection
it made (`oauth_codes.family_id`), and a code presented again revokes that connection, as a
reused refresh token revokes its own ([RFC 6749 §4.1.2](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2)).

**What Allow approves is what the consent page showed.** The page's form carries the request
back (client, redirect URI, code challenge, `state`, resource), and the `HttpOnly`,
`SameSite=Strict` cookie `wb_consent` holds the form's token with a seal over those fields and
the signed-in account, an HMAC-SHA256 keyed with `WHATBUILD_GRANT_KEY`. A form whose fields
differ from what the page showed (a wider resource, another code challenge, another `state` or
client), or posted by another account, answers `400` on WhatBuild's own page, and nothing reaches
the client.

The consent page tells the person the agent will act as them, what it can reach (everything, one organization or one
product, named), and that the passages it reads go to whoever runs the agent. Any
MCP client registers itself, so no client is configured in advance, and any client may call
itself anything: the consent page shows the name in quotation marks as the name the agent gave
itself, which WhatBuild has not verified, and says where Allow hands the connection, the redirect
URI's host for `https`, or "an app on this computer" for loopback `http` and private-use schemes.
The consent page's security policy
allows its form to reach only WhatBuild and that client's registered callback, the one place Allow
and Deny redirect to. Nothing reaches that callback before the person chooses: an authorization
request in error (a response type other than `code`, no PKCE S256, a resource that is not an MCP
endpoint) answers `400` on WhatBuild's own page, naming the OAuth error, signed in or not
([RFC 9700 §4.11.2](https://www.rfc-editor.org/rfc/rfc9700#section-4.11.2)).

Registration is bounded, since anyone may register: at most 10 redirect URIs of at most 500
characters (`400 invalid_redirect_uri`), and a name of at most 100 characters, with control and
format characters removed. At most 50 registrations an hour may be waiting for their first
connection; past that, registration answers `429 rate_limited` with `Retry-After`, and a
registration that led to a connection stops counting. A registration that never led to a
connection is removed after seven days; one that ever did is kept. Request bodies to `/oauth/*`
are limited to 64 KB (`413`, `invalid_request`).

A
token is the person: it never widens what they can do. It is bound to the resource it was approved
for, which must be one of the MCP endpoints (`invalid_target` otherwise), and serves that endpoint
and the ones inside it only: a token approved for `/mcp/t/acme` works on `/mcp/t/acme` and on
Acme's product endpoints, and answers `401` on `/mcp` and on any other organization. A refresh
keeps the resource. Connected agents are listed, each with what it can reach and who holds the
connection (the hosts of its client's redirect URIs, or an app on the person's computer), and
disconnected on the Connect an agent page.

**No personal access tokens.** REST answers the web app's session only, and refuses any bearer
token; an agent connects over MCP with OAuth, so every agent connection is one a person approved in
a browser and can see and disconnect ([decision](../decisions/built-in-identity-and-oauth.md)).
Activity written through REST by earlier token holders keeps its recorded surface, `rest`.

## 3.9 Attribution

Every mutation stores an actor snapshot — `{ account_id, display_name, surface, client }` — copied,
not joined, so attribution survives renames and removals. `client` is the OAuth client's name. It never holds an email address.

Authenticated identity says which account wrote; it does not say whether a person exercised
judgment, because an agent writes with its person's credentials. Assumptions and reviews
therefore carry a declared `author_type` / `reviewer_type` (`human` or `agent`), defaulting to
`human` in the web app and `agent` everywhere else, and a human confidence rating is accepted only
from a declared human reviewer ([§4.8](04-data-model.md)).

## 3.10 The public sandbox

A deployment may name one organization as its **public sandbox**: a place anyone holding an
invitation may work in, to try WhatBuild on a worked example
(◆ [decision](../decisions/the-public-sandbox-is-one-organization-with-pseudonymous-visitors.md)).
The limits on what is done there, the baseline and the reset are in
[§9.7](09-data-lifecycle.md); the operations are in [§6](06-operations-and-adapters.md).

**Which organization.** `WHATBUILD_SANDBOX_TENANT` holds its slug. At start-up the server sets
`tenants.sandbox` on that organization and clears it on every other
(`syncSandboxTenant`, [`apps/server/src/public-sandbox.ts`](../../apps/server/src/public-sandbox.ts)). A slug
that matches no organization makes none a sandbox, and the server says so in its log. The
`sandbox` operations answer `404` in an organization that is not one.

**Staff and visitors.** The organization's owners and admins are its **staff**: they work under
their own names, administer as anywhere else, and meet none of the sandbox's limits. **Everyone
else in the organization is a visitor**, whatever role they hold.

| A visitor | How |
|---|---|
| edits every product | The tenant role `visitor` gives editor on every team and product in the organization. |
| administers nothing | In a sandbox a role stops at editor for anyone but staff (`effectiveRole`), so every operation that needs admin answers `403`, and so do the `members` writes. |
| writes under a made-up name | `Visitor ` and six hexadecimal digits, from a SHA-256 of the tenant and account ids (`visitorName`). `execute` puts it in the actor snapshot and hides the account's own name and address from the handler. |
| sees no other person | `members.list` returns the caller alone, under the made-up name, with no address and no invitations. |
| cannot delete permanently | `sources.delete` answers `403 sandbox_restricted`. Archive remains. |
| meets the limits | [§9.7](09-data-lifecycle.md). |

Because attribution is a copied snapshot ([§3.9](#39-attribution)), a visitor's name and address
are never written into the organization's rows: not in an author, not in the activity log, not in
a baseline. The account id is kept, as everywhere; it is how staff find the person behind a
made-up name (`sandbox.visitors`).

**The role fails closed.** `membershipsFor` leaves out a `visitor` grant whose tenant is not a
sandbox. Taking `WHATBUILD_SANDBOX_TENANT` away and restarting therefore takes every visitor's
access with it, and naming the organization again gives it back.

**Staff see visitors as a count.** For staff, `members.list` lists the organization's own people
and gives `sandbox.visitors` as a number; `sandbox.visitors` lists them a page at a time, with
name, address and made-up name.

**Invitations.** A sandbox invitation (`sandbox.create_invite`) is a link, `/join/<code>`, with a
number of **places** and an optional expiry. Whoever holds it may take a place by signing in, with
any address: it is a bearer credential, unlike an invitation to an ordinary organization
([§3.2](#32-accounts-and-sign-in)). Only the hash of the code is stored, so the link is shown once.
`sandbox.join` answers:

| Answer | When |
|---|---|
| `200`, `already: false`, `role: "visitor"` | A place was taken and a seat given. |
| `200`, `already: true` | The caller is in the organization already. They keep their role, and no place or seat is used. |
| `404` | No such code, or its organization is not a sandbox. |
| `410 invite_revoked`, `invite_expired`, `invite_used_up` | The invitation admits nobody else. |
| `409 sandbox_full` | Every seat (`max_visitors`) is taken. `details` holds `quota`, `limit`, `used`. |
| `403 sandbox_closed` | `visitor_access` is `closed`. |

Entering writes no activity event, because an event would carry a name.

**Seats.** `max_visitors` caps the visitors the sandbox holds, across every invitation. A visitor
who has neither signed in nor used an agent for `visitor_idle_days` gives up their seat at the
next reset (`0` keeps every seat), and staff remove one with `sandbox.remove_visitor`.

