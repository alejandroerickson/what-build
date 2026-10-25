---
type: Decision
title: Alerts watch Cloud Run's own signals, and the service's traces go over OpenTelemetry to a Google Cloud project that runs nothing
description: Production mails its maintainer on server errors, error lines, memory and failed jobs from the platform's own metrics and log, and traces its requests, operations, statements and jobs over OpenTelemetry into a project of their own, so Cloud Run's unmasked request spans are never kept.
tags: [decision, operations, observability, tracing, alerts, privacy, cloud-run]
generated: {by: agent:claude, at: 2026-10-25}
status: stable
---

# Alerts watch Cloud Run's own signals, and the service's traces go over OpenTelemetry to a Google Cloud project that runs nothing

## Context

Production had a request log and the server's usage counts, and nobody heard when it failed. The
maintainer chose on 2026-10-25 to add alerts and tracing, with Google's tools rather than another
provider. Two facts shaped how. An uptime check every few minutes would keep the one instance alive,
and billed, all month. And once a project has trace storage, Google also keeps Cloud Run's own span
for each request it samples, with its whole URL, query included, and the browser's user agent,
which the [log exclusion](../operations/cloud-run.md) keeps out of the request log. Nothing turns
those spans off. Honeycomb was the alternative: a better tool for exploring traces, but another
provider holding data about the service.

## Decision

- **Alerts** come from what Cloud Run already measures and logs, never from requests made to the
  service: 5xx responses, a line of severity ERROR, memory above 85% for five minutes, and a failed
  job run. `deploy/cloud-run/alerts.mjs` makes them, and they are mailed to one address.
- **Traces** are OpenTelemetry, sent over OTLP when a deployment sets OpenTelemetry's standard
  settings, and the service runs the same without them. Production sends them to Google's Telemetry
  API with `gcp.project_id` naming a project that runs nothing (`GCP_TRACES_PROJECT` in `.env`).
  The service's own project then has no trace storage, so Cloud Run's request spans are dropped as
  before.
- **Spans hold what a log line may**, and less: a route's pattern or the masked path, an operation's
  name, the door, an agent client's family, an outcome or error code, a job's kind, a statement's
  verb and first table, an error's type. Never a statement's text, an error's message, a name, an
  address, an id or content. Spans are written by hand: automatic instrumentation records URLs and
  statements.
- **Every request has an ID**, its trace's when it is traced, in `X-Request-Id` and on its log
  lines. An unexpected error is one JSON line with severity ERROR that names it.

## Consequences

- One mail when production fails, for well under a dollar a month. An outage that keeps every
  request from reaching Cloud Run (the domain, the DNS) sends none.
- A slow request shows which operation and which statements took the time. Agents query spans with
  `bq` through a BigQuery dataset linked to the trace storage, since Google's Cloud Trace API does
  not read spans written through the Telemetry API.
- A deployment may send its traces anywhere that takes OTLP. Self-hosted ones choose their own.

## Constrains

- Spans are made in `apps/server/src/telemetry.ts`, the request middleware in `app.ts`, `execute`
  in `packages/core/src/execute.ts` and the worker's `run`. A new attribute is a fixed kind of
  value, never text from a caller.
- No project that runs WhatBuild gets trace storage: its traces never go to its own project, and
  nobody presses Enable on its Trace Explorer page.
- An unexpected error is logged with `logError`, never `console.error`.

Specified in: [§2.8](../spec/02-architecture.md) and [§9.1](../spec/09-data-lifecycle.md).
