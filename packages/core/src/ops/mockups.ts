import { TooLargeError, TooManyEntriesError, zipEntries } from "@whatbuild/parsers";
import { sql } from "kysely";
import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import { checkEtag, EMPTY_REFS, productId, recordActivity, tenantId, validateRefs } from "../common.ts";
import { checkCitationList, CITATION_MAX_COUNT, citationInput, citationViews, snapshotAll } from "../citations.ts";
import { json, type Tx } from "../db.ts";
import { checkConfirmation, DELETE_GUIDANCE, deleteGuards, leaveTombstone, refuseIfDeleted } from "../deletion.ts";
import { AppError, conflict, forbidden, invalid, notFound, tooLarge } from "../errors.ts";
import { DOWNLOAD_GRANT_HEADER, UPLOAD_GRANT_HEADER } from "./files.ts";
import { defineOperation, type OpContext, type PrepareContext } from "../registry.ts";
import { expectedEtag, formatIssues, id } from "../schemas.ts";
import { inspectMockupHtml, MOCKUP_PAGE_RULES } from "../html-rules.ts";
import type { BlobStore } from "../ports.ts";
import {
  entryAddress, isPrototypeHtml, isPrototypeImage, PROTOTYPE_ENTRY_SUFFIX_MAX, PROTOTYPE_FILE_MAX_BYTES, PROTOTYPE_MAX_BYTES, PROTOTYPE_MAX_FILES,
  PROTOTYPE_PATH_MAX, PROTOTYPE_POSTER_MAX_BYTES, PROTOTYPE_PRODUCT_MAX_BYTES, prototypeAddress, prototypeMediaType, prototypePath, prototypeWarnings, splitEntry,
} from "../prototype.ts";
import { newEtag, newId, sha256Hex } from "../util.ts";
import { resolveRefs, storyPagesShowing } from "./story.ts";

/**
 * Mockups are where Exploration makes things: a canvas of HTML pages an agent built (screens,
 * flows, alternatives), each page with design notes, and a brief in Markdown that says what the
 * canvas explores and why. A version is the whole canvas; every publish makes the next one. A
 * version may also carry a prototype, a team's multi-file prototype as it is, whose pages are
 * entries into it (prototype.ts).
 */

export const MAX_MOCKUPS = 50;
export const MAX_MOCKUP_PAGES = 48;
/** The most characters one page holds. */
export const MOCKUP_PAGE_MAX = MOCKUP_PAGE_RULES.maxChars;
export const MOCKUP_HTML_TOTAL = 8_000_000;
export const BRIEF_MAX = 50_000;
export const PAGE_NOTES_MAX = 10_000;
export const MAX_MOCKUP_FILES = 50;
export const MOCKUP_FILES_TOTAL = 2_000_000;
/** A canvas uploaded as a ZIP: at most this many bytes packed, this many once unpacked, and this many entries. */
export const MOCKUP_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const MOCKUP_UPLOAD_UNPACKED_MAX = 96 * 1024 * 1024;
export const MOCKUP_UPLOAD_MAX_ENTRIES = PROTOTYPE_MAX_FILES + 2 * MAX_MOCKUP_PAGES + MAX_MOCKUP_FILES + 2;
const MIB = 1024 * 1024;
export const MOCKUP_UPLOAD_PURPOSE = "mockup_upload";
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

/** What a mockup page may hold and what is refused, as publish and request_upload say it (html-rules.ts). */
const PAGE_RULES_TEXT =
  `What a page may hold: inline CSS; inline scripts and event handlers, of any number and length; forms and their controls, whose submit handlers run but whose submissions go nowhere (form-action 'none'), so handle submit, call preventDefault and give a form no target; images, fonts and media as data: URIs; links. ` +
  `Refused: anything loaded from elsewhere (a src, srcset, poster or the like that is not a data: URI, a url() in CSS that is neither data: nor a #fragment, @import, <script src>, <link>), frames and embeds (<iframe>, <frame>, <frameset>, <embed>, <object>, <portal>), <base> and <meta http-equiv>. ` +
  `A page holds at most ${MOCKUP_PAGE_MAX} characters, and a version ${MOCKUP_HTML_TOTAL} in all, counted as a JavaScript string's length, not in bytes.`;
const SAFE_CHECK_TEXT =
  "Every problem is listed at once (422), each naming the page, the rule and the element. A refused publish changes nothing and leaves an upload unused, so publishing is a safe way to check a canvas.";
/** What a prototype is, what it may do, and what publish says about it. */
const PROTOTYPE_TEXT =
  `A version may also carry a prototype: a team's multi-file prototype as it is (HTML documents that link to one another, scripts, styles, fonts, images, media, fixtures), uploaded under prototype/ in the canvas ZIP and never sent in a call; at most ${PROTOTYPE_MAX_FILES} files and ${PROTOTYPE_MAX_BYTES / MIB} MB, ${PROTOTYPE_FILE_MAX_BYTES / MIB} MB a file, and ${PROTOTYPE_PRODUCT_MAX_BYTES / MIB} MB of distinct prototype bytes in a product. Its files are any bytes, given back byte for byte, and are not held to a page's HTML rules: they are served in the sandbox under a short-lived address of their own, and load only one another, by relative address, with no network. A page with entry instead of html enters it: the path of one of its HTML documents, with a ?query and #fragment if wanted; several pages may enter one prototype, and its links move between its documents inside the page's frame. ` +
  `A prototype is stateless: localStorage, sessionStorage, IndexedDB and document.cookie are unavailable in WhatBuild's sandbox and throw, so each document load starts fresh; keep state in script variables while a document is open, or in the address (query or hash) across its documents. Forms run their submit handlers and submit nowhere. A root-relative address (/assets/app.js) points outside the prototype and does not load: build with a relative base (./). ` +
  "Publish answers with prototype_warnings, naming each file: root-relative and remote addresses, addresses the prototype does not hold, and scripts that use browser storage or cookies. A warning never refuses.";
/** What a frame does with a page taller than it, as the canvas and the Story show it. */
const TALL_PAGES_TEXT =
  "Content taller than a page's height scrolls inside its frame: on the canvas people see the first height pixels in pan mode, its default, and scroll the rest in interact mode; on the Story a promoted page scrolls inside its frame. A long document can be one page that scrolls, or several pages side by side (columns) that people see whole on the canvas; both work, so choose by how people will read it.";
/** What chars and sha256 mean, for a page's HTML and for a file. */
const HASHES_TEXT =
  "html_chars and a file's chars are the text's length as a JavaScript string counts it (UTF-16 code units, so an emoji counts two), never bytes. html_sha256 and a file's sha256 are SHA-256 of the text encoded as UTF-8, so they equal a hash of a UTF-8 file's bytes (shasum -a 256), except that a file in an uploaded ZIP loses a leading byte-order mark.";

const pageSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "a lower-case slug: letters, digits and hyphens, up to 80 characters")
  .describe("The page's slug on this canvas, e.g. onboarding-a. Keep it across versions so a page's html, title and notes can carry forward.");

const pageInput = z.strictObject({
  page_id: pageSlug,
  title: z.string().trim().min(1).max(200).optional().describe("Required for a new page; omit to keep the page's title from the base version."),
  notes: z.string().max(PAGE_NOTES_MAX).optional().describe("Markdown design notes shown beside the page. Omit to keep them."),
  width: z.number().int().min(240).max(2560).optional().describe(`The frame's width in CSS pixels: ${DEFAULT_WIDTH} for a desktop screen, 390 for a phone. Omit to keep it.`),
  height: z.number().int().min(240).max(4000).optional().describe(`The frame's height in CSS pixels, default ${DEFAULT_HEIGHT}. Omit to keep it.`),
  html: z
    .string()
    .min(1)
    .max(MOCKUP_PAGE_MAX, `a mockup page holds at most ${MOCKUP_PAGE_MAX} characters`)
    .optional()
    .describe("The whole page, one self-contained document. A new page needs html or entry; omit to keep the base version's."),
  entry: z
    .string()
    .min(1)
    .max(PROTOTYPE_PATH_MAX + PROTOTYPE_ENTRY_SUFFIX_MAX)
    .optional()
    .describe("Instead of html: the path of one of the version's prototype HTML documents, with a ?query and #fragment if wanted, e.g. app/checkout.html?plan=pro#step-2. Omit to keep the base version's."),
  poster: z
    .string()
    .min(1)
    .max(PROTOTYPE_PATH_MAX)
    .nullable()
    .optional()
    .describe(`For an entry page: a PNG, JPEG, GIF, WebP or AVIF in the prototype, at most ${PROTOTYPE_POSTER_MAX_BYTES / MIB} MB, that the Story's print view shows in its place. null removes it.`),
});

const filePath = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, "a relative path of letters, digits, dots, hyphens and underscores, with / between folders")
  .refine((p) => p.split("/").every((seg) => seg !== "." && seg !== ".."), "no . or .. in the path")
  .refine((p) => p.split("/").length <= 6, "at most five folders deep")
  .describe("The file's path in the project, e.g. DESIGN.md or components/job-card.html.");

const fileInput = z.strictObject({
  path: filePath,
  content: z.string().max(MOCKUP_FILES_TOTAL).optional().describe("The file's text. Required for a new path; omit it to keep the base version's."),
});

