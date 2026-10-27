import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { goldenRefusal, type GoldenRecord } from "../src/e2e.ts";
import { mayLeaveProduction, nodePgUrl, pgDumpCommand, refusalOf, type PullRecord } from "../src/fixture.ts";
import type { LocalPg } from "../src/testing/pg.ts";

describe("pulling a copy of a deployment", () => {
  it("gives pg_dump the database's password in its environment, never on its command line", () => {
    for (const [url, password, dbname] of [
      ["postgresql://backup:s3cr%40t@db.example/whatbuild?sslmode=require&channel_binding=require", "s3cr@t", "postgresql://backup@db.example/whatbuild?sslmode=require&channel_binding=require"],
      ["postgres://backup:hunter2@/whatbuild?host=/cloudsql/example:region:db", "hunter2", "postgres://backup@/whatbuild?host=/cloudsql/example:region:db"],
      ["postgres://backup@db.example/whatbuild?password=hunter3&sslmode=require", "hunter3", "postgres://backup@db.example/whatbuild?sslmode=require"],
    ] as const) {
      const { args, env } = pgDumpCommand(url, "/tmp/database.dump");
      expect(args.join(" "), url).not.toContain(password);
      expect(args.join(" ")).not.toContain(encodeURIComponent(password));
      expect(args).toContain(`--dbname=${dbname}`);
      expect(env["PGPASSWORD"]).toBe(password);
    }
    const none = pgDumpCommand("postgres://backup@db.example/whatbuild", "/tmp/database.dump");
    expect(none.args).toEqual(["--format=custom", "--file=/tmp/database.dump", "--dbname=postgres://backup@db.example/whatbuild"]);
    expect(none.env["PGPASSWORD"]).toBe(process.env["PGPASSWORD"]);
  });

  it("reads the deployment with node's client using its trusted authorities where libpq would use the system's", () => {
    expect(nodePgUrl("postgresql://backup:pw@db.example/whatbuild?sslmode=verify-full&sslrootcert=system")).toBe("postgresql://backup:pw@db.example/whatbuild?sslmode=verify-full");
    expect(nodePgUrl("postgresql://backup:pw@db.example/whatbuild?sslrootcert=system")).toBe("postgresql://backup:pw@db.example/whatbuild");
    for (const url of ["postgresql://backup:pw@db.example/whatbuild?sslmode=require&sslrootcert=/etc/ca.pem", "postgres://backup@db.example/whatbuild"]) expect(nodePgUrl(url)).toBe(url);
  });
});

describe("what a copy outside production loads", () => {
  const organizations = [{ tenant_id: "01JZZZZZZZZZZZZZZZZZZZZZZZ", slug: "my-example", name: "My Example" }];
  const checked: PullRecord = { pulled_at: "2026-10-27T00:00:00.000Z", organizations, rows: {}, files: true, owned_by_instance_owners: true };

  it("is a pull that checked an instance owner owns every organization in it", () => {
    expect(mayLeaveProduction(checked)).toBe(true);
    expect(refusalOf("2026-10-27T0000Z", checked)).toBeUndefined();
  });

  it("is never a pull from before pulls checked owners, a pull of every organization, or a pull to move into another deployment", () => {
    const { owned_by_instance_owners: _, ...before } = checked;
    expect(refusalOf("2026-10-12T0552Z", before)).toMatch(/taken before pulls checked who owns each organization.*pull again: pnpm fixture pull/);
    expect(refusalOf("2026-10-12T0552Z", { ...before, organizations: "all" })).toMatch(/taken before pulls checked/);
    expect(mayLeaveProduction({ ...checked, organizations: "all" })).toBe(false);
    const moving: PullRecord = { ...before, for_another_deployment: true };
    expect(refusalOf("2026-10-27T0100Z", moving)).toMatch(/move its organizations into another production deployment, and goes only there/);
    expect(mayLeaveProduction({ ...moving, owned_by_instance_owners: true })).toBe(false);
  });

  it("refuses to load such a pull before it touches the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "whatbuild-pulls-"));
    try {
      mkdirSync(join(dir, "2026-10-12T0552Z"));
      writeFileSync(join(dir, "2026-10-12T0552Z", "database.dump"), "");
      writeFileSync(join(dir, "2026-10-12T0552Z", "pulled.json"), JSON.stringify({ pulled_at: "2026-10-12T05:52:00.000Z", organizations, files: false }));
      vi.stubEnv("WHATBUILD_FIXTURE_DIR", dir);
      vi.resetModules();
      const { restorePull } = await import("../src/fixture.ts");
      // A database it never reaches: the refusal comes first.
      const local = {} as LocalPg;
      await expect(restorePull(local, "fixture", join(dir, "blobs"))).rejects.toThrow(/taken before pulls checked who owns each organization/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is never a golden master built from a pull that did not check owners", () => {
    const golden: GoldenRecord = { built_at: "2026-10-27T00:00:00.000Z", pull: "2026-10-27T0000Z", migration: "0001_x", commit: "abc1234", example: "my-example", standard: "my-example-standard", synthetic: "harbor-labs", products: [] };
    expect(goldenRefusal(golden)).toMatch(/Build it again from a new pull: pnpm fixture pull, then pnpm e2e golden/);
    expect(goldenRefusal({ ...golden, owned_by_instance_owners: true })).toBeUndefined();
  });
});

describe("a pull to move organizations into another deployment", () => {
  it("names its organizations, and goes through a directory only its operator reads", async () => {
    vi.stubEnv("WHATBUILD_FIXTURE_DIR", "");
    try {
      const { pull } = await import("../src/fixture.ts");
      await expect(pull(["--for-another-deployment"])).rejects.toThrow(/moves the organizations named with --org, and only those/);
      await expect(pull(["--all", "--for-another-deployment"])).rejects.toThrow(/moves the organizations named with --org/);
      await expect(pull(["--org", "their-org", "--for-another-deployment"])).rejects.toThrow(/set WHATBUILD_FIXTURE_DIR to one/);
      await expect(pull(["--all", "--org", "my-example"])).rejects.toThrow(/not both/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
