---
type: Specification
title: Accounts belong to tenants, tenants hold teams, teams run products, and one role check decides every call.
description: The account → tenant → team → product hierarchy, sign-in, roles and what they grant, plans and their limits, addressing and isolation, moving sources between products, caller identity, attribution, and the example organization every account reads.
tags: [spec, accounts, tenancy, roles, identity, oauth, isolation, example, limits]
generated: {by: agent:claude, at: 2026-10-25}
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
tenant               an organization: the isolation boundary
└── team             a group of people and the products they run
    └── product      one discovery
        ├── outcomes
        ├── sources      records → attachments → readings; derived text, summary, notes, comments
        ├── assumptions  (the register)
        ├── mockups      versions, pages, files
        ├── Story        pages, versions, hierarchy
        └── activity     append-only event log
```

- Every object belongs to exactly one product (`product_id`), every product to one team, every team
  to one tenant. Every content row also carries `tenant_id`, which is what isolation keys on.
- **References never cross products.** A link from an assumption to another product's assumption
  is refused with `422 cross_product_reference`, and an outcome of another product is unknown
  (`422 unknown_reference`), which keeps a product exportable as a closed bundle.
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
| `hide_example` | The person hid the example organization from the app's panel ([§3.10](#310-the-example-organization)); `PATCH /api/v1/me` sets it, with or without the display name. |

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

**Letting someone in.** While sign-up is limited, an instance owner lets a waiting person in by
giving their address an allowance ([§3.3](#33-tenants-and-teams)): the same act lets them sign in
and create an organization. The check is made when a sign-in link is asked for and again when it is
followed, since what let the address in can be taken away in between. Every account, once in,
reads the example organization ([§3.10](#310-the-example-organization)).

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

A token whose `aud`, `tid` or `iss` does not match redirects to
`/signin?error=microsoft_wrong_directory&ref=<reference>`; one from the directory with no address
that has that evidence, to `/signin?error=microsoft_no_verified_email&ref=<reference>`; a
missing cookie, a wrong `state`, a missing `code` or a failed token request, to
`/signin?error=microsoft_failed`. Each of the first two writes one warning line to the server's
log (`"event":"microsoft_sign_in_refused"`) with the same reference (eight characters such as
`K7Q2-M9XD`, new for each refusal), the check that failed (`directory` or `email`), which of
`aud`, `tid` and `iss` mismatched or which evidence the token carried, as booleans, how to fix it,
and the guide that explains it
([azure.md](../operations/azure.md#when-microsoft-sign-in-is-refused)). The line MUST NOT hold the
token, an address, a name or any claim's value. The diagnosis changes nothing about what is
accepted. `/signin?error=microsoft_unverified`, which earlier releases sent for both refusals,
still shows a message. An accepted sign-in then does exactly what the others do:
admission (invite-only mode, invitations, allowances), `findOrCreateAccount` with the
address and the `name` claim, acceptance of the invitations addressed to it, a session, and a
redirect to `next`.

**What reports it.** `GET /auth/methods` and the `auth` object of `GET /api/v1/meta` each gain
`microsoft: boolean`, true when the method is on.

**The sign-in screen** ([§7](07-web-app.md)) offers the method as it offers Google: a link to
`/auth/microsoft?next=…`. Its message for a failed sign-in MUST NOT point to the email link on a
deployment that has none. For the two refusals it allows that the server's setup may be at fault,
asks the person to tell whoever runs WhatBuild and shows the reference to give them, and never
sends a person who may be signing in correctly off to find another account. It shows `ref` only
in the server's form, so a crafted link cannot put words on the page.

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
| Tenant | `tenant_id`, `slug` (3–50, `[a-z0-9-]`, starting and ending with a letter or digit, unique across every slug any tenant has or had), its former slugs, `name` (1–100 chars), `name_etag`, `plan` (`free` or `unlimited`), `limits` (what an instance owner changed from the free plan's), `example`, `status` |
| Team | `team_id`, `tenant_id`, `slug` (unique in the tenant), `name`, `archived_at` |

Creating a tenant (`products.create_tenant`) creates its first team and makes the creator the
tenant's **owner**. A new account lands in the example organization ([§3.10](#310-the-example-organization)),
and creates its own when ready: name the organization, then name the first product and its product
concept.

**Renaming a tenant** (◆ [decision](../decisions/an-organizations-owners-rename-it-and-its-former-slugs-still-reach-it.md)).
`products.rename_tenant` (`PATCH /api/v1/tenants/:tenant`) changes the name, the slug, or both.
Its owners change them, the example organization's included; an admin or a member is refused
`403`, and an agent needs an admin connection. An instance owner changes them in any tenant, as one
of its owners, member or not: the operation sets `allowInstanceOwners`, which lets them in to that
operation alone and gives them no grant. Name and slug share one etag, `name_etag`, which
`products.list` gives every tenant the caller is in and `products.organizations` every tenant; a
change without the current one is refused `409 stale_etag`, a call that names neither `422`, and
one to what the tenant already has writes nothing. A change is recorded in the tenant's access log,
`members.activity` (`renamed`, or `slug_changed` when only the slug changed), with what it was.

- **A slug it had before still reaches it.** The old slug is kept as a former slug
  (`tenant_slugs`), and every address that names a tenant by slug accepts it
  ([§3.6](#36-addressing-and-isolation)). `products.list` and `products.organizations` list a
  tenant's `former_slugs`.
- **No tenant takes a slug another has or had**, by a new slug or at creation, so an old link never
  leads into another organization: `409 slug_taken`. A slug made from a name skips them too. A
  tenant may take back one of its own former slugs, which is then its current one. Slugs change
  under one lock, so two changes at once cannot take the same one.
- **Deleting a tenant frees its slugs**, current and former.

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
  `products.set_tenant_allowance` (guarded by the row's etag once it exists, and refusing one sent
  for an address that has none with `409 stale_etag` and `current_etag: null`; with `notify`, an
  address whose allowance grows is emailed a link to `/welcome`) and
  `products.remove_tenant_allowance`, which returns an address to the default. These belong to no
  tenant, so they write no activity event; each row keeps who gave it and who last changed it.
  `GET /api/v1/me` returns the caller's own `tenant_allowance`.
- Taking an allowance away or lowering it never touches the tenants already created.

**Plans and limits** (◆ [decision](../decisions/free-organizations-meet-limits-that-only-instance-owners-change.md)).
Every tenant has a plan. One created on an allowance gets the plan the deployment names in
`WHATBUILD_NEW_ORGANIZATION_PLAN`, `unlimited` unless it names `free`; one an instance owner
creates is always `unlimited`, and so is every tenant made before plans were read. A self-hosted
deployment leaves the setting out; a deployment open to the public, and local development, name
`free`. `GET /api/v1/me` gives the caller's `new_organization_plan`, the plan an organization they
create would get. On the free plan everyone in the
tenant meets limits on how often and how much they work, its owners included; on the unlimited plan
nobody does. The limits, their defaults and their refusals are in [§9.7](09-data-lifecycle.md).

- Every member reads the tenant's plan and limits, with what they and everyone together have used
  today, with `products.limits` (scope `tenant`, access `any`).
- Only instance owners list every tenant with its plan, people, changed limits and today's use,
  with the deployment's `new_organization_plan` (`products.organizations`), and change a tenant's plan or any of its limits
  (`products.set_limits`): `limits` changes the ones named, `reset_limits` first puts every limit
  back to the free plan's, and once a tenant's limits have been changed the change is guarded by
  their etag (`409 stale_etag` without it, and with one sent for a tenant never changed). A change
  applies to the next call. These belong to no tenant's content, so they write no activity event;
  the tenant keeps who changed its limits last and when.

## 3.4 Products

| Field | Rule |
|---|---|
| `product_id` | ULID, immutable. |
| `slug` | 3–50 chars, unique in the team. Mutable. |
| `name` | 1–100 chars. |
| `concept` | The back of the product concept's card, for agents: Markdown, ≤ 8,000 chars, on who the product is for, their problem and how it solves it; written with `products.update_concept` by editors and admins; overwrites keep revisions ([§4.2.1](04-data-model.md)). |
| `card_html` | The front of the product concept's card, for people: agent-written HTML in the card kit, ≤ 40,000 chars, empty until drawn; heads the Idea screen ([§4.2.1](04-data-model.md)). |
| `archived_at` | Archived products are hidden from lists and read-only (`409 product_archived`) until restored. |

A product is addressed as `tenant/team/product` (slugs or ids at each level) or by `product_id`.

## 3.5 Roles

| Level | Roles | What the role grants |
|---|---|---|
| Tenant | `owner`, `admin`, `member`, `guest` | owner and admin: admin of every team and product in the tenant; owner: tenant lifecycle (renaming the organization, deleting it). member: nothing by itself. guest: viewer of every product, in the example organization only, never stored and refused every write ([§3.10](#310-the-example-organization)) |
| Team | `admin`, `editor`, `viewer`, `reader` | the same role on every product in the team |
| Product | `admin`, `editor`, `viewer`, `reader` | that product only |

- **Reader** reads only the Story: its live pages, every version of them, the hierarchy, and the
  print view to export it; an archived page is left out of their lists and print view and answers
  them `404` by its address (◆ [decision](../decisions/a-reader-reads-only-the-story.md)). These
  operations, and `products.get`, declare the access level `story` (`products.list` lists every
  product the caller holds a role on); every
  other product operation needs viewer and answers a reader `403` ("You are a reader on product
  Crewboard; sources.list needs viewer"), and so do a source's attachment and text, an export's
  file, a Story style specimen and a mockup's page. A reader's Story reads leave out `agent_notes`, and of a page
  promoted from a mockup keep only its size; their product reads leave out `concept` and count only `story_pages` (and `stage_counts.story`). A page's HTML is
  served to a reader exactly as published, and a promoted mockup page through the Story's own
  route, so a reader sees that page and nothing else of the mockup ([§4.11](04-data-model.md)).
  Someone who reads only the Story everywhere in an organization (a reader on its teams or
  products, with nothing higher there and no organization role but member) sees none of its
  people: `members.list` answers `403`, and `products.list` marks that organization
  `story_only`. A reader writes nothing: the upload relay checks the role of whoever requested a grant again
  when the bytes arrive, so a grant given to an editor stores nothing once they are a reader.
- **Viewer** reads everything in the product. **Editor** also writes: sources, their attachments
  and text, comments, outcomes, assumptions and reviews, mockups, the Story, and archives any of them. **Admin** also
  deletes permanently, anything that can be archived and the product itself (guarded,
  [§9.5](09-data-lifecycle.md)), and manages the product (rename, archive) and its people.
  Creating a product needs admin of its team (tenant owners and admins are admins of every team);
  creating a team needs tenant admin. Renaming the organization needs its owner, or an instance
  owner ([§3.3](#33-tenants-and-teams)); deleting it needs its owner, in the web app.
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
- ◆ Decision: permanent delete is an admin right; there is no separate delete permission. An
  editor archives ([decision](../decisions/archive-by-default-delete-guarded.md)).
- ◆ Decision: every role but reader can read the product's activity log.

## 3.6 Addressing and isolation

The addressed tenant, team and product are always explicit. Nothing on the server remembers a
"current" product.

| Surface | Addressing |
|---|---|
| Web | `/t/<tenant>/<team>/<product>/<screen>` |
| REST | `/api/v1/p/<tenant>/<team>/<product>/…` for product operations; `/api/v1/teams/<tenant>/<team>/…`, `/api/v1/tenants/<tenant>/…` and `/api/v1/…` for the rest |
| MCP | `/mcp` for everything the account can reach; `/mcp/t/<tenant>` scoped to one organization; `/mcp/t/<tenant>/<team>/<product>` scoped to one product |

A tenant is named by its id, its slug, or a slug it had before ([§3.3](#33-tenants-and-teams)),
everywhere: a REST path, MCP's `product` and `tenant`, a scoped endpoint's address and its OAuth
resource, and the web app's addresses. Its current slug outranks a slug another tenant had, though
none may take one. Answers give the current slug. The web app takes an address with a former slug
to the same one with the current slug (`CurrentTenantAddress`), once `products.list` shows the
person that slug among the tenant's `former_slugs`; to anyone who cannot see the tenant, a former
slug answers `404` as an unknown one does.

On MCP a product-scoped call resolves its product in this order: the `product` argument (an id or
`tenant/team/product`); the product the endpoint is scoped to; the only unarchived product the
caller can reach inside the endpoint's scope, where the unscoped endpoint leaves the example
organization's products out, since every account reaches them; otherwise `422 product_required`
listing the products the caller reaches ([`apps/server/src/mcp.ts`](../../apps/server/src/mcp.ts)). An organization's or a team's
call takes `tenant` (and `team`) from its params or the endpoint, and otherwise the organization
and team of a `product` it names that the caller can see, unless it takes a product of its own
([§6.5](06-operations-and-adapters.md)). Every product-scoped MCP
result echoes `scope` (tenant, team, product, `your_role` capped by the connection's level,
`connection_level`, and the server's `skill_version`) so an agent and the person reading its
transcript can see where a write landed and what it may do there.

**A scoped endpoint is a fence, not a default**
(◆ [decision](../decisions/a-scoped-mcp-connector-is-a-fence.md)). Whatever roles the person holds
elsewhere, a call through `/mcp/t/<tenant>` or `/mcp/t/<tenant>/<team>/<product>` that lands
outside it is refused with `403 outside_connector_scope` before any handler runs
([`connector-scope.ts`](../../packages/core/src/connector-scope.ts)), and the message names the
scope. A person who works in several organizations adds one connector per organization in their
agent and turns off the ones they are not using; for everything at once there is the unscoped
`/mcp`, which reaches every organization they are in and the example organization
([§3.10](#310-the-example-organization)).

| Through | Answers | Refuses |
|---|---|---|
| an organization's endpoint | every product, team and tenant operation in that organization; `products.list` (narrowed to it), `get_skill`, `submit_feedback` | another organization; the other account-level operations (`products.create_tenant`, the instance's allowances, organizations and usage) |
| a product's endpoint | that product's operations; `products.list` (narrowed to it); `products.limits` for its organization; the account reads above | every other product; team and tenant operations (`members.*`, `products.create`, `products.create_team`); moving or copying a source to another product |
| `/mcp`, unscoped | every operation in every organization the person reaches, the example organization included; every account-level operation | nothing for being unscoped; the example organization refuses its guests' writes on every endpoint |

The scope is resolved for the caller on the first tool call; an endpoint naming an organization or
product they cannot reach answers `404` to every call, saying so. An endpoint whose address names
the organization by a former slug keeps working, and every answer through it carries
`connector_address`: the current address, for the agent to tell the person once.

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
  `copied_from`; attachments are shared (blobs are immutable) and read afresh in the target, and
  the copy takes the derived text, which goes on following its attachment's copy if it was still
  that attachment's text; the summary, notes and comments stay with the original.
- **Move** (`sources.move_to_product`): keeps the record id, attachments, readings, derived text,
  summary, notes and comments. Nothing
  structural points at a source, so nothing refuses a move; a link to the source in the product it
  left stops opening. Both products log the move.
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

**Sign out everywhere.** Signing out ends one browser's session. To end everything at once, a
person uses Sign out everywhere in their Settings (`POST /api/v1/me/sign-out-everywhere
{ keep_this_session? }`, the session only, from the app's own origin). In one transaction
(`endSignIns`, `packages/core/src/accounts.ts`) it deletes every session of the account, the calling one too
unless `keep_this_session` is true; revokes every agent connection, whose next call answers `401`
and whose refresh token is refused; and expires every upload grant of the account's not yet used,
so nothing more is stored under one, while the download grants its agents held stop with their
connections ([§6.4](06-operations-and-adapters.md#64-rest)). It answers `{ sessions, connections,
kept_this_session }`, and writes nothing into any organization: the account is the person's own.
No operation reaches it, so an agent cannot sign its person out. Removing an account
(below) ends everything the same way first.

**Removing an account.** Only an instance owner removes an account, in the web app, on **People**
(`products.remove_account`, web only, with the account's address typed exactly and `confirm` set to
`"delete permanently"`); `products.accounts` lists every account for them, through either door,
with the organizations each is in and when it was last seen
([decision](../decisions/instance-owners-see-every-account-and-remove-any-but-their-own.md)). An
instance owner's account is refused (`409 instance_owner`), and so is the only owner of an
organization until someone else owns it or it is deleted (`409 last_owner`, naming the
organizations). In one transaction it ends the account's sign-ins as Sign out everywhere does;
takes every role it holds, recording `revoked` in each organization's access log with the person's
name; cancels the invitations still waiting at its address; removes the address's allowance and its
unused sign-in links; and marks the account removed (`deleted_at`) with its address replaced by one
that is no one's, so the address is forgotten. Its name stays on what it wrote, since attribution
is copied. The address may sign up again only if something lets it in again.

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
product, named), that what it reads goes to whoever runs the agent, and that they can
disconnect it under Connect an agent, and asks what it may do there (below). Any
MCP client registers itself, so no client is configured in advance, and any client may call
itself anything: the consent page shows the name in quotation marks as the name the agent gave
itself, which WhatBuild has not verified, and says where Allow hands the connection, the redirect
URI's host for `https`, or "an app on this computer" for loopback `http` and private-use schemes.
When that host is one this account has never handed a connection to, under any client's name, the
page says so above the buttons ("You have never connected an agent at <host> before"), puts Deny
first and makes neither button the primary one, the case that most often means someone else sent
the link. An app on this computer, and a host connected to before, keep the usual page
([`connection-notice.ts`](../../apps/server/src/auth/connection-notice.ts)).
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
keeps the resource. Connected agents are listed, each with what it can reach, its level and who
holds the connection (the hosts of its client's redirect URIs, or an app on the person's
computer), and changed or disconnected on the Connect an agent page.

**A new connection is mailed to its person.** When a code is exchanged for a connection's first
tokens, the exchange queues one email to the account, which the worker sends to its address then:
the agent's self-given name, in quotation marks, as unverified; where it is held; what it reaches
and its level, in the consent page's words; the time in UTC; and links to Connect an agent, to
disconnect it, and to Settings, to sign out everywhere. A refresh makes no connection and sends
nothing. ◆ Decision: an agent connecting again sends nothing either, where again means the account
had another connection, live or ended, from a client of the same name held at the same place (the
same `https` host, or an app on the computer), since some clients register afresh each time they
connect. A failing mailer never fails the exchange: the job is retried as any job is. A deployment
with no mailer queues nothing ([mail](../operations/mail.md)).

**A connection's level.** The person chooses on the consent page what the agent may do: **Read
only** (`viewer`), **Edit** (`editor`, chosen unless they change it) or **Admin** (`admin`)
(◆ [decision](../decisions/an-agent-connection-has-a-level-the-person-chooses.md)). The level is
kept on the authorization code and on every token of the connection (`oauth_tokens.level`), and a
refresh keeps it. It is a ceiling on the person's role, never an addition: wherever the agent
calls, it acts as the lower of the two (`capRole`), so an editor's Admin connection still acts as
an editor, and an admin's Edit connection as one too.

- Each operation needs a level: `admin` and `owner` access need Admin, writes need Edit, reads
  need Read only; an operation may say otherwise (`connection`): managing people, creating an
  organization and the instance's allowances need Admin, and `submit_feedback` Read only.
- `execute` refuses an operation above the connection's level with `403 connection_level`, before
  it resolves any scope, naming the level it has and the one needed. MCP lists only the actions
  the level allows, so an Edit connection is never offered a permanent delete, and of those only
  what the person could do ([§6.5](06-operations-and-adapters.md#65-mcp)).
- `products.list` gives `connection_level` and caps each `your_role` by it.
- Only the person changes it, under Connect an agent (`PATCH /api/v1/me/agents/<connection>`,
  which takes the web app's session alone), and the change holds from the agent's next call. No
  operation an agent can call reaches a connection's level, so an agent cannot raise its own.
- A connection made before levels existed is Edit.

A connection also has a **feedback switch** (`oauth_tokens.feedback`), on unless the person turns
it off under Connect an agent (`PATCH /api/v1/me/agents/<connection> { feedback }`, the session
only), and kept by a refresh like the level. Off, MCP does not list `submit_feedback`, a call to it
is refused with `403 feedback_off`, and the server's instructions say the person turned it off
([§6.9](06-operations-and-adapters.md#69-feedback)).

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

## 3.10 The example organization

A deployment may name one organization as its **example organization**: a worked example that
every signed-in account reads and nobody but its own members changes. The maintainer's public
deployment names one; a self-hosted deployment leaves the setting out and has none
(◆ [decision](../decisions/every-account-reads-the-example-organization-which-only-its-staff-write.md)).
It shows what a discovery in WhatBuild looks like, and a person can always go back to it.

**Which organization.** `WHATBUILD_EXAMPLE_TENANT` holds its slug. At start-up the server sets
`tenants.example` on that organization and clears it on every other (`syncExampleTenant`,
[`apps/server/src/example-organization.ts`](../../apps/server/src/example-organization.ts)). A slug
that matches no organization makes none the example, and the server says so in its log. A slug
the example had before its current one still names it, and the server warns to set the current
one ([§3.3](#33-tenants-and-teams)). A
deployment that still sets the retired `WHATBUILD_SANDBOX_TENANT` and not the new name is warned
at start-up.

**Its staff and its guests.** The organization's members, whatever their roles, work there as in
any organization, under their own names; its owners and admins are its staff. **Every other
account is its guest**:

| A guest | How |
|---|---|
| reads every product | `membershipsFor` adds a tenant grant `guest` for the example to every account that holds no grant there, and `effectiveRole` makes it viewer on every team and product. The grant is never stored. |
| changes nothing | `execute` refuses every call that writes with `403 example_read_only` before reading its input, and `resolveScope` refuses the same way an operation whose access the guest's role is below (editor, admin, owner). Exporting a product and a Story or Idea card preview are refused too. The message says to create an organization of one's own (`products.create_tenant`, or New organization in the web app). |
| sees no person | `members.list` answers an empty list with `guest: true`. Staff's names appear on what they wrote and in the activity log, as anywhere. |
| meets the limit on calls a minute | `requests_per_minute` of the example's limits: the free plan's unless an instance owner changed it ([§9.7](09-data-lifecycle.md)). |

`products.list` lists the example organization's products for every account, with
`tenant.example: true`, and the organization among `tenants` with `example: true` and
`your_role: "guest"` for a guest. A product-scoped MCP result there echoes `example: true` in its
`scope`.

**The grant fails closed.** The guest grant exists only while `tenants.example` is set, so taking
`WHATBUILD_EXAMPLE_TENANT` away and restarting takes every guest's access with it, and naming the
organization again gives it back. Someone given a role there holds that role, not the guest grant:
a reader on one of its products reads that product's Story and nothing else of it.

**Agents.** The example is reached through the unscoped connector like any organization, and
through one scoped to it: only its members write there, so an agent reading it reads nothing a
stranger wrote. A call that names no product never defaults to one of its products unless the
connector is scoped to the example ([§3.6](#36-addressing-and-isolation)).

**It cannot be deleted** while the deployment names it: `products.delete_tenant` answers
`409 example_organization`. Its owners rename it and change its slug as any owners do, and so does
an instance owner ([§3.3](#33-tenants-and-teams)); its former slug still names it in
`WHATBUILD_EXAMPLE_TENANT` until the deployment is told the new one.
