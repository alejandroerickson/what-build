---
type: Decision
title: Feedback names nobody and reaches the people who run WhatBuild in a daily digest
description: People and their agents send feedback that keeps its words, kind and release but not who sent it, at most ten a UTC day each, and the deployment mails it once a day to an address it names.
tags: [decision, feedback, privacy, mail, mcp, agents]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Feedback names nobody and reaches the people who run WhatBuild in a daily digest

## Context

Feedback was an agent's tool alone, stored with who sent it, and read only from the database. The
maintainer chose on 2026-10-14 to let people send it from the web app too, to say plainly what it
carries, to send nothing that identifies anyone, and to have it arrive by email rather than be
mined from the database, on every deployment that names an address, self-hosted ones included.
Only invited people use most deployments, so a CAPTCHA would cost more ease than it buys.

## Decision

- A report keeps its kind, its words, the release, the door (web app or agent), an agent's family
  (never the name its client registered) or the screen a person was on, and the person's address
  only when they tick the box to share it. Agents cannot share an address.
- One person, with their agents, sends at most 10 a day, and a deployment takes at most 200; a
  separate count enforces the first and never says which reports are whose. No CAPTCHA. A day is
  the UTC day, wherever the sender is, so the refusal (`429 rate_limited`) gives in its message the
  moment the next one begins, midnight UTC, rather than saying "tomorrow".
- `WHATBUILD_FEEDBACK_EMAIL` names the address. The worker sends what is unsent in one plain-text
  digest, at most once every 24 hours and only when there is something new, and marks each report
  sent. Without the setting, or without mail, feedback stays in the database. Submitting is
  offered everywhere.
- Each agent connection carries a feedback switch, on unless the person turns it off under Connect
  an agent; off, `submit_feedback` is not listed and is refused (`403 feedback_off`), and the
  server's instructions say why.
- Rejected: an immediate message per report, which a burst turns into a flood; a CAPTCHA or a
  per-report confirmation, which make feedback a chore; a feedback question on the OAuth consent
  page, since agents already sent feedback, a person consents by sending it, and the switch lets
  them stop an agent's.

## Consequences

- A maintainer cannot ask who sent a report unless its sender shared an address.
- A sleeping Cloud Run service sends the digest when it next wakes.

## Constrains

- Limits and the digest live in `packages/core/src/feedback.ts`; `submit_feedback` in
  `packages/core/src/ops/meta.ts`; the switch on `oauth_tokens.feedback`, applied in
  `apps/server/src/mcp.ts`.

Specified in: [§4.13](../spec/04-data-model.md#413-feedback), [§6.9](../spec/06-operations-and-adapters.md#69-feedback),
[mail](../operations/mail.md).
