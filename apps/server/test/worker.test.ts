import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPorts } from "../src/app.ts";
import { JOB_KINDS, Worker } from "../src/worker.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let owner: Browser;
let tenantId: string;
let slugs: { tenant: string; team: string };

beforeAll(async () => {
  h = await startHarness();
  owner = await h.signIn("olive@example.com", "Olive Owner");
  const t = await owner.api("POST", "/api/v1/tenants", { name: "Queue Co" });
  tenantId = t.body.tenant.tenant_id;
  slugs = { tenant: t.body.tenant.slug, team: t.body.team.slug };
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
      // Once, with both ways the wait ends: the later version taking over, or the database restored.
      expect(logs.filter((m) => m.includes("9999_from_a_later_release.sql"))).toEqual([
        "worker: the database has migrations this version does not carry (9999_from_a_later_release.sql); it takes no jobs and does no housekeeping until a version that carries them replaces it, or the database is restored to before them",
      ]);
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

describe("a job whose last attempt fails as a later version's migration is recorded", () => {
  // The release's migration job records its migration while this worker's last attempt runs, after
  // the worker and its claim last looked: the give-up looks again itself, and leaves the job, with
  // that attempt not spent, for the version that carries the migration, since the attempt may have
  // failed on that version's schema.
  const LATER = "9999_from_a_later_release.sql";
  const recordLater = () => sql`insert into schema_migrations (name) values (${LATER}) on conflict do nothing`.execute(h.db);
  const forgetLater = () => sql`delete from schema_migrations where name = ${LATER}`.execute(h.db);
  const job = async (id: number) =>
    (await sql<{ attempts: number; done_at: string | null; locked_at: string | null; error: string | null }>`
      select attempts, done_at, locked_at, error from jobs where job_id = ${id}`.execute(h.db)).rows[0]!;

  it("is not given up, whatever its kind: a blob deletion is left for that version, and deletes once it runs", async () => {
    const id = (
      await sql<{ job_id: number }>`
        insert into jobs (tenant_id, kind, payload, attempts) values (${tenantId}, 'delete_blobs', ${JSON.stringify({ keys: ["t/stray/last-attempt"], prefixes: [] })}::jsonb, 4)
        returning job_id`.execute(h.db)
    ).rows[0]!.job_id;
    const remove = h.blobs.delete;
    h.blobs.delete = async (key: string) => {
      if (key !== "t/stray/last-attempt") return remove.call(h.blobs, key);
      await recordLater();
      throw new Error("the store would not delete it");
    };
    try {
      await h.worker.drain();
      expect(await job(id)).toEqual({ attempts: 4, done_at: null, locked_at: null, error: "the store would not delete it" });
    } finally {
      h.blobs.delete = remove;
      await forgetLater();
    }
    // The database holds only migrations this version carries again, as when the version that
    // carries them runs: the job has its last attempt, which deletes the blob.
    await h.worker.drain();
    expect(await job(id)).toMatchObject({ attempts: 5, done_at: expect.any(String), error: null });
  });

  it("leaves an export, which is given up at its first failure, pending for that version, and records its failure with the give-up once there is no such migration", async () => {
    const p = await owner.api("POST", `/api/v1/teams/${slugs.tenant}/${slugs.team}/products`, { name: "Export board" });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const P = `/api/v1/p/${p.body.path}`;
    const started = await owner.api("POST", `${P}/exports`, {});
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const exportId = started.body.export_id as string;
    const id = (await sql<{ job_id: number }>`select job_id from jobs where kind = 'export' and payload->>'export_id' = ${exportId}`.execute(h.db)).rows[0]!.job_id;
    const exported = async () => ((await owner.api("GET", `${P}/exports`)).body.items as { export_id: string; status: string; error: string | null }[]).find((x) => x.export_id === exportId)!;
    const putStream = h.blobs.putStream;
    let later = true;
    // Storing the bundle fails; the first time, as the migration is recorded.
    h.blobs.putStream = async (key, body, options) => {
      if (!key.endsWith(`/exports/${exportId}.zip`)) return putStream.call(h.blobs, key, body, options);
      if (later) await recordLater();
      // Read it all, as a store does, before refusing it.
      for await (const _ of body);
      throw new Error("the store refused the bundle");
    };
    try {
      await h.worker.drain();
      expect(await job(id)).toEqual({ attempts: 0, done_at: null, locked_at: null, error: "the store refused the bundle" });
      expect(await exported()).toMatchObject({ status: "pending", error: null });
      await forgetLater();
      later = false;
      // As the version that carries no later migration: the export runs again, fails, and is given
      // up, its failure recorded in the transaction that gives it up.
      await h.worker.drain();
    } finally {
      h.blobs.putStream = putStream;
      await forgetLater();
    }
    expect(await job(id)).toMatchObject({ attempts: 1, done_at: expect.any(String), locked_at: null, error: "the store refused the bundle" });
    expect(await exported()).toMatchObject({ status: "failed", error: "the store refused the bundle" });
  });
});

describe("a worker started to sleep when idle", () => {
  const until = async (done: () => Promise<boolean> | boolean, ms = 5000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (await done()) return;
    throw new Error("timed out");
  };
  const queue = async (runAfter = "now()") =>
    (
      await sql<{ job_id: number }>`
        insert into jobs (tenant_id, kind, payload, run_after) values (${tenantId}, 'delete_blobs', '{"keys":[],"prefixes":[]}'::jsonb, ${sql.raw(runAfter)})
        returning job_id`.execute(h.db)
    ).rows[0]!.job_id;
  const isDone = async (id: number) => (await sql<{ done: boolean }>`select done_at is not null as done from jobs where job_id = ${id}`.execute(h.db)).rows[0]!.done;
  const worker = () => new Worker({ db: h.db, ports: createPorts(h.config, h.blobs, h.mailer, () => undefined) }, 20, () => {});

  it("stops looking at the queue once idle, and looks again at the next request", async () => {
    const w = worker();
    w.start({ idleMs: 100 });
    try {
      await until(() => w.sleeping);
      // A job nothing announced, as one an instance left when it stopped: a sleeping worker does not see it.
      const id = await queue();
      await new Promise((r) => setTimeout(r, 300));
      expect(await isDone(id)).toBe(false);
      expect(w.sleeping).toBe(true);
      w.nudge();
      expect(w.sleeping).toBe(false);
      await until(() => isDone(id));
      // And sleeps again once that is idle too.
      await until(() => w.sleeping);
    } finally {
      w.stop();
    }
  });

  it("wakes by itself when a job it could take falls due, such as a retry", async () => {
    const id = await queue("now() + interval '700 milliseconds'");
    const w = worker();
    w.start({ idleMs: 50 });
    try {
      await until(() => w.sleeping, 600);
      expect(await isDone(id)).toBe(false);
      await until(() => isDone(id));
    } finally {
      w.stop();
    }
  });

  it("runs a job a commit announces at once, sleeping or not", async () => {
    const w = worker();
    w.start({ idleMs: 50 });
    try {
      await until(() => w.sleeping);
      const id = await queue();
      w.wake();
      await until(() => isDone(id), 1000);
    } finally {
      w.stop();
    }
  });

  it("never sleeps when started without, as the worker command starts it", async () => {
    const w = worker();
    w.start();
    try {
      await new Promise((r) => setTimeout(r, 300));
      expect(w.sleeping).toBe(false);
      const id = await queue();
      await until(() => isDone(id), 1000);
    } finally {
      w.stop();
    }
  });
});
