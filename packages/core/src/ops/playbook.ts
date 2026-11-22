import { TooLargeError, TooManyEntriesError, zipEntries, zipLitter } from "@whatbuild/parsers";
import { strToU8, zipSync } from "fflate";
import { sql } from "kysely";
import { z } from "zod";
import { productId, recordActivity, tenantId } from "../common.ts";
import { json, type ActorSnapshot, type Tx } from "../db.ts";
import { checkConfirmation, deleteGuards, leaveTombstone, tombstoneOf } from "../deletion.ts";
import { AppError, conflict, gone, invalid, notFound, tooLarge } from "../errors.ts";
import {
  byteSize,
  checkFileSize,
  copyStarterIn,
  describeFile,
  isMarkdown,
  LINK_FORM,
  LINK_KINDS,
  linksIn,
  PLAYBOOK_AREAS,
  PLAYBOOK_FILE_MAX_BYTES,
  PLAYBOOK_FILES_MAX,
  PLAYBOOK_MESSAGE_DAYS,
  PLAYBOOK_MESSAGE_MAX,
  PLAYBOOK_QUIET_DAYS,
  PLAYBOOK_REVISIONS_KEPT,
  PLAYBOOK_TOTAL_MAX_BYTES,
  OKF_VERSION,
  playbookMessagesWaiting,
  playbookPath,
  PATH_RULES,
  requirePlaybook,
  resolveLinks,
  starterFiles,
  storeLinks,
  whatbuildActor,
  type PlaybookArea,
} from "../playbook.ts";
import { effectiveRole, membershipsFor, roleAtLeast } from "../policy.ts";
import { defineOperation, type OpContext, type PrepareContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { likeContaining, newEtag, newId, sameEtag, sha256Hex, utcDay } from "../util.ts";
import { DOWNLOAD_GRANT_HEADER, requesterClaims, UPLOAD_GRANT_HEADER } from "./attachments.ts";
import { TOOLS_VERSION } from "./meta.ts";

/**
 * A product's Playbook over REST and MCP: its files read, searched, written, moved, removed and restored,
 * several at once, with every revision kept; messages between people's agents beside it; and what
 * agents might tidy. See playbook.ts for the bundle's rules and the starter.
 */

/** What every answer giving a file's metadata says of its size and sha256. */
const SIZE_AND_SHA256 = "size is the file's text in bytes as UTF-8, and sha256 the hex SHA-256 of those bytes: compare it with your own copy's to check a file arrived whole.";

const WHAT_IT_IS =
  "The Playbook is the product's shared knowledge, which the agents of everyone working on it read and write: what is current, lessons from people's corrections, the kits agents build pages with, people's pages, and how the team uses it. It is a bundle in the Open Knowledge Format: Markdown files with YAML frontmatter, and a kit's text files.";

type FileRow = {
  file_id: string;
  path: string;
  content: string | null;
  type: string | null;
  title: string | null;
  description: string | null;
  applies_to: string[];
  tags: string[];
  status: string | null;
  stale_after: string | null;
  size: number;
  revision: number;
  etag: string;
  created_at: string;
  created_by: ActorSnapshot;
  updated_at: string;
  updated_by: ActorSnapshot;
  removed_at: string | null;
  /** The text's sha256, when the row was read without its text. */
  sha256?: string | null;
};

const FILE_COLUMNS = ["file_id", "path", "content", "type", "title", "description", "applies_to", "tags", "status", "stale_after", "size", "revision", "etag", "created_at", "created_by", "updated_at", "updated_by", "removed_at"] as const;

/** The sha256 of a file's text as UTF-8, in hex, worked out where the text is: a read that leaves the text out still gives it. */
const CONTENT_SHA256 = sql<string | null>`encode(sha256(convert_to(content, 'UTF8')), 'hex')`;

/** A file's sha256: the one read beside it, or else its text's. */
const sha256Of = (f: { content: string | null; sha256?: string | null | undefined }) => f.sha256 ?? (f.content === null ? null : sha256Hex(f.content));

const who = (a: ActorSnapshot | null | undefined) => (a ? { display_name: a.display_name || "Someone", ...(a.client ? { client: a.client } : {}) } : null);

/** A file as answers give it, with or without its text. */
function fileView(f: Omit<FileRow, "file_id" | "created_at" | "created_by"> & { starter?: boolean }, now: string, withContent: boolean) {
  return {
    path: f.path,
    type: f.type,
    title: f.title,
    description: f.description,
    applies_to: f.applies_to,
    tags: f.tags,
    status: f.status,
    stale_after: f.stale_after,
    ...(f.stale_after && f.stale_after <= now ? { stale: true } : {}),
    size: f.size,
    sha256: sha256Of(f),
    revision: f.revision,
    etag: f.etag,
    // The starter served before the first write has no time of its own.
    updated_at: f.updated_at || null,
    updated_by: who(f.updated_by),
    ...(f.starter ? { from_starter: true } : {}),
    ...(withContent ? { content: f.content } : {}),
  };
}

/** The starter as the files of a product that has not written to its Playbook yet: revision 0, by WhatBuild. */
function starterRows(): (FileRow & { starter: true })[] {
  const actor = whatbuildActor(TOOLS_VERSION);
  return starterFiles().map((f) => {
    const { meta } = describeFile(f.path, f.content);
    return { file_id: "", path: f.path, content: f.content, ...meta, size: byteSize(f.content), revision: 0, etag: f.etag, created_at: "", created_by: actor, updated_at: "", updated_by: actor, removed_at: null, starter: true };
  });
}

/** The product's files that are not removed, in path order; the starter's while it has written none. */
async function liveFiles(ctx: OpContext, started: boolean, opts: { prefix?: string; withContent?: boolean; withHash?: boolean } = {}): Promise<FileRow[]> {
  if (!started) return starterRows().filter((f) => !opts.prefix || f.path.startsWith(opts.prefix));
  let q = ctx.db
    .selectFrom("playbook_files")
    .select(FILE_COLUMNS.filter((c) => c !== "content"))
    // A hash is worked out in the database only for an answer that gives it without the text, which reading every file's text to hash it would cost.
    .select([(opts.withContent ? sql<string | null>`content` : sql<string | null>`null`).as("content"), (opts.withHash && !opts.withContent ? CONTENT_SHA256 : sql<string | null>`null`).as("sha256")])
    .where("product_id", "=", productId(ctx))
    .where("removed_at", "is", null)
    .orderBy(sql`path collate "C"`);
  if (opts.prefix) q = q.where("path", "like", `${opts.prefix.replace(/[\\%_]/g, "\\$&")}%`);
  return (await q.execute()) as FileRow[];
}

/** The file at a path that is not removed, held for the change about to be made. */
async function liveFile(ctx: OpContext, path: string, lock = true): Promise<FileRow | undefined> {
  let q = ctx.db.selectFrom("playbook_files").select([...FILE_COLUMNS]).where("product_id", "=", productId(ctx)).where("path", "=", path).where("removed_at", "is", null);
  if (lock) q = q.forUpdate();
  return (await q.executeTakeFirst()) as FileRow | undefined;
}

/** A file that is not removed whose path differs from this one only in capitals: two such paths could not sit side by side in a folder on most machines. */
async function caseTwin(ctx: OpContext, path: string): Promise<string | undefined> {
  const r = await ctx.db
    .selectFrom("playbook_files")
    .select("path")
    .where("product_id", "=", productId(ctx))
    .where("removed_at", "is", null)
    .where(sql<boolean>`lower(path) = lower(${path})`)
    .where("path", "<>", path)
    .executeTakeFirst();
  return r?.path;
}

function caseTaken(path: string, twin: string) {
  return conflict("playbook_path_taken", `${twin} is there already, and ${path} differs from it only in capitals, which most machines' folders take for the same name. Write to ${twin}, or choose another name. Nothing was changed.`, { path: twin });
}

/** The file a path names for its history: the one there now, or else the one removed from it last. */
async function fileAtPath(ctx: OpContext, path: string): Promise<FileRow | undefined> {
  return (await ctx.db
    .selectFrom("playbook_files")
    .select([...FILE_COLUMNS])
    .where("product_id", "=", productId(ctx))
    .where("path", "=", path)
    .orderBy(sql`removed_at is null`, "desc")
    .orderBy("updated_at", "desc")
    .limit(1)
    .executeTakeFirst()) as FileRow | undefined;
}

/**
 * The refusal for a path that no file holds, removed or not: 410 when the file there was deleted
 * permanently; 404 naming where it is now when it was moved away; else 404. `change` adds that
 * nothing was changed, for a write.
 */
async function noFileAt(ctx: OpContext, path: string, change = false): Promise<AppError> {
  const unchanged = change ? " Nothing was changed." : "";
  // The file a revision kept at this path belongs to, when no file is here now: it was moved away. Its row has its current path.
  const moved = await ctx.db
    .selectFrom("playbook_revisions as r")
    .innerJoin("playbook_files as f", "f.file_id", "r.file_id")
    .select(["f.path", "f.removed_at", (eb) => eb.fn.max("r.created_at").as("at")])
    .where("r.product_id", "=", productId(ctx))
    .where("r.path", "=", path)
    .where("f.path", "<>", path)
    .groupBy(["f.file_id", "f.path", "f.removed_at"])
    .orderBy("at", "desc")
    .limit(1)
    .executeTakeFirst();
  const tomb = await tombstoneOf(ctx, "playbook_file", path);
  // Whichever happened last at the path is what it says: a purge there after the move, or a file there again and moved away after the purge.
  if (tomb && (!moved || Date.parse(String(tomb.deleted_at)) >= Date.parse(String(moved.at))))
    return gone("playbook_file_deleted", `${path} was deleted permanently from the Playbook on ${tomb.deleted_at}, with every revision of it.${unchanged}`, { tombstone: tomb });
  if (moved)
    return notFound(
      `The file that was at ${path} was moved, and is at ${moved.path} now${moved.removed_at ? `, where it was removed on ${utcDay(String(moved.removed_at))}` : ""}. Name ${moved.path}: its history there includes its revisions at ${path}.${unchanged}`,
      { path, moved_to: moved.path, ...(moved.removed_at ? { removed: true } : {}) },
    );
  return notFound(`The Playbook has no file ${path}. playbook_read(action="index") lists the files it has.${unchanged}`, { path });
}

/** The file a path names for its history, a restore or a purge: the one there now, or the one removed from it last; refused as noFileAt says when there is none. */
async function fileForHistory(ctx: OpContext, path: string, change = false): Promise<FileRow> {
  const f = await fileAtPath(ctx, path);
  if (!f) throw await noFileAt(ctx, path, change);
  return f;
}

/** The refusal of a read of a path that holds nothing, saying when it was removed if it was. */
async function nothingAt(ctx: OpContext, path: string, started: boolean, change = false) {
  if (!started) return notFound(`The Playbook has no file ${path}. playbook_read(action="index") lists the files it has.`, { path });
  const removed = await fileAtPath(ctx, path);
  if (removed?.removed_at)
    return notFound(
      `${path} was removed on ${utcDay(removed.removed_at)} by ${removed.updated_by.display_name || "someone"}, at revision ${removed.revision}. playbook_read(action="history", params={path}) lists its revisions, and playbook_write(action="restore") brings one back.${change ? " Nothing was changed." : ""}`,
      { path, removed_at: removed.removed_at, revision: removed.revision },
    );
  return noFileAt(ctx, path, change);
}

/** The refusal of a write against a file that changed since it was read: what is there now, to merge with. */
function changedSince(f: FileRow, expected: string | undefined) {
  const what = expected ? "changed since you read it" : "exists already, so a write names the etag of your read of it";
  return new AppError(
    409,
    "stale_etag",
    `${f.path} ${what}: it is at revision ${f.revision}, written by ${f.updated_by.display_name || "someone"} on ${utcDay(f.updated_at)}. Its text is in details.current_content: merge your change into it, then write again with details.current_etag. Nothing was changed.`,
    { path: f.path, current_etag: f.etag, current_revision: f.revision, current_content: f.content, updated_by: who(f.updated_by), updated_at: f.updated_at },
  );
}

/** The refusal of an etag sent for a path that holds nothing. */
function nothingToMatch(path: string) {
  return conflict("stale_etag", `${path} holds no file, so there is nothing for expected_etag to match: you read something else. Leave expected_etag out to write it new. Nothing was changed.`, { path, current_etag: null });
}

/** Copy the starter in before the product's first write, once. Returns nothing; the bundle is the team's after. */
async function startIfNeeded(ctx: OpContext) {
  const s = await requirePlaybook(ctx, true, true);
  if (!s.started) await copyStarterIn(ctx, TOOLS_VERSION, newId);
}

/** Refuse a change that would take the Playbook past its limits. */
async function checkTotals(ctx: OpContext) {
  const r = await ctx.db
    .selectFrom("playbook_files")
    .select((eb) => [eb.fn.countAll<string>().as("n"), eb.fn.coalesce(eb.fn.sum<string>("size"), sql<string>`0`).as("bytes")])
    .where("product_id", "=", productId(ctx))
    .where("removed_at", "is", null)
    .executeTakeFirstOrThrow();
  if (Number(r.n) > PLAYBOOK_FILES_MAX)
    throw invalid("playbook_full", `The Playbook would hold ${r.n} files; it holds at most ${PLAYBOOK_FILES_MAX}. Merge or remove files first (playbook_read(action="housekeeping") names candidates). Nothing was changed.`, { files: Number(r.n), max: PLAYBOOK_FILES_MAX });
  if (Number(r.bytes) > PLAYBOOK_TOTAL_MAX_BYTES)
    throw invalid("playbook_full", `The Playbook's files would hold ${r.bytes} bytes together; they hold at most ${PLAYBOOK_TOTAL_MAX_BYTES}. Shorten or remove files first. Nothing was changed.`, { bytes: Number(r.bytes), max: PLAYBOOK_TOTAL_MAX_BYTES });
}

type Change = "written" | "removed" | "moved" | "restored";

/** Keep a revision of a file as a change left it, and only the most recent PLAYBOOK_REVISIONS_KEPT. */
async function keepRevision(ctx: OpContext, f: { file_id: string; path: string; revision: number }, change: Change, content: string | null, message: string | undefined) {
  await ctx.db
    .insertInto("playbook_revisions")
    .values({ revision_id: newId(), tenant_id: tenantId(ctx), product_id: productId(ctx), file_id: f.file_id, revision: f.revision, change, path: f.path, content, message: message ?? null, created_at: ctx.now, created_by: json(ctx.actor) })
    .execute();
  await ctx.db.deleteFrom("playbook_revisions").where("file_id", "=", f.file_id).where("revision", "<=", f.revision - PLAYBOOK_REVISIONS_KEPT).execute();
}

/** What a write answers beside the file: what its frontmatter lacks, and links that name nothing, or something archived. */
async function writeWarnings(ctx: OpContext, path: string, content: string, frontmatter: string[]) {
  const { links, malformed } = linksIn(content);
  const resolved = await resolveLinks(ctx, links);
  const warnings = [...frontmatter];
  for (const m of malformed) warnings.push(`${m} is not a link WhatBuild reads. It takes ${LINK_FORM}.`);
  for (const l of resolved) if (l.status !== "live") warnings.push(`${l.uri} names ${l.status === "archived" ? `${l.title}, which is archived` : "nothing in this product"}.`);
  return { links: resolved, ...(warnings.length ? { warnings } : {}) };
}

const message = z.string().trim().max(500).optional().describe("Why, in a sentence: kept with the revision, and shown in the file's history.");
const pathField = z.string().min(1).max(260).describe("The file's path in the bundle, as lessons/canvas-titles.md. A leading / is taken off.");
const contentField = z.string().max(PLAYBOOK_FILE_MAX_BYTES * 2).describe(`The file's whole text, at most ${PLAYBOOK_FILE_MAX_BYTES} bytes. A Markdown file starts with frontmatter that names its type.`);
const etagField = expectedEtag.optional().describe("The etag of your last read of the file. Leave it out only to write a file that is not there yet.");

type WriteStep = { action: "write"; path: string; content: string; expected_etag?: string | undefined } | { action: "remove"; path: string; expected_etag?: string | undefined } | { action: "move"; path: string; to: string; expected_etag?: string | undefined };

/** Write one file: a new one at its first revision, or the next revision of the one there. */
async function writeFile(ctx: OpContext, step: Extract<WriteStep, { action: "write" }>, msg: string | undefined) {
  const path = playbookPath(step.path);
  const size = checkFileSize(path, step.content);
  const { meta, warnings } = describeFile(path, step.content);
  const there = await liveFile(ctx, path);
  if (there) {
    if (!step.expected_etag || !sameEtag(step.expected_etag, there.etag)) throw changedSince(there, step.expected_etag);
  } else {
    const twin = await caseTwin(ctx, path);
    if (twin) throw caseTaken(path, twin);
    if (step.expected_etag) throw nothingToMatch(path);
  }
  let file: { file_id: string; path: string; revision: number };
  if (there) {
    file = { file_id: there.file_id, path, revision: there.revision + 1 };
    if (there.content === step.content) return { file: there, changed: false, warnings };
    await ctx.db
      .updateTable("playbook_files")
      .set({ content: step.content, ...meta, size, revision: file.revision, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
      .where("file_id", "=", there.file_id)
      .execute();
  } else {
    // A path that held a file once goes on with that file's history.
    const before = await fileAtPath(ctx, path);
    if (before) {
      file = { file_id: before.file_id, path, revision: before.revision + 1 };
      await ctx.db
        .updateTable("playbook_files")
        .set({ content: step.content, ...meta, size, revision: file.revision, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor), removed_at: null })
        .where("file_id", "=", before.file_id)
        .execute();
    } else {
      file = { file_id: newId(), path, revision: 1 };
      await ctx.db
        .insertInto("playbook_files")
        .values({ file_id: file.file_id, tenant_id: tenantId(ctx), product_id: productId(ctx), path, content: step.content, ...meta, size, revision: 1, etag: newEtag(), created_at: ctx.now, created_by: json(ctx.actor), updated_at: ctx.now, updated_by: json(ctx.actor) })
        .execute();
    }
  }
  await keepRevision(ctx, file, "written", step.content, msg);
  await storeLinks(ctx, file.file_id, step.content);
  return { file: (await liveFile(ctx, path, false))!, changed: true, warnings, created: !there };
}

async function removeFile(ctx: OpContext, step: Extract<WriteStep, { action: "remove" }>, msg: string | undefined) {
  const path = playbookPath(step.path);
  const there = await liveFile(ctx, path);
  if (!there) {
    if (step.expected_etag) throw nothingToMatch(path);
    throw await nothingAt(ctx, path, true, true);
  }
  if (!step.expected_etag || !sameEtag(step.expected_etag, there.etag)) throw changedSince(there, step.expected_etag);
  const revision = there.revision + 1;
  await ctx.db.updateTable("playbook_files").set({ content: null, revision, etag: newEtag(), removed_at: ctx.now, updated_at: ctx.now, updated_by: json(ctx.actor) }).where("file_id", "=", there.file_id).execute();
  await keepRevision(ctx, { file_id: there.file_id, path, revision }, "removed", null, msg);
  await storeLinks(ctx, there.file_id, null);
  return { path, removed: true, revision };
}

async function moveFile(ctx: OpContext, step: Extract<WriteStep, { action: "move" }>, msg: string | undefined) {
  const path = playbookPath(step.path);
  const to = playbookPath(step.to, "to");
  if (to === path) throw invalid("invalid_move", `to is ${path}, where the file already is. Name where it goes. Nothing was changed.`);
  const there = await liveFile(ctx, path);
  if (!there) {
    if (step.expected_etag) throw nothingToMatch(path);
    throw await nothingAt(ctx, path, true, true);
  }
  if (!step.expected_etag || !sameEtag(step.expected_etag, there.etag)) throw changedSince(there, step.expected_etag);
  const twin = await caseTwin(ctx, to);
  if (twin && twin !== path) throw caseTaken(to, twin);
  const taken = await liveFile(ctx, to);
  if (taken) throw conflict("playbook_path_taken", `${to} holds a file already, so ${path} was not moved there. Choose another path, or remove that one first. Nothing was changed.`, { path: to, etag: taken.etag });
  const { meta } = describeFile(to, there.content ?? "");
  const revision = there.revision + 1;
  await ctx.db.updateTable("playbook_files").set({ path: to, ...meta, revision, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("file_id", "=", there.file_id).execute();
  await keepRevision(ctx, { file_id: there.file_id, path: to, revision }, "moved", there.content, msg ?? `Moved from ${path}.`);
  return { file: (await liveFile(ctx, to, false))!, moved_from: path };
}

/** The file a write landed on, as its answer gives it. */
const written = (ctx: OpContext, f: FileRow) => fileView(f, ctx.now, false);

const steps = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("write"),
    path: pathField,
    content: contentField.optional().describe(`The file's whole text, at most ${PLAYBOOK_FILE_MAX_BYTES} bytes. With upload_id, leave it out to take the file at this path in the upload.`),
    expected_etag: etagField,
  }),
  z.strictObject({ action: z.literal("remove"), path: pathField, expected_etag: expectedEtag.optional().describe("The etag of your last read of the file.") }),
  z.strictObject({ action: z.literal("move"), path: pathField, to: pathField.describe("Where it goes."), expected_etag: expectedEtag.optional().describe("The etag of your last read of the file.") }),
]);

