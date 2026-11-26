---
type: Decision
title: The bot check is Cloudflare Turnstile, on the forms that mail someone or make an account, and a deployment may leave it off
description: A deployment with Turnstile's two keys asks for its token on asking for a sign-in link, starting Google or Microsoft sign-in, and joining the waitlist; the server checks each with Cloudflare, takes each token once, fails closed, and mails when it refuses everyone; without the keys nothing asks.
tags: [decision, security, sign-in, cloudflare, abuse]
generated: {by: agent:claude, at: 2026-11-25}
status: stable
---

# The bot check is Cloudflare Turnstile, on the forms that mail someone or make an account, and a deployment may leave it off

## Context

Before sign-up opens, a script must not be able to use WhatBuild to mail strangers (sign-in links,
the waitlist's later mails) or to make accounts in bulk. Limits per client address and ceilings for
the deployment bound how much gets through
([decision](abuse-limits-count-a-client-address-only-where-the-edge-key-vouches-for-it.md)), but a
script with many addresses still reaches the ceilings, and then everyone meets them. A check that a
person is at the browser stops most scripts before they count at all. The forms concerned are sent
by people who are not signed in, in a browser. Some deployments run behind no Cloudflare (on
Azure, locally), and must keep working as before.

## Decision

- **Cloudflare Turnstile**, in managed mode with the widget drawn only when it needs the person
  (`appearance: interaction-only`). It is free, and the deployments
  behind Cloudflare already trust it with their traffic.
- **On the forms that mail someone or make an account, and that anyone can send:** asking for a
  sign-in link (`POST /auth/email`), starting Google or Microsoft sign-in (`GET /auth/google`,
  `/auth/microsoft`), and joining the waitlist (`POST /api/v1/interest`). Signing in again before
  deleting an account meets it too, since it uses the same requests.
- **Not on what signed-in people and their agents do.** Invitations, feedback and agent
  registration come through MCP as well as the web app, and no agent can solve a check meant for a
  person; they have limits only.
- **The server asks Cloudflare** (siteverify) for every token, before any limit is counted, and
  takes it only when it succeeded, was made for that form's action, on the app's or the public
  site's host, and was not used before. Cloudflare redeems a token once only as its network catches
  up, so checks sent together could all pass; the server keeps a hash of each token it took for as
  long as a token is good (five minutes) and refuses it a second time. It refuses while Cloudflare
  cannot be asked: a form that waits is better than one a script walks through.
- **A refusal says why, and one that refuses everyone is mailed.** Each refused check is logged
  with its reason and Cloudflare's error codes, never the token. Cloudflare out of reach, a good
  token made for another host or form, a secret key Cloudflare refuses, or every token of an hour
  refused and none passed, mean nobody new can sign in: those are logged as errors, once an hour
  on each instance, which the log's alert mails.
- **Each deployment chooses.** With `WHATBUILD_TURNSTILE_SITE_KEY` and
  `WHATBUILD_TURNSTILE_SECRET_KEY` (both, or neither) the check is on; without them nothing asks,
  no page loads Cloudflare's script, and the pages' Content-Security-Policy does not name it.
  Production refuses Cloudflare's test keys, which pass or fail everything; tests and the abuse
  test use them.
- Rejected: a check of our own (a puzzle, a proof of work), which a script solves as easily as a
  person and which needs upkeep; hCaptcha and reCAPTCHA, which add a third party the Cloudflare
  deployments do not otherwise have.

## Consequences

- A person whose browser cannot reach `challenges.cloudflare.com` (a blocker, a filtering network),
  or while siteverify is down, cannot ask for a sign-in link or start Google or Microsoft sign-in
  there. Someone already signed in is not affected.
- The pages that carry the widget allow `https://challenges.cloudflare.com` in `script-src` and
  `frame-src`; the widget works under the app's `Cross-Origin-Embedder-Policy: credentialless`.
- Turning it on takes an order: the Worker that serves the site's pages first (its policy lets the
  widget in), then the keys on the service. The site's pages learn of it from the service's
  catalogue, which the Worker caches for an hour.
- On Cloud Run the secret key goes to the service only, never the migration job, which has no site
  key: the server refuses to start with half of the pair.
- A deployment's privacy notice names Cloudflare as a provider when the check is on.

## Constrains

- A new form that anyone can send without signing in, and that mails someone or makes an account,
  takes the bot check too.

Specified in: [§3.2](../spec/03-accounts-and-identity.md#32-accounts-and-sign-in),
[§9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas), [security](../system/security.md),
[Cloud Run](../operations/cloud-run.md#the-bot-check).
