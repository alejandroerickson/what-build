---
type: Decision
title: Access is decided in the application, per product, by role
description: Roles at organization, team and product level; the highest applies; there are no per-object permissions.
tags: [decision, access, security, roles]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Access is decided in the application, per product, by role

## Context

Teams are small and work together on a product. Per-object permissions would make "who can see this?" hard to answer and add little.

## Decision

- Roles: organization owner, admin, member; team and product admin, editor, viewer, reader. Organization owners and admins are admins everywhere in it; a team role applies to all its products.
- A reader reads only the Story, without the notes agents keep on its pages ([decision](a-reader-reads-only-the-story.md)).
- A fourth organization role, guest, exists only in the [example organization](every-account-reads-the-example-organization-which-only-its-staff-write.md): a viewer of every product there, held by every account with no other grant there, never stored, and refused every write.
- The effective role is the highest that applies. There are no negative overrides.
- Readers read the Story, viewers read everything, editors write and archive (including reviews and the Story), admins also delete permanently and manage the product and its people ([decision](archive-by-default-delete-guarded.md)).
- An agent acts as the lower of its person's role and its connection's level ([decision](an-agent-connection-has-a-level-the-person-chooses.md)).
- No role: `404`. Too low a role: `403` naming the role held and the role needed.
- One policy module (`packages/core/src/policy.ts`) serves both REST and MCP.

## Consequences

- Every role on a product but reader sees everything in it. Until 2026-10-07 every role did; the reader changed that.
- The database enforces the tenant boundary only; roles are enforced by the application.

## Constrains

- Operations declare their access level (`story`, `read`, `write`, `admin`, `owner` or `any`); handlers do not re-implement role checks. A handler may leave out of its result what a reader may not see, through `readsOnlyTheStory`.
- Product people are managed in Settings with `members.grant` and `members.revoke`.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md).
