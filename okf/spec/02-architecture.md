---
type: Specification
title: WhatBuild is one TypeScript application image over Postgres and an object store, and the same code runs on a laptop with only Node.
description: The requirements behind the stack, the stack itself, the deployment shape, ports and adapters, the operation protocol, the local development contract, cross-cutting rules, and the repository layout.
tags: [spec, architecture, stack, development, deployment]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# 2. Architecture

## 2.1 Requirements that drive the stack

1. **One hosted product.** People sign up, create an organization, invite colleagues, and use it in
   a browser. There is no second way to run it for real.
2. **Multi-tenant from the first migration.** Many tenants share the deployment. Isolation is the
   shape of the schema, not a later phase.
3. **Cheap to run.** This is a side project on free and near-free infrastructure. Fewer moving
   services is worth real design effort, and every dependency must be replaceable when the cheap
   tier of the month changes.
4. **Runs entirely on a contributor's laptop.** One command, no accounts, no API keys, no cloud
   services to provision, nothing to install but Node, and the same path CI uses.
5. **One behavior.** The same operation gives the same result on a laptop and in production.

Requirements 3 and 5 together settle the database question: **Postgres is the only one**, and
development runs the same major version (17) from the `embedded-postgres` npm package. A second
SQL engine would mean two dialects, two full-text implementations and two sets of migrations to
keep in step forever, for no behavior a caller can see.

## 2.2 Stack

Observed in the `package.json` files, the [`Dockerfile`](../../Dockerfile) and
[`apps/server/src`](../../apps/server/src).

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict), ES modules | One language across server, web and tooling; the schema → types → JSON Schema path the registry depends on. |
| Server runtime | **Node.js** 24 (`.nvmrc`, `node:24-slim` image; `engines` allows ≥ 22.12) | Boring, universal. No Bun/Deno-only APIs in shared code. |
| HTTP | **Hono** on `@hono/node-server` | Small, standards-based (`Request`/`Response`), portable across container hosts. |
| MCP | **`@modelcontextprotocol/sdk`** | Official SDK. Streamable HTTP transport in stateless mode (no session id, JSON responses). A stdio proxy is planned. |
| Schemas | **Zod 4** | One strict schema per operation yields TypeScript types, runtime validation, and JSON Schema for MCP tools and `describe`. |
| SQL | **Kysely** over `pg` | Typed SQL, one dialect. Migrations are plain SQL files in [`apps/server/src/migrations`](../../apps/server/src/migrations). |
| Database | **Postgres 17** | The only database. Row-level security as defense in depth. Cloud SQL or any hosted Postgres in production; embedded Postgres in development and tests. |
| Full-text | **Postgres** `tsvector` (`simple` configuration) + GIN; `pg_trgm` for substring | No second search engine, no external index. |
| Queue | **Postgres** `jobs` table (`SELECT … FOR UPDATE SKIP LOCKED`) | No broker to run, pay for, or install to contribute. The worker ships in the same image. |
| Blobs | `BlobStore` port with filesystem, in-memory and Google Cloud Storage adapters | Files and derived sidecars are immutable, create-only blobs everywhere. |
| Identity | **Built in** ([`apps/server/src/auth`](../../apps/server/src/auth)): email links, Google and Microsoft OpenID Connect, sessions, and WhatBuild's own OAuth 2.1 authorization server for MCP | Fewer moving parts and fully under test; no auth library. See [§3.8](03-accounts-teams-and-identity.md). |
| Mail | `nodemailer` over SMTP, or the console in development | Any SMTP provider; no provider SDK. |
| Web UI | **React 19 + Vite**, SPA; **React Router 7** and **TanStack Query**; `lucide-react` icons | Static assets served by the same process; URL-held state through the router. |
| Parsing | Own code for text/Markdown/VTT/SRT/CSV; `pdfjs-dist` for PDF; `fflate` + `saxes` for DOCX and XLSX; `parse5` for HTML; own code for legacy Word `.doc` (the OLE2 compound file and the Word binary format) | Pure functions of bytes → sidecars with no native dependencies: a small image, a fast cold start, and a contributor install that cannot fail on a toolchain. |
| Markdown rendering | `marked`'s lexer, with tokens mapped to React elements ([`apps/web/src/lib/markdown.tsx`](../../apps/web/src/lib/markdown.tsx)) | Markdown that agents write (briefs, notes, assumption bodies) is untrusted input: no HTML string from it ever reaches the DOM; raw HTML shows as text and images never load. |
| Tooling | pnpm workspaces, `tsc` for type checks, Vitest, `tsx`, esbuild (server bundle), `playwright-core` for browser scripts | No linter or formatter is configured. |

