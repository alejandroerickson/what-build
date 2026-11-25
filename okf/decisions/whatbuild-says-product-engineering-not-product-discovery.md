---
type: Decision
title: WhatBuild says product engineering, not product discovery
description: What WhatBuild is for is called product engineering everywhere it speaks; one product's body of work is the product, and its material is said for what it is.
tags: [decision, product, vocabulary, positioning]
generated: {by: agent:claude, at: 2026-11-25}
status: stable
---

# WhatBuild says product engineering, not product discovery

## Context

WhatBuild called what it is for "product discovery", and used "discovery" for three other things:
one product's body of work ("a discovery"), the material a team collects ("discovery material"),
and OAuth's discovery metadata. The tagline became "Product engineering at the speed of AI
engineering" on the site and the overview. The maintainer chose product engineering as WhatBuild's
word throughout the product on 2026-11-23, and settled the other uses on 2026-11-25. No earlier
record chose "discovery" as the word, so this one supersedes none.

## Decision

- **What WhatBuild is for** is product engineering: "product discovery", "collaborative agentic
  discovery" and the MCP server's "WhatBuild holds product discovery" become product engineering.
- **One product's body of work** is "the product" or "the product's work", whichever reads plainly
  in the sentence. No new noun takes the place of "a discovery".
- **The material** is said for what it is: the team's material, its evidence (where WhatBuild's
  Evidence is meant) or its research, preferring the words of the fixed vocabulary.
- **Technical uses** keep their names: OAuth discovery, and a retired dimension's stored value.
- Decision records written before this one keep their words, as history.
- "Product engineering" can be heard as engineers who build product. Where that matters, a sentence
  says what is meant, as the site does under its tagline; other sentences stay as plain as before.

## Consequences

- The spec, the guide agents read, the operations' descriptions, the MCP server's instructions, the
  app, the site, the tutorial and the mail say the same thing.
- A deployment's own plans file may still describe a plan with the old word until its owner changes it.

## Constrains

- New text in `okf/`, `packages/core/src/guide/`, the operations' descriptions
  (`packages/core/src/ops/`), `apps/server/src/mcp.ts`, `apps/web/` and `packages/core/src/mail-words.ts`
  never calls WhatBuild's purpose "discovery", nor a product "a discovery".

Specified in: [01-product §1.4](../spec/01-product.md).
