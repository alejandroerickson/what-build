import {
  isPrototypeHtml, PROTOTYPE_GRANT_PURPOSE, PROTOTYPE_ROUTE, prototypeResponseHeaders, requestedPrototypePath, withPrototypeFrame, type Env, type Tx,
} from "@whatbuild/core";
import { Hono, type Context } from "hono";
import { sql } from "kysely";
import { requestedHost } from "./canonical-host.ts";
import type { ServerConfig } from "./config.ts";

/** The frame script's tag as the route appends it, so the stored bytes are never decoded or changed. */
const encoder = new TextEncoder();

/**
 * The one route that serves a mockup's prototype: `GET /prototypes/<grant>/<path>`. The grant is
 * the only authority. It is signed for one tenant and one immutable version and names nobody; the
 * route never reads a cookie or an Authorization header, never sets a cookie, never redirects (a
 * policy's path is not checked after a redirect), and finds each path as a row of that version, so
 * a deleted mockup is gone at once. Every response, an error's too, carries the prototype's policy
 * (prototypeResponseHeaders): an opaque origin that loads only from this version's own address.
 *
 * On the app's own origin a document is never served at the top level (Sec-Fetch-Dest: document),
 * where it would show the team's page under WhatBuild's address. With WHATBUILD_CONTENT_URL set the
 * route answers on that host only, where a top-level document names the content site instead.
 */
export function prototypeRoutes(env: Env & { config: ServerConfig }) {
  const app = new Hono();
  const contentHost = env.config.contentUrl ? new URL(env.config.contentUrl).host.toLowerCase() : null;
  const origin = env.config.contentUrl ?? env.config.publicBaseUrl;
  const onSite = Boolean(contentHost);

  const inTenant = <T>(tenantId: string, fn: (trx: Tx) => Promise<T>) =>
    env.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      return fn(trx);
    });

  app.all(`${PROTOTYPE_ROUTE}/*`, async (c) => {
    // The address as the browser sent it, still percent-encoded: the path is decoded part by part below.
    const raw = new URL(c.req.url).pathname;
    const m = /^\/prototypes\/([A-Za-z0-9_.-]+)\/(.*)$/.exec(raw);
    const base = `${origin}${PROTOTYPE_ROUTE}/${m?.[1] ?? "-"}/`;
    const say = (status: 401 | 403 | 404 | 405, text: string, extra: Record<string, string> = {}) => {
      const headers = { ...prototypeResponseHeaders(base, "text/plain; charset=utf-8", onSite), ...extra };
      return c.req.method === "HEAD" ? c.body(null, status, headers) : c.body(text, status, headers);
    };
    if (contentHost && requestedHost((name) => c.req.header(name)) !== contentHost)
      return say(404, "Prototypes are served from this deployment's content site.");
    if (c.req.method === "OPTIONS")
      return c.body(null, 204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD", "Access-Control-Allow-Headers": "*", "Access-Control-Max-Age": "600" });
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return say(405, "A prototype is read only.", { Allow: "GET, HEAD" });
    if (!m) return say(404, "There is no such prototype file.");
    const claims = env.ports.grants.verify(m[1]!);
    const tenant = claims?.["t"];
    const version = claims?.["xv"];
    if (!claims || claims["purpose"] !== PROTOTYPE_GRANT_PURPOSE || typeof tenant !== "string" || typeof version !== "string")
      return say(401, "This prototype's address has expired or was not given by WhatBuild. Open the mockup again.");
    // A service worker would outlive the address; an opaque origin cannot register one anyway.
    if (c.req.header("service-worker")) return say(403, "A prototype cannot register a service worker.");
    if (!onSite && c.req.header("sec-fetch-dest") === "document")
      return say(403, "WhatBuild shows a prototype only inside its frame. Open it on the mockup's canvas or the Story.");
    const path = requestedPrototypePath(m[2]!);
    if (!path) return say(404, "There is no such prototype file.");
    const file = await inTenant(tenant, (trx) =>
      trx.selectFrom("mockup_prototype_files").select(["size", "sha256", "media_type", "blob_key"]).where("version_id", "=", version).where("path", "=", path).executeTakeFirst(),
    );
    if (!file) return say(404, "There is no such prototype file.");
    return send(c, env, base, file, onSite);
  });

  return app;
}

/** One file of a prototype: an HTML document with the frame script after it, anything else as stored, in ranges for media. */
async function send(c: Context, env: Env, base: string, file: { size: number; sha256: string; media_type: string; blob_key: string }, onSite: boolean) {
  const headers: Record<string, string> = { ...prototypeResponseHeaders(base, file.media_type, onSite), "Accept-Ranges": "bytes" };
  const head = c.req.method === "HEAD";
  if (isPrototypeHtml(file.media_type)) {
    const stored = await env.ports.blobs.get(file.blob_key);
    const tail = encoder.encode(withPrototypeFrame("", base, !onSite));
    const body = new Uint8Array(stored.length + tail.length);
    body.set(stored, 0);
    body.set(tail, stored.length);
    const framed = { ...headers, ETag: `"${file.sha256}-framed"`, "Content-Length": String(body.length) };
    return head ? c.body(null, 200, framed) : c.body(body as unknown as ArrayBuffer, 200, framed);
  }
  headers["ETag"] = `"${file.sha256}"`;
  const range = c.req.header("range");
  const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), file.size - 1) : file.size - 1;
    if (start >= file.size || start > end) return c.body(null, 416, { ...headers, "Content-Range": `bytes */${file.size}` });
    const part = { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": String(end - start + 1) };
    if (head) return c.body(null, 206, part);
    return c.body(await env.ports.blobs.getStream(file.blob_key, { start, end }), 206, part);
  }
  if (head) return c.body(null, 200, { ...headers, "Content-Length": String(file.size) });
  return c.body(await env.ports.blobs.getStream(file.blob_key), 200, { ...headers, "Content-Length": String(file.size) });
}
