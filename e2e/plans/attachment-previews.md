---
title: Real files look like themselves in the list of sources and its preview, and an HTML attachment can do nothing
organizations: [standard]
people: [sam, riley]
surfaces: [web, mcp]
---

# Attachment previews

Sources are known by what they look like. This plan checks that on real files, which the tests,
making theirs from nothing, can't: decks saved by PowerPoint, scans, phone photos, recordings and
web pages. It also checks that a video is turned away, which WhatBuild no longer keeps.

## When to run this

Nothing runs these files by itself: not `pnpm test`, not CI, not a release. Use the smallest thing
that covers what changed:

| What changed | Run |
|---|---|
| Anything that doesn't touch attachments | Nothing |
| How a file is read or pictured (`packages/parsers/`, `picture-child.ts`, `picture-process.ts`, `packages/core/src/pictures.ts`), or an upgrade of Sharp, pdf.js or the canvas | `corepack pnpm check:attachments`, with `--only <kinds>` for one format. Under a minute, no browser, and no network once the files are here |
| The list or preview's screens, how HTML or a recording is served, or what is refused as it comes in | Only the step below for what changed |
| A rehearsal of a release that changed several of these, or when asked | This whole plan |

## Getting the files

```sh
node scripts/fetch-test-attachments.mjs
```

One download serves every worktree, and what is already there is never fetched again.
`e2e/test-attachments.json` says what each file exercises and what it should come to. A file whose
address has stopped working is left out of the run, and the report says so. Upload them to one product of the standard
organization as Sam, one source each, as the file names suggest, through the web app (so that a web
page gets its picture), then wait for the worker. The plan offers the example file's
plans: move the organization to Pro first, so that images and recordings are allowed.

## Steps

1. **Decks.** Open Evidence. *Expect:* a deck saved by PowerPoint with a picture of itself shows that
   picture in its row, whole, with nothing cut from its sides. A deck with none, and one exported by
   Google Slides, shows a card with its first slide's title. A blank deck shows a small page. Open a
   deck's row and go to its attachment: *expect* the picture, not stretched soft, above each slide's
   words under a heading, with its speaker notes. A legacy `.ppt` and a Keynote `.key` show an icon
   saying what they are, and a download.
2. **PDFs.** *Expect:* a text report, a scan and a landscape slide export each show their first page in
   the row, the slide export whole. In the preview, page one shows with **Show all N pages**, which
   opens the whole PDF in the column.
3. **Images.** *Expect:* a phone photo stands the right way up. A TIFF shows its picture, and a GIF a
   frame from its middle. A HEIC has an icon in its row, and in a browser other than Safari the
   preview says it can't show this format, with a download. Pressing an image opens its original.
4. **Recordings.** Stop on a recording (an MP3 or M4A) in the preview. *Expect:* an audio player, and
   no request for it in the network panel until Play is pressed. Press Play: *expect* it to play and
   the requests to be for pieces of at most 8 MiB. Seek twice, then read the organization's limits:
   *expect* the day's data sent to have grown by about what played, never the file again for each
   seek. A file the browser can't play says so, with a download.
5. **No video.** As Sam, in the web app, add any file named `….mp4` or `….mov` (an empty one will
   do), on a new source and on an existing one. *Expect:* it is turned away as it is picked, saying
   WhatBuild doesn't keep video and to add its transcript, or a link to it, instead, and no source
   is made for it. Over MCP, `attachments_write(action="request_upload")` for `walk.mp4` and
   `fetch_url` for an address ending in `.mp4` each answer `415 video_not_accepted` with the same
   advice. A video stored before (in the golden master, if it holds one) shows its picture, if it has
   one, with "WhatBuild no longer plays video" and a download, and no player; downloading it gets the
   whole file.
6. **Web pages.** *Expect:* each shows in a sandboxed frame, with a line saying it runs no scripts and
   loads nothing from elsewhere, and once someone has stopped on it, or uploaded it,
   its row shows a picture of it. A page that relies on what it loads shows plain, and stays a small
   page of words if it draws blank.
7. **A hostile page.** Attach `e2e/hostile-page.html` and stop on it in the preview, with the network
   panel open. *Expect:* the title of the app's tab never changes, and the app stays where it is. Every
   request to `hostile.example.com` shows as blocked by the page's policy, and none reaches a network.
   Press its button and its link: nothing happens. The row's picture shows the heading and the table.
   Open the attachment's address without `/view`: *expect* a download, not a page.
8. **Cost.** With the network panel open, hold the down arrow through twenty sources. *Expect:* no call
   for sources passed through, and the pictures served with no call counted (`/api/v1/pictures/…`, from
   the browser's cache on a second pass).

9. **A page an agent attached, seen by someone who can only read.** As Sam, over MCP, attach a web
   page to a new source of this product, and send it no picture. As Riley, invite
   `viewer@example.com` as a viewer of the product, and accept as them. *Expect:* signed in as that
   person, the row shows no picture until they stop on the page, and then it gets one, which Sam
   sees too. Sign in as a guest and stop on another page with no picture in the example
   organization: *expect* nothing sent, and no refusal in the page.
10. **A large file.** This instance's store signs no direct uploads. As Sam, in the web app, add a
   file over the 25 MB relay limit. *Expect:* it is refused as it is picked, with the most this
   deployment takes, before any bytes move and with no source made. The plan table, every limit
   beneath it and the organization's limits all say 25 MB, and so does `products_read(limits)`.

## Not covered here

The limits a picture is made within, and hostile images and PDFs, are in
`apps/server/test/attachment-pictures.test.ts` and `apps/server/test/hostile-uploads.test.ts`. A file
sent straight to a bucket needs a bucket: `apps/server/test/direct-uploads.test.ts` holds what the
server does, and a rehearsal on the dev deployment what the bucket does.
