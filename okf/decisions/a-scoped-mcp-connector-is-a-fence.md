---
type: Decision
title: A scoped MCP connector is a fence, not a default
description: An MCP endpoint scoped to an organization or a product refuses every call outside it, and its token works on no wider endpoint, so a person can keep each organization's connector separate and turn one off.
tags: [decision, mcp, oauth, tenancy, security]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# A scoped MCP connector is a fence, not a default

## Context

People who work for more than one organization connect an agent to each. A product-bound address
used to set only the default product: an agent could still name any other product the person could
reach, so work meant for one organization could land in another. The maintainer decided on
2026-10-07 that scoped means scoped: a connector scoped to an organization or a product reaches
nothing else, and reaching everything takes the unscoped connector.

## Decision

- Three endpoints: `/mcp` (everything the account can reach), `/mcp/t/<tenant>` (one
  organization) and `/mcp/t/<tenant>/<team>/<product>` (one product).
- Through a scoped endpoint, a call whose resolved scope lies outside it is refused with
  `403 outside_connector_scope`, after authorization and before the handler, so it changes nothing.
  Account-level operations are refused too, except reads that reach no organization's content.
  `products.list` shows only what is inside.
- An OAuth token is bound to the endpoint it was approved for and serves it and the endpoints
  inside it, never a wider one. The consent page and the connected-agents list name the scope.
- Rejected: a scope chosen by OAuth `scope` strings on one endpoint. Clients add connectors by
  address and rarely let a person pick scopes; the address is what they show and toggle.

## Consequences

- A person adds one connector per organization and turns each on or off in their agent.
- A product connector cannot manage people, create products or move a source to another product;
  that needs an organization connector or the web app.
- A token cannot be reused on a wider endpoint, so the scope survives a misconfigured client.
- The unscoped connector reaches everything the account can, the example organization included:
  only its staff write there, so it carries nothing a stranger wrote
  ([decision](every-account-reads-the-example-organization-which-only-its-staff-write.md)).

## Constrains

- The fence is `checkConnectorScope` in `packages/core/src/connector-scope.ts`, applied by
  `execute`; the MCP adapter passes the resolved scope and never filters results by hand except
  `products.list`.
- Token-to-endpoint checks go through `resourceCovers` in `apps/server/src/auth/connector-reach.ts`.

Specified in: [§3.6 and §3.8](../spec/03-accounts-teams-and-identity.md#36-addressing-and-isolation),
[§6.5 and §6.8](../spec/06-operations-and-adapters.md#65-mcp).
