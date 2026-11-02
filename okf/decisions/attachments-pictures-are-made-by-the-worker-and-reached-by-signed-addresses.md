---
type: Decision
title: An attachment's picture is made by the worker in a process of its own and reached by a signed address that costs no call
description: Small WebP copies of an image, a PDF's first page, a deck's own picture or a video's frame, filled in by every deployment itself; served by a grant naming nobody, which someone removed keeps until it expires; no LibreOffice and no ffmpeg.
tags: [decision, architecture, attachments, security, cost, performance]
generated: {by: agent:claude, at: 2026-11-01}
status: stable
---

# An attachment's picture is made by the worker in a process of its own and reached by a signed address that costs no call

## Context

A list that shows what sources look like cannot load originals: fifty 15 MB images are 750 MB, and
each attachment fetch counts as a call and against a person's data for the day, so one screen of a
list could spend a whole minute's calls. Attachments are whatever someone uploaded, so reading them
is a risk the server already keeps away from its requests. One image serves the web app, the API and
the worker, on as little as one CPU and 1 GiB.

## Decision

- **Two small copies, made once per attachment version.** A thumbnail (240 by 180) and a preview (at
  most 1600 on its long side), both WebP, beside the source's other files under its organization's
  prefix. Versions are immutable, so a picture never goes stale.
- **In a child process, as a parse is.** `make_picture` jobs run `apps/server/src/picture-child.ts`
  with Sharp and, for a PDF's first page, pdf.js on `@napi-rs/canvas`, held to a memory and a time
  limit, with a limit on the pixels an image may claim. A file whose reading failed gets no picture.
  A picture that cannot be made is recorded, and the app shows the next thing it has.
- **Decks.** A deck's embedded preview is used unless it is blank, as those written by libraries
  are; otherwise the app draws a card from slide one's title and the theme's colour.
- **Every deployment fills itself in.** The migration queues what is already there. Nothing is
  rebuilt by hand.
- **Reached by a signed address.** `GET /api/v1/pictures/<grant>` reads no cookie and no database, so
  a page of the list costs one call however many pictures it shows. It counts neither calls nor
  bytes. The expiry is rounded up to the hour so the address stays the same and a browser's copy is
  used again.
- **The cost, accepted by the maintainer:** someone removed from a product keeps reaching a picture
  whose address they hold for up to about four hours. The address names one small copy, not the
  original, and a browser would hold what it already loaded regardless. A deleted source's pictures
  go when the job that releases its bytes has run.
- **A video's or an HTML page's picture comes from a browser.** Whoever can write sends a frame from
  the file as they upload it, or from the player once it plays, and a picture of a page as they
  upload it or stop on it; agents may send one. A page is drawn inert: `DOMParser` makes a document
  nothing in which runs, and it is drawn as an SVG image, in which a browser runs no scripts and
  loads nothing. A browser that won't let the page read that back, or a page that draws blank, just
  leaves the source with its small page of words. The worker checks what is sent and makes its
  copies, so nothing a browser sends is served as sent.

## What this rules out

- **LibreOffice** to draw real slides: hundreds of MB in the image, and a heavy process sharing an
  instance with everything else.
- **A headless browser** on the server to draw HTML pages, for the same reasons as LibreOffice.
- **ffmpeg** to take frames on the server: at least 68 MB in the image, one more parser of hostile
  files to keep patched, and the usual package needs an install script, which the image build
  forbids.
- **Originals in the list**, and thumbnails through the attachment route that counts them.
