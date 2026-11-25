import { closeSync, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { DOCUMENT_ROUTE, LIMITS, MCP_SERVER_NAME, planCatalogue, readGuests, readPlans, TOOLS_VERSION, unauthenticated, type Db } from "@whatbuild/core";
import { Hono } from "hono";
import { sql } from "kysely";
import type { Release } from "./app.ts";
import { restPrincipal } from "./auth/identity.ts";
import { botCheckFor } from "./bot-check.ts";
import { microsoftSignIn, type ServerConfig } from "./config.ts";

/**
 * What the public site's pages and the app's plans pages show that only the deployment knows: the
 * plans as an instance owner set them, the largest file it takes, whom to write to, whether anyone
 * may come in as a guest, and what the privacy page says of who runs it.
 */
/**
 * What the site says of the example organization, which every guest reads: its name, its first
 * product's name and the first sentence of that product's concept. Read from the deployment, never
 * written into the site, since each deployment has its own example, or none. The organization is the
 * one marked as the example at start-up, which `WHATBUILD_EXAMPLE_TENANT` may name by a slug it had
 * before (`syncExampleTenant`).
 */
async function exampleAbout(db: Db): Promise<{ organization: string; product: string; about: string } | null> {
  return db.transaction().execute(async (trx) => {
    const tenant = await trx.selectFrom("tenants").select(["tenant_id", "name"]).where("example", "=", true).executeTakeFirst();
    if (!tenant) return null;
    await sql`select set_config('app.tenant_id', ${tenant.tenant_id}, true)`.execute(trx);
    const product = await trx.selectFrom("products").select(["name", "concept"]).where("tenant_id", "=", tenant.tenant_id).where("archived_at", "is", null).orderBy("created_at").limit(1).executeTakeFirst();
    if (!product) return null;
    const plain = product.concept.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
    const about = (plain.split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 240);
    return { organization: tenant.name, product: product.name, about };
  });
}

export async function siteCatalogue(db: Db, config: ServerConfig) {
  const guests = await readGuests(db);
  return {
    plans: planCatalogue(await readPlans(db)),
    // The plan organizations start on here: one of plans, or unlimited on a deployment that offers none.
    starting_plan: config.newOrganizationPlan,
    // Whether the deployment has an example organization, so whether guests can come in at all.
    example: Boolean(config.exampleTenant),
    limits: LIMITS,
    // What can be uploaded here: past the relay's limit, only through the addresses a bucket signs.
    file_max_bytes: config.blobStore === "gcs" && config.gcsSignedUrls ? config.fileMaxBytes : Math.min(config.fileMaxBytes, config.relayMaxBytes),
    contact: config.privacyContact,
    guests: { self_serve: guests.self_serve, open: guests.at_once > 0 },
    // Whether anyone may make an account, as a guest or to start an organization; never how many may.
    sign_up: !config.signupAllowlist || guests.self_serve || guests.organizations_per_day > 0,
    // The bot check's site key, which the waitlist's form shows the widget with; null where it is off.
    bot_check: botCheckFor(config),
    example_about: await exampleAbout(db).catch(() => null),
    // What the site's privacy page says that only the deployment knows.
    privacy: {
      operator: config.operator,
      contact: config.privacyContact,
      providers: config.providers,
      analytics: Boolean(config.analyticsId),
    },
  };
}

/** Where this deployment's privacy page is: a page of the public site, never a screen of the app. */
export function privacyUrl(config: ServerConfig): string {
  const site = config.siteUrl ? new URL(config.siteUrl) : null;
  return site && site.host !== new URL(config.publicBaseUrl).host ? `${site.origin}/privacy` : `${config.publicBaseUrl}/site/privacy/`;
}

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
      // The privacy page, which is the public site's: on its own domain, or on the app's origin without one.
      privacy_url: privacyUrl(config),
      // The public site's own address (WHATBUILD_SITE_URL), where its waitlist is; null on a deployment without one.
      site_url: config.siteUrl,
    }),
  );
  // The plans this WhatBuild offers, for its plans pages and anyone deciding: every limit, and each
  // one's price as an instance owner set it; whether anyone may come in as a guest; and what the
  // privacy page names.
  app.get("/api/v1/plans", async (c) => c.json(await siteCatalogue(deps.db, config), 200, { "Cache-Control": "public, max-age=300" }));

  app.get("/api/v1/connect", async (c) => {
    const p = await restPrincipal(c, deps.db, config);
    if (!p) throw unauthenticated();
    return c.json({
      mcp_url: `${base}/mcp`,
      tenant_url_template: `${base}/mcp/t/{tenant}`,
      bound_url_template: `${base}/mcp/t/{tenant}/{product}`,
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

/** Cloudflare Turnstile's host, by directive: its script, and the frame it decides in (bot-check.ts). */
export const BOT_CHECK_SOURCES = {
  "script-src": "https://challenges.cloudflare.com",
  "frame-src": "https://challenges.cloudflare.com",
};

/**
 * PAGE_SECURITY_HEADERS, letting Google Analytics in when the deployment uses it, Cloudflare's
 * bot check when it has one (bot-check.ts), letting the
 * app frame what the content site serves when it has one: prototypes, and the documents the app's
 * own routes hand off to it (content-documents.ts). After a redirect a browser matches a source by
 * its host alone, and the content site serves nothing else. A store that signs direct uploads gets
 * the app's PUTs of files past the relay, to that store's own bucket and no other.
 */
export function pageHeaders(analytics: boolean, contentUrl: string | null = null, uploadsTo: string | null = null, botCheck = false) {
  if (!analytics && !contentUrl && !uploadsTo && !botCheck) return PAGE_SECURITY_HEADERS;
  const csp = PAGE_SECURITY_HEADERS["Content-Security-Policy"].split("; ").map((d0) => {
    const directive = d0.split(" ")[0]!;
    const d = botCheck && directive in BOT_CHECK_SOURCES ? `${d0} ${BOT_CHECK_SOURCES[directive as keyof typeof BOT_CHECK_SOURCES]}` : d0;
    const name = directive as keyof typeof ANALYTICS_SOURCES;
    const withAnalytics = analytics && ANALYTICS_SOURCES[name] ? `${d} ${ANALYTICS_SOURCES[name]}` : d;
    if (uploadsTo && directive === "connect-src") return `${withAnalytics} ${uploadsTo}`;
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

export function staticRoutes(dist: string, opts: { analytics?: boolean; contentUrl?: string | null; uploadsTo?: string | null; botCheck?: boolean } = {}) {
  const headers = pageHeaders(Boolean(opts.analytics), opts.contentUrl ?? null, opts.uploadsTo ?? null, Boolean(opts.botCheck));
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
