import type { TestProject } from "vitest/node";
import { startLocalPg, type LocalPg } from "../src/testing/pg.ts";

let pgServer: LocalPg | null = null;

/** One Postgres for the whole run; each test file gets its own database in it. */
export async function setup(project: TestProject) {
  keepTheExitCode();
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
