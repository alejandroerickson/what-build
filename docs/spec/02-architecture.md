# 2. Architecture

## 2.1 Requirements that drive the stack

1. **One hosted product.** People sign up, create a team, invite colleagues, and use it in a
   browser. There is no second way to run it for real.
2. **Multi-tenant from the first migration.** Many teams share the deployment. Isolation is the
   shape of the schema, not a later phase.
3. **Cheap to run.** This is a side project on free and near-free infrastructure. Fewer moving
   services is worth real design effort, and every dependency must be replaceable when the cheap
   tier of the month changes.
4. **Runs entirely on a contributor's laptop.** One command, no accounts, no API keys, no cloud
   services to provision — and the same path CI uses.
5. **One behavior.** The same operation gives the same result on a laptop and in production.

Requirements 3 and 5 together settle the database question: **Postgres is the only one**, and
development runs the same major version in a container. A second SQL engine would mean two
dialects, two full-text implementations and two sets of migrations to keep in step forever, for no
behavior a caller can see.

## 2.2 Stack

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict), ES modules | One language across server, web and tooling; the schema → types → JSON Schema path the registry depends on. |
| Server runtime | **Node.js** current LTS | Boring, universal. No Bun/Deno-only APIs in shared code. |
| HTTP | **Hono** | Small, standards-based (`Request`/`Response`), portable across container hosts — which matters when the host changes. |
| MCP | **`@modelcontextprotocol/sdk`** | Official SDK. Streamable HTTP transport in stateless mode, plus stdio through a thin proxy. |
| Schemas | **Zod 4** | One schema per operation yields TypeScript types, runtime validation, and JSON Schema for MCP tools and `describe`. |
| SQL | **Kysely** query builder | Typed SQL, one dialect, migrations in the repository. |
| Database | **Postgres** (current major) | The only database. Row-level security as defense in depth. Same major version in development. |
| Full-text | **Postgres** `tsvector` + GIN; `pg_trgm` for substring | No second search engine, no external index. Available on every managed Postgres worth using. |
| Queue | **Postgres** (`SELECT … FOR UPDATE SKIP LOCKED`) | No broker to run, pay for, or install to contribute. The worker ships in the same image. |
| Blobs | Port with filesystem and S3-compatible adapters | Files and derived sidecars are immutable blobs everywhere. |
| Auth | **Better Auth** — candidate, confirm by spike | TypeScript, runs on Hono, stores through Kysely on Postgres, has organization, email/magic-link and MCP OAuth-provider plugins. |
| Web UI | **React + Vite**, SPA; **TanStack Router** and **TanStack Query** | Static assets behind auth, cheap to serve from anywhere. Typed URL search params suit URL-held filters. No longer forced by a serverless profile — now simply the simplest thing that works. |
| Parsing | Own code for text/Markdown/VTT/SRT; `pdfjs-dist` for PDF; `fflate` + a SAX XML parser for DOCX; `parse5` for HTML | Pure functions of bytes → sidecars with no native dependencies: a small image, a fast cold start, and a contributor install that cannot fail on a toolchain. |
| Markdown rendering | `markdown-it` + DOMPurify | Insight bodies are untrusted input. |
| Tooling | pnpm workspaces, Vitest, Playwright, ESLint, Prettier, Docker Compose | |

Design system and visual language are out of scope here and chosen in the design phase
([§10 Phase 4](10-roadmap.md)).

**Dependency rule.** No provider SDK may appear outside its own adapter package. `blobs-s3` may
import an S3 client; nothing else may. The same goes for the mailer. Moving provider must be a
redeploy, not a rewrite.

## 2.3 The shape of the deployment

```
                      ┌──────────────── one application image ─────────────────┐
  browser  ──HTTPS──▶ │  Hono: static assets · REST /api/v1 · MCP /mcp         │
  MCP client ─HTTPS─▶ │  operation registry → handlers                          │
                      │  job worker (derivation, exports)                       │
                      └───────┬───────────────────────────────┬─────────────────┘
                              │ ports                         │
                    ┌─────────┴─────────┐          ┌──────────┴──────────┐
                    │ Postgres           │          │ object storage      │
                    │ rows · search · queue │       │ files · sidecars    │
                    └────────────────────┘          └─────────────────────┘
```

