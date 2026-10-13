---
type: Decision
title: WhatBuild runs its own sign-in and its own OAuth 2.1 server for agents
description: Email links, Google and Microsoft sign-in and sessions are built in, agents connect only through WhatBuild's own OAuth server, and there are no personal access tokens.
tags: [decision, identity, oauth, mcp, security]
generated: {by: agent:claude, at: 2026-10-12}
status: stable
---

# WhatBuild runs its own sign-in and its own OAuth 2.1 server for agents

## Context

MCP clients expect OAuth discovery and dynamic registration against the server they connect to, so pasting one address is enough to connect. People should not need passwords. The maintainer removed personal access tokens on 2026-09-28: every agent connection should be one a person approved in a browser, can see, and can disconnect.

## Decision

- Sign-in by single-use email link, Google, or Microsoft work accounts in one configured directory (both OpenID Connect); a development-only sign-in exists only when `NODE_ENV` says `development` or `test`. No passwords.
- An email link opens a page and signs in only by that page's same-origin POST, because mail scanners open links and a GET that signs in lets another site choose whom a person is signed in as. The maintainer chose this over a link that signs in on opening on 2026-10-10.
- Microsoft sign-in takes an address only with evidence for its domain (Entra's `xms_edov`, or a domain the deployment lists), never on the directory's word alone, since a directory's administrators can set any address on its people.
- Web sessions use an `HttpOnly` cookie, `__Host-wb_session` over HTTPS so that no other host under the parent domain can set it. REST answers that session only and refuses any bearer token.
- No personal access tokens. Scripts and clients that cannot sign in in a browser are not supported; an agent connects over MCP.
- For MCP, WhatBuild is its own OAuth 2.1 authorization server: discovery metadata, dynamic client registration, PKCE, one-hour access tokens, rotating refresh tokens (reusing a refresh token or an authorization code revokes the connection), and an Allow that approves only what its consent page showed.
- A token is the person, at most: it carries that person's roles, capped by the level they chose for the connection ([decision](an-agent-connection-has-a-level-the-person-chooses.md)), and limited to the MCP endpoint it was approved for when that endpoint is scoped to an organization or a product ([decision](a-scoped-mcp-connector-is-a-fence.md)).

## Consequences

- Agents act as their person, so authorship is also declared ([decision](attribution-and-declared-authorship.md)).
- The Connect an agent page needs only the MCP address, and lists every connected agent.
- An agent without MCP authorization support cannot connect.

## Constrains

- Identity code lives in `apps/server/src/auth/`.

Specified in: [03-accounts-teams-and-identity](../spec/03-accounts-teams-and-identity.md).