/** Run one step of a change: write, remove or move. */
async function runStep(ctx: OpContext, step: WriteStep, msg: string | undefined) {
  if (step.action === "write") {
    const r = await writeFile(ctx, step, msg);
    return { action: "write", ...written(ctx, r.file), changed: r.changed, ...(r.created ? { created: true } : {}), ...(await writeWarnings(ctx, r.file.path, step.content, r.warnings)) };
  }
  if (step.action === "remove") return { action: "remove", ...(await removeFile(ctx, step, msg)) };
  const r = await moveFile(ctx, step, msg);
  return { action: "move", ...written(ctx, r.file), moved_from: r.moved_from };
}

async function record(ctx: OpContext, action: string, path: string, summary: string) {
  await recordActivity(ctx, { action, entity_type: "playbook", entity_id: path, entity_title: path, summary });
}

// ---- Reading ------------------------------------------------------------------------------------

/** OKF's index.md for a folder: its files and the folders in it, each with its description. */
function indexMarkdown(files: FileRow[], folder: string): string {
  const here = files.filter((f) => f.path.startsWith(folder));
  const direct = here.filter((f) => !f.path.slice(folder.length).includes("/"));
  const folders = [...new Set(here.map((f) => f.path.slice(folder.length)).filter((p) => p.includes("/")).map((p) => p.split("/")[0]!))].sort();
  const lines: string[] = [];
  if (direct.length) {
    lines.push("# Files", "");
    for (const f of direct) lines.push(`* [${f.title ?? f.path.slice(folder.length)}](/${f.path})${f.description ? ` - ${f.description}` : ""}`);
  }
  if (folders.length) {
    if (lines.length) lines.push("");
    lines.push("# Folders", "");
    for (const d of folders) lines.push(`* [${d}](/${folder}${d}/) - ${here.filter((f) => f.path.startsWith(`${folder}${d}/`)).length} files`);
  }
  return `${lines.join("\n")}\n`;
}

