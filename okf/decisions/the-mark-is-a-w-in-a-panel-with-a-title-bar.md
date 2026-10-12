---
type: Decision
title: The WhatBuild mark is one W in a rounded tile with a title-bar line, like one of the app's panels
description: The mark keeps one monochrome W in a rounded tile and adds a hairline across the tile's top, so the tile reads as a panel with its header.
tags: [decision, design, brand]
generated: {by: agent:claude, at: 2026-10-11}
status: stable
---

# The WhatBuild mark is one W in a rounded tile with a title-bar line, like one of the app's panels

## Context

The mark was a monoline W in a rounded tile: monochrome, so it works on light and dark alike, and
instantly a W. It was also close to many other W marks. Alternatives studied included a B joined
to the W, a W changed in its gesture, form or typeface, and forty variations that each changed one
thing about the W or the tile. Two letters looked busy, and the W, for *what*, is the heart of the
name. The maintainer chose the title-bar variation on 2026-10-11.

## Decision

- The mark is a 32-unit rounded square (corner radius 7) filled with ink, with a 0.9 hairline
  across it at 7.5 and the W below it, both stroked in the panel colour.
- The W keeps its shape, with a middle peak lower than the arms. It sits 1.8 lower than before, to
  centre it under the line.
- The tile reads as one of the app's panels, a header over plain content, which is what the app
  is made of.
- Rejected: a B joined to the W (two letters are busy), and a changed W (each lost what made the
  plain W work).

## Consequences

- The mark stays one colour on one tile, inverts with the theme, and has an outline no other W
  mark shares.
- At 16 px the hairline is half a pixel and reads as a light line, not a sharp one.

## Constrains

- The geometry lives once in `apps/web/src/shell/brand.tsx` (`MARK_RULE`, `MARK_PATH`), styled
  in `apps/web/src/styles/shell.css`. `apps/web/public/favicon.svg` draws the same geometry and
  changes with it.
- The mark stays monochrome: no accent colour in it.

Specified in: [DESIGN.md, The W Mark](../../DESIGN.md) and [the web app's panel](../spec/07-web-app.md).
