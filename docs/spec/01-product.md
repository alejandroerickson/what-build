# 1. Product

## 1.1 Who it is for

- **A person or small team exploring a product idea** who has a growing pile of discovery
  material and wants it to add up to something: explicit direction, evidence-backed insight, and a
  story stakeholders can read.
- **The agents working with them.** Most of the reading, citing, and drafting is work an agent
  does well when it can reach every passage of every source precisely. The product is designed so
  that an agent connected over MCP is a first-class contributor, not an integration.
- **People evaluating the approach.** This is demonstration software. Someone should be able to
  try it in under a minute on a demo we host — nothing installed, no account, their data stored
  only in their own browser — and connect their own agent to it by pasting one URL.

## 1.2 The core loop

1. **Establish objectives.** Start a project with a product idea; write down the short goals that
   discovery work must serve.
2. **Add sources.** Upload material into an opinionated taxonomy. The application asks what a
   document *is* before it places it. A contributor describes the source and never chooses or
   learns a storage path.
3. **Derive.** Every source is parsed into passage-addressable text: segments with speakers, cue
   timestamps where they exist, and exact character offsets.
4. **Synthesize.** Write insights — substantial Markdown documents — and register consequential
   assumptions and decisions, each cited to exact source passages.
5. **Tell the story.** Publish an outward-facing, stakeholder-readable set of versioned HTML pages
   organized in a hierarchy.
6. **Iterate.** People and agents keep adding sources and revising synthesis together, with
   attribution and optimistic concurrency throughout.

A workspace can run several of these loops at once: each is a **project**
([§3](03-tenancy-and-identity.md)).

## 1.3 The four screens

Inside a project the main navigation has exactly four destinations. Everything else is a sub-view
of one of them.

| Screen | Purpose |
|---|---|
| **Objectives** | Short strategic goals. The landing screen of a project: where a product idea becomes explicit direction. |
| **Sources** | The library: kind-first upload, browse with filters, record pages, the passage reader, annotations, search. |
| **Insights** | The synthesis center: insight documents, the assumption register, the decision register. |
| **Story** | The outward-facing report: an ordered hierarchy of versioned, sandboxed HTML pages. |

Outside a project there are only: the project list, **Connect** (agent onboarding), and settings.

## 1.4 Vocabulary

One word per concept, used identically in the UI, REST, MCP, the skill, and documentation.

| Term | Meaning |
|---|---|
| **workspace** | The tenancy and membership boundary. Local profiles have exactly one. |
| **project** | One product discovery. Owns all of the objects below. |
| **library** | A project's store of discovery material. The only word for it: never "bucket", "drive", "repository", "document store", or a storage path. |
| **record** | One discovery event or document in the library, with metadata and one or more files. |
| **file** | A stored file belonging to a record, with a role: `primary`, `source`, or `supplement`. |
| **segment** | The atomic unit of derived text: a paragraph or a cue, with offsets. |
| **passage** | A contiguous range of segments in one record. What citations and reads address. |
| **objective** | A short strategic goal. |
| **insight** | A readable Markdown synthesis document. |
| **assumption**, **decision** | Entries in the two reviewed **registers**. |
| **citation** | A structural pointer from a register entry to a passage, with an immutable snapshot. |
| **review** | An attributed status judgment on a register entry. |
| **Story**, **page** | The stakeholder report and its versioned HTML pages. |
| **view** | A saved, derived document that records a lineage baseline of its inputs. |

"Findings" and "open questions" are deliberately **not** product types. Do not introduce them.

## 1.5 Non-negotiable behaviors

1. **Membership is the only access rule.** Every authenticated member of a workspace — human or
   agent — has the same read and write access to everything in it. No per-project or per-folder
   permissions, no roles that gate content, no API keys that act as access rules. The sign-in
   mechanism is interchangeable; the single boundary is not.
2. **Nothing is deleted through the product.** Archive and restore only. Archive hides an object
   from listings and search and erases nothing. Storage removal is an operator concern (retention
   policy, or removing local data), never a product operation.
3. **Citations outlive edits.** Citation snapshots are immutable, derivations are immutable and
   retained, and drift is detected and reported — never silently repaired.
4. **Attribution on every write.** Every mutation records who made it and through which surface.
5. **Optimistic concurrency on every editable object.** Each carries an ETag; updates require the
   current one; a stale write fails rather than overwriting a teammate or an agent.
6. **Bounded responses on every read.** No call can return an entire record, an unbounded list,
   or an unbounded text.
7. **Product independence.** Built-in kinds, fields, and filters describe discovery work and
   source formats, never the domain of the product being studied. Domain concepts live in source
   content and ordinary tags. Stored data must stay readable when a built-in choice is retired.
8. **Adapter parity.** Every operation is available through both REST and MCP with the same
   inputs, outputs, authentication, and status codes. The web UI uses nothing the MCP surface
   lacks.
9. **The smallest implementation that proves the full path wins.** Prove upload → derive → search
   → passage read end to end through both adapters, then grow.

## 1.6 What this product is not

- Not a general document manager: the taxonomy is opinionated and closed.
- Not a chat product: it has no built-in LLM and needs no model API key. Intelligence arrives
  through whatever agent the user connects over MCP.
- Not a permissions system: see non-negotiable 1.
- No integrations with external "memory" or knowledge services. The library is the memory.
