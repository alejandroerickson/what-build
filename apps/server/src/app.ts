import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { AppError, PERMISSIONS_POLICY, REST_BODY_MAX_BYTES, SKILL_VERSION, type BlobStore, type Db, type Env, type Mailer, type Ports } from "@whatbuild/core";
import { SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { routePath } from "hono/route";
import { FsBlobStore, MemoryBlobStore } from "./adapters/blobs.ts";
import { AcsMailer } from "./adapters/mail-acs.ts";
import { ConsoleMailer, HmacGrantSigner, MemoryMailer, SafeUrlFetcher, SmtpMailer } from "./adapters/misc.ts";
import { carriesOurCookie, isOwnOrigin } from "./auth/identity.ts";
import { canonicalHost, requestedHost } from "./canonical-host.ts";
import { oauthRoutes } from "./auth/oauth.ts";
import { authRoutes } from "./auth/routes.ts";
import type { ServerConfig } from "./config.ts";
import { mcpRoutes } from "./mcp.ts";
import { refuseNullCharacters } from "./null-characters.ts";
import { threadParser } from "./parse-thread.ts";
import { prototypeRoutes } from "./prototype.ts";
import { publicRoutes, staticRoutes } from "./public-routes.ts";
import { OPERATION_HEADER, restRoutes } from "./rest.ts";
import { SandboxClock, sandboxRoutes } from "./public-sandbox.ts";
import { siteRoutes } from "./site.ts";
import { logError, requestFields, requestIdOf, tracer, withRequestId } from "./telemetry.ts";
import { uploadRoutes } from "./uploads.ts";

export const SERVER_VERSION = process.env["WHATBUILD_RELEASE"] ?? `dev-${SKILL_VERSION}`;

/** The largest body sign-in and OAuth read. */
const AUTH_BODY_MAX_BYTES = 64 * 1024;

/**
 * Headers every response carries unless its route set its own. No other site may load a response
 * into its pages, and so into its process (CORP). A page loads from other sites only what it can
 * fetch without credentials, and frames only documents that say the same (COEP `credentialless`,
 * so nothing a page loads has to opt in). No response is sniffed for another type, and no page or
 * frame may use a browser feature WhatBuild never needs.
 */
export const RESPONSE_HEADERS: Record<string, string> = {
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": PERMISSIONS_POLICY,
};

/** The policy of an HTML response whose route set none: it loads nothing, and cannot be framed, rebased or posted from. */
export const FALLBACK_HTML_POLICY = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The paths whose responses carry people's material, their identity or credentials, which no cache, the browser's included, may keep. */
const PRIVATE_PATHS = /^\/(api|mcp|auth|oauth)(\/|$)/;

/** Where a path names an organization, a team and a product: the REST routes, the MCP connectors (and the OAuth and OpenID metadata clients ask for beside them), and the app's screens. */
const SCOPED_PATH = /^(\/api\/v1\/p|\/api\/v1\/teams|\/api\/v1\/tenants|(?:\/\.well-known\/[^/]+)?\/mcp\/t|\/t)\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?/;
/**
 * The first words of the server's and the app's own paths. Any other path of three or more parts is
 * a product's path typed without /t/ (the app sends it on), so its first three are names.
 */
const OWN_FIRST = new Set(["api", "mcp", "auth", "oauth", "t", ".well-known", "assets", "invite", "join", "signin", "cookies", "privacy", "settings", "connect", "instance", "welcome", "products", "health", "_system", "prototypes"]);
const BY_KIND = ["", ":org", ":team", ":product"];
/** The app's screens directly under an organization: /t/<org>/members and /t/<org>/sandbox. */
const ORG_SCREENS = new Set(["members", "sandbox"]);

/**
 * A request's path as its log line holds it: ids masked; organizations, teams and products named
 * only by kind; and the links that are credentials themselves, an invitation's (/invite/<token>), a
 * sandbox invitation's (/join/<code>) and a prototype's (/prototypes/<grant>/…, whose file names
 * are a team's too).
 */
export function loggedPath(path: string): string {
  if (/^\/prototypes(\/|$)/.test(path)) return "/prototypes/:grant/…";
  return path
    .replace(/^\/invite\/[^/]+/, "/invite/:token")
    .replace(/^\/join\/[^/]+/, "/join/:code")
    .replace(SCOPED_PATH, (whole, prefix: string, ...names: (string | undefined)[]) => {
      // How many of the names after the prefix are an organization, a team and a product.
      const depth = prefix === "/api/v1/tenants" || (prefix === "/t" && ORG_SCREENS.has(names[1] ?? "")) ? 1 : prefix === "/api/v1/teams" ? 2 : 3;
      return [prefix, ...names.slice(0, 3).map((n, i) => (n === undefined ? undefined : i < depth ? BY_KIND[i + 1] : n))].filter((n) => n !== undefined).join("/");
    })
    .replace(/^\/([^/]+)\/[^/]+\/[^/]+(?=\/|$)/, (whole, first: string) => (OWN_FIRST.has(first) ? whole : "/:org/:team/:product"))
    .replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ":id");
}

