# Concept types: conventions and templates

`okf/ontology.md` is the authority on types and frontmatter. If this file disagrees with it,
follow the ontology and fix this file.

## Frontmatter, on every concept

```yaml
---
type: Specification            # one of the types in okf/ontology.md
title: A sentence that states what is true, not a filename
description: One line saying what a reader gets from this file.
tags: [area, topic]
generated: {by: agent:<your-name>, at: 2026-01-31}
status: stable                 # draft | stable | deprecated
---
```

Optional: `sources`, a list of `{id, title, resource}` for a claim that comes from outside the
bundle.

Titles are claims ("Postgres is the only database"), not labels ("Database"). Link with relative
Markdown paths. The validator checks links inside `okf/` and warns on links out of it.

In every type, say where a claim comes from when it is not obvious. Name the code file, date a
maintainer's decision, or say "inferred".

## Specification (`okf/spec/NN-*.md`)

The normative description of one area. MUST, SHOULD and MAY have their RFC meanings. Sections
are numbered (`## 4.3 Insights`), and other files link to them as `[§4.3](04-data-model.md)`.

- Edit the section that owns the behavior. Do not add a new file for one feature.
- State the wire names, limits, errors and invariants exactly as the code enforces them. Name the
  file the rule lives in when that helps a reader verify it.
- A choice made here that a reviewer may want to reverse gets a line:
  `◆ Decision: <the choice>, because <the reason>.` Promote it to a decision record if it starts
  to constrain other areas.
- Keep behavior that is not built yet out of the spec's present tense. Either mark it
  "(not built yet; see the roadmap)" or leave it to the roadmap.

## System Concept (`okf/system/`)

Orientation, not norms: how the parts fit, at the level an engineer needs before opening code.

```markdown
# <Claim-style title>

<Two or three sentences: what this part is and why it exists.>

## How it works
<Short prose or a table. Link to the spec sections and decisions instead of repeating them.>

## Where it lives
<Paths, each with one line on what it is.>
```

`overview.md` goes from the top level to the detail without repeating itself. Add to the level
where a fact belongs, not to every level.

## Roadmap (`okf/spec/10-roadmap.md`)

The only place for planned work.

- The status table is "Observed in the code on <date>". When you change a row, update the date in
  its heading and move items between Built and Not built yet.
- Each phase has an *Accept:* list, which is its test plan. Check off an item only when the code
  and a test show it.
- Open questions record the question, the options and what would settle it. Once a question is
  settled, move it to the settled list with its answer, or into a decision record.
- Never write it as a diary. It states what is true of the code and what comes next.

## Process (`okf/process/`, `okf/operations/`)

How to do something. Use imperative steps, exact commands in code blocks, and the expected
result. The operations guides cover running and deploying: ports, environment variables,
commands and troubleshooting. When a command, port or variable changes, fix every guide that
mentions it (`grep -rn "<old value>" okf`).

## Charter (`okf/project/charter.md`)

What the product and the repository are and are not. It changes rarely, and only when the owner
decides. Do not edit it to match drift in the code. Raise the drift instead.

## Domain Concept

For a term in the product's vocabulary that needs more than its line in `spec/01`: its
definition, its lifecycle and states, its relations to other objects, and the words the interface
uses for it. The vocabulary is fixed (source, passage, segment, objective, insight, assumption,
decision, Story, archive). A new term is a product decision. Record it in `spec/01` and
`PRODUCT.md` first.

## Index (`index.md` in every directory)

One line per concept, as `- [Title](file.md): what it is` or with the title alone. Order the
lines as a reader should meet them. A concept that no index links to fails validation.

## Tooling (`okf/tools/`)

A script that serves the bundle, run with `python3` and no dependencies. Describe it in
`okf/tools/index.md`: the command, what makes it fail, and what makes it warn.

## Deprecating a concept

Set `status: deprecated`. Add a line at the top of the body naming what replaced it and the date.
Keep it listed in its index, so old links still resolve, until nothing links to it. Then delete
it.
