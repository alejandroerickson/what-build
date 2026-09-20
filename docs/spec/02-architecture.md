# 2. Architecture

## 2.1 Requirements that drive the stack

1. **Zero-install trial, agents included.** Open a demo we host, use the whole product, connect
   an agent by pasting a URL. Data is *stored* only in the visitor's browser; it transits our
   relay while an agent works (§2.6). For data that does not matter.
2. **Local, for real data.** Run one command; data on disk; connect Claude Desktop, Claude Code,
   or any MCP client to the built-in MCP server.
3. **Self-host.** One person can host their own instance cheaply: one container, one volume.
4. **Cloud.** A multi-tenant hosted service where teams share a workspace — later, without a
   rewrite.
5. **One behavior.** The same operation gives the same result in all of the above.

Requirement 1 forces the core to run in a browser. Requirement 5 forces the core to be the *same
code* everywhere. Together they decide the language.

## 2.2 Stack

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict), ES modules | The only language that runs the core in a browser worker and on a server unchanged. |
| Server runtime | **Node.js** current LTS | Boring, universal, `npx`-able. No Bun/Deno-only APIs in shared code. |
| HTTP | **Hono** | Small, standards-based (`Request`/`Response`), portable across Node, containers, and edge runtimes. Keeps hosting options open. |
| MCP | **`@modelcontextprotocol/sdk`** | Official SDK. Streamable HTTP transport in stateless mode, plus stdio. |
| Schemas | **Zod 4** | One schema per operation yields TypeScript types, runtime validation, and JSON Schema for MCP tools and `describe`. |
| SQL | **Kysely** query builder | Typed SQL that runs in the browser and on the server, with SQLite and Postgres dialects from one query source. |
| Database — browser | **SQLite WASM** on OPFS (`opfs-sahpool` VFS) in a dedicated worker | Real SQL and FTS5 in the browser; needs no cross-origin-isolation headers, so any static host works. |
| Database — server | **SQLite** (`better-sqlite3`; `node:sqlite` once stable) | One file. Same dialect and FTS5 as the browser. |
| Database — cloud | **Postgres** | Standard multi-tenant choice; row-level security as defense in depth. Deferred to the cloud phase. |
| Blobs | Port with OPFS, filesystem, and S3-compatible adapters | Files and derived sidecars are immutable blobs everywhere. |
| Web UI | **React + Vite**, static SPA; **TanStack Router** and **TanStack Query** | Must build to static files (the browser profile has no server, so no SSR framework). Typed URL search params suit URL-held filters. |
| Parsing | Own code for text/Markdown/VTT/SRT; `pdfjs-dist` for PDF; `fflate` + a SAX XML parser for DOCX; `parse5` for HTML | Every parser MUST run in a browser worker and in Node. No native or Node-only parser dependencies. |
| Markdown rendering | `markdown-it` + DOMPurify | Insight bodies are untrusted input. |
| Auth (self-host, cloud) | **Better Auth** — candidate, confirm by spike | TypeScript, runs on Hono, stores through Kysely on SQLite and Postgres, has organization, SSO, and MCP OAuth-provider plugins. |
| Tooling | pnpm workspaces, Vitest (Node **and** browser mode), Playwright, ESLint, Prettier | |

Design system and visual language are out of scope here and chosen in the design phase.

## 2.3 The three profiles

```
                ┌──────────────────────── core ────────────────────────┐
                │  operation registry · domain rules · parsers · search │
                └───────┬──────────────────────┬──────────────────┬─────┘
                        │ ports                │                  │
        ┌───────────────┴───┐   ┌──────────────┴─────┐  ┌─────────┴────────────┐
        │ BROWSER profile    │   │ SERVER profile     │  │ CLOUD profile         │
        │ core in a worker   │   │ Node process       │  │ stateless replicas    │
        │ SQLite WASM + OPFS │   │ SQLite + disk      │  │ Postgres + S3 + queue │
        │ no sign-in         │   │ none on loopback,  │  │ sign-in, workspaces,  │
        │ MCP via our relay  │   │ sign-in otherwise  │  │ invitations           │
        └────────────────────┘   └────────────────────┘  └───────────────────────┘
```

### Browser profile — "try it"

- The static SPA is served from anywhere (a project demo site, or the local server).
- The core runs in a **dedicated Web Worker**. Metadata lives in SQLite WASM on OPFS; file and
  sidecar bytes live in OPFS. The UI reaches the core through the worker transport (§2.5), not
  HTTP. File previews use blob URLs.
- The app MUST call `navigator.storage.persist()`, MUST show whether storage is persistent, and
  MUST surface export prominently: browser storage can be evicted and is invisible to backups.
