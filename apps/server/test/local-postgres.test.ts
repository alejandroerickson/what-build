import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterEach, describe, expect, inject, it } from "vitest";
import { connectOrStartLocalPg, startLocalPg, UTF8_CLUSTER_BUILTIN } from "../src/testing/pg.ts";

// Local clusters are made in UTF-8 with the C.UTF-8 locale, as Neon's databases are, so text
// functions count characters as production's do. One made before, in SQL_ASCII, is made again when
// it holds nothing to keep (the tests', the end-to-end instance's), and left as it is otherwise.

/** A port nothing listens on now. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function rows<T>(url: string, query: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(query)).rows as T[];
  } finally {
    await c.end();
  }
}

/** A cluster made in `dir` with these initdb flags, as embedded-postgres makes one with none: SQL_ASCII, in the C locale. */
async function madeWith(dir: string, port: number, initdbFlags: string[] = []) {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: true, initdbFlags, onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  return { server, adminUrl: `postgres://postgres:postgres@localhost:${port}/postgres` };
}

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "whatbuild-pg-"));
  dirs.push(dir);
  return join(dir, "pg");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** What a cluster's text functions make of characters beyond ASCII. */
const TEXT = `select left('😀é漢', 2) as two, length('😀é漢') as length, upper('é') as upper,
  (select string_agg(w, ' ' order by w) from unnest(array['é', 'B', 'a']) w) as sorted`;

describe("local Postgres clusters", () => {
  it("are made in UTF-8, counting characters and sorting by code point as production's C.UTF-8 does", async () => {
    const local = await startLocalPg(scratch(), await freePort());
    try {
      expect(local.encoding).toBe("UTF8");
      expect((await rows(local.adminUrl, TEXT))[0]).toEqual({ two: "😀é", length: 3, upper: "É", sorted: "B a é" });
      const [db] = await rows<{ datctype: string; datlocprovider: string; datlocale: string | null }>(
        local.adminUrl,
        "select datctype, datlocprovider, datlocale from pg_database where datname = 'template1'",
      );
      // C.UTF-8 from the system's C library, as on macOS and in CI's Linux; else PostgreSQL's own.
      if (db!.datlocprovider === "c") {
        expect(db!.datctype).toBe("C.UTF-8");
        // Full-text search and trigrams take letters beyond ASCII for letters there.
        expect((await rows<{ t: string }>(local.adminUrl, "select to_tsvector('simple', 'Crème brûlée')::text as t"))[0]!.t).toBe("'brûlée':2 'crème':1");
      } else expect(db).toMatchObject({ datlocprovider: "b", datlocale: "C.UTF-8" });
    } finally {
      await local.stop();
    }
  });

  it("are made in PostgreSQL's own C.UTF-8 where a system has no C.UTF-8 locale", async () => {
    const { server, adminUrl } = await madeWith(scratch(), await freePort(), UTF8_CLUSTER_BUILTIN);
    try {
      expect((await rows(adminUrl, TEXT))[0]).toEqual({ two: "😀é", length: 3, upper: "É", sorted: "B a é" });
    } finally {
      await server.stop();
    }
  });

  it("make a cluster that holds nothing to keep again when it was made in SQL_ASCII, and leave any other as it is", async () => {
    const dir = scratch();
    const port = await freePort();
    const old = await madeWith(dir, port);
    await rows(old.adminUrl, "create database kept");
    await old.server.stop();
    // A person's work: left as it is, and its encoding said.
    const kept = await startLocalPg(dir, port);
    expect(kept.encoding).toBe("SQL_ASCII");
    expect(await kept.hasDatabase("kept")).toBe(true);
    await kept.stop();
    // The tests', or the end-to-end instance's: made again, in UTF-8.
    const made = await startLocalPg(dir, port, { disposable: true });
    try {
      expect(made.encoding).toBe("UTF8");
      expect(await made.hasDatabase("kept")).toBe(false);
      expect((await rows(made.adminUrl, TEXT))[0]).toMatchObject({ two: "😀é", length: 3 });
    } finally {
      await made.stop();
    }
  });

  it("refuse a running cluster made in SQL_ASCII that would be made again, as it cannot be while it runs", async () => {
    const dir = scratch();
    const port = await freePort();
    const old = await madeWith(dir, port);
    try {
      await expect(connectOrStartLocalPg(dir, port, { disposable: true })).rejects.toThrow(
        `The Postgres running on port ${port} was made in SQL_ASCII, before local clusters were made in UTF-8. It holds nothing to keep, but it cannot be made again while it runs: stop what runs it, then try again.`,
      );
      expect((await connectOrStartLocalPg(dir, port)).encoding).toBe("SQL_ASCII");
    } finally {
      await old.server.stop();
    }
  });

  it("hold the suite's own databases in UTF-8, as production's are", async () => {
    expect(await rows(inject("adminUrl"), "show server_encoding")).toEqual([{ server_encoding: "UTF8" }]);
  });
});
