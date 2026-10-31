import { trace } from "@opentelemetry/api";
import { sql } from "kysely";
import type { Db, Tx } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * A search may not take the server with it. One server runs a few at once, so the rest of its
 * connections stay free for everything else; more wait a moment or are refused; and each runs under
 * a time limit, stopped sooner if whoever asked has gone. Stopped, its transaction rolls back and
 * its connection goes back to the pool.
 */

/** How long one search may run, every statement in it together. */
export const SEARCH_BUDGET_MS = 5_000;
/** How many searches one server runs at once, of the 10 connections its pool holds. */
export const SEARCH_SLOTS = 3;
/** How many more may wait for a slot, and how long. They hold no connection while they wait. */
export const SEARCH_QUEUE = 12;
export const SEARCH_WAIT_MS = 2_000;
/** A search that takes longer than this finishes, and is logged. */
const SEARCH_SLOW_MS = 1_000;
/** How often a stopped search's statement is cancelled again, until its transaction has ended. */
const CANCEL_AGAIN_MS = 250;
const QUERY_CANCELED = "57014";

export const searchTimedOut = (budgetMs: number) =>
  new AppError(503, "search_timed_out", `This search took longer than ${budgetMs / 1000} seconds, so it was stopped. Nothing was changed. Try more specific words, or try again in a moment.`, { budget_ms: budgetMs });

export const searchBusy = () =>
  new AppError(503, "search_busy", "WhatBuild is running as many searches as it can just now, so this one did not start. Nothing was changed. Try again in a moment.", { retry_after_seconds: 1 });

/** Nobody reads this answer: whoever asked has gone. It is what the call is counted as. */
export const searchCancelled = () => new AppError(499, "search_cancelled", "Whoever asked for this search stopped waiting for it, so it was stopped.");

function note(severity: "INFO" | "WARNING", event: string, gate: SearchGate, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), severity, event, ...fields, searches_running: gate.running, searches_waiting: gate.waiting });
  if (severity === "WARNING") console.warn(line);
  else console.log(line);
}

/** One server's searches: how many run, and who waits for a slot, first come first served. */
export class SearchGate {
  readonly budgetMs: number;
  private readonly slots: number;
  private readonly queue: number;
  private readonly waitMs: number;
  private inSlots = 0;
  private readonly waiters: { admit(): void }[] = [];

  constructor(options: { budgetMs?: number; slots?: number; queue?: number; waitMs?: number } = {}) {
    this.budgetMs = options.budgetMs ?? SEARCH_BUDGET_MS;
    this.slots = options.slots ?? SEARCH_SLOTS;
    this.queue = options.queue ?? SEARCH_QUEUE;
    this.waitMs = options.waitMs ?? SEARCH_WAIT_MS;
  }

  get running() {
    return this.inSlots;
  }

  get waiting() {
    return this.waiters.length;
  }

  /** Take a slot, waiting for one if there is room to, until `leave`. */
  async enter(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw searchCancelled();
    if (this.inSlots < this.slots) {
      this.inSlots++;
      return;
    }
    if (this.waiters.length >= this.queue) {
      note("WARNING", "search_busy", this);
      throw searchBusy();
    }
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
      };
      const waiter = {
        admit: () => {
          done();
          this.inSlots++;
          resolve();
        },
      };
      const onAbort = () => {
        done();
        reject(searchCancelled());
      };
      const timer = setTimeout(() => {
        done();
        note("WARNING", "search_busy", this);
        reject(searchBusy());
      }, this.waitMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  leave(): void {
    this.inSlots--;
    this.waiters[0]?.admit();
  }
}

/**
 * Run a search in a slot, under the gate's time limit and `signal`. `work` runs the search's one
 * transaction and calls `begin` first in it. Each statement also carries the limit in
 * `statement_timeout`, for that transaction alone, so a search ends even when cancelling it cannot
 * get a connection. A cancelled statement ends the transaction: Postgres refuses the rest. Between
 * statements nothing is running to cancel, so it is cancelled again until the transaction has ended.
 */
export async function boundedSearch<T>(env: { db: Db; gate: SearchGate }, signal: AbortSignal | undefined, work: (begin: (trx: Tx) => Promise<void>) => Promise<T>): Promise<T> {
  const { db, gate } = env;
  const asked = Date.now();
  await gate.enter(signal);
  const started = Date.now();
  let backend: { pid: number; began: string } | null = null;
  let stopped: "timed_out" | "cancelled" | null = null;
  let cancelling = false;
  let again: ReturnType<typeof setInterval> | undefined;
  const refusal = (why: "timed_out" | "cancelled") => (why === "timed_out" ? searchTimedOut(gate.budgetMs) : searchCancelled());
  // Named by when its transaction began, so a connection that has moved on to other work is left alone.
  const cancel = async () => {
    if (!backend || cancelling) return;
    cancelling = true;
    try {
      await sql`select pg_cancel_backend(a.pid) from pg_stat_activity a where a.pid = ${backend.pid} and a.xact_start = ${backend.began}::timestamptz`.execute(db);
    } catch {
      // The statement's own time limit still ends it.
    } finally {
      cancelling = false;
    }
  };
  const stop = (why: "timed_out" | "cancelled") => {
    if (stopped) return;
    stopped = why;
    void cancel();
    again = setInterval(() => void cancel(), CANCEL_AGAIN_MS);
  };
  const deadline = setTimeout(() => stop("timed_out"), gate.budgetMs);
  const onAbort = () => stop("cancelled");
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  // How long it waited and ran go on the trace; the log says only what is out of the ordinary.
  const report = (outcome: "finished" | "timed_out" | "cancelled") => {
    const ms = Date.now() - started;
    trace.getActiveSpan()?.setAttributes({ "whatbuild.search.waited_ms": started - asked, "whatbuild.search.ran_ms": ms });
    if (outcome === "timed_out") note("WARNING", "search_stopped", gate, { outcome, ms });
    else if (outcome === "cancelled") note("INFO", "search_stopped", gate, { outcome, ms });
    else if (ms > SEARCH_SLOW_MS) note("WARNING", "search_slow", gate, { ms });
  };
  try {
    const result = await work(async (trx) => {
      if (stopped) throw refusal(stopped);
      const r = await sql<{ pid: number; began: string }>`select pg_backend_pid() as pid, now()::text as began, set_config('statement_timeout', ${String(gate.budgetMs)}, true)`.execute(trx);
      backend = r.rows[0]!;
      if (stopped) throw refusal(stopped);
    });
    report("finished");
    return result;
  } catch (e) {
    // Once it is stopped, whatever failed failed because it was; a statement's own time limit is the same stop.
    const why = stopped ?? ((e as { code?: string } | null)?.code === QUERY_CANCELED ? "timed_out" : null);
    if (!why) throw e;
    report(why);
    throw refusal(why);
  } finally {
    backend = null;
    clearTimeout(deadline);
    clearInterval(again);
    signal?.removeEventListener("abort", onAbort);
    gate.leave();
  }
}