export interface Release {
  /** WHATBUILD_RELEASE: a tag such as v0.3.1, a commit, or dev-<skill version> on a development server. */
  version: string;
  /** The full commit the image was built from, and when; null on a development server. */
  commit: string | null;
  built_at: string | null;
}

/** What this server runs: the deployment names the version, and the image records its build in build.json. */
export const RELEASE: Release = { version: SERVER_VERSION, ...readBuild() };

function readBuild(): Pick<Release, "commit" | "built_at"> {
  try {
    const b = JSON.parse(readFileSync(new URL("./build.json", import.meta.url), "utf8")) as Record<string, unknown>;
    return { commit: typeof b["commit"] === "string" ? b["commit"] : null, built_at: typeof b["built_at"] === "string" ? b["built_at"] : null };
  } catch {
    // A development server, which runs from source.
    return { commit: null, built_at: null };
  }
}

export async function createBlobStore(config: ServerConfig): Promise<BlobStore> {
  if (config.blobStore === "memory") return new MemoryBlobStore();
  if (config.blobStore === "gcs") {
    if (!config.gcsBucket) throw new Error("WHATBUILD_GCS_BUCKET is required for the gcs blob store.");
    const { GcsBlobStore } = await import("./adapters/blobs-gcs.ts");
    return new GcsBlobStore(config.gcsBucket, config.gcsSignedUrls);
  }
  return new FsBlobStore(config.blobDir);
}

export function createMailer(config: ServerConfig): Mailer {
  if (config.mailer === "memory") return new MemoryMailer();
  if (config.mailer === "none")
    return {
      async send() {
        // No mail provider: invitations still work by link; sign-in links are disabled upstream.
      },
    };
  if (config.mailer === "acs") {
    if (!config.acsEmailEndpoint) throw new Error("WHATBUILD_ACS_EMAIL_ENDPOINT is required for the acs mailer.");
    return new AcsMailer(config.acsEmailEndpoint, config.mailFrom, config.azureClientId);
  }
  if (config.mailer === "smtp") {
    if (!config.smtpUrl) throw new Error("WHATBUILD_SMTP_URL is required for the smtp mailer.");
    return new SmtpMailer(config.smtpUrl, config.mailFrom);
  }
  return new ConsoleMailer();
}

export function createPorts(config: ServerConfig, blobs: BlobStore, mailer: Mailer, notifyJobs?: () => void): Ports {
  return {
    blobs,
    grants: new HmacGrantSigner(config.grantKey),
    parser: threadParser({ memoryMb: config.parseMemoryMb, timeoutSeconds: config.parseTimeoutSeconds }),
    mailer,
    fetcher: new SafeUrlFetcher(),
    notifyJobs,
    config: {
      publicBaseUrl: config.publicBaseUrl,
      serverVersion: SERVER_VERSION,
      relayMaxBytes: config.relayMaxBytes,
      fileMaxBytes: config.fileMaxBytes,
      parseCapBytes: config.parseCapBytes,
      parseMemoryMb: config.parseMemoryMb,
      parseTimeoutSeconds: config.parseTimeoutSeconds,
      grantTtlSeconds: config.grantTtlSeconds,
      contentBaseUrl: config.contentUrl,
      prototypeGrantSeconds: config.prototypeGrantSeconds,
      urlFetchMaxBytes: config.urlFetchMaxBytes,
      signupAllowlist: config.signupAllowlist,
      instanceOwners: config.instanceOwners,
      defaultTenantAllowance: config.defaultTenantAllowance,
      // Derived from the grant key, so a deployment sets nothing new and its pseudonyms are its own.
      usageKey: createHmac("sha256", config.grantKey).update("whatbuild usage people").digest("base64url"),
      // A deployment that sends no mail keeps its feedback in the database.
      feedbackEmail: config.mailer === "none" ? null : config.feedbackEmail,
    },
  };
}

