---
type: Specification
title: Every capability is one registered operation, reached identically over REST and MCP.
description: The operation registry, the error model and bounds, the full catalogue of 118 operations with their REST routes and MCP tools, authorization and agent connection levels, upload flows, the skill and the Connect page.
tags: [spec, operations, rest, mcp, registry, uploads, skill]
generated: {by: agent:claude, at: 2026-10-18}
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

`OPERATIONS` in `packages/core/src/index.ts` lists all 118. From that list, and from nothing else,
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
   its connection's level (`403 connection_level`, [§3.8](03-accounts-teams-and-identity.md)) or
   `submit_feedback` when the person turned it off for the connection (`403 feedback_off`, §6.9),
   whatever was sent with it. None says anything about any product.
2. **Resolve and authorize the scope** ([§3.6](03-accounts-teams-and-identity.md)): a caller
   who cannot see the product gets `404` before their input is even validated. For an agent the
   role in the scope is then capped by its connection's level. A tenant, team or product named
   with a null character (U+0000) is refused first (`422 invalid_input`, naming it): no scope's
   name holds one, and Postgres reads no text that does.
3. **In a public sandbox, admit the visitor** ([§9.7](09-data-lifecycle.md)): whether visitors
   are let in, what a visitor never does, and the limits on calls and writes a minute
   (`403`, `429`). This runs before validation, so a call that is refused still counts as a call.
4. **Validate the input** strictly (`422 invalid_input`, "Nothing was changed"), after renaming an
   accepted alias to its canonical field (§6.5). A string anywhere in it that holds a null
   character (U+0000) is refused the same way, naming the field (`details.fields`), since
   Postgres keeps no such character in text; nothing strips it. Over REST a path or a query that
   holds one is refused before any route runs, naming the field as here (§6.4), so this check
   meets a JSON body's and an MCP call's, beside the schema's own refusals. A visitor's input is
   then checked for size (`413 too_large`).
