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
   - `PRODUCT.md` and `DESIGN.md`: the product and design records.
   - `packages/core/src/skill/SKILL.md`: how connected agents use the operations. After editing
     it, run `pnpm gen:skill`.
   - `.agents/skills/`: these skills, when the bundle's layout or rules change.
10. **Validate:** `python3 okf/tools/validate_okf.py` must report 0 errors.
11. **Public check** on everything you wrote:
    `git diff -- okf .agents AGENTS.md README.md | grep -nE "/Users/|/home/|_private|TODO|token=|secret"`
    (new files are not in the diff, so grep them directly). Then reread it once for
    session talk ("as requested", "we decided today", "next I will"), private names and personal
    details.
12. **Report** which concepts you changed and why, in one line each.

## Impact map

| When you change | Check |
|---|---|
| `packages/core/src/ops/**`, `registry.ts`, `schemas.ts`, `errors.ts` | `spec/06` (the operation table and error codes); the operation and tool counts in `AGENTS.md`, `system/overview.md`, `system/repository-map.md`, `spec/10`; the decisions `one-registry-two-front-doors` and `mcp-tools-grouped-by-noun`; the product `SKILL.md` |
| `apps/server/src/mcp.ts`, `rest.ts`, `public-routes.ts` | `spec/06`, `spec/02`, `system/overview.md` |
| `packages/core/src/policy.ts`, roles, membership | `spec/03`, decision `access-is-per-product-roles`, `system/overview.md` |
| `apps/server/src/auth/**`, sessions, tokens | `spec/03`, decision `built-in-identity-and-oauth` |
| `apps/server/src/migrations/*.sql`, `packages/core/src/db.ts` | `spec/04`; tenancy or row-level security changes: decision `shared-schema-tenancy-with-row-level-security`; retention: `spec/09` |
| `citations.ts` | `spec/04` (citations), decision `citations-snapshot-and-report-drift` |
| `story-html.ts`, `story-guidance.ts`, `story-styles.ts`, `story-theme.ts`, `story-print.ts`, `ops/story.ts` | `spec/04` and `spec/07` (Story), decisions `story-pages-are-sandboxed-agent-html`, `story-pages-follow-the-teams-design-system`, `story-notes-are-agent-memory` and `pdf-export-uses-browser-print` |
| `packages/parsers/**`, `kinds.ts`, `media.ts`, `worker.ts` | `spec/05`, decision `only-the-primary-file-is-searched`, the parser list in `spec/10` |
| `ops/search.ts` | `spec/08` |
| Archive, delete, export (`ops/export.ts`) | `spec/09`, decision `archive-by-default-delete-guarded` |
| `uploads.ts`, `adapters/**`, `ports.ts`, `config.ts` | `spec/02` (adapters, configuration), `spec/05`, `operations/cloud-run.md` if an environment variable changed |
| `dev.ts`, root `package.json` scripts, ports, `.nvmrc`, `scripts/*.mjs` | `operations/local-development.md`, decision `development-substitutes-adapters-never-behavior` |
| `.github/workflows/**` | `operations/local-development.md` (CI), the phase 0 row in `spec/10` |
| `Dockerfile`, `cloudbuild.yaml`, `deploy/**` | `operations/cloud-run.md`, decision `one-stateless-image` |
| `apps/web/src/routes/**`, `main.tsx`, `shell/**` | `spec/07`, the phase 4 row in `spec/10` |
| `apps/web/src/styles/tokens.css`, `ui/**` | `DESIGN.md`, `.impeccable/design.json`, decision `studio-design-system` (Story pages do not follow the app's tokens) |
| A cookie (`setCookie`), a `whatbuild.*` browser storage key, or analytics (`apps/web/src/lib/analytics.ts`) | the kinds on `apps/web/src/routes/cookies.tsx`, `spec/09` §9.1, decision `analytics-only-for-people-who-accept-cookies` |
| `seed.ts`, `seed-content.ts` | usually nothing; `process/working-in-this-repository.md` if the sample product changes |
| A new top-level directory, package, or moved file | `system/repository-map.md`, the `AGENTS.md` path table |
| Product scope or vocabulary | `project/charter.md`, `spec/01`, `PRODUCT.md` |
| How work is done, the checks, the public-repository rules | `process/working-in-this-repository.md`, `AGENTS.md` |

Nothing in the map fits? Grep `okf/` for the file, function and feature names you touched, and
extend this map in the same change.

## Where knowledge goes

| Knowledge | Type | Place |
|---|---|---|
| Normative behavior of one area: fields, limits, errors, rules | Specification | the matching `okf/spec/NN-*.md` section |
| How a part fits together, for orientation | System Concept | `okf/system/` |
| A durable choice and why | Decision | `okf/decisions/` (the `okf-decision` skill) |
| A small choice inside one area that a reviewer may want to reverse | a `◆ Decision:` line | inline in that spec section |
| Built, not built, next, open questions, risks | Roadmap | `okf/spec/10-roadmap.md` only |
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
- a copy of code, `PRODUCT.md` or `DESIGN.md`. Link to them instead.

`okf/log.md` is gitignored on purpose. Do not create logs under other names.
