---
type: System Concept
title: A release is a version tag on main, published as a GitHub release with its image; a deployment that follows releases moves when one is published.
description: For the agent asked to release a version or move production; what a release is, how versions are numbered, publishing one with gh, what the Release workflow adds, and approving the Cloud Run deploy it starts.
tags: [operations, releases, versions, tags, deployment, cloud-run]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# Releasing a version

A **release** is three things with one name, such as `v0.2.0`
([decision](../decisions/releases-are-tags-with-a-published-image.md)):

- **The tag**: the name `v0.2.0` given to one commit of `main`, in git itself. A tag is never
  pointed at another commit and never reused. A fix is the next version.
- **The release page** on GitHub, `https://github.com/<owner>/what-build/releases/tag/v0.2.0`:
  the notes, which say what changed, the image and the migrations it adds. The account menu's
  last row ("Release v0.2.0") links to it.
- **The image**, `ghcr.io/<owner>/what-build:v0.2.0`, built from that commit, which a deployment
  can pull instead of building.

The maintainer's Cloud Run deployment runs releases only. Publishing one starts its deploy, which
waits for approval in Cloud Build; a merge to `main` deploys nothing
([decision](../decisions/production-runs-releases-after-approval.md), [Cloud Run](cloud-run.md)).

## Version numbers

`v<major>.<minor>.<patch>`. While the major is 0, nothing is promised to stay the same:

- **Minor** (`v0.3.0`): new features, and **any release that adds a migration**, because going
  back past it needs the database restored
  ([recovering from a bad release](recovering-from-a-bad-release.md)).
- **Patch** (`v0.2.1`): fixes only, with no migration.
- **Major 1** (`v1.0.0`): when the maintainer promises self-hosters that data, the API and the
  MCP tools stay compatible within it. Not before they say so.

The tag must match `^v\d+\.\d+\.\d+$`. A tag with a suffix (`v0.3.0-rc.1`) still publishes an
image and a release, but the Cloud Run trigger ignores it.

## Publishing a release

The person names the version, or asks for the next one after the latest tag. The commit is the
head of `main` unless they name another commit of `main`.

```bash
git fetch origin --tags
gh release list -L 3                                            # the latest release
git describe --tags --abbrev=0 --match 'v*' origin/main          # the latest tag on main
SHA=$(git rev-parse origin/main)                                  # or the commit they named
git merge-base --is-ancestor $SHA origin/main && echo "on main"
gh run list --workflow ci.yml --commit $SHA                       # CI passed on it
git log --oneline <latest tag>..$SHA                              # what it contains
git diff --name-only --diff-filter=A <latest tag> $SHA -- apps/server/src/migrations/
```

A migration that rewrites existing rows is worth trying first on
[a copy of production](a-copy-of-production.md).

Choose the number by the rules above. Tell the person the version, the commit, what it contains,
the migrations it adds and what a deployment must do to take it (the Unreleased section of
[upgrading](upgrading.md)), and wait for their yes: a tag is permanent. Then move those lines under
a heading for the version in that file, commit it to `main`, and publish with them as the notes'
first section:

```bash
gh release create v0.2.0 --target $SHA --title v0.2.0 --generate-notes \
  --notes "**Upgrading.** <the lines from upgrading.md, or: Nothing to change.>"
```

Publishing makes the tag, and the tag starts the Release workflow
(`.github/workflows/release.yml`), which builds and publishes the image, then puts the image and
the migrations at the top of the notes. A tag pushed without a release gets a release made by the
workflow. Follow it to the end:

```bash
gh run list --workflow release.yml -L 1
gh run watch <run id> --exit-status
```

A failed run is run again (`gh run rerun <run id>`); it adds nothing twice. The tag stays.

In a browser, the same release is Releases → Draft a new release → a new tag on `main` →
Generate release notes → Publish release.

## Moving production

On the Cloud Run deployment, the tag also starts a Cloud Build that waits for approval. Approve it
when the person has asked for production to move and the Release workflow has passed.

**Rehearse a release that migrates, or that changes parsing.** Before approving production's build
of a release that adds migrations, or that changes parsing (`packages/parsers/`, `apps/server/src/parse-thread.ts`, the `WHATBUILD_PARSE_*` limits) or the service's memory, deploy the release to the
[dev deployment](dev-deployment.md), which holds a copy of production, and check that each
migration applies and each job it queues finishes there, and that each hostile file ends in its
status within the instance's memory
([decision](../decisions/releases-are-rehearsed-on-a-dev-deployment-holding-a-copy-of-production.md)).
The commit can be rehearsed before it is tagged, too. A rehearsal that fails means the build is
rejected or left waiting, and the fix is the next release.

The waiting build is in the console under Cloud Build → History; from the command line, with
the project and region from `.env`:

```bash
gcloud builds list --project $P --region $R --filter 'approval.state=PENDING' \
  --format 'table(id,substitutions.TAG_NAME,createTime)'
B=<build id>
curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H 'Content-Type: application/json' \
  "https://cloudbuild.googleapis.com/v1/projects/${P}/locations/${R}/builds/${B}:approve" \
  -d '{"approvalResult":{"decision":"APPROVED","comment":"<version>, asked for by <who>"}}'
gcloud builds log $B --project $P --region $R --stream
curl -s https://app.what-build.com/api/v1/meta                    # release.version is the tag
```

`gcloud builds` has no `approve` outside the beta component (`gcloud beta builds approve`), so
the call above goes to the Cloud Build API. Write `${B}:approve` with braces: in zsh, `$B:a` is a
modifier, not the variable followed by text. A release nobody wants deployed is rejected the same
way with `"decision":"REJECTED"`; the release stays, and a later one deploys over it. If the new version breaks the deployment, follow
[recovering from a bad release](recovering-from-a-bad-release.md).
