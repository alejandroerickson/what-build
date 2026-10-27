---
type: System Concept
title: The non-production dataset is one pull-shaped copy that every copy outside production can start from, the instance owners' organizations pulled from production beside synthetic organizations of a size and shape chosen for testing
description: What pnpm dataset builds and how (a pull of the example organization, Harbor Labs, and the organizations of pnpm people with members, pending invitations, a waitlist, allowances, products and sources within each plan), what it records, its schema, and how the local copy, the golden master, the Docker host and the dev deployment each load it.
tags: [operations, testing, fixture, dev, e2e, golden-master, synthetic, privacy]
generated: {by: agent:claude, at: 2026-10-27}
status: draft
---

# The non-production dataset

Every copy outside production holds only organizations an instance owner owns, beside synthetic
ones ([decision](../decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md)).
The example organization shows real work at its real size, but one organization is one shape: a
few members, a handful of products. `pnpm dataset` builds one dataset with both parts, which
every copy can start from: the [local copy](a-copy-of-production.md), the
[golden master](end-to-end-tests.md), the [Docker host](end-to-end-on-a-docker-host.md) serving
it, and the [dev deployment](dev-deployment.md).

```sh
corepack pnpm dataset                        # pull the example organization afresh, then build
corepack pnpm dataset --org <slug> …         # other organizations an instance owner owns
corepack pnpm dataset --from <pull>          # from a pull already taken
  --people <n>                               # how many synthetic people (100)
  --production-schema                        # refuse to migrate the pull (for the dev deployment)
```

Without `--from` it pulls first, as `pnpm fixture pull` does and with its options (`--org`,
`--all`, `--no-files`; [copying an organization](copying-an-organization.md#taking-one)), so it
refuses any organization an instance owner does not own. It never takes `--for-another-deployment`
or `--files-into`. It reads production only through that pull, and changes nothing there.

## What it holds

| Part | What | Made by |
|---|---|---|
| The pulled organizations | the example organization, or those named, as the pull took them | the pull |
| Harbor Labs (`harbor-labs`) | the development sample, Crewboard, made by Morgan, Casey and Avery, who belong to it alone; Sam reads its Story | `seed.ts`, as the golden master makes it |
| The organizations of `pnpm people` | for 100 people, 8 organizations, one big, a few middling, the rest small, each on the smallest of the example file's plans that holds its people: owners, admins, members, people in two or three, pending invitations, people who signed in to no organization, allowances not yet used, and a waitlist ([local development](local-development.md#many-people)) | `people.ts`, through the instance's own routes |
| Their products and sources | the biggest organization 6 products of 24 sources, then fewer down the ranks, never past the plan's products and sources (a Free organization has one product); two outcomes a product; sources of four kinds in turn (an interview in Markdown, a call in WebVTT, a survey in CSV, support tickets in plain text), each one attachment, every third with a summary, and the last of a product of eight or more archived; tagged `synthetic` | `dataset.ts`, through the operations, by each organization's owners and admins and their agents |

All of the synthetic part is made through the operations, as its people and their agents would
make it, so attribution, activity, the search index and each attachment's reading are what a
deployment would have. The plans' limits on how often and how much are lifted while it is built,
since it makes in a minute what people make over weeks; what each plan holds in total is kept. Its
text is invented and its addresses are at `example.com` or a `.example` domain. With 100 people it
holds about 230 synthetic sources and builds in about a minute.

What only a running deployment keeps stays out, as it does from a pull: the sessions and
connections the synthetic people's sign-ins made, the guests' places, usage counts. The waitlist
and the allowances given to the synthetic people stay, since they are part of the shape.

## How it is built, and its schema

The pull is restored into a scratch database of the embedded Postgres (`pnpm dev`'s, in
`.what-build/pg`), migrated to this code's schema with the jobs its migrations queue done, and
served on this machine's loopback by an instance of this code that only the build calls. Harbor
Labs and the synthetic organizations are added, the scratch database is dumped and dropped.

A dataset is at the schema of the code that built it. A copy that must start at production's
schema, the dev deployment's above all, where a rehearsal runs a release's migrations, takes a
dataset built with `--production-schema`, which refuses to migrate: build it from a checkout of
the release production runs when `main` has migrations production lacks.

## What it is

A dataset is a pull: a folder in `.what-build/fixtures/` (or `WHATBUILD_FIXTURE_DIR`) named
`<UTC time>-dataset`, beside the pull it was built from, with `database.dump`, `files/` and
`pulled.json`. `pulled.json` is the pull's record (`pulled_at`, when production was read, and the
pulled organizations), with the rows of every table of the dump, `owned_by_instance_owners`, and
`dataset`: when it was built, from which pull, at which commit and migration, with how many
people, and the synthetic organizations. `pnpm fixture list` says which pulls are datasets. It is
a copy of production with every rule of [a copy of production](a-copy-of-production.md#what-may-be-done-with-it).

## Where it goes

| To | How |
|---|---|
| this machine, to test on | `pnpm fixture load <name>` (the newest pull is the dataset, when it was built last), then `pnpm dev:fixture` ([a copy of production](a-copy-of-production.md)); the development sign-in's people are given their roles in every organization, the synthetic ones too, and any synthetic person signs in with **As the email above** |
| the golden master | `pnpm e2e golden <name>` ([end-to-end tests](end-to-end-tests.md)): the example organization, its standard copy, and every synthetic organization, whose people are their own |
| the Docker host | the golden master built from it, exported and loaded as [the end-to-end instance on a Docker host](end-to-end-on-a-docker-host.md) says |
| the dev deployment | [refreshing the copy](dev-deployment.md#refreshing-the-copy), with a dataset built with `--production-schema` |

Delete a dataset you no longer need, as a pull: `rm -r .what-build/fixtures/<name>`.
