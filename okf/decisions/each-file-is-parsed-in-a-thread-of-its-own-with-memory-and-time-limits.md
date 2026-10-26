---
type: Decision
title: Each file is parsed in a worker thread of its own, held to a memory and a time limit, so a file can fail but never take the server down
description: The job worker hands every parse to a new thread with a heap limit, a watch on its buffers and a deadline; a parse past any of them ends as a failed derivation and the server keeps answering.
tags: [decision, architecture, parsers, security, availability]
generated: {by: agent:claude, at: 2026-10-17}
status: stable
---

# Each file is parsed in a worker thread of its own, held to a memory and a time limit, so a file can fail but never take the server down

## Context

The job worker runs in the server's process ([decision](one-stateless-image.md)), and anyone let
into an organization can upload a file. A parse that exhausts the process's memory, or keeps its
event loop busy, stops the web app, the API and MCP together. Parsers bound what they can (the
parse cap, unpacked bytes, nesting, pages, paragraphs, patterns that run in one pass), but no list of
bounds covers every input: pdf.js, for one, decodes a compressed stream to whatever size it holds.
A separate parsing service would be a second thing to deploy; a child process per file would cost
a process start per parse and still share the instance's memory.

## Decision

- `runDerivation`, which reads every version of every attachment
  ([§5.1](../spec/05-derived-layer.md#51-reading-an-attachment)), parses through the `FileParser`
  port. The server's implementation (`apps/server/src/parse-thread.ts`) starts a worker thread per
  file with `node:worker_threads`, an empty environment and a copy of the bytes, and ends it when
  the parse ends.
- The thread's heap is limited to `WHATBUILD_PARSE_MEMORY_MB` (384 by default, for a 1 GiB
  instance); its buffers, which the heap limit does not count, are read every 50 ms and held to
  half of it; it runs at most `WHATBUILD_PARSE_TIMEOUT_SECONDS` (120). Past any of them the thread
  is stopped and the derivation is `failed`, saying which limit and its value.
- The thread returns the readable text a reading stores (`text.md`) as bytes (`toParsedFile`),
  handed over without a copy.
- A job that stops the process anyway is tried at most five times, then given up and recorded as
  failed (`apps/server/src/worker.ts`).

## Consequences

- A hostile file costs one failed derivation and, while it runs, at most the parse's budget; the
  server answers throughout, and the next file gets a fresh thread.
- Each parse pays for starting a thread, tens of milliseconds.
- A legitimate file that needs more than the budget fails with its reason; a deployment with more
  memory raises `WHATBUILD_PARSE_MEMORY_MB`.

## Constrains

- `packages/parsers` stays pure and in TypeScript that erases (`erasableSyntaxOnly`): Node loads it
  in the thread from source in development and tests, and `apps/server/build.mjs` bundles the
  thread's entry, `apps/server/src/parse-worker.ts`, beside `dist/main.js`.
- The entry imports nothing of the server. A stored file is never parsed on the main thread.

Specified in: [§5.1](../spec/05-derived-layer.md#51-reading-an-attachment), [§2.3](../spec/02-architecture.md#23-the-shape-of-the-deployment), [§9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas).
