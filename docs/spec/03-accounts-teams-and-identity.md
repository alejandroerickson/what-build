# 3. Accounts, tenants, teams, products, roles

> Draft 0.3 replaces draft 0.2's team → project hierarchy and its single membership rule with a
> three-level hierarchy and roles, following the owner's brief. The shape of the rule is kept: one
> policy module, both front doors, attribution on every write, and "cannot see" answered as `404`.

## 3.1 The hierarchy

```
account              one person's sign-in; may belong to several tenants
tenant               an organization: the isolation and (later) billing boundary
└── team             a group of people and the products they run
    └── product      one discovery
        ├── objectives
        ├── sources      records → files → derivations → segments; notes
        ├── insights     with immutable revisions
        ├── assumptions · decisions   (the two registers)
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
- In the UI the tenant is called the **organization**. The API and MCP say `tenant`, because
  records already carry an `organization` field (the external organization a source concerns).
  ◆ Decision: two words for one concept is a known cost; see open question 18.

## 3.2 Accounts and sign-in

| Field | Rule |
|---|---|
| `account_id` | ULID, immutable. |
| `email` | Unique (case-insensitive), verified by the sign-in itself. |
| `display_name` | 1–100 chars. Appears in attribution. |

Sign-in methods, each optional per deployment:

- **Email link** — a single-use link valid 15 minutes, at most five per address per hour. A server
  with no mail provider disables it rather than log a link.
- **Google** — OpenID Connect, when a client id and secret are configured.
- **Development** — "sign in as" an email, only when `NODE_ENV` is not `production`.

There is no password. First sign-in creates the account; every invitation addressed to that email
is accepted at once, because the verified address is the proof.

**Invite-only mode.** `WHATBUILD_SIGNUP_ALLOWLIST` (emails and `@domains`) limits who may create an
account. Existing accounts and invited addresses always may. Staging runs invite-only until public
sign-up opens ([§10 Phase 6](10-roadmap.md)).

## 3.3 Tenants and teams

| Object | Fields |
|---|---|
| Tenant | `tenant_id`, `slug` (3–50, `[a-z0-9-]`, globally unique), `name`, `plan` (`free`), `status` |
| Team | `team_id`, `tenant_id`, `slug` (unique in the tenant), `name`, `archived_at` |

Creating a tenant creates its first team and makes the creator the tenant's **owner**. A new user's
first-run flow is: name the organization, name the first product and its idea.

## 3.4 Products

| Field | Rule |
|---|---|
| `product_id` | ULID, immutable. |
| `slug` | 3–50 chars, unique in the team. Mutable. |
| `name` | 1–100 chars. |
| `idea` | Markdown, ≤ 2,000 chars, heads the Objectives screen; overwrites keep revisions. |
| `archived_at` | Archived products are hidden from lists and read-only (`409 product_archived`) until restored. |

A product is addressed as `tenant/team/product` (slugs or ids at each level) or by `product_id`.

## 3.5 Roles

| Level | Roles | What the role grants |
|---|---|---|
| Tenant | `owner`, `admin`, `member` | owner and admin: admin of every team and product in the tenant; owner: tenant lifecycle. member: nothing by itself |
| Team | `admin`, `editor`, `viewer` | the same role on every product in the team |
| Product | `admin`, `editor`, `viewer` | that product only |

- **Viewer** reads everything in the product. **Editor** also writes: sources, files, notes,
  objectives, insights, register entries and reviews, the Story, and permanent deletes of sources
  (guarded, [§9.5](09-data-lifecycle.md)). **Admin** also manages the product (rename, archive) and
  its people. Creating products and teams needs admin of the team or tenant.
- **The effective role is the highest that applies.** A product grant can raise access but never
  lower an inherited one. ◆ Decision: no negative overrides — they make "who can see this?"
  unanswerable at a glance.
- **Visibility:** with no role on a product, the product does not exist for you: `404`, never
  `403`, from every operation. With a role too low for an action, `403` names the role you have
  and the one needed ("You are a viewer on product Crewboard; objectives.create needs editor").
- **Membership administration:** admins grant and revoke at their own level and below; granting
  someone without an account creates a 7-day invitation, emailed where mail is configured and
  always returned to the inviter as a single-use link. A tenant keeps at least one owner.
- ◆ Decision: reviewing (confirm, refute) is an editor right; there is no separate reviewer role.
- ◆ Decision: every role can read the product's activity log.

## 3.6 Addressing and isolation

The addressed tenant, team and product are always explicit. Nothing on the server remembers a
"current" product.

| Surface | Addressing |
|---|---|
| Web | `/t/<tenant>/<team>/<product>/<screen>` |
| REST | `/api/v1/p/<tenant>/<team>/<product>/…` for product operations; `/api/v1/teams/<tenant>/<team>/…`, `/api/v1/tenants/<tenant>/…` and `/api/v1/…` for the rest |
| MCP | `/mcp` for everything the account can reach, or `/mcp/t/<tenant>/<team>/<product>` bound to one product |

On MCP a product-scoped call resolves its product in this order: the `product` argument (an id or
`tenant/team/product`); the product the endpoint is bound to; the only product the caller can
reach; otherwise `422 product_required` listing the reachable products. Every product-scoped result
echoes `scope` (tenant, team, product, your role) so an agent and the person reading its transcript
can see where a write landed.

Isolation is enforced three times:

1. **Authorization** resolves the caller's role for the addressed product, or answers `404`. It runs
   before input validation, so a non-member learns nothing — not even whether their input was valid.
2. **The core** receives a transaction already scoped to one tenant; handlers never see another.
3. **Postgres row-level security** on every content table keys on a transaction-local `tenant_id`,
   so a query that escaped the first two layers still returns nothing. The server refuses to start
   in production as a database role that bypasses row-level security.

Blob keys begin `t/<tenant_id>/…`. A conformance test calls **every** non-account operation as a
member of another tenant and requires `404` from each.

## 3.7 Moving and copying between products

- **Copy** (`sources.copy_to_product`): a new record id in another product of the same team, with
  `copied_from`; files are shared (blobs are immutable) and parsed afresh in the target.
- **Move** (`sources.move_to_product`): keeps the record id, files, derivations and notes. Refused
  with `409 source_in_use` while anything in the current product cites or references the source,
  listing what does, because references never cross products. Both products log the move.
- Moving insights, entries, objectives and Story pages is planned, with the same closure rule.

## 3.8 Identity of the caller

| Surface | Credential | Recorded surface |
|---|---|---|
| Web | Session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS), 30 days; cookie writes must come from the app's own origin | `web` |
| REST (scripts) | Personal access token (`wbpat_…`) | `rest` |
| MCP | OAuth 2.1 access token issued by WhatBuild for its MCP endpoint, or a personal access token | `mcp` |
| Upload relay | A signed, single-file grant; the file is attributed to whoever requested the grant | as requested |
| Job worker | none — internal | `WhatBuild` (system) |

**OAuth for agents.** WhatBuild is its own authorization server: protected-resource metadata
(RFC 9728) at `/.well-known/oauth-protected-resource/mcp`, authorization-server metadata (RFC 8414),
dynamic client registration (RFC 7591), authorization code with PKCE S256, resource indicators
(RFC 8707), one-hour access tokens and rotating refresh tokens (reusing a rotated refresh token
revokes the whole connection). The consent page tells the person the agent will act as them and
that its reads go to whoever runs the agent. A token is the person: it never widens or narrows what
they can do.

**Personal access tokens** are created in the web app only, shown once, stored hashed, listed with
last use, and revoked immediately.

## 3.9 Attribution

Every mutation stores an actor snapshot — `{ account_id, display_name, surface, client }` — copied,
not joined, so attribution survives renames and removals. `client` is the OAuth client's name or a
token's user agent. It never holds an email address.

Authenticated identity says which account wrote; it does not say whether a person exercised
judgment, because an agent writes with its person's credentials. Register entries and reviews
therefore carry a declared `author_type` / `reviewer_type` (`human` or `agent`), defaulting to
`human` in the web app and `agent` everywhere else, and a human confidence rating is accepted only
from a declared human reviewer.
