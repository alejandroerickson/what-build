import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/** The header the proxy in front (deploy/cloudflare/worker.js) sends the key in. */
export const EDGE_KEY_HEADER = "X-WhatBuild-Edge-Key";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * With an edge key (WHATBUILD_EDGE_KEY), the service answers only requests that carry it, which
 * the Cloudflare Worker adds to each request it passes on. Anyone who finds the service's own
 * address (Cloud Run's run.app) and goes around the Worker, its rate limit and its answers to
 * scanners is refused before anything else runs: no database, no trace, no worker woken. The
 * health check answers without it, for the platform's probes. Without a key, nothing is refused.
 */
export function requireEdgeKey(key: string | null, publicBaseUrl: string): MiddlewareHandler {
  if (!key) return async (_c, next) => next();
  const expected = digest(key);
  return async (c, next) => {
    if (c.req.path === "/health") return next();
    const given = c.req.header(EDGE_KEY_HEADER);
    if (given && timingSafeEqual(digest(given), expected)) return next();
    return c.text(`This address does not serve WhatBuild. Open ${publicBaseUrl} instead.`, 403, { "Cache-Control": "no-store" });
  };
}