/** The file's revisions as OKF's log.md writes history: newest day first, a line a change. */
function logMarkdown(revs: { path: string; change: string; revision: number; created_at: string; created_by: ActorSnapshot; message: string | null }[]): string {
  const days = new Map<string, string[]>();
  for (const r of revs) {
    const day = r.created_at.slice(0, 10);
    const word = { written: r.revision === 1 ? "Creation" : "Update", removed: "Removal", moved: "Move", restored: "Restoration" }[r.change] ?? "Update";
    const line = `* **${word}**: [${r.path}](/${r.path}), revision ${r.revision}, by ${r.created_by.display_name || "someone"}${r.message ? `. ${r.message}` : ""}`;
    days.set(day, [...(days.get(day) ?? []), line]);
  }
  return `# Update log\n\n${[...days].map(([d, ls]) => `## ${d}\n${ls.join("\n")}`).join("\n\n")}\n`;
}

export const playbookIndex = defineOperation({
  name: "playbook.index",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List the product's Playbook: every file with its title, description, what it applies to and its etag. Start here.",
  description: `${WHAT_IT_IS} Read it before working on the product, and write to it as you work: guide(topic="playbook") says how, and so does its own using-this-playbook.md. It answers with okf_version (the version of the Open Knowledge Format the Playbook's files follow), files (each path, type, title, description, applies_to, tags, status, stale_after and stale when that has passed, size, sha256, revision, etag, and who wrote it last), index_md (Playbook's index.md for the folder: prefix, or the root), started (false while the product has written nothing and serves WhatBuild's starter, whose files then say from_starter) and messages_waiting. prefix limits it to a folder, as lessons/. Refused with 409 playbook_off when the product's admins turned its Playbook off.`,
  input: z.strictObject({ prefix: z.string().max(260).optional().describe("A folder, as kits/ or lessons/: only the files under it.") }),
  rest: { method: "GET", path: "/playbook" },
  mcp: { tool: "playbook", action: "index" },
  async handler(ctx, input) {
    const s = await requirePlaybook(ctx, false);
    const prefix = input.prefix ? `${input.prefix.trim().replace(/^\/+/, "").replace(/\/*$/, "")}/` : "";
    const files = await liveFiles(ctx, s.started, { prefix: prefix || undefined, withHash: true });
    return {
      okf_version: OKF_VERSION,
      started: s.started,
      files: files.map((f) => fileView(f, ctx.now, false)),
      index_md: indexMarkdown(files, prefix),
      messages_waiting: await playbookMessagesWaiting(ctx),
    };
  },
});

export const playbookRead = defineOperation({
  name: "playbook.read",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read one file of the Playbook: its text, etag and revision, and what each of its whatbuild: links names now.",
  description:
    `${SIZE_AND_SHA256} revision reads that revision of the file instead (from playbook_read(action="history")); its text, never an etag to write with. links gives each whatbuild: link in the text (${LINK_FORM}) with the title of what it names and its status: live, archived, or missing when nothing in the product has that id. A path that held a file removed since is refused with 404 saying when, and playbook_write(action="restore") brings it back; one whose file was moved away, with 404 naming where it is now (details.moved_to); one whose file was deleted permanently, with 410 playbook_file_deleted.`,
  input: z.strictObject({ path: pathField, revision: z.number().int().min(1).optional().describe("A revision to read, from the file's history.") }),
  rest: { method: "GET", path: "/playbook/file" },
  mcp: { tool: "playbook", action: "read" },
  async handler(ctx, input) {
    const s = await requirePlaybook(ctx, false);
    const path = input.path.trim().replace(/^\/+/, "");
    if (input.revision !== undefined) {
      if (!s.started) throw notFound(`The Playbook has written nothing yet, so ${path} has no revision ${input.revision}: it serves WhatBuild's starter, at revision 0. Read it without a revision.`, { path });
      const f = await fileForHistory(ctx, path);
      const rev = await ctx.db.selectFrom("playbook_revisions").selectAll().where("file_id", "=", f.file_id).where("revision", "=", input.revision).executeTakeFirst();
      if (!rev) throw notFound(`${path} has no revision ${input.revision} (it is at ${f.revision}, and the most recent ${PLAYBOOK_REVISIONS_KEPT} are kept). playbook_read(action="history", params={path}) lists the ones it has.`, { path });
      return { path: rev.path, revision: rev.revision, change: rev.change, content: rev.content, size: rev.content === null ? 0 : byteSize(rev.content), sha256: sha256Of(rev), message: rev.message, created_at: rev.created_at, created_by: who(rev.created_by), current_revision: f.revision };
    }
    const f = s.started ? await liveFile(ctx, path, false) : starterRows().find((r) => r.path === path);
    if (!f) throw await nothingAt(ctx, path, s.started);
    return { ...fileView(f, ctx.now, true), links: await resolveLinks(ctx, linksIn(f.content ?? "").links) };
  },
});

/** The most text one read_files answer carries. */
const READ_FILES_BYTES = 1024 * 1024;

export const playbookReadFiles = defineOperation({
  name: "playbook.read_files",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read every file under a folder, with its text and etag: to work on a kit, or several files, on your own machine.",
  description: `Answers with files (each with its text, size, sha256 and etag) in path order, up to 1 MiB of text an answer, and next_cursor while more remain. Write the files into a folder of their own, keep the etags, compare each file's sha256 with your copy's to check it arrived whole, and send changes back with playbook_write(action="apply"), each file with the etag read here. Without a prefix it reads the whole bundle.`,
  input: z.strictObject({
    prefix: z.string().max(260).optional().describe("A folder, as kits/canvas/: only the files under it."),
    cursor: z.string().max(300).optional().describe("next_cursor from the previous answer."),
  }),
  rest: { method: "GET", path: "/playbook/files" },
  mcp: { tool: "playbook", action: "read_files" },
  async handler(ctx, input) {
    const s = await requirePlaybook(ctx, false);
    // A folder, as index takes it: kits/canvas reads kits/canvas/, never kits/canvas-old/.
    const prefix = input.prefix ? `${input.prefix.trim().replace(/^\/+/, "").replace(/\/*$/, "")}/` : undefined;
    const all = (await liveFiles(ctx, s.started, { prefix, withContent: true })).filter((f) => !input.cursor || f.path > input.cursor);
    const out: FileRow[] = [];
    let bytes = 0;
    for (const f of all) {
      if (out.length && bytes + f.size > READ_FILES_BYTES) break;
      out.push(f);
      bytes += f.size;
    }
    const more = out.length < all.length;
    return { files: out.map((f) => fileView(f, ctx.now, true)), ...(more ? { next_cursor: out[out.length - 1]!.path } : {}) };
  },
});

/** The most characters of one line a snippet gives. */
const SNIPPET_LINE_MAX = 160;

/** A line cut to SNIPPET_LINE_MAX characters around a place in it, with … where it was cut. */
function cutLine(line: string, at = 0, length = 0): string {
  if (line.length <= SNIPPET_LINE_MAX) return line;
  const start = Math.max(0, Math.min(at - Math.floor((SNIPPET_LINE_MAX - length) / 2), line.length - SNIPPET_LINE_MAX));
  const end = start + SNIPPET_LINE_MAX;
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
}

/**
 * A few lines of a text around where each word first appears in it: the line holding the word,
 * with the nearest line before and after it that is not blank, line breaks kept and each line cut
 * to SNIPPET_LINE_MAX characters. A word is looked for in the body first, and in the frontmatter
 * only when the body lacks it; a passage never runs across the frontmatter's edge. At most three
 * passages: a word on a line one already gives is shown by it, and a passage that would repeat a
 * line of another is joined to it.
 */
