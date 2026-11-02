---
type: Decision
title: Evidence is a list of what sources look like, with a preview beside it that is moved through by keys
description: People remember what they saw, so a row shows a source's face, its title and its date; a click opens a preview column instead of leaving the list, with arrows through sources and through a source's pages.
tags: [decision, web-app, evidence, design-system, performance]
generated: {by: agent:claude, at: 2026-11-01}
status: stable
---

# Evidence is a list of what sources look like, with a preview beside it that is moved through by keys

## Context

The list of sources was titles, tags and a chevron that unfolded a summary: words about the material
rather than the material. Someone looking for the workshop whose whiteboard they remember had to
open sources one at a time, each a page load away from the list. The maintainer compared five shapes
on a canvas (a gallery, a filmstrip above the table, a lightbox, a walk through pages, a preview
beside the list) and chose the preview beside the list on 2026-11-01.

## Decision

- **A row is a face, a title and a date.** The face is the first a source can show of a picture, a
  deck's card, a small page of its own words, and an icon of what it holds. Beside the preview that
  is all a row keeps; alone, the list keeps its tags and the attachment count at today's measure.
- **The summary no longer unfolds in the row.** It is the first page of the preview, so it can
  become something other than Markdown one day as one more kind of page, with nothing else moving.
- **The list opens alone; a click opens the preview.** A click that opens a new tab still goes to the
  source's page, and **Open source** and Enter go there too. Which source and page is in the address
  (`?source=`, `?page=`), so a link and a reload land on it.
- **Keys.** Up and down (and J and K) move through sources, whether the preview is open or not. Left
  and right move through the summary, the source's own text when it is no attachment's, and each
  attachment. Space opens and closes the preview, Esc closes it.
- **Moving through the list spends no call.** The list's answer (`include_preview`) holds what the
  preview shows first, and what needs a call waits until someone stops on it.
- **It is the One Scroller Rule's named exception.** While a preview is open, the list and the
  preview fill the window side by side and each scrolls its own, past the 900px measure, because a
  page of a PDF needs the room. On a phone the preview takes the screen.
- **No virtualization library.** Rows use `content-visibility: auto` and are memoized, and the list
  loads a page at a time as its end comes near, so every row stays findable with the browser's find,
  which windowing would not allow. On React's development build, with 2,000 rows loaded (the most the
  example plans allow), the preview opened in 33 ms, an arrow took 22 to 113 ms and the list scrolled
  at about 57 frames a second. With 10,000 it fell apart: an arrow took 125 ms or more and scrolling
  managed five frames a second. A plan that allows much more than a few thousand sources needs this
  looked at again.

## What this rules out

- A gallery as the list's main shape: most sources are text, whose small pages look alike at that
  size, and a grid gives up the title and date people scan by.
- A lightbox over the list: it hides the list being moved through.
