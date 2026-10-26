/**
 * All configuration comes from the environment, read once at start-up. Names use one prefix,
 * WHATBUILD_, except the conventional DATABASE_URL, PORT and NODE_ENV.
 */
export interface ServerConfig {
  /** NODE_ENV when it is exactly `development` or `test`; anything else, or nothing, is production. */
  env: "development" | "test" | "production";
  port: number;
  publicBaseUrl: string;
  /**
   * Send a browser that opens a page on another name for this deployment to publicBaseUrl
   * (canonical-host.ts). On unless WHATBUILD_REDIRECT_TO_PUBLIC_URL is 0.
   */
  redirectToPublicUrl: boolean;
  /** The public site's origin (e.g. https://what-build.com), served by host beside the app; null for none. */
  siteUrl: string | null;
  /**
   * A content site of its own for mockups' prototypes (WHATBUILD_CONTENT_URL): an origin on another
   * registrable domain than the app's, served by this image by host. Null serves prototypes from the
   * app's own origin (prototype.ts).
   */
  contentUrl: string | null;
  /** How long a prototype's address lasts, in seconds (WHATBUILD_PROTOTYPE_GRANT_HOURS, 8 by default). */
  prototypeGrantSeconds: number;
  databaseUrl: string;
  /** Allow the development-only "sign in as" control. Never on in production. */
  devAuth: boolean;
  blobStore: "fs" | "memory" | "gcs";
  blobDir: string;
  gcsBucket: string | null;
  /** Hand out direct-to-bucket signed upload URLs (needs signBlob permission on the runtime identity). */
  gcsSignedUrls: boolean;
  grantKey: string;
  /** "none" in production without SMTP: email links are then off, and nothing secret is ever logged. Production takes smtp, acs or none. */
  mailer: "console" | "smtp" | "acs" | "memory" | "none";
  smtpUrl: string | null;
  acsEmailEndpoint: string | null;
  /** Select a user-assigned managed identity for ACS; null uses the system-assigned identity. */
  azureClientId: string | null;
  mailFrom: string;
  /** Where the daily feedback digest goes (WHATBUILD_FEEDBACK_EMAIL); null keeps feedback in the database only. */
  feedbackEmail: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  /** The one Microsoft Entra directory whose work accounts may sign in, by its ID (a GUID); null for none. */
  microsoftTenant: string | null;
  microsoftClientId: string | null;
  microsoftClientSecret: string | null;
  /**
   * Email domains the directory is trusted for: an address in one is taken from it without the
   * token's word (`xms_edov`) that the directory verified the domain, and so is a user principal
   * name. Lower case, without "@"; empty for none.
   */
  microsoftDomains: string[];
  webDist: string | null;
  runWorker: boolean;
  /** When set, only these emails (or @domains) may create an account; invited people always may. */
  signupAllowlist: string[] | null;
  /** Addresses that run this instance: they create any number of organizations and give others an allowance. */
  instanceOwners: string[];
  /** How many organizations an address may create when no instance owner has given it an allowance. */
  defaultTenantAllowance: number;
  /**
   * The plan of an organization someone other than an instance owner creates: unlimited unless the
   * deployment says free, as one that offers organizations to the public on a small budget does.
   */
  newOrganizationPlan: "free" | "unlimited";
  /** The slug of the example organization every account reads, if the deployment has one. A self-hosted deployment has none. */
  exampleTenant: string | null;
  relayMaxBytes: number;
  fileMaxBytes: number;
  parseCapBytes: number;
  /**
   * The JavaScript heap of the worker thread each file is parsed in, in MB; the buffers a parse
   * holds outside the heap may take half as much again. A parse that needs more ends as a failed
   * derivation.
   */
  parseMemoryMb: number;
  /** How long one parse may run, in seconds, before its thread is stopped and the derivation fails. */
  parseTimeoutSeconds: number;
  grantTtlSeconds: number;
  urlFetchMaxBytes: number;
  sessionDays: number;
  /** A Google Analytics measurement ID (G-…). The app loads analytics only for a person who accepts it; null for none. */
  analyticsId: string | null;
  accessTokenSeconds: number;
  refreshTokenDays: number;
  /** Who runs this deployment, as its privacy page names them (WHATBUILD_OPERATOR); null when unnamed. */
  operator: string | null;
  /** Where people write about their data: an email address or a web address (WHATBUILD_PRIVACY_CONTACT). */
  privacyContact: string | null;
  /** The providers that handle people's data for this deployment, and for what (WHATBUILD_PROVIDERS). */
  providers: Provider[];
}

