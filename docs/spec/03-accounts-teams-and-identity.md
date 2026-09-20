# 3. Accounts, teams, projects, identity

## 3.1 The hierarchy

```
account              one person's sign-in; belongs to one or more teams
team                 membership, billing and isolation boundary
└── project          one product discovery
    ├── objectives
    ├── library      records → files → derivations → segments; annotations
    ├── insights     with immutable revisions
    ├── assumption register · decision register
    ├── Story        pages, versions, hierarchy
    ├── views        lineage baselines
    └── activity     append-only event log
```

- Every object belongs to **exactly one project**, recorded as an immutable `project_id`, and every
  project to exactly one team, recorded as an immutable `team_id`.
- **References never cross projects.** A citation, link, or reference whose target is in another
  project is rejected with `422 cross_project_reference`. This keeps a project exportable as a
  closed bundle.
- ◆ Decision: material that matters to two discoveries is added to both. A later "copy record to
  project" operation (new record id, provenance link to the original) is the planned relief; shared
  records are not.
- Members, invitations, usage, the skill, and feedback reports are team-level. Nothing else is.

## 3.2 Accounts and sign-up

| Field | Rule |
|---|---|
| `account_id` | ULID, immutable. |
| `email` | Unique, verified before any upload. |
| `display_name` | 1–100 chars. Appears in attribution. |
| `created_at` | |

Sign-up is: email address → verification link → name your team → create the first project or copy
the sample project → invite colleagues → Connect an agent.

- **Sign-in methods:** email + password, and email magic link. ◆ Decision: OIDC and social sign-in
  are permitted by the design but are not in v1; they are one Better Auth plugin away.
- Verification MUST be complete before a file can be uploaded or an invitation sent. Reading and
  creating text is allowed before it.
- Per-IP and per-email sign-up rate limits apply from the first public deployment
  ([§9.2](09-data-lifecycle.md)).
