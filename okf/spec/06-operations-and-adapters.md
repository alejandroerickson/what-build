---
type: Specification
title: Every capability is one registered operation, reached identically over REST and MCP.
description: The operation registry, the error model and bounds, the full catalogue of 128 operations with their REST routes and MCP tools, authorization and agent connection levels, upload flows, the skill and the Connect page.
tags: [spec, operations, rest, mcp, registry, uploads, skill]
generated: {by: agent:claude, at: 2026-10-14}
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
  access: "write",                       // "story" | "read" | "write" | "admin" | "owner" | "any"
  mutates: true,                         // writes an activity event
  summary: "One line, shown in the tool's action list.",
  description: "Guidance returned by describe: when to use it, what it returns, pitfalls.",
  input: z.strictObject({ … }),          // Zod; strict = unknown fields rejected
  rest: { method: "POST", path: "/assumptions/:id/review" },
  mcp: { tool: "assumptions", action: "review" },
  allowArchivedProduct: false,           // true only for products.restore, products.export and deleting the product
  exclusive: false,                      // true only for sandbox.save_baseline and sandbox.reset
  connection: undefined,                 // the agent connection level it needs, when its access alone does not say
  webOnly: false,                        // true only for deleting an organization and its preview
  handler: async (ctx, input) => { … },
});
```

`OPERATIONS` in `packages/core/src/index.ts` lists all 128. From that list, and from nothing else,
the server builds the REST routes, the MCP tools with their `action` enums and JSON Schemas (via
`z.toJSONSchema`), and the `describe` responses. The web app calls the same REST routes through
one small hand-written client (`apps/web/src/lib/api.ts`); there is no generated client and no
OpenAPI document.

A **parity test** (`apps/server/test/mcp.test.ts`, "adapter parity") fails if any operation is
unreachable from either adapter, or if any tool action exists that is not in the registry. The one
exception is what only a person does in the web app (`webOnly`): deleting an organization and its
preview, which MCP never lists and `execute` refuses to anything but the web app.

`execute` (`packages/core/src/execute.ts`) is the one way an operation runs, whichever door the
call came through:

1. **Refuse what the caller may not call at all**, before anything about a product is resolved:
   an operation only a person does in the web app (`403 web_only`), and, for an agent, one above
   its connection's level (`403 connection_level`, [§3.8](03-accounts-teams-and-identity.md)).
   Neither says anything about any product.
2. **Resolve and authorize the scope** ([§3.6](03-accounts-teams-and-identity.md)): a caller
   who cannot see the product gets `404` before their input is even validated. For an agent the
   role in the scope is then capped by its connection's level.
3. **In a public sandbox, admit the visitor** ([§9.7](09-data-lifecycle.md)): whether visitors
   are let in, what a visitor never does, and the limits on calls and writes a minute
   (`403`, `429`). This runs before validation, so a call that is refused still counts as a call.
4. **Validate the input** strictly (`422 invalid_input`, "Nothing was changed"), after renaming an
   accepted alias to its canonical field (§6.5). A visitor's input is then checked for size
   (`413 too_large`).
5. Refuse writes to an archived product (`409 product_archived`) unless the operation allows it.
   An operation with slow work outside the database (`files.fetch_url`'s download) does it now,
   in its `prepare` step, holding no database connection; its checks read through a short
   read-only transaction of their own, and what it fetched is handed to the handler.
6. **Run the handler in one transaction** scoped to the tenant (`app.tenant_id` set for row-level
   security). In a sandbox the transaction holds the sandbox's lock, shared, or alone when the
   operation is `exclusive`; a visitor's daily allowances are counted inside it, so a call that
   fails takes nothing from them. Mutating handlers record their activity event
   ([§4.10](04-data-model.md)) and enqueue background jobs in that same transaction; the worker is
   woken after commit.
7. **Count the call,** however it ended, without delaying it: its operation, door, agent client,
   sandbox or not, and outcome, and the caller under a pseudonym ([§9.1](09-data-lifecycle.md)).
   The MCP adapter counts the calls it refuses before `execute`: under the operation when it
   exists, as `<tool>.(unknown)` for an action that does not, and as `(unknown tool)`.

`ctx` carries the principal, the actor snapshot, the tenant-scoped transaction, the resolved scope
(tenant, team, product, the caller's role), the sandbox the call is in (or null), the ports, the
request time, and `enqueue`. Handlers receive no transport details and no way to reach another
tenant. For a visitor to a sandbox the actor is their made-up name, and the principal handed to
the handler carries that name and no address ([§3.10](03-accounts-teams-and-identity.md)).

## 6.2 Errors

```json
{ "error": { "code": "stale_etag", "status": 409, "message": "…", "details": { "current_etag": "…" } } }
```

| Status | When | Example codes |
|---|---|---|
| 400 | Malformed upload request (relay only) | `invalid_length`, `empty_body` |
| 401 | No or invalid identity or grant | `unauthenticated`, `invalid_grant` |
| 403 | A role too low for the action; an agent connection's level too low for it; something only a person does in the web app; a call outside a scoped MCP connector; a cross-origin cookie write; sign-up not allowed; something a visitor to the public sandbox may not do, or may not do for now | `forbidden`, `connection_level`, `web_only`, `outside_connector_scope`, `forbidden_origin`, `invite_only`, `invitation_wrong_address`, `sandbox_restricted`, `sandbox_read_only`, `sandbox_closed`, `tenant_allowance` |
| 404 | Absent — including everything the caller has no role on | `not_found` |
| 409 | Conflict with current state | `stale_etag`, `product_archived`, `record_archived`, `mockup_archived`, `slug_taken`, `frozen`, `primary_taken`, `source_in_use`, `mockup_on_story`, `already_uploaded`, `upload_used`, `sandbox_organization`, `export_in_progress`, `last_owner`, `quota_exceeded`, `sandbox_full`, `no_baseline` |
| 410 | Deliberately deleted, with a tombstone; an invitation no longer usable | `record_deleted`, `assumption_deleted`, `outcome_deleted`, `story_page_deleted`, `mockup_deleted`, `annotation_deleted`, `invitation_used`, `invitation_expired`, `invite_revoked`, `invite_expired`, `invite_used_up` |
| 413 | Body or file beyond a limit | `too_large` |
| 422 | Invalid input | `invalid_input`, `edit_not_found`, `edit_ambiguous`, `unknown_field`, `unknown_action`, `unknown_tool`, `product_required`, `window_too_large`, `quote_not_found`, `invalid_citation`, `cross_product_reference`, `outcome_cites_a_record`, `invalid_query`, `invalid_cursor`, `invalid_html`, `invalid_patch`, `invalid_upload`, `confirmation_required`, `name_mismatch`, `confidence_requires_human` |
| 429 | Rate limited | `rate_limited` |

- **`403` names the role.** A caller with a role on the product but too low for the action gets
  `403` with `{ role, needed }` in `details` ("You are a viewer on product …; outcomes.create
  needs editor"). With no role at all the answer is `404`, never `403`
  ([§3.5](03-accounts-teams-and-identity.md)). `connection_level` carries `{ level, needed }`
  and says that only the person raises it, under Connect an agent.
- **`quota_exceeded`** carries `{ quota, limit, used, unit }` in `details`. It is returned for the
  50 Story pages and the 50 mockups a product holds ([§9.2](09-data-lifecycle.md)), the mockups'
  adding `archived`, and for a visitor's daily
  allowances in the public sandbox, which add `resets_at` ([§9.7](09-data-lifecycle.md)). A sandbox
  allowance set to 0 is switched off and answers `403 sandbox_restricted` instead.
- **`429`** is returned for sign-in links (five per address per hour), for a fourth URL fetch a
  person starts while three of theirs are in progress (`files.fetch_url`, on each instance), and
  for a visitor's calls and writes a minute in the public sandbox, with
  `{ limit, per, retry_after_seconds }` in `details` and a `Retry-After` header on REST. Rate
  limits for every organization are planned.
- **`413 too_large`** carries `{ limit }`, and for a visitor's input `{ field, limit, unit }`.
- Database unique violations become `409 conflict`; serialization failures become
  `409 concurrent_change` ("Retry"). Anything unexpected is `500 internal`, logged, and never
  leaks details.
- Messages are written for an agent to act on: they say what was wrong and what a correct call
  looks like. `422 invalid_input` leads with the cause, in its own words rather than the validation
  library's: the fields it did not recognize first, each with the required field it was probably
  meant as when one is missing beside it ("`content` is not a field of this action; did you mean
  `notes`?"), then what is missing ("`notes` is required"), then any other problem with a value.
  It ends "Nothing was changed; correct the call and send it again", so a refusal never reads as a
  call with nothing to do ([`schemas.ts`](../../packages/core/src/schemas.ts) `formatIssues`).
  A field that a neighbouring operation takes adds a hint: `derived.text` refusing `start`, `end`
  or `unit` says it reads by code-point `offset` and `limit`, and that those three are
  `read_passage`'s (`WRONG_FIELD_HINTS` in
  [`field-aliases.ts`](../../packages/core/src/field-aliases.ts)). MCP returns the same object as a tool error (`isError: true`) whose text begins with
  the status (`"422: …"`) followed by the JSON.

## 6.3 Bounds and paging

- Lists and search are paged with an opaque `cursor`; responses carry `next_cursor` or `null`.
  Page sizes are per operation: default 50, at most 200 for sources, search, activity and
  revisions; default 25, at most 100 for assumptions and Story versions; outcomes
  default to 100. Asking for more than the maximum is `422`, not a silent clamp.
- `sources.list` orders by `sort`: `added` (newest added first, the default), `date` (the
  source's own date, newest first, undated last), `updated` (details most recently changed first)
  or `title` (A to Z). `order` (`asc` or `desc`) reverses a sort; it defaults to `desc` for the
  three dates and `asc` for title, and undated sources stay last either way. A cursor belongs to
  its sort, order and filters: pass it back with all of them unchanged.
  With `date`, `updated` or `title`, a cursor the sort did not issue is `422 invalid_cursor`. Each
  summary in the list also names its primary file (`primary_file`, or `null`). Every source
  summary carries `uploaded_at` and `updated_at` with their actors.
- Text windows (`derived.text`): at most 20,000 characters per call by default,
  with `truncated` and totals.
- Passages: at most 200 segments and 10 minutes per read ([§5.4](05-derived-layer.md)).
- Lists return summaries — never bodies, HTML, or derived text.
- Times are UTC, in ISO 8601 ([decision](../decisions/times-are-utc-in-data-and-local-where-shown.md)).
- REST request bodies are limited to 5 MB (`413 too_large`), and so are MCP's (`413`, read only
  once the token is checked); file bytes and mockup canvases go through upload grants
  (§6.7). Sign-in (`/auth/*`) and OAuth (`/oauth/*`) bodies are limited to 64 KB (`413`).
- OAuth client registration: at most 50 an hour waiting for their first connection
  (`429 rate_limited`), 10 redirect URIs of 500 characters each ([§3.8](03-accounts-teams-and-identity.md)).

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
as the `ETag` header. Every successful answer names the operation it ran in
`X-WhatBuild-Operation`, which the web app counts changes by ([§9.1](09-data-lifecycle.md)).
Operations that create something answer `201`. Cookie-authenticated writes
must come from the app's own origin (`403 forbidden_origin`).

### The operation catalogue

All 128 operations, generated from `OPERATIONS`. The MCP tool is the operation name's first half;
standalone tools (—) take their fields directly. "Needs" is the minimum role
([§3.5](03-accounts-teams-and-identity.md)); `members` write actions check admin at the level
being changed inside the handler.

| Tool | Action | REST | Needs |
|---|---|---|---|
| `products` | `list` | `GET /api/v1/me/products` | signed in |
| `products` | `create_tenant` | `POST /api/v1/tenants` | an instance owner, or an allowance with room ([§3.3](03-accounts-teams-and-identity.md)) |
| `products` | `tenant_allowances` | `GET /api/v1/tenant-allowances` | instance owner |
| `products` | `set_tenant_allowance` | `PUT /api/v1/tenant-allowances` | instance owner |
| `products` | `remove_tenant_allowance` | `POST /api/v1/tenant-allowances/remove` | instance owner |
| `products` | `usage` | `GET /api/v1/usage` | instance owner |
| `products` | `create_team` | `POST /api/v1/tenants/:tenant/teams` | tenant admin |
| `products` | `create` | `POST /api/v1/teams/:tenant/:team/products` | team admin |
| `products` | `get` | `GET P` | reader |
| `products` | `update` | `PATCH P` | admin |
| `products` | `archive` | `POST P/archive` | admin |
| `products` | `restore` | `POST P/restore` | admin |
| `products` | `delete_impact` | `GET P/delete-impact` | admin |
| `products` | `delete` | `DELETE P` | admin |
| `products` | `delete_tenant_impact` | `GET /api/v1/tenants/:tenant/delete-impact` | owner, in the web app only |
| `products` | `delete_tenant` | `DELETE /api/v1/tenants/:tenant` | owner, in the web app only |
| `products` | `export` | `POST P/exports` | viewer |
| `products` | `exports` | `GET P/exports` | viewer |
| `members` | `list` | `GET /api/v1/tenants/:tenant/members` | tenant member |
| `members` | `grant` | `POST /api/v1/tenants/:tenant/members` | admin at the target |
| `members` | `revoke` | `POST /api/v1/tenants/:tenant/members/revoke` | admin at the target; tenant admin with `whole_tenant` |
| `members` | `cancel_invitation` | `POST /api/v1/tenants/:tenant/invitations/cancel` | admin at the target |
| `members` | `activity` | `GET /api/v1/tenants/:tenant/members/activity` | tenant admin |
| `sandbox` | `status` | `GET /api/v1/tenants/:tenant/sandbox` | tenant member |
| `sandbox` | `join` | `POST /api/v1/sandbox/join` | signed in |
| `sandbox` | `settings` | `GET /api/v1/tenants/:tenant/sandbox/settings` | tenant admin |
| `sandbox` | `update_settings` | `PATCH /api/v1/tenants/:tenant/sandbox/settings` | tenant admin |
| `sandbox` | `save_baseline` | `POST /api/v1/tenants/:tenant/sandbox/baselines` | tenant admin |
| `sandbox` | `baselines` | `GET /api/v1/tenants/:tenant/sandbox/baselines` | tenant admin |
| `sandbox` | `reset` | `POST /api/v1/tenants/:tenant/sandbox/reset` | tenant admin |
| `sandbox` | `invites` | `GET /api/v1/tenants/:tenant/sandbox/invites` | tenant admin |
| `sandbox` | `create_invite` | `POST /api/v1/tenants/:tenant/sandbox/invites` | tenant admin |
| `sandbox` | `revoke_invite` | `POST /api/v1/tenants/:tenant/sandbox/invites/revoke` | tenant admin |
| `sandbox` | `visitors` | `GET /api/v1/tenants/:tenant/sandbox/visitors` | tenant admin |
| `sandbox` | `remove_visitor` | `POST /api/v1/tenants/:tenant/sandbox/visitors/remove` | tenant admin |
| `outcomes` | `list` | `GET P/outcomes` | viewer |
| `outcomes` | `get` | `GET P/outcomes/:outcome_id` | viewer |
| `outcomes` | `create` | `POST P/outcomes` | editor |
| `outcomes` | `update` | `PATCH P/outcomes/:outcome_id` | editor |
| `outcomes` | `archive` | `POST P/outcomes/:outcome_id/archive` | editor |
| `outcomes` | `restore` | `POST P/outcomes/:outcome_id/restore` | editor |
| `outcomes` | `revisions` | `GET P/outcomes/:outcome_id/revisions` | viewer |
| `outcomes` | `get_revision` | `GET P/outcomes/:outcome_id/revisions/:n` | viewer |
| `outcomes` | `restore_revision` | `POST P/outcomes/:outcome_id/revisions/:n/restore` | editor |
| `outcomes` | `delete_impact` | `GET P/outcomes/:outcome_id/delete-impact` | viewer |
| `outcomes` | `delete` | `DELETE P/outcomes/:outcome_id` | admin |
| `sources` | `facets` | `GET P/sources/facets` | viewer |
| `sources` | `list` | `GET P/sources` | viewer |
| `sources` | `get` | `GET P/sources/:record_id` | viewer |
| `sources` | `create` | `POST P/sources` | editor |
| `sources` | `update` | `PATCH P/sources/:record_id` | editor |
| `sources` | `archive` | `POST P/sources/archive` | editor |
| `sources` | `restore` | `POST P/sources/restore` | editor |
| `sources` | `annotate` | `POST P/sources/:record_id/annotations` | editor |
| `sources` | `list_annotations` | `GET P/sources/:record_id/annotations` | viewer |
| `sources` | `update_annotation` | `PATCH P/annotations/:annotation_id` | editor |
| `sources` | `delete_annotation` | `DELETE P/annotations/:annotation_id` | admin |
| `sources` | `used_by` | `GET P/sources/:record_id/used-by` | viewer |
| `sources` | `move_to_product` | `POST P/sources/:record_id/move` | editor |
| `sources` | `copy_to_product` | `POST P/sources/:record_id/copy` | editor |
| `sources` | `delete_impact` | `GET P/sources/:record_id/delete-impact` | viewer |
| `sources` | `delete` | `DELETE P/sources/:record_id` | admin |
| `files` | `request_upload` | `POST P/sources/:record_id/uploads` | editor |
| `files` | `create_upload` | `POST P/sources/with-upload` | editor |
| `files` | `create_uploads` | `POST P/sources/with-uploads` | editor |
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
| `assumptions` | `delete_impact` | `GET P/assumptions/:id/delete-impact` | viewer |
| `assumptions` | `delete` | `DELETE P/assumptions/:id` | admin |
| `story` | `guidance` | `GET P/story/guidance` | viewer |
| `story` | `get_style` | `GET P/story/style` | viewer |
| `story` | `set_style` | `PUT P/story/style` | editor |
| `story` | `list_pages` | `GET P/story/pages` | reader |
| `story` | `get_page` | `GET P/story/pages/:page_id` | reader |
| `story` | `list_versions` | `GET P/story/pages/:page_id/versions` | reader |
| `story` | `get_version` | `GET P/story/pages/:page_id/versions/:version` | reader |
| `story` | `preview` | `POST P/story/pages/:page_id/preview` | editor |
| `story` | `publish` | `POST P/story/pages/:page_id/versions` | editor |
| `story` | `promote_mockup` | `POST P/story/promote-mockup` | editor |
| `story` | `write_notes` | `PUT P/story/pages/:page_id/notes` | editor |
| `story` | `check_citations` | `GET P/story/pages/:page_id/check-citations` | viewer |
| `story` | `print_view` | `GET P/story/print-view` | reader |
| `story` | `get_hierarchy` | `GET P/story/hierarchy` | reader |
| `story` | `set_hierarchy` | `PUT P/story/hierarchy` | editor |
| `story` | `archive_page` | `POST P/story/pages/:page_id/archive` | editor |
| `story` | `restore_page` | `POST P/story/pages/:page_id/restore` | editor |
| `story` | `delete_page_impact` | `GET P/story/pages/:page_id/delete-impact` | viewer |
| `story` | `delete_page` | `DELETE P/story/pages/:page_id` | admin |
| `mockups` | `list` | `GET P/mockups` | viewer |
| `mockups` | `get` | `GET P/mockups/:mockup_id` | viewer |
| `mockups` | `list_versions` | `GET P/mockups/:mockup_id/versions` | viewer |
| `mockups` | `get_version` | `GET P/mockups/:mockup_id/versions/:version` | viewer |
| `mockups` | `request_upload` | `POST P/mockups/uploads` | editor |
| `mockups` | `publish` | `POST P/mockups` | editor |
| `mockups` | `archive` | `POST P/mockups/:mockup_id/archive` | editor |
| `mockups` | `restore` | `POST P/mockups/:mockup_id/restore` | editor |
| `mockups` | `get_download` | `POST P/mockups/:mockup_id/downloads` | viewer |
| `mockups` | `check_citations` | `GET P/mockups/:mockup_id/check-citations` | viewer |
| `mockups` | `delete_impact` | `GET P/mockups/:mockup_id/delete-impact` | viewer |
| `mockups` | `delete` | `DELETE P/mockups/:mockup_id` | admin |
| `lineage` | `capture` | `POST P/lineage/capture` | viewer |
| `lineage` | `write` | `POST P/sources/:record_id/lineage` | editor |
| `lineage` | `check` | `GET P/sources/:record_id/lineage` | viewer |
| `activity` | `list` | `GET P/activity` | viewer |
| `get_skill` | — | `GET /api/v1/skill` | signed in |
| `submit_feedback` | — | `POST /api/v1/feedback` | signed in |

Notes on recent actions:

- Sources are described by tags; they have no kind, organization or folder
  ([decision](../decisions/sources-are-described-by-tags.md)). `sources.facets` replaced
  `sources.kinds`: it returns `{ sources, tags: [{ tag, count }], tags_truncated, added_by:
  [{ account_id, display_name, count }] }` for the product, counting live sources unless
  `include_archived` ([§4.4](04-data-model.md)). `sources.list` lost `folder`, `kind` and
  `organization` and gained `added_by` and `added_since`; `search` lost the same three filters.
  `sources.create`, `sources.update` and `files.create_upload` take no `kind` or `organization`.
  Source summaries, `search`'s `records` (now `{ title, date, tags, archived_at }`),
  `read_passage`'s `record` and a Story version's `resolved_refs` carry no kind, and
  `sources.used_by` gives `tags` for related sources and views. A call to a `sources`, `files` or
  `search` operation naming `kind`, `organization` or `folder` is `422 invalid_input`, with a hint
  to use tags and `sources(action="facets")`.
- Insights and decisions are retired, with their operations and their MCP tools; what a product
  held of them became sources ([§4.7](04-data-model.md)). `sources.used_by` replaced
  `sources.insights_for`, and lists the sources that name a source in `related_records`.
- `assumptions.update` takes `edits` (exact replacements that must match once) and returns
  `changed` and a short `diff` ([§4.1](04-data-model.md)). Without `status`, the assumption list
  returns the current entries (unconfirmed and confirmed), the ones every count counts, with
  `not_current_hidden` (the refuted and superseded ones matching its other filters) and, when that
  is not zero, a `note`; a `status` list names what to return instead. It returns
  `frozen`, `superseded_by` (the ids of the entries whose `supersedes` link points at the entry, newest
  first, so a list can show history under its correction without a `get` per entry),
  `link_count` and `linked_from_count`; `outcomes.list` returns
  `archived_hidden` ([§4.2](04-data-model.md), [§4.8](04-data-model.md)).
- `story.publish` takes `citations` (up to 20 exact passages, snapshotted as on assumptions)
  beside `refs`; `story.check_citations` checks a version's citations. The page is given as
  `body` (the markup inside `<body>`; the server adds the product's Story style) or as `html` (a
  whole document). A later version keeps the
  `title`, `summary`, page, `refs` and `citations` it omits, `patch_html` edits the HTML by exact
  find and replace, `restyle` replaces the page's stylesheet with the product's current one, and
  `from_version` starts from an earlier version, which restores it
  ([§4.11](04-data-model.md)). Versions report `html_sha256`. A version has no change note:
  `note` is refused like any unknown field (`422`), and versions do not return one.
- `story.preview` takes exactly `story.publish`'s input and makes every check publish makes, in
  the same code, refusing with the same errors; it creates no version, records no activity and
  answers `200`. It returns what publish would make (`new_page`, `based_on_version`,
  `carried_forward`, `title`, `summary`, `html_chars`, `html_sha256`, `published: false`) and
  `preview { preview_id, method: "GET", url, headers, expires_at }`, a download grant for the
  document publish would store ([§4.11](04-data-model.md)).
- `story.get_style` and `story.set_style` read and replace the product's Story style, the design
  system every page follows: an adopted house style (`house_style`) or the team's own
  (`name`, `rules`, `stylesheet`), with its own etag; `422 invalid_style` lists every problem
  ([§4.11](04-data-model.md)). `story.guidance` takes `house_style` to return one house style in
  full. Beside the operations, `GET P/story/style/specimen` and
  `GET P/story/house-styles/:style/specimen` serve sample pages in the Story sandbox for the app's
  previews.
- `story.write_notes` replaces a page's notes for agents. The notes carry their own etag
  (`publish` → `agent_notes_etag`, `get_page` → `agent_notes.etag`), separate from the page etag,
  and are not versioned with the page. While the notes are empty the etag may be omitted.
- A reader's `story.get_page`, `story.list_versions` and `story.get_version` leave out `refs`,
  `resolved_refs`, `citations`, `citation_count` and `agent_notes`, and their `products.get` and
  `products.list` leave out `concept` and count only `story_pages` (and `stage_counts.story`)
  ([§3.5](03-accounts-teams-and-identity.md)).
- `mockups.publish` creates a mockup, or publishes the next version of one: the whole canvas,
  with its brief, its pages in order and each page's notes and size, and the files it carries for
  collaborators. A later version keeps what it omits, and a page or file that keeps its id or path
  keeps its content unless it is sent. `mockups.get` and `get_version` take `include_files` to
  return the files' content. `mockups.request_upload` returns a grant to PUT the canvas as a ZIP
  in `get_download`'s layout, and `mockups.publish { upload_id }` reads it in place of `pages`,
  `files` and the brief, so no page's HTML travels through a tool call; it is refused to a visitor
  to a public sandbox (`403`), and the result names `from_upload` and gives `upload { upload_id,
  size, sha256 }`, the ZIP as its PUT answered ([§4.12](04-data-model.md), §6.7). A page is held
  to a mockup page's HTML rules, not a Story page's: scripts without a budget, and forms whose
  submit handlers run and whose submissions go nowhere. `publish`'s and `request_upload`'s
  descriptions state what a page may hold and what is refused, that a refused publish changes
  nothing and leaves an upload unused, and what a frame does with a page taller than its height.
  `mockups.list` returns `archived_hidden` (and a `note` when it is not zero) and
  `quota { used, limit, unit, archived_included }`.
  `mockups.get_download` gives a version as a ZIP through a grant, for an agent to build the next
  version elsewhere; `mockups.check_citations` checks a version's citations
  ([§4.12](04-data-model.md)). `mockups.get` lists the Story pages that show its pages.
- `story.promote_mockup` publishes a Story page version that shows one page of a mockup version,
  on a new page or as an existing page's next version, without copying it; the version reports
  `mockup` with the page's size. It answers `201` like `publish` ([§4.11](04-data-model.md)).
  The page appears among the Story's Published mockups at once (`placed: true`).
- `story.get_hierarchy` returns the tree as saved as `items`, the live pages not yet placed as
  `unplaced` (`{page_id, title, description}`, never also in `items`) and the Published mockups as
  `mockups`, in order. Its `items` round-trip: `story.set_hierarchy` accepts them as they are
  (the `title` and `description` on each node are ignored), and placing a page is adding it there.
  `story.set_hierarchy` takes the
  tree and, optionally, `mockups` to reorder that section ([§4.11](04-data-model.md)). Before the
  first save its `expected_etag` may be null or left out; once saved, leaving it out is
  `409 stale_etag`, saying to read `get_hierarchy`.
- `outcomes.create` takes an optional `position`, as `update` does, to place the new outcome
  between two others; omitted, it goes last ([§4.2](04-data-model.md)).
- `sources.used_by` lists the mockups whose current version cites or lists the source,
  `sources.move_to_product` refuses while one does, and `sources.delete_impact` lists every
  mockup version that cites it (`mockup_versions_citing`), as each does for Story pages.
- `members.list` takes an optional `product` to list only the people who can reach it, each with
  `product_access { role, via }`. It answers `403` to someone who reads only the Story everywhere
  in the organization, and `products.list` marks such an organization `story_only: true`
  ([§3.5](03-accounts-teams-and-identity.md)). Owners and admins of the organization get everyone,
  every grant and every invitation. Anyone else gets `partial: true` and only the people on the
  teams and products they read (viewer or above), with those grants and their organization role,
  and only the invitations they could cancel; a `product` they cannot read answers `404`, or
  `403` where they are its reader.
- The `members` writes answer a team or product the caller has no role on with the same `404` as
  one that does not exist, before anything else is checked, so they never name it.
- `members.revoke` removes the grant at exactly the scope named; with `whole_tenant: true` (and no
  team or product) it removes every grant the person holds in the tenant, which takes them out of
  it. That needs tenant admin, or owner when they are an owner.
- `activity.list` takes `by: "people" | "agents"` (agents = calls over MCP), besides
  `entity_type`, `entity_id`, `actor`, `channel` and `since`.
- `members.activity` is the organization's access log, for its owners and admins: roles given,
  changed and removed, people removed from the organization, invitations sent, accepted and
  cancelled, and in a public sandbox its invitation links, removed visitors and changed settings.
  It takes `actor`, `since`, `limit` and `cursor`, and pages like `activity.list`. A product's
  `activity.list` leaves these events out, because they belong to the organization.

### Routes outside the registry

These carry bytes, identity or discovery, not operations:

```
PUT  /api/v1/uploads/:grant_id                       upload relay (grant header is the credential)
PUT  /api/v1/uploads/mockup/:upload_id               a mockup canvas's ZIP, under its upload grant
GET  /api/v1/downloads/:file_version_id              file bytes under a download grant
GET  /api/v1/downloads/export/:export_id             an export ZIP under a download grant
GET  P/sources/:record_id/file?path=&version=&download=1   file bytes for the web app (ranged)
GET  P/exports/:export_id/file                       an export ZIP for the web app
GET  P/story/pages/:page_id/versions/:version/html?theme=light|dark   Story page HTML
GET  P/story/print?page_ids=…                        the Story print view (HTML)
GET  P/mockups/:mockup_id/versions/:version/pages/:page_id/html   a mockup page's HTML
GET  /api/v1/downloads/mockup/:version_id            a mockup version's ZIP under a download grant
GET  /api/v1/downloads/story-preview/:preview_id?theme=light|dark   a Story preview's HTML under its grant
GET  /api/v1/meta                                    server and skill version, release, sign-in methods (public)
GET  /api/v1/connect                                 what the Connect page shows
GET|PATCH /api/v1/me; GET /api/v1/me/agents; DELETE /api/v1/me/agents/:family
POST /api/v1/invitations/accept
GET  /api/v1/sandbox/invite?code=                    what a sandbox invitation is, before sign-in (public)
POST /api/v1/sandbox/reset-if-due                    runs a sandbox's reset if its hour has passed (public)
/auth/*  /oauth/*  /.well-known/oauth-*              sign-in and OAuth (§6.6)
/health  /whatbuild-skill.md  /whatbuild-skill.zip
```

**Bytes are served by the service itself**, streamed from the object store with
`X-Content-Type-Options: nosniff`, a `Content-Disposition`, range support,
`Cache-Control: private, no-store`, and a sandboxing `Content-Security-Policy` that lets only the
app frame them. Uploaded HTML, XHTML and SVG are always sent as
`application/octet-stream` attachments, never renderable from the application's origin.

**The two sandbox routes need no identity.** `GET /api/v1/sandbox/invite` answers the page behind
an invitation link: the invitation's `status` (`open`, `used_up`, `expired`, `revoked`, `full` or
`closed`), the organization's name, the notice, the reset's hour and four of the limits; an
unknown code is `404`. `POST /api/v1/sandbox/reset-if-due` is for a scheduler: it does nothing
unless a reset is due, and a due reset would run at the next request anyway
([§9.7](09-data-lifecycle.md)).

**Story page HTML** is served with a sandbox policy that allows the page's inline scripts but no
network, no same-origin access and no framing outside the app. `?theme=light|dark` writes the
app's resolved theme onto the page's `<html>` for that response only; the stored HTML is
unchanged. It is a Story read, so a reader reaches it; a source's file, an export's file, the
style specimens and a mockup page's HTML need viewer. A mockup page's HTML is served in the same
sandbox, with the same `?frame=1`, and without `?theme`: a mockup carries its own look. Its
sandbox adds `allow-forms`, so a prototype's submit handler runs, here and on the Story's route
when a version shows a mockup page; every page's policy says `form-action 'none'`, so a
submission goes nowhere, wherever it is shown.
A Story preview's document is served by the same code as a version's HTML, in the Story's
sandbox (a mockup page's when the preview keeps showing one), `?theme` and the carried typefaces
included, to whoever holds its grant (`X-WhatBuild-Download-Grant`): no session opens it, and an
expired or dropped preview is `404`.

### The Story print view

`story.print_view { page_ids }` (1–50 page ids, comma-separated in a query string) plans a print
view: exactly the pages named, each at its current version, in the Story's order — a depth-first
walk of the tree, the pages not yet placed, then the Published mockups in their order, and
archived pages last, by title; a reader is given no archived page, which is missing for them
([§3.5](03-accounts-teams-and-identity.md)). Each page
carries `depth` (its depth in the hierarchy) and `level` (its outline level among the chosen
pages: one more than the number of chosen ancestors, so the outline never skips a level). The
result also gives `path` and `url` for the document itself.

`GET P/story/print?page_ids=…` answers that document as HTML, for a person to open in a browser
tab and save as PDF with the browser's print dialog. The server renders no PDF
(`packages/core/src/story-print.ts`). The document has:

- a title block (the product name and the export date) and a contents list. Each date is a
  `<time>` written in UTC, which the document's script rewrites in the reader's time zone
  ([decision](../decisions/times-are-utc-in-data-and-local-where-shown.md));
- each page's title as a heading at its level (the document title is `h1`, a top-level page `h2`,
  capped at `h6`), a line with its version and publication date, then the page itself. A leading
  `<h1>` in the page that repeats its title is dropped;
- each page's body inside its own declarative shadow root (`<template shadowrootmode="open">`), so
  pages cannot restyle each other. The page's `:root`, `html` and `body` selectors are rewritten to
  `:host`, its `<html>` and `<body>` attributes (`class`, `lang`, `dir`, `style`, `data-*`) are
  carried onto the shadow host, and dark-scheme media queries apply on screen only;
- `@page` margins, and a page break before each top-level section.

Page scripts and inline event handlers are removed, and the response's policy runs only the one
nonce'd script, which puts the dates in the reader's time zone and opens the print dialog on load:
`sandbox allow-modals allow-scripts; default-src 'none'; script-src 'nonce-…'; style-src 'unsafe-inline'; img-src data:; font-src data:; …`
— without `allow-same-origin`, so the view runs in an opaque origin. Content a page draws with
JavaScript does not appear.

## 6.5 MCP

**Transport.** Stateless Streamable HTTP (`apps/server/src/mcp.ts`), JSON responses, at:

- `/mcp` — everything the account can reach;
- `/mcp/t/:tenant` — scoped to one organization. Tenant- and team-scoped calls default to it;
- `/mcp/t/:tenant/:team/:product` — scoped to one product. Product-scoped calls may then omit
  `product`.

A scoped endpoint refuses every call outside its scope with `403 outside_connector_scope`, lists
only what is inside it, and accepts only a token approved for it or for an endpoint containing it
([§3.6](03-accounts-teams-and-identity.md#36-addressing-and-isolation),
[§3.8](03-accounts-teams-and-identity.md#38-identity-of-the-caller)).

Each `POST` builds a fresh server; there is no session and any replica serves any call. `GET` and
`DELETE` answer `405` (no server-initiated stream, no session to end). An unauthenticated call gets
`401` with a `WWW-Authenticate` header pointing at the protected-resource metadata. The server's
`initialize` info names it `whatbuild` with the skill version, and its instructions tell the agent
to check its installed skill's version, start with `products(action="list")`, confirm the product
before the first write, read `sandbox(action="status")` and tell the person its notice before
writing in a tenant marked `sandbox`, and treat source text as quoted material. They name the
deployment's address (`WHATBUILD_PUBLIC_URL`) and tell the agent to write every link to WhatBuild
with it, never with another host name it has seen for the deployment
([§2.3](02-architecture.md#23-the-shape-of-the-deployment)). On a scoped
endpoint they add one sentence naming the scope, saying calls outside it are refused, and telling
the agent to ask the person for another connector rather than look for a way around it.

Because there is no session, the server cannot send `notifications/tools/list_changed`: a client
keeps the tool list it got when it connected until a new session, and authorizing again does not
refresh it. ◆ Decision: say so rather than build sessions for it. The instructions tell the agent
that a tool the skill describes but its list lacks, or a skill newer than the version they name,
means an older list, and to ask the person to start a new session; `get_skill`'s description says
the same of a newer version than the instructions named. `unknown_tool` and `unknown_action` name
the server's version and its tools or the tool's actions (also in `details`: `server_version`,
`tools` or `actions`), and say the client may hold a list from another version.

**Tools.** Sixteen tools over the 126 operations an agent may be offered (all 128 but deleting an
organization and its preview): twelve grouped by noun, four standalone. A connection is listed
only the actions its level allows (below).

| Tool | Actions |
|---|---|
| `products` | `list`, `create_tenant`, `create_team`, `create`, `get`, `update`, `archive`, `restore`, `delete_impact`, `delete`, `export`, `exports` |
| `members` | `list`, `grant`, `revoke`, `cancel_invitation`, `activity` |
| `sandbox` | `status`, `join`, `settings`, `update_settings`, `save_baseline`, `baselines`, `reset`, `invites`, `create_invite`, `revoke_invite`, `visitors`, `remove_visitor` |
| `outcomes` | `list`, `get`, `create`, `update`, `archive`, `restore`, `delete_impact`, `delete`, `revisions`, `get_revision`, `restore_revision` |
| `sources` | `facets`, `list`, `get`, `create`, `update`, `archive`, `restore`, `annotate`, `list_annotations`, `update_annotation`, `delete_annotation`, `used_by`, `move_to_product`, `copy_to_product`, `delete_impact`, `delete` |
| `files` | `request_upload`, `create_upload`, `create_uploads`, `complete_upload`, `add_note`, `fetch_url`, `set_role`, `get_download` |
| `derived` | `manifest`, `outline`, `text`, `list`, `rederive`, `write_note`, `read_note` |
| `assumptions` | `list`, `get`, `create`, `update`, `review`, `supersede`, `link`, `unlink`, `archive`, `check_citations`, `delete_impact`, `delete` |
| `story` | `guidance`, `get_style`, `set_style`, `list_pages`, `get_page`, `list_versions`, `get_version`, `preview`, `publish`, `promote_mockup`, `write_notes`, `check_citations`, `print_view`, `get_hierarchy`, `set_hierarchy`, `archive_page`, `restore_page`, `delete_page_impact`, `delete_page` |
| `mockups` | `list`, `get`, `list_versions`, `get_version`, `request_upload`, `publish`, `archive`, `restore`, `get_download`, `check_citations`, `delete_impact`, `delete` |
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
- **Aliases for names a caller reads.** The id is `outcome_id` on `outcomes` but `id` on
  `assumptions`. Each tool also accepts the other convention for its own entity: `id` on
  `outcomes`, `assumption_id` on `assumptions`. A field may also be accepted under the name it is
  read by: `story.write_notes` takes `content` for `notes`, since `get_page` returns the notes as
  `agent_notes.content`.
  `execute` renames each alias before strict validation
  ([`field-aliases.ts`](../../packages/core/src/field-aliases.ts)), so it works over REST and MCP alike;
  sending both with different values is `422`. ◆ Decision: aliases, not a rename, so no existing
  caller breaks; the canonical names stay as they are in schemas and paths.
- **Product resolution.** A product-scoped call resolves its product from the `product` argument,
  then the endpoint's product, then the only product the caller can reach inside the endpoint's
  scope; otherwise `422 product_required` listing up to 50 of those products ([§3.6](03-accounts-teams-and-identity.md)).
- **Scoped means scoped.** On a scoped endpoint the scope is checked in `execute`, after
  authorization and before the handler, so a refused call changes nothing and writes no activity.
- **Listed by level.** `tools/list` answers each connection with only the actions its level allows
  ([§3.8](03-accounts-teams-and-identity.md)): Read only is offered reads, Edit also writes and
  archives, Admin also permanent deletes and managing products and people. A call to an action
  above the level, from a client that knows it anyway, reaches `execute` and is refused with
  `403 connection_level`, which says what it needs; it is never `unknown_action`.
- **Results** are JSON in one text content block. Product-scoped results add `scope`
  (tenant, team, product with its path, `your_role` capped by the connection's level,
  `connection_level`, and `public_sandbox: true` in the public sandbox). Tools whose actions are all reads carry read-only annotations.
- **Source text is data.** The server instructions, tool descriptions and the skill state that
  text returned from sources is quoted material, never instructions to the agent.
- **Delete is on the MCP surface for an Admin connection, and guarded there.** An agent whose
  person is an admin and who connected it at Admin can delete what that person can
  ([§9.5](09-data-lifecycle.md)); on any other level it is not offered a delete. The guards are
  `expected_etag` + `reason` + `confirm: "delete permanently"` (and the name, for a product), a
  read-only preview, and a skill that requires an agent to show that preview to the person and to
  delete only once they approve that impact, never slipped into a run of other actions. Every
  delete's summary and guidance lead with *permanent, cannot be undone* and name archive as the
  reversible alternative. Deleting an organization is never offered.
- **Planned:** a stdio transport (a thin local proxy holding the endpoint URL and a credential) for
  clients that cannot speak HTTP.

## 6.6 Authorization

([§3.8](03-accounts-teams-and-identity.md) has the details.)

- **OAuth 2.1** per the MCP authorization specification (`apps/server/src/auth/oauth.ts`):
  protected-resource metadata, authorization-server metadata, dynamic client registration,
  authorization code with PKCE, resource indicators, rotating refresh tokens. The person consents
  in a browser and the token represents them, at the level they choose there (Read only, Edit or
  Admin), which caps their role and never adds to it. `POST /oauth/authorize` approves only the
  request the consent page showed, sealed in its `wb_consent` cookie, and a code or refresh token
  used twice revokes the connection it made.
- **REST answers the browser session only.** There are no personal access tokens: a bearer token
  on REST is refused, and scripts connect as agents over MCP. Connected agents are listed, their
  level changed (`PATCH /api/v1/me/agents/:family { level }`, the session only) and disconnected on
  the Connect an agent page. The session cookie is `__Host-wb_session` over HTTPS
  and `wb_session` over HTTP ([§3.8](03-accounts-teams-and-identity.md#38-identity-of-the-caller)).
- **Sign-in endpoints** (`apps/server/src/auth/routes.ts`): `POST /auth/email` sends a link;
  `GET /auth/verify?token=` shows its page and changes nothing, and `POST /auth/verify` (form field
  `token`, same origin only) uses it and signs in; `GET /auth/google`, `/auth/microsoft` and their
  `/callback`s run OpenID Connect; `POST /auth/dev-sign-in` exists outside production;
  `POST /auth/sign-out`; `GET /auth/session` answers the web app's "who is signed in" with
  `signed_in` and, when true, what `GET /api/v1/me` returns, so being signed out is a `200` there
  and not an error the browser logs (`/api/v1/me` and every operation still answer `401` without a
  session); `GET /auth/methods` lists what is on
  ([§3.2](03-accounts-teams-and-identity.md#32-accounts-and-sign-in)).
- Both adapters build the actor snapshot from the authenticated identity and the transport
  (`web` or `mcp`, plus the client's name; activity from before tokens were removed may say
  `rest`). No input field can set or alter it.

## 6.7 Getting files in

In order of preference for an agent (`packages/core/src/ops/files.ts`):

1. **Upload grant** — `files.request_upload { record_id, path, role, media_type?, size? }`, or
   `files.create_upload` to create the source and get its first grant in one call, or
   `files.create_uploads { sources: [...] }` for up to 20 such sources at once (all are created or
   none, and a refusal names the entry by index). The result is
   `{ grant_id, url, method: "PUT", headers, max_bytes, expires_at, next, warnings }`
   (`create_upload` returns `{ record, upload, warnings }`, `create_uploads` a list of them as `items`). `warnings` flags, without refusing, a
   primary whose format no parser reads, since a primary cannot be replaced (upload a PDF export as
   the primary and keep the original as `origin`), and for `create_upload` a live source with the
   same title and date. The agent PUTs the
   local file's raw bytes to `url` (the service's own upload relay,
   `/api/v1/uploads/:grant_id`) with exactly those headers, using whatever shell or HTTP tool it
   has. The relay first checks that whoever requested the grant can still write to the product
   (`403 forbidden` otherwise, for someone made a reader or viewer, or removed, since), then
   stores the bytes, records size and SHA-256 **from what arrived**, not from the
   agent's claims, attaches the file at once, and enqueues derivation if it is primary; its
   `201` response carries the file entry, so nothing more need be called.
   `files.complete_upload` attaches a file PUT to a `direct` URL; after the relay it only confirms,
   idempotently, and can add provenance (`derived_from`, `derivation_note`, `derived_by`). Both
   return the file entry (`searchable`, `search_status`) and a
   `note` on what happens next that agrees with it: the primary is being parsed, is ready, is a
   recording that needs a transcript as its own source, or is in a format no parser reads (with the
   formats that are parsed). The last two are said at once, before the worker has run. It also
   returns the source's new etag as `record_etag`, and `warnings` when the source still has no
   primary after a non-primary file arrives. Grants are single-file, create-only, signed, and expire after
   30 minutes by default (`WHATBUILD_GRANT_TTL_SECONDS`). The relay takes at most 25 MB
   (`WHATBUILD_RELAY_MAX_BYTES`); when the deployment enables signed URLs
   (`WHATBUILD_GCS_SIGNED_URLS=1`), the grant also carries a `direct` block for a PUT straight to
   the bucket, up to the per-file limit of 100 MB (`WHATBUILD_FILE_MAX_BYTES`). The direct URL is
   signed with that limit as the allowed body size (`x-goog-content-length-range`, among the
   headers to send), so the bucket refuses a larger body; `files.complete_upload` reads the
   object's size first, discards an object over the grant's size with `413 too_large`, and hashes
   the bytes as it streams them, never trusting a hash stored beside them.
2. **Inline note** — `files.add_note { record_id, path, text }`: plain text, at most 2,048 bytes and
   20 lines, with a text extension. For short notes only.
3. **URL fetch** — `files.fetch_url { record_id, url, path?, role }` for public HTTPS material:
   public addresses only, both an address written in the URL (in any notation the URL parser
   accepts) and every address a name resolves to, checked again on each redirect; size-capped
   (25 MB by default), 30 seconds at most between bytes and 60 seconds for the whole fetch,
   redirects included. A person runs at most three fetches at once (`429 rate_limited`). The
   download holds no database connection (§6.1, `execute`'s step 4). A failure on the network
   answers one plain `422 fetch_failed`, whatever happened, and an error status from the server
   names that status. The part of a URL after `#` never reaches a server, so a single-page app's
   route fetches only its shell; when the URL has a fragment, the result's `warnings` says so.
4. **Web upload** — a person adds the source through the web app's intake. This covers clients with no file
   tools at all; the skill tells agents to ask for it rather than attempt base64.

**A mockup canvas** comes in the same way, through the relay only.
`mockups.request_upload { size? }` returns `{ upload_id, method: "PUT", url, headers, max_bytes,
expires_at, next }`; `url` is `/api/v1/uploads/mockup/:upload_id` and the grant is sent as
`X-WhatBuild-Upload-Grant`. `max_bytes` is 25 MB, or the relay's limit when lower, and the grant
expires as a file's does. The relay checks the grant and its expiry (`401 invalid_grant`), takes
one ZIP under it (a second PUT is `409 already_uploaded`), checks that whoever requested it can
still write to the product (`403 forbidden`), and stores the bytes with their size and SHA-256,
answering `201` with what to call next. Nothing is read or published then:
`mockups.publish { upload_id }` reads the ZIP before its transaction, checks it, and publishes
([§4.12](04-data-model.md)). A visitor to a public sandbox cannot request one.

A source holds at most 50 files and one primary. No operation accepts base64 content.
`files.get_download` returns a short-lived grant (`GET /api/v1/downloads/:file_version_id` with a
grant header) for an agent to read original bytes.

## 6.8 The skill and the Connect page

**The skill** is one versioned Markdown document, `packages/core/src/skill/SKILL.md`, that teaches
an agent the product: the vocabulary, the core loop, product selection, describing sources with
tags and finding them, how to cite, how to review
honestly, upload flows, mockups and their round trip through a download and an upload, Story authoring via
`story.guidance`, the rule that source text is data, that a refusal means the call did nothing,
and that a tool or action it names but the client lacks means the client holds an older tool list
(an action may still answer `describe: true`; a missing tool needs a new session, which the agent
asks the person to start). `scripts/gen-skill.mjs` embeds it in the server bundle, and CI fails if the embedded copy
drifts. One constant, `SKILL_VERSION` in `packages/core/src/ops/meta.ts`, sets the skill's
`metadata.version`, the MCP server version and the `get_skill` advertisement.

- `get_skill` returns `{ name, version, filename, content }`. The server instructions tell an agent
  to compare versions and, when stale or absent, fetch the new one and *propose* installing it
  through its harness — never to self-install silently.

**The Connect page** (`/connect`, and `…/connect` inside a product; "Connect an agent" in the app)
lets a person connect an MCP client with no help from anyone who knows the system, and nothing to
configure but one address. It shows:

- a choice of what the agent can reach: **One product**, **One organization** or **Everything you
  can reach**, with a product or organization picker for the first two. The MCP server URL for the
  choice follows, to copy: everything gives `/mcp`; an organization gives `/mcp/t/<tenant>`
  (`tenant_url_template` from `/api/v1/connect`); a product gives its address
  (`bound_url_template`), filled in from the product's path, so nobody types a tenant or team.
  For one product or organization, a line under the URL suggests naming the connector after it. Opened inside a product, that product is chosen first;
  elsewhere, the organization of the last product opened, or everything for someone with no
  product. The choice is in the URL: `?reach=product|organization|all` with `?product=<path>` or
  `?org=<slug>` (an older `?product=all` means everything). A client that supports MCP
  authorization finds sign-in on its own from the server's OAuth discovery metadata, registers
  itself and opens the browser;
- that the client will ask them to sign in and to choose what it may do (Read only, Edit, chosen
  unless they change it, or Admin), and a suggestion for a first request;
- the agents connected now, each with what it can reach ("Only the organization Acme", "Only the
  product Crewboard in Acme", "Every product you can open", from `reach` in
  `GET /api/v1/me/agents`), who holds the connection ("Held by claude.ai", "Held by an app on your
  computer", from `returns_to`: `{ hosts, local }`, the `https` hosts of its client's redirect
  URIs and whether any is loopback or a private-use scheme), when it was last used, its level
  with a control to change it (with Undo), and a disconnect control;
- **a plain statement about the agent's side of the trip**, above the steps: what the agent reads
  goes to whoever runs it, under their terms ([§9.1](09-data-lifecycle.md));
- an optional ZIP download of the skill, with its version, for installing it by hand (the server
  offers it to the agent anyway).

## 6.9 Feedback

`submit_feedback { category, message, tool?, details? }` is available on both adapters and is
write-only ([§4.13](04-data-model.md)). The skill asks agents to use it when a tool's behavior or
guidance misled them, so the product's agent surface improves from real use.
