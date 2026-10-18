import { z } from "zod";
import { invalid } from "./errors.ts";
import { ULID_PATTERN } from "./util.ts";

/** A word with "a" or "an" before it, by its first letter: "an outcome", "a source", "an editor". */
export const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

export const id = (what: string) =>
  z.string().regex(ULID_PATTERN, `must be ${withArticle(what)} id: 26 characters of Crockford base32`).describe(`The ${what} id.`);

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

/** Tags sent to an update: the whole list, never an addition to it. */
export const replacingTags = tags.describe("The whole list of tags, which replaces the current one: send every tag to keep, or [] for none. Up to 50, stored lower-case.");

export const authorType = z
  .enum(["human", "agent"])
  .describe("Who exercised judgment. An agent writing with a person's credentials is still an agent unless relaying the person's own words.");

const quote = (path: PropertyKey[]) => `\`${path.join(".")}\``;
const list = (names: string[]) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
/** Names as words: "a", "a and b", "a, b and c". */
export const wordList = list;

/**
 * Where a value holds a null character (U+0000), as paths into it. Postgres keeps no such
 * character in text, so a call that sends one is refused before anything reads it, and never
 * has it stripped.
 */
export function nullCharacterPaths(value: unknown, path: PropertyKey[] = [], found: PropertyKey[][] = []): PropertyKey[][] {
  if (typeof value === "string") {
    if (value.includes("\u0000")) found.push(path);
  } else if (Array.isArray(value)) value.forEach((v, i) => nullCharacterPaths(v, [...path, i], found));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) nullCharacterPaths(v, [...path, k], found);
  return found;
}

/** The sentence that refuses the null characters at these paths, naming each field. */
export function nullCharacterSentence(paths: PropertyKey[][]): string {
  return `${list(paths.map(quote))} ${paths.length === 1 ? "holds" : "hold"} a null character (U+0000), which WhatBuild cannot store or search: take it out.`;
}

/** Refuse a call whose fields hold a null character, naming them: `422 invalid_input`. */
export function refuseNullCharacters(fields: Record<string, unknown>, details: Record<string, unknown> = {}): void {
  const paths = nullCharacterPaths(fields);
  if (paths.length)
    throw invalid("invalid_input", `${nullCharacterSentence(paths)} Nothing was changed; correct the call and send it again.`, { ...details, fields: paths.map((p) => p.join(".")) });
}

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

/** A schema without the wrappers that change no value's shape: optional, nullable, a default. */
function unwrapped(schema: z.ZodType | undefined): z.ZodType | undefined {
  let s = schema as unknown as { def: { type: string; innerType?: z.ZodType; in?: z.ZodType } } | undefined;
  for (let i = 0; s && i < 10; i++) {
    if (["optional", "nullable", "default", "prefault", "readonly", "catch", "nonoptional"].includes(s.def.type)) s = s.def.innerType as never;
    else if (s.def.type === "pipe") s = s.def.in as never;
    else break;
  }
  return s as unknown as z.ZodType | undefined;
}

/** The schema of the field at a path, or undefined where the path leaves what the schema says. */
function schemaAt(schema: z.ZodType | undefined, path: PropertyKey[]): z.ZodType | undefined {
  let s = unwrapped(schema);
  for (const k of path) {
    const def = (s as unknown as { def?: { type: string; shape?: Record<string, z.ZodType>; element?: z.ZodType } } | undefined)?.def;
    if (def?.type === "object") s = unwrapped(def.shape?.[String(k)]);
    else if (def?.type === "array") s = unwrapped(def.element);
    else return undefined;
  }
  return s;
}

const kindOf = (s: z.ZodType | undefined) => (s as unknown as { def?: { type: string } } | undefined)?.def?.type;
const enumValues = (s: z.ZodType) => Object.values((s as unknown as { def: { entries: Record<string, string | number> } }).def.entries).map(String);

/** What a value sent is, in words: "a string", "null". */
function sentAs(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  if (typeof value === "boolean") return String(value);
  return withArticle(typeof value);
}

/**
 * A list field sent as something else, in one sentence that says what it takes, with an example
 * made from what was sent where it can be: "`status` takes a list of any of unconfirmed,
 * confirmed, refuted and superseded, such as ["confirmed"], not a string."
 */
function notAList(path: PropertyKey[], list_: z.ZodType, value: unknown): string {
  const element = unwrapped((list_ as unknown as { def: { element: z.ZodType } }).def.element);
  const sent = typeof value === "string" && value.length <= 200 ? value.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 3) : [];
  let takes = "a list";
  let example: string[] = [];
  if (kindOf(element) === "enum") {
    const values = enumValues(element!);
    takes = `a list of any of ${list(values)}`;
    example = sent.filter((v) => values.includes(v));
    if (!example.length) example = values.slice(0, 1);
  } else if (kindOf(element) === "string") {
    takes = "a list of strings";
    example = sent;
  } else if (kindOf(element) === "number") takes = "a list of numbers";
  else if (kindOf(element) === "object") takes = "a list of objects";
  return `${quote(path)} takes ${takes}${example.length ? `, such as ${JSON.stringify(example)}` : ""}, not ${sentAs(value)}.`;
}

/**
 * Format zod issues as one message an agent can act on. The cause leads: fields the call sent that
 * are not recognized come first, each with the required field it was likely meant as, then what is
 * missing ("`notes` is required"), then any other problem with a value. A value of the wrong type
 * is named once, without the checks the library also ran on it (a string's length against a
 * list's limit), and a list sent as something else says what the list takes, from `schema`.
 * `skip` names top-level fields the caller words a refusal of itself.
 */
export function formatIssues(error: z.ZodError, input?: unknown, opts: { schema?: z.ZodType; skip?: string[] } = {}): string {
  const unknown: { path: PropertyKey[]; keys: string[] }[] = [];
  const missing: PropertyKey[][] = [];
  const other: string[] = [];
  const sent = (path: PropertyKey[]) => valueAt(input, path) !== undefined;
  const wrongType = new Set(error.issues.filter((i) => i.code === "invalid_type" && i.path.length && sent(i.path)).map((i) => i.path.join(".")));
  const named = new Set<string>();
  for (const i of error.issues) {
    const at = i.path.join(".");
    if (i.code === "unrecognized_keys") {
      const keys = (i as { keys: string[] }).keys.filter((k) => i.path.length || !opts.skip?.includes(k));
      if (keys.length) unknown.push({ path: i.path, keys });
    } else if (i.code === "invalid_type" && i.path.length && !sent(i.path)) missing.push(i.path);
    else if (wrongType.has(at)) {
      if (i.code !== "invalid_type" || named.has(at)) continue;
      named.add(at);
      const field = schemaAt(opts.schema, i.path);
      other.push(kindOf(field) === "array" ? notAList(i.path, field!, valueAt(input, i.path)) : `${quote(i.path)}: ${i.message.replace(/^Invalid input: /, "")}`);
    } else other.push(i.path.length ? `${quote(i.path)}: ${i.message.replace(/^Invalid input: /, "")}` : i.message);
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
