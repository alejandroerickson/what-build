---
type: Decision
title: A release is a tag on main with its image published; deploying it is the deployment's own pipeline
description: A tag v* publishes the image to the GitHub container registry and a GitHub release, so any deployment can pull a released version; the repository ships no deployment pipeline for a platform it does not run on.
tags: [decision, deployment, releases, operations, self-hosting]
generated: {by: agent:claude, at: 2026-10-02}
status: stable
---

# A release is a tag on main with its image published; deploying it is the deployment's own pipeline

## Context

The repository runs one deployment of its own (Cloud Run, redeployed from source on every push to
`main`) and is meant to be self-hosted by organizations with their own clouds, review rules and
change windows. Each of those wants a pipeline of its own shape: what it deploys, who approves,
and when. A pipeline for every platform in this repository would be code that only one operator
runs, and a self-hoster building from `main` has no way to say which version runs except a commit
hash. The maintainer chose this shape on 2026-10-02.

## Decision

- **A release is a tag `v<major>.<minor>.<patch>` on a commit of `main` that CI has passed.** The
  Release workflow (`.github/workflows/release.yml`) builds the Dockerfile for `linux/amd64`,
  publishes it as `ghcr.io/<owner>/what-build:<tag>` with the commit in its labels, and makes a
  GitHub release with generated notes. Nothing else happens on a tag.
- **Deploying is the deployment's own business.** The repository documents the contract a
  deployment needs (one image, `node main.js migrate` before the new version serves, the
  settings, `/api/v1/meta` reporting `server_version`) and, for each cloud it describes, the
  commands; it does not hold the pipeline, the approvals or the schedule of any deployment but its
  own. A self-hoster keeps those in a repository of their own that pins a release and runs the
  guide's steps.
- Rejected: a deploy workflow in this repository parameterized per cloud. It would carry an
  operator's resource names and approval rules, which stay out of a public repository, and it
  would make the repository responsible for every operator's deploys.

## Consequences

- A deployment names what it runs (`v0.3.1`), can go back to it, and can take a released image
  without building from source.
- Tags are not moved: a tag names one commit for ever, and a fix is a new tag.
- The Cloud Run deployment is unchanged: it still deploys every push to `main` from source.

## Constrains

- The image is built from the one Dockerfile; a release has no build flags of its own
  ([one stateless image](one-stateless-image.md), [§2.7](../spec/02-architecture.md)).
- The guides describe commands and the contract, never a particular operator's pipeline
  ([self-hosting on Azure](self-hosting-on-azure-is-agent-led-and-shares-nothing-with-cloud-run.md)).

Specified in: [Azure](../operations/azure.md) (deploying a new version), [Cloud Run](../operations/cloud-run.md).