The design system and visual language are documented in [DESIGN.md](../../DESIGN.md).

**Dependency rule.** No provider SDK may appear outside its own adapter. Only
[`blobs-gcs.ts`](../../apps/server/src/adapters/blobs-gcs.ts) imports the Cloud Storage client;
only [`misc.ts`](../../apps/server/src/adapters/misc.ts) imports the mailer. Moving provider must
be a new adapter and a redeploy, not a rewrite.

## 2.3 The shape of the deployment

```
                      ┌──────────────── one application image ─────────────────┐
  browser  ──HTTPS──▶ │  Hono: static assets · REST /api/v1 · MCP /mcp         │
  MCP client ─HTTPS─▶ │  OAuth · upload relay · operation registry → handlers  │
                      │  job worker (derivation, exports, blob deletion)       │
                      └───────┬───────────────────────────────┬─────────────────┘
                              │                               │
                    ┌─────────┴──────────┐         ┌──────────┴──────────┐
                    │ Postgres           │         │ object storage      │
                    │ rows · search · queue│       │ files · sidecars    │
                    └────────────────────┘         └─────────────────────┘
```

Production is Google Cloud Run: one image, migrations as a Cloud Run Job run from the new image
before the service moves to it, Cloud Storage for blobs, Secret Manager for secrets
([`cloudbuild.yaml`](../../cloudbuild.yaml), [deployment guide](../operations/cloud-run.md)).

- **Stateless.** Any replica serves any request. Storage clients are constructed at startup and
  carried on application context, never at module scope. No module-level mutable state and no
  in-process caches of tenant data. MCP runs in stateless mode with no session affinity.
- **The worker ships in the same image** and polls the Postgres queue; a commit that enqueues work
  also wakes it. `serve` runs HTTP and the worker in one process unless `WHATBUILD_WORKER=0`;
  `worker` runs the worker alone. Splitting them is a configuration change, not a code change.
- **A file is parsed in a thread of its own.** The worker starts a worker thread for each parse,
  with no environment, a heap of `WHATBUILD_PARSE_MEMORY_MB` (384 by default), half as much again
  for buffers and `WHATBUILD_PARSE_TIMEOUT_SECONDS` (120); a parse past them is stopped and fails,
  and the process keeps serving ([§5.1](05-derived-layer.md),
  [decision](../decisions/each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits.md)).
  The defaults suit a 1 GiB instance. The bundle carries the thread's entry as
  `dist/parse-worker.js` beside `dist/main.js` ([`build.mjs`](../../apps/server/build.mjs)).
- **A public sandbox's reset needs no timer.** A service that scales to nothing cannot promise
  an hour, so every request first runs a reset that is due, an instance that is awake looks every
  minute, and a scheduler may call `POST /api/v1/sandbox/reset-if-due`
  ([§9.7](09-data-lifecycle.md)). What an instance remembers is only when to look next, for at
  most 30 seconds; whether a reset is due is read from Postgres, under a lock, so two instances
  never run one twice. `WHATBUILD_SANDBOX_TENANT` names the organization, and is copied to
  `tenants.sandbox` at start-up.
- **The public site rides along.** Behind Cloudflare the Worker serves its page from the edge and
  passes on only its form. Otherwise, with `WHATBUILD_SITE_URL` set (for example
  `https://what-build.com`), requests whose Host is that site get its one page and its interest
  form; `www.` redirects to it and every other path redirects to the app at `WHATBUILD_PUBLIC_URL`
  ([decision](../decisions/the-public-site-is-one-page-built-with-the-app.md)).