/** One application: static web app, REST, MCP, OAuth and the upload relay on one origin, and the public site on its own host. */
/**
 * `onRequest` is called for every request to the API, MCP or sign-in, before it is served: the
 * service passes its worker's `nudge`, so a sleeping worker looks at the queue again.
 */
export function createApp(deps: { db: Db; ports: Ports; config: ServerConfig; clock?: SandboxClock; release?: Release; onRequest?: () => void }) {
  const env: Env & { config: ServerConfig } = { db: deps.db, ports: deps.ports, config: deps.config };
  const clock = deps.clock ?? new SandboxClock(env, deps.config.env === "test" ? () => {} : undefined);
  const release = deps.release ?? RELEASE;
  const app = new Hono();

  app.use("*", async (c, next) => {
    const started = Date.now();
    const path = loggedPath(c.req.path);
    // Operational telemetry only: never content, email addresses or tokens (telemetry.ts). A
    // prototype's files, like the app's assets, are logged only when one fails, and never traced;
    // nor is the health check.
    const quiet = c.req.path.startsWith("/assets/") || c.req.path.startsWith("/prototypes/") || c.req.path === "/health";
    const respond = async (span?: Span) => {
      const id = requestIdOf(span);
      await withRequestId(id, () => next());
      c.header("X-Request-Id", id);
      const operation = c.res.headers.get(OPERATION_HEADER);
      if (span) {
        // The route's pattern names the span when one matched; the app's screens and anything else fall back to the masked path.
        const route = routePath(c);
        span.updateName(`${c.req.method} ${route.includes("*") ? path : route}`);
        span.setAttributes({ "url.path": path, "http.response.status_code": c.res.status, ...(route.includes("*") ? {} : { "http.route": route }), ...(operation ? { "whatbuild.operation": operation } : {}) });
        if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      }
      if (deps.config.env !== "test" && !c.req.path.startsWith("/assets/") && !(c.req.path.startsWith("/prototypes/") && c.res.status < 400))
        console.log(JSON.stringify({ at: new Date().toISOString(), method: c.req.method, path, status: c.res.status, ms: Date.now() - started, ...requestFields(span, id) }));
    };
    if (quiet) return respond();
    return tracer.startActiveSpan(c.req.method, { kind: SpanKind.SERVER, root: true, attributes: { "http.request.method": c.req.method } }, (span) => respond(span).finally(() => span.end()));
  });

  app.use("*", async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(RESPONSE_HEADERS)) if (!c.res.headers.has(name)) c.header(name, value);
    // The commit this image was built from, which the web app compares with its own to know that a
    // release replaced the one it was loaded from (apps/web/src/lib/new-release.ts).
    if (release.commit) c.header("X-WhatBuild-Commit", release.commit);
    if (PRIVATE_PATHS.test(c.req.path) && !c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
    if (c.res.headers.get("Content-Type")?.startsWith("text/html") && !c.res.headers.has("Content-Security-Policy")) c.header("Content-Security-Policy", FALLBACK_HTML_POLICY);
  });

  // A browser that has reached the app over HTTPS keeps to it for a year. This host only: the
  // parent domain also serves the public site, and its other names are not this server's to bind.
  if (deps.config.publicBaseUrl.startsWith("https://"))
    app.use("*", async (c, next) => {
      await next();
      c.header("Strict-Transport-Security", "max-age=31536000");
    });

  // Cookie-carrying writes must come from our own origin, on every route. SameSite=Lax is not
  // enough on a shared parent domain such as run.app, where another service can be "same-site".
  app.use("*", async (c, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method) || !carriesOurCookie(c.req.header("cookie"))) return next();
    if (!isOwnOrigin(deps.config, c.req.header("origin"))) return c.json({ error: { code: "forbidden_origin", status: 403, message: "Cross-origin writes are refused." } }, 403);
    return next();
  });

  app.use("/api/v1/*", async (c, next) => {
    if (c.req.path.startsWith("/api/v1/uploads/")) return next();
    return bodyLimit({ maxSize: REST_BODY_MAX_BYTES, onError: (cx) => cx.json({ error: { code: "too_large", status: 413, message: "Request bodies are limited to 5 MB. Send files through an upload grant." } }, 413) })(c, next);
  });

  // Sign-in and OAuth take small forms and JSON from anyone, so a body past 64 KB is refused unread.
  const tooLarge = "Request bodies here are limited to 64 KB.";
  app.use("/oauth/*", bodyLimit({ maxSize: AUTH_BODY_MAX_BYTES, onError: (c) => c.json({ error: "invalid_request", error_description: tooLarge }, 413) }));
  app.use("/auth/*", bodyLimit({ maxSize: AUTH_BODY_MAX_BYTES, onError: (c) => c.json({ error: { code: "too_large", status: 413, message: tooLarge } }, 413) }));

  // A null character in a request's path, query, form or JSON is refused before any route reads
  // it, naming the field; an operation's JSON is checked with its input (null-characters.ts).
  app.use("*", refuseNullCharacters());

  // A public sandbox's overdue reset runs before the request that finds it, so nobody is served
  // what its hour should have erased. The same requests wake a sleeping worker; the app's pages and
  // static files do not.
  app.use("*", async (c, next) => {
    const p = c.req.path;
    if (p.startsWith("/api/") || p.startsWith("/mcp") || p.startsWith("/auth/")) {
      deps.onRequest?.();
      await clock.resetIfDue().catch((e) => logError("sandbox reset", e));
    }
    return next();
  });

  // A content site serves prototypes and nothing else: no page, API or sign-in of the app's.
  const contentHost = deps.config.contentUrl ? new URL(deps.config.contentUrl).host.toLowerCase() : null;
  if (contentHost)
    app.use("*", async (c, next) => {
      if (requestedHost((name) => c.req.header(name)) !== contentHost || c.req.path.startsWith("/prototypes/") || c.req.path === "/health") return next();
      return c.text("This host serves mockups' prototypes only.", 404);
    });

  // A page opened on another name for this deployment moves to the public URL; the site's host and the content site keep their own.
  app.use("*", canonicalHost(deps.config));

  // First, so the public site's host never reaches the app's routes.
  app.route("/", siteRoutes({ db: deps.db, config: deps.config }));
  app.route("/", prototypeRoutes(env));
  app.route("/", publicRoutes({ db: deps.db, config: deps.config, release }));
  app.route("/", sandboxRoutes({ db: deps.db, clock, base: deps.config.publicBaseUrl }));
  app.route("/", oauthRoutes({ db: deps.db, config: deps.config, notifyJobs: () => deps.ports.notifyJobs?.() }));
  app.route("/", authRoutes({ db: deps.db, config: deps.config, mailer: deps.ports.mailer ?? new ConsoleMailer() }));
  app.route("/", uploadRoutes(env));
  app.route("/", mcpRoutes(env));
  app.route("/", restRoutes(env));

  app.all("/api/*", (c) => c.json({ error: { code: "not_found", status: 404, message: `No route ${c.req.method} ${c.req.path}.` } }, 404));
  if (deps.config.webDist) app.route("/", staticRoutes(deps.config.webDist, { analytics: Boolean(deps.config.analyticsId), contentUrl: deps.config.contentUrl }));

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.toJSON() }, err.status as 400);
    logError(`${c.req.method} ${loggedPath(c.req.path)}`, err);
    return c.json({ error: { code: "internal", status: 500, message: "WhatBuild hit an unexpected error. Try again." } }, 500);
  });
  return app;
}