function snippets(text: string, words: string[]): string[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lower = lines.map((l) => l.toLowerCase());
  // The frontmatter's lines, between its two lines of ---, which belong to neither part.
  const fmEnd = lines[0]?.trim() === "---" ? lines.findIndex((l, i) => i > 0 && (l.trim() === "---" || l.trim() === "...")) : -1;
  const parts: [number, number][] = fmEnd > 0 ? [[fmEnd + 1, lines.length], [1, fmEnd]] : [[0, lines.length]];
  // Each passage: its first and last line, and the word each matching line in it is cut around.
  const passages: { from: number; to: number; hits: Map<number, string> }[] = [];
  for (const w of words) {
    let hit: { line: number; part: [number, number] } | undefined;
    for (const part of parts) {
      for (let i = part[0]; i < part[1] && !hit; i++) if (lower[i]!.includes(w)) hit = { line: i, part };
      if (hit) break;
    }
    if (!hit) continue;
    const at = hit.line;
    if (passages.some((p) => at >= p.from && at <= p.to)) continue;
    const [from, to] = hit.part;
    let before = at - 1;
    while (before >= from && !lines[before]!.trim()) before--;
    let after = at + 1;
    while (after < to && !lines[after]!.trim()) after++;
    const start = before >= from ? before : at;
    const end = after < to ? after : at;
    // Passages lie within one part, so only ones in the same part can share a line with this one.
    const near = passages.find((p) => start <= p.to && end >= p.from);
    if (near) {
      near.from = Math.min(near.from, start);
      near.to = Math.max(near.to, end);
      near.hits.set(at, w);
      // Grown, it may now share a line with another: join that one too.
      for (let i = passages.length - 1; i >= 0; i--) {
        const p = passages[i]!;
        if (p !== near && p.from <= near.to && p.to >= near.from) {
          near.from = Math.min(near.from, p.from);
          near.to = Math.max(near.to, p.to);
          for (const [line, word] of p.hits) near.hits.set(line, word);
          passages.splice(i, 1);
        }
      }
      continue;
    }
    if (passages.length < 3) passages.push({ from: start, to: end, hits: new Map([[at, w]]) });
  }
  return passages.map((p) => {
    const shown: string[] = [];
    for (let i = p.from; i <= p.to; i++) {
      const w = p.hits.get(i);
      if (w !== undefined) shown.push(cutLine(lines[i]!, Math.max(0, lower[i]!.indexOf(w)), w.length));
      else if (lines[i]!.trim()) shown.push(cutLine(lines[i]!));
    }
    return shown.join("\n");
  });
}

