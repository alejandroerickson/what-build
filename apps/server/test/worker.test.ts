import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPorts } from "../src/app.ts";
import { JOB_KINDS, Worker } from "../src/worker.ts";
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

  it("does no housekeeping while the database has a migration this version does not carry, and says so once", async () => {
    // A worker of its own, whose hourly housekeeping is due at its first look.
    const logs: string[] = [];
    const worker = new Worker({ db: h.db, ports: createPorts(h.config, h.blobs, h.mailer, () => undefined) }, 60_000, (m) => logs.push(m));
    // A job done eight days ago, which housekeeping deletes.
    const done = await sql<{ job_id: number }>`
      insert into jobs (tenant_id, kind, payload, done_at) values (${tenantId}, 'delete_blobs', '{"keys":[],"prefixes":[]}'::jsonb, now() - interval '8 days') returning job_id`.execute(h.db);
    const kept = async () => (await sql<{ n: number }>`select count(*)::int as n from jobs where job_id = ${done.rows[0]!.job_id}`.execute(h.db)).rows[0]!.n === 1;
    await sql`insert into schema_migrations (name) values ('9999_from_a_later_release.sql')`.execute(h.db);
    try {
      await worker.drain();
      await worker.drain();
      expect(await kept()).toBe(true);
      expect(logs.filter((m) => m.includes("9999_from_a_later_release.sql"))).toHaveLength(1);
    } finally {
      await sql`delete from schema_migrations where name = '9999_from_a_later_release.sql'`.execute(h.db);
    }
    await worker.drain();
    expect(await kept()).toBe(false);
  });

  it("looks again in the statements that take and give up a job, so a migration recorded while it works stops it at once", async () => {
    // A release's migration job records its migration while this worker runs a job, after the
    // worker last looked: claiming the next job, and giving up one abandoned at its last attempt,
    // each look again themselves.
    const queue = async (payload: Record<string, unknown>, attempts = 0) =>
      (await sql<{ job_id: number }>`insert into jobs (tenant_id, kind, payload, attempts) values (${tenantId}, 'delete_blobs', ${JSON.stringify(payload)}::jsonb, ${attempts}) returning job_id`.execute(h.db)).rows[0]!.job_id;
    const job = async (id: number) => (await sql<{ attempts: number; done_at: string | null; error: string | null }>`select attempts, done_at, error from jobs where job_id = ${id}`.execute(h.db)).rows[0]!;
    const running = await queue({ keys: ["t/stray/blob"], prefixes: [] });
    const next = await queue({ keys: [], prefixes: [] });
    let abandoned = 0;
    const remove = h.blobs.delete;
    h.blobs.delete = async (key: string) => {
      if (key === "t/stray/blob") {
        await sql`insert into schema_migrations (name) values ('9999_from_a_later_release.sql')`.execute(h.db);
        // A job that stopped the server at its last attempt, left as the migration is recorded.
        abandoned = await queue({ keys: [], prefixes: [] }, 5);
      }
      return remove.call(h.blobs, key);
    };
    try {
      expect(await h.worker.drain()).toBe(1);
      expect(await job(running)).toMatchObject({ done_at: expect.any(String), error: null });
      expect(await job(next)).toEqual({ attempts: 0, done_at: null, error: null });
      expect(await job(abandoned)).toEqual({ attempts: 5, done_at: null, error: null });
    } finally {
      h.blobs.delete = remove;
      await sql`delete from schema_migrations where name = '9999_from_a_later_release.sql'`.execute(h.db);
    }
    await h.worker.drain();
    expect(await job(next)).toMatchObject({ attempts: 1, done_at: expect.any(String), error: null });
    expect(await job(abandoned)).toMatchObject({ done_at: expect.any(String), error: expect.stringContaining("gave it up") });
  });
});