- **Stateless.** Any replica serves any request. Storage clients are constructed at startup and
  carried on application context — never at module scope. No module-level mutable state and no
  in-process caches of tenant data. MCP runs in stateless mode with no session affinity.
- **The worker ships in the same image** and polls the Postgres queue. At this scale one process
  may serve HTTP and run the worker; the split into separate replicas is a configuration change,
  not a code change.
- **Uploads never pass through the application** in production: a grant returns a presigned URL to
  the object store, and the application registers the file from the stored object's own metadata
  afterwards ([§6.7](06-operations-and-adapters.md)).

## 2.4 Ports

The core depends only on these interfaces. Each adapter package implements one.

| Port | Responsibility | Production | Development | Tests |
|---|---|---|---|---|
| `Database` | A Kysely instance, always already scoped to one team | managed Postgres, pooled | Postgres in a container | throwaway schema per worker |
| `BlobStore` | Immutable blobs: `put` → `version_id`, `get` (ranged), `stat`, `list` | S3-compatible | filesystem | in-memory |
| `SearchIndex` | Index and query segments and register text | Postgres FTS + trigram | the same | the same |
| `JobQueue` | Enqueue and claim work (derivation, exports) | Postgres queue, worker in the image | the same, worker in-process | run inline |
| `Mailer` | Verification, magic links, invitations | transactional provider | printed to the terminal | captured for assertions |
| `UploadGrants` | Issue and redeem direct-upload grants | presigned URLs | local HTTP endpoint | in-memory |
| `UrlFetcher` | Size-capped, SSRF-safe HTTPS fetch | yes | yes | stubbed |
| `Clock`, `IdGenerator` | Time and ULIDs | | | |
| `Embedder` (later) | Text → vector for semantic retrieval | | | |

Rules:

- A `Database` handle is always **scoped to one team** before the core sees it
  (`stores.forTeam(id)`); core code cannot express a cross-team query
  ([§3.6](03-accounts-teams-and-identity.md)).
- An **in-memory** implementation of every port exists for unit tests and the earliest build phase.
- One **conformance suite** runs unchanged against every column of the table above.

## 2.5 One operation protocol, two transports

Every operation call has one canonical shape:

```
call:    { op: "objectives.update", team: "<id|slug>", project: "<id|slug>", params: {…}, etag?: "…" }
result:  { ok: true,  result: {…}, etag?: "…" }
       | { ok: false, error: { code, status, message, details? } }
```

| Transport | Used by | Mapping |
|---|---|---|
| Direct function call | tests, the job worker, server adapters | the shape itself |
| REST | the web UI, scripts | method + path + `If-Match`, generated from the registry |
| MCP | agents | tool + `action` + `params`, generated from the registry |

The web UI is written against a single `HttpClient`. There is no capabilities object and no
environment branching in UI code: the UI cannot tell which deployment it is talking to, and must
never need to.

## 2.6 Running it locally — the development contract

This section is a deliverable with an acceptance test, not advice.

```
git clone https://github.com/<owner>/what-build.git
cd what-build
pnpm install
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm install` | Node packages only. No native builds, no post-install downloads. |
| `pnpm dev` | Starts Postgres in a container, runs migrations, seeds a team with two accounts and the fully derived sample project, then runs the API, the worker and Vite. |
| `pnpm test` | Unit tests against in-memory ports; integration tests against a throwaway Postgres schema; Playwright over the real UI. |
| `pnpm dev --no-docker` | Uses whatever `DATABASE_URL` points at (any Postgres of the supported major version). |
| `pnpm dev --s3` | Adds a MinIO container so the S3 adapter and presigned uploads can be exercised. |

Requirements this places on the design:

