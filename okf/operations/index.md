---
type: Index
title: Operations
description: Running WhatBuild locally and in production.
tags: [index, operations]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Operations

- [Local development](local-development.md): one command, the checks, and the browser scripts.
- [End-to-end tests](end-to-end-tests.md): an agent follows a written plan through the web app and MCP on a local instance reset to a golden master, and reports failures and anomalies.
- [The end-to-end instance on a Docker host](end-to-end-on-a-docker-host.md): the release image serving a fresh copy of the golden master on any machine that runs Docker, following releases; loading an export, resetting before each run, testing through an SSH tunnel.
- [A copy of production](a-copy-of-production.md): pulling the deployment's example organization or other organizations named, with their files, loading them locally, serving them with pending migrations applied, for manual QA and agent-driven end-to-end tests; it stays private.
- [Copying an organization](copying-an-organization.md): what a copy of one or more organizations holds and leaves behind, taking one, where each copy goes, and moving an organization into another deployment's new database.
- [Cloud Run](cloud-run.md): the production deployment, its setup and its routines.
- [Upgrading](upgrading.md): what a deployment must do when it takes a release, kept per release, with the unreleased changes on top until the next release's notes carry them.
- [Releasing](releasing.md): a release is a version tag on `main` with its notes and image; numbering versions, publishing one, and approving the production deploy it starts.
- [The dev deployment](dev-deployment.md): a second Cloud Run deployment holding a copy of production, where a release that migrates is rehearsed before production moves; rehearsing, putting it back, refreshing the copy, setting one up.
- [Backups](backups.md): what each deployment keeps, where and for how long, the nightly dump, checking that backups run, restoring a dump and checking it, and the restore drill.
- [Recovering from a bad release](recovering-from-a-bad-release.md): when a new version breaks a deployment, on Cloud Run or Azure: what runs, whether it migrated, going back, restoring the database, checking, fixing forward.
- [Azure](azure.md): a self-hosted deployment on Azure, set up by an agent with the Azure CLI; resources, commands, sign-in with Microsoft work accounts, and the variations.
- [Security checks](security-checks.md): what keeps secrets and private material out of the repository, and finds known vulnerabilities; where each check runs, what to do about a finding, auditing everything GitHub holds, and making the repository public.
- [Analytics](analytics.md): the server's own counts, Google Analytics and Cloudflare Web Analytics, their settings, connecting a deployment, and reading them all with `pnpm usage`.
- [Mail](mail.md): what the server sends, its settings, which deployments send mail and which never do, setting up Cloudflare Email Sending, checking it, rotating its token, changing provider, and what breaks it.
