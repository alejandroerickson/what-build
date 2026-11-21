import { json, type ActorSnapshot } from "./db.ts";
import { conflict, invalid } from "./errors.ts";
import { PLAYBOOK_STARTER } from "./playbook-starter/starter-text.ts";
import type { OpContext } from "./registry.ts";
import { sha256Hex, ULID_PATTERN } from "./util.ts";

/**
 * A product's Playbook: a bundle in the Open Knowledge Format (Markdown files with YAML frontmatter, and
 * the text files of the kits agents build) that the people's agents read and write together. Until
 * its first write a product serves WhatBuild's starter; that write copies the starter in, and the
 * bundle is the team's from then on. Every write keeps a revision.
 */

/** The Playbook version the bundle follows. */
export const OKF_VERSION = "0.2";

/** The most a file may hold, in bytes of UTF-8. */
export const PLAYBOOK_FILE_MAX_BYTES = 256 * 1024;
/** The most files a product's Playbook holds, removed ones not counted. */
export const PLAYBOOK_FILES_MAX = 2000;
/** The most its files hold together, removed ones not counted, in bytes of UTF-8. */
export const PLAYBOOK_TOTAL_MAX_BYTES = 32 * 1024 * 1024;
/** How many of a file's revisions are kept: the most recent. */
export const PLAYBOOK_REVISIONS_KEPT = 100;
/** How long a message lasts, read or not. */
export const PLAYBOOK_MESSAGE_DAYS = 60;
/** The most a message says, in characters. */
export const PLAYBOOK_MESSAGE_MAX = 4000;
/** How long something must have gone unchanged before housekeeping names it. */
export const PLAYBOOK_QUIET_DAYS = 30;

/** The parts of a product a file can say it applies to, as `applies_to` names them; `all` is every kind of work. */
export const PLAYBOOK_AREAS = ["all", "idea", "evidence", "exploration", "story"] as const;
export type PlaybookArea = (typeof PLAYBOOK_AREAS)[number];

/** The extensions a file may have: Markdown, and the text files a kit is made of. */
export const PLAYBOOK_EXTENSIONS = ["md", "js", "mjs", "cjs", "ts", "mts", "json", "css", "html", "svg", "txt", "py", "sh", "yaml", "yml", "toml", "csv"] as const;

/** Names Playbook reserves at every level, which WhatBuild writes itself. */
const RESERVED = new Set(["index.md", "log.md"]);
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PATH_MAX = 240;
const DEPTH_MAX = 8;

/** Who copied the starter in. */
export function whatbuildActor(version: string): ActorSnapshot {
  return { account_id: "whatbuild", display_name: "WhatBuild", surface: null, client: `whatbuild/${version}` };
}

/** How a path is written, as the rules say it in a refusal. */
export const PATH_RULES =
  `A path is relative to the bundle, as lessons/canvas-titles.md or kits/canvas/build.mjs: letters, digits, dots, hyphens and underscores, each part starting with a letter or digit, at most ${DEPTH_MAX} parts and ${PATH_MAX} characters, ending in .md or a kit's text file (${PLAYBOOK_EXTENSIONS.map((e) => `.${e}`).join(", ")}). index.md and log.md are written by WhatBuild at every level and are never written to. Two paths that differ only in capitals are one path: a laptop's folders could not hold both.`;

/** A path as stored: its leading slash, the Playbook form of a link within the bundle, taken off. Refused when it breaks the rules. */
export function playbookPath(raw: string, field = "path"): string {
  const path = raw.trim().replace(/^\/+/, "");
  const parts = path.split("/");
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  const ok = path.length > 0 && path.length <= PATH_MAX && parts.length <= DEPTH_MAX && parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..") && ext !== undefined && (PLAYBOOK_EXTENSIONS as readonly string[]).includes(ext);
  if (!ok) throw invalid("invalid_playbook_path", `${field} ${JSON.stringify(raw)} is not a path the Playbook takes. ${PATH_RULES} Nothing was changed.`, { [field]: raw });
  if (RESERVED.has(parts[parts.length - 1]!.toLowerCase()))
    throw invalid("playbook_reserved_path", `${path} is written by WhatBuild: index.md lists a folder and log.md its history, and playbook_read gives both (action="index" and action="history"). Write to another name. Nothing was changed.`, { [field]: path });
  return path;
}

