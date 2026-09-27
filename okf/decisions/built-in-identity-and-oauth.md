---
type: Decision
title: WhatBuild runs its own sign-in and its own OAuth 2.1 server for agents
description: Email links, Google sign-in, sessions and personal access tokens are built in, and agents connect through WhatBuild's own OAuth server.
tags: [decision, identity, oauth, mcp, security]
generated: {by: agent:claude, at: 2026-09-26T00:00:00Z}
status: stable
---

# WhatBuild runs its own sign-in and its own OAuth 2.1 server for agents

## Context

MCP clients expect OAuth discovery and dynamic registration against the server they connect to. People should not need passwords.

## Decision

- Sign-in by single-use email link or Google (OpenID Connect); a development-only sign-in exists outside production. No passwords.
- Web sessions use an `HttpOnly` cookie. Personal access tokens (`wbpat_…`) are created in the web app, shown once and stored hashed.
- For MCP, WhatBuild is its own OAuth 2.1 authorization server: discovery metadata, dynamic client registration, PKCE, one-hour access tokens, rotating refresh tokens (reuse revokes the connection).
- A token is the person: it carries exactly that person's roles.

## Consequences

- Agents act as their person, so authorship is also declared ([decision](attribution-and-declared-authorship.md)).

## Constrains

- Identity code lives in `apps/server/src/auth/`.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md).
