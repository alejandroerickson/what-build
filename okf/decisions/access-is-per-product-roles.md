---
type: Decision
title: Access is decided in the application, per product, by role
description: Roles at organization, team and product level; the highest applies; there are no per-object permissions.
tags: [decision, access, security, roles]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Access is decided in the application, per product, by role

## Context

Teams are small and work together on a product. Per-object permissions would make "who can see this?" hard to answer and add little.

## Decision

- Roles: organization owner, admin, member; team and product admin, editor, viewer. Organization owners and admins are admins everywhere in it; a team role applies to all its products.
- The effective role is the highest that applies. There are no negative overrides.
- Viewers read, editors write (including reviews and the Story), admins also manage the product and its people.
- No role: `404`. Too low a role: `403` naming the role held and the role needed.
- One policy module (`packages/core/src/policy.ts`) serves both REST and MCP.

## Consequences

- Every role on a product sees everything in it.
- The database enforces the tenant boundary only; roles are enforced by the application.

## Constrains

- Operations declare their access level; handlers do not re-implement role checks.
- Product people are managed in Settings with `members.grant` and `members.revoke`.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md).
