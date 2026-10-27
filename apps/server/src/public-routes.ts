import { closeSync, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { DOCUMENT_ROUTE, MCP_SERVER_NAME, TOOLS_VERSION, unauthenticated, USAGE_PEOPLE_MONTHS, type Db } from "@whatbuild/core";
import { Hono } from "hono";
import type { Release } from "./app.ts";
import { restPrincipal } from "./auth/identity.ts";
import { microsoftSignIn, type ServerConfig } from "./config.ts";

export function publicRoutes(deps: { db: Db; config: ServerConfig; release: Release }) {
  const { config } = deps;
  const base = config.publicBaseUrl;
  const app = new Hono();

  // Not /healthz: Cloud Run reserves paths ending in "z" and never forwards them.
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/api/v1/meta", (c) =>
    c.json({
      product: "WhatBuild",
      server_version: deps.release.version,
      release: deps.release,
      mcp: { name: MCP_SERVER_NAME, tools_version: TOOLS_VERSION },
      auth: { email_link: config.mailer !== "none", google: Boolean(config.googleClientId && config.googleClientSecret), microsoft: microsoftSignIn(config), dev: config.devAuth },
      inference: "none: WhatBuild runs no language model; intelligence comes from the agent you connect",
      // What the privacy page says that only the deployment knows.
      privacy: {
        operator: config.operator,
        contact: config.privacyContact,
        providers: config.providers,
        analytics: Boolean(config.analyticsId),
        session_days: config.sessionDays,
        agent_access_days: config.refreshTokenDays,
        usage_people_months: USAGE_PEOPLE_MONTHS,
      },
    }),
  );
  app.get("/api/v1/connect", async (c) => {
    const p = await restPrincipal(c, deps.db, config);
    if (!p) throw unauthenticated();
    return c.json({
      mcp_url: `${base}/mcp`,
      tenant_url_template: `${base}/mcp/t/{tenant}`,
      bound_url_template: `${base}/mcp/t/{tenant}/{team}/{product}`,
      oauth: { authorization_server: base, protected_resource_metadata: `${base}/.well-known/oauth-protected-resource/mcp`, dynamic_client_registration: true },
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

/**
 * Headers on every HTML page and file the image serves: the web app's and the public site's. The
 * app adds the headers every response carries (`RESPONSE_HEADERS` in app.ts).
 */
export const PAGE_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  // A Story page runs in an opaque origin and may open app pages in new tabs. This cuts the
  // handle it would keep to them, so it can never later send such a tab somewhere else.
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

/** Google Analytics' hosts, by directive. The app loads it only for a person who accepted it. */
const ANALYTICS_SOURCES = {
  "script-src": "https://*.googletagmanager.com",
  "img-src": "https://*.google-analytics.com https://*.googletagmanager.com",
  "connect-src": "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
};

/**
 * PAGE_SECURITY_HEADERS, letting Google Analytics in when the deployment uses it, and letting the
 * app frame what the content site serves when it has one: prototypes, and the documents the app's
 * own routes hand off to it (content-documents.ts). After a redirect a browser matches a source by
 * its host alone, and the content site serves nothing else.
 */
export function pageHeaders(analytics: boolean, contentUrl: string | null = null) {
  if (!analytics && !contentUrl) return PAGE_SECURITY_HEADERS;
  const csp = PAGE_SECURITY_HEADERS["Content-Security-Policy"].split("; ").map((d) => {
    const directive = d.split(" ")[0]!;
    const name = directive as keyof typeof ANALYTICS_SOURCES;
    const withAnalytics = analytics && ANALYTICS_SOURCES[name] ? `${d} ${ANALYTICS_SOURCES[name]}` : d;
    return contentUrl && directive === "frame-src" ? `${withAnalytics} ${contentUrl}/prototypes/ ${contentUrl}${DOCUMENT_ROUTE}/` : withAnalytics;
  });
  return { ...PAGE_SECURITY_HEADERS, "Content-Security-Policy": csp.join("; ") };
}

/** Whether `file` lies inside the folder `root` (both absolute): a path below it, never the folder itself or a sibling whose name starts the same. */
export function insideRoot(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/**
 * The web app, served from the same origin as the API: no CORS, one sign-in boundary. Hashed assets
 * are cached forever; index.html never. An unknown path without an extension is the app shell; an
 * unknown path with one is a 404, so a stale chunk after a deploy is never answered with HTML.
 */
/** A file's bytes, or null when there is no file there. One open, so what is read is what was checked. */
function readFileIfAny(file: string) {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    return fstatSync(fd).isFile() ? readFileSync(fd) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function staticRoutes(dist: string, opts: { analytics?: boolean; contentUrl?: string | null } = {}) {
  const headers = pageHeaders(Boolean(opts.analytics), opts.contentUrl ?? null);
  const root = resolve(dist);
  const app = new Hono();
  const indexPath = join(root, "index.html");
  const hasIndex = existsSync(indexPath);
  if (!hasIndex) console.warn(`No web app at ${root}: serving the API and MCP only.`);
  app.get("*", (c) => {
    if (!hasIndex) return c.notFound();
    // An address whose escapes do not decode (/%C0, as scanners send) names no file and no screen.
    let decoded: string;
    try {
      decoded = decodeURIComponent(c.req.path);
    } catch {
      return c.notFound();
    }
    const rel = normalize(decoded).replace(/^([/\\])+/, "");
    const file = join(root, rel);
    const body = insideRoot(root, file) ? readFileIfAny(file) : null;
    if (body) {
      const immutable = rel.startsWith("assets/");
      return c.body(body, 200, {
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
