---
type: Decision
title: A reader reads only the Story, never the evidence behind it
description: A team or product role below viewer for stakeholders, enforced by the server: Story pages, their versions and their export, without what the pages draw on.
tags: [decision, access, roles, story, stakeholders]
generated: {by: agent:claude, at: 2026-10-07}
status: stable
---

# A reader reads only the Story, never the evidence behind it

## Context

The Story is written for stakeholders, but until now the only way to let someone read it was the
viewer role, which reads everything in a product: sources, passages, insights, the registers and
activity. Stakeholders who only need the Story then get lost in the material behind it. The
maintainer chose, on 2026-10-07, a Story-only role over share links: readers sign in and pick their
product as anyone else does. It revises one consequence of
[access is per product, by role](access-is-per-product-roles.md), that every role sees everything.

## Decision

- `reader` is a team and product role below `viewer`. It is not an organization role.
- Operations declare a fourth access level, `story`, which a reader meets: reading Story pages,
  their versions and the hierarchy, a page's HTML, and the print view (export). `products.list`
  and `products.get` are `story` too, so a reader can find and open the product.
- Everything else needs `viewer` at least, and answers a reader `403` naming both roles.
- A reader's Story reads leave out what a page draws on: `refs`, `resolved_refs`, `citations`,
  `citation_count` and the page's notes for agents. Their product reads leave out the product
  concept and count Story pages only.
- The server never changes a page's HTML for a reader. What its author wrote, including mentions
  of the evidence, is the reader's to read; the evidence itself is out of reach.
- Rejected: hiding the rest only in the web app, since the API and MCP would still serve it;
  share links, which can be forwarded and need no account.

## Consequences

- A reader's agent sees exactly the reader's Story, as every agent has its person's role.
- An evidence link inside a page leads a reader nowhere they can read: the app takes them back to
  the Story.
- The highest role still applies: a reader on a product who is a viewer on its team is a viewer.

## Constrains

- Only Story reads and the product's own name and Story count may declare `story`; a new
  operation that does needs the same trimming for a reader.
- Trimming happens in the handlers through `readsOnlyTheStory` in
  `packages/core/src/policy.ts`, never in the web app alone.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md) §3.5.
