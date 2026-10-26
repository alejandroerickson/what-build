import type { ParsedFile } from "@whatbuild/parsers";

/**
 * The core depends only on these interfaces. Each adapter implements one; the in-memory ones are
 * for tests. No provider SDK is imported outside its own adapter.
 */

export interface BlobStat {
  size: number;
  contentType: string | null;
  sha256: string | null;
}

export interface BlobStore {
  /** Create-only: refuses to overwrite. Returns what was stored. */
  put(key: string, data: Uint8Array, options: { contentType: string }): Promise<{ size: number; sha256: string }>;
  /** Stream a body into a new blob, enforcing a size limit while reading. */
  putStream(
    key: string,
    body: ReadableStream<Uint8Array>,
    options: { contentType: string; maxBytes: number },
  ): Promise<{ size: number; sha256: string }>;
  get(key: string): Promise<Uint8Array>;
  /** A byte range, or the whole blob. A past-the-end range returns an empty body. */
  getStream(key: string, range?: { start: number; end?: number }): Promise<ReadableStream<Uint8Array>>;
  stat(key: string): Promise<BlobStat | null>;
  delete(key: string): Promise<void>;
  /** A short-lived URL that PUTs one new object of at most `maxBytes` directly to the store, when the store offers it. */
  signedUploadUrl?(key: string, contentType: string, expiresAt: Date, maxBytes: number): Promise<{ url: string; headers: Record<string, string> }>;
  /** A short-lived URL that GETs one object directly from the store, when the store offers it. */
  signedDownloadUrl?(key: string, fileName: string, contentType: string, expiresAt: Date): Promise<string>;
}

/** Signs and verifies the upload and download grants that travel in a header. */
export interface GrantSigner {
  sign(payload: Record<string, unknown>): string;
  verify(token: string): Record<string, unknown> | null;
}

/** Size-capped, SSRF-safe HTTPS fetch for `attachments.fetch_url`. */
export interface UrlFetcher {
  fetch(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; fileName: string; mediaType: string | null }>;
}

/**
 * Parses one file's bytes into its sidecars, away from the requests the server is answering. The
 * server runs each parse in a worker thread of its own, held to a memory and a time limit, so a
 * file that would need more ends as a failed derivation rather than taking the server down. Never
 * rejects for a bad file: every outcome is a status.
 */
export interface FileParser {
  parse(bytes: Uint8Array, fileName: string, options: { mediaType: string | null; parseCapBytes: number }): Promise<ParsedFile>;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** The largest JSON body the REST API reads; file bytes go through upload grants. */
export const REST_BODY_MAX_BYTES = 5 * 1024 * 1024;
/** Sign-in links one address may ask for in an hour. */
export const SIGN_IN_LINKS_PER_HOUR = 5;

export interface CoreConfig {
  /** The public origin, without a trailing slash. */
  publicBaseUrl: string;
  serverVersion: string;
  /** Upload limit through the service's own relay (Cloud Run caps a request body at 32 MiB). */
  relayMaxBytes: number;
  /** Upload limit per file overall (direct-to-store uploads may exceed the relay's). */
  fileMaxBytes: number;
  parseCapBytes: number;
  /** The JavaScript heap of the thread one file is parsed in, in MB; its buffers may take half as much again. */
  parseMemoryMb: number;
  /** How long one parse may run, in seconds. */
  parseTimeoutSeconds: number;
  /** Lifetime of upload and download grants, in seconds. */
  grantTtlSeconds: number;
  /** The origin a content site of its own serves prototypes from, without a trailing slash; null or absent serves them from publicBaseUrl. */
  contentBaseUrl?: string | null;
  /** Lifetime of a prototype's address, in seconds; 8 hours when absent. */
  prototypeGrantSeconds?: number;
  urlFetchMaxBytes: number;
  /** When set, only these emails (or @domains) may create an account without an invitation. */
  signupAllowlist?: string[] | null;
  /** Lower-cased addresses of the instance's owners: they create any number of organizations and give others an allowance. */
  instanceOwners?: string[];
  /** Organizations an address may create when no instance owner has given it an allowance. 0 when absent. */
  defaultTenantAllowance?: number;
  /** The plan of an organization someone other than an instance owner creates (`limits.ts`). Unlimited when absent. */
  newOrganizationPlan?: "free" | "unlimited";
  /** The key people's use is counted under (`usage.ts`); without it calls are counted and people are not. */
  usageKey?: string;
  /** Where the daily feedback digest goes (`feedback.ts`); null or absent, feedback stays in the database. */
  feedbackEmail?: string | null;
}

export interface Ports {
  blobs: BlobStore;
  grants: GrantSigner;
  parser: FileParser;
  config: CoreConfig;
  fetcher?: UrlFetcher;
  mailer?: Mailer;
  /** Wakes the job worker after a commit that enqueued work. */
  notifyJobs?: () => void;
}
