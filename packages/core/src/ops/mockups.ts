import { sql } from "kysely";
import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import { checkEtag, EMPTY_REFS, productId, recordActivity, tenantId, validateRefs } from "../common.ts";
import { checkCitationList, CITATION_MAX_COUNT, citationInput, citationViews, snapshotAll } from "../citations.ts";
import { json, type Tx } from "../db.ts";
import { conflict, forbidden, gone, invalid, notFound, tooLarge } from "../errors.ts";
import { DOWNLOAD_GRANT_HEADER, UPLOAD_GRANT_HEADER } from "./files.ts";
import { checkVisitorInput, visitorBytesLimit } from "../public-sandbox.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { inspectStoryHtml, STORY_HTML_MAX } from "../story-html.ts";
import { newEtag, newId, sha256Hex } from "../util.ts";
import { readZip } from "../zip-archive.ts";
import { resolveRefs, storyPagesShowing } from "./story.ts";

/**
 * Mockups are where Exploration makes things: a canvas of HTML pages an agent built (screens,
 * flows, alternatives), each page with design notes, and a brief in Markdown that says what the
 * canvas explores and why. A version is the whole canvas; every publish makes the next one.
 */

export const MAX_MOCKUPS = 50;
export const MAX_MOCKUP_PAGES = 48;
export const MOCKUP_HTML_TOTAL = 8_000_000;
export const BRIEF_MAX = 50_000;
export const PAGE_NOTES_MAX = 10_000;
export const MAX_MOCKUP_FILES = 50;
export const MOCKUP_FILES_TOTAL = 2_000_000;
/** The largest ZIP a mockup upload takes. */
export const MOCKUP_ARCHIVE_MAX_BYTES = 20 * 1024 * 1024;
/** What an uploaded ZIP may hold once expanded: every page's HTML and notes, the brief, the manifest and the files, with room for folders and for text that is not ASCII. */
const ARCHIVE_LIMITS = { maxEntries: 2 * MAX_MOCKUP_PAGES + MAX_MOCKUP_FILES + 100, maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024 };
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

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
  html: z.string().min(1).max(STORY_HTML_MAX).optional().describe("The whole page, one self-contained document. Required for a new page; omit to keep the base version's."),
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
  if (!row) throw notFound(`There is no mockup ${mockupId} in this product.`);
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

/** A version of the canvas: the brief, the pages in order, the files it carries, and what it draws on. */
async function versionView(ctx: OpContext, versionId: string, withHtml: boolean, withFiles = false) {
  const v = await ctx.db.selectFrom("mockup_versions").selectAll().where("version_id", "=", versionId).where("product_id", "=", productId(ctx)).executeTakeFirstOrThrow();
  const pages = await ctx.db.selectFrom("mockup_pages").selectAll().where("version_id", "=", versionId).orderBy("position").execute();
  const files = await ctx.db.selectFrom("mockup_files").select(["path", "content"]).where("version_id", "=", versionId).orderBy(sql`path collate "C"`).execute();
  const resolved = await resolveRefs(ctx, v.refs);
  return {
    version_id: v.version_id,
    version: v.n,
    mockup_id: v.mockup_id,
    title: v.title,
    summary: v.summary,
    brief: v.brief,
    columns: v.columns,
    pages: pages.map((p) => ({
      page_id: p.page_id,
      title: p.title,
      notes: p.notes,
      width: p.width,
      height: p.height,
      html_sha256: sha256Hex(p.html),
      html_path: htmlPath(ctx, v.mockup_id, v.n, p.page_id),
      ...(withHtml ? { html: p.html } : { html_chars: p.html.length }),
    })),
    files: files.map((x) => ({ path: x.path, chars: x.content.length, sha256: sha256Hex(x.content), ...(withFiles ? { content: x.content } : {}) })),
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
  description: "Archived mockups are left out unless include_archived. page_count is the current version's.",
  input: z.strictObject({ include_archived: z.boolean().default(false) }),
  rest: { method: "GET", path: "/mockups" },
  mcp: { tool: "mockups", action: "list" },
  async handler(ctx, input) {
    let q = ctx.db
      .selectFrom("mockups as m")
      .selectAll("m")
      .select((eb) => eb.selectFrom("mockup_pages as p").whereRef("p.version_id", "=", "m.current_version_id").select(eb.fn.countAll<number>().as("n")).as("page_count"))
      .where("m.product_id", "=", productId(ctx));
    if (!input.include_archived) q = q.where("m.archived_at", "is", null);
    const rows = await q.orderBy("m.updated_at", "desc").execute();
    return { items: rows.map((r) => ({ ...summaryView(r), page_count: Number(r.page_count ?? 0) })) };
  },
});

