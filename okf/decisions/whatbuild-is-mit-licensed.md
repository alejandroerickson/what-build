---
type: Decision
title: WhatBuild is MIT-licensed, all of it, and stays so
description: The whole repository is under the MIT licence, so anyone may run, change and build on any copy, open or closed; nothing is held back in another edition, and copyleft was weighed and declined.
tags: [decision, licence, open-source, contributing, self-hosting]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# WhatBuild is MIT-licensed, all of it, and stays so

## Context

The repository has been under the MIT licence since its first commit, and every release was
published under it. Before inviting the public to use and contribute to it, the licence was
looked at again: a copyleft licence such as the AGPL would oblige anyone who serves a changed
copy over a network to publish their changes. Self-hosting is a first-class way to run
WhatBuild ([§2.7](../spec/02-architecture.md#27-self-hosting)), on the same image and guides as
the hosted service. The maintainer chose on 2026-10-26 that WhatBuild stays MIT.

## Decision

- **Everything in the repository is MIT-licensed** ([`LICENSE`](../../LICENSE)): the server, the
  web app, the parsers, the agent skill, the deployment scripts and this bundle. There is one
  codebase; no feature is kept for a closed or paid edition.
- **Anyone may run, change, sell or embed a copy, open or closed**, and keep their changes to
  themselves. The only condition is the MIT licence's: keep the copyright notice and the licence
  with the copy.
- **A contribution is made under the same licence.** There is no separate contributor agreement.
- **Files that carry a licence of their own keep it**: the typefaces in
  `packages/core/src/story-fonts/` and the app's Inter, under the SIL Open Font License, listed
  in that folder's [README](../../packages/core/src/story-fonts/README.md).
- Rejected: the AGPL. Its conditions on changed copies are what a permissive licence leaves
  out: everyone, closed copies included, gets all of WhatBuild on the same terms.

## Consequences

- An organization can host and adapt WhatBuild without a licence review beyond the notice.
- A changed copy may stay closed; improvements reach this repository only when someone chooses
  to contribute them.

## Constrains

- A dependency the image or the web app ships is under a permissive licence (MIT, ISC, BSD,
  Apache-2.0, 0BSD, the Open Font License for typefaces, or one as free). One under a copyleft
  licence (GPL, AGPL, or the like) needs this decision revisited first.
  `corepack pnpm licenses list --prod` lists them.

Specified in: [§2.7 Self-hosting](../spec/02-architecture.md#27-self-hosting),
[contributing](../../.github/CONTRIBUTING.md).
