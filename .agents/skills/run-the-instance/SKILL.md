---
name: run-the-instance
description: Run a WhatBuild deployment as an owner of it (an instance owner) - define or change its plans, their limits and prices, or offer none; and guide the person through the web app, where they move an organization to another plan, let people start organizations (allowances and the waitlist), set how guests come into the example organization, delete an organization or remove an account. Use when asked about plans, pricing, prices, limits, Free or Pro, a paid plan, the plan new organizations start on, a read-only organization, upgrading or downgrading an organization, the waitlist, guests, who can start organizations, an allowance, deleting someone's organization, or removing a person; and when setting up a deployment that sells plans or a self-hosted one that offers none.
---

# Run the instance

You are doing what an owner of a WhatBuild deployment does to its plans, organizations and people.
The rules are in `okf/decisions/the-deployment-defines-its-plans-and-billing-stays-outside-the-repository.md`,
`okf/decisions/limits-belong-to-plans-and-each-organization-is-on-a-plan-of-its-own.md`,
`okf/decisions/guests-come-into-the-example-organization-while-there-is-room.md`,
`okf/decisions/instance-owners-see-every-account-and-remove-any-but-their-own.md` and
`okf/decisions/running-the-instance-is-done-in-the-web-app-never-by-an-agent.md`; the plans file and
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
  it, by hand or through a billing service of the deployment's own that calls `products.set_plan`
  over REST.
  Never add a payment provider's code to the repository.
- **Production changes only when the person says so.** Storing a new plans file and making a new
  revision change what every organization meets from its next call; say so before you do it.
- **Running the instance is a person's work in the web app.** No MCP connection is offered any of
  it, the instance owner's own included, and a call to one is refused `403 web_only` with where it
  is, and your connection renames only the organizations the person owns. Moving organizations,
  renaming one they are not in, plans' limits, guests, allowances, accounts, deleting an
  organization and removing an account are all done there: tell the person where each is and what its dialog
  will show. What is yours is the deployment's configuration (its plans file and settings), with
  the person's go-ahead.

## Where each is done

In the web app, by the instance owner, signed in. Organizations is `/instance` and People is
`/people`, both in the account menu:

| To | Where, in the web app |
|---|---|
| see every organization, its plan, what it holds, and the plans | Organizations |
| move an organization to another plan | Organizations, Change plan on its row |
| rename an organization, or change its short name in links | Organizations, Rename on its row |
| change a plan's limits or price, for every organization on it | Organizations, Plans, the plan's button |
| see who may start organizations, and the waitlist | Organizations, Who can start organizations, Waitlist |
| let someone start an organization | Organizations, Let them start one on the Waitlist, or Let someone start organizations |
| see and set how guests come in | Organizations, Guests |
| see every account | People |
| delete an organization | Organizations, Delete on its row |
| remove an account | People, Remove on the account |

## Procedure

1. **Find the deployment and its values.** For the maintainer's, read `.env` (`GCP_PROJECT`,
   `GCP_REGION`, `PLANS_FILE`); for the dev deployment, `GCP_DEV_PROJECT`; for an Azure
   self-hosted one, `.env.azure`. Read what the deployment offers now: `GET <public URL>/api/v1/plans`
   (its `plans`, `starting_plan` and whether it has an example organization), which needs no
   sign-in.
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
3. **Change limits or a price without a new revision**: the person opens Plans on Organizations
   and the plan's button. It applies to every organization on the plan from its next call, over
   what the file sets; Back to the configured limits goes back to the file.
4. **Move an organization**: the person presses Change plan on its row. Moving it to the starting
   plan while its creator already has an organization there makes it read-only for a year rather
   than writable; the dialog says so, and say it before they choose. Moving it to any other plan,
   or to the starting plan once its creator has no other there, makes a read-only one writable
   again. Everyone has a place for one organization there, even someone never given an allowance.
5. **Let people in**: the person reads the Waitlist on Organizations and presses Let them start one
   for whoever they choose, which gives an allowance of 1 and emails them. Being on the waitlist
   lets nobody in by itself.
6. **Guests**: only with an example organization. The person changes them under Guests on
   Organizations; suggest raising the numbers as the deployment grows, and leaving anyone may sign
   up as a guest (`self_serve`) off unless they ask.
7. **Deleting or removing**: tell the person to open Organizations and press Delete on the
   organization (its name typed to confirm), or People and Remove on the person (their address
   typed). Removing the only owner of organizations deletes those too; the dialog lists them and what
   each holds.
8. **Check and report**: read `/api/v1/plans` again and report what changed: the plans and starting
   plan, and the revision made, with what you told the person to do in the web app and what they
   said Organizations shows now.

## When the guide is wrong

If a command fails because `okf/operations/cloud-run.md` or spec §9.7 is out of date, correct it with
the `okf-update` skill. A change to the rules themselves (who may do what, what a plan may hold, how
billing reaches WhatBuild) revises one of the decisions above, with the `okf-decision` skill. Never
record the deployment's own plans, prices or the session in the repository.
