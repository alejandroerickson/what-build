---
type: Decision
title: Self-hosting on Azure is done by an agent with the Azure CLI, from instructions in the repository, and shares nothing with the Cloud Run deployment
description: An organization runs its own copy on Azure by pointing an agent at the repository; the instructions name the resources and adapt to the organization, and no file of the Cloud Run deployment is involved.
tags: [decision, deployment, azure, self-hosting, agents, operations]
generated: {by: agent:codex, at: 2026-10-12}
status: stable
---

# Self-hosting on Azure is done by an agent with the Azure CLI, from instructions in the repository, and shares nothing with the Cloud Run deployment

## Context

The hosted service runs on Cloud Run, set up by a script. An organization that keeps its own copy
on Azure differs from the next one in ways a script handles badly: the app registration for
sign-in may be in another directory than the resources, policies may fix regions, tags, networks
and what an operator may do, and names are global. Its people sign in with Microsoft work
accounts. The maintainer chose on 2026-10-01 that the repository carries instructions for an
agent, that the agent does the hosting with the Azure CLI on the operator's own sign-in, and that
none of it may disturb the hosted service's deployments.

## Decision

- An agent sets up and operates an Azure deployment by following the `azure-self-host` skill and
  [the guide](../operations/azure.md). There is no setup script; `deploy/azure/` holds only what
  the CLI cannot take as flags.
- The guide states what each resource is for and how it is configured, and names the variations,
  so the agent asks and adapts instead of failing.
- Azure work reads and writes `deploy/azure/`, `.env.azure` and the Azure guide, and nothing the
  Cloud Run deployment uses (`deploy/cloud-run/`, `cloudbuild.yaml`, `deploy/cloudflare/`, `.env`).
- The same image runs, unchanged. Until the server has an Azure Blob adapter, files go through the
  filesystem adapter to a mounted file share.
- What self-hosting needs from the server is specified before it is built, and built as a
  general feature of the one image: sign-in with Microsoft work accounts is in the server, off
  unless configured; the Azure Blob adapter is specified.

- Every deployment verifies the database recovery configuration and records a pre-migration
  recovery target before starting migrations. A failed or missing check blocks migrations;
  setup defaults alone are not evidence that recovery is available.

## Consequences

- A deployment can differ per organization without a branch of the code or of a script.
- The guide is prose and commands that no test runs; it stays true only if each agent that finds
  it wrong corrects it.
- An organization that forbids storage account keys cannot mount the share, and waits for the
  adapter.

## Constrains

- No code path, build flag or image exists only for self-hosters
  ([§2.7](../spec/02-architecture.md)).
- Nothing that identifies an operator's organization, subscription or directory is committed.

Specified in: [azure](../operations/azure.md), [02-architecture §2.4, §2.7](../spec/02-architecture.md),
[03-accounts-teams-and-identity §3.2](../spec/03-accounts-teams-and-identity.md).