- An account may be deleted by its owner. Deleting an account removes the person from every team;
  it does **not** delete team content, and attribution snapshots survive
  ([§3.8](#38-attribution)).

## 3.3 Teams

| Field | Rule |
|---|---|
| `team_id` | ULID, immutable. The canonical reference. |
| `slug` | 3–50 chars, `[a-z0-9-]`, globally unique. Mutable; previous slugs keep resolving until reused. |
| `name` | 1–100 chars. |
| `plan` | `free` in v1. The seam for a later paid plan. |
| `status` | `active` or `closing` ([§9.5](09-data-lifecycle.md)). |

- Operations: `get`, `update`, `usage`, `members`, `invite`, `remove_member`, `export`, `close`.
- An account that signs up gets **one team**, created by them, and may be invited into others.
- **Settled 2026-09-19: the word is "team".** It is what a person calls the thing they create and
  invite people to, and one word per concept is a rule of this spec. "Workspace" does not appear in
  the product.

## 3.4 Projects

| Field | Rule |
|---|---|
| `project_id` | ULID, immutable. The canonical reference. |
| `slug` | 3–50 chars, `[a-z0-9-]`, unique in the team. Mutable; previous slugs keep resolving to the project until reused. |
| `name` | 1–100 chars. |
| `idea` | Markdown, up to 2,000 chars. The product idea this discovery serves; shown at the top of Objectives. |
| `status` | `active` or `archived`. |
| envelope | `etag`, `created_*`, `updated_*` ([§4.1](04-data-model.md)). |

- Operations: `list`, `get`, `create`, `update`, `archive`, `restore`. No delete.
- Archiving a project hides it from the switcher and default listings and makes it read-only
  (writes return `409 project_archived`) until restored. Nothing inside it changes. An archived
  project still counts toward stored bytes and still exports.
- A brand-new team has no projects. The first-run experience is creating one: name, idea.
- ◆ Decision: a **sample project** — synthetic interviews, a few objectives, an insight, a couple of
  register entries and a Story page — can be copied into a team in one click, so a new team sees
  the whole loop before uploading anything. It is also published **read-only and
  unauthenticated** at a stable URL, so someone can see a real, fully derived discovery before
  deciding whether to sign up. All sample content MUST be synthetic.

## 3.5 Membership

- Membership is binary. Every member can do everything inside the team, including inviting and
  removing members, creating and archiving projects, and exporting.
- ◆ Decision: the single exception is an `owner` flag that gates only **team lifecycle**: rename,
  transfer ownership, close the team, and (later) billing. It never gates content — deleting a
  record is a content operation and is available to every member
  ([§9.5](09-data-lifecycle.md)). This is the **only** `403 owner_only` in the product.
- Invitations are by email or single-use link, expire after 7 days, and are consumed on acceptance.
  An invitation to an address with no account starts a sign-up.
- Removing a member revokes their sessions and tokens for that team. Their attribution snapshots
  remain ([§3.8](#38-attribution)).
- A person may belong to several teams and switches between them in the UI.

## 3.6 Addressing, and isolation

The team and the project are always explicit in the request. Nothing on the server remembers a
"current" anything, because the transports are stateless.

**Web.** `/t/<team-slug>/p/<project-slug>/library`. Links are shareable and browser history works
across teams and projects. The switcher's requirements are in [§7.2](07-web-app.md).

**REST.** `/api/v1/t/<team-id-or-slug>/p/<project-id-or-slug>/…`. Team-level routes drop the `/p/`
segment.

**MCP.** The endpoint carries the team — `/mcp/t/<team-slug>`, or `/mcp/t/<team>/p/<slug>` for
people who want one agent configuration per discovery. A token is only ever valid for teams its
account belongs to. The project then resolves in this order:

1. the explicit `project` parameter;
2. a project bound to the endpoint;
3. the team's only active project, if there is exactly one;
4. otherwise `422 project_required`, with the list of active projects (id, slug, name) in
   `details` so the agent can ask the person or choose.

Every project-scoped MCP result echoes `team: { id, slug }` and `project: { id, slug, name }` so an
agent, and the person reading its transcript, can see where a write landed. The skill instructs
agents to confirm the project with the person before their first write in a conversation.

**Isolation** is enforced in three places, deliberately redundantly:

1. Authorization resolves the caller's membership of the addressed team, or returns `404`.
2. The core receives `stores.forTeam(team_id)` and can express nothing wider. Handlers never
   receive a raw database handle.
3. Postgres row-level security policies key on a session-local `team_id`, so a query that escaped
   the first two layers still returns nothing.

Blob keys begin `t/<team_id>/p/<project_id>/…`, so a mis-scoped read cannot even name another
team's object. A conformance test MUST attempt a cross-team read through **every** operation and
require `404` from all of them — not `403`: in this product an object you cannot reach does not
exist.

## 3.7 Identity of the caller

| Surface | Credential | Caller |
|---|---|---|
| Web | Session cookie, `SameSite=Lax`, rotated on sign-in | the signed-in account |
| REST (scripts) | Session or personal access token | the same account |
| MCP | OAuth 2.1 access token, or a personal access token | **the person who authorized it** |
| Job worker | none — internal | the actor recorded on the job |

- **MCP authentication** follows the MCP authorization specification: the server publishes
  protected-resource metadata and acts as (or delegates to) an OAuth 2.1 authorization server. An
  agent is a member acting through another surface — the same account, not a separate service
  identity.
- ◆ Decision: **personal access tokens are in v1.** There is no local no-auth mode to fall back
  on, so without them a client that cannot do OAuth has no way in at all. A
  token is a member's credential: full access of that member, named, listed, revocable, shown once,
  and attributed exactly like a session. It never carries scopes that widen or narrow what the
  member can do.
- An unauthenticated call gets `401` from both adapters. No caller-supplied input (header, param,
  claimed name) can change who the caller is or what they can reach.

## 3.8 Attribution

Every mutation stores an **actor snapshot**:

```json
{
  "account_id": "01J…",
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
- Snapshots are copied, not joined, so attribution survives renames, member removal, account
  deletion, and bundle import into another team.
- Every mutation also appends an **activity event** ([§4.10](04-data-model.md)). Attribution
  answers "who wrote this"; activity answers "what has been happening here" — which matters far
  more now that several people and their agents work in the same project at once.