export const playbookSearch = defineOperation({
  name: "playbook.search",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Find the files of the Playbook whose text holds every word you give.",
  description: "Matches each word anywhere in a file's text, whatever its capitals, and answers with the files that hold them all, in path order, each with its title, description and a few lines around the words. Search before writing a lesson, to add to one that says it already. It searches the Playbook alone; the search tool searches the product's material.",
  input: z.strictObject({ query: z.string().trim().min(1).max(200).describe("Words, all of which a file must hold."), limit: z.number().int().min(1).max(100).default(25) }),
  rest: { method: "GET", path: "/playbook/search" },
  mcp: { tool: "playbook", action: "search" },
  async handler(ctx, input) {
    const s = await requirePlaybook(ctx, false);
    const words = [...new Set(input.query.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 10);
    let hits: FileRow[];
    if (!s.started) hits = starterRows().filter((f) => words.every((w) => f.content!.toLowerCase().includes(w)));
    else {
      let q = ctx.db.selectFrom("playbook_files").select([...FILE_COLUMNS]).where("product_id", "=", productId(ctx)).where("removed_at", "is", null);
      for (const w of words) q = q.where("content", "ilike", likeContaining(w));
      hits = (await q.orderBy(sql`path collate "C"`).limit(input.limit + 1).execute()) as FileRow[];
    }
    return {
      query: input.query,
      files: hits.slice(0, input.limit).map((f) => ({ path: f.path, title: f.title, description: f.description, etag: f.etag, snippets: snippets(f.content ?? "", words) })),
      ...(hits.length > input.limit ? { more: true } : {}),
    };
  },
});

export const playbookHistory = defineOperation({
  name: "playbook.history",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List a file's revisions, or, without a path, the Playbook's recent changes as its log.",
  description: `With path: the file's revisions, newest first, each with its revision, change (written, removed, moved or restored), the path it had, size and sha256 (none for a removal), message and who made it; playbook_read(action="read") with a revision reads one, and playbook_write(action="restore") brings one back. The most recent ${PLAYBOOK_REVISIONS_KEPT} of each file are kept. A path whose file was moved away answers 404 naming where it is now (details.moved_to); one whose file was deleted permanently, 410 playbook_file_deleted. Without a path: the most recent changes across the bundle, and log_md, Playbook's log.md for them.`,
  input: z.strictObject({ path: pathField.optional(), limit: z.number().int().min(1).max(200).default(50) }),
  rest: { method: "GET", path: "/playbook/history" },
  mcp: { tool: "playbook", action: "history" },
  async handler(ctx, input) {
    const s = await requirePlaybook(ctx, false);
    if (!s.started) return { started: false, revisions: [], note: "The Playbook has written nothing yet: it serves WhatBuild's starter, and its history starts with its first write." };
    const cols = ["revision_id", "file_id", "revision", "change", "path", "message", "created_at", "created_by", sql<number>`coalesce(octet_length(content), 0)`.as("size"), CONTENT_SHA256.as("sha256")] as const;
    if (input.path) {
      const path = input.path.trim().replace(/^\/+/, "");
      const f = await fileForHistory(ctx, path);
      const revs = await ctx.db.selectFrom("playbook_revisions").select([...cols]).where("file_id", "=", f.file_id).orderBy("revision", "desc").limit(input.limit).execute();
      return {
        path: f.path,
        removed: f.removed_at !== null,
        current_revision: f.revision,
        etag: f.etag,
        revisions: revs.map((r) => ({ revision: r.revision, change: r.change, path: r.path, size: Number(r.size), sha256: r.sha256, message: r.message, created_at: r.created_at, created_by: who(r.created_by) })),
      };
    }
    const revs = await ctx.db.selectFrom("playbook_revisions").select([...cols]).where("product_id", "=", productId(ctx)).orderBy("created_at", "desc").orderBy("revision_id", "desc").limit(input.limit).execute();
    return {
      revisions: revs.map((r) => ({ revision: r.revision, change: r.change, path: r.path, size: Number(r.size), sha256: r.sha256, message: r.message, created_at: r.created_at, created_by: who(r.created_by) })),
      log_md: logMarkdown(revs),
    };
  },
});

export const playbookBacklinks = defineOperation({
  name: "playbook.backlinks",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List the files of the Playbook that link to something in the product: a source, a mockup, an outcome, a Story page.",
  description: `uri is a whatbuild: link (${LINK_FORM}); its version and page are ignored. Before archiving or reworking something, read what the Playbook says about it.`,
  input: z.strictObject({ uri: z.string().trim().min(1).max(300).describe("A whatbuild: link, as whatbuild:mockups/<mockup_id>.") }),
  rest: { method: "GET", path: "/playbook/backlinks" },
  mcp: { tool: "playbook", action: "backlinks" },
  async handler(ctx, input) {
    const s = await requirePlaybook(ctx, false);
    const link = linksIn(input.uri).links[0];
    if (!link || !link.id) throw invalid("invalid_input", `uri ${JSON.stringify(input.uri)} is not a whatbuild: link to an object. It takes ${LINK_FORM.replace(" and whatbuild:product for the product concept", "")}.`, { uri: input.uri });
    const files = s.started
      ? await ctx.db
          .selectFrom("playbook_links as l")
          .innerJoin("playbook_files as f", "f.file_id", "l.file_id")
          .select(["f.path", "f.title", "f.description", "f.etag"])
          .where("l.product_id", "=", productId(ctx))
          .where("l.target_kind", "=", link.kind)
          .where("l.target_id", "=", link.id)
          .where("f.removed_at", "is", null)
          .orderBy("f.path")
          .execute()
      : [];
    const [target] = await resolveLinks(ctx, [link]);
    return { uri: `whatbuild:${link.kind}/${link.id}`, title: target!.title, status: target!.status, files };
  },
});

const QUIET_MS = PLAYBOOK_QUIET_DAYS * 86400_000;
const HOUSEKEEPING_EACH = 25;

export const playbookHousekeeping = defineOperation({
  name: "playbook.housekeeping",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "What agents might tidy: stale files, old drafts, links to what is archived or gone, and material nothing links to that has not changed in a while.",
  description: `Candidates, not verdicts: WhatBuild knows what was changed and what the Playbook links to, not what people read. stale: files past their stale_after. drafts: files whose status is draft, unchanged for ${PLAYBOOK_QUIET_DAYS} days. broken_links: files whose whatbuild: links name something archived or missing. not_linked: the product's sources, mockups, outcomes and Story pages that are not archived, have not changed in ${PLAYBOOK_QUIET_DAYS} days and that no file links to, the oldest first, up to ${HOUSEKEEPING_EACH} of each with how many there are. The Playbook's own housekeeping.md says what agents do with them: in the Playbook they act; in the product they archive and tell people, and people delete.`,
  input: z.strictObject({}),
  rest: { method: "GET", path: "/playbook/housekeeping" },
  mcp: { tool: "playbook", action: "housekeeping" },
  async handler(ctx) {
    const s = await requirePlaybook(ctx, false);
    const quiet = new Date(Date.parse(ctx.now) - QUIET_MS).toISOString();
    const files = await liveFiles(ctx, s.started, { withContent: true });
    const stale = files.filter((f) => f.stale_after && f.stale_after <= ctx.now).map((f) => ({ path: f.path, title: f.title, stale_after: f.stale_after, etag: f.etag }));
    const drafts = files.filter((f) => f.status === "draft" && (!s.started || f.updated_at <= quiet)).map((f) => ({ path: f.path, title: f.title, updated_at: f.updated_at || null, etag: f.etag }));
    const broken: { path: string; links: { uri: string; status: string; title: string | null }[] }[] = [];
    for (const f of files) {
      const bad = (await resolveLinks(ctx, linksIn(f.content ?? "").links)).filter((l) => l.status !== "live");
      if (bad.length) broken.push({ path: f.path, links: bad.map((l) => ({ uri: l.uri, status: l.status, title: l.title })) });
    }
    const pid = productId(ctx);
    const unlinked = async (kind: (typeof LINK_KINDS)[number], table: "records" | "mockups" | "outcomes" | "story_pages", idCol: "record_id" | "mockup_id" | "outcome_id" | "page_id") => {
      const base = sql`from ${sql.table(table)} t where t.product_id = ${pid} and t.archived_at is null and t.updated_at <= ${quiet}
        and not exists (select 1 from playbook_links l join playbook_files f on f.file_id = l.file_id and f.removed_at is null where l.product_id = t.product_id and l.target_kind = ${kind} and l.target_id = t.${sql.ref(idCol)})`;
      const rows = await sql<{ id: string; title: string; updated_at: string }>`select t.${sql.ref(idCol)} as id, t.title, t.updated_at ${base} order by t.updated_at limit ${HOUSEKEEPING_EACH}`.execute(ctx.db);
      const n = await sql<{ n: number }>`select count(*)::int as n ${base}`.execute(ctx.db);
      return { count: n.rows[0]?.n ?? 0, items: rows.rows.map((r) => ({ uri: `whatbuild:${kind}/${r.id}`, title: r.title, updated_at: r.updated_at })) };
    };
    return {
      stale,
      drafts,
      broken_links: broken,
      not_linked: {
        sources: await unlinked("sources", "records", "record_id"),
        mockups: await unlinked("mockups", "mockups", "mockup_id"),
        outcomes: await unlinked("outcomes", "outcomes", "outcome_id"),
        story: await unlinked("story", "story_pages", "page_id"),
      },
      note: "In the Playbook, act: merge, rewrite, remove (every removal can be restored). In the product, archive what is clearly done with and tell your person what and why, or propose it; never delete. how-to/housekeeping.md in the Playbook is what the team follows.",
    };
  },
});

export const playbookStarter = defineOperation({
  name: "playbook.starter",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read WhatBuild's starter, as this version ships it, beside the product's own copy, to compare.",
  description:
    "A product's Playbook begins as a copy of the starter, and its first write makes the copy the team's. WhatBuild's starter changes with its releases; the team's copy changes only when the team changes it. Each file says whether the product has it, and whether its text is the starter's (same). Without path it gives every file's text; take from it what the team wants, with playbook_write.",
  input: z.strictObject({ path: pathField.optional() }),
  rest: { method: "GET", path: "/playbook/starter" },
  mcp: { tool: "playbook", action: "starter" },
  async handler(ctx, input) {
    const s = await requirePlaybook(ctx, false);
    const path = input.path?.trim().replace(/^\/+/, "");
    const files = starterFiles().filter((f) => !path || f.path === path);
    if (path && !files.length) throw notFound(`WhatBuild's starter has no file ${path}. Without a path, this lists the files it has.`, { path });
    const ours = s.started ? new Map((await liveFiles(ctx, true, { withContent: true })).map((f) => [f.path, f])) : null;
    return {
      started: s.started,
      files: files.map((f) => {
        const mine = ours ? ours.get(f.path) : f;
        return { path: f.path, content: f.content, in_product: mine ? { etag: mine.etag, same: mine.content === f.content } : null };
      }),
    };
  },
});

// ---- Writing ------------------------------------------------------------------------------------

export const playbookWrite = defineOperation({
  name: "playbook.write",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Write a file of the Playbook: a new one, or the next revision of one, with the etag of your read.",
  description: `${PATH_RULES} A Markdown file starts with YAML frontmatter that names its type; title, description and applies_to (${PLAYBOOK_AREAS.join(", ")}) decide how agents find it. A file that is there takes expected_etag from your last read: one written since is refused with 409 stale_etag, whose details give current_content and current_etag to merge with. A new file takes none. The first write to a product's Playbook copies WhatBuild's starter in first, keeping its etags. The answer gives the file's etag, revision, size and sha256, its links with what each names now, and warnings (frontmatter it lacks, links that name nothing or something archived). Writing the text a file already holds changes nothing. message says why, kept with the revision.`,
  input: z.strictObject({ path: pathField, content: contentField, expected_etag: etagField, message }),
  rest: { method: "PUT", path: "/playbook/file" },
  mcp: { tool: "playbook", action: "write" },
  async handler(ctx, input) {
    await startIfNeeded(ctx);
    const r = await writeFile(ctx, { action: "write", path: input.path, content: input.content, expected_etag: input.expected_etag }, input.message);
    await checkTotals(ctx);
    const path = r.file.path;
    if (r.changed) await record(ctx, r.created ? "playbook_file_created" : "playbook_file_written", path, r.created ? `Wrote ${path} in the Playbook` : `Changed ${path} in the Playbook`);
    return { ...written(ctx, r.file), changed: r.changed, ...(r.created ? { created: true } : {}), ...(await writeWarnings(ctx, path, input.content, r.warnings)) };
  },
});

export const playbookRemove = defineOperation({
  name: "playbook.remove",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Remove a file from the Playbook. Its history stays, and restore brings it back.",
  description: "Takes the etag of your last read (409 stale_etag with the current text when it changed since). The file leaves the index, its links stop counting, and its path is free; playbook_write(action=\"restore\") brings back any revision. playbook_delete(action=\"purge\") deletes a file and its history for good.",
  input: z.strictObject({ path: pathField, expected_etag: expectedEtag, message }),
  rest: { method: "POST", path: "/playbook/file/remove" },
  mcp: { tool: "playbook", action: "remove" },
  async handler(ctx, input) {
    await startIfNeeded(ctx);
    const r = await removeFile(ctx, { action: "remove", path: input.path, expected_etag: input.expected_etag }, input.message);
    await record(ctx, "playbook_file_removed", r.path, `Removed ${r.path} from the Playbook`);
    return r;
  },
});

export const playbookMove = defineOperation({
  name: "playbook.move",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Move or rename a file of the Playbook. It keeps its history.",
  description: "Takes the etag of your last read. A path that holds a file already is refused with 409 playbook_path_taken. Links to the old path from other files are not changed: change them too, in the same playbook_write(action=\"apply\") if you like.",
  input: z.strictObject({ path: pathField, to: pathField.describe("Where it goes."), expected_etag: expectedEtag, message }),
  rest: { method: "POST", path: "/playbook/file/move" },
  mcp: { tool: "playbook", action: "move" },
  async handler(ctx, input) {
    await startIfNeeded(ctx);
    const r = await runStep(ctx, { action: "move", path: input.path, to: input.to, expected_etag: input.expected_etag }, input.message);
    await record(ctx, "playbook_file_moved", r.path, `Moved ${input.path.replace(/^\/+/, "")} to ${r.path} in the Playbook`);
    return r;
  },
});

export const playbookRestore = defineOperation({
  name: "playbook.restore",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Bring back an earlier revision of a file, or a removed file, as its next revision.",
  description:
    "revision is from playbook_read(action=\"history\", params={path}). The file takes that revision's text at its next revision; nothing in its history is lost. A file that is there takes the etag of your last read; a removed one takes none, and comes back at its path unless another file holds it (409 playbook_path_taken). A revision that removed the file has no text to bring back: name one before it. A path whose file was moved away answers 404 naming where it is now (details.moved_to); one whose file was deleted permanently, 410 playbook_file_deleted.",
  input: z.strictObject({ path: pathField, revision: z.number().int().min(1), expected_etag: etagField, message }),
  rest: { method: "POST", path: "/playbook/file/restore" },
  mcp: { tool: "playbook", action: "restore" },
  async handler(ctx, input) {
    await startIfNeeded(ctx);
    const path = playbookPath(input.path);
    const f = await fileForHistory(ctx, path, true);
    const rev = await ctx.db.selectFrom("playbook_revisions").select(["revision", "content", "path"]).where("file_id", "=", f.file_id).where("revision", "=", input.revision).executeTakeFirst();
    if (!rev) throw notFound(`${path} has no revision ${input.revision}. playbook_read(action="history", params={path}) lists the ones it has.`, { path });
    if (rev.content === null) throw invalid("playbook_nothing_to_restore", `Revision ${input.revision} of ${path} removed it, so it has no text to bring back. Restore a revision before it. Nothing was changed.`, { path, revision: input.revision });
    if (f.removed_at) {
      if (input.expected_etag) throw nothingToMatch(path);
      const taken = await liveFile(ctx, f.path);
      if (taken) throw conflict("playbook_path_taken", `${f.path} holds another file now, so the removed one was not restored there. Move that one first. Nothing was changed.`, { path: f.path, etag: taken.etag });
      const twin = await caseTwin(ctx, f.path);
      if (twin) throw caseTaken(f.path, twin);
    } else if (!input.expected_etag || !sameEtag(input.expected_etag, f.etag)) throw changedSince(f, input.expected_etag);
    const { meta } = describeFile(f.path, rev.content);
    const revision = f.revision + 1;
    await ctx.db
      .updateTable("playbook_files")
      .set({ content: rev.content, ...meta, size: byteSize(rev.content), revision, etag: newEtag(), removed_at: null, updated_at: ctx.now, updated_by: json(ctx.actor) })
      .where("file_id", "=", f.file_id)
      .execute();
    await keepRevision(ctx, { file_id: f.file_id, path: f.path, revision }, "restored", rev.content, input.message ?? `Restored revision ${input.revision}.`);
    await storeLinks(ctx, f.file_id, rev.content);
    await checkTotals(ctx);
    await record(ctx, "playbook_file_restored", f.path, `Restored revision ${input.revision} of ${f.path} in the Playbook`);
    const now = (await liveFile(ctx, f.path, false))!;
    return { ...written(ctx, now), restored_revision: input.revision };
  },
});

// ---- Files to and from the agent's machine ------------------------------------------------------

/** What a grant to PUT a Playbook's files is for, and a grant to GET a folder of them. */
export const PLAYBOOK_UPLOAD_PURPOSE = "playbook_upload";
export const PLAYBOOK_DOWNLOAD_PURPOSE = "playbook";
/** The most a ZIP of a Playbook's files is, packed and unpacked, and the entries it may hold. */
const PLAYBOOK_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const PLAYBOOK_UPLOAD_UNPACKED_MAX = PLAYBOOK_TOTAL_MAX_BYTES;
const PLAYBOOK_UPLOAD_MAX_ENTRIES = PLAYBOOK_FILES_MAX + 500;
/** The download's own file, beside the Playbook's: a name no Playbook path can take, as each part of one starts with a letter or digit. */
export const PLAYBOOK_DOWNLOAD_MANIFEST = "_manifest.json";

/**
 * The files a ZIP gives the write steps that name them, by Playbook path. The whole archive is read
 * one way: from its top, or, when every entry sits inside one folder, from inside that folder, as
 * zipping a folder makes; whichever finds more of the paths, the top when they find as many. Only
 * the files wanted are unpacked, as UTF-8 text kept byte for byte (a leading byte-order mark
 * included), so each one's sha256 is that of the file that was zipped. Every problem is listed at
 * once (422).
 */
export function readPlaybookZip(bytes: Uint8Array, paths: string[]): Map<string, string> {
  const wanted = new Set(paths);
  const unreadable = (e: unknown): never => {
    if (e instanceof TooManyEntriesError) throw invalid("invalid_upload", `Nothing was changed: ${e.message}. A ZIP of a Playbook's files holds at most ${PLAYBOOK_UPLOAD_MAX_ENTRIES} entries.`);
    if (e instanceof TooLargeError) throw invalid("invalid_upload", `Nothing was changed: the files the steps name unpack to more than ${PLAYBOOK_UPLOAD_UNPACKED_MAX} bytes, more than a Playbook holds. Request a new upload with fewer files.`);
    throw invalid("invalid_upload", `Nothing was changed: the upload is not a ZIP WhatBuild can read (${(e as Error).message}). Zip the files again and request a new upload.`);
  };
  // First the names alone, which inflates nothing, to settle how the archive is read.
  const names: string[] = [];
  try {
    zipEntries(bytes, (name) => (zipLitter(name) ? false : (names.push(name), false)), PLAYBOOK_UPLOAD_UNPACKED_MAX, PLAYBOOK_UPLOAD_MAX_ENTRIES);
  } catch (e) {
    unreadable(e);
  }
  const top = names.length && names.every((n) => n.includes("/")) ? names[0]!.slice(0, names[0]!.indexOf("/") + 1) : null;
  const folder = top && names.every((n) => n.startsWith(top)) && names.filter((n) => wanted.has(n.slice(top.length))).length > names.filter((n) => wanted.has(n)).length ? top : "";
  let list: ReturnType<typeof zipEntries> = [];
  try {
    list = zipEntries(bytes, (name) => !zipLitter(name) && name.startsWith(folder) && wanted.has(name.slice(folder.length)), PLAYBOOK_UPLOAD_UNPACKED_MAX, PLAYBOOK_UPLOAD_MAX_ENTRIES);
  } catch (e) {
    unreadable(e);
  }
  const problems: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const found = new Map<string, Uint8Array[]>();
  for (const e of list) {
    if (e.symlink) problems.push(`${e.name} is a symbolic link; zip the file it points to instead.`);
    else found.set(e.name.slice(folder.length), [...(found.get(e.name.slice(folder.length)) ?? []), e.data]);
  }
  const files = new Map<string, string>();
  for (const path of wanted) {
    const data = found.get(path);
    if (!data) continue;
    if (data.length > 1) {
      problems.push(`${path} is in the ZIP more than once.`);
      continue;
    }
    let text: string;
    try {
      text = decoder.decode(data[0]!);
    } catch {
      problems.push(`${path} is not UTF-8 text: the Playbook holds text files only.`);
      continue;
    }
    // Postgres keeps no null character in text; a UTF-16 file without its byte-order mark is full of them.
    if (text.includes("\u0000")) problems.push(`${path} holds a null character, which no text the Playbook keeps may hold; is it UTF-16? Save it as UTF-8.`);
    else files.set(path, text);
  }
  if (problems.length) throw invalid("invalid_upload", `Nothing was changed: ${problems.join(" ")}`, { problems });
  return files;
}

/** An upload apply may read: in this product, a Playbook's, its bytes arrived, and not read before. */
async function usablePlaybookUpload(ctx: OpContext, uploadId: string, lock = false) {
  let q = ctx.db.selectFrom("mockup_uploads").selectAll().where("product_id", "=", productId(ctx)).where("upload_id", "=", uploadId).where("kind", "=", "playbook");
  if (lock) q = q.forUpdate();
  const u = await q.executeTakeFirst();
  if (!u) throw notFound(`There is no Playbook upload ${uploadId} in this product. Request one with playbook_write(action="request_upload").`, { upload_id: uploadId });
  if (u.used_at) throw conflict("upload_used", `Upload ${uploadId} was already applied. Request a new upload for another change. Nothing was changed.`);
  if (!u.uploaded_at) throw notFound(`No bytes have arrived for upload ${uploadId} yet. PUT the ZIP to the grant's url first. Nothing was changed.`, { upload_id: uploadId });
  return u;
}

/** Read an upload's ZIP before the transaction, so a large one holds no database connection: the files its write steps take. */
async function prepareApplyUpload(ctx: PrepareContext, input: { upload_id?: string | undefined; changes: { action: string; path: string; content?: string | undefined }[] }) {
  if (!input.upload_id) return undefined;
  const paths = input.changes.filter((c) => c.action === "write" && c.content === undefined).map((c) => playbookPath(c.path));
  // A Playbook that is off is refused before its upload is looked at, so the upload stays for when it is back on.
  const u = await ctx.read(async (c) => {
    await requirePlaybook(c, true);
    return usablePlaybookUpload(c, input.upload_id!);
  });
  return { upload_id: u.upload_id, files: readPlaybookZip(await ctx.ports.blobs.get(u.blob_key), paths) };
}

export const playbookRequestUpload = defineOperation({
  name: "playbook.request_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Get a short-lived grant to PUT a Playbook's files as a ZIP, for apply to read by upload_id: a kit from disk, without its text passing through a tool call.",
  description: `PUT one ZIP to url with exactly the headers given (curl -T kit.zip -H …), then call playbook_write(action="apply") with upload_id and the steps: a write step without content takes the file at its path in the ZIP. Zip the files at their Playbook paths (kits/canvas/README.md), as get_download gives them, so a downloaded folder goes back as it is. When everything in the ZIP sits inside one folder, as zipping a folder makes, the paths are read from inside it if that finds more of the steps' files than reading from the top does. Entries no step writes are not read, so the download's ${PLAYBOOK_DOWNLOAD_MANIFEST} may stay in. Files are UTF-8 text, kept byte for byte (a leading byte-order mark too), without a null character, each at most ${PLAYBOOK_FILE_MAX_BYTES} bytes; the ZIP is at most ${PLAYBOOK_UPLOAD_MAX_BYTES / 1024 / 1024} MB. An upload's bytes cannot be replaced, a successful apply reads an upload once and answers with its size and sha256, and an upload nobody applies is discarded a day after its grant expires. Keep the grant header out of reports and logs. Refused with 409 playbook_off when the product's admins turned its Playbook off.`,
  input: z.strictObject({ size: z.number().int().min(0).optional().describe("The ZIP's size in bytes, when known, so an oversized one is refused before it transfers.") }),
  rest: { method: "POST", path: "/playbook/uploads" },
  mcp: { tool: "playbook", action: "request_upload" },
  async handler(ctx, input) {
    await requirePlaybook(ctx, true);
    // On a plan with limits text is capped field by field (checkInput); a ZIP would carry it past that.
    if (ctx.limits && !ctx.limits.guest)
      throw new AppError(403, "plan_restricted", "On this organization's plan, send a Playbook's files in the call itself: uploading them isn't part of it. Whoever runs this WhatBuild can change the plan.");
    const max = Math.min(PLAYBOOK_UPLOAD_MAX_BYTES, ctx.ports.config.relayMaxBytes);
    if (input.size !== undefined && input.size > max) throw tooLarge(`A ZIP of a Playbook's files is at most ${max} bytes; this one is ${input.size}.`, { limit: max });
    const upload_id = newId();
    const expiresAt = new Date(Date.parse(ctx.now) + ctx.ports.config.grantTtlSeconds * 1000);
    await ctx.db
      .insertInto("mockup_uploads")
      .values({
        upload_id, tenant_id: tenantId(ctx), product_id: productId(ctx), kind: "playbook", blob_key: `t/${tenantId(ctx)}/p/${productId(ctx)}/playbook-uploads/${upload_id}`,
        max_bytes: max, principal: json(ctx.actor), expires_at: expiresAt.toISOString(),
      })
      .execute();
    const token = ctx.ports.grants.sign({ v: 1, purpose: PLAYBOOK_UPLOAD_PURPOSE, u: upload_id, t: tenantId(ctx), exp: Math.floor(expiresAt.getTime() / 1000) });
    return {
      upload_id,
      method: "PUT" as const,
      url: `${ctx.ports.config.publicBaseUrl}/api/v1/uploads/playbook/${upload_id}`,
      headers: { [UPLOAD_GRANT_HEADER]: token, "Content-Type": "application/zip" },
      max_bytes: max,
      expires_at: expiresAt.toISOString(),
      next: 'PUT the ZIP\'s raw bytes to url with exactly these headers (one request, no multipart), then call playbook_write(action="apply") with upload_id and the steps, leaving content out of each write step whose file is in the ZIP. Keep the grant header out of reports and logs.',
    };
  },
});

export const playbookGetDownload = defineOperation({
  name: "playbook.get_download",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Get a short-lived grant to download a folder of the Playbook, or all of it, as a ZIP: every file at its path, and a manifest with each one's etag.",
  description: `GET url with the headers and unzip: each file under prefix at its Playbook path (kits/canvas/README.md), and ${PLAYBOOK_DOWNLOAD_MANIFEST}, which gives prefix and each file's path, etag, revision, size and sha256, as they were when the ZIP was made. Keep the etags: send changes back with playbook_write(action="apply"), each file with the etag the manifest gave, and its text in the call or in a ZIP uploaded with request_upload, which this folder makes as it is. The ZIP holds the files as they are when it is fetched, not when the grant was given. Without a prefix it holds the whole bundle. Keep the grant header out of reports and logs. Refused with 409 playbook_off when the product's admins turned its Playbook off.`,
  input: z.strictObject({ prefix: z.string().max(260).optional().describe("A folder, as kits/canvas/: only the files under it.") }),
  rest: { method: "POST", path: "/playbook/downloads" },
  mcp: { tool: "playbook", action: "get_download" },
  async handler(ctx, input) {
    await requirePlaybook(ctx, false);
    const prefix = folderOf(input.prefix);
    if (prefix && !FOLDER.test(prefix))
      throw invalid("invalid_playbook_path", `prefix ${JSON.stringify(input.prefix)} is not a folder the Playbook can hold, so no file is under it. ${PATH_RULES} Nothing was sent.`, { prefix: input.prefix });
    const expiresAt = new Date(Date.parse(ctx.now) + ctx.ports.config.grantTtlSeconds * 1000);
    const token = ctx.ports.grants.sign({ v: 1, purpose: PLAYBOOK_DOWNLOAD_PURPOSE, t: tenantId(ctx), p: productId(ctx), px: prefix, ...requesterClaims(ctx.principal), exp: Math.floor(expiresAt.getTime() / 1000) });
    return {
      prefix: prefix || null,
      method: "GET" as const,
      url: `${ctx.ports.config.publicBaseUrl}/api/v1/downloads/playbook/${productId(ctx)}`,
      headers: { [DOWNLOAD_GRANT_HEADER]: token },
      expires_at: expiresAt.toISOString(),
      media_type: "application/zip",
    };
  },
});

/** A folder a Playbook path can sit in: parts of letters, digits, dots, hyphens and underscores, each starting with a letter or digit. */
const FOLDER = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,79}\/){1,7}$/;

