---
type: Index
title: WhatBuild knowledge bundle
description: The map of the documentation; start here.
tags: [index, okf]
generated: {by: agent:claude, at: 2026-10-11}
status: stable
okf_version: "0.2"
---

# WhatBuild knowledge bundle

WhatBuild turns a product team's discovery material into outcomes, mockups, reviewed assumptions
and a Story for stakeholders. People use a web app; agents use an MCP
server with the same operations. There is no AI inside.

## Map

- [Charter](project/charter.md): what the product and repository are, and are not.
- [WhatBuild at three altitudes](system/overview.md): the whole system, top down.
- [Repository map](system/repository-map.md): where things are.
- [Security](system/security.md): the threat model, and the control behind each boundary.
- [Decisions](decisions/index.md): the architectural decision records.
- [Specification](spec/index.md): product, architecture, identity and tenancy, data model, derived
  layer, operations and MCP, web app, search, data lifecycle, and the [roadmap](spec/10-roadmap.md).
- [Local development](operations/local-development.md), [end-to-end tests](operations/end-to-end-tests.md), [a copy of production](operations/a-copy-of-production.md), [Cloud Run](operations/cloud-run.md),
  [self-hosting on Azure](operations/azure.md), [Analytics](operations/analytics.md) and [Mail](operations/mail.md).
- **Making a release, or moving production?** [Releasing](operations/releasing.md).
- **Rehearsing a release, or deploying to dev?** [The dev deployment](operations/dev-deployment.md).
- **Backups, or restoring one?** [Backups](operations/backups.md).
- **A release broke a deployment?** [Recovering from a bad release](operations/recovering-from-a-bad-release.md).
- **Setting up email, or invitations not arriving?** [Mail](operations/mail.md).
- [Working in this repository](process/working-in-this-repository.md), and the
  [security checks](operations/security-checks.md) that keep private material out of it.
- [Ontology](ontology.md), [bundle guide](README.md), [tools](tools/index.md).

## Outside the bundle

- `README.md`: the human-facing introduction.
- `AGENTS.md`: agent orientation (`CLAUDE.md` links to it).
- `.agents/skills/`: skills for agents working on the repository: reading this bundle
  (`okf-orient`), keeping it true (`okf-update`), recording decisions (`okf-decision`),
  hosting a copy on Azure (`azure-self-host`), publishing a release (`make-a-release`),
  rehearsing on the dev deployment (`rehearse-on-the-dev-deployment`), recovering a deployment a
  release broke (`recover-a-deployment`), testing on a local copy of production
  (`test-on-a-copy-of-production`), running the end-to-end test plans
  (`run-end-to-end-tests`), reading how a deployment is used (`read-usage`), and setting up and
  repairing a deployment's mail (`set-up-mail`).
- `PRODUCT.md`: users, purpose and principles. `DESIGN.md` and `.impeccable/design.json`: the
  Studio design system. Both stay at the root because design tooling reads them there.
- `packages/core/src/skill/SKILL.md`: the agent skill the product serves to connected agents.
- `deploy/cloud-run/README.md`: a pointer next to `setup.sh`. `deploy/azure/README.md`: a pointer
  next to the container app's definition.