const refsInput = z
  .strictObject({
    outcomes: z.array(id("outcome")).max(50).optional(),
    sources: z.array(id("source")).max(100).optional(),
    assumptions: z.array(id("assumption")).max(100).optional(),
  })
  .optional();

async function loadMockup(ctx: OpContext, mockupId: string, lock = false) {
  let q = ctx.db.selectFrom("mockups").selectAll().where("product_id", "=", productId(ctx)).where("mockup_id", "=", mockupId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) {
    await refuseIfDeleted(ctx, "mockup", mockupId, `Mockup ${mockupId}`);
    throw notFound(`There is no mockup ${mockupId} in this product.`);
  }
  return row;
}

function summaryView(e: { mockup_id: string; title: string; summary: string; version_count: number; current_version_id: string; archived_at: string | null; etag: string; created_at: string; updated_at: string; updated_by: unknown }) {
  return {
    mockup_id: e.mockup_id,
    title: e.title,
    summary: e.summary,
    current_version: e.version_count,
    current_version_id: e.current_version_id,
    archived_at: e.archived_at,
    etag: e.etag,
    created_at: e.created_at,
    updated_at: e.updated_at,
    updated_by: e.updated_by,
  };
}

function htmlPath(ctx: OpContext, mockupId: string, n: number, pageId: string) {
  const s = ctx.scope;
  return `/api/v1/p/${s.tenant!.slug}/${s.team!.slug}/${s.product!.slug}/mockups/${mockupId}/versions/${n}/pages/${pageId}/html`;
}

/** A version's prototype files, in byte order of their paths. */
export function prototypeFiles(db: Tx, versionId: string) {
  return db.selectFrom("mockup_prototype_files").select(["path", "size", "sha256", "media_type", "blob_key"]).where("version_id", "=", versionId).orderBy(sql`path collate "C"`).execute();
}

/** What a version's prototype is, and the address to frame it at; null for a version without one. */
async function prototypeView(ctx: OpContext, versionId: string, withFiles: boolean) {
  const rows = await prototypeFiles(ctx.db, versionId);
  if (!rows.length) return null;
  return {
    file_count: rows.length,
    bytes: rows.reduce((n, r) => n + r.size, 0),
    ...prototypeAddress(ctx.ports, tenantId(ctx), versionId, ctx.now),
    ...(withFiles ? { files: rows.map((r) => ({ path: r.path, size: r.size, sha256: r.sha256, media_type: r.media_type })) } : {}),
  };
}

/** A version of the canvas: the brief, the pages in order, the files and prototype it carries, and what it draws on. */
async function versionView(ctx: OpContext, versionId: string, withHtml: boolean, withFiles = false) {
  const v = await ctx.db.selectFrom("mockup_versions").selectAll().where("version_id", "=", versionId).where("product_id", "=", productId(ctx)).executeTakeFirstOrThrow();
  const pages = await ctx.db.selectFrom("mockup_pages").selectAll().where("version_id", "=", versionId).orderBy("position").execute();
  const files = await ctx.db.selectFrom("mockup_files").select(["path", "content"]).where("version_id", "=", versionId).orderBy(sql`path collate "C"`).execute();
  const prototype = await prototypeView(ctx, versionId, withFiles);
  const resolved = await resolveRefs(ctx, v.refs);
  return {
    version_id: v.version_id,
    version: v.n,
    mockup_id: v.mockup_id,
    title: v.title,
    summary: v.summary,
    brief: v.brief,
    columns: v.columns,
    pages: pages.map((p) => {
      const common = { page_id: p.page_id, title: p.title, notes: p.notes, width: p.width, height: p.height };
      if (p.entry !== null || p.html === null)
        return { ...common, entry: p.entry, poster: p.poster, prototype_url: prototype && p.entry ? `${prototype.base_url}${entryAddress(p.entry)}` : null };
      return { ...common, html_sha256: sha256Hex(p.html), html_path: htmlPath(ctx, v.mockup_id, v.n, p.page_id), ...(withHtml ? { html: p.html } : { html_chars: p.html.length }) };
    }),
    files: files.map((x) => ({ path: x.path, chars: x.content.length, sha256: sha256Hex(x.content), ...(withFiles ? { content: x.content } : {}) })),
    prototype,
    refs: { outcomes: v.refs.outcomes, sources: v.refs.sources, assumptions: v.refs.assumptions },
    resolved_refs: { outcomes: resolved.outcomes, sources: resolved.sources, assumptions: resolved.assumptions },
    citations: await citationViews(ctx, v.citations),
    published_at: v.created_at,
    published_by: v.created_by,
  };
}

async function versionIdOf(ctx: OpContext, mockupId: string, n: number) {
  const v = await ctx.db.selectFrom("mockup_versions").select("version_id").where("product_id", "=", productId(ctx)).where("mockup_id", "=", mockupId).where("n", "=", n).executeTakeFirst();
  if (!v) throw notFound(`Mockup ${mockupId} has no version ${n}.`);
  return v.version_id;
}

export const listMockups = defineOperation({
  name: "mockups.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "The product's mockups, most recently changed first: title, summary, current version and etag, without pages.",
  description: `Archived mockups are left out unless include_archived; archived_hidden says how many were left out. page_count is the current version's. quota is how many mockups the product holds, {used, limit}: archived ones count, and publishing a new mockup at the limit (${MAX_MOCKUPS}) is refused with 409 quota_exceeded, so when used nears the limit, ask the person whether to publish a new version of a mockup instead, or delete one they no longer need.`,
  input: z.strictObject({ include_archived: z.boolean().default(false) }),
  rest: { method: "GET", path: "/mockups" },
  mcp: { tool: "mockups", action: "list" },
  async handler(ctx, input) {
    const rows = await ctx.db
      .selectFrom("mockups as m")
      .selectAll("m")
      .select((eb) => eb.selectFrom("mockup_pages as p").whereRef("p.version_id", "=", "m.current_version_id").select(eb.fn.countAll<number>().as("n")).as("page_count"))
      .where("m.product_id", "=", productId(ctx))
      .orderBy("m.updated_at", "desc")
      .execute();
    const shown = input.include_archived ? rows : rows.filter((r) => !r.archived_at);
    const archived_hidden = rows.length - shown.length;
    return {
      items: shown.map((r) => ({ ...summaryView(r), page_count: Number(r.page_count ?? 0) })),
      archived_hidden,
      quota: mockupQuota(rows.length),
      ...(archived_hidden
        ? { note: `${archived_hidden} archived mockup${archived_hidden === 1 ? " is" : "s are"} not listed; pass include_archived to see ${archived_hidden === 1 ? "it" : "them"}. Archived mockups count toward the product's ${MAX_MOCKUPS}; ${rows.length} are used.` }
        : {}),
    };
  },
});

/** How many mockups a product holds against its limit, archived ones included, as quota_exceeded reports it. */
function mockupQuota(used: number) {
  return { used, limit: MAX_MOCKUPS, unit: "mockups", archived_included: true };
}

export const getMockup = defineOperation({
  name: "mockups.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read a mockup's current version: its brief, its pages with their notes, what it draws on, the Story pages that show its pages, and the etag to publish again.",
  description:
    `Read this before publishing a new version, and read the brief first: it says what the canvas explores. Pages come without HTML unless include_html; each has html_path (a GET in the web app's session), html_sha256 and, without include_html, html_chars, except a page that enters the version's prototype, which has entry, poster and prototype_url (its frame's address) instead. files lists what the version carries for collaborators (path, chars, sha256), with each file's content when include_files. prototype, when the version carries one, gives file_count, bytes, base_url (the prototype's address, a capability that expires at expires_at), the sandbox its frames use, and with include_files each file's path, size, sha256 and media_type. ${HASHES_TEXT} To work on the canvas outside WhatBuild, get_download gives the whole version as a ZIP. story_pages lists the Story pages whose current version shows one of its pages (story promote_mockup), with the mockup version each shows.`,
  input: z.strictObject({ mockup_id: id("mockup"), include_html: z.boolean().default(false), include_files: z.boolean().default(false).describe("Include each file's content, and the prototype's files.") }),
  rest: { method: "GET", path: "/mockups/:mockup_id" },
  mcp: { tool: "mockups", action: "get" },
  async handler(ctx, input) {
    const e = await loadMockup(ctx, input.mockup_id);
    return { ...summaryView(e), current: await versionView(ctx, e.current_version_id, input.include_html, input.include_files), story_pages: await storyPagesShowing(ctx, e.mockup_id) };
  },
});

