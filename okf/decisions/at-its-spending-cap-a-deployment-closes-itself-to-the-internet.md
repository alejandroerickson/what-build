---
type: Decision
title: At its spending cap, a Cloud Run deployment closes itself to the internet
description: A kill switch takes the public off the services' invoker role when the month's spending reaches a cap or a flood runs away, so the bill has a hard limit and nothing the deployment holds is lost.
tags: [decision, deployment, cloud-run, costs, alerts, operations]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# At its spending cap, a Cloud Run deployment closes itself to the internet

## Context

Logs, data sent out and traces grow with requests, whoever sends them, and Google Cloud caps none of
them: a budget only mails, with figures hours late, and Google's own way to stop spending,
disabling billing, stops everything and may delete what the project holds. The maintainer chose on
2026-10-25 a hard limit on the bill, at the cost of the app going offline when it is reached.

## Decision

- A budget on the billing account, and two alerts set far past anything people do (more than
  20 GB sent to the internet, or 2 GB of logs, in an hour), publish to a Pub/Sub topic. A private
  service, `deploy/cloud-run/kill-switch/`, closes every service it is given when a budget's
  message reaches the budget's own amount or an alert opens, and ignores anything else.
- Closing takes `allUsers` and `allAuthenticatedUsers` off each service's invoker role. Google's
  front end then refuses every request (`403`) before an instance starts.
- Its identity holds only `run.services.getIamPolicy` and `run.services.setIamPolicy` on those
  services (the role `whatbuildKillSwitch`). Rejected: setting their ingress to internal, which
  needs the right to act as their runtime identity, a reader of the database and the files; and
  disabling billing. A Cloud Function was not used: it needs an API and build rights the project
  does not otherwise have, while Cloud Build already builds images.
- Opening again is by hand: raise the cap or wait for the month, then put `allUsers` back.

## Consequences

- The bill stops growing at the cap, give or take what the budget's lag lets through; the fast
  alerts bound that lag for a flood. The app is offline until someone opens it.
- Every row, file, setting and revision is kept, and the nightly backup still runs.
- The kill switch does not reach Cloudflare, whose Workers Paid plan has no cap of its own.

## Constrains

- Nothing reopens a service on its own: a release's build never sets its access, and `setup.sh`,
  which does (`--allow-unauthenticated`), says so.
- Every Cloud Run deployment billed to the account is named in `SERVICES`.

Specified in: [Cloud Run](../operations/cloud-run.md#a-hard-limit-on-the-bill).