- **No account anywhere.** Not for the database, the object store, email, or a model provider.
  There is no LLM in the product, so there is nothing to key
  ([§2.8](#28-cross-cutting-rules)).
- **Sign-in is exercised, not bypassed.** The seed creates real accounts; the `Mailer` adapter
  prints verification and magic-link URLs to the terminal. A development-only "sign in as" control
  MAY exist and MUST be compiled out unless `NODE_ENV=development`.
- **Blobs go to `./.what-build/blobs`** through the filesystem adapter, so nothing needs MinIO for
  ordinary work.
- **Derivation runs on the same queue** as production, in-process. Development MUST NOT run
  derivation inline in the request; that is an observable behavior difference.
- **CI uses this path.** The pipeline runs `pnpm dev`'s migration and seed steps against a Postgres
  service container, so a broken contributor setup breaks the build.
- ◆ Decision: **development may substitute an adapter, never a behavior.** A difference a caller
  can observe is a bug. The conformance suite is the proof, and it runs in CI against both the
  filesystem and (nightly) the S3 adapter.

*Why this exists at all:* on a funded team you point development at real cloud services and skip
this work, because the services are paid for and everyone has access. Neither is true here. A
contributor fixing a parser bug will not provision a Postgres instance and a bucket to do it, and
we cannot hand strangers credentials to ours. The same environment is what makes CI free and
deterministic. It is affordable precisely because the browser profile is gone: one Compose file and
the same Postgres as production, instead of a second storage engine maintained forever.

## 2.7 Self-hosting

WhatBuild is MIT-licensed. Anyone may run the same container image against their own Postgres and
bucket, using the same deployment guide we use. It is **not a separate mode**: there is no
single-user build, no loopback-means-no-sign-in rule, and no code path that exists only for
self-hosters. This keeps the promise cheap to make and impossible to break by accident.

## 2.8 Cross-cutting rules

- **No LLM calls in the product.** No model API keys, no provider SDKs. (A future `Embedder`
  adapter is the single, optional exception and runs a small model in our own worker,
  [§8.5](08-search.md).)
- **Untrusted content everywhere.** Source text, Markdown, and Story HTML are attacker-controlled
  from the application's point of view. Markdown is sanitized; Story renders only in a sandbox
  ([§4.11](04-data-model.md)); derived text returned to agents is data, and the skill says so.
- **URL fetch is SSRF-hardened:** HTTPS only, public addresses only (re-checked after every
  redirect and after DNS resolution), size and time caps, no credentials forwarded.
- **Migrations** are forward-only and run as a separate step before a new image serves traffic.
  A bundle records its schema version; import upgrades older bundles.
- **Observability:** structured logs with request id, principal id, team id, op name, status,
  duration; counters for request and error rates and job durations. **Never** log source content,
  Markdown bodies, passage text, email addresses, or tokens. ◆ Decision: operational telemetry
  about the *service* yes; product analytics about what a team *does* in the app, no — and the data
  statement says exactly that ([§9.1](09-data-lifecycle.md)).
- **Rate limits and quotas** are enforced in one middleware shared by both adapters, so neither can
  drift from the other ([§9.2](09-data-lifecycle.md)).

## 2.9 Repository layout

```
packages/
  core/             operation registry, domain rules, ports, in-memory adapters
  parsers/          text, md, vtt, srt, docx, pdf, html → sidecars   (pure: bytes in, sidecars out)
  adapter-rest/     Hono routes generated from the registry
  adapter-mcp/      MCP tools generated from the registry; skill delivery
  store-postgres/   Kysely schema, migrations, full-text search, job queue
  blobs-fs/ blobs-s3/
  mailer/           console and provider adapters
  skill/            the versioned product skill (Markdown) and installer templates
  conformance/      the adapter-independent test suite
apps/
  web/              React SPA
  server/           Hono app: static assets, REST, MCP, worker; CLI (serve, worker, migrate, seed,
                    mcp-stdio, export, import)
infra/
  docker-compose.dev.yml · Dockerfile · deployment guide
docs/
  spec/             this specification
  operations/       runbooks: deploy, backup, restore drill, incident
```

`core` and `parsers` MUST stay free of I/O — they take ports and bytes, not file handles and
sockets — because that is what makes them testable and what lets derivation move to a separate
worker replica without a rewrite.