export const listMockupVersions = defineOperation({
  name: "mockups.list_versions",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "A mockup's versions, newest first, without pages.",
  description: "Versions are immutable and numbered 1, 2, 3…; read one with get_version, and start from one with publish from_version.",
  input: z.strictObject({ mockup_id: id("mockup"), limit: z.number().int().min(1).max(100).default(25), before: z.number().int().min(1).optional().describe("Only versions numbered below this.") }),
  rest: { method: "GET", path: "/mockups/:mockup_id/versions" },
  mcp: { tool: "mockups", action: "list_versions" },
  async handler(ctx, input) {
    await loadMockup(ctx, input.mockup_id);
    let q = ctx.db
      .selectFrom("mockup_versions as v")
      .select(["v.version_id", "v.n", "v.title", "v.summary", "v.created_at", "v.created_by"])
      .select((eb) => eb.selectFrom("mockup_pages as p").whereRef("p.version_id", "=", "v.version_id").select(eb.fn.countAll<number>().as("n")).as("page_count"))
      .select((eb) => eb.selectFrom("mockup_files as f").whereRef("f.version_id", "=", "v.version_id").select(eb.fn.countAll<number>().as("n")).as("file_count"))
      .where("v.product_id", "=", productId(ctx))
      .where("v.mockup_id", "=", input.mockup_id);
    if (input.before) q = q.where("v.n", "<", input.before);
    const rows = await q.orderBy("v.n", "desc").limit(input.limit + 1).execute();
    const items = rows.slice(0, input.limit).map((v) => ({ version_id: v.version_id, version: v.n, title: v.title, summary: v.summary, page_count: Number(v.page_count ?? 0), file_count: Number(v.file_count ?? 0), published_at: v.created_at, published_by: v.created_by }));
    return { items, next_before: rows.length > input.limit ? items[items.length - 1]!.version : null };
  },
});

export const getMockupVersion = defineOperation({
  name: "mockups.get_version",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read one version of a mockup, by number.",
  description: "Includes the mockup's archived_at and whether this is the current version.",
  input: z.strictObject({ mockup_id: id("mockup"), version: z.number().int().min(1), include_html: z.boolean().default(false), include_files: z.boolean().default(false).describe("Include each file's content.") }),
  rest: { method: "GET", path: "/mockups/:mockup_id/versions/:version" },
  mcp: { tool: "mockups", action: "get_version" },
  async handler(ctx, input) {
    const e = await loadMockup(ctx, input.mockup_id);
    const vid = await versionIdOf(ctx, input.mockup_id, input.version);
    return { ...(await versionView(ctx, vid, input.include_html, input.include_files)), mockup_archived_at: e.archived_at, is_current: vid === e.current_version_id };
  },
});

export const requestMockupUpload = defineOperation({
  name: "mockups.request_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Get a short-lived grant to PUT a canvas as a ZIP, for publish to read by upload_id. Use it instead of sending page HTML through a tool call.",
  description:
    `PUT one ZIP to url with exactly the headers given (curl -T canvas.zip -H …), then call publish with upload_id and whatever else changes (mockup_id and expected_etag for a later version, refs, citations). The ZIP has get_download's layout, so a download round-trips: manifest.json lists the canvas's pages in order, [{page_id, title?, width?, height?, entry?, poster?}], and may give title, summary, columns, files ([{path}]) and prototype ([{path, sha256?}]); brief.md is the brief; pages/<page_id>.html and pages/<page_id>.notes.md hold a page's HTML and notes; files/<path> holds a file the version carries; prototype/<path> holds a file of the version's prototype, any bytes. A page whose HTML or notes the ZIP leaves out keeps the base version's, so a ZIP can carry only the pages that changed, with every page still listed. The files listed in manifest.json are the whole set, a listed path missing from files/ keeping the base's content; without a files list, the files under files/ are the whole set, and with none either the version keeps the base's files. The prototype follows the same rule: listed paths are the whole set, one missing from prototype/ keeping the base's bytes (and its sha256, if given, must match); without a list, the files under prototype/ are the whole set; with neither, the base's prototype carries forward; "prototype": [] drops it. Prototype paths are relative, at most ${PROTOTYPE_PATH_MAX} characters and 16 folders deep, without \\ : * ? " < > | # or a control character; two that differ only in case are refused. ${PROTOTYPE_TEXT} refs and citations in manifest.json are not read: pass them in the call. Everything else in the ZIP is refused, and so are a name used twice and a symbolic link; one top-level folder around it all is allowed. Each page in it is checked as one sent in the call is. ${PAGE_RULES_TEXT} Files are UTF-8 text. At most ${MOCKUP_UPLOAD_MAX_BYTES / MIB} MB packed, ${MOCKUP_UPLOAD_UNPACKED_MAX / MIB} MB unpacked and ${MOCKUP_UPLOAD_MAX_ENTRIES} entries. ${SAFE_CHECK_TEXT} An upload's bytes cannot be replaced: to change a page, PUT a new ZIP under a new upload. The grant expires, a successful publish reads an upload once and answers with its size and sha256, and an upload nobody publishes is discarded a day after its grant expires. Keep the grant header out of reports and logs.`,
  input: z.strictObject({ size: z.number().int().min(0).optional().describe("The ZIP's size in bytes, when known, so an oversized one is refused before it transfers.") }),
  rest: { method: "POST", path: "/mockups/uploads" },
  mcp: { tool: "mockups", action: "request_upload" },
  async handler(ctx, input) {
    // A visitor's text is capped field by field (checkVisitorInput); a ZIP would carry it past that.
    if (ctx.sandbox?.visitor) throw forbidden("In a public sandbox, publish a mockup's pages in the call itself; uploading a canvas is for organizations of your own.");
    const max = Math.min(MOCKUP_UPLOAD_MAX_BYTES, ctx.ports.config.relayMaxBytes);
    if (input.size !== undefined && input.size > max) throw tooLarge(`A canvas's ZIP is at most ${max} bytes; this one is ${input.size}.`, { limit: max });
    const upload_id = newId();
    const expiresAt = new Date(Date.parse(ctx.now) + ctx.ports.config.grantTtlSeconds * 1000);
    await ctx.db
      .insertInto("mockup_uploads")
      .values({
        upload_id, tenant_id: tenantId(ctx), product_id: productId(ctx), blob_key: `t/${tenantId(ctx)}/p/${productId(ctx)}/mockup-uploads/${upload_id}`,
        max_bytes: max, principal: json(ctx.actor), expires_at: expiresAt.toISOString(),
      })
      .execute();
    const token = ctx.ports.grants.sign({ v: 1, purpose: MOCKUP_UPLOAD_PURPOSE, u: upload_id, t: tenantId(ctx), exp: Math.floor(expiresAt.getTime() / 1000) });
    return {
      upload_id,
      method: "PUT" as const,
      url: `${ctx.ports.config.publicBaseUrl}/api/v1/uploads/mockup/${upload_id}`,
      headers: { [UPLOAD_GRANT_HEADER]: token, "Content-Type": "application/zip" },
      max_bytes: max,
      expires_at: expiresAt.toISOString(),
      next: 'PUT the ZIP\'s raw bytes to url with exactly these headers (one request, no multipart), then call mockups(action="publish") with upload_id. Keep the grant header out of reports and logs.',
    };
  },
});

const manifestPage = z.object({
  page_id: pageSlug,
  title: z.string().trim().min(1).max(200).optional(),
  width: z.number().int().min(240).max(2560).optional(),
  height: z.number().int().min(240).max(4000).optional(),
  entry: z.string().min(1).max(PROTOTYPE_PATH_MAX + PROTOTYPE_ENTRY_SUFFIX_MAX).optional(),
  poster: z.string().min(1).max(PROTOTYPE_PATH_MAX).nullable().optional(),
});
/** manifest.json as publish reads it. Not strict: a downloaded manifest's other fields are ignored. */
const manifestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().max(2000).optional(),
  columns: z.number().int().min(1).max(12).nullable().optional(),
  pages: z.array(manifestPage).min(1).max(MAX_MOCKUP_PAGES),
  files: z.array(z.object({ path: filePath })).max(MAX_MOCKUP_FILES).optional(),
  prototype: z
    .array(z.object({ path: z.string().min(1).max(PROTOTYPE_PATH_MAX), sha256: z.string().regex(/^[0-9a-f]{64}$/, "a SHA-256 in lower-case hex").optional() }))
    .max(PROTOTYPE_MAX_FILES)
    .optional(),
});

/** What a canvas's ZIP gives publish, in the shape of its own input. */
export interface CanvasUpload {
  upload_id: string;
  title?: string;
  summary?: string;
  columns?: number | null;
  brief?: string;
  pages: z.infer<typeof pageInput>[];
  files?: z.infer<typeof fileInput>[];
  /** The prototype the ZIP gives, or undefined to carry the base's forward. */
  prototype?: PrototypeUpload;
}

/** A prototype as a canvas ZIP gives it, before publish stores it. */
export interface PrototypeUpload {
  /** manifest.json's list, the whole set (a listed path absent from prototype/ keeps the base's bytes); null when it gives none. */
  listed: { path: string; sha256?: string | undefined }[] | null;
  /** The files under prototype/, at their stored paths. */
  files: { path: string; data: Uint8Array }[];
}

/** A prototype file once publish has stored its bytes. */
type ProtoRow = { path: string; size: number; sha256: string; media_type: string; blob_key: string };

/** Entries a ZIP tool adds that are not part of what was zipped. */
const ZIP_LITTER = (name: string) => name.endsWith("/") || name.startsWith("__MACOSX/") || name.includes("/__MACOSX/") || /(^|\/)\.DS_Store$/.test(name);

/**
 * Read a canvas from a ZIP in get_download's layout. Every problem is listed at once (422); nothing
 * is checked against the base version here, so a page the ZIP leaves HTML out of carries forward
 * as one left out of publish's pages would.
 */
