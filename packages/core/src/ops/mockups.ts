import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import { checkEtag, EMPTY_REFS, productId, recordActivity, tenantId, validateRefs } from "../common.ts";
import { CITATION_MAX_COUNT, citationInput, citationViews, snapshotAll } from "../citations.ts";
import { json, type Tx } from "../db.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { DOWNLOAD_GRANT_HEADER } from "./files.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { inspectStoryHtml, STORY_HTML_MAX } from "../story-html.ts";
import { newEtag, newId, sha256Hex } from "../util.ts";
import { resolveRefs } from "./story.ts";

/**
 * Mockups are where Exploration makes things: a canvas of HTML pages an agent built (screens,
 * flows, alternatives), each page with design notes, and a brief in Markdown that says what the
 * canvas explores and why. A version is the whole canvas; every publish makes the next one.
 */

export const MAX_MOCKUP_PAGES = 24;
export const MOCKUP_HTML_TOTAL = 8_000_000;
export const BRIEF_MAX = 50_000;
export const PAGE_NOTES_MAX = 10_000;
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

/** A version of the canvas: the brief, the pages in order, and what it draws on. */
async function versionView(ctx: OpContext, versionId: string, withHtml: boolean) {
  const v = await ctx.db.selectFrom("mockup_versions").selectAll().where("version_id", "=", versionId).where("product_id", "=", productId(ctx)).executeTakeFirstOrThrow();
  const pages = await ctx.db.selectFrom("mockup_pages").selectAll().where("version_id", "=", versionId).orderBy("position").execute();
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
      .selectFrom("mockups as e")
      .selectAll("e")
      .select((eb) => eb.selectFrom("mockup_pages as p").whereRef("p.version_id", "=", "e.current_version_id").select(eb.fn.countAll<number>().as("n")).as("page_count"))
      .where("e.product_id", "=", productId(ctx));
    if (!input.include_archived) q = q.where("e.archived_at", "is", null);
    const rows = await q.orderBy("e.updated_at", "desc").execute();
    return { items: rows.map((r) => ({ ...summaryView(r), page_count: Number(r.page_count ?? 0) })) };
  },
});

