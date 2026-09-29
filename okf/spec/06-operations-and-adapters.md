---
type: Specification
title: Every capability is one registered operation, reached identically over REST and MCP.
description: The operation registry, the error model and bounds, the full catalogue of 99 operations with their REST routes and MCP tools, authorization, upload flows, the skill and the Connect page.
tags: [spec, operations, rest, mcp, registry, uploads, skill]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# 6. Operations and adapters

One core, two adapters. REST serves the web app and scripts; MCP serves agents. Same operations,
same authentication, same status codes. The code is in `packages/core/src/ops/*.ts` (operations),
`apps/server/src/rest.ts` and `apps/server/src/mcp.ts` (the adapters).

## 6.1 The operation registry

Every operation is declared once in `core` (`packages/core/src/registry.ts`):

```ts
defineOperation({
  name: "assumptions.review",            // <tool>.<action>, or a bare name for a standalone tool
  scope: "product",                      // "product" | "team" | "tenant" | "account"
  access: "write",                       // "read" | "write" | "admin" | "owner" | "any"
  mutates: true,                         // writes an activity event
  summary: "One line, shown in the tool's action list.",
  description: "Guidance returned by describe: when to use it, what it returns, pitfalls.",
  input: z.strictObject({ … }),          // Zod; strict = unknown fields rejected
  rest: { method: "POST", path: "/assumptions/:id/review" },
  mcp: { tool: "assumptions", action: "review" },
  allowArchivedProduct: false,           // true only for products.restore and products.export
  handler: async (ctx, input) => { … },
});
```

`OPERATIONS` in `packages/core/src/index.ts` lists all 99. From that list, and from nothing else,
the server builds the REST routes, the MCP tools with their `action` enums and JSON Schemas (via
`z.toJSONSchema`), and the `describe` responses. The web app calls the same REST routes through
one small hand-written client (`apps/web/src/lib/api.ts`); there is no generated client and no
OpenAPI document.

A **parity test** (`apps/server/test/mcp.test.ts`, "adapter parity") fails if any operation is
unreachable from either adapter, or if any tool action exists that is not in the registry.

`execute` (`packages/core/src/execute.ts`) is the one way an operation runs, whichever door the
call came through:

1. **Resolve and authorize the scope first** ([§3.6](03-accounts-teams-and-identity.md)): a caller
   who cannot see the product gets `404` before their input is even validated.
2. **Validate the input** strictly (`422 invalid_input`, "Nothing was changed"), after renaming an
   accepted id alias to its canonical field (§6.5).
3. Refuse writes to an archived product (`409 product_archived`) unless the operation allows it.
4. **Run the handler in one transaction** scoped to the tenant (`app.tenant_id` set for row-level
   security). Mutating handlers record their activity event ([§4.10](04-data-model.md)) and enqueue
   background jobs in that same transaction; the worker is woken after commit.