export function readCanvasZip(uploadId: string, bytes: Uint8Array): CanvasUpload {
  let list: ReturnType<typeof zipEntries>;
  try {
    list = zipEntries(bytes, (name) => !ZIP_LITTER(name), MOCKUP_UPLOAD_UNPACKED_MAX, MOCKUP_UPLOAD_MAX_ENTRIES);
  } catch (e) {
    if (e instanceof TooManyEntriesError) throw invalid("invalid_upload", `Nothing was published: ${e.message}. A canvas's ZIP holds at most ${MOCKUP_UPLOAD_MAX_ENTRIES} entries.`);
    if (e instanceof TooLargeError) throw invalid("invalid_upload", `Nothing was published: the ZIP unpacks to more than ${MOCKUP_UPLOAD_UNPACKED_MAX / MIB} MB, and a canvas's ZIP unpacks to at most that. Leave out what the canvas does not need and request a new upload.`);
    throw invalid("invalid_upload", `Nothing was published: the upload is not a ZIP WhatBuild can read (${(e as Error).message}). Zip the canvas again and request a new upload.`);
  }
  const problems: string[] = [];
  const entries: Record<string, Uint8Array> = {};
  for (const e of list) {
    if (e.name in entries) problems.push(`${e.name} appears more than once in the ZIP.`);
    else if (e.symlink) problems.push(`${e.name} is a symbolic link; zip the file it points to instead.`);
    entries[e.name] = e.data;
  }
  if (problems.length) throw invalid("invalid_upload", `Nothing was published: ${problems.join(" ")}`, { problems });
  const names = Object.keys(entries);
  // One folder around everything, as zipping a folder makes, is set aside.
  let prefix = "";
  if (!("manifest.json" in entries)) {
    const nested = names.filter((n) => /^[^/]+\/manifest\.json$/.test(n));
    if (nested.length === 1 && names.every((n) => n.startsWith(nested[0]!.slice(0, -"manifest.json".length)))) prefix = nested[0]!.slice(0, -"manifest.json".length);
    else throw invalid("invalid_upload", "Nothing was published: the ZIP has no manifest.json at its top. Use get_download's layout: manifest.json, brief.md, pages/<page_id>.html, pages/<page_id>.notes.md and files/<path>.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const text = new Map<string, string>();
  // A prototype's files are bytes, kept as they are; everything else is text.
  const proto: { path: string; data: Uint8Array }[] = [];
  const protoKeys = new Map<string, string>();
  let protoBytes = 0;
  for (const name of names) {
    const rel = name.slice(prefix.length);
    if (rel.startsWith("prototype/")) {
      const checked = prototypePath(rel.slice("prototype/".length));
      if ("problem" in checked) {
        problems.push(`${rel}: ${checked.problem}.`);
        continue;
      }
      const data = entries[name]!;
      if (data.length > PROTOTYPE_FILE_MAX_BYTES) problems.push(`${rel} is ${data.length} bytes; a prototype file is at most ${PROTOTYPE_FILE_MAX_BYTES}.`);
      const key = checked.path.toLowerCase();
      const clash = protoKeys.get(key);
      if (clash !== undefined) problems.push(`prototype/${clash} and ${rel} name the same file once case and accents are set aside; they would overwrite each other when unzipped.`);
      protoKeys.set(key, checked.path);
      protoBytes += data.length;
      proto.push({ path: checked.path, data });
      continue;
    }
    try {
      text.set(rel, decoder.decode(entries[name]!).replace(/^\uFEFF/, ""));
    } catch {
      problems.push(`${rel} is not UTF-8 text.`);
    }
  }
  let manifest: z.infer<typeof manifestSchema>;
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(text.get("manifest.json") ?? ""));
    if (!parsed.success) throw invalid("invalid_upload", `Nothing was published: manifest.json: ${formatIssues(parsed.error)}`);
    manifest = parsed.data;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw invalid("invalid_upload", "Nothing was published: manifest.json is not JSON.");
  }
  const listed = new Set(manifest.pages.map((p) => p.page_id));
  const listedFiles = manifest.files ? new Set(manifest.files.map((f) => f.path)) : null;
  if (proto.length > PROTOTYPE_MAX_FILES) problems.push(`The prototype holds ${proto.length} files; at most ${PROTOTYPE_MAX_FILES}.`);
  if (protoBytes > PROTOTYPE_MAX_BYTES) problems.push(`The prototype holds ${protoBytes} bytes; at most ${PROTOTYPE_MAX_BYTES}.`);
  let listedProto: { path: string; sha256?: string | undefined }[] | null = null;
  if (manifest.prototype) {
    listedProto = [];
    const seen = new Set<string>();
    for (const item of manifest.prototype) {
      const checked = prototypePath(item.path);
      if ("problem" in checked) problems.push(`manifest.json's prototype lists ${item.path}: ${checked.problem}.`);
      else if (seen.has(checked.path.toLowerCase())) problems.push(`manifest.json's prototype lists ${item.path} more than once.`);
      else {
        seen.add(checked.path.toLowerCase());
        listedProto.push({ path: checked.path, ...(item.sha256 ? { sha256: item.sha256 } : {}) });
      }
    }
    const names = new Set(listedProto.map((x) => x.path));
    for (const f of proto) if (!names.has(f.path)) problems.push(`prototype/${f.path} is not in manifest.json's prototype.`);
    for (const f of proto) {
      const want = listedProto.find((x) => x.path === f.path)?.sha256;
      if (want && want !== sha256Hex(f.data)) problems.push(`prototype/${f.path} does not have the sha256 manifest.json gives it.`);
    }
  }
  const carried: z.infer<typeof fileInput>[] = [];
  for (const rel of text.keys()) {
    if (rel === "manifest.json" || rel === "brief.md") continue;
    const page = /^pages\/([^/]+?)(\.notes\.md|\.html)$/.exec(rel);
    if (page) {
      if (!listed.has(page[1]!)) problems.push(`${rel} belongs to page ${page[1]}, which manifest.json's pages does not list.`);
      continue;
    }
    if (rel.startsWith("files/")) {
      const path = rel.slice("files/".length);
      const ok = filePath.safeParse(path);
      if (!ok.success) problems.push(`${rel}: ${ok.error.issues[0]?.message ?? "not a file path"}.`);
      else if (listedFiles && !listedFiles.has(path)) problems.push(`${rel} is not in manifest.json's files.`);
      else if (!listedFiles) carried.push({ path, content: text.get(rel)! });
      continue;
    }
    problems.push(`${rel} is not part of a canvas: a ZIP holds manifest.json, brief.md, pages/<page_id>.html, pages/<page_id>.notes.md, files/<path> and prototype/<path>.`);
  }
  const pages = manifest.pages.map((p) => {
    const html = text.get(`pages/${p.page_id}.html`);
    const notes = text.get(`pages/${p.page_id}.notes.md`);
    if (html !== undefined && !html.trim()) problems.push(`pages/${p.page_id}.html is empty.`);
    if (html !== undefined && html.length > MOCKUP_PAGE_MAX) problems.push(`pages/${p.page_id}.html holds ${html.length} characters; a mockup page holds at most ${MOCKUP_PAGE_MAX}.`);
    if (notes !== undefined && notes.length > PAGE_NOTES_MAX) problems.push(`pages/${p.page_id}.notes.md holds ${notes.length} characters; a page's notes hold at most ${PAGE_NOTES_MAX}.`);
    if (html !== undefined && p.entry !== undefined) problems.push(`Page ${p.page_id} has both pages/${p.page_id}.html and an entry in manifest.json; a page has one.`);
    return { ...p, ...(html !== undefined ? { html } : {}), ...(notes !== undefined ? { notes } : {}) };
  });
  const brief = text.get("brief.md");
  if (brief !== undefined && brief.length > BRIEF_MAX) problems.push(`brief.md holds ${brief.length} characters; a brief holds at most ${BRIEF_MAX}.`);
  if (problems.length) throw invalid("invalid_upload", `Nothing was published: ${problems.join(" ")}`, { problems });
  const files = listedFiles ? manifest.files!.map((f) => ({ path: f.path, ...(text.has(`files/${f.path}`) ? { content: text.get(`files/${f.path}`)! } : {}) })) : carried.length ? carried.sort((a, b) => (a.path < b.path ? -1 : 1)) : undefined;
  return {
    upload_id: uploadId,
    ...(manifest.title !== undefined ? { title: manifest.title } : {}),
    ...(manifest.summary !== undefined ? { summary: manifest.summary } : {}),
    ...(manifest.columns !== undefined ? { columns: manifest.columns } : {}),
    ...(brief !== undefined ? { brief } : {}),
    pages,
    ...(files ? { files } : {}),
    ...(listedProto || proto.length ? { prototype: { listed: listedProto, files: proto } } : {}),
  };
}

/** An upload publish may read: in this product, its bytes arrived, and not read before. */
async function usableUpload(ctx: OpContext, uploadId: string, lock = false) {
  let q = ctx.db.selectFrom("mockup_uploads").selectAll().where("product_id", "=", productId(ctx)).where("upload_id", "=", uploadId);
  if (lock) q = q.forUpdate();
  const u = await q.executeTakeFirst();
  if (!u) throw notFound(`There is no mockup upload ${uploadId} in this product. Request one with mockups(action="request_upload").`);
  if (u.used_at) throw conflict("upload_used", `Upload ${uploadId} was already published. Request a new upload for another version.`);
  if (!u.uploaded_at) throw notFound(`No bytes have arrived for upload ${uploadId} yet. PUT the ZIP to the grant's url first.`);
  return u;
}

