---
type: Decision
title: Lists filter from the panel; a table's header only sorts or searches
description: Lists are filtered from the panel, each with one set of filters, and no list puts filters above its rows.
tags: [decision, web, design, navigation, exploration]
generated: {by: agent:claude, at: 2026-11-13}
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

- A list's panel context names it as a section, with one set of filters and a count on each, as
  Evidence's panel filters its sources. Exploration, which once held insights, decisions and
  assumptions as lists filtered so, now holds only the mockups, listed in its panel by name with no
  filters ([decision](mockups-are-versioned-canvases-in-exploration.md),
  [decision](assumptions-are-removed-and-every-one-is-deleted.md)).
- A list is filtered from the panel. Controls above a table's rows either sort it (Evidence's
  sources) or search it; they never filter.
- Search is not a list's: one search covers the whole product, from the panel's Search field on
  every product screen ([decision](one-search-reads-plain-words-across-the-whole-product.md)). Its
  Search screen is filtered from the panel too, by area. The maintainer chose this on 2026-10-11,
  replacing Evidence's own search over passages or titles. A title search reached by a link
  (`?query`) still narrows the sources and shows as a filter in use.
- One filter dimension per object.
- Rejected: keeping the filters in each sheet head, which fits one list but repeats a second
  navigation level inside Exploration and gives the segmented control two meanings.

## Consequences

- Every list is one click away, and its counts are always in view.
- A panel that counts a list loads it whole; a list of thousands would need counts from the
  server instead.

## Constrains

- Panel filters are `PanelFilter` links in a `PanelSection` (`apps/web/src/shell/slots.tsx`); the
  filters in use show as removable chips (`FiltersInUse`, `apps/web/src/ui/layout.tsx`).
- A new list screen follows the same split: filters in the panel, sort or search in its header.

Specified in: [07-web-app §7.2, §7.3, §7.6 and §7.7](../spec/07-web-app.md), [DESIGN.md](../../apps/web/DESIGN.md).
