---
name: make-a-release
description: Publish a WhatBuild release (a version tag on main, its GitHub release and its image) and, when asked, move the Cloud Run production deployment to it by approving the deploy the tag starts. Use when asked to release, cut, tag or publish a version, to make the next release, or to move, update or deploy production.
---

# Make a release

You are giving a commit of `main` a version and, when asked, putting it into production. The
knowledge, with every command, is in `okf/operations/releasing.md`. Read it before the first
command. This file is how to conduct the work.

## What must stay true

- **A tag is permanent.** Never move, delete or reuse a tag, and never force-push one. A mistake is
  fixed by the next version.
- **Only a commit of `main` on which CI passed** gets a release.
- **Ask before publishing.** Tell the person the version, the commit, what it contains and the
  migrations it adds, and wait for their yes.
- **Approve the production deploy only when the person asked for production to move**, and only
  after the Release workflow passed. Otherwise tell them it waits for approval in Cloud Build.
- **Rehearse a release that migrates first.** Before approving production's build of a release
  that adds migrations, deploy it to the dev deployment and check its migrations there with the
  `rehearse-on-the-dev-deployment` skill, unless the person says to skip it. A rehearsal that
  fails means the build is not approved.
- **Read the deployment's values from `.env`** in the maintainer's clone; never write them into
  the repository, which is public.

## Procedure

1. **Find the latest tag and the commit** (the head of `main` unless the person named one).
2. **Choose the version** by the rules in the guide: minor for features or any migration, patch
   for fixes only. Use the version the person named if they named one.
3. **Show the person** the version, commit, changes, migrations and what a deployment must do to
   take it (the Unreleased section of `okf/operations/upgrading.md`); wait for yes.
4. **Publish**: move the Unreleased lines under the version's heading in `upgrading.md` and commit
   that to `main`, then `gh release create` with them as the notes' first section, as the guide
   shows. Watch the Release workflow to the end.
5. **Production, if asked:** if the release adds migrations, or changes parsing
   (`packages/parsers/`, `apps/server/src/parse-thread.ts`, the `WHATBUILD_PARSE_*` limits) or the
   service's memory, rehearse it on the dev deployment first and report the result. Before
   approving, do on production what the release's lines in `upgrading.md` ask of a deployment, with
   the person's yes: plans, for one, through the `run-the-instance` skill, since a starting plan the
   service cannot find stops it from starting. Then approve the pending Cloud Build, follow its log, and check
   that `/api/v1/meta` reports the new version. Then deploy the Cloudflare Worker from the release's
   tag, as the guide shows: the public site is served from the Worker's own build, so without this
   it keeps the page of an older release.
6. **Report** the release page's address, whether the image was published, what production
   runs now, and whether the site's page is the release's. If the deploy broke something, use the `recover-a-deployment` skill.