- **One upload path for everyone.** An upload grant always points at the service's own relay
  (at most 25 MiB, under Cloud Run's 32 MiB request cap), because agents' sandboxes often cannot
  reach the object store. When the bucket can sign URLs (`WHATBUILD_GCS_SIGNED_URLS=1`), the grant
  also offers a direct `PUT` URL for files up to the per-file limit (100 MB), signed for at most
  the grant's size so the bucket refuses a larger body. Either way the application registers the
  file from the stored object's own size, hash and sniffed type, never from caller claims: a
  direct upload's size is read before any of its bytes, and its hash from the bytes as they stream
  ([§6.7](06-operations-and-adapters.md)).

## 2.4 Ports

The core ([`packages/core/src/ports.ts`](../../packages/core/src/ports.ts)) depends on these
interfaces; adapters live in [`apps/server/src/adapters`](../../apps/server/src/adapters).

| Port | Responsibility | Production | Development | Tests |
|---|---|---|---|---|
| `BlobStore` | Immutable, create-only blobs: `put`, `putStream` (size-capped), `get`, ranged `getStream`, `stat`, `delete`; optional signed upload and download URLs | Google Cloud Storage | filesystem (`.what-build/blobs`) | in-memory |
| `GrantSigner` | Sign and verify upload and download grants | HMAC with `WHATBUILD_GRANT_KEY` | the same, with a fixed development key | the same |
| `Mailer` | Sign-in links and invitations | SMTP, or none (email links then off) | printed to the terminal | captured in memory |
| `UrlFetcher` | Size-capped, SSRF-safe HTTPS fetch for `files.fetch_url` | yes | yes | yes |
| `FileParser` | Parse one file's bytes into its sidecars, away from the requests | a worker thread per file, with memory and time limits | the same | the same |

Postgres is not behind a port: the core takes a Kysely handle directly, and full-text search and
the job queue are SQL in the core and the worker. Every environment, including tests, runs real
Postgres. An `Embedder` port for semantic retrieval is planned ([§8](08-search.md)).

Rules:

- A handler only ever receives a transaction **already scoped to one tenant**: the transaction-local
  `app.tenant_id` is set before the handler runs, so row-level security applies to everything it
  does ([`execute.ts`](../../packages/core/src/execute.ts), [§3.6](03-accounts-teams-and-identity.md)).
- Adapters are chosen from configuration at startup
  ([`config.ts`](../../apps/server/src/config.ts)); the core never branches on environment.
- A conformance suite that runs unchanged against every blob adapter is planned; today the GCS
  adapter is exercised only in deployment.

**An Azure Blob Storage adapter (Planned).** Not built; the
[roadmap](10-roadmap.md#self-hosting-on-azure) says where it stands. A deployment on Azure stores
files through the filesystem adapter on a mounted file share today
([Azure guide](../operations/azure.md)), which needs the storage account's key and sends every
upload through the service. The adapter is `apps/server/src/adapters/blobs-azure.ts`, the only
file that imports the Azure SDK, chosen by `WHATBUILD_BLOB_STORE=azure`, or by default when
`WHATBUILD_AZURE_STORAGE_ACCOUNT` is set, as `gcs` is by its bucket. Its container is named by
`WHATBUILD_AZURE_STORAGE_CONTAINER`. It MUST:

- authenticate as the runtime's own identity (a managed identity), with no account key or
  connection string in configuration;
- make every write create-only (the `If-None-Match: *` condition), answering `409 blob_exists` to
  a second write of a key as the other adapters do;
- enforce `maxBytes` while it streams, keep the `sha256` as the blob's metadata and report it
  from `stat`, and answer a range past the end with an empty body;
- pass the conformance suite when there is one.

It MAY offer signed upload and download URLs when `WHATBUILD_AZURE_SIGNED_URLS=1`: a user
delegation signature that grants create and not write, so a URL can add a blob and never replace
one, for at most the grant's size where the store can bound it, with the headers the upload needs
returned beside it as the GCS adapter returns its own.
Blob keys are the same in every adapter, so a deployment moves off the mounted share by copying
each file to the same key with the content type and hash from the `.meta.json` beside it.

## 2.5 One operation protocol, two transports

Every operation is defined once in the registry
([`packages/core/src/registry.ts`](../../packages/core/src/registry.ts)) with a name, a scope
(product, team, tenant or account), a required access level, a strict input schema, a REST method
and path, and an MCP tool and action. [`execute`](../../packages/core/src/execute.ts) is the one
way an operation runs: resolve and authorize the scope, validate the input, do any slow work
outside the database (a download) in the operation's `prepare` step, holding no connection, then
run the handler in one tenant-scoped transaction that writes its activity event alongside the
change.

| Transport | Used by | Mapping |
|---|---|---|
| Direct call to `execute` | tests, the seed | the operation and its input |
| REST | the web UI, scripts | method + path under the scope's prefix; the etag as `expected_etag` in the input or an `If-Match` header; results carry an `ETag` header |
| MCP | agents | tool + `action` + `params`, or a standalone tool; `describe: true` returns the action's schema and guidance |

Errors have one shape on both doors, `{ code, status, message, details? }`
([`errors.ts`](../../packages/core/src/errors.ts)). Details of routes, tools and uploads are in
[§6](06-operations-and-adapters.md).

The web UI is written against a single HTTP client ([`apps/web/src/lib/api.ts`](../../apps/web/src/lib/api.ts)).
There is no capabilities object and no environment branching in UI code: the UI cannot tell which
deployment it is talking to, and must never need to.

## 2.6 Running it locally: the development contract

This section is a deliverable with an acceptance test, not advice. The day-to-day how-to is in
[local development](../operations/local-development.md).

```
git clone https://github.com/<owner>/what-build.git
cd what-build
pnpm install
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm install` | Node packages only. The Postgres server binaries arrive as an npm dependency (`embedded-postgres`). |
| `pnpm dev` | Starts embedded Postgres in `.what-build/pg` (port 54329), runs migrations, seeds three accounts and the fully derived sample product, then runs the API with the worker in-process (port 8787) and Vite (port 5273), which proxies `/api`, `/auth`, `/oauth`, `/mcp` and `/.well-known` to the API ([`dev.ts`](../../apps/server/src/dev.ts)). |
| `DATABASE_URL=… pnpm dev` | Uses that Postgres instead of starting one. |
| `pnpm test` | Vitest over three projects: parsers; the server, against a real embedded Postgres with a database per test file; and the web app under jsdom. |
| `pnpm typecheck`, `pnpm build` | `tsc` over every package; the production web bundle and server bundle. |
| `node scripts/e2e.mjs` | Drives the real UI through the loop against a running `pnpm dev`, with a locally installed Chrome. |
| `pnpm e2e golden`, `pnpm dev:e2e` | Build a golden master from a pull of production, then serve a fresh copy of it on its own embedded Postgres (port 54339), API (8797) and Vite (5283), where an agent runs the [end-to-end test plans](../operations/end-to-end-tests.md) through the browser and MCP. |

Requirements this places on the design:

- **No account anywhere.** Not for the database, the object store, email, or a model provider.
  There is no LLM in the product, so there is nothing to key ([§2.8](#28-cross-cutting-rules)).
- **Sign-in is exercised, not bypassed.** The seed creates real accounts (an owner, an editor and a Story reader);
  the console mailer prints sign-in links and invitations to the terminal. A development-only
  "sign in as" control exists and is refused unless `NODE_ENV` is not `production` (and
  `WHATBUILD_DEV_AUTH` is not `0`).
- **Blobs go to `./.what-build/blobs`** through the filesystem adapter.
- **The database role is not a superuser**, so row-level security is enforced exactly as in
  production ([`apps/server/src/testing/pg.ts`](../../apps/server/src/testing/pg.ts)).
- **Derivation runs on the same queue** as production, in the worker. Development MUST NOT run
  derivation inline in the request; that is an observable behavior difference.
- **CI uses this path.** The GitHub Actions workflow ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml))
  installs, checks that the embedded skill text matches `SKILL.md`, type-checks, runs `pnpm test`
  against embedded Postgres, and builds.
- ◆ Decision: **development may substitute an adapter, never a behavior.** A difference a caller
  can observe is a bug.

*Why this exists at all:* on a funded team you point development at real cloud services and skip
this work, because the services are paid for and everyone has access. Neither is true here. A
contributor fixing a parser bug will not provision a Postgres instance and a bucket to do it, and
we cannot hand strangers credentials to ours. The same environment is what makes CI free and
deterministic.

## 2.7 Self-hosting

WhatBuild is MIT-licensed. Anyone may run the same container image against their own Postgres and
bucket, using the same deployment guide we use. It is **not a separate mode**: there is no
single-user build, no loopback-means-no-sign-in rule, and no code path that exists only for
self-hosters. This keeps the promise cheap to make and impossible to break by accident.

On Azure the same image runs on Container Apps with Azure Database for PostgreSQL, and files go
to a mounted file share through the filesystem adapter. An agent sets it up with the Azure CLI
from the [Azure guide](../operations/azure.md); there is no script, and nothing of the Cloud Run
deployment is involved
([decision](../decisions/self-hosting-on-azure-is-agent-led-and-shares-nothing-with-cloud-run.md)).

## 2.8 Cross-cutting rules

- **No LLM calls in the product.** No model API keys, no provider SDKs. (A planned `Embedder`
  adapter is the single, optional exception and would run a small model in our own worker,
  [§8.5](08-search.md).)
- **Untrusted content everywhere.** Source text, Markdown, and Story HTML are attacker-controlled
  from the application's point of view. Markdown is rendered without raw HTML; Story renders only
  in a sandbox ([§4.11](04-data-model.md)); derived text returned to agents is data, and the skill
  and the MCP server instructions say so.
- **Cookie-carrying writes must come from the app's own origin**, on every route, because
  `SameSite=Lax` is not enough on a shared parent domain.
- **Request bodies** under `/api/v1` are limited to 5 MB; files travel through upload grants.
  Under `/auth` and `/oauth`, which anyone may call, they are limited to 64 KB.
- **URL fetch is SSRF-hardened:** HTTPS only, public addresses only, checked again on every
  redirect: an address written in the URL, in any notation, is checked before connecting, since
  Node never looks it up; a name is checked after DNS resolution, in the lookup the connection
  itself uses, and refused if any of its addresses is not public. Public means outside every
  special-purpose IPv4 range and, for IPv6, inside global unicast and outside its special parts,
  so IPv4-mapped, NAT64, 6to4, Teredo, site-local and unique local addresses are refused too
  (`isPublicAddress` in [`misc.ts`](../../apps/server/src/adapters/misc.ts)). Size cap, an idle
  timeout and a deadline for the whole fetch, three fetches at once per person, no credentials
  forwarded, and one plain error for every network failure.
- **Migrations** are forward-only SQL, applied by `whatbuild migrate` as a separate step before a
  new image serves traffic. An export bundle records its format version.
- **Observability:** one structured log line per request with method, path (ids masked, and the
  invitation and sandbox invitation links, `/invite/:token` and `/join/:code`), status and duration. **Never** log source content, Markdown bodies, passage text, email addresses, or
  tokens. Request ids, principal and tenant ids, operation names and counters are planned.
  ◆ Decision: operational telemetry about the *service* in the logs; usage analytics only in the
  browser, only for people who accept it, and only by screen, never by content or name
  ([§9.1](09-data-lifecycle.md)).
- **Rate limits and quotas** are to be enforced in one middleware shared by both adapters, so
  neither can drift from the other ([§9.2](09-data-lifecycle.md)). Planned: today only sign-in
  links are rate-limited (five per address per hour) and the only enforced quota is 50 Story pages
  per product.

## 2.9 Repository layout

```
packages/
  parsers/          text, md, vtt, srt, html, docx, doc, pdf, xlsx, csv → sidecars (pure: bytes in, sidecars out)
  core/             operation registry and every operation, policy, citations, ports, Kysely table
                    types, Story guidance and print view, the versioned product skill (src/skill/)
apps/
  server/           Hono app: static assets, REST, MCP, OAuth and identity, upload relay, worker,
                    adapters (fs, memory, GCS blobs; SMTP and console mail), SQL migrations, seed;
                    CLI commands serve, worker, migrate, seed
  web/              React SPA
scripts/            gen-skill (embeds SKILL.md), e2e and screenshot scripts
e2e/plans/          end-to-end test plans an agent runs through the web app and MCP
deploy/cloud-run/   the setup script (the deployment guide is okf/operations/cloud-run.md)
Dockerfile · cloudbuild.yaml
okf/                this knowledge bundle, including this specification (okf/spec/)
```

`core` and `parsers` MUST stay free of I/O of their own: they take ports and bytes, not file
handles and sockets, which is what makes them testable and what lets derivation move to a separate
worker replica without a rewrite.
