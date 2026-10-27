---
type: Decision
title: The deployment defines its plans, and billing stays outside the repository
description: The code enforces plans but defines none; each deployment names its plans, their limits and prices in its own configuration, a self-hosted one offers none and sees nothing of them, and payment is a separate service that moves organizations between plans.
tags: [decision, plans, billing, deployment, self-hosting, configuration]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# The deployment defines its plans, and billing stays outside the repository

## Context

Limits belong to plans ([decision](limits-belong-to-plans-and-each-organization-is-on-a-plan-of-its-own.md)),
and the first plans, Free and Pro, were written into the code with their limits and descriptions.
But which plans a deployment sells, what they allow and what they cost is that deployment's
business, not the software's; the repository is public and serves self-hosted deployments, which
sell nothing and should not see plans or billing; and taking payment, with a payment provider's
pages and webhooks, is coming. The maintainer chose on 2026-10-26 that the repository holds the
machinery and each deployment its plans, and that payment lives elsewhere.

## Decision

- **The code holds the machinery**: an organization is on a plan; a plan is a set of limits, every
  one of them enforced; an instance owner moves an organization between plans and changes a plan's
  limits and price on `/instance`; the rules that follow from plans (one organization each on the
  starting plan, the read-only year). It defines no plan but `unlimited`, which sets no limit.
- **The deployment defines its plans** in `WHATBUILD_PLANS`: each one's id, name, what it is for,
  every limit and its price, as JSON or a JSON file; anything wrong stops the server from starting.
  `deploy/plans.example.json` is an example, which local development, the tests and the end-to-end
  instance use. What an instance owner sets on `/instance` is stored with the deployment, over it.
- **A deployment that defines no plans offers none**: every organization is unlimited, and the app
  shows no plan, price or billing wording anywhere. That is a self-hosted deployment's default.
- **No price, and nothing true of one deployment's plans, is written in the repository.**
- **Billing is a separate service**, kept with the deployment that sells plans. It takes payment
  and moves an organization between plans through `products.set_plan`, as an instance owner does.
  The repository holds no payment provider's code.
- Rejected: plans in the code with prices set per deployment (it still ships one seller's plans to
  every deployment), and billing inside the app (it ties the open code to one provider and one
  deployment's terms).

## Consequences

- Each deployment can name, add and change plans without a release; changing them is a restart.
- A self-hosted deployment upgrades without meeting plans at all.
- A deployment that sells plans keeps a file the repository never sees, and has to pass it at start.
- Billing needs a way in for a service rather than a person, and somewhere for the app's upgrade
  button to point; both are on the roadmap.

## Constrains

- `packages/core/src/plans.ts` names no plan but `unlimited`; plans come from `configurePlans`,
  called once at start-up from `WHATBUILD_PLANS` (`apps/server/src/plans-config.ts`).
- A plan's id is stored as given (`tenants.plan`, checked only for its form); an organization on a
  plan the deployment no longer defines meets no limit until it moves.
- The web app shows plans only when `GET /api/v1/plans` lists some, and billing words only when
  one of them has a price.

Specified in: [§3.3](../spec/03-accounts-teams-and-identity.md#33-tenants-and-teams), [§9.7](../spec/09-data-lifecycle.md#97-plans-and-limits), [§10](../spec/10-roadmap.md).
