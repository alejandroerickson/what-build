import { hostname } from "node:os";
import {
  blobsSafeToDelete, indexSources, lockSandbox, markExportFailed, pruneFeedbackCounts, pruneUsage, runDerivation, runEvidenceMove, runExport, sendFeedbackDigest, stagedPrototypeKeys, type Env,
} from "@whatbuild/core";
import { sql } from "kysely";
import { pruneOAuthClients } from "./auth/oauth.ts";
import { migrationNames } from "./database.ts";

/** A reading's blobs. One made while sources had passages also has a segments.jsonl, and an older one an outline.md, released with the rest. */
const SIDECARS = ["segments.jsonl", "text.md", "outline.md", "manifest.json"];
/** A job is tried at most this many times, whether it failed or the process stopped while running it. */
const MAX_ATTEMPTS = 5;
/**
 * What the reading of a file whose every attempt failed with an error says, recorded when the worker
 * gives the read up, so its attachment says it could not be read instead of "Reading" for good.
 */
const READ_GIVEN_UP = `this file could not be read: reading it failed ${MAX_ATTEMPTS} times, so it was given up; the file is stored, and reading it again may help (Read it again in the web app, or derived(action="rederive"))`;
/** How often an instance looks whether the feedback digest is due. */
const DIGEST_CHECK_MS = 10 * 60_000;
/**
 * The kinds of job this version runs. A worker claims only these, so while a release rolls out, an
 * instance of the version before it leaves a kind a new migration queued for the new version,
 * instead of failing it and spending its attempts. A job no running version knows waits.
 */
export const JOB_KINDS = ["derive", "export", "move_to_evidence", "delete_blobs", "index_texts"] as const;

interface Job {
  job_id: number;
  tenant_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * The job worker: claims work from the Postgres queue with SKIP LOCKED, so any number of replicas
 * can run it without a broker. Derivation always runs here, never inside the request that uploaded
 * the file, in every environment, and the parse itself in a worker thread of its own held to a
 * memory and a time limit (parse-thread.ts). A job that stops the process anyway, or fails, is given
 * up after five attempts, and a read given up records a failed reading of its attachment.
 */
export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  private stopped = false;
  /** Whether the last look found a later version's migrations; the log says so once, when they appear. */
  private superseded = false;
  /** The migrations this version carries; a database that has any other was migrated by a later version. */
  private readonly migrations = migrationNames();
  readonly id = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

  constructor(private readonly env: Env, private readonly pollMs = 2000, private readonly log: (m: string) => void = (m) => console.log(m)) {}

