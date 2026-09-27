---
type: Decision
title: Tenants share one schema, partitioned by key and enforced three times
description: Every content row carries tenant_id; isolation is enforced by authorization, a tenant-scoped transaction, and Postgres row-level security.
tags: [decision, tenancy, security, postgres]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# Tenants share one schema, partitioned by key and enforced three times

## Context

Many organizations share one deployment. Isolation must be part of the schema from the first migration, and one bug must not be enough to leak data.

## Decision

- One database and one schema for all tenants. Every content row has `tenant_id`; product content also has `product_id`.
- Layer 1: the policy module resolves the caller's role for the addressed product before validating input, and answers `404` when there is none.
- Layer 2: every operation runs in a transaction where the server sets `app.tenant_id` for that transaction only.
- Layer 3: forced row-level security on every content table allows only rows matching `app.tenant_id`. The server refuses to start in production as a role that bypasses it.
- Blob keys begin `t/<tenant_id>/`. References never cross products (`422 cross_product_reference`).

## Consequences

- A query that escapes the application's checks still returns nothing.
- A product always exports as a closed bundle.
- Moving or copying sources is limited to products of the same team.

## Constrains

- Every new content table gets `tenant_id` and the row-level security policy in its migration.
- Addressing is always explicit; the server never remembers a current product.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md), [04-data-model](../spec/04-data-model.md).