/** Whether a path names a Markdown file, whatever the capitals of its extension: `.MD` needs frontmatter as `.md` does. */
export const isMarkdown = (path: string) => /\.md$/i.test(path);

/** What a Markdown file's frontmatter says, of the keys WhatBuild reads; the rest stays in the text, untouched. */
export interface PlaybookFrontmatter {
  type: string | null;
  title: string | null;
  description: string | null;
  applies_to: string[];
  tags: string[];
  status: string | null;
  stale_after: string | null;
}

const unquote = (s: string) => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t.replace(/\s+#.*$/, "");
};
const inlineList = (s: string) =>
  s
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(unquote)
    .filter(Boolean);

/**
 * A Markdown file's frontmatter: the block between a first line of `---` and the next. Only
 * top-level keys are read, a scalar, an inline list (`[a, b]`) or a block list (`- a` lines); a
 * nested mapping is left as written. Null when the file has none.
 */
export function readFrontmatter(text: string): Record<string, string | string[]> | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && (l.trim() === "---" || l.trim() === "..."));
  if (end < 0) return null;
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const v = out[listKey];
      out[listKey] = [...(Array.isArray(v) ? v : []), unquote(item[1]!)];
      continue;
    }
    if (/^\s/.test(line)) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv as unknown as [string, string, string];
    listKey = null;
    if (value === "") {
      out[key] = [];
      listKey = key;
    } else if (value.trim().startsWith("[")) out[key] = inlineList(value);
    else if (value.trim().startsWith("{")) out[key] = value.trim();
    else out[key] = unquote(value);
  }
  return out;
}

const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: string | string[] | undefined) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v.trim()] : []).map((s) => s.trim()).filter(Boolean);

