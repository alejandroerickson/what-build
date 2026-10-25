---
type: Specification
title: WhatBuild turns a team's discovery material into insight and a story, with agents as first-class contributors.
description: Who the product is for, the core loop, the four screens, the vocabulary, the non-negotiable behaviors, and what the product is not.
tags: [spec, product, vocabulary, principles]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# 1. Product

## 1.1 Who it is for

- **A team exploring a product idea** who has a growing pile of discovery material and wants it to
  add up to something: explicit direction, evidence-backed insight, and a story stakeholders can
  read.
- **The agents working with them.** Most of the reading, searching and drafting is work an agent
  does well when it can reach every source's words precisely. The product is designed so
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

1. **State the idea.** Start a product with its **product concept**: who it is for, the problem
   they have, and how the product solves it. Then write its **outcomes**: what its users should be
   able to achieve with it. Agents write each as a **card**: a picture for people on its front, the
   text for agents on its back.
2. **Gather evidence.** Upload material and describe it with a title and tags: what it is, whom
   it concerns, what it bears on
   ([decision](../decisions/sources-are-described-by-tags.md)). A contributor never chooses or
   learns a storage path.
3. **Derive.** Every attachment is read into readable Markdown, and each source has one
   **derived text**, its words with speakers and cue times where they exist, which people and
   agents read, correct and search by exact character offsets
   ([decision](../decisions/a-sources-words-are-one-derived-text-and-attachments-are-never-searched.md)).
4. **Explore.** Mock up directions as versioned canvases of HTML pages under a brief, and register
   the consequential assumptions, each saying why the team holds it.
5. **Tell the story.** Publish the team's communication with its stakeholders (what it means to
   build and why, the pitch, the plan, where things stand) as a set of versioned HTML pages
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
| **Idea** | The product concept, then the outcomes. The landing screen of a product: where a product idea becomes explicit direction. |
| **Evidence** | The sources: upload with a title and tags, browse by tag, by who added and when, source pages with each source's text, notes, comments and attachments, search. |
| **Exploration** | Mockups (canvases of agent-made HTML pages, each with design notes, under a brief) and the assumption register. Formerly called Synthesis. |
| **Story** | The team's communication with its stakeholders: an ordered hierarchy of versioned, sandboxed HTML pages. |

**Activity** is not a fifth destination: it is a quiet page reached from the product's panel, and from
an item's "Activity on this …" link, filtered to that item ([§7](07-web-app.md)). Product settings
(details, people, export, archive) are a page inside the product.

Outside a product there are only: the product list, **Members** of an organization, **Connect an
agent** (the MCP address and the agents connected now), and the person's **Settings** (their display
name). Routes are in
[`apps/web/src/main.tsx`](../../apps/web/src/main.tsx).

## 1.4 Vocabulary

One word per concept, used identically in the UI, REST, MCP, the skill, and documentation. The
Idea screen's terms are a decision: [A product starts with its idea](../decisions/a-product-starts-with-an-idea-concept-and-outcomes.md).

| Term | Meaning |
|---|---|
| **account** | One person's sign-in. May belong to several tenants. |
| **tenant** | An organization: the isolation boundary. Shown as "organization" in the UI. |
| **team** | A group inside a tenant and the products it runs. Roles granted on a team apply to its products. Never "workspace". |
| **product** | One discovery. Owns all of the objects below. |
| **role** | reader, viewer, editor or admin on a team or product; owner, admin or member of a tenant. A reader reads only the Story. |
| **source** | One discovery event or document, with metadata, its derived text and its attachments. Stored as a record: `record_id` in the API. The destination that holds them is **Evidence**; never "library", "document store", "bucket" or a storage path. |
| **attachment** | A file kept with a source, in the app, the API, the MCP tools and the documentation alike, with no role. Every attachment is read and what was read kept, never searched. Never "file" for the concept ("file" is for bytes and formats); the database's tables keep the names `files` and `file_versions`. |
| **derived text** | A source's words as one Markdown document, taken from an attachment's text until someone writes or edits it; in prose, "a source's text". What search reads, with the title, tags, summary, notes and comments. |
| **reading** | One read of one version of an attachment (an attachment is "read"); a `derivation` in the API. |
| **comment** | A remark on a whole source (an `annotation` on the wire). |
| **summary**, **notes** | A source's short summary, written for people, and its freeform notes, kept by people and agents ([§4.6](04-data-model.md)). |
| **product concept** | Who the product is for, the problem they have, and how the product solves it. A card that heads the **Idea** screen: its back is the product's `concept` field. |
| **card** | The product concept or an outcome as the **Idea** screen shows it: a **front**, the picture people see first, which an agent draws in the card kit (`card_html`), and a **back**, the text agents read first (`concept`, `description`), which people open with More info. Agents write both sides together ([decision](../decisions/idea-cards-have-a-front-for-people-and-a-back-for-agents.md)). |
| **outcome** | What the product's users should be able to achieve with it, written from their side ("The crew lead plans next week in minutes"), not a feature, a task or a finding. Not the discovery's own goals. The outcomes are the compass everything else in a product is read against; an outcome cites no evidence. The destination that holds the product concept and the outcomes is **Idea**. |
| **mockup** | A canvas of HTML pages an agent built from the evidence (screens, flows, alternatives side by side), each page with design notes, under a Markdown **brief** that says what the canvas explores. A version is the whole canvas. Never "exploration", "board" or "prototype". The destination that holds the mockups and the assumptions is **Exploration**. |
| **prototype** | The multi-file part a mockup version may carry: a team's clickable prototype as it is (HTML documents, scripts, styles, fonts, images, fixtures), which canvas pages enter. Only this part is a prototype; the mockup is never called one, and its download or export is never called a bundle of it. |
| **revision** | The previous text of an authored body, kept immutably whenever that body is overwritten. |
| **assumption** | What the team treats as true while the evidence is incomplete: an entry in the product's one reviewed **register**. |
| **review** | An attributed status judgment on an assumption. |
| **Story**, **page** | The team's communication with its stakeholders, and its versioned HTML pages. |
| **view** | A derived source, tagged `analysis` (or `view`, `digest`), that says in its text what it was built from. |
| **activity** | The append-only log of what changed in a product, and who changed it. |

