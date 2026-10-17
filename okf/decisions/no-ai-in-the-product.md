---
type: Decision
title: WhatBuild contains no AI; agents bring the intelligence over MCP
description: The product parses, stores, searches and checks deterministically; synthesis comes from the team's own agents.
tags: [decision, architecture, mcp, agents]
generated: {by: agent:claude, at: 2026-10-16}
status: stable
---

# WhatBuild contains no AI; agents bring the intelligence over MCP

## Context

Discovery synthesis needs a capable model, but a model inside the product means API keys, cost, a provider dependency, and interpretations that look like the product's own. Teams already use capable agents in their own clients.

## Decision

- The product makes no model calls and holds no model API keys or provider SDKs.
- Intelligence comes from whatever agent a person connects over MCP, acting with that person's credentials.
- The one reserved exception is a future embedding model for semantic search, run in the product's own worker ([search](../spec/08-search.md)).

## Consequences

- MCP is the most complete control panel: every operation is reachable there ([decision](one-registry-two-front-doors.md)).
- The product's value is exact storage, addressing, search and attribution, which a model cannot fake.
- Local development and CI need no keys at all ([decision](development-substitutes-adapters-never-behavior.md)).

## Constrains

- Any feature that would call a model from the server.
- The agent skill, which teaches agents the workflow instead.

Specified in: [01-product](../spec/01-product.md), [02-architecture](../spec/02-architecture.md).
