---
name: run-the-instance
description: Run a WhatBuild deployment as an owner of it (an instance owner) - define or change its plans, their limits and prices, or offer none; move an organization to another plan; let people start organizations (allowances and the waitlist); set how guests come into the example organization; and guide deleting an organization or removing an account. Use when asked about plans, pricing, prices, limits, Free or Pro, a paid plan, the plan new organizations start on, a read-only organization, upgrading or downgrading an organization, the waitlist, guests, who can start organizations, an allowance, deleting someone's organization, or removing a person; and when setting up a deployment that sells plans or a self-hosted one that offers none.
---

# Run the instance

You are doing what an owner of a WhatBuild deployment does to its plans, organizations and people.
The rules are in `okf/decisions/the-deployment-defines-its-plans-and-billing-stays-outside-the-repository.md`,
`okf/decisions/limits-belong-to-plans-and-each-organization-is-on-a-plan-of-its-own.md`,
`okf/decisions/guests-come-into-the-example-organization-while-there-is-room.md` and
`okf/decisions/instance-owners-see-every-account-and-remove-any-but-their-own.md`; the plans file and
every limit in spec §9.7; setting plans on Cloud Run in `okf/operations/cloud-run.md` (the paragraph
**Plans, and the plan of a new organization**). Read the parts the task needs before the first
command. This file says how to do the work.

## What must stay true

- **A deployment's plans and prices are its own, never the repository's.** Its plans file lives with
  its other values: for the maintainer's Cloud Run deployment, its path is `PLANS_FILE` in `.env`
  at the root of their clone, beside `GCP_PROJECT`. Read `.env`; never ask the maintainer where
  the file is, and never copy it, its prices or its limits into the repository, a commit, a pull
  request or an issue. `deploy/plans.example.json` is only the form, and what local development,
  the tests and the end-to-end instance use.
- **A self-hosted deployment offers no plans.** It sets neither `WHATBUILD_PLANS` nor
  `WHATBUILD_NEW_ORGANIZATION_PLAN`: every organization is unlimited and the app says nothing of
  plans or billing.
- **The starting plan must be one the file defines**, or the server does not start. Set both
  together, and check the file before it reaches a deployment.
- **WhatBuild takes no payment.** An organization moves to a paid plan when an instance owner moves
  it, by hand or through a billing service of the deployment's own that calls `products.set_plan`.
  Never add a payment provider's code to the repository.
- **Production changes only when the person says so.** Storing a new plans file and making a new
  revision change what every organization meets from its next call; say so before you do it.
- **Deleting an organization and removing an account are a person's acts in the web app.** You are
  never offered them. Tell the person where they are and what the dialog will show.

## What you can do, and where

Through the instance owner's own unscoped MCP connection (`/mcp`), or the web app on `/instance`:

| To | MCP | Web |
|---|---|---|
| see every organization, its plan, what it holds, and the plans | `products_read(action="organizations")` | Organizations |
| move an organization to another plan | `products_write(action="set_plan")` | Change plan |
| change a plan's limits or price, for every organization on it | `products_write(action="set_plan_limits")` | Plans, Edit |
| see who may start organizations, and the waitlist | `products_read(action="tenant_allowances")` | Who can start organizations, Waitlist |
| let someone start an organization | `products_write(action="set_tenant_allowance")` (allowed 1, notify) | Let them start one |
| see and set how guests come in | `products_read(action="guests")`, `products_write(action="set_guests")` | Guests |
| see every account | `products_read(action="accounts")` | People |
| delete an organization | none | Organizations, Delete |
| remove an account | none | People, Remove |

## Procedure

1. **Find the deployment and its values.** For the maintainer's, read `.env` (`GCP_PROJECT`,
   `GCP_REGION`, `PLANS_FILE`); for the dev deployment, `GCP_DEV_PROJECT`; for an Azure
   self-hosted one, `.env.azure`. Read what the deployment offers now: `GET <public URL>/api/v1/plans`
   (its `plans`, `starting_plan` and whether it has an example organization).
2. **Define or change the plans** (only when the deployment sells plans):
   - Edit the deployment's plans file in the form of `deploy/plans.example.json`: every plan's id,
     name, what it is for, every limit (sizes as bytes or "10 MB"), and its price or null.
   - Check it: `corepack pnpm plans <file> <starting plan id>`. It prints each plan as the server
     will read it, or what is wrong.
   - Store it and make a new revision, with the commands in `cloud-run.md`; the first time, or with
     a new starting plan, set `WHATBUILD_NEW_ORGANIZATION_PLAN` in the same command. A plan removed
     from the file leaves its organizations meeting no limit until they are moved: move them first.
   - The dev deployment takes production's plans when it is set up or refreshed
     (`rehearse-on-the-dev-deployment`).
3. **Change limits or a price without a new revision**: `set_plan_limits`, or Plans, Edit, on
   `/instance`. It applies to every organization on the plan from its next call, over what the file
   sets; reset goes back to the file.
4. **Move an organization**: read `organizations` first. If it is marked `starting_plan_is_read_only`,
   moving it to the starting plan makes it read-only for a year rather than writable; tell the person
   before you move it. Moving it to any other plan, or to the starting plan once its creator has no other there,
   makes a read-only one writable again. Everyone has a place for one organization there, even
   someone never given an allowance.
5. **Let people in**: read the waitlist in `tenant_allowances`, and give whoever the person names
   an allowance of 1 with notify on. Being on the waitlist lets nobody in by itself.
6. **Guests**: only with an example organization. `set_guests` with the etag from `guests`; raise the
   numbers as the deployment grows, and leave `self_serve` off unless the person asks.
7. **Deleting or removing**: tell the person to open Organizations and press Delete on the
   organization (its name typed to confirm), or People and Remove on the person (their address
   typed). Removing the only owner of organizations deletes those too; the dialog lists them and what
   each holds.
8. **Check and report**: read `organizations` (or `/api/v1/plans`) again and report what changed:
   the plans and starting plan, each organization moved, each allowance given, the revision made.

## When the guide is wrong

If a command fails because `okf/operations/cloud-run.md` or spec §9.7 is out of date, correct it with
the `okf-update` skill. A change to the rules themselves (who may do what, what a plan may hold, how
billing reaches WhatBuild) revises one of the decisions above, with the `okf-decision` skill. Never
record the deployment's own plans, prices or the session in the repository.
