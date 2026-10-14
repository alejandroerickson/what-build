---
type: Decision
title: Tenants share one schema, partitioned by key and enforced three times
description: Every content row carries tenant_id; isolation is enforced by authorization, a tenant-scoped transaction, and Postgres row-level security.
tags: [decision, tenancy, security, postgres]
generated: {by: agent:claude, at: 2026-10-14}
status: stable
---

# Tenants share one schema, partitioned by key and enforced three times

## Context

Many organizations share one deployment. Isolation must be part of the schema from the first migration, and one bug must not be enough to leak data.

## Decision

- One database and one schema for all tenants. Every content row has `tenant_id`; product content also has `product_id`.
- Layer 1: the policy module resolves the caller's role for the addressed product before validating input, and answers `404` when there is none.
- Layer 2: every operation runs in a transaction where the server sets `app.tenant_id` for that transaction only.
- Layer 3: forced row-level security on every table but the directory tables below, which is every table of product content and the public sandbox's baselines, allows only rows matching `app.tenant_id`. The server refuses to start in production as a role that bypasses it.
- Directory tables sit outside layer 3, because authorization reads them before a transaction is scoped to one tenant, or across tenants: `tenants`, `teams`, `products`, `memberships` and `invitations`, which carry `tenant_id`, and `accounts`, `sessions`, `email_tokens`, `oauth_clients`, `oauth_codes`, `oauth_tokens` and `tenant_allowances`, which belong to no tenant. So do the job queue (`jobs`), `feedback` and its daily counts (`feedback_counts`), the public sandbox's `sandbox_settings`, `sandbox_invites` and `sandbox_usage`, the public site's `interest`, and `schema_migrations`. They are reached only through the authorization layer, and code that reads them filters by tenant.
- [`apps/server/test/row-level-security.test.ts`](../../apps/server/test/row-level-security.test.ts) keeps that list, each table with its reason, and fails on any other table without the policy.
- Blob keys begin `t/<tenant_id>/`. References never cross products (`422 cross_product_reference`).

## Consequences

- A query on content that escapes the application's checks still returns nothing. A directory table answers to layer 1 alone, which is why code reading one filters by tenant.
- A product always exports as a closed bundle.
- Moving or copying sources is limited to products of the same team.

## Constrains

- Every new content table gets `tenant_id` and the row-level security policy in its migration. A table that may not have the policy joins the test's list with the reason [§4.15](../spec/04-data-model.md) gives.
- Addressing is always explicit; the server never remembers a current product.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md), [04-data-model](../spec/04-data-model.md).
