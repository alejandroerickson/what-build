import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, inject, it, vi } from "vitest";
import { goldenRefusal, type GoldenRecord } from "../src/e2e.ts";
import { loadSchema, loadSchemaSql, mayLeaveProduction, nodePgUrl, pgDumpCommand, refusalOf, withoutPgAttver, type PullRecord } from "../src/fixture.ts";
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

describe("loading a deployment's schema into the embedded Postgres", () => {
  // The statement exactly as pg_dump writes it from a database on Neon.
  const neon = "ALTER TABLE ONLY public.mockup_folders ALTER COLUMN folder_id SET (pg_attver=1921165920);";

  it("drops a statement whose only option is pg_attver", () => {
    expect(withoutPgAttver(`CREATE TABLE public.mockup_folders (\n    folder_id text NOT NULL\n);\n${neon}\n\n\nALTER TABLE public.x OWNER TO y;\n`)).toBe(
      "CREATE TABLE public.mockup_folders (\n    folder_id text NOT NULL\n);\n\n\nALTER TABLE public.x OWNER TO y;\n",
    );
  });

  it("keeps every other option of the statement, quoted or bare", () => {
    expect(withoutPgAttver("ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=-1, pg_attver=42);")).toBe("ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=-1);");
    expect(withoutPgAttver("ALTER TABLE ONLY public.t ALTER COLUMN c SET (pg_attver=42, n_distinct=5, n_distinct_inherited=-0.5);")).toBe(
      "ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=5, n_distinct_inherited=-0.5);",
    );
    expect(withoutPgAttver("ALTER TABLE ONLY public.t ALTER COLUMN c SET (pg_attver='42');")).toBe("");
    expect(withoutPgAttver(`ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct='-1', pg_attver="42");`)).toBe("ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct='-1');");
    expect(withoutPgAttver(`ALTER TABLE ONLY public."odd, SET (name" ALTER COLUMN "a b" SET (pg_attver=7, n_distinct=-1);`)).toBe(
      `ALTER TABLE ONLY public."odd, SET (name" ALTER COLUMN "a b" SET (n_distinct=-1);`,
    );
    expect(withoutPgAttver("ALTER FOREIGN TABLE ONLY public.f ALTER COLUMN c SET (pg_attver=7);")).toBe("");
  });

  it("leaves every other line as it was", () => {
    const untouched = [
      "ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=-1);",
      "ALTER TABLE ONLY public.t ALTER COLUMN c SET STATISTICS 500;",
      "ALTER TABLE ONLY public.t ALTER COLUMN c SET STORAGE EXTERNAL;",
      "ALTER TABLE public.t SET (fillfactor=70);",
      "-- ALTER TABLE ONLY public.t ALTER COLUMN c SET (pg_attver=1);",
      "COMMENT ON COLUMN public.t.c IS 'SET (pg_attver=1)';",
      "    note text DEFAULT 'pg_attver=1'::text,",
      "ALTER TABLE ONLY public.t ALTER COLUMN c SET (n_distinct=-1)",
    ].join("\n");
    expect(withoutPgAttver(untouched)).toBe(untouched);
  });

  const admin = () => new pg.Client({ connectionString: inject("adminUrl") });
  const appUrl = (db: string) => inject("appUrlTemplate").replace("{db}", db);
  const adminUrl = (db: string) => Object.assign(new URL(inject("adminUrl")), { pathname: `/${db}` }).toString();
  const made: string[] = [];
  async function database() {
    const name = `schema_${randomBytes(4).toString("hex")}`;
    const c = admin();
    await c.connect();
    await c.query(`create database "${name}" owner whatbuild`).finally(() => c.end());
    made.push(name);
    return name;
  }
  async function inspect(db: string) {
    const c = new pg.Client({ connectionString: adminUrl(db) });
    await c.connect();
    try {
      const columns = await c.query<{ attname: string; attoptions: string[] | null }>(
        "select attname, attoptions from pg_attribute where attrelid = to_regclass('public.items') and attnum > 0 and not attisdropped order by attnum",
      );
      const rls = await c.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = to_regclass('public.items')");
      return { options: Object.fromEntries(columns.rows.map((r) => [r.attname, r.attoptions])), rls: rls.rows[0]?.relrowsecurity };
    } finally {
      await c.end();
    }
  }
  afterAll(async () => {
    const c = admin();
    await c.connect();
    for (const name of made) await c.query(`drop database if exists "${name}"`);
    await c.end();
  });

  it("loads a schema dump, keeping its real column options and row-level security", async (ctx) => {
    const major = (cmd: string) => {
      try {
        return Number(/\(PostgreSQL\) (\d+)/.exec(execFileSync(cmd, ["--version"], { encoding: "utf8" }))?.[1] ?? 0);
      } catch {
        return 0;
      }
    };
    const source = await database();
    const c = new pg.Client({ connectionString: appUrl(source) });
    await c.connect();
    const server = Number((await c.query<{ v: string }>("show server_version_num")).rows[0]!.v) / 10000;
    await c.query(`create table items (item_id text primary key, tenant_id text not null, title text);
      alter table items alter column tenant_id set (n_distinct = -0.25);
      alter table items enable row level security;
      create policy items_tenant on items using (tenant_id = current_setting('app.tenant_id', true));
      comment on column items.title is 'SET (pg_attver=1) stays in a comment';`);
    await c.end();
    // pg_dump refuses a server newer than itself.
    if (Math.min(major("pg_dump"), major("pg_restore")) < Math.floor(server)) ctx.skip();

    const dir = mkdtempSync(join(tmpdir(), "whatbuild-schema-test-"));
    try {
      const dump = pgDumpCommand(adminUrl(source), join(dir, "schema.dump"), ["--schema-only"]);
      execFileSync("pg_dump", dump.args, { env: dump.env });
      const target = await database();
      await loadSchema(appUrl(target), join(dir, "schema.dump"));
      expect(await inspect(target)).toEqual({ options: { item_id: null, tenant_id: ["n_distinct=-0.25"], title: null }, rls: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A schema as pg_restore writes it from a dump of a database on Neon.
  const script = (statement: string) => `--
-- PostgreSQL database dump
--

\\restrict SampleRestrictKey0

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

CREATE TABLE public.items (
    item_id text NOT NULL,
    tenant_id text NOT NULL,
    title text
);
ALTER TABLE ONLY public.items ALTER COLUMN item_id SET (pg_attver=1921165920);
ALTER TABLE ONLY public.items ALTER COLUMN tenant_id SET (n_distinct=-0.25, pg_attver=1921165921);
${statement}

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (item_id);

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\\unrestrict SampleRestrictKey0
`;

  it("loads a schema whose columns carry Neon's pg_attver option, without it", async () => {
    const target = await database();
    await loadSchemaSql(appUrl(target), script("ALTER TABLE ONLY public.items ALTER COLUMN title SET (pg_attver=1921165922);"));
    expect(await inspect(target)).toEqual({ options: { item_id: null, tenant_id: ["n_distinct=-0.25"], title: null }, rls: true });
  });

  it("stops at any other error, and leaves the database empty", async () => {
    const target = await database();
    await expect(loadSchemaSql(appUrl(target), script("ALTER TABLE ONLY public.items ALTER COLUMN title SET (no_such_option=1);"))).rejects.toThrow(
      /schema did not load into the embedded Postgres: unrecognized parameter "no_such_option"/,
    );
    expect(await inspect(target)).toEqual({ options: {}, rls: undefined });
    await expect(loadSchemaSql(appUrl(target), script("\\connect other"))).rejects.toThrow(/syntax error at or near "\\" \(line \d+: \\connect other\)/);
    expect(await inspect(target)).toEqual({ options: {}, rls: undefined });
  });
});