export interface Provider {
  name: string;
  purpose: string;
}

/** WHATBUILD_PROVIDERS: "Name: what it does; Name: what it does". An entry without a colon is a name alone. */
export function providerList(v: string | undefined): Provider[] {
  return (v ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((entry) => {
      const colon = entry.indexOf(":");
      const name = (colon < 0 ? entry : entry.slice(0, colon)).trim().slice(0, 80);
      return { name, purpose: colon < 0 ? "" : entry.slice(colon + 1).trim().slice(0, 200) };
    })
    .filter((p) => p.name);
}

const MiB = 1024 * 1024;

/** Microsoft sign-in is on only when the directory, the client ID and the secret are all set. */
export function microsoftSignIn(config: ServerConfig): boolean {
  return Boolean(config.microsoftTenant && config.microsoftClientId && config.microsoftClientSecret);
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** WHATBUILD_MICROSOFT_DOMAINS: domains separated by commas, each with or without a leading "@". */
function domainList(v: string | undefined): string[] {
  const domains = (v ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  const bad = domains.find((d) => !DOMAIN.test(d));
  if (bad !== undefined) throw new Error(`WHATBUILD_MICROSOFT_DOMAINS lists "${bad}", which is not a domain. List domains such as example.com, separated by commas.`);
  return domains;
}

const MAILERS: ServerConfig["mailer"][] = ["console", "smtp", "acs", "memory", "none"];

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * WHATBUILD_CONTENT_URL as the origin it must be: a scheme and a host, no path, on another host than
 * the app's, and over HTTPS in production. Being on another registrable domain (not a subdomain of
 * the app's, which would be same-site) is the operator's to choose; the guide says so.
 */
function contentOrigin(v: string | undefined, publicBaseUrl: string, mode: ServerConfig["env"]): string | null {
  const raw = v?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("WHATBUILD_CONTENT_URL must be an origin such as https://usercontent.example.net.");
  }
  if (!/^https?:$/.test(url.protocol) || url.pathname.replace(/\/+$/, "") !== "" || url.search || url.hash || url.username)
    throw new Error("WHATBUILD_CONTENT_URL must be an origin, a scheme and a host with no path, such as https://usercontent.example.net.");
  if (mode === "production" && url.protocol !== "https:") throw new Error("WHATBUILD_CONTENT_URL must use https in production.");
  if (url.host.toLowerCase() === new URL(publicBaseUrl).host.toLowerCase()) throw new Error("WHATBUILD_CONTENT_URL must name another host than WHATBUILD_PUBLIC_URL; leave it unset to serve prototypes from the app's own origin.");
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  // Development behaviour (sign in as anyone, a published grant key, printed mail) only when asked
  // for by name: a server started with NODE_ENV unset, misspelt or anything else runs as production.
  const mode: ServerConfig["env"] = env["NODE_ENV"] === "development" || env["NODE_ENV"] === "test" ? env["NODE_ENV"] : "production";
  const port = num(env["PORT"], 8787);
  const publicBaseUrl = (env["WHATBUILD_PUBLIC_URL"] ?? `http://localhost:${mode === "development" ? num(env["WHATBUILD_WEB_PORT"], 5273) : port}`).replace(/\/+$/, "");
  const contentUrl = contentOrigin(env["WHATBUILD_CONTENT_URL"], publicBaseUrl, mode);
  const grantKey = env["WHATBUILD_GRANT_KEY"] ?? (mode === "production" ? "" : "development-only-grant-key-not-secret");
  if (mode === "production" && grantKey.length < 32) throw new Error("WHATBUILD_GRANT_KEY must be set to at least 32 random characters in production.");
  const blobStore = (env["WHATBUILD_BLOB_STORE"] ?? (env["WHATBUILD_GCS_BUCKET"] ? "gcs" : "fs")) as ServerConfig["blobStore"];
  const devAuth = mode !== "production" && env["WHATBUILD_DEV_AUTH"] !== "0";
  // One directory, by ID: never common, organizations, consumers or a domain, which would admit other directories' accounts.
  const microsoftTenant = env["WHATBUILD_MICROSOFT_TENANT"]?.trim() || null;
  if (microsoftTenant && !GUID.test(microsoftTenant)) throw new Error("WHATBUILD_MICROSOFT_TENANT must be the directory's ID, a GUID.");
  const feedbackEmail = env["WHATBUILD_FEEDBACK_EMAIL"]?.trim() || null;
  if (feedbackEmail && !/^[^\s@<>]+@[^\s@<>]+$/.test(feedbackEmail)) throw new Error("WHATBUILD_FEEDBACK_EMAIL must be one email address.");
  const mailer = (env["WHATBUILD_MAILER"]?.trim() || (env["WHATBUILD_SMTP_URL"] ? "smtp" : mode === "production" ? "none" : "console")) as ServerConfig["mailer"];
  if (!MAILERS.includes(mailer)) throw new Error(`WHATBUILD_MAILER must be one of ${MAILERS.join(", ")}.`);
  // The console mailer prints every sign-in link to the log, and the memory one delivers nothing.
  if (mode === "production" && mailer !== "smtp" && mailer !== "acs" && mailer !== "none")
    throw new Error("WHATBUILD_MAILER must be smtp, acs or none in production: configure a mail provider to send mail, or leave email links off.");
  const acsEmailEndpoint = env["WHATBUILD_ACS_EMAIL_ENDPOINT"]?.trim() || null;
  const azureClientId = env["WHATBUILD_AZURE_CLIENT_ID"]?.trim() || null;
  if (mailer === "acs") {
    let endpoint: URL;
    try { endpoint = new URL(acsEmailEndpoint ?? ""); }
    catch { throw new Error("WHATBUILD_ACS_EMAIL_ENDPOINT is required for the acs mailer and must be an HTTPS origin."); }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/")
      throw new Error("WHATBUILD_ACS_EMAIL_ENDPOINT must be an HTTPS origin without credentials, a path, query or fragment.");
    if (!env["WHATBUILD_MAIL_FROM"]?.trim()) throw new Error("WHATBUILD_MAIL_FROM is required for the acs mailer; use a sender from its verified domain.");
    if (azureClientId && !GUID.test(azureClientId)) throw new Error("WHATBUILD_AZURE_CLIENT_ID must be a managed identity's client ID, a GUID.");
  }
  return {
    env: mode,
    port,
    publicBaseUrl,
    redirectToPublicUrl: env["WHATBUILD_REDIRECT_TO_PUBLIC_URL"]?.trim() !== "0",
    siteUrl: env["WHATBUILD_SITE_URL"] ? env["WHATBUILD_SITE_URL"].replace(/\/+$/, "") : null,
    contentUrl,
    prototypeGrantSeconds: Math.max(60, Math.round(num(env["WHATBUILD_PROTOTYPE_GRANT_HOURS"], 8) * 3600)),
    databaseUrl: env["DATABASE_URL"] ?? "",
    devAuth,
    blobStore,
    blobDir: env["WHATBUILD_BLOB_DIR"] ?? ".what-build/blobs",
    gcsBucket: env["WHATBUILD_GCS_BUCKET"] ?? null,
    gcsSignedUrls: env["WHATBUILD_GCS_SIGNED_URLS"] === "1",
    grantKey,
    mailer,
    smtpUrl: env["WHATBUILD_SMTP_URL"] ?? null,
    acsEmailEndpoint,
    azureClientId,
    mailFrom: env["WHATBUILD_MAIL_FROM"] ?? "WhatBuild <no-reply@localhost>",
    feedbackEmail,
    googleClientId: env["WHATBUILD_GOOGLE_CLIENT_ID"] ?? null,
    googleClientSecret: env["WHATBUILD_GOOGLE_CLIENT_SECRET"] ?? null,
    microsoftTenant: microsoftTenant?.toLowerCase() ?? null,
    microsoftClientId: env["WHATBUILD_MICROSOFT_CLIENT_ID"]?.trim() || null,
    microsoftClientSecret: env["WHATBUILD_MICROSOFT_CLIENT_SECRET"] || null,
    microsoftDomains: domainList(env["WHATBUILD_MICROSOFT_DOMAINS"]),
    webDist: env["WHATBUILD_WEB_DIST"] ?? null,
    runWorker: env["WHATBUILD_WORKER"] !== "0",
    signupAllowlist: env["WHATBUILD_SIGNUP_ALLOWLIST"] ? env["WHATBUILD_SIGNUP_ALLOWLIST"].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : null,
    instanceOwners: (env["WHATBUILD_INSTANCE_OWNERS"] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@") && !s.startsWith("@")),
    defaultTenantAllowance: Math.max(0, Math.floor(num(env["WHATBUILD_TENANT_ALLOWANCE"], 0))),
    newOrganizationPlan: env["WHATBUILD_NEW_ORGANIZATION_PLAN"]?.trim().toLowerCase() === "free" ? "free" : "unlimited",
    exampleTenant: env["WHATBUILD_EXAMPLE_TENANT"]?.trim().toLowerCase() || null,
    // Cloud Run refuses request bodies over 32 MiB, so the relay stays under that.
    relayMaxBytes: num(env["WHATBUILD_RELAY_MAX_BYTES"], 25 * MiB),
    fileMaxBytes: num(env["WHATBUILD_FILE_MAX_BYTES"], 100 * MiB),
    parseCapBytes: num(env["WHATBUILD_PARSE_CAP_BYTES"], 25 * MiB),
    // Sized for a 1 GiB instance: a parse at the limit leaves the server about half of it.
    parseMemoryMb: Math.max(32, Math.floor(num(env["WHATBUILD_PARSE_MEMORY_MB"], 384))),
    parseTimeoutSeconds: Math.max(1, num(env["WHATBUILD_PARSE_TIMEOUT_SECONDS"], 120)),
    grantTtlSeconds: num(env["WHATBUILD_GRANT_TTL_SECONDS"], 30 * 60),
    urlFetchMaxBytes: num(env["WHATBUILD_URL_FETCH_MAX_BYTES"], 25 * MiB),
    sessionDays: num(env["WHATBUILD_SESSION_DAYS"], 30),
    analyticsId: /^G-[A-Z0-9]+$/.test(env["WHATBUILD_ANALYTICS_ID"]?.trim() ?? "") ? env["WHATBUILD_ANALYTICS_ID"]!.trim() : null,
    accessTokenSeconds: num(env["WHATBUILD_ACCESS_TOKEN_SECONDS"], 3600),
    refreshTokenDays: num(env["WHATBUILD_REFRESH_TOKEN_DAYS"], 30),
    operator: env["WHATBUILD_OPERATOR"]?.trim().slice(0, 120) || null,
    privacyContact: env["WHATBUILD_PRIVACY_CONTACT"]?.trim().slice(0, 200) || null,
    providers: providerList(env["WHATBUILD_PROVIDERS"]),
  };
}
