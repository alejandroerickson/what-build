---
type: Decision
title: Access is decided in the application, per product, by role
description: Roles on the organization, on all its products and on each product; the highest applies; there are no per-object permissions.
tags: [decision, access, security, roles]
generated: {by: agent:claude, at: 2026-11-13}
status: stable
---

# Access is decided in the application, per product, by role

## Context

The people working on a product are few, and work together. Per-object permissions would make "who can see this?" hard to answer and add little.

## Decision

- Roles: organization owner, admin, product creator (`creator`), member; all products and product admin, editor, viewer, Story reader (`story_reader`). Organization owners and admins are admins everywhere in it; a role on all products applies to every product, later ones included; a product creator creates products and is admin of each one it creates. Teams, which once held products and gave a role on all of a team's products, are gone ([decision](an-organization-holds-its-products-directly-with-no-teams.md), 2026-11-08).
- A Story reader reads only the Story's live pages, without the notes agents keep on them ([decision](a-story-reader-reads-only-the-story.md)); a viewer reads everything in the product and changes nothing. The role was named `reader` until 2026-11-13, when the maintainer renamed it so the name says what it reaches.
- A fourth organization role, guest, exists only in the [example organization](every-account-reads-the-example-organization-which-only-its-staff-write.md): a viewer of every product there, held by every account with no other grant there, never stored, and refused every write.
- The effective role is the highest that applies. There are no negative overrides.
- Story readers read the Story, viewers read everything, editors write and archive (including reviews and the Story), admins also delete permanently and manage the product and its people ([decision](archive-by-default-delete-guarded.md)).
- An agent acts as the lower of its person's role and its connection's level ([decision](an-agent-connection-has-a-level-the-person-chooses.md)).
- No role: `404`. Too low a role: `403` naming the role held and the role needed.
- One policy module (`packages/core/src/policy.ts`) serves both REST and MCP.

## Consequences

- Every role on a product but Story reader sees everything in it. Until 2026-10-07 every role did; the Story reader changed that.
- The database enforces the tenant boundary only; roles are enforced by the application.

## Constrains

- Operations declare their access level (`story`, `read`, `write`, `admin`, `owner`, `creator` or `any`); handlers do not re-implement role checks. A handler may leave out of its result what a Story reader may not see, through `readsOnlyTheStory`.
- Product people are managed in Settings under the product's People, and the organization's and all products' under the organization's People, with `members.grant`, `members.grant_many` and `members.revoke`.

Specified in: [03-accounts-and-identity](../spec/03-accounts-and-identity.md).
