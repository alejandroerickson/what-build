---
type: Decision
title: Each file is parsed in a child process of its own, so a parse that ends in a fatal error ends only itself
description: The job worker starts a child process for every parse, which runs it in a worker thread held to a heap limit and a watch on its buffers; the server holds the time limit with SIGKILL, and any way the child ends short of an answer is a failed derivation.
tags: [decision, architecture, parsers, security, availability]
generated: {by: agent:claude, at: 2026-10-31}
status: stable
---

# Each file is parsed in a child process of its own, so a parse that ends in a fatal error ends only itself

## Context

The job worker runs in the server's process ([decision](one-stateless-image.md)). Each file was
parsed in a worker thread of that process
([the record this replaces](each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits.md)).
Threads share a process, and with it whatever ends it; a process is the boundary the operating
system keeps, around a fatal error in V8 or a crash in native code as around anything else. That
record rejected a child process per file for the cost of starting one and because it still shares
the instance's memory. The maintainer chose the process on 2026-10-31: both costs are small beside
that boundary.

## Decision

- `runDerivation` parses through the `FileParser` port. The server's implementation
  (`apps/server/src/parse-process.ts`) starts a child process per file with `spawn`, and the child
  (`parse-child.ts`) parses in a worker thread (`parse-worker.ts`).
- The limits keep their meaning. In the child, the thread's heap is limited to
  `WHATBUILD_PARSE_MEMORY_MB` (384 by default, for a 1 GiB instance), and its buffers are read every
  50 ms and held to half of it. The server holds `WHATBUILD_PARSE_TIMEOUT_SECONDS` (120) and ends
  the child with SIGKILL. Past any of them the derivation is `failed`, saying which limit and its
  value, however the parse was stopped.
- Any other way the child ends short of an answer (a signal, an exit, no answer, one that cannot be
  read) is a `failed` derivation that says so. A child that cannot be started rejects, as that is not
  the file's doing, and the job is tried again.
- Nothing of the server reaches the child: `spawn` rather than `fork`, for no inherited `execArgv`;
  an empty environment; the bytes, the file's name and the limits only on its pipes.
- Bytes travel on raw pipes, not `fork`'s IPC, whose messages Node reads whole before anyone can see
  their size. What the child writes is counted as it arrives, held to limits (the text to half of
  `WHATBUILD_PARSE_MEMORY_MB`, the rest to 4 MiB), and validated. Rejected: `v8.deserialize` of the
  answer, which is not safe on bytes from a process that may be broken.
- A child ends with its parse. It also ends when the server dies, since its end of a pipe closes and
  the child's event loop is free to see it; shortly after its time limit if the server has not ended
  it; and at the server's shutdown (`FileParser.stop`), whose interrupted job goes back in the queue
  with nothing recorded against the file. On Linux it raises its own `oom_score_adj`, so that an
  instance out of memory ends it before the server.
- A job that stops the server anyway is tried at most five times, then given up and recorded as
  failed (`apps/server/src/worker.ts`).

## Consequences

- A parse that ends in a fatal error costs one failed derivation and, while it runs, at most the
  parse's budget; the server answers throughout, and the next file gets a fresh process.
- Each parse pays for starting a process and a thread, in time and in memory beside its budget.
- The child still shares the instance's memory, whose limit the platform enforces. Rehearsing a
  release that changes parsing reads it ([dev deployment](../operations/dev-deployment.md)).
- A legitimate file that needs more than the budget fails with its reason; a deployment with more
  memory raises `WHATBUILD_PARSE_MEMORY_MB`.

## Constrains

- `packages/parsers` stays pure and in TypeScript that erases (`erasableSyntaxOnly`), and so do
  `parse-child.ts` and `parse-worker.ts`: Node loads them from source in development and tests, and
  `apps/server/build.mjs` bundles both beside `dist/main.js`. The image's build runs a parse through
  them (`node main.js check-parsing`), so an image that cannot parse fails there.
- The entries import nothing of the server. A stored file is never parsed in the server's process.

Specified in: [§5.1](../spec/05-derived-layer.md#51-reading-an-attachment), [§2.3](../spec/02-architecture.md#23-the-shape-of-the-deployment), [§9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas).