- Multiple tabs: only one worker may own the database. v1 MAY use Web Locks so that a second tab
  offers "take over here"; it MUST NOT corrupt or fork data.
- Agents connect through the hosted **relay** (§2.6). Without it the browser profile has no MCP.
- Operations that a browser cannot perform (fetching an arbitrary URL blocked by CORS) MUST fail
  with a clear `unavailable_in_profile` error, not silently.

### Server profile — "run it" and "self-host it"

- `npx what-build` starts one Node process that serves the SPA, REST (`/api/v1`), MCP over
  Streamable HTTP (`/mcp`), and upload-grant endpoints. Data lives in a directory
  (`./.what-build/` by default): one SQLite file plus a blob folder.
- The same process packaged as a Docker image is the self-host story: one container, one volume.
- Exactly one workspace. Bound to loopback, there is no sign-in and the caller is the local
  principal. Bound to anything else, sign-in MUST be configured or the process refuses to start
  ([§3.4](03-tenancy-and-identity.md)).
- Single replica by definition (SQLite on a local volume).

### Cloud profile — "use ours"

- The same server code with Postgres, S3-compatible object storage, and a job queue behind the
  same ports; many workspaces; sign-in, invitations, rate limits.
- **Stateless replicas.** Any replica serves any request. Storage clients are constructed at
  startup and carried on application context — never at module scope. No module-level mutable
  state and no in-process caches of tenant data. MCP runs in stateless mode with no session
  affinity. These rules apply to all server code from day one, so the cloud profile is a
  configuration, not a port.
- ◆ Decision: reference deployment is a container platform plus managed Postgres and any
  S3-compatible store. No cloud-vendor SDK may appear outside an adapter package.

### Moving between profiles

A **project bundle** (export/import, [§4.12](04-data-model.md)) moves a whole project between any
two profiles with ids, versions, attribution, and citations intact. This is the supported path
from "tried it in the browser" to "running it locally" to "hosted".

## 2.4 Ports

The core depends only on these interfaces. Each adapter package implements some of them.

| Port | Responsibility | Browser | Server | Cloud |
|---|---|---|---|---|
| `Database` | A Kysely instance plus dialect capabilities | SQLite WASM | SQLite | Postgres |
| `BlobStore` | Immutable blobs: `put` → `version_id`, `get` (ranged), `stat`, `list` | OPFS | filesystem | S3-compatible |
| `SearchIndex` | Index and query segments and register text | FTS5 | FTS5 | Postgres FTS |
| `UploadGrants` | Issue and redeem direct-upload grants | via relay | local HTTP endpoint | presigned URLs |
| `JobRunner` | Run derivation now or later | inline in worker | in-process queue | external queue |
| `UrlFetcher` | Size-capped, SSRF-safe HTTPS fetch | unavailable (CORS) | yes | yes |
| `Clock`, `IdGenerator` | Time and ULIDs | | | |
| `Embedder` (later) | Text → vector for semantic retrieval | | | |

Rules:

- A `Database` handle is always **scoped to one workspace** before the core sees it
  (`stores.forWorkspace(id)`); core code cannot express a cross-workspace query.
- An **in-memory** implementation of every port exists for tests and the earliest build phase.
- One **conformance suite** runs unchanged against every adapter: in-memory, SQLite on Node,
  SQLite WASM in a real browser (Vitest browser mode), and Postgres.

## 2.5 One operation protocol, several transports

Every operation call has one canonical shape:

```
call:    { op: "objectives.update", project: "<id|slug>", params: {…}, etag?: "…" }
result:  { ok: true,  result: {…}, etag?: "…" }
       | { ok: false, error: { code, status, message, details? } }
```

| Transport | Used by | Mapping |
|---|---|---|
| Direct function call | tests, server adapters | the shape itself |
| Worker `postMessage` | browser-profile UI | the shape itself |
| REST | server-profile UI, scripts | method + path + `If-Match`, generated from the registry |
| MCP | agents | tool + `action` + `params`, generated from the registry |
| Relay WebSocket | MCP → browser tab | the shape itself |

The web UI is written against a `Client` interface with two implementations (`HttpClient`,
`WorkerClient`). UI code MUST NOT know which profile it is in except through a capabilities
object (`client.capabilities`: sign-in present, URL fetch available, relay status, …).

## 2.6 The relay

An MCP client needs an endpoint it can reach; browser storage can only be reached from the tab
that owns it, and a tab cannot listen for connections. The **relay** joins them: a small service
**we host** beside the hosted demo, so that the zero-install trial includes agents with nothing
installed.

