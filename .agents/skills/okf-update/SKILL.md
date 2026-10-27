---
name: okf-update
description: Keep WhatBuild's okf/ documentation true, and write or revise any concept in it (specification, system concept, roadmap, process, operations guide, charter, index). Use before finishing any change to code, schema, operations, the web app, configuration, deployment or process; when asked to document something; and whenever you find something in okf/ that no longer matches the code.
---

# Keep the okf/ bundle true

The rule: **a change that makes a concept untrue fixes that concept in the same change.** Code
and documentation go into the same commit. Correct what is already there in preference to
adding a near-duplicate.

## Procedure

1. **List what changed.** Run `git status --short` and `git diff --name-only`, including new and
   staged files.
2. **Find the affected concepts** with the impact map below. Also grep the bundle for names you
   renamed or removed, and for counts you changed:
   `grep -rn "old_name\|101 operations" okf AGENTS.md README.md`.
3. **Read each affected concept, then correct it in place.** Describe the system as it now is,
   in the present tense. Do not describe how it came to be.
4. **Decide where new knowledge belongs** (see the table under Where knowledge goes). Put it in an
   existing concept unless it clearly stands alone.
5. **Durable choice?** A choice a later change could reasonably reverse, one that constrains other
   work, or one the person made explicitly, gets a decision record. Use the `okf-decision` skill.
6. **Roadmap.** If the change builds something listed as not built, or reveals a new gap, update
   `okf/spec/10-roadmap.md`: the status table (and the date in its heading), the phase's
   acceptance list, and the open questions.
7. **Frontmatter.** On every concept you edit, set `generated` to
   `{by: agent:<your-name>, at: <today, YYYY-MM-DD>}`. Keep `status` accurate: `draft` if you
   wrote it from inspection and nobody has reviewed it, `stable` once it is settled.
8. **Indexes.** A new file gets a line in its directory's `index.md` (the validator fails
   otherwise). A new directory gets an `index.md` and a line in `okf/index.md` and
   `okf/README.md`. A new concept type gets a row in `okf/ontology.md` and an entry in `TYPES` in
   `okf/tools/validate_okf.py`.
9. **Outside the bundle.** Update these if the change touches them:
   - `AGENTS.md`: its path table and summary.
   - `README.md`: what a person sees first.
   - `apps/web/PRODUCT.md` and `apps/web/DESIGN.md`: the product and design records.
   - `packages/core/src/guide/`: the guide connected agents read through the `guide` tool, which
     describes how WhatBuild works without prescribing a method. After editing a topic, run
     `pnpm gen:guide`, and bump `TOOLS_VERSION` in `packages/core/src/ops/meta.ts` when the tools,
     their actions or the guide change.
   - `.agents/skills/`: these skills, when the bundle's layout or rules change.
10. **Validate:** `python3 okf/tools/validate_okf.py` must report 0 errors.
11. **Public check.** The pre-commit hook runs `scripts/check-publishable.mjs` on what you commit
    (secrets, local paths, real addresses, stray files). No pattern catches the rest, so reread
    what you wrote once for session talk ("as requested", "we decided today", "next I will"),
    private names and personal details.
12. **Report** which concepts you changed and why, in one line each.

## Impact map