/** An instant as Postgres keeps it, from a date or a date and time; null when it is neither. */
function instant(v: string | null): string | null {
  if (!v) return null;
  const m = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(v);
  if (!m) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** What a file says of itself, and what WhatBuild would have it say better, as warnings. Refused when a Markdown file lacks the frontmatter OKF requires. */
export function describeFile(path: string, content: string): { meta: PlaybookFrontmatter; warnings: string[] } {
  const none: PlaybookFrontmatter = { type: null, title: null, description: null, applies_to: [], tags: [], status: null, stale_after: null };
  if (!isMarkdown(path)) return { meta: none, warnings: [] };
  const fm = readFrontmatter(content);
  const example = "---\ntype: Lesson\ntitle: A sentence that says what it is\ndescription: One line on what a reader gets from it.\napplies_to: [exploration]\n---";
  if (!fm)
    throw invalid("playbook_frontmatter_missing", `${path} has no frontmatter. Every Markdown file of a Playbook starts with a block of YAML between two lines of ---, which names its type at least, as:\n${example}\nNothing was changed.`, { path });
  const type = str(fm["type"]);
  if (!type) throw invalid("playbook_type_missing", `${path}'s frontmatter names no type. OKF requires one (Lesson, Kit, Guide, Person, Product Concept: any word that says what kind of file it is), as:\n${example}\nNothing was changed.`, { path });
  const warnings: string[] = [];
  const title = str(fm["title"]);
  const description = str(fm["description"]);
  if (!title) warnings.push(`${path} has no title: the index lists it by its path. Give it a title, a sentence that says what it is.`);
  if (!description) warnings.push(`${path} has no description: the index shows a reader nothing about it before they open it. Give it one line.`);
  const applies = strs(fm["applies_to"]).map((a) => a.toLowerCase());
  const unknown = applies.filter((a) => !(PLAYBOOK_AREAS as readonly string[]).includes(a));
  if (unknown.length) warnings.push(`applies_to names ${unknown.join(", ")}, which WhatBuild does not know, so nothing points agents at it there. It takes ${PLAYBOOK_AREAS.join(", ")}.`);
  const staleRaw = str(fm["stale_after"]);
  const stale_after = instant(staleRaw);
  if (staleRaw && !stale_after) warnings.push(`stale_after ${JSON.stringify(staleRaw)} is not a date (2027-01-31) or an ISO 8601 time, so the file is never counted stale.`);
  const status = str(fm["status"]);
  if (status && !["draft", "stable", "deprecated"].includes(status)) warnings.push(`status ${status} is not one Playbook knows: draft, stable or deprecated.`);
  return {
    meta: { type, title, description, applies_to: applies.filter((a) => !unknown.includes(a)), tags: strs(fm["tags"]).map((t) => t.toLowerCase()), status, stale_after },
    warnings,
  };
}

/** A file's size in bytes of UTF-8. */
export const byteSize = (text: string) => Buffer.byteLength(text, "utf8");

/** Refuse a text too large for a file. */
export function checkFileSize(path: string, content: string) {
  const size = byteSize(content);
  if (size > PLAYBOOK_FILE_MAX_BYTES)
    throw invalid("playbook_file_too_large", `${path} holds ${size} bytes; a file of the Playbook holds at most ${PLAYBOOK_FILE_MAX_BYTES}. Split it, or keep the long part elsewhere and link to it. Nothing was changed.`, { path, size, max: PLAYBOOK_FILE_MAX_BYTES });
  return size;
}

// ---- Links to WhatBuild ------------------------------------------------------------------------

/** The kinds of object a whatbuild: link names. */
export const LINK_KINDS = ["sources", "mockups", "outcomes", "story", "product"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** How a link is written, as the guide and refusals say it. */
export const LINK_FORM =
  "whatbuild:sources/<record_id>, whatbuild:mockups/<mockup_id> (with @<version> and #<page> when it matters), whatbuild:outcomes/<outcome_id>, whatbuild:story/<page_id> (with @<version>) and whatbuild:product for the product concept";

const LINK = /whatbuild:([a-z]+)(?:\/([0-9A-Za-z]+))?(?:@(\d+))?(?:#([A-Za-z0-9._-]+))?/g;

export interface PlaybookLink {
  uri: string;
  kind: LinkKind;
  id: string | null;
  version: number | null;
  anchor: string | null;
}

/** The whatbuild: links a text holds, each once, and what is wrong with the ones that name nothing WhatBuild knows. */
export function linksIn(text: string): { links: PlaybookLink[]; malformed: string[] } {
  const links = new Map<string, PlaybookLink>();
  const malformed: string[] = [];
  for (const m of text.matchAll(LINK)) {
    const [uri, kind, id, version, anchor] = m as unknown as [string, string, string | undefined, string | undefined, string | undefined];
    // A form written out, as whatbuild:mockups/<mockup_id>, shows how a link is written and names nothing.
    if (id === undefined && text.startsWith("/<", m.index + uri.length)) continue;
    if (!(LINK_KINDS as readonly string[]).includes(kind) || (kind === "product" ? id !== undefined : !id || !ULID_PATTERN.test(id))) {
      malformed.push(uri);
      continue;
    }
    links.set(uri, { uri, kind: kind as LinkKind, id: id ?? null, version: version ? Number(version) : null, anchor: anchor ?? null });
  }
  return { links: [...links.values()], malformed: [...new Set(malformed)] };
}

/** Each link with what it names now: its title, and whether it is there, archived or missing. */
export async function resolveLinks(ctx: OpContext, links: PlaybookLink[]) {
  const pid = ctx.scope.product!.product_id;
  const ids = (kind: LinkKind) => [...new Set(links.filter((l) => l.kind === kind && l.id).map((l) => l.id!))];
  const found = new Map<string, { title: string; archived: boolean }>();
  const take = (kind: LinkKind, rows: { id: string; title: string; archived_at: string | null }[]) => {
    for (const r of rows) found.set(`${kind}/${r.id}`, { title: r.title, archived: r.archived_at !== null });
  };
  const s = ids("sources");
  if (s.length) take("sources", await ctx.db.selectFrom("records").select(["record_id as id", "title", "archived_at"]).where("product_id", "=", pid).where("record_id", "in", s).execute());
  const m = ids("mockups");
  if (m.length) take("mockups", await ctx.db.selectFrom("mockups").select(["mockup_id as id", "title", "archived_at"]).where("product_id", "=", pid).where("mockup_id", "in", m).execute());
  const o = ids("outcomes");
  if (o.length) take("outcomes", await ctx.db.selectFrom("outcomes").select(["outcome_id as id", "title", "archived_at"]).where("product_id", "=", pid).where("outcome_id", "in", o).execute());
  const p = ids("story");
  if (p.length) take("story", await ctx.db.selectFrom("story_pages").select(["page_id as id", "title", "archived_at"]).where("product_id", "=", pid).where("page_id", "in", p).execute());
  return links.map((l) => {
    if (l.kind === "product") return { ...l, title: ctx.scope.product!.name, status: "live" as const };
    const f = found.get(`${l.kind}/${l.id}`);
    return { ...l, title: f?.title ?? null, status: !f ? ("missing" as const) : f.archived ? ("archived" as const) : ("live" as const) };
  });
}

/** Keep the links a file holds, so what they name can say which files cite it. */
export async function storeLinks(ctx: OpContext, fileId: string, content: string | null) {
  await ctx.db.deleteFrom("playbook_links").where("file_id", "=", fileId).execute();
  if (content === null) return;
  const rows = linksIn(content)
    .links.filter((l) => l.id)
    .map((l) => ({ kind: l.kind, id: l.id! }));
  const unique = [...new Map(rows.map((r) => [`${r.kind}/${r.id}`, r])).values()];
  if (unique.length)
    await ctx.db
      .insertInto("playbook_links")
      .values(unique.map((r) => ({ tenant_id: ctx.scope.tenant!.tenant_id, product_id: ctx.scope.product!.product_id, file_id: fileId, target_kind: r.kind, target_id: r.id })))
      .execute();
}

/** The files of the Playbook that link to an object, for the answer that archives it: people and agents learn what still cites it. */
export async function playbookCitations(ctx: OpContext, kind: LinkKind, id: string): Promise<{ path: string; title: string | null }[]> {
  if (!ctx.scope.product) return [];
  return ctx.db
    .selectFrom("playbook_links as l")
    .innerJoin("playbook_files as f", "f.file_id", "l.file_id")
    .select(["f.path", "f.title"])
    .where("l.product_id", "=", ctx.scope.product.product_id)
    .where("l.target_kind", "=", kind)
    .where("l.target_id", "=", id)
    .where("f.removed_at", "is", null)
    .orderBy("f.path")
    .execute();
}

/** What an archive's answer adds when files of the Playbook cite what was archived; nothing while the Playbook is off, which points agents nowhere. */
export async function citedByPlaybook(ctx: OpContext, kind: LinkKind, id: string) {
  if (!ctx.scope.product || !(await playbookState(ctx)).enabled) return {};
  const files = await playbookCitations(ctx, kind, id);
  return files.length
    ? {
        playbook_cited_by: files,
        playbook_note: `${files.length === 1 ? "A file" : `${files.length} files`} of the product's Playbook ${files.length === 1 ? "links" : "link"} here. Change ${files.length === 1 ? "it" : "them"} if ${files.length === 1 ? "it" : "they"} should no longer send agents here: playbook_read(action="read") and playbook_write(action="write").`,
      }
    : {};
}

// ---- The starter --------------------------------------------------------------------------------

/** The starter's etag for a file: the same for the same text, so a write against the starter still matches once it is copied in. */
export const starterEtag = (content: string) => `starter-${sha256Hex(content).slice(0, 16)}`;

/** WhatBuild's starter, as it ships with this version. */
export function starterFiles() {
  return PLAYBOOK_STARTER.map((f) => ({ path: f.path, content: f.content, etag: starterEtag(f.content) }));
}

/** Whether the product's Playbook is on, and whether its starter was copied in. */
export async function playbookState(ctx: OpContext, lock = false) {
  let q = ctx.db.selectFrom("products").select(["playbook_enabled", "playbook_started_at"]).where("product_id", "=", ctx.scope.product!.product_id);
  if (lock) q = q.forUpdate();
  const r = await q.executeTakeFirstOrThrow();
  return { enabled: r.playbook_enabled, started: r.playbook_started_at !== null };
}

/** The refusal of a call to a Playbook that is off. */
export function playbookOff(changes: boolean) {
  return conflict(
    "playbook_off",
    `This product's Playbook is turned off, so nothing is read from it or written to it${changes ? ", and nothing was changed" : ""}. Its admins turn it on in the web app, in the product's Settings, under Playbook. Nothing in it was lost.`,
  );
}

/** Refuse unless the product's Playbook is on; say whether its starter was copied in. */
export async function requirePlaybook(ctx: OpContext, changes: boolean, lock = false) {
  const s = await playbookState(ctx, lock);
  if (!s.enabled) throw playbookOff(changes);
  return s;
}

/**
 * Copy the starter in, once, before the product's first write: the files become the team's, each
 * at its first revision by WhatBuild, with the etag the starter served.
 */
export async function copyStarterIn(ctx: OpContext, version: string, newId: () => string) {
  const actor = whatbuildActor(version);
  for (const f of starterFiles()) {
    const { meta } = describeFile(f.path, f.content);
    const file_id = newId();
    await ctx.db
      .insertInto("playbook_files")
      .values({
        file_id,
        tenant_id: ctx.scope.tenant!.tenant_id,
        product_id: ctx.scope.product!.product_id,
        path: f.path,
        content: f.content,
        ...meta,
        size: byteSize(f.content),
        revision: 1,
        etag: f.etag,
        created_at: ctx.now,
        created_by: json(actor),
        updated_at: ctx.now,
        updated_by: json(actor),
      })
      .execute();
    await ctx.db
      .insertInto("playbook_revisions")
      .values({ revision_id: newId(), tenant_id: ctx.scope.tenant!.tenant_id, product_id: ctx.scope.product!.product_id, file_id, revision: 1, change: "written", path: f.path, content: f.content, message: "Copied in from WhatBuild's starter.", created_at: ctx.now, created_by: json(actor) })
      .execute();
    await storeLinks(ctx, file_id, f.content);
  }
  await ctx.db.updateTable("products").set({ playbook_started_at: ctx.now }).where("product_id", "=", ctx.scope.product!.product_id).execute();
}

/** How many messages wait unread for the caller in the product, when its Playbook is on: one query, made on every agent's call. */
export async function playbookMessagesWaiting(ctx: Pick<OpContext, "db" | "scope" | "principal" | "now">): Promise<number> {
  if (!ctx.scope.product) return 0;
  const r = await ctx.db
    .selectFrom("playbook_messages as m")
    .innerJoin("products as p", "p.product_id", "m.product_id")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("m.product_id", "=", ctx.scope.product.product_id)
    .where("p.playbook_enabled", "=", true)
    .where("m.to_account_id", "=", ctx.principal.account_id)
    .where("m.read_at", "is", null)
    .where("m.expires_at", ">", ctx.now)
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}
