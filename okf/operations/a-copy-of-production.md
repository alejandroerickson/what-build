---
type: System Concept
title: A copy of production on your machine, for manual QA, agent-driven end-to-end tests and trying migrations on real data
description: Pulling the example organization or other organizations the deployment's instance owners own, with their files, loading them into the embedded Postgres, serving them with pending migrations applied, and keeping the copy private.
tags: [development, testing, qa, production, fixture, migrations]
generated: {by: agent:claude, at: 2026-10-27}
status: stable
---

# A copy of production

The synthetic sample product shows every feature, but it is small and tidy. A copy of the
production deployment has real volume and history: products agents built up over weeks, Story
pages, revisions, attachments read more than once, and rows in the shape older releases left them. Use it
for manual QA, for agent-driven end-to-end tests, and to watch a release's migrations run on real
data before production does ([decision](../decisions/qa-uses-a-private-copy-of-production.md)).
A copy holds the example organization, or other organizations an instance owner owns, and nothing
of the others: a customer's organization never leaves production
([decision](../decisions/copies-outside-production-hold-only-organizations-an-instance-owner-owns.md),
[copying an organization](copying-an-organization.md)). The skill `test-on-a-copy-of-production`
conducts it.

## What may be done with it

A copy is real people's data. Holding what a test needs on this machine is expected; publishing
any of it never is.

- **Pulling the example organization, or the instance owners' organizations a test needs, to this
  machine is routine.** It needs nobody's go-ahead: it is how WhatBuild is tested, and the skills
  do it without asking.
- **Only organizations an instance owner owns**: every owner of each is among the deployment's
  instance owners. The pull checks, and refuses any other, naming it and saying how many of its
  owners are not instance owners. A customer's organization is never pulled for a test, whoever
  names it.
- A copy lives in `.what-build/fixtures/` (each pull) and in the embedded Postgres in
  `.what-build/pg` (the loaded copy), which git ignores, on the maintainer's machine. It is never
  committed, uploaded, attached or copied anywhere else. The other copies outside production, the
  [golden master](end-to-end-tests.md), its [Docker host](end-to-end-on-a-docker-host.md) and the
  [dev deployment](dev-deployment.md), hold no more than this one may.
- Nothing from it is quoted in the repository, a commit message, an issue or a pull request: no
  names, addresses, organizations, titles or text. Tests, the seed and screenshots stay synthetic.
- Served, it sends no mail (mail prints to the terminal) and reads and writes only its local copy
  of the files, never the deployment's bucket.
- Delete a pull you no longer need with `rm -r .what-build/fixtures/<name>`. A pull taken before
  pulls checked who owns each organization is never loaded, and `pnpm attention` reports it until
  it is gone.

## What you need

- For the Cloud Run deployment: `gcloud` signed in with access to its project, and `GCP_PROJECT`
  and `GCP_REGION` in `.env` or the environment. A git worktree without a `.env` of its own reads
  the main checkout's.
- `pg_dump` and `pg_restore` of the production server's major version or newer.

## Pull

```sh
corepack pnpm fixture pull                     # the example organization
corepack pnpm fixture pull --org <slug> …      # the organizations named, each one an instance owner owns
corepack pnpm fixture pull --all               # every organization the instance owners own
corepack pnpm fixture list                     # the pulls, and what each holds
```

It reads who the instance owners are from the service (`WHATBUILD_INSTANCE_OWNERS`), checks that
an instance owner owns each organization it is to take, then reads their rows through the
read-only backup role (the secret `whatbuild-backup-database-url`; [Cloud Run](cloud-run.md),
under backups), which reads every organization's rows and can change nothing, and copies their
folders of the files bucket,
`gs://<project>-whatbuild-files`, with the type and hash the local file store keeps for each file.
The files matter: they are the sources' attachments and the text read from each, so without them
a source keeps its derived text, but no attachment opens and none can be read again. Pulling reads production and changes nothing there. What a copy holds and leaves behind,
and every option, are in [copying an organization](copying-an-organization.md).

