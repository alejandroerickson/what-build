# Product

<!-- impeccable:product-schema 1 -->

> **Draft, written unattended on 2026-09-25 from the specification and the owner's brief. Every
> line marked _(inferred)_ has not been confirmed by the owner; correct or delete it.** The visual
> direction is the owner's: the Studio design system, documented in `DESIGN.md`.

## Platform

web

## Stack

TypeScript throughout: a Node server (Hono) serving REST, MCP and the web app from one image, a
React single-page app, Postgres as the only database, and an object store for files. Hosted on
Google Cloud Run. Recorded in `okf/spec/02-architecture.md`.

## Users

- **The product trio** — product managers, designers and an engineering lead exploring a product
  idea — about 5 to 15 people per organization. They browse evidence, read and correct sources'
  text, review mockups and assumptions, and direct their agents. They work at a desk on a laptop or larger
  screen; a phone is an occasional reading context. They do not use git and never learn a storage
  path.
- **Their AI agents**, connected over MCP, which do most of the intake and synthesis: upload and
  clean sources, read and correct their text, draft assumptions, build mockups, publish the Story.
- **Stakeholders** who read the Story and rarely anything else _(inferred: whether they get their
  own role or share links is an open question)_.
- **People evaluating the approach**, who should see a real, fully derived discovery (the example
  organization), which they read as a guest as soon as they sign up.

## Product Purpose

Turn a pile of discovery material — interviews, sales calls, research exports, documents, decks —
into something a team can act on: outcomes, mockups, reviewed assumptions and a stakeholder Story,
with the evidence behind them kept whole and searchable.
Success is that a team keeps its discovery and its ideas in one place, where people and their
agents find what they heard by searching, and that an agent's work is visible, attributed and
reviewable rather than lost in a chat.

## Positioning

WhatBuild contains no AI. It parses, stores, searches and checks deterministically, and the
intelligence comes from whatever agent the team connects. That split is the product: each
source's words as one exact text that people and agents read, correct and search; honest
attribution of what an agent did versus what a person agreed to; and an agent surface (MCP) that
is the most complete control panel.

## Operating Context

Discovery arrives in bursts around interview rounds, research readouts and sales calls. People
read far more than they write: browsing sources, reading their text, reading synthesis, reviewing a
small set of agreements. Agents do the heavy lifting in the user's own chat or coding client, and
people check the results in the web app. The web app and the agent share one account, one set of
permissions and one activity log.

## Capabilities and Constraints

- Four destinations inside a product: **Idea, Evidence, Exploration, Story**. Everything else is
  a sub-view.
- Hierarchy: tenant (organization) → team → product (one discovery). Roles at each level; a person
  without a role on a product cannot see it at all.
- A source is described by a title and tags (what it is, whom it concerns, what it bears on),
  reusing the tags the team already has; there are no kinds to choose and no folders.
- A source's words are one derived text, taken from one of its attachments until someone edits it;
  every attachment is read and kept but never searched, and the UI says so. Search reads a
  source's title, tags, summary, text, notes and comments.
- Nothing keeps citations: agents find what bears on a piece of work by searching. The Story is the
  team's own communication (what to build, the pitch, the plan), and a page quotes, paraphrases or
  links what is in the product however suits its readers.
- Archive is the reversible default everywhere; delete is permanent, explicit, guarded and an admin's.
- Story pages are agent-authored, self-contained HTML shown in a sandbox. Agents write the Story;
  people read it, export it to PDF, and arrange, archive and delete its pages by hand. Pages follow the product's Story style: the
  company's own design system, or a house style an agent adopted for the product. Never
  WhatBuild's own look, since a Story is often read outside the team.
- Vocabulary is fixed: source, derived text, attachment, outcome, mockup, assumption, Story, archive. Never "findings", "claims", "document store", "file" for an attachment, or a storage path in the UI.
- WCAG 2.2 AA, fully keyboard-operable, usable at phone width.

## Evidence on Hand

- A synthetic sample product ("Crewboard", in `apps/server/src/seed-content.ts`): four sources,
  outcomes, an assumption, a mockup and two Story pages. All people and organizations are
  invented; no real customer material exists in this repository and none may be fabricated as real.
- The brand is the W mark (`apps/web/public/favicon.svg`), a W in a rounded tile under a title-bar
  line like one of the app's panels, with the wordmark "WhatBuild". The type
  is Inter and the accent is indigo, in the Studio design system documented in `DESIGN.md`. The
  domain what-build.com is registered.

## Product Principles

1. **Describe the source, never the path.** The interface asks what something is and takes
   responsibility for where it lands.
2. **Collaborate, don't build a case.** WhatBuild keeps a team's evidence and ideas in one place;
   what bears on a piece of work is found by searching, never stapled to it as citations.
3. **People read the synthesis.** Lead with readable reasoning and a few consequential agreements;
   keep exhaustive evidence one step away.
4. **Honest about the machine.** Show who did what and through which surface; never let an agent's
   interpretation look like human agreement, and say plainly what search did not examine.
5. **Agents are teammates.** Attribution, activity and review make an agent's work as inspectable
   as a colleague's.

## Accessibility & Inclusion

WCAG 2.2 AA; full keyboard operation; phone-width legibility for reading; colour never the only
carrier of a status (review states and search coverage are always stated in words).
