---
type: Decision
title: The Cloud Run deployment runs releases only; a release's tag starts its deploy, which waits for approval
description: Production moves when a release is published and someone approves the build it starts, never on a merge to main or from one person's computer.
tags: [decision, deployment, releases, cloud-run, operations]
generated: {by: agent:claude, at: 2026-10-03}
status: stable
---

# The Cloud Run deployment runs releases only; a release's tag starts its deploy, which waits for approval

## Context

The maintainer's Cloud Run deployment was deployed by hand with `gcloud builds submit` from a
clone, so it ran whatever commit that clone held, named by its hash, and only from a computer that
had the clone. A trigger on pushes to `main` would deploy every merge. Releases already exist
([decision](releases-are-tags-with-a-published-image.md)) and give each version a name, notes and
a page. The maintainer chose on 2026-10-03 that production moves only on a release, after an
approval.

## Decision

- A Cloud Build trigger on new tags matching `^v\d+\.\d+\.\d+$` runs `cloudbuild.yaml`, with
  **Require approval** on. The build builds the tag, takes the Neon restore point, migrates and
  deploys, with `WHATBUILD_RELEASE` set to the tag.
- An agent publishes the release when the person asks, and approves the build when the person has
  asked for production to move ([releasing](../operations/releasing.md)).
- Rejected: a trigger on `main`, which deploys every merge; a scheduled check for new releases,
  more parts for the same result where the cloud can receive GitHub's events; a deploy workflow
  in this repository, which would hold a deployment's credentials and names.

## Consequences

- What production runs is named by a version that links to its notes, and going back is going
  back to a named release.
- A fix reaches production only as a new release, so a patch release is the unit of a hotfix.
- The trigger and its GitHub connection live in the Google Cloud project, not in the repository;
  `cloudbuild.yaml` stays a recipe any Cloud Run deployment can use, by hand or from a trigger.

## Constrains

- `cloudbuild.yaml` names the release by `TAG_NAME` when set and by the commit otherwise.
- Tags are never moved or reused; the trigger deploys each tag once.

Specified in: [Cloud Run](../operations/cloud-run.md), [Releasing](../operations/releasing.md).
