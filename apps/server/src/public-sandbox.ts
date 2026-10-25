import { loadSandbox, lockSandbox, resetIsDue, resetToBaseline, sandboxNotice, sha256Hex, type ActorSnapshot, type Db, type Env } from "@whatbuild/core";
import { Hono } from "hono";
import { sql } from "kysely";

/** The scheduled reset is the service's own act, attributed as the parser's work is. */
const SCHEDULE: ActorSnapshot = { account_id: "system", display_name: "WhatBuild", surface: null, client: "schedule" };

/** How long an instance trusts what it last read about when a reset is due. */
const RECHECK_MS = 30_000;

/**
 * Make the tenant the deployment names the public sandbox, and no other. Run at start-up: the
 * deployment's configuration is what decides, and the database holds it so that policy can read it.
 * Taking the name away closes the sandbox: a visitor's grant counts only while the flag is set.
 */
export async function syncSandboxTenant(db: Db, slug: string | null, log: (m: string) => void = console.log): Promise<string | null> {
  await db.updateTable("tenants").set({ sandbox: false }).where("sandbox", "=", true).where("slug", "!=", slug ?? "").execute();
  if (!slug) return null;
  const tenant = await db.selectFrom("tenants").select(["tenant_id", "sandbox"]).where("slug", "=", slug).executeTakeFirst();
  if (!tenant) {
    log(`warning: WHATBUILD_SANDBOX_TENANT names "${slug}", and no organization has that slug. There is no public sandbox until one does and the service restarts.`);
    return null;
  }
  if (!tenant.sandbox) {
    await db.updateTable("tenants").set({ sandbox: true }).where("tenant_id", "=", tenant.tenant_id).execute();
    log(`Organization "${slug}" is the public sandbox.`);
  }
  return tenant.tenant_id;
}

/**
 * Runs a sandbox's scheduled reset once its hour has passed. The service scales to nothing, so no
 * timer can promise the hour: instead the first request after it runs the reset before it is
 * served, and a scheduler may call `POST /api/v1/sandbox/reset-if-due` to wake an instance at the
 * hour. Nothing looks between requests, so the database can sleep while an instance is up.
 */
export class SandboxClock {
  private nextCheck = 0;
  private running: Promise<unknown> | null = null;

  constructor(private readonly env: Env, private readonly log: (m: string) => void = (m) => console.log(m)) {}

  /** Forget what was read, so the next request looks again: after the settings change on this instance. */
  touch() {
    this.nextCheck = 0;
  }

  /** Reset every sandbox whose hour has passed. Cheap when none has: one read every half minute. */
  async resetIfDue(): Promise<{ reset: boolean; results: unknown[] }> {
    if (Date.now() < this.nextCheck) return { reset: false, results: [] };
    if (this.running) {
      await this.running.catch(() => undefined);
      return { reset: false, results: [] };
    }
    const run = this.run();
    this.running = run;
    try {
      const results = await run;
      return { reset: results.length > 0, results };
    } finally {
      this.running = null;
    }
  }

  private async run(): Promise<unknown[]> {
    const results: unknown[] = [];
    const tenants = await this.env.db.selectFrom("tenants").select(["tenant_id", "slug"]).where("sandbox", "=", true).execute();
    let soonest = Date.now() + RECHECK_MS;
    for (const t of tenants) {
      const state = await loadSandbox(this.env.db, t.tenant_id);
      if (!resetIsDue(state)) {
        soonest = Math.min(soonest, Date.parse(state.day_end));
        continue;
      }
      try {
        let enqueued = false;
        const done = await this.env.db.transaction().execute(async (trx) => {
          await sql`select set_config('app.tenant_id', ${t.tenant_id}, true)`.execute(trx);
          await lockSandbox(trx, t.tenant_id, "exclusive");
          // Another instance may have run it while this one waited for the lock.
          const now = await loadSandbox(trx, t.tenant_id);
          if (!resetIsDue(now)) return null;
          return resetToBaseline(trx, t.tenant_id, {
            by: SCHEDULE,
            scheduled: true,
            idle_days: now.settings.visitor_idle_days,
            now: new Date().toISOString(),
            enqueue: async (kind, payload) => {
              await trx.insertInto("jobs").values({ tenant_id: t.tenant_id, kind, payload: JSON.stringify(payload) }).execute();
              enqueued = true;
            },
          });
        });
        if (enqueued) this.env.ports.notifyJobs?.();
        if (done) {
          this.log(`sandbox ${t.slug}: reset to baseline ${done.baseline_id}, ${done.rows} rows, ${done.blobs_dropped} blobs dropped, ${done.visitors_removed} idle visitors removed`);
          results.push({ organization: t.slug, ...done });
        }
      } catch (e) {
        // Looked at again on the next request: a reset that fails must not take the service with it.
        this.log(`sandbox ${t.slug}: the scheduled reset failed: ${(e as Error).message}`);
        soonest = Date.now() + 5_000;
      }
    }
    this.nextCheck = Math.min(soonest, Date.now() + RECHECK_MS);
    return results;
  }
}

