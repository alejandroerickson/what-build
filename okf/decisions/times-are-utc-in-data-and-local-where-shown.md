---
type: Decision
title: Times are UTC in data and the API, and shown in the viewer's own time zone
description: Stored and returned times are UTC; every surface that shows a time to a person shows it where that person is.
tags: [decision, web, agents, story, time]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Times are UTC in data and the API, and shown in the viewer's own time zone

## Context

People on one team work in different time zones, and a time shown in UTC makes each of them
convert it. Times also cross the API to agents, which hand them on to people. A time zone set per
organization or per person would be one more setting, and still wrong for anyone who travels. The
maintainer chose on 2026-10-13 that a time is always shown in the time zone it is viewed from.

## Decision

- Stored times and the times REST and MCP return are UTC, in ISO 8601.
- The web app shows dates and times in the browser's own time zone (`apps/web/src/lib/format.ts`).
- The Story print view writes each date in UTC and its one script rewrites it in the reader's time
  zone, so the PDF a person saves carries their own dates.
- The guide says that times in results are UTC.
- Rejected: a display time zone per organization or per person.
- A day that limits count over is a UTC day too, the free plan's daily allowances included.

## Consequences

- Two people reading one activity entry see the same moment in their own clocks.

## Constrains

- Interface code never formats a time with `timeZone: "UTC"`; the print view's UTC text is only
  its fallback without scripts.

Specified in: [07-web-app §7.1](../spec/07-web-app.md), [06-operations-and-adapters §6.3](../spec/06-operations-and-adapters.md).
