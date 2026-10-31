---
type: Decision
title: A reader reads only the Story, never the evidence behind it
description: A team or product role below viewer for stakeholders, enforced by the server: Story pages, their versions and their export, without the notes agents keep on them.
tags: [decision, access, roles, story, stakeholders]
generated: {by: agent:claude, at: 2026-10-30}
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
  their versions and the hierarchy, a page's HTML, and the print view (export). `products.get` is
  `story` too, and `products.list` lists every product the caller holds a role on, so a reader can
  find and open the product.
- Everything else needs `viewer` at least, and answers a reader `403` naming both roles.
- That includes the organization's people. Someone who reads only the Story everywhere in an
  organization (a reader on its teams or products, with no higher role there and no organization
  role but member) is refused its members and invitations (`members.list`, `403`), and the app
  leaves its Members out for them. The maintainer chose this on 2026-10-10: a Story is often read
  outside the team, and who works on it stays with the team.
- A reader is given only the Story's live pages. An archived page, one the team took out of the
  Story, is left out of a reader's page list and print view and answers them `404` by its address,
  with its versions and HTML; the team still reads it. The maintainer chose this on 2026-10-10:
  what the team archived is not part of the Story a stakeholder reads.
- A reader's Story reads leave out the page's notes for agents, of a page that shows a mockup
  page everything but its size, and of a page that shows a whole canvas everything but its layout and
  each page's title and size. Their product reads leave out the product concept and count Story
  pages only.
- A Story page that shows an entry into a mockup's prototype gives a reader that prototype's
  address, which reaches every file of that one mockup version's prototype, since a prototype is
  what its entry opens; nothing else of the mockup (its brief, notes, files, other pages or
  versions) reaches a reader. The maintainer chose this on 2026-10-14
  ([decision](mockups-carry-prototypes-served-from-a-capability-path.md)).
- A Story page that shows a whole canvas gives a reader that canvas: each page of the one mockup
  version it points at, through the Story page's own route of access `story`, and that version's
  prototype when a page enters it. Its brief, notes, files and other versions stay with the team,
  and the mockup's own routes keep refusing a reader. The maintainer chose to share whole canvases on
  2026-10-30: a team promotes one when stakeholders should see it, which is the team's choice per
  mockup.
- A reader can search the Story, and nothing else: `search` in plain mode, over every Story page by
  what it shows, mockup pages and whole canvases among them. It reads no source, assumption, outcome
  or concept, no mockup's brief or notes, and offers back only corrections from the Story's own
  titles; every other mode, kind or source is refused. The maintainer chose this on 2026-10-30, so a
  stakeholder can find a page once a Story holds many.
- The server never changes a page's HTML for a reader. What its author wrote, including mentions
  of the evidence, is the reader's to read; the evidence itself is out of reach.
- Rejected: hiding the rest only in the web app, since the API and MCP would still serve it;
  share links, which can be forwarded and need no account.

## Consequences

- A reader's agent sees exactly the reader's Story, as every agent has its person's role.
- An evidence link inside a page leads a reader nowhere they can read: the app takes them back to
  the Story, with a toast saying they can read only the Story, so the return is never silent.
- The app's Story shows a reader no Archived pages group, since the server gives them none.
- The highest role still applies: a reader on a product who is a viewer on its team is a viewer,
  and a reader on one product who is a viewer on another in the same organization sees the people
  on that other product, never those of the one they only read
  ([§3.5](../spec/03-accounts-teams-and-identity.md)).

## Constrains

- Only Story reads, a search of the Story, and the product's own name and Story count may declare
  `story`; a new operation that does needs the same trimming for a reader.
- Trimming happens in the handlers through `readsOnlyTheStory` in
  `packages/core/src/policy.ts`, never in the web app alone; whether someone reads only the Story
  in a whole organization is `readsOnlyTheStoryIn` there.
- A write on a grant given earlier checks the requester's role again when it lands: the upload
  relay stores nothing for someone made a reader since (`apps/server/src/uploads.ts`).

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md) §3.5.
