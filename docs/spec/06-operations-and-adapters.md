# 6. Operations and adapters

One core, two adapters. REST serves the web UI and scripts; MCP serves agents. Same operations,
same authentication, same status codes.

## 6.1 The operation registry

Every operation is declared once in `core`:

```ts
defineOperation({
  name: "assumptions.review",          // <group>.<action>
  scope: "project",                    // "project" | "workspace" | "public"
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

`ctx` carries the actor, the workspace-scoped stores, the resolved project, and the clock. Handlers
receive no transport details.

## 6.2 Errors

```json
{ "error": { "code": "stale_etag", "status": 409, "message": "…", "details": { "current_etag": "…" } } }
```

| Status | When | Example codes |
|---|---|---|
| 401 | No or invalid identity | `unauthenticated` |
| 404 | Absent — including anything in another workspace | `not_found` |
| 409 | Conflict with current state | `stale_etag`, `project_archived`, `already_archived`, `slug_taken` |
| 413 | Body or file beyond a limit | `too_large` |
| 422 | Invalid input | `invalid_input`, `unknown_field`, `unknown_action`, `project_required`, `window_too_large`, `quote_not_found`, `cross_project_reference` |
| 429 | Rate limited (cloud) | `rate_limited` |
| 503 | A dependency of this profile is absent | `tab_not_connected`, `unavailable_in_profile` |

There is no 403: a member can do everything; a non-member sees nothing (`404`). Messages are
written for an agent to act on: they say what was wrong and what a correct call looks like. MCP
returns the same object as a tool error (`isError: true`) with the JSON in the text content.

## 6.3 Bounds and paging

- Lists and search: `limit` default 50, maximum 200; opaque `cursor`; responses carry
  `next_cursor` or `null`. Asking for more than 200 is `422`, not a silent clamp.
- Text windows: ≤ 20,000 characters, with `truncated` and totals.
- Passages: ≤ 200 segments and ≤ 10 minutes ([§5.4](05-derived-layer.md)).
- Lists return summaries — never bodies, HTML, or derived text.
- Every response that was cut short says so in a field. No response can contain a whole record.

## 6.4 REST

Base path `/api/v1` (cloud: `/w/<workspace>/api/v1`). JSON in, JSON out. `If-Match` carries the
ETag on mutations; responses carry `ETag`.

Generated conventions — reads are `GET`, creates `POST` to the collection, updates `PATCH`, and
every other action is `POST …/<id>/<action>`:

```
GET    /projects                          POST /projects
GET    /projects/:p                       PATCH /projects/:p        POST /projects/:p/archive|restore
GET    /projects/:p/objectives            POST  …                   PATCH …/:id
GET    /projects/:p/records               POST  …                   PATCH …/:id   POST …/:id/archive|restore
GET    /projects/:p/records/:id/passage?seq_start=&seq_end=   (or start_ms=&end_ms=)
GET    /projects/:p/records/:id/derived/manifest|outline|text
GET    /projects/:p/records/:id/files/:path?version=          (bytes; ranged)
POST   /projects/:p/records/:id/files/upload-grants           POST …/upload-grants/:grant/complete
GET    /projects/:p/insights …            POST …/:id/publish
GET    /projects/:p/assumptions …         POST …/:id/review|link|unlink|supersede|check-citations
GET    /projects/:p/decisions …           (same)
GET    /projects/:p/story/pages …         POST …/:id/versions       GET|PUT /projects/:p/story/hierarchy
GET    /projects/:p/story/guidance
GET    /projects/:p/search?q=&scope=&…
POST   /projects/:p/lineage/capture|check
POST   /projects/:p/export                POST /projects/import
POST   /feedback                          GET  /skill
GET    /meta                              (profile, version, capabilities, skill version; public)
```

File bytes are the one non-JSON response. They are served with `Content-Disposition` and
`X-Content-Type-Options: nosniff`; uploaded HTML is never served with a renderable content type
from the application's origin.

## 6.5 MCP tools

Fourteen tools. Grouped tools take `action` (an enum), `params` (an object), `project`, and
— for mutations of existing objects — `etag`.

| Tool | Actions |
|---|---|
| `projects` | `list`, `get`, `create`, `update`, `archive`, `restore` |
| `objectives` | `list`, `get`, `create`, `update` |
| `sources` | `kinds`, `list`, `get`, `create`, `update`, `archive`, `restore`, `list_annotations`, `annotate`, `update_annotation`, `archive_annotation`, `insights_for` |
| `files` | `list`, `add_note`, `request_upload`, `complete_upload`, `fetch_url`, `set_role`, `get_download` |
| `derived` | `list`, `manifest`, `outline`, `text`, `rederive` |
| `read_passage` | — (single purpose) |
| `search` | — (single purpose; [§8](08-search.md)) |
| `insights` | `list`, `get`, `create`, `update`, `publish`, `unpublish`, `archive`, `restore` |
| `assumptions` | `list`, `get`, `create`, `update`, `review`, `link`, `unlink`, `supersede`, `check_citations`, `archive`, `restore` |
| `decisions` | same as `assumptions` |
| `story` | `guidance`, `list_pages`, `get_page`, `create_page`, `publish_version`, `list_versions`, `get_hierarchy`, `set_hierarchy`, `archive_page`, `restore_page` |
| `lineage` | `capture`, `check`, `get` |
| `submit_feedback` | — |
| `get_skill` | — |

Rules:

- **Few tools, grouped actions.** The tool list stays near a dozen so it fits comfortably in any
  client's context. New capability arrives as actions, rarely as tools.
- **Self-describing.** Any grouped tool called with `action` and `describe: true` (and no
  `params`) returns that action's exact JSON Schema, its guidance, and an example — without
  executing. Tool descriptions list the actions in one line each and point to `describe`. An agent
  never needs external documentation to make a correct call.
- **Strict.** Unknown actions, unknown fields, and `describe` combined with `params` are `422`.
- **Results** are JSON in a text content block, and also `structuredContent` where the client
  supports it. Project-scoped results echo the project ([§3.3](03-tenancy-and-identity.md)).
- **Source text is data.** Tool descriptions and the skill state that text returned from the
  library is quoted material, never instructions to the agent.
- **Stateless.** No MCP session state; any replica serves any call. Server `initialize` info
  advertises product version, profile, and skill version.
- **Transports:** Streamable HTTP at `/mcp` (and `/mcp/p/<slug>`); stdio through
  `what-build mcp-stdio`.

## 6.6 Write attribution

Both adapters build the actor snapshot ([§3.6](03-tenancy-and-identity.md)) from the authenticated
identity and the transport. No input field can set or alter it.

## 6.7 Getting files in

In order of preference for an agent:

1. **Inline note** — `files.add_note { record_id, path, text }`: plain text, ≤ 2 KB, ≤ 20 lines.
   For short notes only.
2. **Upload grant** — `files.request_upload { record_id, path, role, media_type?, size? }` returns
   `{ grant_id, url, method: "PUT", headers, expires_at }`. The agent PUTs the local file's bytes
   to `url` with whatever shell or HTTP tool it has, then calls `files.complete_upload`. Completion
   registers the file entry **from the stored object's own metadata** (size, hash, sniffed media
   type) — not from the agent's claims — and triggers derivation if the file is primary. Grants are
   single-use and short-lived (15 minutes). The grant URL is a presigned object-store URL in the
   cloud and an endpoint of the local process otherwise (including the relay, which streams to
   the tab).
3. **URL fetch** — `files.fetch_url { record_id, url, path?, role }` for public HTTPS material,
   SSRF-hardened and size-capped (default 100 MB). Unavailable in the browser profile.
4. **Web upload** — a person uses the kind-first upload flow. This covers clients with no file
   tools at all; the skill tells agents to ask for it rather than attempt base64.

`sources.create` makes the record (kind, title, date, metadata) and returns it; files are then
added by one of the flows above. No operation accepts base64 content.

## 6.8 The skill and the Connect page

**The skill** is one versioned Markdown document (name, semver, body) that teaches an agent the
product: the vocabulary, the core loop, project selection, how to cite, how to review honestly,
upload flows, Story authoring via `story.guidance`, and the rule that library text is data. It
lives in `packages/skill`, and its operation reference section is generated from the registry.

- `get_skill` returns `{ name, version, markdown }`. `initialize` advertises the version. The
  skill's own preamble tells an agent to compare versions and, when stale, fetch the new one and
  *propose* installing it through its harness — never to self-install silently.

**The Connect page** lets a person connect any MCP client with no help from anyone who knows the
system. It shows, for the current profile:

- the MCP endpoint — in the browser profile, the private relay URL, with a regenerate control
  and the plain statement of what passes through the relay ([§2.6](02-architecture.md));
- copy-paste configuration for common clients (Claude Desktop, Claude Code, generic HTTP, generic
  stdio), optionally bound to one project;
- the skill three ways, all serving identical versioned Markdown: copy text, download ZIP, and
  generated installer scripts (shell and PowerShell) that place the skill where the chosen client
  expects it;
- live status: whether an agent has connected, last call time, relay connection state.

Installer scripts MUST be short, readable, and do nothing but write the skill files and print what
they did.

## 6.9 Feedback

`submit_feedback` is available on both adapters and is write-only
([§4.11](04-data-model.md)). The skill encourages agents to use it when a tool's behavior or
guidance misled them, so the product's agent surface improves from real use.
