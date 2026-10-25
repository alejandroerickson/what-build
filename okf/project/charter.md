---
type: Charter
title: WhatBuild, a hosted product-discovery workspace for teams and their agents
description: What the product and this repository are for, and what they are not.
tags: [charter]
generated: {by: agent:claude, at: 2026-10-24}
status: stable
---

# Charter

## What it is

- **A hosted, multi-tenant web product** that turns discovery material into outcomes, mockups,
  reviewed assumptions and a Story for stakeholders, with the evidence behind them kept whole and
  searchable. Who it serves and why: [`PRODUCT.md`](../../apps/web/PRODUCT.md)
  and the [product specification](../spec/01-product.md).
- **Agent-first.** An agent connected over MCP can do everything a person can do in the web app,
  as that person ([decision](../decisions/one-registry-two-front-doors.md)).
- **A public, MIT-licensed repository**, `alejandroerickson/what-build`, holding the product's code,
  its specification and this bundle. Anyone may run the same image against their own Postgres and
  bucket.
- **Cheap to run and simple to contribute to**: one image, one database, one object store, and a
  one-command local setup ([decision](../decisions/one-stateless-image.md),
  [decision](../decisions/development-substitutes-adapters-never-behavior.md)).

## What it is not

- Not an AI product. It makes no model calls and holds no model keys
  ([decision](../decisions/no-ai-in-the-product.md)).
- Not a desktop or native mobile app. It is a web app that also works in a phone browser.
- Not a per-document permission system. Access is per product
  ([decision](../decisions/access-is-per-product-roles.md)).
- Not a place for real customer material in the repository: sample content is synthetic.
- Not a place for session memory: the repository holds reference knowledge only
  ([decision](../decisions/public-repository-reference-docs.md)).
