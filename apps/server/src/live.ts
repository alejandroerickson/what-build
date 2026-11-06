import { admitRead, AppError, areasFor, isGuest, liveMessage, resolveScope, toAppError, unauthenticated, type Env, type LiveArea, type LiveChanges, type Principal, type ProductRole } from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { accountOfHeldSession, heldSession, isOwnOrigin, restPrincipal, type HeldSession } from "./auth/identity.ts";
import type { ServerConfig } from "./config.ts";
import { errorResponse, SCOPE_PREFIX } from "./rest.ts";

/**
 * Live updates: a tab open on a product holds one response open, and hears that part of the product
 * changed. It then reads what changed through the operations it reads everything else through.
 *
 * Four things keep this from telling anyone what they may not know, each of which holds if another
 * has a mistake in it:
 *
 * - A message can say nothing but the areas that changed (`liveMessage`): no id, no content.
 * - Opening a stream is the check any read of the product's Story meets, for a browser's session
 *   only, and only from the app's own pages. The channel is the product that check resolved.
 * - Before anything is sent, the session and the role are asked again, so someone signed out or taken
 *   out hears nothing and their stream ends. Anything that goes wrong in asking ends it too.
 * - No stream outlives `lifeMs`, and the tab has to pass the first check again to go on.
 *
 * A stream that hears nothing asks the database nothing, so it cannot keep one that suspends awake:
 * the questions above are asked only after a write, when the database is awake anyway.
 *
 * This hub lives in one process, so with more than one instance a tab hears only of changes made on
 * its own instance, and the person refreshes to see the rest, as they would with this turned off.
 */

/** A comment, which keeps the connection and whatever is between open, and tells a tab it is still there. */
const HEARTBEAT = ": still here\n\n";
const OPENED = ": listening\n\n";
/** Chunks a stream may fall behind before it is ended: nothing is reading it. */
const MOST_BEHIND = 32;

export interface LiveHubOptions {
  /** How long changes to one product are gathered into one message. */
  coalesceMs?: number;
  heartbeatMs?: number;
  /** The longest a stream lasts, less up to a tenth at random, so streams opened together do not all end together. */
  lifeMs?: number;
  maxStreams?: number;
  /** How many streams one person may hold, more than the windows anyone keeps in view. */
  maxPerAccount?: number;
  log?: (fields: Record<string, unknown>) => void;
}

/** Whether, and as what, the person a stream serves may still hear of this product. Null: they may not. */
export type Recheck = () => Promise<ProductRole | null>;

interface Stream {
  product: string;
  account: string;
  opened: number;
  endsAt: number;
  recheck: Recheck;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
}

const encoder = new TextEncoder();

export class LiveHub implements LiveChanges {
  private readonly coalesceMs: number;
  private readonly heartbeatMs: number;
  private readonly lifeMs: number;
  private readonly maxStreams: number;
  private readonly maxPerAccount: number;
  private readonly log: (fields: Record<string, unknown>) => void;
  private readonly byProduct = new Map<string, Set<Stream>>();
  private readonly pending = new Map<string, Set<LiveArea>>();
  private beat: ReturnType<typeof setInterval> | null = null;
  private closing = false;
  private count = 0;

  constructor(options: LiveHubOptions = {}) {
    this.coalesceMs = options.coalesceMs ?? 5_000;
    this.heartbeatMs = options.heartbeatMs ?? 25_000;
    this.lifeMs = options.lifeMs ?? 4 * 60_000;
    this.maxStreams = options.maxStreams ?? 25;
    this.maxPerAccount = options.maxPerAccount ?? 5;
    this.log = options.log ?? (() => undefined);
  }

  /** How many streams are open. */
  get open(): number {
    return this.count;
  }

  /** Whether no stream can be opened, asked before anything else so that a refusal wakes no database. */
  get full(): boolean {
    return this.closing || this.count >= this.maxStreams;
  }

  changed(productId: string, area: LiveArea): void {
    if (!this.byProduct.has(productId)) return;
    const areas = this.pending.get(productId);
    if (areas) {
      areas.add(area);
      return;
    }
    this.pending.set(productId, new Set([area]));
    setTimeout(() => void this.flush(productId), this.coalesceMs).unref();
  }

