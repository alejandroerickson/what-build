# 6. Operations and adapters

One core, two adapters. REST serves the web UI and scripts; MCP serves agents. Same operations,
same authentication, same status codes.

## 6.1 The operation registry

Every operation is declared once in `core`:

```ts
defineOperation({
  name: "assumptions.review",          // <group>.<action>
  scope: "project",                    // "project" | "team" | "account" | "public"
  mutates: true,
  requiresEtag: true,
  input:  z.strictObject({ … }),       // Zod; strict = unknown fields rejected
  output: z.object({ … }),
  summary: "Record an attributed review of an assumption.",
  guidance: "Markdown shown by describe=true: when to use it, pitfalls, an example call.",
  handler: async (ctx, input) => { … },
});
```

From the registry, and from nothing else, the build generates: REST routes and an OpenAPI
document; MCP tools with their `action` enums and JSON Schemas; `describe` responses; the typed
`Client` used by the web UI; and the operation reference inside the skill.

A **parity test** MUST fail the build if any operation is unreachable from either adapter, or if
any route or tool action exists that is not in the registry.

`ctx` carries the actor, the **team-scoped** stores, the resolved project, and the clock. Handlers
receive no transport details and no way to reach another team
([§3.6](03-accounts-teams-and-identity.md)).

Mutating handlers run inside one transaction that also writes the activity event
([§4.10](04-data-model.md)) and updates usage counters ([§9.2](09-data-lifecycle.md)).

## 6.2 Errors

```json
{ "error": { "code": "stale_etag", "status": 409, "message": "…", "details": { "current_etag": "…" } } }
```

| Status | When | Example codes |
|---|---|---|
| 401 | No or invalid identity | `unauthenticated` |
| 403 | The one exception: team lifecycle | `owner_only` |
| 404 | Absent — including everything in another team | `not_found` |
| 409 | Conflict with current state | `stale_etag`, `project_archived`, `already_archived`, `slug_taken`, `quota_exceeded`, `team_closing` |
| 410 | Deliberately deleted, with a tombstone | `record_deleted` |
| 413 | Body or file beyond a limit | `too_large` |
| 422 | Invalid input | `invalid_input`, `unknown_field`, `unknown_action`, `project_required`, `window_too_large`, `quote_not_found`, `cross_project_reference`, `confirmation_required` |
| 429 | Rate limited | `rate_limited` |

- **`403` appears exactly once**, for team lifecycle and billing ([§3.5](03-accounts-teams-and-identity.md)).
  Everywhere else a member can do everything and a non-member sees nothing (`404`).
- **`quota_exceeded`** carries `{ limit, used, unit, quota }` in `details` so an agent can explain
  the situation and a person can act on it. It is never returned for a read, a search, or an
  export.
- Messages are written for an agent to act on: they say what was wrong and what a correct call
  looks like. MCP returns the same object as a tool error (`isError: true`) with the JSON in the
  text content.

## 6.3 Bounds and paging

- Lists and search: `limit` default 50, maximum 200; opaque `cursor`; responses carry
  `next_cursor` or `null`. Asking for more than 200 is `422`, not a silent clamp.
- Text windows: ≤ 20,000 characters, with `truncated` and totals.
- Passages: ≤ 200 segments and ≤ 10 minutes ([§5.4](05-derived-layer.md)).
- Lists return summaries — never bodies, HTML, or derived text.
- Every response that was cut short says so in a field. No response can contain a whole record.

## 6.4 REST

Base path `/api/v1/t/<team>`; project routes continue `/p/<project>`. JSON in, JSON out.
`If-Match` carries the ETag on mutations; responses carry `ETag`.

Generated conventions — reads are `GET`, creates `POST` to the collection, updates `PATCH`,
deletes `DELETE …/<id>` (carrying `reason` and `confirm`, [§9.5](09-data-lifecycle.md)), and every
other action is `POST …/<id>/<action>`. Every type that supports delete also exposes
`GET …/<id>/delete-impact`:

