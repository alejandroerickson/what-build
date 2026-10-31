import type { ServerType } from "@hono/node-server";
import { usageSettled, type FileParser } from "@whatbuild/core";
import type { Pool } from "pg";
import type { Worker } from "./worker.ts";

/**
 * How long a shutdown may take before the process exits anyway. Cloud Run ends an instance ten
 * seconds after its SIGTERM, and whatever is unfinished then is lost with no line to say so.
 */
export const SHUTDOWN_LIMIT_MS = 8000;

/**
 * What a server or a worker does when it is told to stop, in the order that loses nothing. The
 * worker takes no more jobs and the parse running is stopped at once; the database goes last, since
 * the job that parse belonged to is put back in the queue through it, and the calls already answered
 * are counted through it.
 */
export async function shutDown(parts: { worker: Worker; parser: FileParser; pool: Pool; server?: ServerType; tracing?: { shutdown(): Promise<unknown> } | null }): Promise<void> {
  const drained = parts.worker.stop();
  parts.parser.stop();
  const { server } = parts;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await drained;
  await usageSettled();
  await parts.tracing?.shutdown();
  await parts.pool.end();
}