/** A folder as index and read_files take it: kits/canvas is kits/canvas/, and nothing is the whole bundle. */
function folderOf(prefix: string | undefined): string {
  return prefix ? `${prefix.trim().replace(/^\/+/, "").replace(/\/*$/, "")}/`.replace(/^\/$/, "") : "";
}

/**
 * A folder of a product's Playbook as a ZIP, for the download route: each file at its path, and the
 * manifest with each one's etag and sha256 from the same read. The starter's files while the product
 * has written none. Null when the Playbook is off.
 */
export async function playbookBundle(db: Tx, productId: string, prefix: string): Promise<{ bytes: Uint8Array; name: string; files: number } | null> {
  const p = await db.selectFrom("products").select(["slug", "playbook_enabled", "playbook_started_at"]).where("product_id", "=", productId).executeTakeFirst();
  if (!p || !p.playbook_enabled) return null;
  const started = p.playbook_started_at !== null;
  const rows = started
    ? ((await db
        .selectFrom("playbook_files")
        .select(["path", "content", "revision", "etag"])
        .where("product_id", "=", productId)
        .where("removed_at", "is", null)
        .$if(prefix !== "", (q) => q.where("path", "like", `${prefix.replace(/[\\%_]/g, "\\$&")}%`))
        .orderBy(sql`path collate "C"`)
        .execute()) as { path: string; content: string; revision: number; etag: string }[])
    : starterRows().filter((f) => f.path.startsWith(prefix)).map((f) => ({ path: f.path, content: f.content!, revision: 0, etag: f.etag }));
  const entries: Record<string, Uint8Array> = {};
  const listed = rows.map((f) => {
    const data = strToU8(f.content);
    entries[f.path] = data;
    return { path: f.path, etag: f.etag, revision: f.revision, size: data.length, sha256: sha256Hex(f.content) };
  });
  const manifest = { format: "whatbuild-playbook", format_version: 1, okf_version: OKF_VERSION, prefix: prefix || null, started, files: listed };
  entries[PLAYBOOK_DOWNLOAD_MANIFEST] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  // A header carries the name, so it keeps to characters any header takes.
  const folder = prefix ? `-${prefix.replace(/\/$/, "").replace(/[^A-Za-z0-9._-]+/g, "-")}` : "";
  return { bytes: zipSync(entries), name: `${p.slug}-playbook${folder}.zip`.replace(/[^A-Za-z0-9._-]/g, "-"), files: listed.length };
}

