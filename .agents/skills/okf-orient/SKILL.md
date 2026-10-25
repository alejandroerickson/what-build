---
name: okf-orient
description: Find and read WhatBuild's documentation in okf/ before working. Use at the start of any task in this repository, before answering how some part of WhatBuild works or why it is built that way, before planning or changing code, and whenever you are unsure where something is or which decision governs it.
---

# Orient in the okf/ bundle

`okf/` is the single source of documentation for this repository: what WhatBuild is, how it is
built, the decisions behind it, the detailed specification, how to run it and how to change it.
Read the part your task needs before you plan or edit. Do not rebuild that understanding from the
code alone. The docs record intent and constraints that the code cannot show.

## First, what is waiting

Run `corepack pnpm attention` once per session and tell the person what it prints, if anything, as
`AGENTS.md` says.

## Read in this order, and stop when you have enough

1. `okf/index.md`: the map.
2. `okf/system/overview.md`: the whole system at three levels of detail. Read the top section;
   go deeper only as far as the task needs.
3. `okf/process/working-in-this-repository.md`, before changing anything.
4. The decisions in `okf/decisions/` that govern the area you are touching.
5. The spec section for that area in `okf/spec/`. These files are long (100 to 500 lines), so
   jump to the relevant heading instead of reading the whole file.

## Where each answer lives

| You need | Read |
|---|---|
| What the product is for, and what it deliberately is not | `okf/project/charter.md`, then `apps/web/PRODUCT.md` |
| The product's vocabulary (source, attachment, derived text, mockup, Story…) | `okf/spec/01-product.md` |
| Where a file or feature lives | `okf/system/repository-map.md` |
| Why something is built the way it is | `okf/decisions/index.md`, then the record |
| Components, stack, adapters, configuration | `okf/spec/02-architecture.md` |
| Tenancy, roles, sign-in, tokens, OAuth | `okf/spec/03-accounts-teams-and-identity.md` |
| Objects, fields, limits, invariants, assumptions, Story | `okf/spec/04-data-model.md` |
| Reading attachments, the derived text, derived files, the job queue | `okf/spec/05-derived-layer.md` |
| Every operation, REST and MCP shapes, errors | `okf/spec/06-operations-and-adapters.md` |
| Screens, URLs, interface behavior | `okf/spec/07-web-app.md`, then `apps/web/DESIGN.md` for visuals |
| Search modes and ranking | `okf/spec/08-search.md` |
| Archive, delete, retention, export | `okf/spec/09-data-lifecycle.md` |
| What is built, what is next, open questions, problems seen but not yet explained | `okf/spec/10-roadmap.md` |
| Agent-driven end-to-end tests, the golden master, writing a test plan | `okf/operations/end-to-end-tests.md`, then `e2e/plans/README.md` |
| Running, testing and deploying | `okf/operations/`; the table in `AGENTS.md` names the guide and the skill for each task |
| Mail: what the server sends, which deployment sends it and through what, setting it up or repairing it | `okf/operations/mail.md` |
| Releasing, rehearsing on the dev deployment, backups, restoring, recovering | `okf/operations/releasing.md`, `dev-deployment.md`, `backups.md`, `recovering-from-a-bad-release.md` |
| Rules for a change, and what may never be committed | `okf/process/working-in-this-repository.md` |
| The concept types and the editing rules | `okf/ontology.md` |

Finding things quickly:

```sh
grep -rln "tags:.*story" okf              # concepts by tag
grep -rn "◆ Decision" okf/spec            # smaller decisions made inside the spec
grep -rn "^## " okf/spec/04-data-model.md # a spec file's headings
```

## When sources disagree

- **Code** is the truth about what the system does now.
- A **decision** is the truth about what it should do. If the code contradicts a decision, do not
  quietly follow either one. Tell the person, and fix the code or revise the decision with the
  `okf-decision` skill.
- **Spec and system concepts** describe the code. If one is wrong, correct it in the same change
  with the `okf-update` skill. Do not work around it.
- The **charter** has final authority on intent.

## Not in this bundle

- `apps/web/PRODUCT.md` and `apps/web/DESIGN.md` hold the product and design records, with
  `apps/web/.impeccable/design.json`. They sit beside the web app because design tooling looks
  for them from the app upward.
- `packages/core/src/skill/SKILL.md` is the skill the *product* serves to agents that use
  WhatBuild over MCP. It is not guidance for working on this repository. Those skills live in
  `.agents/skills/`.

## After you orient

- Before finishing any change, use `okf-update` to keep the bundle true.
- When the work makes or reverses a durable choice, use `okf-decision`.
- Never write session notes, task logs or to-do lists into the repository. It is public. Keep
  those in `_private/` at the root of your checkout (ignored) or in your own memory.