  /**
   * A new stream for someone already let in, or null when there is no room for it. `gone` says the
   * request has gone: one that goes while it is being let in never reads the stream, so nothing else
   * would ever end it.
   */
  listen(productId: string, account: string, recheck: Recheck, gone?: AbortSignal): ReadableStream<Uint8Array> | null {
    if (gone?.aborted || this.full || this.heldBy(account) >= this.maxPerAccount) return null;
    const now = Date.now();
    const stream: Stream = { product: productId, account, opened: now, endsAt: now + this.lifeMs * (0.9 + Math.random() * 0.1), recheck, closed: false };
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        stream.controller = controller;
        controller.enqueue(encoder.encode(OPENED));
      },
      // The person left, or the connection went.
      cancel: () => this.end(stream, "left"),
    });
    const peers = this.byProduct.get(productId) ?? new Set<Stream>();
    peers.add(stream);
    this.byProduct.set(productId, peers);
    this.count += 1;
    this.beat ??= setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.beat.unref();
    gone?.addEventListener("abort", () => this.end(stream, "left"), { once: true });
    return body;
  }

  close(): void {
    this.closing = true;
    for (const peers of [...this.byProduct.values()]) for (const s of [...peers]) this.end(s, "server stopping");
  }

  private heldBy(account: string): number {
    let held = 0;
    for (const peers of this.byProduct.values()) for (const s of peers) if (s.account === account) held += 1;
    return held;
  }

  private async flush(productId: string): Promise<void> {
    const areas = this.pending.get(productId);
    this.pending.delete(productId);
    if (!areas) return;
    // One at a time: a few short queries each, and never many at once beside what people are doing.
    for (const stream of [...(this.byProduct.get(productId) ?? [])]) {
      if (stream.closed) continue;
      const role = await stream.recheck().catch(() => null);
      if (stream.closed) continue;
      if (role === null) {
        this.end(stream, "no longer allowed");
        continue;
      }
      const hears = areasFor(role, areas);
      if (hears.length) this.write(stream, liveMessage(hears));
    }
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const peers of [...this.byProduct.values()]) {
      for (const s of [...peers]) {
        if (now >= s.endsAt) this.end(s, "lived its time");
        else this.write(s, HEARTBEAT);
      }
    }
  }

  private write(stream: Stream, text: string): void {
    const { controller } = stream;
    if (stream.closed || !controller) return;
    if ((controller.desiredSize ?? 0) < -MOST_BEHIND) return this.end(stream, "not being read");
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      this.end(stream, "left");
    }
  }

  private end(stream: Stream, reason: string): void {
    if (stream.closed) return;
    stream.closed = true;
    const peers = this.byProduct.get(stream.product);
    peers?.delete(stream);
    if (peers && !peers.size) this.byProduct.delete(stream.product);
    this.count -= 1;
    if (!this.count && this.beat) {
      clearInterval(this.beat);
      this.beat = null;
    }
    try {
      stream.controller?.close();
    } catch {
      // Already cancelled.
    }
    // Operational only: how long and why, and how many remain, which is what a deployment needs to see what this costs it. Nobody and no product.
    this.log({ event: "live_stream_ended", reason, seconds: Math.round((Date.now() - stream.opened) / 1000), open: this.count });
  }
}

const LIVE_PATH = /^\/api\/v1\/p\/[^/]+\/[^/]+\/[^/]+\/live$/;

/** Whether a path is a live stream's, which stays open and wakes nothing. */
export const isLiveStream = (path: string) => LIVE_PATH.test(path);

/**
 * Whether a request comes from the app's own pages. A browser says so of every request (Sec-Fetch-Site),
 * and no script can change it. Reading the answer takes more than the cookie: no other site is allowed
 * to read this origin's responses. This is a second lock on that door, as a GET has no other.
 */
function fromTheApp(c: Context, config: ServerConfig): boolean {
  const site = c.req.header("sec-fetch-site");
  return (!site || site === "same-origin") && isOwnOrigin(config, c.req.header("origin"));
}

/** The one route: a stream of what changes in a product, for a browser that may read its Story. */
export function liveRoutes(env: Env & { config: ServerConfig }) {
  const app = new Hono();
  const hub = env.ports.live instanceof LiveHub ? env.ports.live : null;

  /** Who a stream serves, asked again. Whatever goes wrong in asking means no. */
  const asker = (principal: Principal, session: HeldSession, productId: string): Recheck => async () => {
    const account = await accountOfHeldSession(env.db, session);
    if (!account || account.account_id !== principal.account_id) return null;
    const scope = await resolveScope(env.db, { ...principal, ...account }, "product", "story", { product: productId }, "live");
    return isGuest(scope) ? null : scope.role;
  };

  app.get(`${SCOPE_PREFIX.product}/live`, async (c) => {
    // Off: nothing to say, and nothing asked of the database. A tab told this stops asking.
    if (!hub) return c.body(null, 204);
    const { signal } = c.req.raw;
    try {
      if (hub.full) throw noRoom();
      if (!fromTheApp(c, env.config)) throw new AppError(403, "forbidden_origin", "Only WhatBuild's own pages may listen here.");
      const principal = await restPrincipal(c, env.db, env.config);
      if (!principal) throw unauthenticated();
      const { tenant, team, product } = c.req.param() as Record<string, string>;
      const scope = await resolveScope(env.db, principal, "product", "story", { tenant, team, product }, "live");
      // The example organization rarely changes and is read by anyone who drops in, so its guests do not hold a stream open for it.
      if (isGuest(scope)) return c.body(null, 204);
      await admitRead(env, principal, scope, "live");
      const session = heldSession(c, env.config.publicBaseUrl.startsWith("https://"));
      const productId = scope.product!.product_id;
      const body = session ? hub.listen(productId, principal.account_id, asker(principal, session, productId), signal) : null;
      // A request that went while it was being let in (a tab closed, a screen left, or React's
      // second run of an effect in development, which drops the first request at once) is told it
      // went, not refused: nobody reads either answer, but the access log keeps the status, and a
      // 429 there would read as a person with no room left.
      if (!body) throw signal.aborted ? wentAway() : noRoom();
      return c.body(body, 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        // Nothing between here and the tab may keep it, change it or wait for more of it.
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      });
    } catch (e) {
      return errorResponse(c, toAppError(e, { surface: "web" }));
    }
  });
  return app;
}

/** A tab refused for lack of room goes without live updates, and tries again later. */
function noRoom(): AppError {
  return new AppError(429, "live_full", "No more tabs can listen for changes just now. Refresh to see the latest.", { retry_after_seconds: 300 });
}

/**
 * A tab that stopped asking before its stream was let in. 499 is what servers log for a client that
 * closed its request, as search does for a search nobody waits for any more (`search_cancelled`).
 */
function wentAway(): AppError {
  return new AppError(499, "live_cancelled", "The tab stopped asking before it was let in.");
}