```
GET    /t/:t                              PATCH /t/:t          GET /t/:t/usage
GET    /t/:t/members                      POST  /t/:t/invites  DELETE /t/:t/members/:a
POST   /t/:t/export                       POST  /t/:t/close
GET    /t/:t/projects                     POST  /t/:t/projects
GET    /t/:t/p/:p                         PATCH /t/:t/p/:p     POST /t/:t/p/:p/archive|restore
GET    /t/:t/p/:p/objectives              POST  …              PATCH …/:id
GET    /t/:t/p/:p/records                 POST  …              PATCH …/:id   POST …/:id/archive|restore
GET    /t/:t/p/:p/records/:id/passage?seq_start=&seq_end=   (or start_ms=&end_ms=)
GET    /t/:t/p/:p/records/:id/derived/manifest|outline|text
GET    /t/:t/p/:p/records/:id/files/:path?version=          (bytes; ranged)
POST   /t/:t/p/:p/records/:id/files/upload-grants           POST …/upload-grants/:grant/complete
GET    /t/:t/p/:p/records/:id/delete-impact                 DELETE /t/:t/p/:p/records/:id
GET    /t/:t/p/:p/insights …              POST …/:id/publish  GET …/:id/revisions[/:n]
GET    /t/:t/p/:p/assumptions …           POST …/:id/review|link|unlink|supersede|check-citations
GET    /t/:t/p/:p/decisions …             (same)
GET    /t/:t/p/:p/story/pages …           POST …/:id/versions  GET|PUT …/story/hierarchy
GET    /t/:t/p/:p/story/guidance
GET    /t/:t/p/:p/search?q=&scope=&…
GET    /t/:t/p/:p/activity?…
POST   /t/:t/p/:p/lineage/capture|check
POST   /t/:t/p/:p/export                  POST /t/:t/projects/import
POST   /t/:t/feedback                     GET  /skill
GET    /meta                              (version, capabilities, skill version; public)
GET    /sample/…                          (the public read-only sample project)
```

File bytes are the one non-JSON response. In production they are served by a short-lived presigned
URL from the object store; in development by the local endpoint. Either way with
`Content-Disposition` and `X-Content-Type-Options: nosniff`; uploaded HTML is never served with a
renderable content type from the application's origin.

## 6.5 MCP tools

Sixteen tools. Grouped tools take `action` (an enum), `params` (an object), `project`, and
— for mutations of existing objects — `etag`. The **team is carried by the endpoint**
([§3.6](03-accounts-teams-and-identity.md)), never by a parameter.

| Tool | Actions |
|---|---|
| `projects` | `list`, `get`, `create`, `update`, `archive`, `restore`, `delete_impact`, `delete` |
| `objectives` | `list`, `get`, `create`, `update`, `revisions`, `get_revision`, `restore_revision`, `archive`, `restore`, `delete_impact`, `delete` |
| `library` | `kinds`, `list`, `get`, `create`, `update`, `archive`, `restore`, `delete_impact`, `delete`, `list_annotations`, `annotate`, `update_annotation`, `archive_annotation`, `insights_for` |
| `files` | `list`, `add_note`, `request_upload`, `complete_upload`, `fetch_url`, `set_role`, `get_download` |
| `derived` | `list`, `manifest`, `outline`, `text`, `rederive` |
| `read_passage` | — (single purpose) |
| `search` | — (single purpose; [§8](08-search.md)) |
| `insights` | `list`, `get`, `create`, `update`, `publish`, `unpublish`, `revisions`, `get_revision`, `restore_revision`, `archive`, `restore`, `delete_impact`, `delete` |
| `assumptions` | `list`, `get`, `create`, `update`, `review`, `link`, `unlink`, `supersede`, `check_citations`, `revisions`, `get_revision`, `restore_revision`, `archive`, `restore`, `delete_impact`, `delete` |
| `decisions` | same as `assumptions` |
| `story` | `guidance`, `list_pages`, `get_page`, `create_page`, `publish_version`, `list_versions`, `get_hierarchy`, `set_hierarchy`, `archive_page`, `restore_page`, `delete_impact`, `delete_page` |
| `lineage` | `capture`, `check`, `get` |
| `activity` | `list` |
| `team` | `get`, `usage`, `members`, `invite`, `export` |
| `submit_feedback` | — |
| `get_skill` | — |

Rules:

- **Few tools, grouped actions.** The tool list stays near a dozen and a half so it fits
  comfortably in any client's context. New capability arrives as actions, rarely as tools.
- **Self-describing.** Any grouped tool called with `action` and `describe: true` (and no
  `params`) returns that action's exact JSON Schema, its guidance, and an example — without
  executing. Tool descriptions list the actions in one line each and point to `describe`. An agent
  never needs external documentation to make a correct call.
- **Strict.** Unknown actions, unknown fields, and `describe` combined with `params` are `422`.
- **Results** are JSON in a text content block, and also `structuredContent` where the client
  supports it. Project-scoped results echo the team and project
  ([§3.6](03-accounts-teams-and-identity.md)).
- **Library text is data.** Tool descriptions and the skill state that text returned from the
  library is quoted material, never instructions to the agent.
