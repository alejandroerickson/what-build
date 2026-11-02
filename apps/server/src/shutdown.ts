import type { ServerType } from "@hono/node-server";
import { usageSettled, type FileParser, type LiveChanges } from "@whatbuild/core";
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
 * are counted through it. Live streams end first: each holds a connection open, which the server's
 * close would otherwise wait for until the limit above.
 */
export async function shutDown(parts: { worker: Worker; parser: FileParser; pool: Pool; server?: ServerType; live?: LiveChanges; tracing?: { shutdown(): Promise<unknown> } | null }): Promise<void> {
  parts.live?.close();
  const drained = parts.worker.stop();
  parts.parser.stop();
  const { server } = parts;
  if (server)
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // A connection whose stream just ended goes idle a moment after the close looked for idle ones.
      if (parts.live && "closeIdleConnections" in server) setTimeout(() => server.closeIdleConnections(), 100).unref();
    });
  await drained;
  await usageSettled();
  await parts.tracing?.shutdown();
  await parts.pool.end();
}