`ctx` carries the principal, the actor snapshot, the tenant-scoped transaction, the resolved scope
(tenant, team, product, the caller's role), the ports, the request time, and `enqueue`. Handlers
receive no transport details and no way to reach another tenant.

## 6.2 Errors

```json
{ "error": { "code": "stale_etag", "status": 409, "message": "…", "details": { "current_etag": "…" } } }
```

| Status | When | Example codes |
|---|---|---|
| 400 | Malformed upload request (relay only) | `invalid_length`, `empty_body` |
| 401 | No or invalid identity or grant | `unauthenticated`, `invalid_grant` |
| 403 | A role too low for the action; a cross-origin cookie write; sign-up not allowed | `forbidden`, `forbidden_origin`, `invite_only` |
| 404 | Absent — including everything the caller has no role on | `not_found` |
| 409 | Conflict with current state | `stale_etag`, `product_archived`, `record_archived`, `slug_taken`, `frozen`, `primary_taken`, `source_in_use`, `export_in_progress`, `last_owner`, `quota_exceeded` |
| 410 | Deliberately deleted, with a tombstone | `record_deleted` |
| 413 | Body or file beyond a limit | `too_large` |
| 422 | Invalid input | `invalid_input`, `edit_not_found`, `edit_ambiguous`, `unknown_field`, `unknown_action`, `unknown_tool`, `product_required`, `window_too_large`, `quote_not_found`, `invalid_citation`, `cross_product_reference`, `invalid_query`, `invalid_cursor`, `invalid_html`, `invalid_patch`, `confirmation_required`, `confidence_requires_human` |
| 429 | Rate limited | `rate_limited` |

- **`403` names the role.** A caller with a role on the product but too low for the action gets
  `403` with `{ role, needed }` in `details` ("You are a viewer on product …; outcomes.create
  needs editor"). With no role at all the answer is `404`, never `403`
  ([§3.5](03-accounts-teams-and-identity.md)).
- **`quota_exceeded`** carries `{ quota, limit, used, unit }` in `details`. The only quota enforced
  today is 50 Story pages per product ([§9.2](09-data-lifecycle.md)).
- **`429`** is returned today only for sign-in links (five per address per hour). General rate
  limits are planned.
- Database unique violations become `409 conflict`; serialization failures become
  `409 concurrent_change` ("Retry"). Anything unexpected is `500 internal`, logged, and never
  leaks details.
- Messages are written for an agent to act on: they say what was wrong and what a correct call
  looks like. MCP returns the same object as a tool error (`isError: true`) whose text begins with
  the status (`"422: …"`) followed by the JSON.

## 6.3 Bounds and paging

- Lists and search are paged with an opaque `cursor`; responses carry `next_cursor` or `null`.
  Page sizes are per operation: default 50, at most 200 for sources, search, activity and
  revisions; default 25, at most 100 for insights, register entries and Story versions; outcomes
  default to 100. Asking for more than the maximum is `422`, not a silent clamp.
- `sources.list` orders by `sort`: `added` (newest added first, the default), `date` (the
  source's own date, newest first, undated last), `updated` (details most recently changed first)
  or `title` (A to Z). `order` (`asc` or `desc`) reverses a sort; it defaults to `desc` for the
  three dates and `asc` for title, and undated sources stay last either way. A cursor belongs to
  its sort, order and filters: pass it back with all of them unchanged.
  With `date`, `updated` or `title`, a cursor the sort did not issue is `422 invalid_cursor`. Each
  summary in the list also names its primary file (`primary_file`, or `null`). Every source
  summary carries `uploaded_at` and `updated_at` with their actors.
- Text windows (`derived.text`, insight bodies): at most 20,000 characters per call by default,
  with `truncated` and totals.
- Passages: at most 200 segments and 10 minutes per read ([§5.4](05-derived-layer.md)).
- Lists return summaries — never bodies, HTML, or derived text.
- REST request bodies are limited to 5 MB (`413 too_large`); file bytes go through upload grants
  (§6.7).

## 6.4 REST

Routes are generated from the registry: `<prefix><rest.path>`, where the prefix depends on the
operation's scope (`SCOPE_PREFIX` in `apps/server/src/rest.ts`):

| Scope | Prefix |
|---|---|
| product | `/api/v1/p/:tenant/:team/:product` (written `P` below) |
| team | `/api/v1/teams/:tenant/:team` |
| tenant | `/api/v1/tenants/:tenant` |
| account | `/api/v1` |

JSON in, JSON out. `GET` (and a body-less `DELETE`) take their fields from the query string,
coerced to the schema's types (arrays are comma-separated); other methods take a JSON object body.
Path parameters are merged into the input. Mutations carry the ETag as `expected_etag` in the
body, or as an `If-Match` header when the body omits it; a result that has an `etag` is also sent
as the `ETag` header. Operations that create something answer `201`. Cookie-authenticated writes
must come from the app's own origin (`403 forbidden_origin`).

### The operation catalogue

All 99 operations, generated from `OPERATIONS`. The MCP tool is the operation name's first half;
standalone tools (—) take their fields directly. "Needs" is the minimum role
([§3.5](03-accounts-teams-and-identity.md)); `members` write actions check admin at the level
being changed inside the handler.

| Tool | Action | REST | Needs |
|---|---|---|---|
| `products` | `list` | `GET /api/v1/me/products` | signed in |
| `products` | `create_tenant` | `POST /api/v1/tenants` | signed in |
| `products` | `create_team` | `POST /api/v1/tenants/:tenant/teams` | tenant admin |
| `products` | `create` | `POST /api/v1/teams/:tenant/:team/products` | team admin |
| `products` | `get` | `GET P` | viewer |
| `products` | `update` | `PATCH P` | admin |
| `products` | `archive` | `POST P/archive` | admin |
| `products` | `restore` | `POST P/restore` | admin |
| `products` | `export` | `POST P/exports` | viewer |
| `products` | `exports` | `GET P/exports` | viewer |
| `members` | `list` | `GET /api/v1/tenants/:tenant/members` | tenant member |
| `members` | `grant` | `POST /api/v1/tenants/:tenant/members` | admin at the target |
| `members` | `revoke` | `POST /api/v1/tenants/:tenant/members/revoke` | admin at the target |
| `members` | `cancel_invitation` | `POST /api/v1/tenants/:tenant/invitations/cancel` | admin at the target |
| `outcomes` | `list` | `GET P/outcomes` | viewer |
| `outcomes` | `get` | `GET P/outcomes/:outcome_id` | viewer |
| `outcomes` | `create` | `POST P/outcomes` | editor |
| `outcomes` | `update` | `PATCH P/outcomes/:outcome_id` | editor |
| `outcomes` | `revisions` | `GET P/outcomes/:outcome_id/revisions` | viewer |
| `outcomes` | `get_revision` | `GET P/outcomes/:outcome_id/revisions/:n` | viewer |
| `outcomes` | `restore_revision` | `POST P/outcomes/:outcome_id/revisions/:n/restore` | editor |
| `sources` | `kinds` | `GET /api/v1/kinds` | signed in |
| `sources` | `list` | `GET P/sources` | viewer |
| `sources` | `get` | `GET P/sources/:record_id` | viewer |
| `sources` | `create` | `POST P/sources` | editor |
| `sources` | `update` | `PATCH P/sources/:record_id` | editor |
| `sources` | `archive` | `POST P/sources/archive` | editor |
| `sources` | `restore` | `POST P/sources/restore` | editor |
| `sources` | `annotate` | `POST P/sources/:record_id/annotations` | editor |
| `sources` | `list_annotations` | `GET P/sources/:record_id/annotations` | viewer |
| `sources` | `update_annotation` | `PATCH P/annotations/:annotation_id` | editor |
| `sources` | `insights_for` | `GET P/sources/:record_id/insights` | viewer |
| `sources` | `move_to_product` | `POST P/sources/:record_id/move` | editor |
| `sources` | `copy_to_product` | `POST P/sources/:record_id/copy` | editor |
| `sources` | `delete_impact` | `GET P/sources/:record_id/delete-impact` | viewer |
| `sources` | `delete` | `DELETE P/sources/:record_id` | editor |
| `files` | `request_upload` | `POST P/sources/:record_id/uploads` | editor |
| `files` | `create_upload` | `POST P/sources/with-upload` | editor |
| `files` | `complete_upload` | `POST P/sources/:record_id/uploads/complete` | editor |
| `files` | `add_note` | `POST P/sources/:record_id/notes` | editor |
| `files` | `fetch_url` | `POST P/sources/:record_id/fetch` | editor |
| `files` | `set_role` | `POST P/sources/:record_id/files/role` | editor |
| `files` | `get_download` | `POST P/sources/:record_id/downloads` | viewer |
| `derived` | `manifest` | `GET P/sources/:record_id/derived/manifest` | viewer |
| `derived` | `outline` | `GET P/sources/:record_id/derived/outline` | viewer |
| `derived` | `text` | `GET P/sources/:record_id/derived/text` | viewer |
| `derived` | `list` | `GET P/sources/:record_id/derivations` | viewer |
| `derived` | `rederive` | `POST P/sources/:record_id/rederive` | editor |
| `derived` | `write_note` | `PUT P/sources/:record_id/agent-notes/:note_kind` | editor |
| `derived` | `read_note` | `GET P/sources/:record_id/agent-notes/:note_kind` | viewer |
| `read_passage` | — | `GET P/sources/:record_id/passage` | viewer |
| `search` | — | `GET P/search` | viewer |
| `insights` | `list` | `GET P/insights` | viewer |
| `insights` | `get` | `GET P/insights/:insight_id` | viewer |
| `insights` | `create` | `POST P/insights` | editor |
| `insights` | `update` | `PATCH P/insights/:insight_id` | editor |
| `insights` | `review` | `POST P/insights/:insight_id/review` | editor |
| `insights` | `revisions` | `GET P/insights/:insight_id/revisions` | viewer |
| `insights` | `get_revision` | `GET P/insights/:insight_id/revisions/:n` | viewer |
| `insights` | `restore_revision` | `POST P/insights/:insight_id/revisions/:n/restore` | editor |
| `assumptions` | `list` | `GET P/assumptions` | viewer |
| `assumptions` | `get` | `GET P/assumptions/:id` | viewer |
| `assumptions` | `create` | `POST P/assumptions` | editor |
| `assumptions` | `update` | `PATCH P/assumptions/:id` | editor |
| `assumptions` | `review` | `POST P/assumptions/:id/review` | editor |
| `assumptions` | `supersede` | `POST P/assumptions/:id/supersede` | editor |
| `assumptions` | `link` | `POST P/assumptions/:id/links` | editor |
| `assumptions` | `unlink` | `POST P/assumptions/:id/unlink` | editor |
| `assumptions` | `archive` | `POST P/assumptions/:id/archive` | editor |
| `assumptions` | `check_citations` | `POST P/assumptions/:id/check-citations` | viewer |
| `decisions` | *(the same ten actions as `assumptions`)* | `P/decisions/…` | *(same)* |
| `story` | `guidance` | `GET P/story/guidance` | viewer |
| `story` | `list_pages` | `GET P/story/pages` | viewer |
| `story` | `get_page` | `GET P/story/pages/:page_id` | viewer |
| `story` | `list_versions` | `GET P/story/pages/:page_id/versions` | viewer |
| `story` | `get_version` | `GET P/story/pages/:page_id/versions/:version` | viewer |
| `story` | `publish` | `POST P/story/pages/:page_id/versions` | editor |
| `story` | `write_notes` | `PUT P/story/pages/:page_id/notes` | editor |
| `story` | `check_citations` | `GET P/story/pages/:page_id/check-citations` | viewer |
| `story` | `print_view` | `GET P/story/print-view` | viewer |
| `story` | `get_hierarchy` | `GET P/story/hierarchy` | viewer |
| `story` | `set_hierarchy` | `PUT P/story/hierarchy` | editor |
| `story` | `archive_page` | `POST P/story/pages/:page_id/archive` | editor |
| `story` | `restore_page` | `POST P/story/pages/:page_id/restore` | editor |
| `lineage` | `capture` | `POST P/lineage/capture` | viewer |
| `lineage` | `write` | `POST P/sources/:record_id/lineage` | editor |
| `lineage` | `check` | `GET P/sources/:record_id/lineage` | viewer |
| `activity` | `list` | `GET P/activity` | viewer |
| `get_skill` | — | `GET /api/v1/skill` | signed in |
| `submit_feedback` | — | `POST /api/v1/feedback` | signed in |

Notes on recent actions:

- `insights.review { insight_id, reviewed, expected_etag }` records a person's review. Each insight
  reports `review_state`: `unreviewed`, `reviewed`, or `changed` (edited since its review);
  `insights.list` filters by it ([§4.7](04-data-model.md)).
- `insights.update` and the registers' `update` take `edits` (exact replacements that must match
  once) and return `changed` and a short `diff` ([§4.1](04-data-model.md)). Register lists return
  `frozen`, `superseded_by` (the ids of the entries whose `supersedes` link points at the entry, newest
  first, so a list can show history under its correction without a `get` per entry),
  `link_count` and `linked_from_count`; `outcomes.list` returns
  `archived_hidden` ([§4.2](04-data-model.md), [§4.8](04-data-model.md)).
- `story.publish` takes `citations` (up to 20 exact passages, snapshotted as in the registers)
  beside `refs`; `story.check_citations` checks a version's citations. A later version keeps the
  `title`, `summary`, `html`, `refs` and `citations` it omits, `patch_html` edits the HTML by exact
  find and replace, and `from_version` starts from an earlier version, which restores it
  ([§4.11](04-data-model.md)). Versions report `html_sha256`. A version has no change note:
  `note` is refused like any unknown field (`422`), and versions do not return one.
- `story.write_notes` replaces a page's notes for agents. The notes carry their own etag
  (`publish` → `agent_notes_etag`, `get_page` → `agent_notes.etag`), separate from the page etag,
  and are not versioned with the page. While the notes are empty the etag may be omitted.
- `members.list` takes an optional `product` to list only the people who can reach it, each with
  `product_access { role, via }`.
- `activity.list` takes `by: "people" | "agents"` (agents = calls over MCP), besides
  `entity_type`, `entity_id`, `actor`, `channel` and `since`.

### Routes outside the registry

These carry bytes, identity or discovery, not operations:

```
PUT  /api/v1/uploads/:grant_id                       upload relay (grant header is the credential)
GET  /api/v1/downloads/:file_version_id              file bytes under a download grant
GET  /api/v1/downloads/export/:export_id             an export ZIP under a download grant
GET  P/sources/:record_id/file?path=&version=&download=1   file bytes for the web app (ranged)
GET  P/exports/:export_id/file                       an export ZIP for the web app
GET  P/story/pages/:page_id/versions/:version/html?theme=light|dark   Story page HTML
GET  P/story/print?page_ids=…                        the Story print view (HTML)
GET  /api/v1/meta                                    server and skill version, sign-in methods (public)
GET  /api/v1/connect                                 what the Connect page shows
GET|PATCH /api/v1/me; GET|POST /api/v1/me/tokens; DELETE /api/v1/me/tokens/:id; DELETE /api/v1/me/agents/:family
POST /api/v1/invitations/accept
/auth/*  /oauth/*  /.well-known/oauth-*              sign-in and OAuth (§6.6)
/health  /whatbuild-skill.md  /whatbuild-skill.zip  /install.sh  /install.ps1
```

**Bytes are served by the service itself**, streamed from the object store with
`X-Content-Type-Options: nosniff`, a `Content-Disposition`, range support, and a sandboxing
`Content-Security-Policy`. Uploaded HTML, XHTML and SVG are always sent as
`application/octet-stream` attachments, never renderable from the application's origin.

**Story page HTML** is served with a sandbox policy that allows the page's inline scripts but no
network, no same-origin access and no framing outside the app. `?theme=light|dark` writes the
app's resolved theme onto the page's `<html>` for that response only; the stored HTML is
unchanged.

### The Story print view

`story.print_view { page_ids }` (1–50 page ids, comma-separated in a query string) plans a print
view: exactly the pages named, each at its current version, in the Story's tree order — a
depth-first walk of the hierarchy, then pages the hierarchy does not place, by title. Each page
carries `depth` (its depth in the hierarchy) and `level` (its outline level among the chosen
pages: one more than the number of chosen ancestors, so the outline never skips a level). The
result also gives `path` and `url` for the document itself.

`GET P/story/print?page_ids=…` answers that document as HTML, for a person to open in a browser
tab and save as PDF with the browser's print dialog. The server renders no PDF
(`packages/core/src/story-print.ts`). The document has:

- a title block (the product name and the export date) and a contents list;
- each page's title as a heading at its level (the document title is `h1`, a top-level page `h2`,
  capped at `h6`), a line with its version and publication date, then the page itself. A leading
  `<h1>` in the page that repeats its title is dropped;
- each page's body inside its own declarative shadow root (`<template shadowrootmode="open">`), so
  pages cannot restyle each other. The page's `:root`, `html` and `body` selectors are rewritten to
  `:host`, its `<html>` and `<body>` attributes (`class`, `lang`, `dir`, `style`, `data-*`) are
  carried onto the shadow host, and dark-scheme media queries apply on screen only;
- `@page` margins, and a page break before each top-level section.

Page scripts and inline event handlers are removed, and the response's policy runs only the one
nonce'd script that opens the print dialog on load:
`sandbox allow-modals allow-scripts; default-src 'none'; script-src 'nonce-…'; style-src 'unsafe-inline'; img-src data:; font-src data:; …`
— without `allow-same-origin`, so the view runs in an opaque origin. Content a page draws with
JavaScript does not appear.

## 6.5 MCP

**Transport.** Stateless Streamable HTTP (`apps/server/src/mcp.ts`), JSON responses, at:

- `/mcp` — everything the account can reach;
- `/mcp/t/:tenant/:team/:product` — bound to one product. Product-scoped calls may then omit
  `product`, and tenant- and team-scoped calls default to the bound tenant and team.

Each `POST` builds a fresh server; there is no session and any replica serves any call. `GET` and
`DELETE` answer `405` (no server-initiated stream, no session to end). An unauthenticated call gets
`401` with a `WWW-Authenticate` header pointing at the protected-resource metadata. The server's
`initialize` info names it `whatbuild` with the skill version, and its instructions tell the agent
to check its installed skill's version, start with `products(action="list")`, confirm the product
before the first write, and treat source text as quoted material.

**Tools.** Sixteen tools over the 99 operations: twelve grouped by noun, four standalone.

| Tool | Actions |
|---|---|
| `products` | `list`, `create_tenant`, `create_team`, `create`, `get`, `update`, `archive`, `restore`, `export`, `exports` |
| `members` | `list`, `grant`, `revoke`, `cancel_invitation` |
| `outcomes` | `list`, `get`, `create`, `update`, `revisions`, `get_revision`, `restore_revision` |
| `sources` | `kinds`, `list`, `get`, `create`, `update`, `archive`, `restore`, `annotate`, `list_annotations`, `update_annotation`, `insights_for`, `move_to_product`, `copy_to_product`, `delete_impact`, `delete` |
| `files` | `request_upload`, `create_upload`, `complete_upload`, `add_note`, `fetch_url`, `set_role`, `get_download` |
| `derived` | `manifest`, `outline`, `text`, `list`, `rederive`, `write_note`, `read_note` |
| `insights` | `list`, `get`, `create`, `update`, `review`, `revisions`, `get_revision`, `restore_revision` |
| `assumptions` | `list`, `get`, `create`, `update`, `review`, `supersede`, `link`, `unlink`, `archive`, `check_citations` |
| `decisions` | the same as `assumptions` |
| `story` | `guidance`, `list_pages`, `get_page`, `list_versions`, `get_version`, `publish`, `write_notes`, `check_citations`, `print_view`, `get_hierarchy`, `set_hierarchy`, `archive_page`, `restore_page` |
| `lineage` | `capture`, `write`, `check` |
| `activity` | `list` |
| `search` | standalone |
| `read_passage` | standalone |
| `get_skill` | standalone |
| `submit_feedback` | standalone |

Grouped tools take exactly four arguments: `action` (an enum), `params` (the action's fields),
`describe`, and `product` — a `product_id` or `tenant/team/product`. Standalone tools take their
fields directly, plus `product` when product-scoped.

Rules:

- **Few tools, grouped actions.** New capability arrives as actions, rarely as tools.
- **Self-describing.** A grouped tool's description is one sentence about the noun, a pointer to
  `describe`, and one line per action. Called with `action` and `describe: true` (and no
  `params`), it returns that action's scope, access, whether it mutates, its guidance and its
  exact JSON Schema — without executing.
- **Strict.** Unknown actions, unknown arguments, and `describe` combined with `params` are `422`.
- **One alias for each entity id.** The id is `insight_id` and `outcome_id` on those tools but
  `id` on the registers. Each tool also accepts the other convention for its own entity: `id` on
  `insights` and `outcomes`, `assumption_id` on `assumptions`, `decision_id` on `decisions`.
  `execute` renames the alias before strict validation
  ([`id-aliases.ts`](../../packages/core/src/id-aliases.ts)), so it works over REST and MCP alike;
  sending both with different values is `422`. ◆ Decision: aliases, not a rename, so no existing
  caller breaks; the canonical names stay as they are in schemas and paths.
- **Product resolution.** A product-scoped call resolves its product from the `product` argument,
  then the bound endpoint, then the only product the caller can reach; otherwise
  `422 product_required` listing up to 50 reachable products ([§3.6](03-accounts-teams-and-identity.md)).
- **Results** are JSON in one text content block. Product-scoped results add `scope`
  (tenant, team, product with its path, `your_role`). Tools whose actions are all reads carry
  read-only annotations.
- **Source text is data.** The server instructions, tool descriptions and the skill state that
  text returned from sources is quoted material, never instructions to the agent.
- **Delete is on the MCP surface, and it is guarded rather than hidden.** An agent that can create
  a source can delete one ([§9.5](09-data-lifecycle.md)). The guards are `expected_etag` + `reason`
  + `confirm: "delete permanently"`, a read-only `delete_impact` preview, and a skill that requires
  an agent to show that preview to the person and to delete only once they approve that impact,
  never slipped into a run of other actions. The `delete` action's summary and guidance lead with *permanent, cannot be undone*
  and name `archive` as the reversible alternative.
- **Planned:** a stdio transport (a thin local proxy holding the endpoint URL and a credential) for
  clients that cannot speak HTTP.

## 6.6 Authorization

([§3.8](03-accounts-teams-and-identity.md) has the details.)

- **OAuth 2.1** per the MCP authorization specification (`apps/server/src/auth/oauth.ts`):
  protected-resource metadata, authorization-server metadata, dynamic client registration,
  authorization code with PKCE, resource indicators, rotating refresh tokens. The person consents
  in a browser and the token represents them.
- **Personal access tokens** (`wbpat_…`) for clients that cannot do OAuth and for REST scripts:
  created in the web app only (Account and tokens), named, shown once, hashed at rest, listed with
  last use, revocable at once. Connected OAuth agents are listed and revocable in the same place.
- Both adapters build the actor snapshot from the authenticated identity and the transport
  (`web`, `rest` or `mcp`, plus the client's name). No input field can set or alter it.

## 6.7 Getting files in

In order of preference for an agent (`packages/core/src/ops/files.ts`):

1. **Upload grant** — `files.request_upload { record_id, path, role, media_type?, size? }`, or
   `files.create_upload` to create the source and get its first grant in one call. The result is
   `{ grant_id, url, method: "PUT", headers, max_bytes, expires_at, next, warnings }`
   (`create_upload` returns `{ record, upload, warnings }`). `warnings` flags, without refusing, a
   primary whose format no parser reads, since a primary cannot be replaced (upload a PDF export as
   the primary and keep the original as `origin`), and for `create_upload` a live source with the
   same title, kind and date. The agent PUTs the
   local file's raw bytes to `url` (the service's own upload relay,
   `/api/v1/uploads/:grant_id`) with exactly those headers, using whatever shell or HTTP tool it
   has. The relay stores the bytes, records size and SHA-256 **from what arrived**, not from the
   agent's claims, attaches the file at once, and enqueues derivation if it is primary; its
   response says the bytes were received and to call `files.complete_upload` next.
   `files.complete_upload` then confirms idempotently and can add provenance (`derived_from`,
   `derivation_note`, `derived_by`). It returns the file entry (`searchable`, `search_status`) and a
   `note` on what happens next that agrees with it: the primary is being parsed, is ready, is a
   recording that needs a transcript as its own source, or is in a format no parser reads (with the
   formats that are parsed). The last two are said at once, before the worker has run. It also
   returns the source's new etag as `record_etag`, and `warnings` when the source still has no
   primary after a non-primary file arrives. Grants are single-file, create-only, signed, and expire after
   30 minutes by default (`WHATBUILD_GRANT_TTL_SECONDS`). The relay takes at most 25 MB
   (`WHATBUILD_RELAY_MAX_BYTES`); when the deployment enables signed URLs
   (`WHATBUILD_GCS_SIGNED_URLS=1`), the grant also carries a `direct` block for a PUT straight to
   the bucket, up to the per-file limit of 100 MB (`WHATBUILD_FILE_MAX_BYTES`).
2. **Inline note** — `files.add_note { record_id, path, text }`: plain text, at most 2,048 bytes and
   20 lines, with a text extension. For short notes only.
3. **URL fetch** — `files.fetch_url { record_id, url, path?, role }` for public HTTPS material:
   public addresses only, redirects re-checked, size-capped (25 MB by default) and time-capped.
   The part of a URL after `#` never reaches a server, so a single-page app's route fetches only
   its shell; when the URL has a fragment, the result's `warnings` says so.
4. **Web upload** — a person uses the kind-first upload flow. This covers clients with no file
   tools at all; the skill tells agents to ask for it rather than attempt base64.

A source holds at most 50 files and one primary. No operation accepts base64 content.
`files.get_download` returns a short-lived grant (`GET /api/v1/downloads/:file_version_id` with a
grant header) for an agent to read original bytes.

## 6.8 The skill and the Connect page

**The skill** is one versioned Markdown document, `packages/core/src/skill/SKILL.md`, that teaches
an agent the product: the vocabulary, the core loop, product selection, how to cite, how to review
honestly, upload flows, Story authoring via `story.guidance`, and the rule that source text is
data. `scripts/gen-skill.mjs` embeds it in the server bundle, and CI fails if the embedded copy
drifts. One constant, `SKILL_VERSION` in `packages/core/src/ops/meta.ts`, sets the skill's
`metadata.version`, the MCP server version and the `get_skill` advertisement.

- `get_skill` returns `{ name, version, filename, content }`. The server instructions tell an agent
  to compare versions and, when stale or absent, fetch the new one and *propose* installing it
  through its harness — never to self-install silently.

**The Connect page** (`/connect`, "Agents" in the app) lets a person connect an MCP client with no
help from anyone who knows the system. It shows, in steps:

- the MCP endpoint, the Claude Code command for it, and the product-bound address template;
- that the client will ask them to sign in (OAuth); personal access tokens are one link away, under
  Account and tokens;
- the skill: copy the text, download a ZIP, or install scripts (shell and PowerShell) for Claude
  Code that write one file and print what they did;
- connected agents, with when each was last used and a revoke control;
- **a plain statement about the agent's side of the trip**, beside the endpoint: "Connecting an
  agent sends your passages to whoever runs that agent, under their terms, not ours."
  ([§9.1](09-data-lifecycle.md)).

## 6.9 Feedback

`submit_feedback { category, message, tool?, details? }` is available on both adapters and is
write-only ([§4.12](04-data-model.md)). The skill asks agents to use it when a tool's behavior or
guidance misled them, so the product's agent surface improves from real use.
