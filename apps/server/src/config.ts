/**
 * All configuration comes from the environment, read once at start-up. Names use one prefix,
 * WHATBUILD_, except the conventional DATABASE_URL, PORT and NODE_ENV.
 */
export interface ServerConfig {
  env: "development" | "test" | "production";
  port: number;
  publicBaseUrl: string;
  /** The public site's origin (e.g. https://what-build.com), served by host beside the app; null for none. */
  siteUrl: string | null;
  databaseUrl: string;
  /** Allow the development-only "sign in as" control. Never on in production. */
  devAuth: boolean;
  blobStore: "fs" | "memory" | "gcs";
  blobDir: string;
  gcsBucket: string | null;
  /** Hand out direct-to-bucket signed upload URLs (needs signBlob permission on the runtime identity). */
  gcsSignedUrls: boolean;
  grantKey: string;
  /** "none" in production without SMTP: email links are then off, and nothing secret is ever logged. */
  mailer: "console" | "smtp" | "memory" | "none";
  smtpUrl: string | null;
  mailFrom: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  /** The one Microsoft Entra directory whose work accounts may sign in, by its ID (a GUID); null for none. */
  microsoftTenant: string | null;
  microsoftClientId: string | null;
  microsoftClientSecret: string | null;
  webDist: string | null;
  runWorker: boolean;
  /** When set, only these emails (or @domains) may create an account; invited people always may. */
  signupAllowlist: string[] | null;
  /** Addresses that run this instance: they create any number of organizations and give others an allowance. */
  instanceOwners: string[];
  /** How many organizations an address may create when no instance owner has given it an allowance. */
  defaultTenantAllowance: number;
  /** The slug of the organization that is the public sandbox, if the deployment has one. */
  sandboxTenant: string | null;
  relayMaxBytes: number;
  fileMaxBytes: number;
  parseCapBytes: number;
  grantTtlSeconds: number;
  urlFetchMaxBytes: number;
  sessionDays: number;
  /** A Google Analytics measurement ID (G-…). The app loads analytics only for a person who accepts it; null for none. */
  analyticsId: string | null;
  accessTokenSeconds: number;
  refreshTokenDays: number;
}

const MiB = 1024 * 1024;

/** Microsoft sign-in is on only when the directory, the client ID and the secret are all set. */
export function microsoftSignIn(config: ServerConfig): boolean {
  return Boolean(config.microsoftTenant && config.microsoftClientId && config.microsoftClientSecret);
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mode = (env["NODE_ENV"] === "production" ? "production" : env["NODE_ENV"] === "test" ? "test" : "development") as ServerConfig["env"];
  const port = num(env["PORT"], 8787);
  const publicBaseUrl = (env["WHATBUILD_PUBLIC_URL"] ?? `http://localhost:${mode === "development" ? num(env["WHATBUILD_WEB_PORT"], 5273) : port}`).replace(/\/+$/, "");
  const grantKey = env["WHATBUILD_GRANT_KEY"] ?? (mode === "production" ? "" : "development-only-grant-key-not-secret");
  if (mode === "production" && grantKey.length < 32) throw new Error("WHATBUILD_GRANT_KEY must be set to at least 32 random characters in production.");
  const blobStore = (env["WHATBUILD_BLOB_STORE"] ?? (env["WHATBUILD_GCS_BUCKET"] ? "gcs" : "fs")) as ServerConfig["blobStore"];
  const devAuth = mode !== "production" && env["WHATBUILD_DEV_AUTH"] !== "0";
  // One directory, by ID: never common, organizations, consumers or a domain, which would admit other directories' accounts.
  const microsoftTenant = env["WHATBUILD_MICROSOFT_TENANT"]?.trim() || null;
  if (microsoftTenant && !GUID.test(microsoftTenant)) throw new Error("WHATBUILD_MICROSOFT_TENANT must be the directory's ID, a GUID.");
  return {
    env: mode,
    port,
    publicBaseUrl,
    siteUrl: env["WHATBUILD_SITE_URL"] ? env["WHATBUILD_SITE_URL"].replace(/\/+$/, "") : null,
    databaseUrl: env["DATABASE_URL"] ?? "",
    devAuth,
    blobStore,
    blobDir: env["WHATBUILD_BLOB_DIR"] ?? ".what-build/blobs",
    gcsBucket: env["WHATBUILD_GCS_BUCKET"] ?? null,
    gcsSignedUrls: env["WHATBUILD_GCS_SIGNED_URLS"] === "1",
    grantKey,
    mailer: (env["WHATBUILD_MAILER"] ?? (env["WHATBUILD_SMTP_URL"] ? "smtp" : mode === "production" ? "none" : "console")) as ServerConfig["mailer"],
    smtpUrl: env["WHATBUILD_SMTP_URL"] ?? null,
    mailFrom: env["WHATBUILD_MAIL_FROM"] ?? "WhatBuild <no-reply@localhost>",
    googleClientId: env["WHATBUILD_GOOGLE_CLIENT_ID"] ?? null,
    googleClientSecret: env["WHATBUILD_GOOGLE_CLIENT_SECRET"] ?? null,
    microsoftTenant: microsoftTenant?.toLowerCase() ?? null,
    microsoftClientId: env["WHATBUILD_MICROSOFT_CLIENT_ID"]?.trim() || null,
    microsoftClientSecret: env["WHATBUILD_MICROSOFT_CLIENT_SECRET"] || null,
    webDist: env["WHATBUILD_WEB_DIST"] ?? null,
    runWorker: env["WHATBUILD_WORKER"] !== "0",
    signupAllowlist: env["WHATBUILD_SIGNUP_ALLOWLIST"] ? env["WHATBUILD_SIGNUP_ALLOWLIST"].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : null,
    instanceOwners: (env["WHATBUILD_INSTANCE_OWNERS"] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@") && !s.startsWith("@")),
    defaultTenantAllowance: Math.max(0, Math.floor(num(env["WHATBUILD_TENANT_ALLOWANCE"], 0))),
    sandboxTenant: env["WHATBUILD_SANDBOX_TENANT"]?.trim().toLowerCase() || null,
    // Cloud Run refuses request bodies over 32 MiB, so the relay stays under that.
    relayMaxBytes: num(env["WHATBUILD_RELAY_MAX_BYTES"], 25 * MiB),
    fileMaxBytes: num(env["WHATBUILD_FILE_MAX_BYTES"], 100 * MiB),
    parseCapBytes: num(env["WHATBUILD_PARSE_CAP_BYTES"], 25 * MiB),
    grantTtlSeconds: num(env["WHATBUILD_GRANT_TTL_SECONDS"], 30 * 60),
    urlFetchMaxBytes: num(env["WHATBUILD_URL_FETCH_MAX_BYTES"], 25 * MiB),
    sessionDays: num(env["WHATBUILD_SESSION_DAYS"], 30),
    analyticsId: /^G-[A-Z0-9]+$/.test(env["WHATBUILD_ANALYTICS_ID"]?.trim() ?? "") ? env["WHATBUILD_ANALYTICS_ID"]!.trim() : null,
    accessTokenSeconds: num(env["WHATBUILD_ACCESS_TOKEN_SECONDS"], 3600),
    refreshTokenDays: num(env["WHATBUILD_REFRESH_TOKEN_DAYS"], 30),
  };
}
