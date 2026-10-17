---
type: System Concept
title: A copy of production on your machine, for manual QA, agent-driven end-to-end tests and trying migrations on real data
description: Pulling the public sandbox or other organizations of the deployment, with their files, loading them into the embedded Postgres, serving them with pending migrations applied, and keeping the copy private.
tags: [development, testing, qa, production, fixture, migrations]
generated: {by: agent:claude, at: 2026-10-16}
status: stable
---

# A copy of production

The synthetic sample product shows every feature, but it is small and tidy. A copy of the
production deployment has real volume and history: products agents built up over weeks, Story
pages, revisions, sources parsed more than once, and rows in the shape older releases left them. Use it
for manual QA, for agent-driven end-to-end tests, and to watch a release's migrations run on real
data before production does ([decision](../decisions/qa-uses-a-private-copy-of-production.md)).
A copy holds the public sandbox, or the organizations named, and nothing of the others
([copying an organization](copying-an-organization.md)). The skill `test-on-a-copy-of-production`
conducts it.

## It holds real people's data

- A copy lives in `.what-build/fixtures/` (each pull) and in the embedded Postgres in
  `.what-build/pg` (the loaded copy), which git ignores, on the maintainer's machine. It is never
  committed, uploaded, attached or copied anywhere else. The one other copy is the
  [dev deployment](dev-deployment.md)'s, taken from production directly, never from a pull.
- Nothing from it is quoted in the repository, a commit message, an issue or a pull request: no
  names, addresses, organizations, titles or text. Tests, the seed and screenshots stay synthetic.
- Served, it sends no mail (mail prints to the terminal) and reads and writes only its local copy
  of the files, never the deployment's bucket.
- Delete a pull you no longer need with `rm -r .what-build/fixtures/<name>`. `pnpm attention`
  reports each pull of every organization until it is gone.

## What you need

- For the Cloud Run deployment: `gcloud` signed in with access to its project, and `GCP_PROJECT`
  in `.env` or the environment.
- `pg_dump` and `pg_restore` of the production server's major version or newer.

## Pull

```sh
corepack pnpm fixture pull                     # the public sandbox
corepack pnpm fixture pull --org <slug> …      # the organizations named
corepack pnpm fixture pull --all               # every organization
corepack pnpm fixture list                     # the pulls, and what each holds
```

It reads the organizations' rows through the read-only backup role (the secret
`whatbuild-backup-database-url`; [Cloud Run](cloud-run.md), under backups), which reads every
organization's rows and can change nothing, and copies their folders of the files bucket,
`gs://<project>-whatbuild-files`, with the type and hash the local file store keeps for each file.
The files matter: a source's derived text is kept in files, so without them every source opens
empty. Pulling reads production and changes nothing there. What a copy holds and leaves behind,
and every option, are in [copying an organization](copying-an-organization.md).

Each pull is a new folder named for its UTC time, such as `.what-build/fixtures/2026-10-10T0411Z/`,
holding `database.dump`, `files/` and `pulled.json`, which names the organizations. `pulled.json`
is written last, so a pull that stopped part-way is never loaded.

For another deployment, set `WHATBUILD_FIXTURE_DATABASE_URL` to a role that reads everything and
bypasses row-level security, as the backup role does. Set `WHATBUILD_FIXTURE_BUCKET` to its
`gs://` bucket, or leave it out for a copy without files. `WHATBUILD_FIXTURE_DIR` keeps pulls
somewhere else, for example so that several checkouts share them.

## Load

```sh
corepack pnpm fixture load                    # the newest pull
corepack pnpm fixture load 2026-10-10T0411Z   # a named one
```

It replaces the database `fixture` in the embedded Postgres with the dump, and says which
organizations it holds. That is the server
`pnpm dev` runs, and the load starts it if it is not running. The dump is restored as the
application's role, the way [Cloud Run](cloud-run.md) restores a backup. The load also replaces
`.what-build/fixture-blobs` with a working copy of the files. The synthetic database, `whatbuild`,
is untouched.

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
`pnpm e2e golden`: the public sandbox's organization and a non-sandbox copy of it.

## Before a release that migrates

1. Pull a fresh copy and load it. The sandbox's content shows most migrations; for one that
   rewrites content the sandbox lacks, name more organizations, or pull `--all` and delete that
   pull afterwards.
2. Serve it with the release's code.
3. Check three things:
   - every migration applies;
   - every job the migrations queue finishes without an error (the log names each job and its
     result);
   - the screens the release changed open on real data.
4. Load again to put the copy back as it was pulled.
5. Rehearse the deploy itself on the [dev deployment](dev-deployment.md): the same build, restore
   point and migration job as production's, on its own copy.