/** Where an upload's new prototype bytes are stored: by the upload and their hash, never by their path. */
export function stagedPrototypeKey(tenant: string, product: string, uploadId: string, sha256: string) {
  return `t/${tenant}/p/${product}/mockup-prototypes/${uploadId}/${sha256}`;
}

/** The keys an upload's prototype bytes were or would be stored under: what the worker removes with an upload nobody published. */
export function stagedPrototypeKeys(tenant: string, product: string, uploadId: string, zip: Uint8Array): string[] {
  let entries: ReturnType<typeof zipEntries>;
  try {
    entries = zipEntries(zip, (name) => /(^|\/)prototype\//.test(name) && !ZIP_LITTER(name), MOCKUP_UPLOAD_UNPACKED_MAX, MOCKUP_UPLOAD_MAX_ENTRIES);
  } catch {
    return [];
  }
  return [...new Set(entries.map((e) => stagedPrototypeKey(tenant, product, uploadId, sha256Hex(e.data))))];
}

/** Store a blob unless one is already there; a key named by its bytes' hash holds the same bytes either way. */
async function putOnce(blobs: BlobStore, key: string, data: Uint8Array, contentType: string) {
  if (await blobs.stat(key)) return;
  try {
    await blobs.put(key, data, { contentType });
  } catch (e) {
    if (!(await blobs.stat(key))) throw e;
  }
}

/** What prepare hands publish: the canvas, and its prototype's files stored, with what publish should say about them. */
interface PreparedCanvas extends Omit<CanvasUpload, "prototype"> {
  prototype?: { listed: PrototypeUpload["listed"]; stored: ProtoRow[]; warnings: string[] };
}

/**
 * Read an upload's ZIP before the transaction, so a large one holds no database connection, and
 * store its prototype's bytes: a file whose hash the base version holds takes that file's blob, so
 * a version that changes one file stores one file.
 */
async function prepareCanvas(
  ctx: PrepareContext,
  input: { upload_id?: string | undefined; pages?: unknown; files?: unknown; mockup_id?: string | undefined; from_version?: number | undefined },
): Promise<PreparedCanvas | null> {
  if (!input.upload_id) return null;
  const both = (["pages", "files"] as const).filter((k) => input[k] !== undefined);
  if (both.length) throw invalid("invalid_input", `Nothing was published: the upload carries the canvas's pages and files; send ${both.join(" and ")} in the ZIP or in the call, not both.`);
  const u = await ctx.read((c) => usableUpload(c, input.upload_id!));
  const canvas = readCanvasZip(u.upload_id, await ctx.ports.blobs.get(u.blob_key));
  const { prototype, ...rest } = canvas;
  if (!prototype) return rest;
  const typed = prototype.files.map((f) => ({ ...f, sha256: sha256Hex(f.data), media_type: prototypeMediaType(f.path, f.data) }));
  const warnings = prototypeWarnings(typed);
  // The base's blobs by hash, so bytes it already holds are not stored again.
  const known = new Map<string, string>();
  if (input.mockup_id) {
    const rows = await ctx.read(async (c) => {
      const m = await c.db.selectFrom("mockups").select(["mockup_id", "current_version_id"]).where("product_id", "=", productId(c)).where("mockup_id", "=", input.mockup_id!).executeTakeFirst();
      if (!m) return [];
      const v = input.from_version
        ? await c.db.selectFrom("mockup_versions").select("version_id").where("mockup_id", "=", m.mockup_id).where("n", "=", input.from_version).executeTakeFirst()
        : { version_id: m.current_version_id };
      return v ? prototypeFiles(c.db, v.version_id) : [];
    });
    for (const r of rows) known.set(r.sha256, r.blob_key);
  }
  const tenant = ctx.scope.tenant!.tenant_id;
  const product = ctx.scope.product!.product_id;
  const stored: ProtoRow[] = [];
  const pending = typed.map((f) => async () => {
    let key = known.get(f.sha256);
    if (!key) {
      key = stagedPrototypeKey(tenant, product, u.upload_id, f.sha256);
      await putOnce(ctx.ports.blobs, key, f.data, f.media_type);
    }
    stored.push({ path: f.path, size: f.data.length, sha256: f.sha256, media_type: f.media_type, blob_key: key });
  });
  // A few at a time: a prototype of two thousand files is two thousand writes.
  for (let i = 0; i < pending.length; i += 8) await Promise.all(pending.slice(i, i + 8).map((run) => run()));
  stored.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ...rest, prototype: { listed: prototype.listed, stored, warnings } };
}

type PageRow = { page_id: string; title: string; notes: string; width: number; height: number; html: string | null; entry: string | null; poster: string | null };
type FileRow = { path: string; content: string };