/** The most steps one apply takes. */
const APPLY_MAX = 200;

export const playbookApply = defineOperation({
  name: "playbook.apply",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Write, remove and move several files of the Playbook at once: all of it, or none.",
  description: `changes is up to ${APPLY_MAX} steps, run in order, each {action: write | remove | move, path, ...} with the fields that action takes in playbook_write, and expected_etag for every file that is there. A path, or a move's to, appears in one step only (422 playbook_same_path_twice). Every etag is checked before anything is written: when any is stale the whole change is refused with 409 playbook_stale, whose details.files give each stale file's path, current_etag and current_content, so you merge them all at once and send again. Any other refusal also leaves every file as it was. This is how files worked on outside WhatBuild come back: read them with read_files, or download a folder (get_download), change them, and apply. To keep the files' text out of the call, PUT them as a ZIP (request_upload) and pass upload_id: a write step without content takes the file at its path in the ZIP, read from inside one folder when everything sits in it and that finds more of the steps' files. Entries no step writes are not read. A step's file missing from the ZIP refuses the whole change, naming each one. The answer gives each file written or moved with its etag, size and sha256, to check against your copy, and upload {upload_id, size, sha256} when there was one.`,
  input: z.strictObject({ changes: z.array(steps).min(1).max(APPLY_MAX), message, upload_id: id("upload").optional().describe('Files PUT as a ZIP (playbook_write(action="request_upload")): each write step without content takes its text from here.') }),
  rest: { method: "POST", path: "/playbook/apply" },
  mcp: { tool: "playbook", action: "apply" },
  prepare: prepareApplyUpload,
  async handler(ctx, input, upload) {
    // First, so a Playbook that is off answers playbook_off whatever the steps and the upload hold.
    await startIfNeeded(ctx);
    const missing = input.changes.filter((c) => c.action === "write" && c.content === undefined);
    if (missing.length && !upload)
      throw invalid("invalid_input", `${missing.map((c) => c.path).join(", ")} ${missing.length === 1 ? "has" : "have"} no content: give each write step its content, or pass upload_id with the files in a ZIP. Nothing was changed.`, { paths: missing.map((c) => c.path) });
    let used: { upload_id: string; size: number | null; sha256: string | null } | null = null;
    if (upload) {
      const u = await usablePlaybookUpload(ctx, upload.upload_id, true);
      used = { upload_id: u.upload_id, size: u.size === null ? null : Number(u.size), sha256: u.sha256 };
      const absent = missing.map((c) => playbookPath(c.path)).filter((path) => !upload.files.has(path));
      if (absent.length)
        throw invalid(
          "playbook_upload_missing",
          `The upload has no ${absent.join(", ")}: a write step without content takes the file at its path in the ZIP, at its top or inside one folder that holds everything. Zip the files at their Playbook paths, or give those steps their content. Nothing was changed.`,
          { paths: absent },
        );
      for (const c of input.changes) if (c.action === "write" && c.content === undefined) c.content = upload.files.get(playbookPath(c.path))!;
    }
    const seen = new Set<string>();
    for (const c of input.changes) {
      for (const p of [c.path, ...(c.action === "move" ? [c.to] : [])]) {
        const norm = playbookPath(p, p === c.path ? "path" : "to");
        if (seen.has(norm)) throw invalid("playbook_same_path_twice", `${norm} appears in more than one step. Give each path one step: write a file's final text once. Nothing was changed.`, { path: norm });
        seen.add(norm);
      }
    }
    const stale: Record<string, unknown>[] = [];
    for (const c of input.changes) {
      const there = await liveFile(ctx, playbookPath(c.path));
      if (there && (!c.expected_etag || !sameEtag(c.expected_etag, there.etag))) stale.push({ path: there.path, current_etag: there.etag, current_revision: there.revision, current_content: there.content, updated_by: who(there.updated_by), updated_at: there.updated_at });
    }
    if (stale.length)
      throw conflict(
        "playbook_stale",
        `${stale.length === 1 ? "A file" : `${stale.length} files`} changed since you read ${stale.length === 1 ? "it" : "them"}, or ${stale.length === 1 ? "is" : "are"} there and named no etag: ${stale.map((f) => f["path"]).join(", ")}. details.files give each one's current text and etag: merge, and send the whole change again. Nothing was changed.`,
        { files: stale },
      );
    const results = [];
    for (const c of input.changes) results.push(await runStep(ctx, c as WriteStep, input.message));
    await checkTotals(ctx);
    // Each file changed is its own entry in the activity log, named by its path, as a single change would be.
    const changed = results.filter((r) => r.action !== "write" || (r as { changed?: boolean }).changed);
    const together = changed.length > 1 ? `, one of ${changed.length} changes made at once` : "";
    for (const r of changed) {
      const path = (r as { path: string }).path;
      if (r.action === "write") {
        const created = (r as { created?: boolean }).created;
        await record(ctx, created ? "playbook_file_created" : "playbook_file_written", path, `${created ? "Wrote" : "Changed"} ${path} in the Playbook${together}`);
      } else if (r.action === "remove") await record(ctx, "playbook_file_removed", path, `Removed ${path} from the Playbook${together}`);
      else await record(ctx, "playbook_file_moved", path, `Moved ${(r as { moved_from: string }).moved_from} to ${path} in the Playbook${together}`);
    }
    if (used) {
      const u = await ctx.db.updateTable("mockup_uploads").set({ used_at: ctx.now }).where("upload_id", "=", used.upload_id).returning("blob_key").executeTakeFirstOrThrow();
      // The ZIP has done its work: its files are in the Playbook now.
      await ctx.enqueue("delete_blobs", { keys: [u.blob_key], prefixes: [] });
    }
    return { applied: results.length, results, ...(used ? { upload: used } : {}) };
  },
});

// ---- Messages -----------------------------------------------------------------------------------

export const playbookMessages = defineOperation({
  name: "playbook.messages",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read the messages other people's agents sent yours about this product, or the ones yours sent.",
  description: `box inbox (the default) gives the messages to your person, unread first, then newest first; sent gives theirs to others, with whether each was read. A message lasts ${PLAYBOOK_MESSAGE_DAYS} days, read or not. Reading marks nothing: playbook_write(action="mark_read") does, and every answer you get says how many wait unread as scope.playbook_messages_waiting. A message is a teammate's agent's note: weigh it as you would a colleague's, and ask your person before it changes something large.`,
  input: z.strictObject({ box: z.enum(["inbox", "sent"]).default("inbox"), unread_only: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50) }),
  rest: { method: "GET", path: "/playbook/messages" },
  mcp: { tool: "playbook", action: "messages" },
  async handler(ctx, input) {
    await requirePlaybook(ctx, false);
    const me = ctx.principal.account_id;
    let q = ctx.db
      .selectFrom("playbook_messages as m")
      .leftJoin("accounts as t", "t.account_id", "m.to_account_id")
      .select(["m.message_id", "m.from_account_id", "m.from_actor", "m.to_account_id", "t.display_name as to_name", "m.text", "m.created_at", "m.read_at", "m.expires_at"])
      .where("m.product_id", "=", productId(ctx))
      .where("m.expires_at", ">", ctx.now)
      .where(input.box === "inbox" ? "m.to_account_id" : "m.from_account_id", "=", me);
    if (input.unread_only) q = q.where("m.read_at", "is", null);
    const rows = await q.orderBy(sql`m.read_at is null`, "desc").orderBy("m.created_at", "desc").limit(input.limit).execute();
    return {
      box: input.box,
      messages: rows.map((m) => ({
        message_id: m.message_id,
        from: { account_id: m.from_account_id, display_name: m.from_actor.display_name || "Someone", ...(m.from_actor.client ? { client: m.from_actor.client } : {}) },
        to: { account_id: m.to_account_id, display_name: m.to_name || "Someone" },
        text: m.text,
        created_at: m.created_at,
        read_at: m.read_at,
        expires_at: m.expires_at,
      })),
      messages_waiting: await playbookMessagesWaiting(ctx),
    };
  },
});

