import type { TestProject } from "vitest/node";
import { startLocalPg, type LocalPg } from "../src/testing/pg.ts";

let pgServer: LocalPg | null = null;

/** One Postgres for the whole run; each test file gets its own database in it. */
export async function setup(project: TestProject) {
  keepTheExitCode();
  try {
    await startPostgres(project);
  } catch (error) {
    throw withItsStack(error);
  }
}

async function startPostgres(project: TestProject) {
  if (process.env["TEST_DATABASE_ADMIN_URL"]) {
    project.provide("adminUrl", process.env["TEST_DATABASE_ADMIN_URL"]);
    project.provide("appUrlTemplate", process.env["TEST_DATABASE_APP_URL_TEMPLATE"] ?? process.env["TEST_DATABASE_ADMIN_URL"]);
    return;
  }
  // The tests' cluster holds nothing to keep: one made before local clusters were UTF-8 is made again.
  pgServer = await startLocalPg(".what-build/test-pg", Number(process.env["WHATBUILD_TEST_PG_PORT"] ?? 54331), { disposable: true, portVariable: "WHATBUILD_TEST_PG_PORT" });
  project.provide("adminUrl", pgServer.adminUrl);
  project.provide("appUrlTemplate", pgServer.appUrl("{db}"));
}

export async function teardown() {
  await pgServer?.stop();
}

/**
 * The error with its stack written out, so that vitest prints its message. Vitest 5.0 keeps a
 * cached module of the global setup as bytes, not text, and the source maps Vite puts on every
 * stack fail on it: a stack written when vitest prints the error comes out as `TypeError:
 * code.charCodeAt is not a function` in place of the error, whatever it was (a port another
 * checkout holds, say). Written here, without Vite's source maps, the stack is the plain one. Its
 * line numbers are the compiled module's, so the code frame vitest shows beside it may point at
 * another line of the source; the message and the files are right. Vitest 5.1 reads the module as
 * text, and this can go when the suite runs on it.
 */
function withItsStack(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const prepare = Error.prepareStackTrace;
  (Error as { prepareStackTrace?: unknown }).prepareStackTrace = undefined;
  try {
    error.stack = String(error.stack);
  } finally {
    Error.prepareStackTrace = prepare;
  }
  return error;
}

/**
 * embedded-postgres stops its clusters through async-exit-hook, which answers `beforeExit` with
 * `process.exit(0)`: a run with failed tests would end in success. The code vitest set is put back
 * as the process exits.
 */
function keepTheExitCode() {
  let code: number | string | undefined;
  process.once("beforeExit", () => {
    code = process.exitCode ?? undefined;
  });
  process.once("exit", () => {
    if (code) process.exitCode = code;
  });
}

declare module "vitest" {
  export interface ProvidedContext {
    adminUrl: string;
    appUrlTemplate: string;
  }
}
