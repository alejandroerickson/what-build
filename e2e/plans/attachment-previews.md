---
title: Real files look like themselves in the list of sources and its preview, and an HTML attachment can do nothing
organizations: [standard]
people: [sam]
surfaces: [web]
---

# Attachment previews

Sources are known by what they look like. This plan checks that on real files, which the tests,
making theirs from nothing, can't: decks saved by PowerPoint, scans, phone photos, recordings and
web pages. Get them first, on the machine running the browser:

```sh
node scripts/fetch-test-attachments.mjs
```

`e2e/test-attachments.json` says what each file exercises. A file whose address has stopped working
is left out of the run, and the report says so. Upload them to one product of the standard
organization as Sam, one source each, as the file names suggest, through the web app (so that a video
and a web page get their pictures), then wait for the worker. The plan offers the example file's
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
4. **Recordings.** Stop on a video in the preview. *Expect:* no request for it in the network panel
   until Play is pressed. Press Play: *expect* it to play, the requests to be for pieces of at most
   8 MiB, and, for someone who can write, the row to get a frame soon after. Seek twice, then read the
   organization's limits: *expect* the day's data sent to have grown by about what played, never the
   file again for each seek. A file the browser can't play (ProRes, say) says so, with a download,
   even where its sound would play.
5. **Web pages.** *Expect:* each shows in a sandboxed frame, with a line saying it runs no scripts and
   loads nothing from elsewhere, and once someone who can write has stopped on it, or uploaded it,
   its row shows a picture of it. A page that relies on what it loads shows plain, and stays a small
   page of words if it draws blank.
6. **A hostile page.** Attach `e2e/hostile-page.html` and stop on it in the preview, with the network
   panel open. *Expect:* the title of the app's tab never changes, and the app stays where it is. Every
   request to `hostile.example.com` shows as blocked by the page's policy, and none reaches a network.
   Press its button and its link: nothing happens. The row's picture shows the heading and the table.
   Open the attachment's address without `/view`: *expect* a download, not a page.
7. **Cost.** With the network panel open, hold the down arrow through twenty sources. *Expect:* no call
   for sources passed through, and the pictures served with no call counted (`/api/v1/pictures/…`, from
   the browser's cache on a second pass).

## Not covered here

The limits a picture is made within, and hostile images and PDFs, are in
`apps/server/test/attachment-pictures.test.ts` and `apps/server/test/hostile-uploads.test.ts`.