export const getMockup = defineOperation({
  name: "mockups.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read a mockup's current version: its brief, its pages with their notes, what it draws on, the Story pages that show its pages, and the etag to publish again.",
  description:
    "Read this before publishing a new version, and read the brief first: it says what the canvas explores. Pages come without HTML unless include_html; each has html_path (a GET in the web app's session) and html_sha256. files lists what the version carries for collaborators (path, chars, sha256), with each file's content when include_files. To work on the canvas outside WhatBuild, get_download gives the whole version as a ZIP. story_pages lists the Story pages whose current version shows one of its pages (story promote_mockup), with the mockup version each shows.",
  input: z.strictObject({ mockup_id: id("mockup"), include_html: z.boolean().default(false), include_files: z.boolean().default(false).describe("Include each file's content.") }),
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

type PageRow = { page_id: string; title: string; notes: string; width: number; height: number; html: string };
type FileRow = { path: string; content: string };
type PageInput = z.infer<typeof pageInput>;
type FileInput = z.infer<typeof fileInput>;

export const requestMockupUpload = defineOperation({
  name: "mockups.request_upload",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Get a short-lived grant to PUT a mockup version as a ZIP, so its pages and files never pass through a tool call.",
  description:
    `For a canvas you have on disk, above all one you downloaded with get_download and changed. Zip it in get_download's layout (manifest.json, brief.md, pages/<page_id>.html, pages/<page_id>.notes.md, files/<path>), PUT the ZIP's bytes to url with exactly these headers (curl -T canvas.zip -H …), then call publish with upload_id and the mockup's etag. Pass mockup_id for the mockup you will publish to, or omit it to create a mockup from the upload. The grant is yours alone, for this product and that mockup, expires at expires_at, and publishes one version. The ZIP is at most max_bytes. Keep the grant header out of reports and logs.`,
  input: z.strictObject({
    mockup_id: id("mockup").optional().describe("The mockup the upload will publish to. Omit to create a mockup with it."),
    size: z.number().int().min(0).optional().describe("The ZIP's size in bytes, when known, so an oversized archive is refused before it transfers."),
  }),
  rest: { method: "POST", path: "/mockups/uploads" },
  mcp: { tool: "mockups", action: "request_upload" },
  async handler(ctx, input) {
    if (input.mockup_id) {
      const e = await loadMockup(ctx, input.mockup_id);
      if (e.archived_at) throw conflict("mockup_archived", "This mockup is archived; restore it before publishing.");
    }
    const cfg = ctx.ports.config;
    const ceiling = Math.min(MOCKUP_ARCHIVE_MAX_BYTES, cfg.relayMaxBytes);
    // A visitor to a public sandbox uploads within the same allowances as a source's files.
    const maxBytes = ctx.sandbox?.visitor ? await visitorBytesLimit(ctx.db, ctx.sandbox, ctx.principal.account_id, input.size, ceiling) : ceiling;
    if (input.size !== undefined && input.size > maxBytes) throw tooLarge(`The archive is ${input.size} bytes; a mockup's archive is at most ${maxBytes}.`, { limit: maxBytes });
    const upload_id = newId();
    const expiresAt = new Date(Date.parse(ctx.now) + cfg.grantTtlSeconds * 1000);
    await ctx.db
      .insertInto("mockup_uploads")
      .values({
        upload_id, tenant_id: tenantId(ctx), product_id: productId(ctx), mockup_id: input.mockup_id ?? null, principal: json(ctx.actor),
        max_bytes: maxBytes, blob_key: `t/${tenantId(ctx)}/mockup-uploads/${upload_id}`, expires_at: expiresAt.toISOString(),
      })
      .execute();
    const token = ctx.ports.grants.sign({ v: 1, purpose: "mockup_upload", u: upload_id, t: tenantId(ctx), exp: Math.floor(expiresAt.getTime() / 1000) });
    return {
      upload_id,
      mockup_id: input.mockup_id ?? null,
      method: "PUT" as const,
      url: `${cfg.publicBaseUrl}/api/v1/uploads/mockup/${upload_id}`,
      headers: { [UPLOAD_GRANT_HEADER]: token, "Content-Type": "application/zip" },
      max_bytes: maxBytes,
      expires_at: expiresAt.toISOString(),
      next: `PUT the ZIP's raw bytes to url with exactly these headers (one request, no multipart), then call mockups(action="publish") with upload_id${input.mockup_id ? ", mockup_id and the mockup's etag" : ""}. Keep the grant header out of reports and logs.`,
    };
  },
});

/** An uploaded ZIP's manifest: get_download's, so a downloaded version goes back up unchanged. What publishing does not read is accepted and ignored. */
const archiveManifest = z.strictObject({
  format: z.literal("whatbuild-mockup").optional(),
  format_version: z.literal(1).optional(),
  mockup_id: z.string().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().max(2000).optional(),
  version: z.number().optional(),
  columns: z.number().int().min(1).max(12).nullable().optional(),
  published_at: z.unknown().optional(),
  published_by: z.unknown().optional(),
  pages: z
    .array(
      z.strictObject({
        page_id: pageSlug,
        title: pageInput.shape.title,
        width: pageInput.shape.width,
        height: pageInput.shape.height,
        html: z.string().optional(),
        notes: z.string().optional(),
        html_sha256: z.string().optional(),
      }),
    )
    .min(1)
    .max(MAX_MOCKUP_PAGES),
  files: z.array(z.strictObject({ path: filePath, file: z.string().optional(), chars: z.number().optional(), sha256: z.string().optional() })).max(MAX_MOCKUP_FILES).optional(),
  refs: z.unknown().optional(),
  citations: z.unknown().optional(),
});

const badArchive = (problems: string[]) => invalid("invalid_archive", `Nothing was published: ${problems.join(" ")}`, { problems });

/**
 * Read an uploaded canvas into what an inline publish would have sent: every page the manifest
 * lists, in order, with the HTML and notes the archive holds for it (a page without them keeps the
 * base version's), the files likewise, and the brief. Anything the manifest does not name is refused.
 */
export function readCanvasArchive(bytes: Uint8Array) {
  const zip = readZip(bytes, ARCHIVE_LIMITS);
  if (!zip.entries) throw badArchive(zip.problems);
  let entries = zip.entries;
  // A folder zipped whole puts everything under its name: read inside it.
  if (!entries.some((e) => e.name === "manifest.json")) {
    const top = entries[0]?.name.split("/")[0];
    if (top && entries.every((e) => e.name.startsWith(`${top}/`)) && entries.some((e) => e.name === `${top}/manifest.json`))
      entries = entries.map((e) => ({ name: e.name.slice(top.length + 1), bytes: e.bytes }));
  }
  const problems: string[] = [];
  const text = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const e of entries) {
    try {
      text.set(e.name, decoder.decode(e.bytes));
    } catch {
      problems.push(`${e.name} is not UTF-8 text.`);
    }
  }
  const raw = text.get("manifest.json");
  if (raw === undefined) throw badArchive(["The archive has no manifest.json at its top. Zip the folder get_download gave you, manifest.json included."]);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw badArchive(["manifest.json is not valid JSON."]);
  }
  const parsed = archiveManifest.safeParse(json);
  if (!parsed.success) throw badArchive(parsed.error.issues.map((i) => `manifest.json${i.path.map((k) => (typeof k === "number" ? `[${k}]` : `.${String(k)}`)).join("")}: ${i.message}.`));
  const m = parsed.data;

  const named = new Set(["manifest.json", "brief.md"]);
  const expect = (given: string | undefined, want: string, what: string) => {
    named.add(want);
    if (given !== undefined && given !== want) problems.push(`manifest.json names ${given} for ${what}; it must be ${want}.`);
  };
  const pages: PageInput[] = m.pages.map((p) => {
    expect(p.html, `pages/${p.page_id}.html`, `page ${p.page_id}'s HTML`);
    expect(p.notes, `pages/${p.page_id}.notes.md`, `page ${p.page_id}'s notes`);
    const html = text.get(`pages/${p.page_id}.html`);
    const notes = text.get(`pages/${p.page_id}.notes.md`);
    if (html !== undefined && !html.length) problems.push(`pages/${p.page_id}.html is empty.`);
    if (html && html.length > STORY_HTML_MAX) problems.push(`pages/${p.page_id}.html holds ${html.length} characters; a page holds at most ${STORY_HTML_MAX}.`);
    if (notes && notes.length > PAGE_NOTES_MAX) problems.push(`pages/${p.page_id}.notes.md holds ${notes.length} characters; a page's notes hold at most ${PAGE_NOTES_MAX}.`);
    return {
      page_id: p.page_id,
      ...(p.title !== undefined ? { title: p.title } : {}),
      ...(p.width !== undefined ? { width: p.width } : {}),
      ...(p.height !== undefined ? { height: p.height } : {}),
      ...(html ? { html } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
  });
  const files: FileInput[] | undefined = m.files?.map((f) => {
    expect(f.file, `files/${f.path}`, `file ${f.path}`);
    const content = text.get(`files/${f.path}`);
    return { path: f.path, ...(content !== undefined ? { content } : {}) };
  });
  const brief = text.get("brief.md");
  if (brief && brief.length > BRIEF_MAX) problems.push(`brief.md holds ${brief.length} characters; a brief holds at most ${BRIEF_MAX}.`);
  const extra = entries.map((e) => e.name).filter((n) => !named.has(n));
  if (extra.length)
    problems.push(`The archive holds ${extra.length === 1 ? "an entry" : `${extra.length} entries`} manifest.json does not name: ${extra.slice(0, 10).join(", ")}${extra.length > 10 ? ", …" : ""}. List each page in manifest.json's pages and each file in its files, or leave the entry out.`);
  if (problems.length) throw badArchive(problems);
  return {
    mockup_id: m.mockup_id,
    title: m.title,
    summary: m.summary,
    columns: m.columns,
    brief,
    pages,
    files,
  };
}

/** The upload a publish names, locked, after every check that it is this caller's to use here and now. */
async function takeUpload(ctx: OpContext, uploadId: string, mockupId: string | undefined) {
  const u = await ctx.db.selectFrom("mockup_uploads").selectAll().where("upload_id", "=", uploadId).where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
  if (!u) throw notFound(`There is no mockup upload ${uploadId} in this product. Request one with mockups(action="request_upload").`);
  if (u.principal.account_id !== ctx.principal.account_id) throw forbidden("This upload was granted to someone else. Request your own with mockups(action=\"request_upload\").");
  if (u.used_at) throw gone("upload_used", `Upload ${uploadId} already published a version, and an upload publishes once. Request a new one for the next version.`);
  if ((u.mockup_id ?? undefined) !== mockupId)
    throw conflict("upload_mismatch", u.mockup_id ? `This upload was granted for mockup ${u.mockup_id}; publish it with that mockup_id.` : "This upload was granted for a new mockup; publish it without mockup_id.", { mockup_id: u.mockup_id });
  if (Date.parse(u.expires_at) < Date.parse(ctx.now)) throw gone("upload_expired", `Upload ${uploadId} expired at ${u.expires_at}. Request a new one and PUT the archive again.`);
  if (!u.uploaded_at) throw notFound(`No archive has arrived for upload ${uploadId} yet. PUT the ZIP to the grant's url first, then publish again.`);
  return u;
}

export const publishMockup = defineOperation({
  name: "mockups.publish",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Publish the next version of a mockup's canvas, or create a mockup with its first version. A later version keeps whatever you omit.",
  description:
    `Without mockup_id, creates a mockup: give a title, a brief and at least one page with a title and html. With mockup_id, publishes the next version: pass the mockup's etag, and send only what changes. pages, when given, is the whole canvas in order: a page you leave out is dropped from this version, and a page whose page_id was on the base version keeps its title, notes, size and html unless you send them, so a version that changes one page sends that page's html alone. The brief is Markdown: what the canvas explores, for whom, the questions it is meant to answer, and what each page tries; write it for the next agent as much as for people. Each page is one self-contained HTML document shown in a sandboxed frame of width × height CSS pixels (default ${DEFAULT_WIDTH} × ${DEFAULT_HEIGHT}; 390 wide for a phone): inline CSS and bounded inline scripts, images and fonts as data: URIs, no remote resources, forms or frames; every problem is listed at once (422). columns sets how many pages sit side by side before the canvas wraps; null keeps one row. files carries text files for collaborators to pull into their own projects (DESIGN.md, components, tokens), at most ${MAX_MOCKUP_FILES} and ${(MOCKUP_FILES_TOTAL / 1_000_000).toFixed(0)} million characters a version; WhatBuild never uses them to draw a page, so inline what a page needs. Like pages, files when given is the whole set: a path that was on the base keeps its content unless you send it, a path you leave out is dropped, a new path needs content, and [] drops them all; omit files to keep them. refs links the outcomes, sources and assumptions the canvas explores, and citations up to ${CITATION_MAX_COUNT} exact passages, {record_id, seq_start, seq_end, quote?}, frozen as snapshots. from_version: N starts from that earlier version instead of the current one. upload_id publishes a ZIP you PUT under request_upload's grant instead of sending pages, files and brief: the archive is get_download's layout, manifest.json's pages are the whole canvas in order and its files the whole set, a page or file the archive holds no HTML, notes or content for keeps the base version's, brief.md replaces the brief when present, and the manifest's title, summary and columns apply unless the call sends them; refs and citations come only from the call. Every page is checked as inline pages are, an archive with anything manifest.json does not name is refused, and an upload publishes once. Send small changes inline; use an upload for a canvas on disk. At most ${MAX_MOCKUP_PAGES} pages, ${(MOCKUP_HTML_TOTAL / 1_000_000).toFixed(0)} million characters of HTML in all, and ${MAX_MOCKUPS} mockups in a product, archived ones included.`,
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
    upload_id: id("mockup upload").optional().describe("A ZIP PUT under mockups(action=\"request_upload\")'s grant: its pages, files and brief, in place of pages, files and brief here."),
    expected_etag: expectedEtag.optional(),
  }),
  rest: { method: "POST", path: "/mockups" },
  mcp: { tool: "mockups", action: "publish" },
  async handler(ctx, given) {
    const pid = productId(ctx);
    let input = given;
    let upload: Awaited<ReturnType<typeof takeUpload>> | null = null;
    if (given.upload_id) {
      if (given.pages || given.files || given.brief !== undefined)
        throw invalid("invalid_input", "upload_id carries the pages, the files and the brief: leave pages, files and brief out of the call, or publish without upload_id. Nothing was published.");
      upload = await takeUpload(ctx, given.upload_id, given.mockup_id);
      const canvas = readCanvasArchive(await ctx.ports.blobs.get(upload.blob_key));
      if (canvas.mockup_id && given.mockup_id && canvas.mockup_id !== given.mockup_id)
        throw conflict("upload_mismatch", `manifest.json is mockup ${canvas.mockup_id}'s, not ${given.mockup_id}'s. Publish it to ${canvas.mockup_id}, or take mockup_id out of manifest.json. Nothing was published.`, { manifest_mockup_id: canvas.mockup_id });
      input = {
        ...given,
        title: given.title ?? canvas.title,
        summary: given.summary ?? canvas.summary,
        columns: given.columns !== undefined ? given.columns : canvas.columns,
        brief: canvas.brief,
        pages: canvas.pages,
        files: canvas.files,
      };
      // The public sandbox's limit on one field holds for what arrived in the archive, as for what a call carries.
      if (ctx.sandbox?.visitor) checkVisitorInput(ctx.sandbox, { name: "mockups.publish" }, input);
    }
    const existing = input.mockup_id ? await loadMockup(ctx, input.mockup_id, true) : null;
    let base: { n: number; version_id: string; title: string; summary: string; brief: string; columns: number | null; refs: typeof EMPTY_REFS; citations: unknown[]; pages: PageRow[]; files: FileRow[] } | null = null;
    if (existing) {
      if (existing.archived_at) throw conflict("mockup_archived", "This mockup is archived; restore it before publishing.");
      if (!input.expected_etag) throw conflict("stale_etag", "This mockup exists; read it with get and pass its etag.", { current_etag: existing.etag });
      checkEtag(input.expected_etag, existing.etag, "mockup");
      const vid = input.from_version ? await versionIdOf(ctx, existing.mockup_id, input.from_version) : existing.current_version_id;
      const v = await ctx.db.selectFrom("mockup_versions").selectAll().where("version_id", "=", vid).executeTakeFirstOrThrow();
      const pages = await ctx.db.selectFrom("mockup_pages").select(["page_id", "title", "notes", "width", "height", "html"]).where("version_id", "=", vid).orderBy("position").execute();
      const files = await ctx.db.selectFrom("mockup_files").select(["path", "content"]).where("version_id", "=", vid).orderBy(sql`path collate "C"`).execute();
      base = { ...v, pages, files };
    } else {
      if (input.expected_etag) throw conflict("stale_etag", "Omit expected_etag when creating a mockup.");
      if (input.from_version) throw invalid("invalid_input", "from_version needs a mockup_id.");
      if (!input.title) throw invalid("invalid_input", "A new mockup needs a title.");
      if (!input.pages) throw invalid("invalid_input", "A new mockup needs at least one page.");
      const count = await ctx.db.selectFrom("mockups").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst();
      if (Number(count?.n ?? 0) >= MAX_MOCKUPS)
        throw conflict("quota_exceeded", `A product holds at most ${MAX_MOCKUPS} mockups, archived ones included.`, { quota: "mockups", limit: MAX_MOCKUPS, used: Number(count?.n ?? 0), unit: "mockups" });
    }

    const problems: string[] = [];
    const pages: PageRow[] = input.pages
      ? input.pages.map((p, i) => {
          const was = base?.pages.find((b) => b.page_id === p.page_id);
          const title = p.title ?? was?.title;
          const html = p.html ?? was?.html;
          if (!title) problems.push(`Page ${i + 1} (${p.page_id}) is new and needs a title.`);
          if (!html) problems.push(`Page ${i + 1} (${p.page_id}) is new and needs html.`);
          return { page_id: p.page_id, title: title ?? "", notes: p.notes ?? was?.notes ?? "", width: p.width ?? was?.width ?? DEFAULT_WIDTH, height: p.height ?? was?.height ?? DEFAULT_HEIGHT, html: html ?? "" };
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
    if (problems.length) throw invalid("invalid_input", `Nothing was published: ${problems.join(" ")}`, { problems });
    // Only pages whose HTML changed need checking again; carried HTML passed when it was published.
    for (const p of input.pages ?? []) {
      if (p.html === undefined) continue;
      for (const msg of inspectStoryHtml(p.html)) problems.push(`${p.page_id}: ${msg}`);
    }
    const total = pages.reduce((n, p) => n + p.html.length, 0);
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
    if (upload) await ctx.db.updateTable("mockup_uploads").set({ used_at: ctx.now, version_id }).where("upload_id", "=", upload.upload_id).execute();
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
      summary: `${existing ? `Published version ${n}${input.from_version ? ` from version ${input.from_version}` : ""}${upload ? " from an uploaded archive" : ""} with` : `Created the mockup${upload ? " from an uploaded archive" : ""} with`} ${pages.length} page${pages.length === 1 ? "" : "s"}${files.length ? ` and ${files.length} file${files.length === 1 ? "" : "s"}` : ""}`,
    });
    const e = await loadMockup(ctx, mockup_id);
    return { ...summaryView(e), current: await versionView(ctx, e.current_version_id, false), based_on_version: base?.n ?? null };
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
  summary: "Get a short-lived grant to download one version of a mockup as a ZIP: the brief, each page's HTML and notes, its files, and a manifest.",
  description:
    "Use it to carry a canvas into the project where you build the next version: GET url with the headers, unzip, and change the pages. To publish the next version, zip the folder again and publish it with request_upload's grant, so no page passes through a tool call; for a small change, publish the pages that changed inline. The ZIP holds brief.md, manifest.json (the version, the pages in order with their titles, sizes and notes, the files, the refs and citations), pages/<page_id>.html with pages/<page_id>.notes.md, and each file the version carries under files/ at its path, ready to copy into your project. version defaults to the current one. Keep the grant header out of reports and logs.",
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
    "Checks the current version unless version is given, with the statuses story(action=\"check_citations\") reports: ok, relocated (with the new range), text_changed, record_archived, record_deleted or record_missing, plus version_drift when the source's primary file has a newer version than the snapshot's.",
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

export const mockupOps = [listMockups, getMockup, listMockupVersions, getMockupVersion, publishMockup, requestMockupUpload, archiveMockup, restoreMockup, getMockupDownload, checkMockupCitations];

/**
 * One version of a mockup as a ZIP, for the download grant's route: brief.md, manifest.json,
 * each page's HTML and notes, and the files it carries under files/. Runs in the tenant's transaction.
 */
export async function mockupBundle(db: Tx, versionId: string) {
  const v = await db.selectFrom("mockup_versions").selectAll().where("version_id", "=", versionId).executeTakeFirst();
  if (!v) return null;
  const e = await db.selectFrom("mockups").select(["mockup_id", "title"]).where("mockup_id", "=", v.mockup_id).executeTakeFirstOrThrow();
  const pages = await db.selectFrom("mockup_pages").selectAll().where("version_id", "=", versionId).orderBy("position").execute();
  const carried = await db.selectFrom("mockup_files").select(["path", "content"]).where("version_id", "=", versionId).orderBy(sql`path collate "C"`).execute();
  const manifest = {
    format: "whatbuild-mockup",
    format_version: 1,
    mockup_id: e.mockup_id,
    title: v.title,
    summary: v.summary,
    version: v.n,
    columns: v.columns,
    published_at: v.created_at,
    published_by: v.created_by,
    pages: pages.map((p) => ({ page_id: p.page_id, title: p.title, width: p.width, height: p.height, html: `pages/${p.page_id}.html`, notes: `pages/${p.page_id}.notes.md`, html_sha256: sha256Hex(p.html) })),
    files: carried.map((x) => ({ path: x.path, file: `files/${x.path}`, chars: x.content.length, sha256: sha256Hex(x.content) })),
    refs: { outcomes: v.refs.outcomes, sources: v.refs.sources, assumptions: v.refs.assumptions },
    citations: v.citations,
  };
  const files: Record<string, Uint8Array> = {
    "brief.md": strToU8(v.brief),
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2) + "\n"),
  };
  for (const p of pages) {
    files[`pages/${p.page_id}.html`] = strToU8(p.html);
    files[`pages/${p.page_id}.notes.md`] = strToU8(p.notes);
  }
  for (const x of carried) files[`files/${x.path}`] = strToU8(x.content);
  const slug = e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "mockup";
  return { name: `${slug}-v${v.n}.zip`, bytes: zipSync(files) };
}
