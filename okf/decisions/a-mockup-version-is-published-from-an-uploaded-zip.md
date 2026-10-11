---
type: Decision
title: A mockup version is published from an uploaded ZIP in the download's layout
description: An agent with a canvas on disk PUTs it as one ZIP through the upload relay and publishes it by upload_id, so pages never pass through a tool call; inline publishing stays for small changes.
tags: [decision, mockups, uploads, agents, security, mcp]
generated: {by: agent:claude, at: 2026-10-10}
status: stable
---

# A mockup version is published from an uploaded ZIP in the download's layout

## Context

`mockups.publish` took every page's HTML and every file's content inline. An agent whose canvas
lives in its own project (captured from a running app, or downloaded with `get_download` and
changed) had to write all of it out through its own output: slow, costly, and open to silent
copying errors, against the rule the skill already gives for sources, never to put file bytes in a
tool call. A request body is capped at 5 MB, while a version may hold 8,000,000 characters of
HTML, so a large canvas could only be built up over several versions. Two shapes were live: one
grant for a ZIP of the whole version, or a grant for each page.

## Decision

- **One ZIP, in `get_download`'s layout.** `mockups.request_upload` grants one PUT through the
  service's own upload relay, and `mockups.publish` takes the `upload_id` in place of `pages`,
  `files` and `brief`. Download, change, upload is one symmetric round trip, and an unchanged
  page goes back byte for byte. Per-page grants were rejected: a canvas of dozens of pages would
  need dozens of grants and PUTs, and a version that must be atomic would have to be assembled
  from separate uploads.
- **Publishing keeps its meaning.** The manifest's pages are the whole canvas in order; what the
  archive leaves out is carried from the base version; etags, `from_version` and the HTML checks
  are the same; the version is one transaction. Refs and citations come only from the call.
- **The archive is hostile input**, read in memory with sizes bounded before and while inflating,
  and refused whole for anything unsafe or unnamed by the manifest.
- **A grant is short-lived, single-use, and bound** to the product, the requesting account and one
  mockup (or a new one). The public sandbox's limits apply as to any upload and any write.
- **Inline publishing stays** for small changes.
- **The page limit rises from 24 to 48 a version**; 8,000,000 characters of HTML, 50 files and
  2,000,000 characters of files stay. The body cap no longer bounds a version, the canvas loads
  page frames lazily, and the total HTML still bounds what a version stores.
- **A Story page is not uploaded yet.** One page fits in a call (at most 1,000,000 characters);
  uploading one is planned on the [roadmap](../spec/10-roadmap.md).

## Consequences

- An agent publishes a large canvas in one version, with two small tool calls and one PUT.
- Grants and their bytes are new state: a table, a relay route, and the worker's cleanup.
- An agent without a shell or HTTP tool still publishes inline, within the body cap.

## Constrains

- Uploaded archives are read only by `readZip` (`packages/core/src/zip-archive.ts`) and
  `readCanvasArchive` (`packages/core/src/ops/mockups.ts`); nothing is unpacked to disk.
- Upload and download share one layout; a change to `mockupBundle` changes what publish reads.
- Bytes arrive only through the relay (`apps/server/src/uploads.ts`), never in a call.

Specified in: [06 §6.7](../spec/06-operations-and-adapters.md), [04 §4.12](../spec/04-data-model.md), [09 §9.2](../spec/09-data-lifecycle.md).
