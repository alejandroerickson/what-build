---
type: Specification
title: WhatBuild turns a team's discovery material into cited insight and a story, with agents as first-class contributors.
description: Who the product is for, the core loop, the four screens, the vocabulary, the non-negotiable behaviors, and what the product is not.
tags: [spec, product, vocabulary, principles]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# 1. Product

## 1.1 Who it is for

- **A team exploring a product idea** who has a growing pile of discovery material and wants it to
  add up to something: explicit direction, evidence-backed insight, and a story stakeholders can
  read.
- **The agents working with them.** Most of the reading, citing, and drafting is work an agent
  does well when it can reach every passage of every source precisely. The product is designed so
  that an agent connected over MCP is a first-class contributor, not an integration.
- **People evaluating the approach.** This is demonstration software. Someone should be able to
  read a real, fully derived discovery, the **sample product**, and be working in their own
  organization a minute after entering an email address. The sample product is seeded by
  `pnpm dev` ([`apps/server/src/seed.ts`](../../apps/server/src/seed.ts)); a public, read-only copy
  that needs no account is planned ([roadmap](10-roadmap.md)).
- **Contributors.** It is MIT-licensed open source, and the whole application runs on a laptop in
  one command ([§2.6](02-architecture.md)). Someone fixing a parser bug must never need a cloud
  account to do it.

## 1.2 The core loop

1. **Establish objectives.** Start a product with an idea; write down the short goals that
   discovery work must serve.
2. **Gather evidence.** Upload material into an opinionated taxonomy. The application asks what a
   document *is* before it places it. A contributor describes the material and never chooses or
   learns a storage path.
3. **Derive.** Every source's primary file is parsed into passage-addressable text: segments with
   speakers, cue timestamps where they exist, and exact character offsets.
4. **Synthesize.** Write insights (substantial Markdown documents) and register consequential
   assumptions and decisions, each cited to exact source passages.
5. **Tell the story.** Publish an outward-facing, stakeholder-readable set of versioned HTML pages
   organized in a hierarchy.
6. **Iterate together.** Teammates and their agents keep adding material and revising synthesis in
   parallel, with attribution, optimistic concurrency, and an activity log throughout.

A team can run several of these loops at once: each is a **product**
([§3](03-accounts-teams-and-identity.md)).

## 1.3 The four screens

Inside a product the main navigation has exactly four destinations. Everything else is a sub-view
of one of them.

| Screen | Purpose |
|---|---|
| **Objectives** | Short strategic goals. The landing screen of a product: where a product idea becomes explicit direction. |
| **Evidence** | The sources: kind-first upload, browse with filters, source pages, the passage reader, notes, search. |
| **Synthesis** | Insights (the insight documents), the assumption register, the decision register. |
| **Story** | The outward-facing report: an ordered hierarchy of versioned, sandboxed HTML pages. |

**Activity** is not a fifth destination: it is a quiet page reached from the account menu, and from
an item's "Activity on this …" link, filtered to that item ([§7](07-web-app.md)). Product settings
(details, people, export, archive) are a page inside the product.

Outside a product there are only: the product list, **Members** of an organization, **Connect**
(agent onboarding), and **Account** (name, connected agents, access tokens). Routes are in
[`apps/web/src/main.tsx`](../../apps/web/src/main.tsx).

## 1.4 Vocabulary

One word per concept, used identically in the UI, REST, MCP, the skill, and documentation.

| Term | Meaning |
|---|---|
| **account** | One person's sign-in. May belong to several tenants. |
| **tenant** | An organization: the isolation and billing boundary. Shown as "organization" in the UI. |
| **team** | A group inside a tenant and the products it runs. Roles granted on a team apply to its products. Never "workspace". |
| **product** | One discovery. Owns all of the objects below. |
| **role** | viewer, editor or admin on a team or product; owner, admin or member of a tenant. |
| **source** | One discovery event or document, with metadata and one or more files. Stored as a record: `record_id` in the API. The destination that holds them is **Evidence**; never "library", "document store", "bucket" or a storage path. |
| **file** | A stored file belonging to a source, with a role: `primary`, `origin`, or `supplement`. The role is **origin**, not "source", so it cannot be confused with the destination. |
| **segment** | The atomic unit of derived text: a paragraph or a cue, with offsets. |
| **passage** | A contiguous range of segments in one source. What citations and reads address. |
| **objective** | A short strategic goal. |
| **insight** | A readable Markdown synthesis document. The destination that holds insights and the two registers is **Synthesis**; within it, the list of insights is **Insights**. |
| **revision** | The previous text of an authored body, kept immutably whenever that body is overwritten. |
| **assumption**, **decision** | Entries in the two reviewed **registers**. |
| **citation** | A structural pointer from a register entry or a Story page version to a passage, with an immutable snapshot. |
| **review** | An attributed status judgment on a register entry; for an insight, a mark that a person stands by its current revision. |
| **Story**, **page** | The stakeholder report and its versioned HTML pages. |
| **view** | A saved, derived source that records a lineage baseline of its inputs. |
| **activity** | The append-only log of what changed in a product, and who changed it. |