/** What someone holding an invitation link may know before they sign in: whether it still admits anyone, and what they are entering. */
export async function inviteInfo(db: Db, code: string) {
  const inv = await db
    .selectFrom("sandbox_invites as i")
    .innerJoin("tenants as t", "t.tenant_id", "i.tenant_id")
    .select(["i.tenant_id", "i.max_uses", "i.used", "i.expires_at", "i.revoked_at", "t.name", "t.sandbox"])
    .where("i.code_hash", "=", sha256Hex(code))
    .executeTakeFirst();
  if (!inv || !inv.sandbox) return null;
  const state = await loadSandbox(db, inv.tenant_id);
  const seats = await db
    .selectFrom("memberships")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", inv.tenant_id)
    .where("scope_type", "=", "tenant")
    .where("role", "=", "visitor")
    .executeTakeFirst();
  const status = inv.revoked_at
    ? "revoked"
    : inv.expires_at && Date.parse(inv.expires_at) < Date.now()
      ? "expired"
      : inv.used >= inv.max_uses
        ? "used_up"
        : state.settings.visitor_access === "closed"
          ? "closed"
          : Number(seats?.n ?? 0) >= state.settings.max_visitors
            ? "full"
            : "open";
  return { tenant_id: inv.tenant_id, status, organization: inv.name, notice: sandboxNotice(state), settings: state.settings, resets_enabled: state.settings.reset_enabled && Boolean(state.baseline_id) };
}

/** The invitation code in a path the sign-in flow was asked to return to, if it is one. */
export function inviteCodeIn(next: string | null | undefined): string | null {
  return /^\/join\/([A-Za-z0-9_-]{10,200})$/.exec(next ?? "")?.[1] ?? null;
}

export function sandboxRoutes(deps: { db: Db; clock: SandboxClock }) {
  const app = new Hono();
  const noStore = { "Cache-Control": "no-store" };

  // For a scheduler. It needs no credential: it does nothing unless a reset is due, and a due reset
  // would run at the next request anyway. It looks no more often than any request does.
  app.post("/api/v1/sandbox/reset-if-due", async (c) => {
    const r = await deps.clock.resetIfDue();
    return c.json({ reset: r.reset, sandboxes: r.results.length }, 200, noStore);
  });

  // Public, so the page behind an invitation link can say what it is before asking anyone to sign in.
  app.get("/api/v1/sandbox/invite", async (c) => {
    const info = await inviteInfo(deps.db, c.req.query("code") ?? "");
    if (!info) return c.json({ error: { code: "not_found", status: 404, message: "This invitation link is not valid. Check that the whole link was copied, or ask for a new one." } }, 404, noStore);
    const s = info.settings;
    return c.json(
      {
        status: info.status,
        organization: info.organization,
        notice: info.notice,
        resets: info.resets_enabled ? { time: s.reset_time, timezone: s.reset_timezone } : null,
        limits: { file_max_bytes: s.file_max_bytes, sources_per_day: s.sources_per_day, writes_per_day: s.writes_per_day, bytes_per_day: s.bytes_per_day },
      },
      200,
      noStore,
    );
  });
  return app;
}
