---
type: Ontology
title: Concept types and editing rules
description: The concept types this bundle uses, the frontmatter each concept carries, and the rules for editors.
tags: [ontology, okf]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Ontology

Ordinary Markdown links are the graph. The structure on top is deliberately
small, so that whoever changes the code also updates the concept it affects.

## Frontmatter

| Key | Meaning |
|---|---|
| `type` | One of the concept types below. Required. |
| `title` | A sentence, not a filename. |
| `description` | One line: what a reader gets from this file. |
| `tags` | A short list for grep. |
| `generated` | `{by: agent:<name>, at: <ISO date>}` or `{by: person:<name>, at: …}`: who last changed it and when. |
| `status` | `draft` (written from inspection, unreviewed), `stable` (settled), `deprecated` (superseded; say by what). |
| `sources` | Optional. Where a claim came from when that is outside the bundle: `id`, `title`, `resource`. |

## Concept types

| Type | Used for |
|---|---|
| `Index` | A map of a directory. |
| `Bundle Guide` | This bundle's operating manual (`README.md`). |
| `Ontology` | This file. |
| `Charter` | What the product and the repository are and are not. The authority on intent. |
| `Decision` | An architectural decision record: context, the choice, consequences, what it constrains. |
| `System Concept` | How a part of the system works, at the level an engineer needs to orient. |
| `Specification` | The detailed, normative description of one area (`spec/`). MUST, SHOULD and MAY carry their usual meaning. |
| `Roadmap` | What is built, what is next, and the open questions. |
| `Domain Concept` | The product's vocabulary and domain objects. |
| `Process` | How work on this repository is done: checks, conventions, rules for agents. |
| `Tooling` | A script in this bundle and how to run it. |

A new type gets its row here, and in `tools/validate_okf.py`, in the same
change that first uses it.

## Rules for editors

- **Describe what is, not how it came to be.** No session history, requests, handoff notes or
  to-do lists: the repository is public. Git history records change.
- **Say where a claim comes from** when it is not obvious: observed in the code (name the file),
  decided by the maintainer (dated), or inferred (say so).
- **Correct in place, and date the correction** in `generated.at`. A superseded decision is marked
  `deprecated` and names what replaced it. Never leave two concepts silently disagreeing.
- **Do not write a proposal as though it were decided.** Planned work belongs in the
  [roadmap](spec/10-roadmap.md).
- **Link, do not copy.** Code, `PRODUCT.md` and `DESIGN.md` stay where they are; link to them.
- **Short beats complete.** Three accurate sentences beat a page nobody updates.
