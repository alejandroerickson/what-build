---
type: Index
title: Operations
description: Running WhatBuild locally and in production.
tags: [index, operations]
generated: {by: agent:claude, at: 2026-10-03}
status: stable
---

# Operations

- [Local development](local-development.md): one command, the checks, and the browser scripts.
- [A copy of production](a-copy-of-production.md): pulling the deployment's database and files, loading them locally, serving them with pending migrations applied, for manual QA and agent-driven end-to-end tests; it stays private.
- [Cloud Run](cloud-run.md): the production deployment, its setup and its routines.
- [Releasing](releasing.md): a release is a version tag on `main` with its notes and image; numbering versions, publishing one, and approving the production deploy it starts.
- [Recovering from a bad release](recovering-from-a-bad-release.md): when a new version breaks a deployment, on Cloud Run or Azure: what runs, whether it migrated, going back, restoring the database, checking, fixing forward.
- [Azure](azure.md): a self-hosted deployment on Azure, set up by an agent with the Azure CLI; resources, commands, sign-in with Microsoft work accounts, and the variations.
- [Analytics](analytics.md): Google Analytics and Cloudflare Web Analytics, their settings, and reading reports.
