---
type: Bundle Guide
title: How to read and keep this documentation bundle
description: What okf/ is, how it is laid out, the reading order, and how to keep it accurate.
tags: [guide, okf]
generated: {by: agent:claude, at: 2026-10-11}
status: stable
---

# The OKF bundle

An [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)-style
bundle: plain Markdown with YAML frontmatter, ordinary cross-links, and provenance. It is **the**
documentation for this repository: what WhatBuild is, how it is built, the decisions behind it,
the detailed specification, how to run it, and how to change it.

It is reference knowledge, not memory. The repository is public, so there is no log, session
history, request record or to-do list here
([decision](decisions/public-repository-reference-docs.md)).

## Reading order

Stop as soon as you have what the task needs.

1. [`index.md`](index.md), the map.
2. [WhatBuild at three altitudes](system/overview.md), the system in one read.
3. [Working in this repository](process/working-in-this-repository.md), before changing anything.
4. The [decisions](decisions/index.md) that govern the area you are touching.
5. The [specification](spec/index.md) section for that area.

## Layout

- [project/](project/index.md): the charter.
- [system/](system/index.md): the overview and the repository map.
- [decisions/](decisions/index.md): architectural decision records.
- [spec/](spec/index.md): the detailed specification and the roadmap.
- [operations/](operations/index.md): local development, a copy of production, the Cloud Run
  deployment, releasing, the dev deployment, backups, recovering from a bad release, self-hosting
  on Azure, analytics, and the security checks.
- [process/](process/index.md): how work on the repository is done.
- [ontology.md](ontology.md): concept types, frontmatter and editing rules.
- [tools/](tools/index.md): the validator.

## Keeping it accurate

When a change makes a concept untrue, correct the concept in the same change and bump its
`generated.at`. Agents follow the skills in `.agents/skills/`: `okf-orient` to find what to read,
`okf-update` to keep the bundle true (with an impact map from code to concepts and a template per
type), and `okf-decision` to record decisions. Five more skills are procedures for operating a deployment:
`azure-self-host` for [hosting on Azure](operations/azure.md), `make-a-release` for
[releasing](operations/releasing.md), `rehearse-on-the-dev-deployment` for
[the dev deployment](operations/dev-deployment.md) and the restore drill in
[backups](operations/backups.md), `recover-a-deployment` for
[recovering from a bad release](operations/recovering-from-a-bad-release.md), and
`test-on-a-copy-of-production` for [a copy of production](operations/a-copy-of-production.md). Two conduct the
[security checks](operations/security-checks.md): `audit-for-leaks` and `triage-security-findings`.
`run-end-to-end-tests` runs the [end-to-end test plans](operations/end-to-end-tests.md), and `read-usage` reads
[how a deployment is used](operations/analytics.md). Prefer correcting a concept to adding a near-duplicate. Validate before committing:

```sh
python3 okf/tools/validate_okf.py
```