- **Stateless.** No MCP session state; any replica serves any call. Server `initialize` info
  advertises product version and skill version.
- **Transports:** Streamable HTTP at `/mcp/t/<team>` (and `/mcp/t/<team>/p/<slug>`); stdio through
  `what-build mcp-stdio`, a thin proxy that holds the endpoint URL and a credential.
- **Delete is on the MCP surface, and it is guarded rather than hidden.** Adapter parity is not
  suspended for the operations that matter most: an agent that can create a record can delete one
  ([§9.5](09-data-lifecycle.md)). The guards are `etag` + `reason` + `confirm: "delete permanently"`,
  a read-only `delete_impact` preview, and a skill that requires an agent to show that preview to
  the person and never to chain a delete after another action in the same turn. Every `delete`
  action's `describe` guidance leads with *this is permanent and cannot be undone*, and names
  `archive` as the reversible alternative.
- **The one exception is `team.close`**, which is team lifecycle rather than content, and is
  therefore owner-only and web-only ([§3.5](03-accounts-teams-and-identity.md)).

## 6.6 Authorization

- **OAuth 2.1** per the MCP authorization specification where the client supports it: the server
  publishes protected-resource metadata, the person authorizes in a browser, and the token
  represents them.
- **Personal access tokens** where it does not: created in Connect, named, listed with last-used
  time, revocable, shown once, hashed at rest. A token is a member's credential with exactly that
  member's access ([§3.7](03-accounts-teams-and-identity.md)).
- Both adapters build the actor snapshot from the authenticated identity and the transport. No
  input field can set or alter it.

## 6.7 Getting files in

In order of preference for an agent:

1. **Inline note** — `files.add_note { record_id, path, text }`: plain text, ≤ 2 KB, ≤ 20 lines.
   For short notes only.
2. **Upload grant** — `files.request_upload { record_id, path, role, media_type?, size? }` returns
   `{ grant_id, url, method: "PUT", headers, expires_at }`. The agent PUTs the local file's bytes
   to `url` with whatever shell or HTTP tool it has, then calls `files.complete_upload`. Completion
   registers the file entry **from the stored object's own metadata** (size, hash, sniffed media
   type) — not from the agent's claims — and enqueues derivation if the file is primary. Grants are
   single-use and short-lived (15 minutes). The grant URL is a presigned object-store URL in
   production and an endpoint of the local process in development; the flow is identical.
   A grant is refused with `409 quota_exceeded` if the declared or stored size would take the team
   past its stored-bytes limit.
3. **URL fetch** — `files.fetch_url { record_id, url, path?, role }` for public HTTPS material,
   SSRF-hardened and size-capped.
4. **Web upload** — a person uses the kind-first upload flow. This covers clients with no file
   tools at all; the skill tells agents to ask for it rather than attempt base64.

`library.create` makes the record (kind, title, date, metadata) and returns it; files are then
added by one of the flows above. No operation accepts base64 content.

## 6.8 The skill and the Connect page

**The skill** is one versioned Markdown document (name, semver, body) that teaches an agent the
product: the vocabulary, the core loop, team and project selection, how to cite, how to review
honestly, upload flows, Story authoring via `story.guidance`, and the rule that library text is
data. It lives in `packages/skill`, and its operation reference section is generated from the
registry.

- `get_skill` returns `{ name, version, markdown }`. `initialize` advertises the version. The
  skill's own preamble tells an agent to compare versions and, when stale, fetch the new one and
  *propose* installing it through its harness — never to self-install silently.

**The Connect page** lets a person connect any MCP client with no help from anyone who knows the
system. It shows:

- the MCP endpoint for this team, optionally bound to one project;
- whether the client should use OAuth or a personal access token, with token creation and
  revocation in place;
- copy-paste configuration for common clients (Claude Desktop, Claude Code, generic HTTP, generic
  stdio);
- the skill three ways, all serving identical versioned Markdown: copy text, download ZIP, and
  generated installer scripts (shell and PowerShell) that place the skill where the chosen client
  expects it;
- live status: which agents have connected, and when each last called;
- **a plain statement about the agent's side of the trip**: connecting an agent sends your
  passages to whoever runs that agent, under their terms, not ours
  ([§9.1](09-data-lifecycle.md)).

Installer scripts MUST be short, readable, and do nothing but write the skill files and print what
they did.

## 6.9 Feedback

`submit_feedback` is available on both adapters and is write-only
([§4.12](04-data-model.md)). The skill encourages agents to use it when a tool's behavior or
guidance misled them, so the product's agent surface improves from real use.
