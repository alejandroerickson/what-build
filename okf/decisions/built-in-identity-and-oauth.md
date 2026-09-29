---
type: Decision
title: WhatBuild runs its own sign-in and its own OAuth 2.1 server for agents
description: Email links, Google sign-in and sessions are built in, agents connect only through WhatBuild's own OAuth server, and there are no personal access tokens.
tags: [decision, identity, oauth, mcp, security]
generated: {by: agent:claude, at: 2026-09-28T00:00:00Z}
status: stable
---

# WhatBuild runs its own sign-in and its own OAuth 2.1 server for agents

## Context

MCP clients expect OAuth discovery and dynamic registration against the server they connect to, so pasting one address is enough to connect. People should not need passwords. The maintainer removed personal access tokens on 2026-09-28: every agent connection should be one a person approved in a browser, can see, and can disconnect.

## Decision

- Sign-in by single-use email link or Google (OpenID Connect); a development-only sign-in exists outside production. No passwords.
- Web sessions use an `HttpOnly` cookie. REST answers that session only and refuses any bearer token.
- No personal access tokens. Scripts and clients that cannot sign in in a browser are not supported; an agent connects over MCP.
- For MCP, WhatBuild is its own OAuth 2.1 authorization server: discovery metadata, dynamic client registration, PKCE, one-hour access tokens, rotating refresh tokens (reuse revokes the connection).
- A token is the person: it carries exactly that person's roles.

## Consequences

- Agents act as their person, so authorship is also declared ([decision](attribution-and-declared-authorship.md)).
- The Connect an agent page needs only the MCP address, and lists every connected agent.
- An agent without MCP authorization support cannot connect.

## Constrains

- Identity code lives in `apps/server/src/auth/`.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md).