| When you change | Check |
|---|---|
| `packages/core/src/ops/**`, `registry.ts`, `schemas.ts`, `errors.ts` | `spec/06` (the operation table and error codes); the operation and tool counts in `AGENTS.md`, `system/overview.md`, `system/repository-map.md`, `spec/10`; the decisions `one-registry-two-front-doors` and `mcp-tools-are-split-into-read-write-and-delete`; the product's guide (`packages/core/src/guide/`) |
| `apps/server/src/mcp.ts`, `rest.ts`, `public-routes.ts` | `spec/06`, `spec/02`, `system/overview.md`; for a tool's name, title or annotations, the decision `mcp-tools-are-split-into-read-write-and-delete`; for the instructions, the decision `agents-learn-whatbuild-from-the-servers-guide` |
| `apps/server/src/documents.ts`, `content-documents.ts`, `packages/core/src/content-address.ts`, what a content site serves (`WHATBUILD_CONTENT_URL`) | `spec/06` §6.4, `spec/02`, `system/security.md`, decision `with-a-content-site-every-page-and-inline-file-is-served-from-it`, the content-site lines of `operations/cloud-run.md` and `operations/azure.md`, `operations/upgrading.md` |
| `packages/core/src/policy.ts`, roles, membership | `spec/03`, decisions `access-is-per-product-roles` and `a-reader-reads-only-the-story`, `system/overview.md` |
| `packages/core/src/limits.ts`, `ops/limits.ts`, the example organization (`apps/server/src/example-organization.ts`, the guest grant in `policy.ts`), `WHATBUILD_EXAMPLE_TENANT`, `WHATBUILD_NEW_ORGANIZATION_PLAN` | `spec/03` §3.3 and §3.10, `spec/09` §9.7, decisions `every-account-reads-the-example-organization-which-only-its-staff-write` and `free-organizations-meet-limits-that-only-instance-owners-change`, `system/security.md`, the product `SKILL.md`, `operations/upgrading.md` |
| `packages/core/src/connector-scope.ts`, `apps/server/src/auth/connector-reach.ts`, MCP endpoint paths | `spec/03` §3.6 and §3.8, `spec/06` §6.5 and §6.8, decision `a-scoped-mcp-connector-is-a-fence`, the product's guide (`packages/core/src/guide/01-start.md`) |
| `apps/server/src/auth/**`, sessions, tokens | `spec/03`, decision `built-in-identity-and-oauth`; a sign-in method also the Sign-in sections of `operations/cloud-run.md` and `operations/azure.md` |
| `apps/server/src/migrations/*.sql`, `packages/core/src/db.ts` | `spec/04`; tenancy or row-level security changes: decision `shared-schema-tenancy-with-row-level-security`; retention: `spec/09` |
| `html-rules.ts` (what a Story page and a mockup page may hold), `page-sandbox.ts` (the sandbox each is shown in) | `spec/04` §4.11 and §4.12, decisions `story-pages-are-sandboxed-agent-html` and `mockups-are-versioned-canvases-in-exploration`, `system/security.md`, the descriptions of `mockups.publish` and `mockups.request_upload`, the product `SKILL.md` |
| `story-html.ts`, `story-guidance.ts`, `story-styles.ts`, `story-theme.ts`, `story-print.ts`, `ops/story.ts` | `spec/04` and `spec/07` (Story), decisions `story-pages-are-sandboxed-agent-html`, `story-pages-follow-the-teams-design-system`, `story-notes-are-agent-memory`, `pdf-export-uses-browser-print` and `evidence-is-searched-not-cited` (the guidance never asks an agent to cite, and sets no rule about quoting, attributing or linking) |
| `evidence-move.ts`, migration `0015_…` | `spec/04` §4.7 and `spec/09` §9.8, decision `insights-and-decisions-are-retired-into-evidence` |
| `ops/mockups.ts`, `apps/web/src/routes/mockups.tsx`, `mockups.css` | `spec/04` §4.12 and `spec/07` §7.7 (Mockups), decision `mockups-are-versioned-canvases-in-exploration`, the canvas in `apps/web/DESIGN.md`; a change to the HTML rules or the sandbox also `story-pages-are-sandboxed-agent-html` |
| `packages/parsers/**`, `media.ts`, `worker.ts`, `ops/derived.ts`, `ops/attachments.ts` | `spec/05`, decision `a-sources-words-are-one-derived-text-and-attachments-are-never-searched`, the parser list in `spec/10` |
| `apps/server/src/parse-thread.ts`, `parse-worker.ts`, the `WHATBUILD_PARSE_*` variables | `spec/05` §5.1, `spec/09` §9.2, decision `each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits`, `operations/cloud-run.md`, `operations/azure.md` (and `deploy/azure/containerapp.yaml`), `system/security.md` |
| A source's fields or tags (`ops/sources.ts`, `sources.facets`, the filters of `sources.list` and `search`) | `spec/04` §4.3 and §4.4, `spec/07` §7.6, `spec/08` §8.1, decision `sources-are-described-by-tags`, the product `SKILL.md` |
| `ops/search.ts`, `ops/plain-search.ts`, `text-index.ts` (what search reads) | `spec/08`, decision `a-sources-words-are-one-derived-text-and-attachments-are-never-searched` |
| Archive, delete, export (`ops/export.ts`) | `spec/09`, decision `archive-by-default-delete-guarded` |
| `uploads.ts`, `adapters/**`, `ports.ts`, `config.ts` | `spec/02` (adapters, configuration), `spec/05`, `operations/cloud-run.md` and `operations/azure.md` (with `deploy/azure/containerapp.yaml`) if an environment variable changed |
| `dev.ts`, root `package.json` scripts, ports, `.nvmrc`, `scripts/*.mjs` | `operations/local-development.md`, decision `development-substitutes-adapters-never-behavior` |
| `e2e.ts`, `e2e-golden.ts`, `e2e-browser.ts`, `e2e-mcp.ts`, `dev.ts --e2e`, `e2e/plans/**`, `.agents/skills/run-end-to-end-tests/**` | `operations/end-to-end-tests.md`, decision `end-to-end-tests-are-plans-an-agent-runs-on-a-golden-master`; a screen or operation a plan names: that plan |
| `fixture.ts`, `dev.ts --fixture`, `.agents/skills/test-on-a-copy-of-production/**` | `operations/a-copy-of-production.md`, decision `qa-uses-a-private-copy-of-production` |
| `organization-copy.ts`, the options of `pnpm fixture pull`, `.agents/skills/copy-an-organization/**`, or a new table without `tenant_id` | `operations/copying-an-organization.md`, decision `a-copy-of-production-holds-only-the-organizations-it-is-for`, the refresh in `operations/dev-deployment.md` |
| `.agents/skills/rehearse-on-the-dev-deployment/**`, the dev deployment's layout, how a copy of production reaches it, or when a release is rehearsed | `operations/dev-deployment.md`, decision `releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production`, the `make-a-release` skill |
| What a deployment backs up, the nightly dump, restoring a dump, the restore drill | `operations/backups.md`, `spec/09` §9.3 and §9.6, the Phase 6 row in `spec/10` |
| `.github/workflows/**` | `operations/local-development.md` (CI), `operations/security-checks.md`, the phase 0 row in `spec/10` |
| `.github/workflows/release.yml`, `.agents/skills/make-a-release/**`, how versions are numbered or how production is deployed | `operations/releasing.md`, decisions `releases-are-tags-with-a-published-image`, `production-runs-releases-after-approval` and `releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production` |
| `deploy/Dockerfile`, `deploy/cloud-run/**` (with `cloudbuild.yaml`), `deploy/cloudflare/**` | `operations/cloud-run.md`, decision `one-stateless-image`; `deploy/cloud-run/**` also `operations/dev-deployment.md` (the dev deployment is built and deployed by it); a `deploy/Dockerfile` change also `operations/azure.md` (the image is built from it there too) |
| `apps/server/src/migrations/**`, `apps/server/src/database.ts`, `.github/workflows/release.yml`, `.agents/skills/recover-a-deployment/**`, or how a deployment migrates, backs up or rolls back | `operations/recovering-from-a-bad-release.md`, `operations/backups.md` |
| `deploy/azure/**`, `.agents/skills/azure-self-host/**` | `operations/azure.md`, decision `self-hosting-on-azure-is-agent-led-and-shares-nothing-with-cloud-run` |
| `apps/web/src/routes/**`, `main.tsx`, `shell/**` | `spec/07`, the phase 4 row in `spec/10` |
| `apps/web/src/styles/tokens.css`, `ui/**` | `apps/web/DESIGN.md`, `apps/web/.impeccable/design.json`, decision `studio-design-system` (Story pages do not follow the app's tokens) |
| A cookie (`setCookie`), a `whatbuild.*` browser storage key, or analytics (`apps/web/src/lib/analytics.ts`, the Worker's analytics settings) | the kinds on `apps/web/src/routes/cookies.tsx`, `spec/09` §9.1, decision `analytics-only-for-people-who-accept-cookies`, `operations/analytics.md` |
| What is kept about people, or for how long (a new table of personal data, a retention, a provider), or the privacy page (`apps/web/src/routes/privacy.tsx`, `WHATBUILD_OPERATOR`, `WHATBUILD_PRIVACY_CONTACT`, `WHATBUILD_PROVIDERS`) | the page's fixed text and `spec/09` §9.1 (The privacy page), `spec/07`, `operations/cloud-run.md`, `deploy/azure/containerapp.yaml` |
| The mailer (`createMailer` in `apps/server/src/app.ts`, mail in `adapters/misc.ts`), a message the server sends, `WHATBUILD_MAILER`, `WHATBUILD_SMTP_URL`, `WHATBUILD_MAIL_FROM`, a deployment's mail provider, `.agents/skills/set-up-mail/**` | `operations/mail.md`, decision `mail-is-set-up-through-cloudflare-email-sending-and-a-dev-deployment-sends-none`, `spec/02` (Mail, `Mailer`), `spec/03`, the mail paragraphs of `operations/cloud-run.md` and `operations/azure.md` |
| What the server counts (`packages/core/src/usage.ts`, `ops/usage.ts`, `apps/server/src/usage-report.ts`, `.agents/skills/read-usage/**`) | `spec/09` §9.1 and Counting without cookies on `apps/web/src/routes/cookies.tsx`, `spec/04` §4.15, decision `the-server-counts-how-whatbuild-is-used-naming-nobody`, `operations/analytics.md` |
| `seed.ts`, `seed-content.ts` | usually nothing; `process/working-in-this-repository.md` if the sample product changes |
| A new top-level directory, package, or moved file | `system/repository-map.md`, the `AGENTS.md` path table |
| Product scope or vocabulary | `project/charter.md`, `spec/01`, `apps/web/PRODUCT.md` |
| `config.ts` (a new or changed `WHATBUILD_*` variable), `apps/server/src/auth/**`, `deploy/**`, `.nvmrc` or `engines`, or anything else a deployment must act on to take the next release | a line under Unreleased in `operations/upgrading.md` |
| How work is done, the checks, the public-repository rules | `process/working-in-this-repository.md`, `AGENTS.md` |
| `scripts/check-publishable.mjs`, `scripts/security.mjs`, `scripts/tools.mjs`, `scripts/githooks/**`, `.github/workflows/security.yml`, `codeql.yml`, `dependabot.yml`, `.github/*.toml`, `zap-rules.tsv`, `.github/SECURITY.md`, `.agents/skills/audit-for-leaks/**`, `.agents/skills/triage-security-findings/**` | `operations/security-checks.md`, decision `privacy-and-security-checks-live-in-the-repository`, `system/repository-map.md` |
| Authentication, tenancy, agent HTML, uploads, the URL fetcher, the example organization, the free plan's limits, headers | `system/security.md` (the threat model): keep each control it names true |

Nothing in the map fits? Grep `okf/` for the file, function and feature names you touched, and
extend this map in the same change.

## Where knowledge goes

| Knowledge | Type | Place |
|---|---|---|
| Normative behavior of one area: fields, limits, errors, rules | Specification | the matching `okf/spec/NN-*.md` section |
| How a part fits together, for orientation | System Concept | `okf/system/` |
| A durable choice and why | Decision | `okf/decisions/` (the `okf-decision` skill) |
| A small choice inside one area that a reviewer may want to reverse | a `◆ Decision:` line | inline in that spec section |
| Built, not built, next, open questions, risks, a problem seen that could not be reproduced | Roadmap | `okf/spec/10-roadmap.md` only |
| How to run, deploy or operate | Process (operations) | `okf/operations/` |
| How to make changes: rules and checks | Process | `okf/process/` |
| What the product and the repository are and are not | Charter | `okf/project/charter.md` |
| A vocabulary term that needs more than a line | Domain Concept | a new `okf/domain/` directory, with its index |
| A script inside the bundle | Tooling | `okf/tools/` |

Templates and the conventions for each type are in `references/concept-types.md`. Read the
section for the type you are writing.

## Never put in the bundle

The repository is public. Never add:

- session history, task logs, handoff notes, records of requests, or to-do lists (planned work
  goes in the roadmap);
- names of private projects, clients or employers;
- absolute local paths, secrets, tokens, or personal details;
- a proposal written as though it were decided;
- a copy of code, `apps/web/PRODUCT.md` or `apps/web/DESIGN.md`. Link to them instead.

`okf/log.md` is gitignored on purpose. Do not create logs under other names.
