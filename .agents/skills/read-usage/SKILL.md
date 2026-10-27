---
name: read-usage
description: Find out how a WhatBuild deployment is used and say what it means. Gathers the server's own counts (every operation, through the web app and agents, and people coming back), Google Analytics (screens, actions, search, sources) and Cloudflare Web Analytics (visits to the public site). Use when asked what people use, which features are used or ignored, whether people come back, how agents use WhatBuild, where errors happen, how the site is doing, for analytics, usage, engagement, retention or insights, or to connect a deployment to its analytics.
---

# Read usage

You are finding out how a deployment of WhatBuild is used, and telling the person what it means.
Everything the deployment counts, where it comes from, and every setting is in
`okf/operations/analytics.md`. Read it before the first command. This file says how to do the
work.

## What must stay true

- **Aggregates only.** The server counts people under a pseudonym so that nobody is named. Never
  try to work out who a pseudonym is, never join `usage_people` to `accounts`, and never ask
  Google Analytics or Cloudflare for anything about one person.
- **Production's numbers stay out of the repository.** You may tell the person what you found. Never
  put a deployment's numbers, or anything they show about its users, into a commit, an issue, a pull
  request or `okf/`. Describe them in general terms there, such as "few people use mockups".
- **Read, never write.** The report reads. Changing what is measured, or a setting in Google
  Analytics or Cloudflare, is a change to the code or the guide, made only when the person asks.
- **The owners are left out.** The report leaves out the instance's owners unless the person asks
  for them (`--include-owners`), and the app sends Google Analytics nothing for owners.

## Procedure

1. **Gather.** From the root of the checkout, run `corepack pnpm usage` (28 days; `--days N`,
   `--example exclude|only`, `--json` for the full data). It reads the settings from `.env`. Nothing
   replaces it over MCP: no agent is offered `products_read(action="usage")`, an instance owner's
   included.
2. **Note what is missing.** A source without its settings is skipped and says what it needs. Tell
   the person, and offer to set it up with the guide's steps. Do not set anything up unasked.
3. **Read it.** Work through these, and keep each claim tied to a number:
   - **People:** how many are active, through the web app and through agents, new and returning,
     and how many came back on more than one day. With very few people, say so and give counts
     rather than percentages.
   - **Coming back:** the weeks, and each cohort's `weeks_after`: of the people first seen in a
     week, how many returned in each week after. `counting_since` says when counting began: everyone
     seen before then shows as new.
   - **Features:** compare by people, not calls. The web app makes many reads of its own, and the
     search box searches as a person types.
   - **Agents:** which clients, and which operations agents use that the web app does not.
   - **Failures:** the operations and error codes at the top. Many `invalid_input` errors on one
     operation from agents point at its description or the guide. `unknown_action` errors point at
     a client holding an old tool list, or an action agents expect that does not exist.
   - **Not called:** the operations nobody used in the period.
   - **Google Analytics** (only people who accepted analytics): screens, actions (named by
     operation), search (`search_open`, `search_result_open` by kind and rank, `search_close` with
     `found`), where visitors came from, and new and returning visitors.
   - **Cloudflare** (every visit to the public site): visits, referrers and countries.
4. **Report** to the person:
   - the period and the sources you read, and the ones you could not read;
   - a short summary with the main numbers;
   - three to five findings, each with its evidence and a suggested next step;
   - caveats: small numbers, the owners left out, and that Google Analytics sees only people who
     accept it.

## Connecting a deployment to analytics

The server's counts need nothing: every deployment keeps them from the release that adds them.
Google Analytics and Cloudflare Web Analytics are optional, and each has a section in the guide:
the measurement ID to set on the service and the Worker, the stream settings to keep, the custom
dimensions for search, and the service account or token an agent reads them with. A self-hosted
deployment keeps its own values in its own `.env` or vault, never in the repository.

## When the guide is wrong

If a command fails because the guide is out of date, correct `okf/operations/analytics.md` with
the `okf-update` skill. Do not record the session itself in the repository.
