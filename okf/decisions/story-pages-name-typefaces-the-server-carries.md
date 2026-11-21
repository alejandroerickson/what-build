---
type: Decision
title: Story and mockup pages name typefaces the server carries, and the server embeds them when it shows a page
description: A set of open-licence typefaces ships with the server; a Story page, a style or a mockup page names one in quotes and gets it when shown or printed, so stored pages and what agents read stay small.
tags: [decision, story, mockups, design, fonts, agents]
generated: {by: agent:claude, at: 2026-11-21}
status: stable
---

# Story and mockup pages name typefaces the server carries, and the server embeds them when it shows a page

## Context

A Story page can make no network request, so a typeface it uses must travel inside it. Until now
house styles used system font stacks, which look different on every machine and limit a style to
faces nobody chose for it. Embedding a font in every stylesheet would put tens of kilobytes of
base64 in each stored page, in each version, and in everything an agent reads back with
`get_style`, `get_page` or `guidance`.

Mockup pages first kept their own look with no carried faces, so each embedded its typeface. A
canvas in a team's design system then carried its face in every page: Inter was most of each
page's weight and of what a version holds, and heavy canvases flashed white between pages. The
maintainer chose on 2026-11-21 to give mockup pages the carried faces too.

## Decision

- A fixed set of typefaces ships with the server in `packages/core/src/story-fonts/`: the Latin
  subset of each family's variable font, unmodified from Fontsource, each under the SIL Open Font
  License with no Reserved Font Name, listed with its copyright in the folder's README.
- A page or stylesheet uses one by naming its family in quotes in `font-family`. When the server
  shows a Story page or a style specimen, it adds an `@font-face` for each named family, as a data
  URI, in a `<style>` at the start of the page's head. The print view declares them once for the
  whole document, since a face declared inside a shadow root is not used.
- Stored pages, stylesheets and everything returned to agents stay free of font data.
- A mockup page gets the same faces, and Inter, the app's own typeface (`MOCKUP_FONTS`), wherever
  it is shown: its canvas, the Story when promoted, the print view. A page that names none is
  shown as stored, so it still keeps its own look. A Story page never gets Inter: the Story never
  takes WhatBuild's look.
- Rejected: embedding fonts in each house style's stylesheet (every page and agent read would carry
  them), and fetching fonts at view time (pages have no network).

## Consequences

- House styles and a team's own style can use real typefaces, the same on every machine.
- The HTML an agent reads with `get_page`, and a product export, hold the page as stored: opened
  on its own, it renders in its fallback faces.
- Each carried family adds its file to the image; a page pays only for the families it names.

## Constrains

- `withStoryFonts` (`packages/core/src/story-fonts.ts`) runs on every Story page, mockup page
  (with `MOCKUP_FONTS`) and specimen the server shows (`storyHtml` in
  `apps/server/src/documents.ts`), and the print view declares the faces its pages name; nothing
  writes carried faces into stored HTML.
- No house style stylesheet contains `data:font/`; a test fails if one does.
- A family joins `STORY_FONTS` only with its licence checked and recorded in the README. The
  server build copies the folder beside the bundle.

Specified in: [04-data-model §4.11](../spec/04-data-model.md).