```
MCP client ──HTTPS (MCP)──▶ relay (stores nothing) ◀──WSS, tab dials out── browser tab ─▶ worker ─▶ OPFS
```

- The relay hosts the **full MCP adapter** (tool list, `describe`, validation, skill) and
  upload-grant endpoints, and has **no storage**. It forwards each validated operation call over
  the tab's WebSocket; the tab's worker executes it against browser storage; the relay returns
  the result.
- **Pairing.** On the Connect page the tab opens `wss://<relay>/tab`, and receives a relay id and
  a high-entropy secret. The person's MCP endpoint is the capability URL
  `https://<relay>/mcp/r/<id>.<secret>` — pasted into any MCP client as a remote server. The
  secret is the credential: it MUST be ≥ 128 bits, regenerable from the Connect page (which
  invalidates the old URL), never logged, and the WebSocket MUST be accepted only from
  allow-listed `Origin`s.
- Calls through the relay act as the browser profile's local principal, with `surface: "mcp"`.
- With no tab connected, tools fail with `503 tab_not_connected` and a message telling the agent
  to ask the person to open the app. The UI shows when an agent is connected and its last call.
- **Honest privacy wording.** Data is *stored* only in the browser, but it *passes through* the
  relay whenever an agent reads or writes, and TLS terminates at the relay. The product MUST say
  exactly that, MUST NOT claim data never leaves the device, and MUST recommend non-sensitive data
  for the hosted demo. The relay MUST NOT persist or log operation params or results.
- **An anonymous public service needs limits:** per-relay and per-IP rate limits, idle timeout,
  response-size cap, upload cap (default 25 MB; uploads stream through to the tab), and a cap on
  concurrent relays.
- **Stateful by nature, so separate.** The relay holds open sockets and therefore lives in its
  own app (`apps/relay`), outside the server and its stateless-replica rule. Reference deployment:
  an edge platform with per-id coordination objects (one object per relay id holds the tab's
  socket and hibernates when idle); a single small Node instance with an in-memory map is the
  portable alternative. Both run the same Hono app.
- Why not a process on the person's machine instead: browsers now restrict public pages from
  connecting to loopback (a permission prompt in Chromium-based browsers, outright blocking of
  `ws://localhost` from HTTPS pages in Safari), and it would require a local install anyway.
  Someone willing to install runs the server profile, which is simply better: data on disk, MCP
  built in, no tab required.

◆ Decision: the relay exists because an agent-first product whose zero-install trial has no
agent access is a weak demonstration. It is for trying the product, not for real data; the path
to real use is the project bundle into a server-profile instance. Clients that only speak stdio
reach any HTTP MCP endpoint (relay or server) through `what-build mcp-stdio`, a thin
stdio↔HTTP proxy.

## 2.7 Repository layout

```
packages/
  core/             operation registry, domain rules, ports, in-memory adapters   (no Node/DOM APIs)
  parsers/          text, md, vtt, srt, docx, pdf, html → sidecars                (no Node/DOM APIs)
  adapter-rest/     Hono routes generated from the registry
  adapter-mcp/      MCP tools generated from the registry; skill delivery
  store-sqlite/     Kysely schema + migrations, FTS5 search; Node and WASM drivers
  store-postgres/   (cloud phase)
  blobs-fs/ blobs-opfs/ blobs-s3/
  skill/            the versioned product skill (Markdown) and installer templates
  conformance/      the adapter-independent test suite
apps/
  web/              React SPA (both Client transports)
  server/           CLI: serve, mcp-stdio, export, import
  relay/            hosted MCP relay for the browser profile (stateful; stores nothing)
docs/
  spec/             this specification
```

`core` and `parsers` MUST NOT import Node built-ins or DOM globals; CI runs their tests in both
Node and a browser to enforce it.

## 2.8 Cross-cutting rules

- **No LLM calls in the product.** No model API keys, no provider SDKs. (A future `Embedder`
  adapter is the single, optional exception and defaults to an on-device model.)
- **Untrusted content everywhere.** Source text, Markdown, and Story HTML are attacker-controlled
  from the application's point of view. Markdown is sanitized; Story renders only in a sandbox
  ([§4.10](04-data-model.md)); derived text returned to agents is data, and the skill says so.
- **URL fetch is SSRF-hardened:** HTTPS only, public addresses only (re-checked after every
  redirect and after DNS resolution), size and time caps, no credentials forwarded.
- **Migrations** are forward-only and run at startup (server) or on open (browser). A bundle
  records its schema version; import upgrades older bundles.
- **Observability:** structured logs with request id, principal id, workspace id, op name, status,
  duration. Never log source content or Markdown bodies.