5. Refuse writes to an archived product (`409 product_archived`) unless the operation allows it.
   An operation with slow work outside the database (`attachments.fetch_url`'s download) does it now,
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
| 403 | A role too low for the action; an agent connection's level too low for it; feedback turned off for an agent connection; something only a person does in the web app; a call outside a scoped MCP connector; a cross-origin cookie write; sign-up not allowed; something a visitor to the public sandbox may not do, or may not do for now | `forbidden`, `connection_level`, `feedback_off`, `web_only`, `outside_connector_scope`, `forbidden_origin`, `invite_only`, `invitation_wrong_address`, `sandbox_restricted`, `sandbox_read_only`, `sandbox_closed`, `tenant_allowance` |
| 404 | Absent — including everything the caller has no role on | `not_found` |
| 409 | Conflict with current state | `stale_etag`, `product_archived`, `record_archived`, `mockup_archived`, `slug_taken`, `frozen`, `too_many_attachments`, `no_text`, `no_file`, `mockup_on_story`, `already_uploaded`, `upload_used`, `sandbox_organization`, `export_in_progress`, `last_owner`, `quota_exceeded`, `sandbox_full`, `no_baseline` |
| 410 | Deliberately deleted, with a tombstone; an invitation no longer usable | `record_deleted`, `assumption_deleted`, `outcome_deleted`, `story_page_deleted`, `mockup_deleted`, `annotation_deleted`, `invitation_used`, `invitation_expired`, `invite_revoked`, `invite_expired`, `invite_used_up` |
| 413 | Body or file beyond a limit | `too_large` |
| 422 | Invalid input | `invalid_input`, `edit_not_found`, `edit_ambiguous`, `unknown_field`, `unknown_action`, `unknown_tool`, `product_required`, `too_long`, `cross_product_reference`, `outcome_cites_a_record`, `invalid_query`, `invalid_cursor`, `invalid_filter`, `invalid_html`, `invalid_patch`, `invalid_upload`, `fetch_failed`, `confirmation_required`, `name_mismatch`, `confidence_requires_human` |
| 429 | Rate limited | `rate_limited` |

- **`403` names the role.** A caller with a role on the product but too low for the action gets
  `403` with `{ role, needed }` in `details` ("You are a viewer on product …; outcomes.create
  needs editor"). With no role at all the answer is `404`, never `403`
  ([§3.5](03-accounts-teams-and-identity.md)). `connection_level` carries `{ level, needed }`
  and says that only the person raises it, under Connect an agent.
- **`stale_etag`** carries `current_etag` in `details`: the etag the object has now, or `null`
  when there is nothing to match. It answers a stale etag and, for a write that may create what
  it writes (a source's summary, notes and derived text, a Story page's versions and notes, the
  Story's style and hierarchy, a mockup's versions, an allowance), a missing one once the object
  exists, and one sent while there is nothing to match, with `current_etag: null`; its message
  says which etag to pass and where to read it, or to leave it out for the first write, and names
  another etag of the object sent in its place ([§4.1](04-data-model.md)).
- **`quota_exceeded`** carries `{ quota, limit, used, unit }` in `details`. It is returned for the
  50 Story pages and the 50 mockups a product holds ([§9.2](09-data-lifecycle.md)), the mockups'
  adding `archived`, and for a visitor's daily
  allowances in the public sandbox, which add `resets_at` ([§9.7](09-data-lifecycle.md)). A sandbox
  allowance set to 0 is switched off and answers `403 sandbox_restricted` instead.
- **`429`** is returned for sign-in links (five per address per hour), for a fourth URL fetch a
  person starts while three of theirs are in progress (`attachments.fetch_url`, on each instance), and
  for a visitor's calls and writes a minute in the public sandbox, with
  `{ limit, per, retry_after_seconds }` in `details` and a `Retry-After` header on REST. Rate
  limits for every organization are planned.
- **`413 too_large`** carries `{ limit }`, and for a visitor's input `{ field, limit, unit }`.
- Database unique violations become `409 conflict`; serialization failures become
  `409 concurrent_change` ("Retry"). Anything unexpected is `500 internal`, logged, and never
  leaks details. Its message says to try again and how to report it if it repeats, as the door
  names the way: Submit feedback in the account menu over REST (the web app), `submit_feedback`
  over MCP, or telling the person on a connection whose person turned feedback off.
- Messages are written for an agent to act on: they say what was wrong and what a correct call
  looks like. `422 invalid_input` leads with the cause, in its own words rather than the validation
  library's: the fields it did not recognize first, each with the required field it was probably
  meant as when one is missing beside it ("`content` is not a field of this action; did you mean
  `notes`?"), then what is missing ("`notes` is required"), then any other problem with a value.
  A value of the wrong type is named once, without the checks the library also ran on it, and a
  list sent as something else says in one sentence what the list takes, with an example made from
  what was sent ("`status` takes a list of any of unconfirmed, confirmed, refuted and superseded,
  such as ["confirmed"], not a string"). A standalone tool called with `describe`, `action` or
  `params` is told it is a tool of its own whose arguments are its fields, which it names, and
  that only the grouped tools take those three; no field is suggested in their place.
  It ends "Nothing was changed; correct the call and send it again", so a refusal never reads as a
  call with nothing to do ([`schemas.ts`](../../packages/core/src/schemas.ts) `formatIssues`).
  A field that a neighbouring operation takes adds a hint: `derived.text` refusing `start`, `end`,
  `unit`, `seq` or `length` says it reads by code-point `offset` and `limit` (where the window
  starts, such as a little before a search hit's `char_start`, and how many characters it holds),
  and that there are no passages to read by number (`WRONG_FIELD_HINTS` in
  [`field-aliases.ts`](../../packages/core/src/field-aliases.ts)). So does a field the object no
  longer has, or a value a field no longer takes, naming what replaced it: a source's kind or
  dimensions (tags, and the `tags` filter on sources and search, `tag` on assumptions), an
  attachment's role, citations, `refs` and related sources (search, and words), `note_kind`
  `outline` (the summary and the notes); Notes on recent actions, below, and `retiredFieldHint` in
  [`execute.ts`](../../packages/core/src/execute.ts). MCP
  returns the same object as a tool error (`isError: true`) whose text begins with
  the status (`"422: …"`) followed by the JSON.

## 6.3 Bounds and paging

- The lists that can grow without bound are paged with an opaque `cursor`, and their responses
  carry `next_cursor` or `null`: `sources.list`, `sources.list_annotations`, `outcomes.list`,
  `assumptions.list`, `search`, `activity.list`, `members.activity` and `sandbox.visitors`. A
  Story page's and a mockup's versions (`story.list_versions`, `mockups.list_versions`) page by
  version number instead: `before` returns the versions numbered below it, and responses carry
  `next_before` or `null`. Every other list answers in one response: those bounded by a product's
  limits (`story.list_pages`, `mockups.list`), `derived.list` (the newest 100 readings) and
  `outcomes.revisions` (the newest `limit`) among them.
  Page sizes are per operation: default 50, at most 200 for sources, comments, search, activity,
  a sandbox's visitors and outcome revisions (search's plain mode returns 60 results unless asked,
  at most 200, in one answer that takes no cursor); default 25, at most 100 for assumptions and
  Story and mockup versions; outcomes default to 100, at most 100. Asking for more than the maximum
  is `422`, not a silent clamp.
- `sources.list` orders by `sort`: `added` (newest added first, the default), `date` (the
  source's own date, newest first, undated last), `updated` (details most recently changed first)
  or `title` (A to Z). `order` (`asc` or `desc`) reverses a sort; it defaults to `desc` for the
  three dates and `asc` for title, and undated sources stay last either way. A cursor belongs to
  its sort, order and filters: pass it back with all of them unchanged.
  With `date`, `updated` or `title`, a cursor the sort did not issue is `422 invalid_cursor`. Each
  summary in the list also names the attachment its derived text is still the text of
  (`text_from`, a path, or `null`). Every source summary carries `uploaded_at` and `updated_at`
  with their actors. With `include_summary`, each also carries the source's own summary
  (`summary`, `null` without one, cut at 1,000 characters at a word, with an ellipsis), which the
  web app's list unfolds ([§4.6](04-data-model.md)).
- Text windows (`derived.text`): at most 20,000 code points per call, the default, with
  `truncated` and `total_chars` ([§5.4](05-derived-layer.md)).
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

A null character (U+0000) in a request is refused with `422 invalid_input` before any route reads
it, on every route, the app's own pages, sign-in and OAuth included, and before the caller is
identified (`apps/server/src/null-characters.ts`): in the path, the query, a form's fields, and the
JSON body of every route but an operation's, whose input check names its fields beside the
schema's own refusals (§6.1). A field is named as an operation names it: by its query or form
key, by the parameter its route gives a path segment (`record_id`, `page_id`, `product`), or by
its path in the JSON; a part of the address no route names is called the address. The MCP
endpoint's body and an upload's bytes are read as they came and not here (MCP's operations check
theirs), and OAuth client registration cleans a client's name of control characters itself, as
it always has.

### The operation catalogue

All 118 operations, generated from `OPERATIONS`. The MCP tool is the operation name's first half;
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
| `sources` | `move_to_product` | `POST P/sources/:record_id/move` | editor |
| `sources` | `copy_to_product` | `POST P/sources/:record_id/copy` | editor |
| `sources` | `delete_impact` | `GET P/sources/:record_id/delete-impact` | viewer |
| `sources` | `delete` | `DELETE P/sources/:record_id` | admin |
| `attachments` | `request_upload` | `POST P/sources/:record_id/uploads` | editor |
| `attachments` | `create_upload` | `POST P/sources/with-upload` | editor |
| `attachments` | `create_uploads` | `POST P/sources/with-uploads` | editor |
| `attachments` | `complete_upload` | `POST P/sources/:record_id/uploads/complete` | editor |
| `attachments` | `fetch_url` | `POST P/sources/:record_id/fetch` | editor |
| `attachments` | `get_download` | `POST P/sources/:record_id/downloads` | viewer |
| `derived` | `manifest` | `GET P/sources/:record_id/derived/manifest` | viewer |
| `derived` | `text` | `GET P/sources/:record_id/derived/text` | viewer |
| `derived` | `write_text` | `PUT P/sources/:record_id/derived/text` | editor |
| `derived` | `list` | `GET P/sources/:record_id/derivations` | viewer |
| `derived` | `rederive` | `POST P/sources/:record_id/rederive` | editor |
| `derived` | `write_note` | `PUT P/sources/:record_id/agent-notes/:note_kind` | editor |
| `derived` | `read_note` | `GET P/sources/:record_id/agent-notes/:note_kind` | viewer |
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
| `mockups` | `delete_impact` | `GET P/mockups/:mockup_id/delete-impact` | viewer |
| `mockups` | `delete` | `DELETE P/mockups/:mockup_id` | admin |
| `activity` | `list` | `GET P/activity` | viewer |
| `get_skill` | — | `GET /api/v1/skill` | signed in |
| `submit_feedback` | — | `POST /api/v1/feedback` | signed in |

Notes on recent actions:

- A source's summary and notes have an etag of their own, as its derived text has, and a write
  over any of the three needs it once there is one
  ([decision](../decisions/a-write-that-may-create-its-object-needs-its-etag-once-it-exists.md)):
  `derived.write_note` takes `expected_etag` and answers with the new `etag` (`null` once
  cleared); `derived.read_note`, and `sources.get` with `detail: "full"` in `agent_notes`, return
  it; `derived.write_text`'s `expected_etag` is required once the source has a derived text. The
  first write takes none. A write without the etag once the part exists, with a stale one, or with
  another of the source's etags is `409 stale_etag` with `current_etag`, its message saying which
  etag to pass and where to read it (another part's etag is named while it is current); an etag
  sent when there is nothing to match is `409 stale_etag` with `current_etag: null`, saying to
  leave it out ([§4.1](04-data-model.md)).
- A source's words are one derived text, and its files are attachments that are read and kept but
  never searched
  ([decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
  The `files` tool is `attachments`, on the same REST paths, without `set_role` or `add_note`, and
  `read_passage` is gone. `derived.write_text` writes the derived text, whole, by exact edits or
  from an attachment; `derived.text` reads it, or with `path` the text read from one attachment;
  `derived.manifest` and `derived.rederive` take `path`, and `derived.list` gives every reading
  with its `path` and `is_current` ([§5](05-derived-layer.md)). Attachments take no `role` and
  carry no provenance: a call to an `attachments` action that sends `role`, `derived_from`,
  `derivation_note` or `derived_by` is `422 invalid_input`, with a hint that attachments have none
  and that what one was made from goes in the source's notes. Source summaries carry
  `text_chars`, `attachment_count` and, from `sources.list`, `text_from`, in place of
  `segment_count`, `file_count` and `primary_file`; `sources.get` gives `attachments` and `text`
  in place of `files`, `search_rule`, `manifest` and `pending_primary_path`
  ([§4.3](04-data-model.md)). `search` takes `scope: "sources"` (`passages` is gone), and its hits
  name the `field` they are in, with code-point offsets into it; plain mode's source results give
  `hits` with their field and `hits_matched`, and no `passage` kind ([§8](08-search.md)). The upload
  relay's `201` gives the `attachment` (it gave `file`).
- Sources are described by tags; they have no kind, organization or folder
  ([decision](../decisions/sources-are-described-by-tags.md)). `sources.facets` replaced
  `sources.kinds`: it returns `{ sources, tags: [{ tag, count }], tags_truncated, added_by:
  [{ account_id, display_name, count }] }` for the product, counting live sources unless
  `include_archived` ([§4.4](04-data-model.md)). `sources.list` lost `folder`, `kind` and
  `organization` and gained `added_by` and `added_since`; `search` lost the same three filters.
  `sources.create`, `sources.update` and `attachments.create_upload` take no `kind` or
  `organization`. Source summaries and `search`'s `records` (now `{ title, date, tags,
  archived_at }`) carry no kind. A call to a `sources`, `attachments` or
  `search` operation naming `kind`, `organization` or `folder` is `422 invalid_input`, with a hint
  to use tags and `sources(action="facets")`.
- Sources and assumptions have no dimensions; tags say whom material concerns and what it bears
  on ([decision](../decisions/sources-are-described-by-tags.md)). `sources.list` and `search` lost `customer`, `product_area` and
  `lifecycle_stage`; `sources.create`, `sources.update`, `attachments.create_upload`,
  `assumptions.create` and `assumptions.update` take no `dimensions`, and reads of sources and
  assumptions carry none. A call to a `sources`, `attachments`, `search` or `assumptions` operation
  naming one is `422 invalid_input`, with a hint to use tags and the filter that took their place:
  `tags` on sources and search, `tag` on assumptions.
- Sources have no `participants`, `source_system` or `provenance_depth`, and assumptions no
  `provenance_depth` ([decision](../decisions/sources-are-described-by-tags.md)). `sources.list`
  and `search` lost the `provenance_depth` filter, `sources.list`'s `query` reads the title, tags
  and attachment names, and none of these operations takes or returns the fields; naming one is
  `422 invalid_input`, with a hint that a source is described by its title, date and tags.
- A comment is on a whole source: `sources.annotate` takes no `seq_start` or `seq_end` (naming
  them is `422 invalid_input`, saying so), and comments carry no anchor. `derived.outline` is
  gone, and `derived.write_note` and `derived.read_note` take `note_kind` `summary` or `notes`
  (`outline` is `422 invalid_input`, with a hint that a source has no outline and what the summary
  and the notes are for); `write_note` with empty content removes the note
  ([decision](../decisions/a-source-carries-a-summary-notes-and-whole-source-comments.md)).
  `sources.get` with `detail: "full"` has no `outline`.
- Insights and decisions are retired, with their operations and their MCP tools; what a product
  held of them became sources ([§4.7](04-data-model.md)).
- Citations are retired, and so is the graph around them
  ([decision](../decisions/evidence-is-searched-not-cited.md)): `assumptions`, `story` and
  `mockups` have no `check_citations`, the `lineage` tool and `sources.used_by` are gone, and no
  operation takes or returns `citations`, `citation_count`, `refs`, `resolved_refs` or
  `related_records`; a call that sends `citations`, `refs` or `related_records` is
  `422 invalid_input`, with a hint that evidence is found by searching, not cited, and that what a
  piece of work rests on is said in words (an assumption's body, a Story page's notes, a source's
  notes), naming a source by its id where it helps. `assumptions.list` has no
  `record_id` filter, and `search` with `record_id` searches no assumptions.
  `sources.move_to_product` is never refused for what mentions the source, and
  `sources.delete_impact` reports its attachments' versions, bytes, readings and comments
  ([§4.3](04-data-model.md)).
- `assumptions.update` takes `edits` (exact replacements that must match once) and returns
  `changed` and a short `diff` ([§4.1](04-data-model.md)); its `tags`, `outcome_ids` and `links`,
  when sent, each replace the whole list, as `sources.update`'s and
  `sources.update_annotation`'s `tags` do. `assumptions.supersede` takes `reviewer_type` for the
  review it records on the old entry, defaulting as `review`'s does ([§4.8](04-data-model.md)).
  Without `status`, the assumption list
  returns the current entries (unconfirmed and confirmed), the ones every count counts, with
  `not_current_hidden` (the refuted and superseded ones matching its other filters) and, when that
  is not zero, a `note`; a `status` list names what to return instead. It returns
  `frozen`, `superseded_by` (the ids of the entries whose `supersedes` link points at the entry, newest
  first, so a list can show history under its correction without a `get` per entry),
  `link_count` and `linked_from_count`; `outcomes.list` returns
  `archived_hidden` ([§4.2](04-data-model.md), [§4.8](04-data-model.md)).
- `story.publish` takes the page as `body` (the markup inside `<body>`; the server adds the
  product's Story style) or as `html` (a whole document). A later version keeps the
  `title`, `summary` and page it omits, `patch_html` edits the HTML by exact
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
  (`name`, `rules`, `stylesheet`), with its own etag, left out for the first style (one sent then
  is `409 stale_etag` with `current_etag: null`); `422 invalid_style` lists every problem
  ([§4.11](04-data-model.md)). A style based on a house style no longer in the catalogue carries a
  `note` (in `get_style`, `set_style` and the guidance's `product_style`) saying how to move to a
  current one. `story.guidance` takes `house_style` to return one house style in
  full. Beside the operations, `GET P/story/style/specimen` and
  `GET P/story/house-styles/:style/specimen` serve sample pages in the Story sandbox for the app's
  previews.
- `story.write_notes` replaces a page's notes for agents. The notes carry their own etag
  (`publish` → `agent_notes_etag`, `get_page` → `agent_notes.etag`), separate from the page etag,
  and are not versioned with the page. While the notes are empty the etag may be omitted; once
  they hold anything, a write without it is `409 stale_etag`, as for a source's summary and notes
  ([§4.1](04-data-model.md)).
- A reader's `story.get_page` leaves out `agent_notes`, and a reader's `products.get` and
  `products.list` leave out `concept` and count only `story_pages` (and `stage_counts.story`)
  ([§3.5](03-accounts-teams-and-identity.md)). `story.list_pages` leaves archived pages out unless
  `include_archived`, and counts them in `archived_hidden` (with a `note` when there are any); a
  reader is given neither the archived pages nor their count ([§4.11](04-data-model.md)).
- `mockups.publish` creates a mockup, or publishes the next version of one: the whole canvas,
  with its brief, its pages in order and each page's notes and size, and the files it carries for
  collaborators. A later version keeps what it omits, and a page or file that keeps its id or path
  keeps its content unless it is sent. `mockups.get` and `get_version` take `include_files` to
  return the files' content. `mockups.request_upload` returns a grant to PUT the canvas as a ZIP
  in `get_download`'s layout, and `mockups.publish { upload_id }` reads it in place of `pages`,
  `files` and the brief, so no page's HTML travels through a tool call; it is refused to a visitor
  to a public sandbox (`403`), and the result names `from_upload` and gives `upload { upload_id,
  size, sha256 }`, the ZIP as its PUT answered ([§4.12](04-data-model.md), §6.7). `publish`
  answers with what a caller needs next, not the canvas it sent: `{ mockup_id, title,
  current_version, current_version_id, etag, based_on_version, page_ids, url, next }`, where
  `page_ids` are the canvas's pages in order and `url` is the canvas in the web app, with
  `from_upload` and `upload` after an upload and `prototype_warnings` when one brings a prototype;
  `mockups.get` reads the version back. ◆ Decision: a version's brief, page notes and page details
  run to tens of thousands of characters, which an echo would put into an agent's context after
  every publish; every other write still answers with its object. A page is held
  to a mockup page's HTML rules, not a Story page's: scripts without a budget, and forms whose
  submit handlers run and whose submissions go nowhere. `publish`'s and `request_upload`'s
  descriptions state what a page may hold and what is refused, that a refused publish changes
  nothing and leaves an upload unused, and what a frame does with a page taller than its height.
  `mockups.list` returns `archived_hidden` (and a `note` when it is not zero) and
  `quota { used, limit, unit, archived_included }`. A version may carry a prototype, uploaded under
  `prototype/` in the ZIP, and a page may give `entry` (and `poster`) instead of `html`; reads give
  the version's `prototype { file_count, bytes, base_url, expires_at, sandbox }` (with its files
  under `include_files`) and each entry page's `prototype_url`, and `publish` answers with
  `prototype_warnings`. `publish`'s and `request_upload`'s descriptions state that a prototype is
  stateless, uses relative addresses and no network, and what its warnings mean.
  `mockups.get_download` gives a version as a ZIP through a grant, for an agent to build the next
  version elsewhere ([§4.12](04-data-model.md)). `mockups.get` lists the Story pages that show
  its pages.
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
  first save its `expected_etag` may be null or left out (an etag sent then is `409 stale_etag`
  with `current_etag: null`); once saved, leaving it out is `409 stale_etag`, saying to read
  `get_hierarchy`.
- `outcomes.create` takes an optional `position`, as `update` does, to place the new outcome
  between two others; omitted, it goes last ([§4.2](04-data-model.md)).
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
- `activity.list` takes `by: "people" | "agents"`, besides `entity_type`, `entity_id`, `actor`,
  `channel` and `since`. `people` is what people did in the app or, in entries from when personal
  tokens reached it, through the REST API (channel `web` or `rest`); `agents` is what agents did over
  MCP. What WhatBuild does by itself, such as reading an attachment, has no channel and is in
  neither. `entity_type` takes exactly the kinds of object a product's log has entries about:
  `product`, `membership`, `source`, `outcome`, `assumption`, `story_page`, `story_hierarchy`,
  `story_style` and `mockup` (anything else is `422`).
- `members.activity` is the organization's access log, for its owners and admins: roles given,
  changed and removed, people removed from the organization, invitations sent, accepted and
  cancelled, and in a public sandbox its invitation links, removed visitors and changed settings.
  It takes `actor`, `since`, `limit` and `cursor`, and pages like `activity.list`. A product's
  `activity.list` leaves these events out, because they belong to the organization, all but
  someone joining the product through an invitation, which both logs hold.

### Routes outside the registry

These carry bytes, identity or discovery, not operations:

```
PUT  /api/v1/uploads/:grant_id                       upload relay (grant header is the credential)
PUT  /api/v1/uploads/mockup/:upload_id               a mockup canvas's ZIP, under its upload grant
GET  /api/v1/downloads/:file_version_id              an attachment's bytes under a download grant
GET  /api/v1/downloads/export/:export_id             an export ZIP under a download grant
GET  P/sources/:record_id/attachment?path=&version=&download=1   an attachment's bytes for the web app (ranged)
GET  P/sources/:record_id/text                       a source's whole derived text for the web app (text/markdown)
GET  P/exports/:export_id/file                       an export ZIP for the web app
GET  P/story/pages/:page_id/versions/:version/html?theme=light|dark   Story page HTML
GET  P/story/print?page_ids=…                        the Story print view (HTML)
GET  P/mockups/:mockup_id/versions/:version/pages/:page_id/html   a mockup page's HTML
GET  /api/v1/downloads/mockup/:version_id            a mockup version's ZIP under a download grant
GET  /api/v1/downloads/story-preview/:preview_id?theme=light|dark   a Story preview's HTML under its grant
GET  /prototypes/:grant/<path>                       a mockup prototype's file; the grant in the path is the credential (§4.12)
GET  /api/v1/meta                                    server and skill version, release, sign-in methods (public)
GET  /api/v1/connect                                 what the Connect page shows
GET|PATCH /api/v1/me; GET /api/v1/me/agents; PATCH|DELETE /api/v1/me/agents/:family
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
`application/octet-stream` downloads, never renderable from the application's origin.

**A source's text for the web app.** `GET P/sources/:record_id/text` answers the whole derived
text, so the app can show and edit it at once, as `text/markdown; charset=utf-8` with
`nosniff`, `Cache-Control: private, no-store` and the text's etag as its `ETag`; `404` when the
source has none. It needs viewer, as `derived.text` does; agents read the text in windows with
`derived.text` ([§5.4](05-derived-layer.md)).

**The two sandbox routes need no identity.** `GET /api/v1/sandbox/invite` answers the page behind
an invitation link: the invitation's `status` (`open`, `used_up`, `expired`, `revoked`, `full` or
`closed`), the organization's name, the notice, the reset's hour and four of the limits; an
unknown code is `404`. `POST /api/v1/sandbox/reset-if-due` is for a scheduler: it does nothing
unless a reset is due, and a due reset would run at the next request anyway
([§9.7](09-data-lifecycle.md)).

**Story page HTML** is served with a sandbox policy that allows the page's inline scripts but no
network, no same-origin access and no framing outside the app. `?theme=light|dark` writes the
app's resolved theme onto the page's `<html>` for that response only; the stored HTML is
unchanged. It is a Story read, so a reader reaches it; a source's attachment and text, an
export's file, the style specimens and a mockup page's HTML need viewer. A mockup page's HTML is served in the same
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
to check its installed skill's version (with several copies installed, to follow the one at the
server's version and offer to update or remove the others), start with `products(action="list")`, confirm the product
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
the server's version and its tools or the tool's actions the connection is offered (also in
`details`: `server_version`, `tools` or `actions`), and say the client may hold a list from
another version.

**Tools.** Fourteen tools over the 116 operations an agent may be offered (all 118 but deleting an
organization and its preview): eleven grouped by noun, three standalone
([decision](../decisions/mcp-tools-grouped-by-noun.md)). A connection is listed
only the actions its level allows (below).

| Tool | Actions |
|---|---|
| `products` | `list`, `create_tenant`, `create_team`, `create`, `get`, `update`, `archive`, `restore`, `delete_impact`, `delete`, `export`, `exports`, `tenant_allowances`, `set_tenant_allowance`, `remove_tenant_allowance`, `usage` |
| `members` | `list`, `grant`, `revoke`, `cancel_invitation`, `activity` |
| `sandbox` | `status`, `join`, `settings`, `update_settings`, `save_baseline`, `baselines`, `reset`, `invites`, `create_invite`, `revoke_invite`, `visitors`, `remove_visitor` |
| `outcomes` | `list`, `get`, `create`, `update`, `archive`, `restore`, `delete_impact`, `delete`, `revisions`, `get_revision`, `restore_revision` |
| `sources` | `facets`, `list`, `get`, `create`, `update`, `archive`, `restore`, `annotate`, `list_annotations`, `update_annotation`, `delete_annotation`, `move_to_product`, `copy_to_product`, `delete_impact`, `delete` |
| `attachments` | `request_upload`, `create_upload`, `create_uploads`, `complete_upload`, `fetch_url`, `get_download` |
| `derived` | `manifest`, `text`, `write_text`, `list`, `rederive`, `write_note`, `read_note` |
| `assumptions` | `list`, `get`, `create`, `update`, `review`, `supersede`, `link`, `unlink`, `archive`, `delete_impact`, `delete` |
| `story` | `guidance`, `get_style`, `set_style`, `list_pages`, `get_page`, `list_versions`, `get_version`, `preview`, `publish`, `promote_mockup`, `write_notes`, `print_view`, `get_hierarchy`, `set_hierarchy`, `archive_page`, `restore_page`, `delete_page_impact`, `delete_page` |
| `mockups` | `list`, `get`, `list_versions`, `get_version`, `request_upload`, `publish`, `archive`, `restore`, `get_download`, `delete_impact`, `delete` |
| `activity` | `list` |
| `search` | standalone |
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
  A grouped tool called without `action` is `422 invalid_input` saying `action` is missing and
  listing the tool's actions (also in `details.actions`). It, and `unknown_action`, list only the
  actions the connection is offered, as its `tools/list` does (below): never a permanent delete or
  a sandbox's control panel to an Edit connection.
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
  An organization's or a team's action takes its `tenant` (and `team`) from `params`, and on a
  scoped endpoint defaults to the endpoint's. Named with `product` instead, it acts on the
  organization, and team, that the product is in, once the product is found visible to the
  caller (`404` otherwise), as `sandbox(action="status", product=…)` does; an action that takes a
  product of its own in `params` (`members` `list`, `grant` and `revoke`) does not read `product`
  so. Naming none is `422 invalid_input`, saying `tenant` (or `team`) is missing, where to read it
  (the first parts of a product's path) and, where it applies, that `product` names it too.
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
  level and feedback switch changed (`PATCH /api/v1/me/agents/:family { level?, feedback? }`, the
  session only) and disconnected on the Connect an agent page. The session cookie is `__Host-wb_session` over HTTPS
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

## 6.7 Getting attachments in

A source's files are its attachments ([§4.5](04-data-model.md)), and they take no role. In order
of preference for an agent (`packages/core/src/ops/attachments.ts`):

1. **Upload grant** — `attachments.request_upload { record_id, path, media_type?, size? }`, or
   `attachments.create_upload` to create the source and get its first grant in one call, or
   `attachments.create_uploads { sources: [...] }` for up to 20 such sources at once (all are
   created or none, and a refusal names the entry by index). The result is
   `{ grant_id, record_id, path, url, method: "PUT", headers, max_bytes, expires_at, direct?, next,
   warnings }`
   (`create_upload` returns `{ record, upload, warnings }`, `create_uploads` a list of them as `items`). `warnings` flags, without refusing, a
   format no parser reads (the attachment will be kept, but its text cannot be read, so it cannot
   become the source's derived text; a recording is not flagged, since its result says it), an
   image (kept and shown, but read for no words: an agent that can see it describes it in the
   summary and writes its words as the text), and for `create_upload` a live source with the same
   title and date. The agent PUTs the
   local file's raw bytes to `url` (the service's own upload relay,
   `/api/v1/uploads/:grant_id`) with exactly those headers, using whatever shell or HTTP tool it
   has. The relay first checks that whoever requested the grant can still write to the product
   (`403 forbidden` otherwise, for someone made a reader or viewer, or removed, since), then
   stores the bytes, records size and SHA-256 **from what arrived**, not from the
   agent's claims, adds the attachment at once (or a version of it, at a path it already has),
   changes the source's etag, and queues the attachment to be read
   ([§5.1](05-derived-layer.md)); its `201` response, `{ uploaded, size, sha256, attachment, next }`,
   carries the attachment, so nothing more need be called. A grant takes one PUT: a second is
   `409 already_uploaded`, which says the attachment is already on the source and that a new
   version takes a new grant.
   `attachments.complete_upload` adds an attachment PUT to a `direct` URL; after the relay it only
   confirms, idempotently. Both give the attachment (§4.5) with `record_id`, the source's new etag
   as `record_etag`, and a `note` on what becomes of its text that agrees with it: it is being read
   and its text will become the source's derived text, or the source already has one and this text
   will be kept beside it (take it with `derived.write_text`'s `from_attachment`); it has been
   read; it is a recording, stored and playable but never transcribed (add its transcript as
   another attachment, or, beside the source's derived text, where that text comes from); it is an
   image, or a PDF whose pages are pictures, with no words read (and how an agent that can see it
   gives the source its words); or no parser reads its format (with the formats that are read).
   Every note says the attachment is kept and never searched. A recording, an image, an unread
   format and a file over the parse cap are known by name, type and size, so the attachment's
   `text.status` says so at once, before the worker has run, as its reading then records it
   ([§5.5](05-derived-layer.md)); `warnings` here is empty, and `fetch_url` adds a URL's
   fragment to it. A grant takes one file, once: it adds an attachment, or, at a path the source
   already has, a new version of it, the earlier versions kept. Grants are signed and expire after
   30 minutes by default (`WHATBUILD_GRANT_TTL_SECONDS`). The relay takes at most 25 MB
   (`WHATBUILD_RELAY_MAX_BYTES`); when the deployment enables signed URLs
   (`WHATBUILD_GCS_SIGNED_URLS=1`), the grant also carries a `direct` block for a PUT straight to
   the bucket, up to the per-file limit of 100 MB (`WHATBUILD_FILE_MAX_BYTES`). The direct URL is
   signed with that limit as the allowed body size (`x-goog-content-length-range`, among the
   headers to send), so the bucket refuses a larger body; `attachments.complete_upload` reads the
   object's size first, discards an object over the grant's size with `413 too_large`, and hashes
   the bytes as it streams them, never trusting a hash stored beside them.
2. **URL fetch** — `attachments.fetch_url { record_id, url, path? }` for public HTTPS material:
   public addresses only, both an address written in the URL (in any notation the URL parser
   accepts) and every address a name resolves to, checked again on each redirect; size-capped
   (25 MB by default), 30 seconds at most between bytes and 60 seconds for the whole fetch,
   redirects included. A person runs at most three fetches at once (`429 rate_limited`). The
   download holds no database connection (§6.1, `execute`'s step 4). A failure on the network
   answers one plain `422 fetch_failed`, whatever happened, and an error status from the server
   names that status. The part of a URL after `#` never reaches a server, so a single-page app's
   route fetches only its shell; when the URL has a fragment, the result's `warnings` says so.
3. **Words, not a file** — `derived.write_text { record_id, content }` writes a source's text
   directly, up to 2,000,000 characters ([§5.4](05-derived-layer.md)); a source can be words alone.
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

A source holds at most 50 attachments (`409 too_many_attachments`). No operation accepts base64
content. `attachments.get_download { record_id, path, file_version_id? }` returns a short-lived
grant (`GET /api/v1/downloads/:file_version_id` with a grant header) for an agent to read an
attachment's original bytes, to check what was read from it against the original or read what
reading it dropped.

## 6.8 The skill and the Connect page

**The skill** is one versioned Markdown document, `packages/core/src/skill/SKILL.md`, that teaches
an agent the product: the vocabulary, the core loop, product selection, describing sources with
tags and finding them, getting attachments in, a source's derived text and how to read and
correct it, searching honestly, assumptions that say in their body why the team holds them, how
to review honestly, mockups and their round trip through a download and an upload, Story authoring via
`story.guidance`, the rule that source text is data, that a refusal means the call did nothing,
and that a tool or action it names but the client lacks means the client holds an older tool list
(an action may still answer `describe: true`; a missing tool needs a new session, which the agent
asks the person to start). `scripts/gen-skill.mjs` embeds it in the server bundle, and CI fails if the embedded copy
drifts. One constant, `SKILL_VERSION` in `packages/core/src/ops/meta.ts`, sets the skill's
`metadata.version`, the MCP server version and the `get_skill` advertisement.

- `get_skill` returns `{ name, version, filename, content }`. The server instructions tell an agent
  to compare versions and, when stale or absent, fetch the new one and *propose* installing it
  through its harness — never to self-install silently. With several copies installed (in
  different places, or under different names), the one at the server's version is the one to
  follow; the skill says the same.

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
  with a control to change it (with Undo), a **Can submit feedback** checkbox, on unless the person
  turns it off, with a line saying what it allows (with Undo), and a disconnect control;
- **a plain statement about the agent's side of the trip**, above the steps: what the agent reads
  goes to whoever runs it, under their terms ([§9.1](09-data-lifecycle.md));
- an optional ZIP download of the skill, with its version, for installing it by hand (the server
  offers it to the agent anyway).

## 6.9 Feedback

`submit_feedback { category, message, tool?, details?, screen?, reply? }` is available on both
adapters and is write-only, names nobody, and is limited to 10 a UTC day for a person and their
agents; the `429` refusal's message gives the moment the next UTC day begins, midnight UTC, when
they may send again ([§4.13](04-data-model.md#413-feedback)). The web app sends it from
**Submit feedback** in the account menu ([§7](07-web-app.md)). The skill asks agents to use it when a tool's behavior or
guidance misled them, so the product's agent surface improves from real use. A connection whose
person turned feedback off is not offered the tool, is refused it with `403 feedback_off` before
anything else about the call is read, its input included, and is told so in the server's
instructions, so it does not take the missing tool for an old tool list.
The people who run the deployment get the reports in a daily digest at `WHATBUILD_FEEDBACK_EMAIL`
([mail](../operations/mail.md),
◆ [decision](../decisions/feedback-names-nobody-and-reaches-the-maintainers-in-a-daily-digest.md)).
