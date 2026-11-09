---
type: Decision
title: An organization holds its products directly; there are no teams, and an address with a team still reaches its product
description: Teams are removed from the data, the roles and every address; a role on all products and a product creator role take over what teams did, and addresses written with a team keep working.
tags: [decision, tenancy, roles, addressing, mcp, web]
generated: {by: agent:claude, at: 2026-11-08}
status: stable
---

# An organization holds its products directly; there are no teams, and an address with a team still reaches its product

## Context

The first schema put a team between an organization and its products: a group of people and the
products they run, whose role applied to every product in it. The web app never offered a second
team, so nearly every organization had one, named when it was created, whose slug sat in every
address (`/t/<org>/<team>/<product>`, REST, MCP connectors, links in Story pages) and whose role
people had to learn as a third level. A team did three things a person could not do otherwise: a
role on every product, products made later included; product creation by someone who is not an
organization admin; moving and copying sources between its products. The organization in
WhatBuild is small, with few people who write, so adding people to a new product takes moments.
The maintainer chose to remove teams on 2026-11-08.

## Decision

- **Organization → product.** No `teams` table, no `team_id`; a product's slug is unique in its
  organization and is none of the organization's own pages (`members`, `plan`, …).
- **Roles.** Organization: owner, admin, product creator (`creator`: creates products, and is
  admin of each one it creates), member. **All products**: admin, editor, viewer or reader on
  every product of the organization, now and later; only its owners and admins give it. Product:
  the same four ([decision](access-is-per-product-roles.md)).
- **Moving and copying sources between products are removed**, not widened to the organization.
- **Addresses** are `/t/<org>/<product>`, `/api/v1/p/<org>/<product>`, `org/product` on MCP and
  `/mcp/t/<org>/<product>` for a product's connector.
- **An address with a team still reaches its product**: the web app redirects it, MCP takes
  `org/team/product` and an old connector's address, whose answers carry `connector_address`. The
  middle part names nothing, except where the migration had to change a product's slug, which
  `team_addresses` keeps. REST keeps no old routes: only the web app calls it.
- Migration: a team's role became the same role on all products where the organization had one
  team, and on each of the team's products where it had several; a team admin also became a
  product creator.

## Consequences

- Two levels of roles to learn instead of three; Give access names a place: the organization, all
  products, or one product.
- A source added to the wrong product is archived there and added again in the right one.

## Constrains

- Nothing new may take a team back: grouping products is a tag or a name, not a level of access.
- `team_addresses` is read only to resolve an old address (`findProduct`, `policy.ts`).

Specified in: [03-accounts-and-identity](../spec/03-accounts-and-identity.md).
