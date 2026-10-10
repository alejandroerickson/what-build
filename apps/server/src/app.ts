import { readFileSync } from "node:fs";
import { AppError, REST_BODY_MAX_BYTES, SKILL_VERSION, type BlobStore, type Db, type Env, type Mailer, type Ports } from "@whatbuild/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { FsBlobStore, MemoryBlobStore } from "./adapters/blobs.ts";
import { ConsoleMailer, HmacGrantSigner, MemoryMailer, SafeUrlFetcher, SmtpMailer } from "./adapters/misc.ts";
import { carriesOurCookie, isOwnOrigin } from "./auth/identity.ts";
import { oauthRoutes } from "./auth/oauth.ts";
import { authRoutes } from "./auth/routes.ts";
import type { ServerConfig } from "./config.ts";
import { mcpRoutes } from "./mcp.ts";
import { threadParser } from "./parse-thread.ts";
import { publicRoutes, staticRoutes } from "./public-routes.ts";
import { restRoutes } from "./rest.ts";
import { SandboxClock, sandboxRoutes } from "./public-sandbox.ts";
import { siteRoutes } from "./site.ts";
import { uploadRoutes } from "./uploads.ts";

export const SERVER_VERSION = process.env["WHATBUILD_RELEASE"] ?? `dev-${SKILL_VERSION}`;

/** The largest body sign-in and OAuth read. */
const AUTH_BODY_MAX_BYTES = 64 * 1024;

/**
 * A request's path as its log line holds it: ids masked, and the two links that are credentials
 * themselves, an invitation's (/invite/<token>) and a sandbox invitation's (/join/<code>).
 */
function loggedPath(path: string): string {
  return path.replace(/^\/invite\/[^/]+/, "/invite/:token").replace(/^\/join\/[^/]+/, "/join/:code").replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ":id");
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
      urlFetchMaxBytes: config.urlFetchMaxBytes,
      signupAllowlist: config.signupAllowlist,
      instanceOwners: config.instanceOwners,
      defaultTenantAllowance: config.defaultTenantAllowance,
    },
  };
}

/** One application: static web app, REST, MCP, OAuth and the upload relay on one origin, and the public site on its own host. */
export function createApp(deps: { db: Db; ports: Ports; config: ServerConfig; clock?: SandboxClock }) {
  const env: Env & { config: ServerConfig } = { db: deps.db, ports: deps.ports, config: deps.config };
  const clock = deps.clock ?? new SandboxClock(env, deps.config.env === "test" ? () => {} : undefined);
  const app = new Hono();

  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    // Operational telemetry only: never content, email addresses or tokens.
    if (deps.config.env !== "test" && !c.req.path.startsWith("/assets/"))
      console.log(JSON.stringify({ at: new Date().toISOString(), method: c.req.method, path: loggedPath(c.req.path), status: c.res.status, ms: Date.now() - started }));
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

  // A public sandbox's overdue reset runs before the request that finds it, so nobody is served
  // what its hour should have erased.
  app.use("*", async (c, next) => {
    const p = c.req.path;
    if (p.startsWith("/api/") || p.startsWith("/mcp") || p.startsWith("/auth/")) await clock.resetIfDue().catch((e) => console.error("sandbox reset:", e));
    return next();
  });

  // First, so the public site's host never reaches the app's routes.
  app.route("/", siteRoutes({ db: deps.db, config: deps.config }));
  app.route("/", publicRoutes({ db: deps.db, config: deps.config, release: RELEASE }));
  app.route("/", sandboxRoutes({ db: deps.db, clock }));
  app.route("/", oauthRoutes({ db: deps.db, config: deps.config }));
  app.route("/", authRoutes({ db: deps.db, config: deps.config, mailer: deps.ports.mailer ?? new ConsoleMailer() }));
  app.route("/", uploadRoutes(env));
  app.route("/", mcpRoutes(env));
  app.route("/", restRoutes(env));

  app.all("/api/*", (c) => c.json({ error: { code: "not_found", status: 404, message: `No route ${c.req.method} ${c.req.path}.` } }, 404));
  if (deps.config.webDist) app.route("/", staticRoutes(deps.config.webDist, { analytics: Boolean(deps.config.analyticsId) }));

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.toJSON() }, err.status as 400);
    console.error(err);
    return c.json({ error: { code: "internal", status: 500, message: "Unexpected error." } }, 500);
  });
  return app;
}