Each pull is a new folder named for its UTC time, such as `.what-build/fixtures/2026-10-10T0411Z/`,
holding `database.dump`, `files/` and `pulled.json`, which names the organizations. `pulled.json`
is written last, so a pull that stopped part-way is never loaded. A git worktree without
`.what-build/fixtures` of its own writes its pulls to the main checkout's and reads them there, so
every checkout shares them and `pnpm attention` sees each one.

For another deployment, set `WHATBUILD_FIXTURE_DATABASE_URL` to a role that reads everything and
bypasses row-level security, as the backup role does, and `WHATBUILD_FIXTURE_INSTANCE_OWNERS` to
its `WHATBUILD_INSTANCE_OWNERS`. Set `WHATBUILD_FIXTURE_BUCKET` to its `gs://` bucket, or leave it
out for a copy without files. `WHATBUILD_FIXTURE_DIR` keeps pulls somewhere else, for example so
that several checkouts share them.

## Load

```sh
corepack pnpm fixture load                    # the newest pull
corepack pnpm fixture load 2026-10-10T0411Z   # a named one
```

It replaces the database `fixture` in the embedded Postgres with the dump, and says which
organizations it holds. It refuses a pull from before pulls checked who owns each organization,
and one taken to move into another deployment
([copying an organization](copying-an-organization.md#into-another-deployment)). That is the server
`pnpm dev` runs, and the load starts it if it is not running. The dump is restored as the
application's role, the way [Cloud Run](cloud-run.md) restores a backup. The load also replaces
`.what-build/fixture-blobs` with a working copy of the files. The synthetic database, `whatbuild`,
is untouched. A copy loaded into a cluster made before local clusters were UTF-8 is SQL_ASCII with
it, and its text functions count bytes: `pnpm dev:fixture` says so when it starts, and
[local development](local-development.md#the-local-postgres) says how to make the cluster again.

Load again whenever you want the copy back as it was pulled: after a test that changed data, or to
run a migration again. The load refuses while the copy is being served, so stop
`pnpm dev:fixture` first.

## Serve

```sh
corepack pnpm dev:fixture
```

This is `pnpm dev` on the copy, without sample data and on the same ports, so stop `pnpm dev`
first. It applies the migrations the copy does not have yet, as a release's migration job would,
and the worker runs the jobs they queue. The log has a `migrated …` line for each migration and
one line for each job.

After the migrations, it gives the development sign-in's three people a place in every
organization of the copy, with the roles they have in the sample:

- **Riley Chen** owns each organization.
- **Sam Okafor** is an editor on every team.
- **Jordan Ellis** reads every product's Story.

They are one click on the sign-in page, as with `pnpm dev`. It adds only what is missing, and
records nothing in the activity log.

To be someone in the copy instead, use **As the email above** with that account's address. It
starts a session without sending a link. A browser script can call `POST /auth/dev-sign-in` with
`{"email": …}` instead. Agents connect at `http://localhost:5273/mcp`.

To read the copy directly, `psql postgres://postgres:postgres@localhost:54329/fixture` connects as
the embedded server's superuser, which sees every organization's rows.

`scripts/e2e.mjs` and `scripts/shots.mjs` look for the sample product, Crewboard, which the copy
does not have, so they run on the synthetic data. The agent-driven
[end-to-end tests](end-to-end-tests.md) build their golden master from a pull with
`pnpm e2e golden`: the example organization and a copy of it that is not the example.

## Before a release that migrates

1. Pull a fresh copy and load it. The example organization's content shows most migrations; for
   one that rewrites content it lacks, name more of the instance owners' organizations, or pull
   `--all`; for shapes none of them has, try the migration on synthetic content made like it.
2. Serve it with the release's code.
3. Check three things:
   - every migration applies;
   - every job the migrations queue finishes without an error (the log names each job and its
     result);
   - the screens the release changed open on real data.
4. Load again to put the copy back as it was pulled.
5. Rehearse the deploy itself on the [dev deployment](dev-deployment.md): the same build, restore
   point and migration job as production's, on its own copy.
