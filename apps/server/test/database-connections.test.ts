import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/database.ts";
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
