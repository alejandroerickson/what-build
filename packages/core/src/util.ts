import { createHash, randomBytes } from "node:crypto";
import { monotonicFactory } from "ulid";

const ulidFactory = monotonicFactory();

/** A time-ordered, opaque identifier: 26 characters of Crockford base32. */
export function newId(): string {
  return ulidFactory();
}

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A time's day in UTC, as people read it: "27 Oct 2027". What the server writes into a message
 * (a refusal, a mail) is the same day the web app shows for the same time, which writes these
 * days in UTC too rather than in each reader's zone.
 */
export function utcDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

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

/** The SHA-256 of a stream's bytes, read a chunk at a time rather than held in memory. */
export async function sha256OfStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) hash.update(chunk.value);
  return hash.digest("hex");
}

/**
 * Text someone chose (a name), made safe to put in an email WhatBuild sends: one line, without
 * control, format or direction-changing characters, at most `max` characters.
 */
export function oneLine(text: string, max: number): string {
  const chars = Array.from(text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

/** A chosen name as an email shows it: on one line, at most `max` characters, in quotation marks it cannot close. */
export function quotedName(name: string, max = 60, unnamed = "Someone"): string {
  return `"${oneLine(name.replace(/["“”„‟]/g, "'"), max) || unnamed}"`;
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

/** Normalize a tag: NFKC, collapsed whitespace, trimmed, case-folded. */
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

/**
 * A LIKE or ILIKE pattern for text that contains `typed` as it was typed: its `%`, `_` and `\`
 * match themselves, not any text, any character or an escape. Every LIKE that takes what a
 * caller typed builds its pattern here.
 */
export function likeContaining(typed: string): string {
  return `%${typed.replace(/[\\%_]/g, "\\$&")}%`;
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