export const publishMockup = defineOperation({
  name: "mockups.publish",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Publish the next version of a mockup's canvas, or create a mockup with its first version. A later version keeps whatever you omit.",
  description:
    `Without mockup_id, creates a mockup: give a title, a brief and at least one page with a title and html. With mockup_id, publishes the next version: pass the mockup's etag, and send only what changes. pages, when given, is the whole canvas in order: a page you leave out is dropped from this version, and a page whose page_id was on the base version keeps its title, notes, size and html unless you send them, so a version that changes one page sends that page's html alone. The brief is Markdown: what the canvas explores, for whom, the questions it is meant to answer, and what each page tries; write it for the next agent as much as for people. Each page is one self-contained HTML document shown in a sandboxed frame of width × height CSS pixels (default ${DEFAULT_WIDTH} × ${DEFAULT_HEIGHT}; 390 wide for a phone; height at most 4000), with no network. ${PAGE_RULES_TEXT} ${SAFE_CHECK_TEXT} ${TALL_PAGES_TEXT} columns sets how many pages sit side by side before the canvas wraps; null keeps one row. files carries text files for collaborators to pull into their own projects (DESIGN.md, components, tokens), at most ${MAX_MOCKUP_FILES} and ${(MOCKUP_FILES_TOTAL / 1_000_000).toFixed(0)} million characters a version; WhatBuild never uses them to draw a page, so inline what a page needs. Like pages, files when given is the whole set: a path that was on the base keeps its content unless you send it, a path you leave out is dropped, a new path needs content, and [] drops them all; omit files to keep them. ${PROTOTYPE_TEXT} A version published without an upload keeps its base's prototype, and its pages may enter it. refs links the outcomes, sources and assumptions the canvas explores, and citations up to ${CITATION_MAX_COUNT} exact passages, {record_id, seq_start, seq_end, quote?}, frozen as snapshots. from_version: N starts from that earlier version instead of the current one. To keep page HTML out of the call, upload the canvas as a ZIP (request_upload) and pass upload_id: the ZIP gives pages, files and the brief, and the call gives the rest, and the result names from_upload with upload {upload_id, size, sha256}, the ZIP's own bytes as its PUT answered. At most ${MAX_MOCKUP_PAGES} pages, ${(MOCKUP_HTML_TOTAL / 1_000_000).toFixed(0)} million characters of HTML in all, and ${MAX_MOCKUPS} mockups in a product, archived ones included (list gives quota, used and limit).`,
  input: z.strictObject({
    mockup_id: id("mockup").optional().describe("Omit to create a mockup."),
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(2000).optional().describe("One or two sentences, shown in the list."),
    brief: z.string().max(BRIEF_MAX).optional().describe("Markdown: what this canvas explores and why."),
    columns: z.number().int().min(1).max(12).nullable().optional(),
    pages: z.array(pageInput).min(1).max(MAX_MOCKUP_PAGES).optional(),
    files: z.array(fileInput).max(MAX_MOCKUP_FILES).optional().describe("The files the version carries, in full: a path on the base keeps its content unless sent; a path left out is dropped. Omit to keep them."),
    refs: refsInput.describe("The outcomes, sources and assumptions this canvas explores, in full. Omit on a later version to keep them."),
    citations: z.array(citationInput).max(CITATION_MAX_COUNT).optional(),
    from_version: z.number().int().min(1).optional(),
    upload_id: id("mockup upload").optional().describe('A canvas uploaded as a ZIP (mockups(action="request_upload")): its pages, files, brief, title, summary and columns, in place of sending them here.'),
    expected_etag: expectedEtag.optional(),
  }),
  rest: { method: "POST", path: "/mockups" },
  mcp: { tool: "mockups", action: "publish" },
  prepare: prepareCanvas,
  async handler(ctx, call, canvas) {
    const pid = productId(ctx);
    let upload: { upload_id: string; size: number | null; sha256: string | null } | null = null;
    if (canvas) {
      if (call.brief !== undefined && canvas.brief !== undefined) throw invalid("invalid_input", "Nothing was published: the upload has a brief.md and the call a brief; send the brief in one of them.");
      const u = await usableUpload(ctx, canvas.upload_id, true);
      // The ZIP's own bytes, as the PUT answered them, so an agent can tell which ZIP was published.
      upload = { upload_id: u.upload_id, size: u.size === null ? null : Number(u.size), sha256: u.sha256 };
    }
    // What the call omits, the upload gives; what both omit carries forward.
    const input = canvas
      ? {
          ...call,
          title: call.title ?? canvas.title,
          summary: call.summary ?? canvas.summary,
          columns: call.columns !== undefined ? call.columns : canvas.columns,
          brief: call.brief ?? canvas.brief,
          pages: canvas.pages,
          files: canvas.files,
        }
      : call;
    const existing = input.mockup_id ? await loadMockup(ctx, input.mockup_id, true) : null;
    let base: { n: number; version_id: string; title: string; summary: string; brief: string; columns: number | null; refs: typeof EMPTY_REFS; citations: unknown[]; pages: PageRow[]; files: FileRow[]; prototype: ProtoRow[] } | null = null;
    if (existing) {
      if (existing.archived_at) throw conflict("mockup_archived", "This mockup is archived; restore it before publishing.");
      if (!input.expected_etag) throw conflict("stale_etag", "This mockup exists; read it with get and pass its etag.", { current_etag: existing.etag });
      checkEtag(input.expected_etag, existing.etag, "mockup");
      const vid = input.from_version ? await versionIdOf(ctx, existing.mockup_id, input.from_version) : existing.current_version_id;
      const v = await ctx.db.selectFrom("mockup_versions").selectAll().where("version_id", "=", vid).executeTakeFirstOrThrow();
      const pages = await ctx.db.selectFrom("mockup_pages").select(["page_id", "title", "notes", "width", "height", "html", "entry", "poster"]).where("version_id", "=", vid).orderBy("position").execute();
      const files = await ctx.db.selectFrom("mockup_files").select(["path", "content"]).where("version_id", "=", vid).orderBy(sql`path collate "C"`).execute();
      base = { ...v, pages, files, prototype: await prototypeFiles(ctx.db, vid) };
    } else {
      if (input.expected_etag) throw conflict("stale_etag", "Omit expected_etag when creating a mockup.");
      if (input.from_version) throw invalid("invalid_input", "from_version needs a mockup_id.");
      if (!input.title) throw invalid("invalid_input", "A new mockup needs a title.");
      if (!input.pages) throw invalid("invalid_input", "A new mockup needs at least one page.");
      const count = await ctx.db
        .selectFrom("mockups")
        .select((eb) => [eb.fn.countAll<number>().as("n"), eb.fn.count<number>("archived_at").as("archived")])
        .where("product_id", "=", pid)
        .executeTakeFirst();
      const used = Number(count?.n ?? 0);
      if (used >= MAX_MOCKUPS) {
        const archived = Number(count?.archived ?? 0);
        throw conflict(
          "quota_exceeded",
          `Nothing was published: a product holds at most ${MAX_MOCKUPS} mockups, archived ones included, and this one holds ${used}${archived ? ` (${archived} archived)` : ""}. Publish a new version of one of them instead, or ask the person whether to delete one they no longer need (mockups list with include_archived shows them all).`,
          { quota: "mockups", ...mockupQuota(used), archived },
        );
      }
    }

    const problems: string[] = [];
    const pages: PageRow[] = input.pages
      ? input.pages.map((p, i) => {
          const was = base?.pages.find((b) => b.page_id === p.page_id);
          const title = p.title ?? was?.title;
          if (p.html !== undefined && p.entry !== undefined) problems.push(`Page ${i + 1} (${p.page_id}) gives both html and entry; a page has its own HTML or enters the prototype.`);
          // Sending one of html and entry makes the page that kind; sending neither keeps the base's.
          const html = p.html ?? (p.entry === undefined ? (was?.html ?? null) : null);
          const entry = p.entry ?? (p.html === undefined ? (was?.entry ?? null) : null);
          const poster = entry === null ? null : p.poster !== undefined ? p.poster : (was?.poster ?? null);
          if (!title) problems.push(`Page ${i + 1} (${p.page_id}) is new and needs a title.`);
          if (!html && !entry) problems.push(`Page ${i + 1} (${p.page_id}) is new and needs html or an entry.`);
          return { page_id: p.page_id, title: title ?? "", notes: p.notes ?? was?.notes ?? "", width: p.width ?? was?.width ?? DEFAULT_WIDTH, height: p.height ?? was?.height ?? DEFAULT_HEIGHT, html: entry ? null : (html ?? ""), entry, poster };
        })
      : base!.pages;
    const dup = pages.map((p) => p.page_id).find((x, i, all) => all.indexOf(x) !== i);
    if (dup) problems.push(`Page "${dup}" appears more than once.`);
    const files: FileRow[] = input.files
      ? input.files.map((x) => {
          const content = x.content ?? base?.files.find((b) => b.path === x.path)?.content;
          if (content === undefined) problems.push(`File ${x.path} is new and needs content.`);
          return { path: x.path, content: content ?? "" };
        })
      : (base?.files ?? []);
    // Paths that differ only in case would overwrite each other when the download is unzipped.
    const same = files.map((x) => x.path.toLowerCase()).find((x, i, all) => all.indexOf(x) !== i);
    if (same) problems.push(`File ${same} appears more than once, perhaps with different capitals.`);
    const fileChars = files.reduce((n, x) => n + x.content.length, 0);
    if (fileChars > MOCKUP_FILES_TOTAL) problems.push(`The files total ${fileChars} characters; a version holds at most ${MOCKUP_FILES_TOTAL}.`);
    // The prototype: the upload's when it gives one (a listed path it leaves out keeping the base's
    // bytes), otherwise the base's, carried forward.
    let prototype: ProtoRow[] = base?.prototype ?? [];
    if (canvas?.prototype) {
      const { listed, stored } = canvas.prototype;
      if (listed) {
        prototype = listed.flatMap((item) => {
          const got = stored.find((r) => r.path === item.path);
          if (got) return [got];
          const kept = base?.prototype.find((r) => r.path === item.path);
          if (!kept) {
            problems.push(`manifest.json's prototype lists ${item.path}, which is neither under prototype/ nor in the base version.`);
            return [];
          }
          if (item.sha256 && item.sha256 !== kept.sha256) problems.push(`manifest.json's prototype gives ${item.path} a sha256 the base version's file does not have.`);
          return [kept];
        });
      } else prototype = stored;
    }
    const protoBytes = prototype.reduce((n, r) => n + r.size, 0);
    if (protoBytes > PROTOTYPE_MAX_BYTES) problems.push(`The prototype holds ${protoBytes} bytes; at most ${PROTOTYPE_MAX_BYTES}.`);
    const byPath = new Map(prototype.map((r) => [r.path, r]));
    pages.forEach((pg, i) => {
      if (!pg.entry) return;
      const where = `Page ${i + 1} (${pg.page_id})`;
      const split = splitEntry(pg.entry);
      if ("problem" in split) problems.push(`${where}'s entry ${pg.entry}: ${split.problem}.`);
      else if (!prototype.length) problems.push(`${where} enters the prototype, and this version carries none: upload one under prototype/ in the canvas ZIP.`);
      else if (!byPath.has(split.path)) problems.push(`${where}'s entry names ${split.path}, which the prototype does not hold.`);
      else if (!isPrototypeHtml(byPath.get(split.path)!.media_type)) problems.push(`${where}'s entry names ${split.path}, which is not an HTML document (.html or .htm).`);
      if (pg.poster) {
        const named = prototypePath(pg.poster);
        const poster = "path" in named ? byPath.get(named.path) : undefined;
        if (!poster) problems.push(`${where}'s poster names ${pg.poster}, which the prototype does not hold.`);
        else if (!isPrototypeImage(poster.media_type)) problems.push(`${where}'s poster ${pg.poster} is not a PNG, JPEG, GIF, WebP or AVIF image.`);
        else if (poster.size > PROTOTYPE_POSTER_MAX_BYTES) problems.push(`${where}'s poster ${pg.poster} is ${poster.size} bytes; a poster is at most ${PROTOTYPE_POSTER_MAX_BYTES}.`);
      }
    });
    if (problems.length) throw invalid("invalid_input", `Nothing was published: ${problems.join(" ")}`, { problems });
    if (canvas?.prototype) {
      // Distinct bytes across the product's mockups: a blob two versions share counts once.
      const held = await ctx.db
        .selectFrom("mockup_prototype_files")
        .select(["blob_key", "size"])
        .distinctOn("blob_key")
        .where("product_id", "=", pid)
        .execute();
      const heldKeys = new Set(held.map((r) => r.blob_key));
      const fresh = new Map(prototype.filter((r) => !heldKeys.has(r.blob_key)).map((r) => [r.blob_key, r.size]));
      const used = held.reduce((n, r) => n + r.size, 0) + [...fresh.values()].reduce((n, x) => n + x, 0);
      if (used > PROTOTYPE_PRODUCT_MAX_BYTES)
        throw conflict(
          "quota_exceeded",
          `Nothing was published: a product's mockups hold at most ${PROTOTYPE_PRODUCT_MAX_BYTES} bytes of prototypes, each distinct file counted once, and this version would bring them to ${used}. Delete a mockup that is no longer needed, or publish a smaller prototype.`,
          { quota: "prototype_bytes", used, limit: PROTOTYPE_PRODUCT_MAX_BYTES, unit: "bytes" },
        );
    }
    // Only pages whose HTML changed need checking again; carried HTML passed when it was published.
    for (const p of input.pages ?? []) {
      if (p.html === undefined) continue;
      for (const msg of inspectMockupHtml(p.html)) problems.push(`${p.page_id}: ${msg}`);
    }
    const total = pages.reduce((n, p) => n + (p.html?.length ?? 0), 0);
    if (total > MOCKUP_HTML_TOTAL) problems.push(`The pages total ${total} characters of HTML; a version holds at most ${MOCKUP_HTML_TOTAL}.`);
    if (problems.length) throw invalid("invalid_html", `Nothing was published: ${problems.join(" ")}`, { problems });

    const title = input.title ?? base!.title;
    const summary = input.summary ?? base?.summary ?? "";
    const brief = input.brief ?? base?.brief ?? "";
    const columns = input.columns !== undefined ? input.columns : (base?.columns ?? null);
    const refs = input.refs ? await validateRefs(ctx, { ...input.refs }) : (base?.refs ?? EMPTY_REFS);
    const citations = input.citations ? await snapshotAll(ctx, input.citations, "mockup version") : ((base?.citations ?? []) as Awaited<ReturnType<typeof snapshotAll>>);

    const mockup_id = existing?.mockup_id ?? newId();
    const version_id = newId();
    const n = (existing?.version_count ?? 0) + 1;
    if (!existing) {
      await ctx.db
        .insertInto("mockups")
        .values({ mockup_id, tenant_id: tenantId(ctx), product_id: pid, title, summary, current_version_id: version_id, version_count: 1, etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor) })
        .execute();
    }
    await ctx.db
      .insertInto("mockup_versions")
      .values({ version_id, tenant_id: tenantId(ctx), product_id: pid, mockup_id, n, title, summary, brief, columns, refs: json(refs), citations: json(citations), previous_version_id: existing?.current_version_id ?? null, created_by: json(ctx.actor) })
      .execute();
    await ctx.db
      .insertInto("mockup_pages")
      .values(pages.map((p, position) => ({ version_id, tenant_id: tenantId(ctx), product_id: pid, position, ...p })))
      .execute();
    if (files.length) await ctx.db.insertInto("mockup_files").values(files.map((x) => ({ version_id, tenant_id: tenantId(ctx), product_id: pid, ...x }))).execute();
    for (let i = 0; i < prototype.length; i += 500)
      await ctx.db.insertInto("mockup_prototype_files").values(prototype.slice(i, i + 500).map((r) => ({ version_id, tenant_id: tenantId(ctx), product_id: pid, ...r }))).execute();
    if (existing) {
      await ctx.db
        .updateTable("mockups")
        .set({ title, summary, current_version_id: version_id, version_count: n, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
        .where("mockup_id", "=", mockup_id)
        .execute();
    }
    await recordActivity(ctx, {
      action: existing ? "updated" : "created",
      entity_type: "mockup",
      entity_id: mockup_id,
      entity_title: title,
      summary: `${existing ? `Published version ${n}${input.from_version ? ` from version ${input.from_version}` : ""} with` : "Created the mockup with"} ${listed([
        `${pages.length} page${pages.length === 1 ? "" : "s"}`,
        ...(files.length ? [`${files.length} file${files.length === 1 ? "" : "s"}`] : []),
        ...(prototype.length ? [`a prototype of ${prototype.length} file${prototype.length === 1 ? "" : "s"}`] : []),
      ])}`,
    });
    if (canvas) {
      const u = await ctx.db
        .updateTable("mockup_uploads")
        .set({ used_at: ctx.now, used_by_version_id: version_id })
        .where("upload_id", "=", canvas.upload_id)
        .returning("blob_key")
        .executeTakeFirstOrThrow();
      // The ZIP has done its work: its pages and files are in the version now.
      await ctx.enqueue("delete_blobs", { keys: [u.blob_key], prefixes: [] });
    }
    const e = await loadMockup(ctx, mockup_id);
    return {
      ...summaryView(e),
      current: await versionView(ctx, e.current_version_id, false),
      based_on_version: base?.n ?? null,
      ...(upload ? { from_upload: upload.upload_id, upload } : {}),
      ...(canvas?.prototype ? { prototype_warnings: canvas.prototype.warnings } : {}),
    };
  },
});

export const archiveMockup = defineOperation({
  name: "mockups.archive",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Archive a mockup: out of the list, every version kept and readable by id.",
  description: "Pass the mockup's etag. Restore brings it back.",
  input: z.strictObject({ mockup_id: id("mockup"), expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/mockups/:mockup_id/archive" },
  mcp: { tool: "mockups", action: "archive" },
  async handler(ctx, input) {
    const e = await loadMockup(ctx, input.mockup_id, true);
    checkEtag(input.expected_etag, e.etag, "mockup");
    if (e.archived_at) return summaryView(e);
    await ctx.db.updateTable("mockups").set({ archived_at: ctx.now, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("mockup_id", "=", e.mockup_id).execute();
    await recordActivity(ctx, { action: "archived", entity_type: "mockup", entity_id: e.mockup_id, entity_title: e.title, summary: "Archived the mockup" });
    return summaryView(await loadMockup(ctx, e.mockup_id));
  },
});

export const restoreMockup = defineOperation({
  name: "mockups.restore",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Restore an archived mockup.",
  description: "Pass the mockup's etag.",
  input: z.strictObject({ mockup_id: id("mockup"), expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/mockups/:mockup_id/restore" },
  mcp: { tool: "mockups", action: "restore" },
  async handler(ctx, input) {
    const e = await loadMockup(ctx, input.mockup_id, true);
    checkEtag(input.expected_etag, e.etag, "mockup");
    if (!e.archived_at) return summaryView(e);
    await ctx.db.updateTable("mockups").set({ archived_at: null, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("mockup_id", "=", e.mockup_id).execute();
    await recordActivity(ctx, { action: "restored", entity_type: "mockup", entity_id: e.mockup_id, entity_title: e.title, summary: "Restored the mockup" });
    return summaryView(await loadMockup(ctx, e.mockup_id));
  },
});

export const getMockupDownload = defineOperation({
  name: "mockups.get_download",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Get a short-lived grant to download one version of a mockup as a ZIP: the brief, each page's HTML and notes, its files, its prototype, and a manifest.",
  description:
    "Use it to carry a canvas into the project where you build the next version: GET url with the headers, unzip, change the pages, and publish the next version with the pages that changed. The ZIP holds brief.md, manifest.json (format version 2: the version, the pages in order with their titles, sizes and notes and each page's html file or entry and poster, the files, the prototype's files with their size, sha256 and type, the refs and citations), pages/<page_id>.html with pages/<page_id>.notes.md, each file the version carries under files/ at its path, ready to copy into your project, and each prototype file under prototype/, byte for byte. The ZIP uploads again as it is (request_upload), and a prototype file whose bytes are unchanged is not stored again. version defaults to the current one. Keep the grant header out of reports and logs.",
  input: z.strictObject({ mockup_id: id("mockup"), version: z.number().int().min(1).optional() }),
  rest: { method: "POST", path: "/mockups/:mockup_id/downloads" },
  mcp: { tool: "mockups", action: "get_download" },
  async handler(ctx, input) {
    const e = await loadMockup(ctx, input.mockup_id);
    const vid = input.version ? await versionIdOf(ctx, e.mockup_id, input.version) : e.current_version_id;
    const n = input.version ?? e.version_count;
    const expiresAt = new Date(Date.parse(ctx.now) + ctx.ports.config.grantTtlSeconds * 1000);
    const token = ctx.ports.grants.sign({ v: 1, purpose: "mockup", t: tenantId(ctx), xv: vid, exp: Math.floor(expiresAt.getTime() / 1000) });
    return {
      mockup_id: e.mockup_id,
      version: n,
      method: "GET",
      url: `${ctx.ports.config.publicBaseUrl}/api/v1/downloads/mockup/${vid}`,
      headers: { [DOWNLOAD_GRANT_HEADER]: token },
      expires_at: expiresAt.toISOString(),
      media_type: "application/zip",
    };
  },
});

export const checkMockupCitations = defineOperation({
  name: "mockups.check_citations",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Re-resolve a mockup version's citations against the sources as they are now. Reports drift; never rewrites.",
  description:
    "Checks the current version unless version is given, with the statuses story(action=\"check_citations\") reports: ok, relocated (with the new range), text_changed, record_archived, record_deleted or record_missing, plus version_drift when the source's primary file has a newer version than the snapshot's. valid is true when every citation is ok against the passages of each source's current file; rederived says a source was parsed again since a snapshot, so read those passages before relying on an ok.",
  input: z.strictObject({ mockup_id: id("mockup"), version: z.number().int().min(1).optional() }),
  rest: { method: "GET", path: "/mockups/:mockup_id/check-citations" },
  mcp: { tool: "mockups", action: "check_citations" },
  async handler(ctx, input) {
    const m = await loadMockup(ctx, input.mockup_id);
    const vid = input.version ? await versionIdOf(ctx, m.mockup_id, input.version) : m.current_version_id;
    const v = await ctx.db.selectFrom("mockup_versions").select(["n", "citations"]).where("version_id", "=", vid).executeTakeFirstOrThrow();
    return { mockup_id: m.mockup_id, version: v.n, checked_at: ctx.now, ...(await checkCitationList(ctx, v.citations)) };
  },
});

/** What deleting a mockup destroys, and the Story pages that show it. */
async function mockupDeletion(ctx: OpContext, e: Awaited<ReturnType<typeof loadMockup>>) {
  const showing = await storyPagesShowing(ctx, e.mockup_id);
  const earlier = await ctx.db
    .selectFrom("story_versions as v")
    .innerJoin("story_pages as p", (j) => j.onRef("p.product_id", "=", "v.product_id").onRef("p.page_id", "=", "v.page_id"))
    .select(["v.page_id", "p.title", "v.n"])
    .where("v.product_id", "=", productId(ctx))
    .where(sql<boolean>`v.mockup->>'mockup_id' = ${e.mockup_id}`)
    .whereRef("v.version_id", "!=", "p.current_version_id")
    .orderBy("p.title")
    .orderBy("v.n", "desc")
    .execute();
  const pages = await ctx.db
    .selectFrom("mockup_pages as p")
    .innerJoin("mockup_versions as v", "v.version_id", "p.version_id")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("v.mockup_id", "=", e.mockup_id)
    .executeTakeFirst();
  const blobs = await prototypeBlobsOf(ctx.db, e.mockup_id);
  return {
    mockup_id: e.mockup_id,
    title: e.title,
    etag: e.etag,
    archived: Boolean(e.archived_at),
    version_count: e.version_count,
    page_versions: Number(pages?.n ?? 0),
    prototype_files: blobs.length,
    prototype_bytes: blobs.reduce((n, b) => n + b.size, 0),
    story_pages_showing: showing.map((p) => ({ page_id: p.page_id, title: p.title, archived: Boolean(p.archived_at), mockup_page_id: p.mockup_page_id, version: p.version })),
    earlier_story_versions_showing: earlier.map((v) => ({ page_id: v.page_id, title: v.title, version: v.n })),
    after_delete: showing.length
      ? showing.length === 1
        ? "A Story page shows it. Delete that page, or publish it with HTML of its own, first."
        : `${showing.length} Story pages show it. Delete those pages, or publish them with HTML of their own, first.`
      : `Every version (${e.version_count}) goes, with its pages, notes, files, prototype and brief.` +
        (earlier.length ? ` ${earlier.length === 1 ? "An earlier Story page version shows it and will show" : `${earlier.length} earlier Story page versions show it and will show`} an empty page.` : ""),
    reversible_alternative: 'mockups(action="archive") takes it out of the list and keeps every version.',
  };
}

export const mockupDeleteImpact = defineOperation({
  name: "mockups.delete_impact",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Preview exactly what deleting a mockup would destroy, and the Story pages that show it.",
  description:
    "Read-only. Show the person this result before proposing a delete. A mockup can't be deleted while a Story page's current version shows it (story_pages_showing, archived pages included); earlier_story_versions_showing lists older versions that would show nothing. prototype_files and prototype_bytes count the distinct prototype files its versions hold, which go with it. Pass this result's etag as the delete's expected_etag.",
  input: z.strictObject({ mockup_id: id("mockup") }),
  rest: { method: "GET", path: "/mockups/:mockup_id/delete-impact" },
  mcp: { tool: "mockups", action: "delete_impact" },
  async handler(ctx, input) {
    return mockupDeletion(ctx, await loadMockup(ctx, input.mockup_id));
  },
});

export const deleteMockup = defineOperation({
  name: "mockups.delete",
  scope: "product",
  access: "admin",
  mutates: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Destroys a mockup with every version; archive is the reversible alternative.",
  description:
    'Archiving (mockups(action="archive")) is the reversible alternative and almost always what is wanted. Refused with 409 mockup_on_story while a Story page shows it. ' +
    DELETE_GUIDANCE +
    " Leaves a tombstone: reads return 410 with who, when and why.",
  input: z.strictObject({ mockup_id: id("mockup"), ...deleteGuards }),
  rest: { method: "DELETE", path: "/mockups/:mockup_id" },
  mcp: { tool: "mockups", action: "delete" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, 'archive it with mockups(action="archive")');
    const e = await loadMockup(ctx, input.mockup_id, true);
    checkEtag(input.expected_etag, e.etag, "mockup");
    const impact = await mockupDeletion(ctx, e);
    if (impact.story_pages_showing.length)
      throw conflict("mockup_on_story", `${impact.after_delete} Nothing was changed.`, {
        story_pages: impact.story_pages_showing,
      });
    const versions = (await ctx.db.selectFrom("mockup_versions").select("version_id").where("mockup_id", "=", e.mockup_id).execute()).map((v) => v.version_id);
    const blobs = (await prototypeBlobsOf(ctx.db, e.mockup_id)).map((b) => b.blob_key);
    await leaveTombstone(ctx, { object_type: "mockup", object_id: e.mockup_id, title: e.title, reason: input.reason });
    if (versions.length) {
      await ctx.db.deleteFrom("mockup_prototype_files").where("version_id", "in", versions).execute();
      await ctx.db.deleteFrom("mockup_files").where("version_id", "in", versions).execute();
      await ctx.db.deleteFrom("mockup_pages").where("version_id", "in", versions).execute();
      await ctx.db.deleteFrom("mockup_versions").where("version_id", "in", versions).execute();
    }
    await ctx.db.deleteFrom("mockups").where("mockup_id", "=", e.mockup_id).execute();
    // Its prototype's bytes belong to it alone (publish shares a blob only with the same mockup's
    // base); a sandbox's baseline keeps what it holds (blobsSafeToDelete).
    for (let i = 0; i < blobs.length; i += 500) await ctx.enqueue("delete_blobs", { keys: blobs.slice(i, i + 500), prefixes: [] });
    await recordActivity(ctx, { action: "deleted", entity_type: "mockup", entity_id: e.mockup_id, entity_title: e.title, summary: "Deleted the mockup permanently" });
    const { etag, reversible_alternative, ...rest } = impact;
    void etag;
    void reversible_alternative;
    return { deleted: true, ...rest, reason: input.reason };
  },
});

/** Items in a sentence: "a", "a and b", "a, b and c". */
function listed(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The distinct prototype blobs a mockup's versions hold. */
async function prototypeBlobsOf(db: Tx, mockupId: string) {
  return db
    .selectFrom("mockup_prototype_files as f")
    .innerJoin("mockup_versions as v", "v.version_id", "f.version_id")
    .select(["f.blob_key", "f.size"])
    .distinctOn("f.blob_key")
    .where("v.mockup_id", "=", mockupId)
    .execute();
}

export const mockupOps = [listMockups, getMockup, listMockupVersions, getMockupVersion, requestMockupUpload, publishMockup, archiveMockup, restoreMockup, getMockupDownload, checkMockupCitations, mockupDeleteImpact, deleteMockup];

/**
 * One version of a mockup as a ZIP, for the download grant's route: brief.md, manifest.json,
 * each page's HTML and notes, the files it carries under files/, and its prototype's files under
 * prototype/, byte for byte. Runs in the tenant's transaction.
 */
export async function mockupBundle(db: Tx, versionId: string, blobs: BlobStore) {
  const v = await db.selectFrom("mockup_versions").selectAll().where("version_id", "=", versionId).executeTakeFirst();
  if (!v) return null;
  const e = await db.selectFrom("mockups").select(["mockup_id", "title"]).where("mockup_id", "=", v.mockup_id).executeTakeFirstOrThrow();
  const pages = await db.selectFrom("mockup_pages").selectAll().where("version_id", "=", versionId).orderBy("position").execute();
  const carried = await db.selectFrom("mockup_files").select(["path", "content"]).where("version_id", "=", versionId).orderBy(sql`path collate "C"`).execute();
  const prototype = await prototypeFiles(db, versionId);
  const manifest = {
    format: "whatbuild-mockup",
    format_version: 2,
    mockup_id: e.mockup_id,
    title: v.title,
    summary: v.summary,
    version: v.n,
    columns: v.columns,
    published_at: v.created_at,
    published_by: v.created_by,
    pages: pages.map((p) =>
      p.html === null
        ? { page_id: p.page_id, title: p.title, width: p.width, height: p.height, entry: p.entry, poster: p.poster, notes: `pages/${p.page_id}.notes.md` }
        : { page_id: p.page_id, title: p.title, width: p.width, height: p.height, html: `pages/${p.page_id}.html`, notes: `pages/${p.page_id}.notes.md`, html_sha256: sha256Hex(p.html) },
    ),
    files: carried.map((x) => ({ path: x.path, file: `files/${x.path}`, chars: x.content.length, sha256: sha256Hex(x.content) })),
    ...(prototype.length ? { prototype: prototype.map((r) => ({ path: r.path, file: `prototype/${r.path}`, size: r.size, sha256: r.sha256, media_type: r.media_type })) } : {}),
    refs: { outcomes: v.refs.outcomes, sources: v.refs.sources, assumptions: v.refs.assumptions },
    citations: v.citations,
  };
  const files: Record<string, Uint8Array> = {
    "brief.md": strToU8(v.brief),
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2) + "\n"),
  };
  for (const p of pages) {
    if (p.html !== null) files[`pages/${p.page_id}.html`] = strToU8(p.html);
    files[`pages/${p.page_id}.notes.md`] = strToU8(p.notes);
  }
  for (const x of carried) files[`files/${x.path}`] = strToU8(x.content);
  for (const r of prototype) files[`prototype/${r.path}`] = await blobs.get(r.blob_key);
  const slug = e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "mockup";
  return { name: `${slug}-v${v.n}.zip`, bytes: zipSync(files) };
}