  start() {
    this.stopped = false;
    const tick = () => {
      if (this.stopped) return;
      void this.drain().finally(() => {
        if (!this.stopped) this.timer = setTimeout(tick, this.pollMs);
      });
    };
    tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Called after a commit that enqueued work. */
  wake() {
    if (this.running) this.again = true;
    else void this.drain();
  }

  async drain(): Promise<number> {
    if (this.running) {
      this.again = true;
      return 0;
    }
    this.running = true;
    let done = 0;
    try {
      do {
        this.again = false;
        if (await this.supersededByAMigration()) break;
        for (;;) {
          await this.prune().catch((e) => this.log(`prune: ${(e as Error).message}`));
          await this.feedbackDigest().catch((e) => this.log(`feedback digest: ${(e as Error).message}`));
          await this.giveUpAbandoned().catch((e) => this.log(`give up: ${(e as Error).message}`));
          const job = await this.claim();
          if (!job) break;
          await this.run(job);
          done++;
        }
      } while (this.again);
    } catch (e) {
      this.log(`worker: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return done;
  }

  /**
   * Whether the database has a migration this version does not carry. During a release the
   * migration job runs before the new version serves, while this one still does. From then on it
   * takes no job and does no housekeeping, so work a new migration queued, under a kind this version
   * also runs, waits for the version it was queued for instead of being run, skipped or given up by
   * code written for the schema before it. The claim itself checks the same, in the statement that
   * takes the job, so nothing slips through between this look and a claim.
   */
  private async supersededByAMigration(): Promise<boolean> {
    const later = await sql<{ name: string }>`select name from schema_migrations where name <> all(${this.migrations}::text[]) order by name`.execute(this.env.db);
    const names = later.rows.map((r) => r.name);
    // Said for both ways it ends: the release rolling out takes over, or, after going back, the database is restored.
    if (names.length && !this.superseded)
      this.log(
        `worker: the database has migrations this version does not carry (${names.join(", ")}); it takes no jobs and does no housekeeping until a version that carries them replaces it, or the database is restored to before them`,
      );
    this.superseded = names.length > 0;
    return this.superseded;
  }

  private lastPrune = 0;
  private lastDigestCheck = 0;

  /**
   * The feedback digest, when the deployment names an address for it: looked at on start and every
   * ten minutes while the instance is alive; `sendFeedbackDigest` decides whether one is due.
   */
  private async feedbackDigest() {
    if (!this.env.ports.config.feedbackEmail || Date.now() - this.lastDigestCheck < DIGEST_CHECK_MS) return;
    this.lastDigestCheck = Date.now();
    const sent = await sendFeedbackDigest(this.env.db, this.env.ports);
    if (sent) this.log(`feedback digest: ${sent} report(s) sent`);
  }

  /** Housekeeping, at most hourly: finished jobs after a week; OAuth registrations nobody connected with; people's days of use after 14 months; feedback counts of days that are over; abandoned upload grants and canvas uploads, and their bytes; expired Story previews. */
  private async prune() {
    if (Date.now() - this.lastPrune < 3600_000) return;
    this.lastPrune = Date.now();
    await sql`delete from jobs where done_at < now() - interval '7 days'`.execute(this.env.db);
    await pruneOAuthClients(this.env.db);
    await pruneUsage(this.env.db);
    await pruneFeedbackCounts(this.env.db);
    // A sandbox's counters: a minute's are read within that minute, a day's until the next reset.
    await sql`delete from sandbox_usage where (bucket = 'minute' and starts_at < now() - interval '1 hour') or starts_at < now() - interval '3 days'`.execute(this.env.db);
    const tenants = await sql<{ tenant_id: string }>`select distinct tenant_id from tenants`.execute(this.env.db);
    for (const { tenant_id } of tenants.rows) {
      const stale = await this.env.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.tenant_id', ${tenant_id}, true)`.execute(trx);
        return trx
          .deleteFrom("upload_grants")
          .where("completed_at", "is", null)
          .where("expires_at", "<", new Date(Date.now() - 86400_000).toISOString())
          .returning(["blob_key", "uploaded_at"])
          .execute();
      });
      // Bytes that arrived but were never attached (a direct upload nobody completed).
      for (const g of stale) if (g.uploaded_at && g.blob_key) await this.env.ports.blobs.delete(g.blob_key).catch(() => undefined);
      // A canvas's ZIP: one never published goes a day after its grant expired; a published one's
      // bytes went when it was published, and its row a week later.
      const canvases = await this.env.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.tenant_id', ${tenant_id}, true)`.execute(trx);
        return trx
          .deleteFrom("mockup_uploads")
          .where((eb) =>
            eb.or([
              eb.and([eb("used_at", "is", null), eb("expires_at", "<", new Date(Date.now() - 86400_000).toISOString())]),
              eb("used_at", "<", new Date(Date.now() - 7 * 86400_000).toISOString()),
            ]),
          )
          .returning(["upload_id", "product_id", "blob_key", "uploaded_at", "used_at"])
          .execute();
      });
      for (const u of canvases) {
        if (!u.uploaded_at || u.used_at) continue;
        // A publish that failed may have stored the prototype's bytes already; they go with the ZIP.
        const zip = await this.env.ports.blobs.get(u.blob_key).catch(() => null);
        if (zip) for (const key of stagedPrototypeKeys(tenant_id, u.product_id, u.upload_id, zip)) await this.env.ports.blobs.delete(key).catch(() => undefined);
        await this.env.ports.blobs.delete(u.blob_key).catch(() => undefined);
      }
      // A Story preview goes once its grant has expired.
      await this.env.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.tenant_id', ${tenant_id}, true)`.execute(trx);
        await trx.deleteFrom("story_previews").where("expires_at", "<", new Date().toISOString()).execute();
      });
    }
  }

  private async claim(): Promise<Job | null> {
    const r = await sql<Job>`
      update jobs set locked_at = now(), locked_by = ${this.id}, attempts = attempts + 1
      where job_id = (
        select job_id from jobs
        where done_at is null and attempts < ${MAX_ATTEMPTS} and run_after <= now() and (locked_at is null or locked_at < now() - interval '10 minutes')
          and kind = any(${[...JOB_KINDS]}::text[])
          and not exists (select 1 from schema_migrations where name <> all(${this.migrations}::text[]))
        order by job_id for update skip locked limit 1)
      returning job_id, tenant_id, kind, payload, attempts`.execute(this.env.db);
    return r.rows[0] ?? null;
  }

  /**
   * Give up the jobs that used every attempt without finishing. A job that fails is given up in
   * `run` (a read in `giveUpRead`); these are the ones the process stopped during, every time, most
   * likely because the job itself took it down (a file that needs more memory than the server has).
   * Claiming one again would take the server down again, so it is marked done, and a derivation or
   * an export records that it failed.
   */
  private async giveUpAbandoned(): Promise<void> {
    const reason = `the server stopped while running this ${MAX_ATTEMPTS} times, most likely for lack of memory or time, so WhatBuild gave it up`;
    const abandoned = await sql<Job>`
      update jobs set done_at = now(), locked_at = null, locked_by = null, error = ${reason}
      where job_id in (
        select job_id from jobs
        where done_at is null and attempts >= ${MAX_ATTEMPTS} and (locked_at is null or locked_at < now() - interval '10 minutes')
          and kind = any(${[...JOB_KINDS]}::text[])
          and not exists (select 1 from schema_migrations where name <> all(${this.migrations}::text[]))
        order by job_id for update skip locked limit 20)
      returning job_id, tenant_id, kind, payload, attempts`.execute(this.env.db);
    for (const job of abandoned.rows) {
      this.log(`job ${job.job_id} ${job.kind} given up after ${job.attempts} attempts that never finished`);
      if (job.kind !== "derive" && job.kind !== "export") continue;
      await this.env.db
        .transaction()
        .execute(async (trx) => {
          await sql`select set_config('app.tenant_id', ${job.tenant_id}, true)`.execute(trx);
          if (job.kind === "export") return markExportFailed(trx, String(job.payload["export_id"]), reason);
          await runDerivation(trx, this.env.ports, {
            tenant_id: job.tenant_id,
            record_id: String(job.payload["record_id"]),
            file_version_id: String(job.payload["file_version_id"]),
            force: Boolean(job.payload["force"]),
            quiet: Boolean(job.payload["quiet"]),
            failed: `reading this file stopped the server ${MAX_ATTEMPTS} times, so it was given up; the file is stored, and rederive tries again`,
          });
        })
        .catch((e) => this.log(`job ${job.job_id}: recording that it was given up failed: ${(e as Error).message}`));
    }
  }

  private async run(job: Job) {
    const started = Date.now();
    try {
      await this.env.db.transaction().execute(async (trx) => {
        await sql`select set_config('app.tenant_id', ${job.tenant_id}, true)`.execute(trx);
        // A public sandbox's reset waits for work in progress, and work waits for a reset.
        await lockSandbox(trx, job.tenant_id, "shared");
        if (job.kind === "derive") {
          const out = await runDerivation(trx, this.env.ports, {
            tenant_id: job.tenant_id,
            record_id: String(job.payload["record_id"]),
            file_version_id: String(job.payload["file_version_id"]),
            force: Boolean(job.payload["force"]),
            quiet: Boolean(job.payload["quiet"]),
          });
          this.log(`job ${job.job_id} derive ${job.payload["record_id"]}: ${out ? out.status : "skipped"} in ${Date.now() - started} ms`);
        } else if (job.kind === "export") {
          const out = await runExport(trx, this.env.ports, { tenant_id: job.tenant_id, export_id: String(job.payload["export_id"]) });
          this.log(`job ${job.job_id} export: ${out ? `${out.files} files, ${out.size} bytes` : "skipped"} in ${Date.now() - started} ms`);
        } else if (job.kind === "move_to_evidence") {
          const out = await runEvidenceMove(trx, this.env.ports, { tenant_id: job.tenant_id, product_id: String(job.payload["product_id"]) });
          this.log(`job ${job.job_id} move_to_evidence ${job.payload["product_id"]}: ${out ? `${out.insights} insights, ${out.decisions} decisions` : "skipped"} in ${Date.now() - started} ms`);
        } else if (job.kind === "index_texts") {
          const n = await indexSources(trx, { product_id: String(job.payload["product_id"]) });
          this.log(`job ${job.job_id} index_texts ${job.payload["product_id"]}: ${n} sources in ${Date.now() - started} ms`);
        } else if (job.kind === "delete_blobs") {
          // A blob that a sandbox's baseline refers to stays: a reset would bring its source back.
          const safe = await blobsSafeToDelete(trx, job.tenant_id, (job.payload["keys"] as string[]) ?? [], (job.payload["prefixes"] as string[]) ?? []);
          for (const key of safe.keys) await this.env.ports.blobs.delete(key);
          for (const prefix of safe.prefixes) for (const s of SIDECARS) await this.env.ports.blobs.delete(`${prefix}/${s}`);
        } else {
          throw new Error(`unknown job kind ${job.kind}`);
        }
        await trx.updateTable("jobs").set({ done_at: new Date().toISOString(), error: null }).where("job_id", "=", job.job_id).execute();
      });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 500) ?? String(e);
      const final = job.attempts >= MAX_ATTEMPTS || job.kind === "export";
      if (final && job.kind === "derive") return this.giveUpRead(job, msg);
      if (job.kind === "export")
        await this.env.db.transaction().execute(async (trx) => {
          await sql`select set_config('app.tenant_id', ${job.tenant_id}, true)`.execute(trx);
          await markExportFailed(trx, String(job.payload["export_id"]), msg);
        });
      this.log(`job ${job.job_id} ${job.kind} failed (attempt ${job.attempts}${final ? ", giving up" : ""}): ${msg}`);
      await this.env.db
        .updateTable("jobs")
        .set({
          error: msg,
          locked_at: null,
          locked_by: null,
          run_after: new Date(Date.now() + 2 ** job.attempts * 5000).toISOString(),
          ...(final ? { done_at: new Date().toISOString() } : {}),
        })
        .where("job_id", "=", job.job_id)
        .execute();
    }
  }

  /**
   * Give up a read whose last attempt failed with an error, recording in the same transaction a
   * `failed` reading of its attachment version that says it could not be read and that reading it
   * again may help. Its attachment then says so, where it would read "Reading" for good, and Read it
   * again (`derived.rederive`) reads it afresh. The statement that gives it up looks for a later
   * version's migration, as the claim and the abandoned jobs' give-up do: while the database has one,
   * the attempt may have failed on that version's schema, so the job is left for the version that
   * carries it, this attempt not spent, and nothing is recorded. Should the give-up itself fail, the
   * job keeps its lock, and the abandoned jobs' give-up takes it once that is ten minutes old.
   */
  private async giveUpRead(job: Job, error: string): Promise<void> {
    const outcome = await this.env.db
      .transaction()
      .execute(async (trx): Promise<"given up" | "left" | "taken over"> => {
        await sql`select set_config('app.tenant_id', ${job.tenant_id}, true)`.execute(trx);
        await lockSandbox(trx, job.tenant_id, "shared");
        const given = await sql`
          update jobs set done_at = now(), locked_at = null, locked_by = null, error = ${error}
          where job_id = ${job.job_id} and done_at is null and locked_by = ${this.id}
            and not exists (select 1 from schema_migrations where name <> all(${this.migrations}::text[]))
          returning job_id`.execute(trx);
        if (!given.rows.length) {
          const left = await sql`
            update jobs set locked_at = null, locked_by = null, error = ${error}, attempts = attempts - 1
            where job_id = ${job.job_id} and done_at is null and locked_by = ${this.id}
            returning job_id`.execute(trx);
          return left.rows.length ? "left" : "taken over";
        }
        await runDerivation(trx, this.env.ports, {
          tenant_id: job.tenant_id,
          record_id: String(job.payload["record_id"]),
          file_version_id: String(job.payload["file_version_id"]),
          force: Boolean(job.payload["force"]),
          quiet: Boolean(job.payload["quiet"]),
          failed: READ_GIVEN_UP,
        });
        return "given up";
      })
      .catch((e: Error) => e);
    const failed = `job ${job.job_id} derive failed (attempt ${job.attempts}`;
    if (outcome === "given up") this.log(`${failed}, giving up; its reading is recorded as failed): ${error}`);
    else if (outcome === "left") this.log(`${failed}): ${error}; left, this attempt not spent, for the version that carries the database's later migrations`);
    else if (outcome === "taken over") this.log(`${failed}): ${error}; another worker has taken it over`);
    else this.log(`${failed}, giving up): ${error}; recording that it was given up failed (${outcome.message}), so it is given up once its lock is ten minutes old`);
  }
}
