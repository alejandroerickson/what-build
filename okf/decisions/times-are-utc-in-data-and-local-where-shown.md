---
type: Decision
title: Times are UTC in data and the API, and shown in the viewer's own time zone
description: Stored and returned times are UTC; every surface that shows a time to a person shows it where that person is, except a day the server states, and a mail, which give the UTC day.
tags: [decision, web, agents, story, time]
generated: {by: agent:claude, at: 2026-10-26}
status: stable
---

# Times are UTC in data and the API, and shown in the viewer's own time zone

## Context

People on one team work in different time zones, and a time shown in UTC makes each of them
convert it. Times also cross the API to agents, which hand them on to people. A time zone set per
organization or per person would be one more setting, and still wrong for anyone who travels. The
maintainer chose on 2026-10-13 that a time is always shown in the time zone it is viewed from. A
mail cannot know where it is read, and a day the server states (in a refusal an agent reads, say)
must be the day the app shows for it; on 2026-10-26 the maintainer chose that those days stay UTC
in the app too, and that a mail says its days are UTC.

## Decision

- Stored times and the times REST and MCP return are UTC, in ISO 8601.
- The web app shows dates and times in the browser's own time zone (`apps/web/src/lib/format.ts`).
- The Story print view writes each date in UTC and its one script rewrites it in the reader's time
  zone, so the PDF a person saves carries their own dates.
- The guide says that times in results are UTC.
- Rejected: a display time zone per organization or per person.
- A day that limits count over is a UTC day too, the free plan's daily allowances included.
- A day the server states is the UTC day wherever it is shown, the web app included, so both doors
  give the same one: the day an organization became read-only and the day it is kept until, and
  when the day's allowances start over (midnight UTC). Every other date in the web app (joined,
  started, on the waitlist since, an activity's day) is the viewer's own.
- A mail gives its days as UTC days and says so, "27 Oct 2026 (UTC)", and its times with "UTC".

## Consequences

- Two people reading one activity entry see the same moment in their own clocks.

## Constrains

- Interface code never formats a time with `timeZone: "UTC"`; the print view's UTC text is only
  its fallback without scripts. A day the server states is written from its ISO date
  (`iso.slice(0, 10)`), as `keptLine` in `apps/web/src/lib/limits.ts` does.
- The server writes a day with `utcDay` (`packages/core/src/util.ts`); a mail adds "(UTC)" after it.

Specified in: [07-web-app §7.1](../spec/07-web-app.md), [06-operations-and-adapters §6.3](../spec/06-operations-and-adapters.md).
