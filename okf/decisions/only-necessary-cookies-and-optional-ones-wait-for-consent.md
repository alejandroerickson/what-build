---
type: Decision
title: WhatBuild stores only what it needs, says so once, and keeps anything optional off until a person agrees
description: Only strictly necessary cookies and the person's own display choices, so a notice replaces a consent prompt; anything optional added later is opt-in.
tags: [decision, privacy, cookies, web, compliance]
generated: {by: agent:claude, at: 2026-10-01}
status: deprecated
---

# WhatBuild stores only what it needs, says so once, and keeps anything optional off until a person agrees

Superseded on 2026-10-01 by [WhatBuild asks once whether a person accepts cookies, and runs Google Analytics only for those who do](analytics-only-for-people-who-accept-cookies.md).

## Context

People in the EU and elsewhere are protected by rules on storing anything in their browser. Under
the ePrivacy rules and the GDPR, storage that is strictly needed for a service the person asked
for (a sign-in session, security checks, a preference they set) needs no consent. Anything else,
such as analytics or advertising, needs consent *before* it is set: on by default with an opt-out
is not consent. WhatBuild stores only the first kind. The maintainer chose on 2026-09-30 to tell
people plainly rather than show an Allow or Don't prompt that would control nothing.

## Decision

- The server sets only `wb_session`, `wb_oidc` and `wb_consent`; the web app keeps only display
  choices and notices read, under `whatbuild.*` in local storage. No third party sets or reads
  anything; fonts are self-hosted.
- Every screen shows a small notice once that blocks nothing and offers no choice, and
  `/cookies` lists every item with its purpose and lifetime.
- Rejected: an Allow or Don't banner. Its Don't could not turn off the session without breaking
  sign-in, and a choice with nothing behind it misleads.
- Anything optional added later stays off until the person agrees, with a choice as easy to
  refuse as to accept and a way to change it later. The notice becomes that choice then.

## Consequences

- No consent state to store or check today, and no prompt in anyone's way.
- `/cookies` is kept in step with the code by hand; a missed row makes it untrue.

## Constrains

- A new cookie (`apps/server/src/auth/**` or elsewhere) or `whatbuild.*` storage key adds a row to
  `apps/web/src/routes/cookies.tsx` in the same change.
- No analytics, tracking pixel, third-party script, font or embed loads before an explicit opt-in.

Specified in: [§9.1](../spec/09-data-lifecycle.md) and [§7.11](../spec/07-web-app.md).
