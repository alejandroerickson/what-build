import type { TestProject } from "vitest/node";
import { startLocalPg, type LocalPg } from "../src/testing/pg.ts";

let pgServer: LocalPg | null = null;

/** One Postgres for the whole run; each test file gets its own database in it. */
export async function setup(project: TestProject) {
  if (process.env["TEST_DATABASE_ADMIN_URL"]) {
    project.provide("adminUrl", process.env["TEST_DATABASE_ADMIN_URL"]);
    project.provide("appUrlTemplate", process.env["TEST_DATABASE_APP_URL_TEMPLATE"] ?? process.env["TEST_DATABASE_ADMIN_URL"]);
    return;
  }
  pgServer = await startLocalPg(".what-build/test-pg", Number(process.env["WHATBUILD_TEST_PG_PORT"] ?? 54331));
  project.provide("adminUrl", pgServer.adminUrl);
  project.provide("appUrlTemplate", pgServer.appUrl("{db}"));
}

export async function teardown() {
  await pgServer?.stop();
}

declare module "vitest" {
  export interface ProvidedContext {
    adminUrl: string;
    appUrlTemplate: string;
  }
}
