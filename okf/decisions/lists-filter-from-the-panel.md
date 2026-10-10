---
type: Decision
title: Lists filter from the panel; a table's header only sorts or searches
description: Exploration's lists are filtered from the panel, each with one set of filters, and no list puts filters above its rows.
tags: [decision, web, design, navigation, exploration]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# Lists filter from the panel; a table's header only sorts or searches

## Context

Synthesis (now Exploration) opened on Insights, with assumptions and decisions as quiet links in its
header, so three objects of equal standing read as one list with two sub-views. Insights carried two
filter dimensions at once (review state as a segmented control, status as a menu), and the same
segmented control sorted the Evidence list, so one control meant two things. Teams moving fast
toward a release, sometimes before they know what they are building, cannot afford to learn either.
The maintainer chose these rules on 2026-09-28.

## Decision

- Exploration's panel context names each list as a section, with one set of filters (its review
  state) and a count on each, as Evidence's panel filters its sources. Since insights and decisions
  were retired ([decision](insights-and-decisions-are-retired-into-evidence.md)), that is the
  assumptions. The mockups are listed above them, by name, with no filters
  ([decision](mockups-are-versioned-canvases-in-exploration.md)).
- A list is filtered from the panel. Controls above a table's rows either sort it (Evidence's
  sources) or search it (Exploration's title search); they never filter.
- Evidence keeps its search in the panel, one field over passages or titles with a toggle between
  them, so a person searches what sources say and what they are called from the same place. The
  maintainer chose this on 2026-10-10. A title search there narrows the list and shows as a filter
  in use.
- One filter dimension per object.
- Rejected: keeping the filters in each sheet head, which fits one list but repeats a second
  navigation level inside Exploration and gives the segmented control two meanings.

## Consequences

- Every list is one click away, and its counts are always in view.
- The panel loads each Exploration list whole to count it; a product with thousands of entries would
  need counts from the server instead.

## Constrains

- Panel filters are `PanelFilter` links in a `PanelSection` (`apps/web/src/shell/slots.tsx`); the
  filters in use show as removable chips (`FiltersInUse`, `apps/web/src/ui/layout.tsx`).
- A new list screen follows the same split: filters in the panel, sort or search in its header,
  unless its section already searches from the panel, as Evidence does.

Specified in: [07-web-app §7.2, §7.3 and §7.7](../spec/07-web-app.md), [DESIGN.md](../../DESIGN.md).
