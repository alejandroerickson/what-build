import { SEARCH_SLOTS } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DATABASE_POOL_SIZE, databasePoolSizeFrom, loadConfig } from "../src/config.ts";
import { createDb, openDatabase } from "../src/database.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe("a connection the database drops", () => {
  it("does not stop the server, while it is held or while it is idle, and the next statement finds a fresh one", async () => {
    const warnings: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((line: string) => void warnings.push(line));
    const { db, pool } = createDb(h.config.databaseUrl, 2);
    try {
      // Held: a transaction between statements, as a job's is while it reads a file.
      const held = db.transaction().execute(async (trx) => {
        const { pid } = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx)).rows[0]!;
        await sql`select pg_terminate_backend(${pid})`.execute(h.db);
        await new Promise((r) => setTimeout(r, 300));
      });
      await expect(held).rejects.toThrow();
      // Idle: back in the pool when the database drops it.
      const { pid } = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db)).rows[0]!;
      await sql`select pg_terminate_backend(${pid})`.execute(h.db);
      await new Promise((r) => setTimeout(r, 300));
      expect((await sql<{ one: number }>`select 1 as one`.execute(db)).rows[0]!.one).toBe(1);
      expect(warnings.map((w) => JSON.parse(w).event)).toContain("database_connection_lost");
    } finally {
      spy.mockRestore();
      await pool.end();
    }
  });
});

describe("WHATBUILD_DATABASE_POOL_SIZE", () => {
  const config = (env: Record<string, string>) => loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://localhost/x", ...env });

  it("is 10 unless set, as before it was a setting", () => {
    expect(DATABASE_POOL_SIZE.default).toBe(10);
    expect(config({}).databasePoolSize).toBe(10);
    expect(config({ WHATBUILD_DATABASE_POOL_SIZE: "" }).databasePoolSize).toBe(10);
    expect(databasePoolSizeFrom("  ")).toBe(10);
  });

  it("takes a whole number from 5 to 100", () => {
    expect(config({ WHATBUILD_DATABASE_POOL_SIZE: "30" }).databasePoolSize).toBe(30);
    expect(databasePoolSizeFrom(" 40 ")).toBe(40);
    expect(databasePoolSizeFrom("5")).toBe(5);
    expect(databasePoolSizeFrom("100")).toBe(100);
  });

  it("stops the server starting on anything else, naming the setting and the range", () => {
    for (const v of ["4", "0", "101", "1000", "-10", "12.5", "1e2", "0x10", "ten", "25 connections", "+20"])
      expect(() => config({ WHATBUILD_DATABASE_POOL_SIZE: v }), v).toThrow(/WHATBUILD_DATABASE_POOL_SIZE must be a whole number from 5 to 100/);
  });

  it("leaves the searches a server runs at once fewer connections than the pool holds, with room for a job and a request", () => {
    expect(DATABASE_POOL_SIZE.least).toBeGreaterThanOrEqual(SEARCH_SLOTS + 2);
  });

  it("is how many connections the server's pool opens at once, however many statements wait", async () => {
    const { db, pool } = openDatabase(loadConfig({ NODE_ENV: "test", DATABASE_URL: h.config.databaseUrl, WHATBUILD_DATABASE_POOL_SIZE: "6" }));
    try {
      expect(pool.options.max).toBe(6);
      const statements = Array.from({ length: 9 }, () => sql`select pg_sleep(1.5) /* pool-size-check */`.execute(db));
      await new Promise((r) => setTimeout(r, 600));
      const running = await sql<{ n: number }>`
        select count(*)::int as n from pg_stat_activity
        where state = 'active' and query like '%pool-size-check%' and pid <> pg_backend_pid()`.execute(h.db);
      expect(running.rows[0]!.n).toBe(6);
      expect(pool.totalCount).toBe(6);
      expect(pool.waitingCount).toBe(3);
      await Promise.all(statements);
      expect(pool.totalCount).toBeLessThanOrEqual(6);
    } finally {
      await pool.end();
    }
  });

  it("is 10 for the server's pool when unset", async () => {
    const { pool } = openDatabase(loadConfig({ NODE_ENV: "test", DATABASE_URL: h.config.databaseUrl }));
    try {
      expect(pool.options.max).toBe(10);
    } finally {
      await pool.end();
    }
  });
});