export const playbookSendMessage = defineOperation({
  name: "playbook.send_message",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Send a message to another person's agents about this product.",
  description: `to is the person's account_id, from members_read(action="list", params={tenant, product}); they must read the product as a viewer or above (someone who reads only its Story reaches no Playbook), and are not you. text is at most ${PLAYBOOK_MESSAGE_MAX} characters: what you are doing and what you need, with whatbuild: links. Their agents see that it waits in every answer they get, and it lasts ${PLAYBOOK_MESSAGE_DAYS} days, read or not. What everyone should know, or should last longer, goes in a file of the Playbook instead.`,
  input: z.strictObject({ to: z.string().min(1).max(64).describe("The person's account_id."), text: z.string().trim().min(1).max(PLAYBOOK_MESSAGE_MAX) }),
  rest: { method: "POST", path: "/playbook/messages" },
  mcp: { tool: "playbook", action: "send_message" },
  async handler(ctx, input) {
    await requirePlaybook(ctx, true);
    if (input.to === ctx.principal.account_id) throw invalid("playbook_message_to_self", "to is your own person. Keep notes for yourself in your person's page under people/. Nothing was sent.");
    const person = await ctx.db.selectFrom("accounts").select(["account_id", "display_name", "deleted_at"]).where("account_id", "=", input.to).executeTakeFirst();
    const held = person && !person.deleted_at ? effectiveRole(await membershipsFor(ctx.db, person.account_id, tenantId(ctx)), { tenant_id: tenantId(ctx), product_id: productId(ctx) }) : null;
    if (!held || held.tenantRole === "guest" || !roleAtLeast(held.role, "viewer"))
      throw notFound(
        `Nobody who reads this product's Playbook has account ${input.to}: messages go to its viewers, editors and admins, never to someone who reads only its Story. members_read(action="list", params={tenant, product}) gives each person's role. Nothing was sent.`,
        { to: input.to },
      );
    const message_id = newId();
    const expires_at = new Date(Date.parse(ctx.now) + PLAYBOOK_MESSAGE_DAYS * 86400_000).toISOString();
    await ctx.db
      .insertInto("playbook_messages")
      .values({ message_id, tenant_id: tenantId(ctx), product_id: productId(ctx), from_account_id: ctx.principal.account_id, from_actor: json(ctx.actor), to_account_id: person!.account_id, text: input.text, created_at: ctx.now, expires_at })
      .execute();
    await recordActivity(ctx, { action: "playbook_message_sent", entity_type: "playbook", entity_id: message_id, entity_title: person!.display_name || null, summary: `Sent a message to ${person!.display_name || "someone"}'s agents` });
    return { message_id, to: { account_id: person!.account_id, display_name: person!.display_name || "Someone" }, created_at: ctx.now, expires_at };
  },
});

export const playbookMarkRead = defineOperation({
  name: "playbook.mark_read",
  scope: "product",
  access: "read",
  mutates: true,
  // A change, if only to the person's own count: a Read only connection is shown no write tool, so it needs Edit.
  connection: "editor",
  // Only the person's own count changes, so messages waiting can be cleared where nothing else can be written.
  allowArchivedProduct: true,
  allowReadOnlyOrganization: true,
  summary: "Mark messages to your person as read.",
  description: "message_ids names them, from playbook_read(action=\"messages\"); all marks every message waiting. Marking one read changes only your person's count; it still lasts its 60 days. Anyone who reads the product may mark their own, through an Edit connection; a Read only connection, offered no write tool, leaves them unread.",
  input: z.strictObject({ message_ids: z.array(z.string().min(1).max(64)).max(100).optional(), all: z.boolean().default(false) }),
  rest: { method: "POST", path: "/playbook/messages/read" },
  mcp: { tool: "playbook", action: "mark_read" },
  async handler(ctx, input) {
    await requirePlaybook(ctx, true);
    if (!input.all && !input.message_ids?.length) throw invalid("invalid_input", "Name message_ids, or set all to true. Nothing was marked.");
    let q = ctx.db.updateTable("playbook_messages").set({ read_at: ctx.now }).where("product_id", "=", productId(ctx)).where("to_account_id", "=", ctx.principal.account_id).where("read_at", "is", null);
    if (!input.all) q = q.where("message_id", "in", input.message_ids!);
    const r = await q.executeTakeFirst();
    return { marked: Number(r.numUpdatedRows), messages_waiting: await playbookMessagesWaiting(ctx) };
  },
});

// ---- Deleting -----------------------------------------------------------------------------------

export const playbookPurge = defineOperation({
  name: "playbook.purge",
  scope: "product",
  access: "admin",
  mutates: true,
  allowReadOnlyOrganization: true,
  summary: "DELETE PERMANENTLY: a file of the Playbook and every revision of it. Remove is the reversible alternative.",
  description:
    "Remove (playbook_write(action=\"remove\")) keeps the history, and is almost always what is wanted; purge is for text that must not be kept, earlier revisions included. Needs admin, and a connection at Admin. Show the person the file and its history (playbook_read(action=\"history\")) first, and purge only once they approve. Takes that answer's etag as expected_etag, the person's reason, and confirm set to exactly \"delete permanently\". It deletes every file the path has held. A path whose file was moved away answers 404 naming where it is now (details.moved_to); one already purged, 410 playbook_file_deleted.",
  input: z.strictObject({
    path: pathField,
    ...deleteGuards,
    // The Playbook has no delete_impact: its history shows what goes.
    expected_etag: expectedEtag.describe("The file's etag, from playbook_read(action=\"history\", params={path}) that you showed the person. If the file changed since, the purge is refused with 409 stale_etag."),
  }),
  rest: { method: "DELETE", path: "/playbook/file" },
  mcp: { tool: "playbook", action: "purge" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, 'remove it with playbook_write(action="remove")');
    // Held as writes are, so a write made after the etag was read cannot be deleted with it unseen.
    await requirePlaybook(ctx, true, true);
    const path = playbookPath(input.path);
    const f = await fileForHistory(ctx, path, true);
    if (!sameEtag(input.expected_etag, f.etag)) throw changedSince(f, input.expected_etag);
    const all = await ctx.db.selectFrom("playbook_files").select("file_id").where("product_id", "=", productId(ctx)).where("path", "=", path).execute();
    const ids = all.map((r) => r.file_id);
    const revs = await ctx.db.selectFrom("playbook_revisions").select((eb) => eb.fn.countAll<string>().as("n")).where("file_id", "in", ids).executeTakeFirstOrThrow();
    await ctx.db.deleteFrom("playbook_files").where("file_id", "in", ids).execute();
    await leaveTombstone(ctx, { object_type: "playbook_file", object_id: path, title: f.title ?? path, reason: input.reason });
    await recordActivity(ctx, { action: "playbook_file_purged", entity_type: "playbook", entity_id: path, entity_title: path, summary: `Deleted ${path} and its history from the Playbook permanently` });
    return { purged: true, path, revisions_deleted: Number(revs.n), reason: input.reason };
  },
});

// ---- For the answers that point agents at the Playbook -----------------------------------------------

/**
 * The files that apply to a part of the product, for the answer an agent starting work there gets:
 * a path, a title and a description each. Empty when the Playbook is off or nothing applies.
 */
export async function playbookFilesFor(ctx: OpContext, area: PlaybookArea): Promise<{ playbook?: { files: { path: string; title: string | null; description: string | null }[]; how: string } }> {
  const s = await ctx.db.selectFrom("products").select(["playbook_enabled", "playbook_started_at"]).where("product_id", "=", productId(ctx)).executeTakeFirst();
  if (!s?.playbook_enabled) return {};
  const files = s.playbook_started_at
    ? await ctx.db
        .selectFrom("playbook_files")
        .select(["path", "title", "description"])
        .where("product_id", "=", productId(ctx))
        .where("removed_at", "is", null)
        .where(sql<boolean>`applies_to && ${sql.val([area, "all"])}::text[]`)
        .orderBy(sql`path collate "C"`)
        .limit(40)
        .execute()
    : starterRows()
        .filter((f) => f.applies_to.includes(area) || f.applies_to.includes("all"))
        .map((f) => ({ path: f.path, title: f.title, description: f.description }));
  if (!files.length) return {};
  return { playbook: { files, how: 'The product\'s Playbook: what its team\'s agents learned about this work. Read these with playbook_read(action="read"), and write what you learn as you work (guide(topic="playbook")).' } };
}

/** The Playbook as a product's answer gives it: whether it is on, and, when it is, what to read first and what waits. */
export async function playbookSummary(ctx: OpContext) {
  const s = await ctx.db.selectFrom("products").select(["playbook_enabled", "playbook_started_at"]).where("product_id", "=", productId(ctx)).executeTakeFirstOrThrow();
  if (!s.playbook_enabled) return { enabled: false };
  if (!roleAtLeast(ctx.scope.role, "viewer")) return { enabled: true };
  const files = await liveFiles(ctx, s.playbook_started_at !== null);
  const by = (a: PlaybookArea) => files.filter((f) => f.applies_to.includes(a)).map((f) => f.path);
  return {
    enabled: true,
    started: s.playbook_started_at !== null,
    files: files.length,
    read_first: files.filter((f) => f.applies_to.includes("all")).map((f) => ({ path: f.path, title: f.title, description: f.description })),
    by_area: { idea: by("idea"), evidence: by("evidence"), exploration: by("exploration"), story: by("story") },
    messages_waiting: await playbookMessagesWaiting(ctx),
    how: ctx.scope.product?.archived_at
      ? 'The product\'s Playbook is how its people\'s agents work together. The product is archived, so its Playbook can be read but not written: read read_first for what the team learned. An admin of the product restores it with products_write(action="restore"), or in the web app, in the product\'s Settings, under General. playbook_read(action="index") lists every file; guide(topic="playbook") says how it works.'
      : 'The product\'s Playbook is how its people\'s agents work together: read read_first before working here, and write what you learn as you work. playbook_read(action="index") lists every file; guide(topic="playbook") says how it works.',
  };
}

export const playbookOps = [playbookIndex, playbookRead, playbookReadFiles, playbookSearch, playbookHistory, playbookBacklinks, playbookHousekeeping, playbookStarter, playbookMessages, playbookGetDownload, playbookWrite, playbookRemove, playbookMove, playbookRestore, playbookApply, playbookRequestUpload, playbookSendMessage, playbookMarkRead, playbookPurge];
