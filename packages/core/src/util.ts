import { createHash, randomBytes } from "node:crypto";
import { monotonicFactory } from "ulid";

const ulidFactory = monotonicFactory();

/** A time-ordered, opaque identifier: 26 characters of Crockford base32. */
export function newId(): string {
  return ulidFactory();
}

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** A fresh opaque concurrency token. */
export function newEtag(): string {
  return randomBytes(9).toString("base64url");
}

/** Compare ETags tolerantly: whitespace, a weak `W/` prefix and surrounding quotes are ignored. */
export function sameEtag(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
  return norm(a) === norm(b);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Canonical JSON: sorted keys, no insignificant whitespace, so every replica hashes identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Unicode NFKD, ASCII only, lower case, runs of other characters to `-`, at most `max` characters. */
export function slugify(input: string, max = 60, fallback = "untitled"): string {
  const s = input
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

/** Normalize a dimension value: NFKC, collapsed whitespace, trimmed, case-folded. */
export function normalizeKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

export function collapse(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Opaque cursors: URL-safe base64 of a JSON value. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T>(cursor: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}
