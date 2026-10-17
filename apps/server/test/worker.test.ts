import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOB_KINDS } from "../src/worker.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness;
let tenantId: string;

beforeAll(async () => {
  h = await startHarness();
  const owner = await h.signIn("olive@example.com", "Olive Owner");
  const t = await owner.api("POST", "/api/v1/tenants", { name: "Queue Co" });
  tenantId = t.body.tenant.tenant_id;
});
afterAll(async () => h?.close());

describe("the job worker", () => {
  it("leaves a kind of job it does not run for the version that does, without spending its attempts", async () => {
    // What an instance of the previous version sees while a release rolls out: a migration of the
    // new version has queued a kind it was built before.
    const queued = await sql<{ job_id: number }>`insert into jobs (tenant_id, kind, payload) values (${tenantId}, 'from_a_later_release', '{}'::jsonb) returning job_id`.execute(h.db);
    const jobId = queued.rows[0]!.job_id;
    expect(JOB_KINDS).not.toContain("from_a_later_release");
    await h.worker.drain();
    await h.worker.drain();
    const row = await sql<{ attempts: number; done_at: string | null; error: string | null; locked_at: string | null }>`select attempts, done_at, error, locked_at from jobs where job_id = ${jobId}`.execute(h.db);
    expect(row.rows[0]).toEqual({ attempts: 0, done_at: null, error: null, locked_at: null });
  });

  it("takes no job while the database has a migration this version does not carry, and takes it once the version that carries it runs", async () => {
    // What an instance of the previous version sees once a release's migration job has run: work the
    // new migrations queued, of a kind it runs too, for a schema it was not written for.
    await sql`insert into schema_migrations (name) values ('9999_from_a_later_release.sql')`.execute(h.db);
    const queued = await sql<{ job_id: number }>`insert into jobs (tenant_id, kind, payload) values (${tenantId}, 'delete_blobs', ${JSON.stringify({ keys: [], prefixes: [] })}::jsonb) returning job_id`.execute(h.db);
    const jobId = queued.rows[0]!.job_id;
    const job = async () => (await sql<{ attempts: number; done_at: string | null; error: string | null; locked_at: string | null }>`select attempts, done_at, error, locked_at from jobs where job_id = ${jobId}`.execute(h.db)).rows[0]!;
    try {
      expect(await h.worker.drain()).toBe(0);
      expect(await h.worker.drain()).toBe(0);
      expect(await job()).toEqual({ attempts: 0, done_at: null, error: null, locked_at: null });
    } finally {
      await sql`delete from schema_migrations where name = '9999_from_a_later_release.sql'`.execute(h.db);
    }
    // The database holds only migrations this version carries again, as when the new version runs.
    await h.worker.drain();
    expect(await job()).toMatchObject({ attempts: 1, done_at: expect.any(String), error: null });
  });
});