"Findings" and "open questions" are deliberately **not** product types. Do not introduce them.
"Insight" and "decision" were product types until they were retired
([decision](../decisions/insights-and-decisions-are-retired-into-evidence.md)); what a product held
of them is now sources.

## 1.5 Non-negotiable behaviors

1. **Roles, and nothing finer.** Access is a role on a tenant, team or product (reader, viewer,
   editor, admin), checked in one policy module for both front doors
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
   for admins, because people upload the wrong thing and are entitled to have it gone; an agent
   deletes only on a connection its person set to Admin. It is
   always explicit, always attributed, always described in those words, always previewable before
   it happens, and always leaves a tombstone so nothing that pointed at the object is left guessing
   ([§9.5](09-data-lifecycle.md)).
4. **Authored text is never lost to an overwrite.** Every object with a body a person or an agent
   writes (the product concept, outcomes, comments, and assumptions while still editable) keeps immutable **revisions** ([§4.1](04-data-model.md)). A well-meaning agent
   rewriting a paragraph must never be the way a team loses it.
5. **Evidence stays as it was read.** Attachment versions and their readings are immutable and
   retained, so what an attachment was read as stays readable exactly as it was after it is read
   again or the source's text is edited. What
   bears on a piece of work is found by searching the evidence, not kept as citations
   ([decision](../decisions/evidence-is-searched-not-cited.md)).
6. **Attribution on every write.** Every mutation records who made it and through which surface,
   and appends an event to the activity log in the same transaction.
7. **Optimistic concurrency on every editable object.** Each carries an ETag; updates require the
   current one; a stale write fails rather than overwriting a teammate or an agent.
8. **Bounded responses on every read.** No call can return an entire source, an unbounded list,
   or an unbounded text.
9. **Data leaves as easily as it arrives.** Export is complete, in an open format, available to
   anyone who can read the product at any time, through both adapters, and **never blocked by a
   quota** ([§9.4](09-data-lifecycle.md)).
10. **Product independence.** Built-in fields and filters describe discovery work and
    source formats, never the domain of the product being studied. Domain concepts live in source
    content and ordinary tags. Stored data must stay readable when a built-in choice is retired.
11. **Adapter parity.** Every operation is available through both REST and MCP with the same
    inputs, outputs, authentication, and status codes. The web UI uses nothing the MCP surface
    lacks.
12. **Development substitutes adapters, never behavior.** Any difference a caller can observe
    between a laptop and production (a status code, an ordering, a limit) is a bug
    ([§2.6](02-architecture.md)).

And the ethos that orders the work: **the smallest implementation that proves the full path wins.**
Prove upload → read → search → reading a source's text end to end through both adapters, then grow.

## 1.6 What this product is not

- Not a general document manager: a source is discovery evidence, described by a title and tags
  rather than filed in folders; what it says is searched, and its attachments are kept, never
  searched.
- Not a chat product: it has no built-in LLM and needs no model API key. Intelligence arrives
  through whatever agent the user connects over MCP.
- Not a permissions system: see non-negotiable 1.
- Not a compliance product. It is a free, pre-1.0 service run as a side project, and it says so in
  those words ([§9.1](09-data-lifecycle.md)).
- No integrations with external "memory" or knowledge services. Sources are the memory.