"Findings" and "open questions" are deliberately **not** product types. Do not introduce them.

## 1.5 Non-negotiable behaviors

1. **Roles, and nothing finer.** Access is a role on a tenant, team or product (viewer, editor,
   admin), checked in one policy module for both front doors
   ([`packages/core/src/policy.ts`](../../packages/core/src/policy.ts)). No per-folder or
   per-object permissions, and no token that widens or narrows its person's role. An agent has
   exactly its person's role. What you cannot see is `404`; what you may see but not change is a
   `403` naming both roles ([§3.5](03-accounts-teams-and-identity.md)).
2. **Isolation is enforced twice.** The core only ever runs a handler in a transaction already
   scoped to one tenant; Postgres row-level security checks again. A cross-tenant read is `404`,
   and a test attempts one through **every** product, team and tenant operation.
3. **Destruction is never a side effect.** Editing, archiving and restoring never destroy anything.
   **Archive is the reversible default and always the first thing offered**: it takes an object out
   of listings, out of the UI's main views, and out of the search space an agent can reach, and
   erases nothing; restore puts it back. **Delete is permanent**, and it exists on both surfaces,
   for editors, because people upload the wrong thing and are entitled to have it gone. It is
   always explicit, always attributed, always described in those words, always previewable before
   it happens, and always leaves a tombstone so nothing that pointed at the object is left guessing
   ([§9.5](09-data-lifecycle.md)).
4. **Authored text is never lost to an overwrite.** Every object with a body a person or an agent
   writes (the product idea, objectives, annotations, insights, and register entries while still
   editable) keeps immutable **revisions** ([§4.1](04-data-model.md)). A well-meaning agent
   rewriting a paragraph must never be the way a team loses it.
5. **Citations outlive edits.** Citation snapshots are immutable, derivations are immutable and
   retained, and drift is detected and reported, never silently repaired.
6. **Attribution on every write.** Every mutation records who made it and through which surface,
   and appends an event to the activity log in the same transaction.
7. **Optimistic concurrency on every editable object.** Each carries an ETag; updates require the
   current one; a stale write fails rather than overwriting a teammate or an agent.
8. **Bounded responses on every read.** No call can return an entire source, an unbounded list,
   or an unbounded text.
9. **Data leaves as easily as it arrives.** Export is complete, in an open format, available to
   anyone who can read the product at any time, through both adapters, and **never blocked by a
   quota** ([§9.4](09-data-lifecycle.md)).
10. **Product independence.** Built-in kinds, fields, and filters describe discovery work and
    source formats, never the domain of the product being studied. Domain concepts live in source
    content and ordinary tags. Stored data must stay readable when a built-in choice is retired.
11. **Adapter parity.** Every operation is available through both REST and MCP with the same
    inputs, outputs, authentication, and status codes. The web UI uses nothing the MCP surface
    lacks.
12. **Development substitutes adapters, never behavior.** Any difference a caller can observe
    between a laptop and production (a status code, an ordering, a limit) is a bug
    ([§2.6](02-architecture.md)).

And the ethos that orders the work: **the smallest implementation that proves the full path wins.**
Prove upload → derive → search → passage read end to end through both adapters, then grow.

## 1.6 What this product is not

- Not a general document manager: the taxonomy is opinionated and closed.
- Not a chat product: it has no built-in LLM and needs no model API key. Intelligence arrives
  through whatever agent the user connects over MCP.
- Not a permissions system: see non-negotiable 1.
- Not a compliance product. It is a free, pre-1.0 service run as a side project, and it says so in
  those words ([§9.1](09-data-lifecycle.md)).
- No integrations with external "memory" or knowledge services. Sources are the memory.
