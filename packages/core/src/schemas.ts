import { z } from "zod";
import { ULID_PATTERN } from "./util.ts";

export const id = (what: string) =>
  z.string().regex(ULID_PATTERN, `must be a ${what} id: 26 characters of Crockford base32`).describe(`The ${what} id.`);

export const slug = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "lower-case letters, digits and hyphens");

export const limit = (def: number, max: number) =>
  z.number().int().min(1).max(max).default(def).describe(`Page size, default ${def}, at most ${max}. More is refused, not clamped.`);

export const cursor = z.string().max(500).optional().describe("Pass next_cursor from the previous page.");

export const expectedEtag = z
  .string()
  .min(1)
  .max(200)
  .describe("The etag from your latest read of this item. A stale one is refused with 409 stale_etag.");

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as yyyy-mm-dd");

export const tags = z.array(z.string().min(1).max(50)).max(50).describe("Up to 50 tags, stored lower-case.");

export const authorType = z
  .enum(["human", "agent"])
  .describe("Who exercised judgment. An agent writing with a person's credentials is still an agent unless relaying the person's own words.");

const quote = (path: PropertyKey[]) => `\`${path.join(".")}\``;
const list = (names: string[]) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The value at a path in the raw input, or undefined when any step is missing. */
function valueAt(input: unknown, path: PropertyKey[]): unknown {
  let v = input;
  for (const k of path) {
    if (!v || typeof v !== "object") return undefined;
    v = (v as Record<PropertyKey, unknown>)[k];
  }
  return v;
}

/** How far apart two field names are: an edit distance that ignores case, `_` and `-`. */
function distance(a: string, b: string): number {
  a = a.toLowerCase().replace(/[_-]/g, "");
  b = b.toLowerCase().replace(/[_-]/g, "");
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/**
 * The required field an unknown one was probably meant as: the only one missing beside it, or a
 * missing one whose name is close to it or contains it.
 */
function likelyRename(unknown: string, missing: string[], unknowns: number): string | undefined {
  if (missing.length === 1 && unknowns === 1) return missing[0];
  const near = missing.filter((m) => distance(unknown, m) <= Math.max(2, Math.floor(m.length / 3)) || m.includes(unknown) || unknown.includes(m));
  return near.length === 1 ? near[0] : undefined;
}

/**
 * Format zod issues as one message an agent can act on. The cause leads: fields the call sent that
 * are not recognized come first, each with the required field it was likely meant as, then what is
 * missing ("`notes` is required"), then any other problem with a value.
 */
export function formatIssues(error: z.ZodError, input?: unknown): string {
  const unknown: { path: PropertyKey[]; keys: string[] }[] = [];
  const missing: PropertyKey[][] = [];
  const other: string[] = [];
  for (const i of error.issues) {
    if (i.code === "unrecognized_keys") unknown.push({ path: i.path, keys: (i as { keys: string[] }).keys });
    else if (i.code === "invalid_type" && i.path.length && valueAt(input, i.path) === undefined) missing.push(i.path);
    else other.push(i.path.length ? `${quote(i.path)}: ${i.message.replace(/^Invalid input: /, "")}` : i.message);
  }
  const parts: string[] = [];
  const suggested = new Set<string>();
  for (const u of unknown) {
    const where = u.path.length ? `of ${quote(u.path)}` : "of this action";
    const siblings = missing.filter((m) => m.length === u.path.length + 1 && u.path.every((k, n) => m[n] === k)).map((m) => String(m.at(-1)));
    const plain: string[] = [];
    for (const k of u.keys) {
      const meant = likelyRename(k, siblings.filter((m) => !suggested.has([...u.path, m].join("."))), u.keys.length);
      if (meant) {
        suggested.add([...u.path, meant].join("."));
        parts.push(`\`${k}\` is not a field ${where}; did you mean \`${meant}\`?`);
      } else plain.push(`\`${k}\``);
    }
    if (plain.length) parts.push(`${list(plain)} ${plain.length === 1 ? "is not a field" : "are not fields"} ${where}.`);
  }
  for (const m of missing) parts.push(`${quote(m)} is required.`);
  for (const o of other) parts.push(`${o.replace(/\.$/, "")}.`);
  return parts.join(" ");
}
