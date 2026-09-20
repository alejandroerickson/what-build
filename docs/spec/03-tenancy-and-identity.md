# 3. Workspaces, projects, identity

## 3.1 The hierarchy

```
workspace            membership boundary; one per local install, many in the cloud
└── project          one product discovery
    ├── objectives
    ├── library      records → files → derivations → segments; annotations
    ├── insights
    ├── assumption register · decision register
    ├── Story        pages, versions, hierarchy
    └── views        lineage baselines
```

- Every object belongs to **exactly one project**, recorded as an immutable `project_id`.
- **References never cross projects.** A citation, link, or reference whose target is in another
  project is rejected with `422`. This keeps a project exportable as a closed bundle.
- ◆ Decision: a source that matters to two discoveries is added to both. A later "copy record to
  project" operation (new record id, provenance link to the original) is the planned relief; shared
  records are not.
- Feedback reports and the skill are workspace-level. Nothing else is.

## 3.2 Projects

| Field | Rule |
|---|---|
| `project_id` | ULID, immutable. The canonical reference. |
| `slug` | 3–50 chars, `[a-z0-9-]`, unique in the workspace. Mutable; previous slugs keep resolving to the project until reused. |
| `name` | 1–100 chars. |
| `idea` | Markdown, up to 2,000 chars. The product idea this discovery serves; shown at the top of Objectives. |
| `status` | `active` or `archived`. |
| envelope | `etag`, `created_*`, `updated_*` ([§4.1](04-data-model.md)). |

- Operations: `list`, `get`, `create`, `update`, `archive`, `restore`. No delete.
- Archiving a project hides it from the switcher and default listings and makes it read-only
  (writes return `409 project_archived`) until restored. Nothing inside it changes.
- A brand-new workspace has no projects. The first-run experience is creating one: name, idea.
- ◆ Decision: a bundled **sample project** (synthetic interviews, a few objectives, an insight, a
  Story page) can be imported in one click, so a first-time visitor sees the whole loop before
  uploading anything. All sample content MUST be synthetic.

## 3.3 Selecting the project

The project is always explicit in the request. Nothing on the server remembers a "current
project", because the transports are stateless.

**Web.** The project slug is in the path: `/p/<slug>/objectives`. Links are therefore shareable
and the browser's history works across projects. The switcher's requirements are in
[§7.2](07-web-app.md).

**REST.** `/api/v1/projects/<id-or-slug>/…`.

**MCP.** Every project-scoped tool takes a `project` parameter (id or slug). Resolution order:

1. the explicit `project` parameter;
2. a project bound to the endpoint — `/mcp/p/<slug>` over HTTP, or `--project <slug>` on
   `mcp-stdio` — for people who want one agent configuration per discovery;
3. the workspace's only active project, if there is exactly one;
4. otherwise `422 project_required`, with the list of active projects (id, slug, name) in
   `details` so the agent can ask the person or choose.

Every project-scoped MCP result echoes `project: { id, slug, name }` so an agent, and the person
reading its transcript, can see where a write landed. The skill instructs agents to confirm the
project with the person before their first write in a conversation.

## 3.4 Identity per profile

| Profile | Sign-in | Workspace | Caller |
|---|---|---|---|
| Browser | none | one implicit `local` workspace | the local principal; display name editable in settings |
| Server on loopback | none | one | the local principal |
| Server on a non-loopback address | **required** | one | signed-in members |
| Cloud | required | many | signed-in members of the addressed workspace |

- A server bound to a non-loopback address without configured sign-in MUST refuse to start. An
  explicit `--insecure-no-auth` flag MAY override this for trusted networks and MUST log a warning
  on every start.
- **Sign-in methods** (self-host and cloud): generic OIDC, plus email magic link where mail is
  configured. Self-host additionally allows a single owner passphrase so that one person can host
  an instance with no identity provider at all.
- **MCP authentication** follows the MCP authorization specification: the server publishes
  protected-resource metadata and acts as (or delegates to) an OAuth 2.1 authorization server;
  the agent's token represents the **person who authorized it**. An agent is therefore a member
  acting through another surface — the same account, not a separate service identity.
- **No API keys as access rules.** Tokens authenticate a member; they never carry scopes that
  widen or narrow what a member can do. ◆ Decision: if personal access tokens are added for
  clients that cannot do OAuth, they are exactly that — a member's credential, full access,
  revocable, attributed.
- An unauthenticated call gets `401` from both adapters. No caller-supplied input (header, param,
  claimed name) can change who the caller is or what they can reach.

## 3.5 Workspaces and membership (cloud, and self-host with several users)

- A workspace has `workspace_id`, `slug`, `name`, and members.
- Membership is binary. Every member can do everything inside the workspace, including inviting
  and removing members and archiving projects. ◆ Decision: the single exception is an `owner`
  flag that gates only *workspace lifecycle and billing* (rename, transfer, close) — never
  content.
- Invitations are by email or link, expire, and are single-use.
- A user may belong to several workspaces. The workspace is addressed by host or path
  (`/w/<slug>/…`, `/w/<slug>/mcp`); local profiles omit the prefix.
- Isolation: every table row and blob key carries `workspace_id`; the core only ever receives a
  workspace-scoped store; Postgres additionally enforces row-level security. A conformance test
  MUST attempt cross-workspace reads through every operation and fail them all with `404`.

## 3.6 Attribution

Every mutation stores an **actor snapshot**:

```json
{
  "principal_id": "01J…",
  "display_name": "Sam Rivera",
  "surface": "mcp",
  "client": "claude-desktop"
}
```

- `surface` is `web`, `rest`, or `mcp`. `client` is the MCP `clientInfo.name` (or a REST
  `User-Agent` product token) and is informational.
- An actor is treated as an **agent** when `surface = mcp`, and as a **human** when
  `surface = web`. This distinction is descriptive — it never affects access. Its one functional
  use is review confidence ([§4.8](04-data-model.md)).
- Snapshots are copied, not joined, so attribution survives renames, member removal, and bundle
  import into another workspace.
