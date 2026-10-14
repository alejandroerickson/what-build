---
type: System Concept
title: Copying an organization out of a deployment, into a local copy, the golden master, the dev deployment or another deployment's new database
description: What a copy of one or more organizations holds and leaves behind, taking one with pnpm fixture pull, where each kind of copy goes, moving an organization into another deployment, and what a copy cannot do.
tags: [operations, production, privacy, tenancy, fixture, dev, migrations]
generated: {by: agent:claude, at: 2026-10-14}
status: draft
---

# Copying an organization

A deployment's organizations share one database
([decision](../decisions/shared-schema-tenancy-with-row-level-security.md)). A copy takes one or
more of them out of it and nothing of the rest: the public sandbox, unless other organizations are
named ([decision](../decisions/a-copy-of-production-holds-only-the-organizations-it-is-for.md)).
Every copy of production is one: the [local copy](a-copy-of-production.md), the
[golden master](end-to-end-tests.md) built from it, and the [dev deployment](dev-deployment.md)'s.
The skill `copy-an-organization` conducts moving one into another deployment.

## What a copy holds

| Holds | Leaves behind |
|---|---|
| the organizations: settings, teams, products and everything in them, invitations, activity, a sandbox's baselines, queued jobs | every other organization |
| the accounts their rows refer to, chiefly their members, with addresses and names | every other account |
| the record of migrations, so the database it lands in knows its schema | sessions, agents' connections and tokens, sign-in links |
| their files: everything under `t/<tenant_id>/` in the bucket | allowances to create organizations, the public site's interest list, usage counts, feedback and its daily counts |

The schema comes from the deployment (`pg_dump --schema-only`). The organizations' rows are read in
one snapshot, as `pg_dump` reads, through a role that sees every organization and changes nothing:
production's backup role. Only their rows are read. They are written into a scratch database in
the embedded Postgres, every foreign key and file key is checked, and that database is dumped and
dropped. So a copy is an ordinary dump that restores like any other.

The copy refuses a table it has no rule for. A table either carries `tenant_id` or is named in
`apps/server/src/organization-copy.ts`, as the deployment's own or as copied whole.

## Taking one

```sh
corepack pnpm fixture pull                            # the public sandbox
corepack pnpm fixture pull --org <slug> --org <slug>  # the organizations named
corepack pnpm fixture pull --all                      # everything, as pg_dump takes it
corepack pnpm fixture list                            # the pulls, and what each holds
```

With `GCP_PROJECT` in `.env` or the environment, a pull reads the Cloud Run deployment through its
backup role and its files bucket. For another deployment, set `WHATBUILD_FIXTURE_DATABASE_URL` and
`WHATBUILD_FIXTURE_BUCKET` ([a copy of production](a-copy-of-production.md#pull)). A pull is a
folder in `.what-build/fixtures/` named for its UTC time (`WHATBUILD_FIXTURE_DIR` puts it
elsewhere), holding `database.dump`, `files/` and `pulled.json`, which names the organizations.

| Option | Effect |
|---|---|
| `--no-files` | the database only |
| `--files-into gs://<bucket>` | the files go into that bucket instead of the folder, and it is left holding them and no other organization's: anything under another `t/<tenant_id>/` there is deleted. It refuses the deployment's own bucket. |

A pull reads the deployment and changes nothing there. It needs `pg_dump` and `pg_restore` of the
deployment's major version or newer, and the embedded Postgres, which it starts if `pnpm dev` is
not running. `pnpm attention` reports every pull of everything until it is deleted.

## Where it goes

| To | How |
|---|---|
| this machine, to test on | `pnpm fixture load`, then `pnpm dev:fixture` ([a copy of production](a-copy-of-production.md)) |
| the end-to-end golden master | `pnpm e2e golden` ([end-to-end tests](end-to-end-tests.md)) |
| the dev deployment | [refreshing the copy](dev-deployment.md#refreshing-the-copy), with the organizations `NEON_DEV_COPY_ORGANIZATIONS` names |
| another deployment's new database | [below](#into-another-deployment) |

## Into another deployment

For example, to give an organization a deployment of its own. The target is set up as
[Cloud Run](cloud-run.md) or [Azure](azure.md) describes, and its database is new or may be
replaced. A copy cannot join a database that already holds organizations.

1. **Take the copy** into a directory only you can read. For a target on Cloud Storage, send the
   files straight to its bucket:

   ```bash
   umask 077; D=$(mktemp -d)
   WHATBUILD_FIXTURE_DIR=$D corepack pnpm fixture pull --org <slug> --files-into gs://<target bucket>
   WHATBUILD_FIXTURE_DIR=$D corepack pnpm fixture pull --org <slug>     # a target on a file share
   ```

2. **Restore it** into an empty database owned by the application's role, as
   [Backups](backups.md#restoring-a-dump) restores a dump (its steps 2 and 3), with
   `$D/<pull>/database.dump`.
3. **Files on a file share** ([Azure](azure.md)): upload `$D/<pull>/files/` to the share's root as it
   is, for example with `az storage file upload-batch`. The `.meta.json` beside each file is what
   the filesystem store reads.
4. **Deploy** the target's release. Its migration job brings the copy to its schema, which must be
   the copy's or newer.
5. **People** sign in by the same address and find their places. Sessions and agents'
   connections stay behind, so each agent connects again. Instance owners and the sign-up allowlist
   are the target's own settings. If the copy is a public sandbox, name it with
   `WHATBUILD_SANDBOX_TENANT` ([Cloud Run](cloud-run.md)).
6. **Delete the copy:** `rm -r $D`.

Production is never a target. It is only read.

## It holds real people's data

Every copy follows the rules of [a copy of production](a-copy-of-production.md#it-holds-real-peoples-data).
It stays on the machine or goes to the deployment it is for. It never goes into the repository, a
commit, an issue or a pull request. Once it is loaded elsewhere, it is deleted.