export const getMockup = defineOperation({
  name: "mockups.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read a mockup's current version: its brief, its pages with their notes, what it draws on, and the etag to publish again.",
  description:
    "Read this before publishing a new version, and read the brief first: it says what the canvas explores. Pages come without HTML unless include_html; each has html_path (a GET in the web app's session) and html_sha256. To work on the canvas outside WhatBuild, get_download gives the whole version as a ZIP.",
  input: z.strictObject({ mockup_id: id("mockup"), include_html: z.boolean().default(false) }),
  rest: { method: "GET", path: "/mockups/:mockup_id" },
  mcp: { tool: "mockups", action: "get" },
  async handler(ctx, input) {
    const e = await loadMockup(ctx, input.mockup_id);
    return { ...summaryView(e), current: await versionView(ctx, e.current_version_id, input.include_html) };
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
      .where("v.product_id", "=", productId(ctx))
      .where("v.mockup_id", "=", input.mockup_id);
    if (input.before) q = q.where("v.n", "<", input.before);
    const rows = await q.orderBy("v.n", "desc").limit(input.limit + 1).execute();
    const items = rows.slice(0, input.limit).map((v) => ({ version_id: v.version_id, version: v.n, title: v.title, summary: v.summary, page_count: Number(v.page_count ?? 0), published_at: v.created_at, published_by: v.created_by }));
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
  input: z.strictObject({ mockup_id: id("mockup"), version: z.number().int().min(1), include_html: z.boolean().default(false) }),
  rest: { method: "GET", path: "/mockups/:mockup_id/versions/:version" },
  mcp: { tool: "mockups", action: "get_version" },
  async handler(ctx, input) {
    const e = await loadMockup(ctx, input.mockup_id);
    const vid = await versionIdOf(ctx, input.mockup_id, input.version);
    return { ...(await versionView(ctx, vid, input.include_html)), mockup_archived_at: e.archived_at, is_current: vid === e.current_version_id };
  },
});

type PageRow = { page_id: string; title: string; notes: string; width: number; height: number; html: string };

export const publishMockup = defineOperation({
  name: "mockups.publish",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Publish the next version of a mockup's canvas, or create a mockup with its first version. A later version keeps whatever you omit.",
  description:
    `Without mockup_id, creates a mockup: give a title, a brief and at least one page with a title and html. With mockup_id, publishes the next version: pass the mockup's etag, and send only what changes. pages, when given, is the whole canvas in order: a page you leave out is dropped from this version, and a page whose page_id was on the base version keeps its title, notes, size and html unless you send them, so a version that changes one page sends that page's html alone. The brief is Markdown: what the canvas explores, for whom, the questions it is meant to answer, and what each page tries; write it for the next agent as much as for people. Each page is one self-contained HTML document shown in a sandboxed frame of width × height CSS pixels (default ${DEFAULT_WIDTH} × ${DEFAULT_HEIGHT}; 390 wide for a phone): inline CSS and bounded inline scripts, images and fonts as data: URIs, no remote resources, forms or frames; every problem is listed at once (422). columns sets how many pages sit side by side before the canvas wraps; null keeps one row. refs links the outcomes, sources and assumptions the canvas explores, and citations up to ${CITATION_MAX_COUNT} exact passages, {record_id, seq_start, seq_end, quote?}, frozen as snapshots. from_version: N starts from that earlier version instead of the current one. At most ${MAX_MOCKUP_PAGES} pages, ${(MOCKUP_HTML_TOTAL / 1_000_000).toFixed(0)} million characters of HTML in all.`,
  input: z.strictObject({
    mockup_id: id("mockup").optional().describe("Omit to create a mockup."),
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(2000).optional().describe("One or two sentences, shown in the list."),
    brief: z.string().max(BRIEF_MAX).optional().describe("Markdown: what this canvas explores and why."),
    columns: z.number().int().min(1).max(12).nullable().optional(),
    pages: z.array(pageInput).min(1).max(MAX_MOCKUP_PAGES).optional(),
    refs: refsInput.describe("The outcomes, sources and assumptions this canvas explores, in full. Omit on a later version to keep them."),
    citations: z.array(citationInput).max(CITATION_MAX_COUNT).optional(),
    from_version: z.number().int().min(1).optional(),
    expected_etag: expectedEtag.optional(),
  }),
  rest: { method: "POST", path: "/mockups" },
  mcp: { tool: "mockups", action: "publish" },
  async handler(ctx, input) {
    const pid = productId(ctx);
    const existing = input.mockup_id ? await loadMockup(ctx, input.mockup_id, true) : null;
    let base: { n: number; version_id: string; title: string; summary: string; brief: string; columns: number | null; refs: typeof EMPTY_REFS; citations: unknown[]; pages: PageRow[] } | null = null;
    if (existing) {
      if (existing.archived_at) throw conflict("mockup_archived", "This mockup is archived; restore it before publishing.");
      if (!input.expected_etag) throw conflict("stale_etag", "This mockup exists; read it with get and pass its etag.", { current_etag: existing.etag });
      checkEtag(input.expected_etag, existing.etag, "mockup");
      const vid = input.from_version ? await versionIdOf(ctx, existing.mockup_id, input.from_version) : existing.current_version_id;
      const v = await ctx.db.selectFrom("mockup_versions").selectAll().where("version_id", "=", vid).executeTakeFirstOrThrow();
      const pages = await ctx.db.selectFrom("mockup_pages").select(["page_id", "title", "notes", "width", "height", "html"]).where("version_id", "=", vid).orderBy("position").execute();
      base = { ...v, pages };
    } else {
      if (input.expected_etag) throw conflict("stale_etag", "Omit expected_etag when creating a mockup.");
      if (input.from_version) throw invalid("invalid_input", "from_version needs a mockup_id.");
      if (!input.title) throw invalid("invalid_input", "A new mockup needs a title.");
      if (!input.pages) throw invalid("invalid_input", "A new mockup needs at least one page.");
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
      summary: existing ? `Published version ${n}${input.from_version ? ` from version ${input.from_version}` : ""} with ${pages.length} page${pages.length === 1 ? "" : "s"}` : `Created the mockup with ${pages.length} page${pages.length === 1 ? "" : "s"}`,
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
  summary: "Get a short-lived grant to download one version of a mockup as a ZIP: the brief, each page's HTML and notes, and a manifest.",
  description:
    "Use it to carry a canvas into the project where you build the next version: GET url with the headers, unzip, change the pages, and publish the next version with the pages that changed. The ZIP holds brief.md, manifest.json (the version, the pages in order with their titles, sizes and notes, the refs and citations) and pages/<page_id>.html with pages/<page_id>.notes.md. version defaults to the current one. Keep the grant header out of reports and logs.",
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

export const mockupOps = [listMockups, getMockup, listMockupVersions, getMockupVersion, publishMockup, archiveMockup, restoreMockup, getMockupDownload];

/**
 * One version of a mockup as a ZIP, for the download grant's route: brief.md, manifest.json,
 * and each page's HTML and notes. Runs in the tenant's transaction.
 */
export async function mockupBundle(db: Tx, versionId: string) {
  const v = await db.selectFrom("mockup_versions").selectAll().where("version_id", "=", versionId).executeTakeFirst();
  if (!v) return null;
  const e = await db.selectFrom("mockups").select(["mockup_id", "title"]).where("mockup_id", "=", v.mockup_id).executeTakeFirstOrThrow();
  const pages = await db.selectFrom("mockup_pages").selectAll().where("version_id", "=", versionId).orderBy("position").execute();
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
  const slug = e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "mockup";
  return { name: `${slug}-v${v.n}.zip`, bytes: zipSync(files) };
}
