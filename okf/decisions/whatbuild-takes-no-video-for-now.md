---
type: Decision
title: WhatBuild takes no video for now, and keeps the video it already holds as files to download
description: Video is large, and storing and serving it waits for a later release, so every way a file comes in refuses one with 415 video_not_accepted; a video already stored stays, listed with any picture it has and downloaded whole, never played; audio is taken as before.
tags: [decision, product, attachments, evidence, mockups, storage, cost]
generated: {by: agent:claude, at: 2026-11-15}
status: stable
---

# WhatBuild takes no video for now, and keeps the video it already holds as files to download

## Context

A source could hold a video: it was stored, played in the browser in pieces, given a frame from
the player as its picture, and never transcribed. Video is the largest thing people upload, by far,
and every deployment pays to store it and to serve it each time it plays. What a team needs from a
recording is its words, which come from its transcript, not from the video itself. The maintainer
chose on 2026-11-15 that WhatBuild stops taking video with the next release, and that video can
come back in a later one.

## Decision

- **No new video, wherever a file comes in.** A file is a video by its extension (`VIDEO_EXTENSIONS`:
  `.mp4`, `.mov`, `.webm`, `.mkv`, `.m4v`, `.avi` and the like) or, when its extension is neither a
  video's nor a recording's, by the media type WhatBuild gives it (`video/*`). Upload grants
  (`request_upload`, `create_upload`, `create_uploads`), the upload relay and `complete_upload` for a
  grant given before, `fetch_url` (before fetching when the URL or path names a video) and a mockup's
  prototype in its canvas ZIP each refuse one with `415 video_not_accepted`, before a source is made
  or a byte is stored. The message says WhatBuild does not keep video, and to add the transcript, or
  a link to where the video lives, instead. The web app turns a video away as it is picked.
- **Video already stored stays.** Nothing deletes it. It is listed with any picture it has, its
  reading is said as `unsupported`, and it downloads as a file: every request for it gets the whole
  file as an attachment, and no range is answered. Nothing in the web app plays it, and it is given
  no new picture (`set_frame` and `give_picture` take HTML pages only).
- **Audio is unchanged.** A recording is audio: stored, played in pieces of 8 MiB, counted as it is
  sent, never transcribed (`needs_transcript`).
- Rejected: deleting stored video, which loses people's material for a saving a deployment can make
  by its own means; keeping playback for stored video, which keeps the player, frame capture and
  the pieces for files no one can add.

## Consequences

- A team adds a video's transcript, or links to where the video is hosted, instead of the video.
- An agent or script that uploads video is refused and told what to send instead.
- **What would bring video back:** a release that stores and serves it at a cost a deployment can
  bear, such as playback straight from the bucket (the blob port's `signedDownloadUrl`), a plan that
  sends a person more in a day, and limits on video's size or length; it is on the
  [roadmap](../spec/10-roadmap.md) as later work.

## Constrains

- Every path that stores a file checks `isVideoFile` (`packages/core/src/video.ts`, built on
  `isVideo` in `packages/parsers/src/statuses.ts`): a new way in refuses video too.
- `streamFile` in `apps/server/src/documents.ts` serves a stored video whole, as an attachment;
  only audio is answered in pieces (`RECORDING_PIECE_BYTES`).
- No migration deletes or rewrites a stored video or its reading; `currentReading` says an old one as
  a video's.

Specified in: [§5.5](../spec/05-derived-layer.md), [§6](../spec/06-operations-and-adapters.md),
[§7](../spec/07-web-app.md).
