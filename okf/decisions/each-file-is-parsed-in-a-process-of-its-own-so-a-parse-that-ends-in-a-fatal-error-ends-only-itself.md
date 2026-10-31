---
type: Decision
title: Each file is parsed in a child process of its own, so a parse that ends in a fatal error ends only itself
description: The job worker starts a child process for every parse, which runs it in a worker thread held to a heap limit and a watch on its buffers; the server holds the time limit with SIGKILL, and a child that ends short of an answer leaves a failed derivation, or a retry when that need not be the file's doing.
tags: [decision, architecture, parsers, security, availability]
generated: {by: agent:claude, at: 2026-10-31}
status: stable
---

# Each file is parsed in a child process of its own, so a parse that ends in a fatal error ends only itself

## Context

The job worker runs in the server's process ([decision](one-stateless-image.md)). Each file was
parsed in a worker thread of that process
([the record this replaces](each-file-is-parsed-in-a-thread-of-its-own-with-memory-and-time-limits.md)),
which rejected a child process per file for the cost of starting one and because it still shares
the instance's memory. The maintainer chose the process on 2026-10-31: a parse that ends in a fatal
error then ends only itself, and its costs, set out below, are worth that.

## Decision

- `runDerivation` parses through the `FileParser` port. The server's implementation
  (`apps/server/src/parse-process.ts`) starts a child process per file with `spawn`, and the child
  (`parse-child.ts`) parses in a worker thread (`parse-worker.ts`).
- The limits keep their meaning. In the child, the thread's heap is limited to
  `WHATBUILD_PARSE_MEMORY_MB` (288 by default, for a 1 GiB instance), and its buffers are read every
  50 ms and held to half of it. The server holds `WHATBUILD_PARSE_TIMEOUT_SECONDS` (120) and ends
  the child with SIGKILL. Past any of them the derivation is `failed`, with its reason.
- A child that began its work and then ends in a fatal error, exits, or gives an answer that cannot
  be read leaves a `failed` derivation that says so, at once. What need not be the file's doing is
  tried again, up to five attempts in all, and the reading then gives the last reason: a child that
  cannot be started, one that ends before its thread runs (for want of memory or threads, say), and
  one killed from outside, since what is killed may not be what used the memory.
- This is a boundary for crashes, not for privilege. The child starts with none of the server's
  variables, flags, sockets or files: `spawn` rather than `fork`, for no inherited `execArgv`; an
  empty environment; the bytes, the file's name and the limits only on its pipes. It runs as the same
  user on the same network, so code that took over a parse could still reach what that user can,
  as it could from a thread. Making it a privilege boundary would be another decision.
- Bytes travel on raw pipes, not `fork`'s IPC, whose messages Node reads whole before anyone can see
  their size. What the child writes is counted as it arrives, held to limits (the text to half of
  `WHATBUILD_PARSE_MEMORY_MB`, each frame to 256 KiB, each field to `READING_LIMITS`), and validated,
  so that what passes is what the store holds. Rejected: `v8.deserialize` of the answer, which is not
  safe on bytes from a process that may be broken.
- A child leads a process group of its own, and the group is killed when its parse ends, so what a
  parse started ends with it unless it left the group. A child also ends when the server dies, since
  its end of a pipe closes and the child's event loop is free to see it, and shortly after its time
  limit if the server has not ended it, with a signal of its own that reads as that limit.
- A shutdown (`FileParser.stop`) rejects the parse running with `ParseStopped`, and the worker puts
  its job back: the lock cleared, the attempt not spent for the job's first hour, nothing recorded against the file. The
  database ends only after that (`apps/server/src/shutdown.ts`), within the platform's stop window.
- On Linux the child raises its own `oom_score_adj`. That asks the kernel to choose it before the
  server where the kernel ends one process at a time (plain Docker on Linux, say). It is no protection
  where the platform ends the whole container: Cloud Run terminates an instance over its limit, and
  Kubernetes on cgroup v2 can end a container as a group (`memory.oom.group`). What protects the
  server there is the margin the default leaves. A rehearsal's step test shows which a deployment is on
  ([dev deployment](../operations/dev-deployment.md)).
- A job that stops the server anyway is tried at most five times, then given up and recorded as
  failed (`apps/server/src/worker.ts`).

## Consequences

- A parse that ends in a fatal error costs one failed derivation; the server answers throughout, and
  the next file gets a fresh process.
- Each parse pays for starting a process and a thread: under a millisecond to spawn, and about 70 MiB of
  memory before a parse begins. Its process's peak is more than the budget, since a heap carries
  more than its limit counts: about 660 MiB at the default limit in the heaviest case measured, and
  occasionally more, more than twice the limit at this size. That is why the default is 288 and not the 384 a thread had: with
  the server and the file's own bytes, it leaves about a sixth of 1 GiB clear.
- The child shares the instance's memory, whose limit the platform enforces, so a parse's peak counts
  beside the server's. Rehearsing a release that changes parsing reads both, from the processes
  themselves, since a per-minute metric cannot see a peak of a second or two
  ([dev deployment](../operations/dev-deployment.md)).
- A legitimate file that needs more than the budget fails with its reason; a deployment with more
  memory raises `WHATBUILD_PARSE_MEMORY_MB`.

## Constrains

- `packages/parsers` stays pure and in TypeScript that erases (`erasableSyntaxOnly`), and so do
  `parse-child.ts` and `parse-worker.ts`: Node loads them from source in development and tests, and
  `apps/server/build.mjs` bundles both beside `dist/main.js`. The image's build runs a parse through
  them (`node main.js check-parsing`), so an image that cannot parse fails there.
- The entries import nothing of the server. A stored file is never parsed in the server's process.

Specified in: [§5.1](../spec/05-derived-layer.md#51-reading-an-attachment), [§2.3](../spec/02-architecture.md#23-the-shape-of-the-deployment), [§9.2](../spec/09-data-lifecycle.md#92-limits-and-quotas).
