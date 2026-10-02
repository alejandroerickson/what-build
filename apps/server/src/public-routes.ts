import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { SKILL_NAME, SKILL_VERSION, skillMarkdown, unauthenticated, type Db } from "@whatbuild/core";
import { strToU8, zipSync } from "fflate";
import { Hono } from "hono";
import { restPrincipal } from "./auth/identity.ts";
import { microsoftSignIn, type ServerConfig } from "./config.ts";

export function publicRoutes(deps: { db: Db; config: ServerConfig; serverVersion: string }) {
  const { config } = deps;
  const base = config.publicBaseUrl;
  const app = new Hono();
  const noStore = { "Cache-Control": "no-store" };

  // Not /healthz: Cloud Run reserves paths ending in "z" and never forwards them.
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/api/v1/meta", (c) =>
    c.json({
      product: "WhatBuild",
      server_version: deps.serverVersion,
      skill: { name: SKILL_NAME, version: SKILL_VERSION },
      auth: { email_link: config.mailer !== "none", google: Boolean(config.googleClientId && config.googleClientSecret), microsoft: microsoftSignIn(config), dev: config.devAuth },
      inference: "none: WhatBuild runs no language model; intelligence comes from the agent you connect",
    }),
  );
  app.get(`/${SKILL_NAME}-skill.md`, (c) => c.text(skillMarkdown(), 200, { ...noStore, "Content-Type": "text/markdown; charset=utf-8" }));
  app.get(`/${SKILL_NAME}-skill.zip`, (c) => {
    const zip = zipSync({ [`${SKILL_NAME}/SKILL.md`]: strToU8(skillMarkdown()) });
    return c.body(zip, 200, { ...noStore, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${SKILL_NAME}-skill.zip"` });
  });

  app.get("/api/v1/connect", async (c) => {
    const p = await restPrincipal(c, deps.db);
    if (!p) throw unauthenticated();
    return c.json({
      mcp_url: `${base}/mcp`,
      bound_url_template: `${base}/mcp/t/{tenant}/{team}/{product}`,
      oauth: { authorization_server: base, protected_resource_metadata: `${base}/.well-known/oauth-protected-resource/mcp`, dynamic_client_registration: true },
      skill: { name: SKILL_NAME, version: SKILL_VERSION, markdown_url: `${base}/${SKILL_NAME}-skill.md`, zip_url: `${base}/${SKILL_NAME}-skill.zip` },
      agent_data_statement: "What your agent reads goes to whoever runs it, under their terms.",
    });
  });
  return app;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Headers on every HTML page and file the image serves: the web app's and the public site's. */
export const PAGE_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  // A Story page runs in an opaque origin and may open app pages in new tabs. This cuts the
  // handle it would keep to them, so it can never later send such a tab somewhere else.
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
};

/** Google Analytics' hosts, by directive. The app loads it only for a person who accepted it. */
const ANALYTICS_SOURCES = {
  "script-src": "https://*.googletagmanager.com",
  "img-src": "https://*.google-analytics.com https://*.googletagmanager.com",
  "connect-src": "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
};

/** PAGE_SECURITY_HEADERS, letting Google Analytics in when the deployment uses it. */
export function pageHeaders(analytics: boolean) {
  if (!analytics) return PAGE_SECURITY_HEADERS;
  const csp = PAGE_SECURITY_HEADERS["Content-Security-Policy"].split("; ").map((d) => {
    const name = d.split(" ")[0] as keyof typeof ANALYTICS_SOURCES;
    return ANALYTICS_SOURCES[name] ? `${d} ${ANALYTICS_SOURCES[name]}` : d;
  });
  return { ...PAGE_SECURITY_HEADERS, "Content-Security-Policy": csp.join("; ") };
}

/**
 * The web app, served from the same origin as the API: no CORS, one sign-in boundary. Hashed assets
 * are cached forever; index.html never. An unknown path without an extension is the app shell; an
 * unknown path with one is a 404, so a stale chunk after a deploy is never answered with HTML.
 */
export function staticRoutes(dist: string, opts: { analytics?: boolean } = {}) {
  const headers = pageHeaders(Boolean(opts.analytics));
  const root = resolve(dist);
  const app = new Hono();
  const indexPath = join(root, "index.html");
  const hasIndex = existsSync(indexPath);
  if (!hasIndex) console.warn(`No web app at ${root}: serving the API and MCP only.`);
  app.get("*", (c) => {
    if (!hasIndex) return c.notFound();
    const rel = normalize(decodeURIComponent(c.req.path)).replace(/^([/\\])+/, "");
    const file = join(root, rel);
    if (file.startsWith(root) && rel && existsSync(file) && statSync(file).isFile()) {
      const immutable = rel.startsWith("assets/");
      return c.body(readFileSync(file), 200, {
        ...headers,
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      });
    }
    if (extname(rel)) return c.notFound();
    return c.body(readFileSync(indexPath), 200, { ...headers, "Content-Type": TYPES[".html"]!, "Cache-Control": "no-cache" });
  });
  return app;
}
