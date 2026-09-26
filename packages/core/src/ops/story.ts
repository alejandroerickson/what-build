import { z } from "zod";
import { checkEtag, EMPTY_REFS, productId, recordActivity, tenantId, validateRefs } from "../common.ts";
import { json, type StoryNode } from "../db.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { escapeHtml, inspectStoryHtml, STORY_HTML_MAX } from "../story-html.ts";
import {
  CHECKLIST, components, CONTENT_RULES, DESIGN_RULES, GUIDANCE_VERSION, layouts, linkTemplates, starterHtml, STYLESHEET, TOKENS, WORKFLOW, WRITING,
} from "../story-guidance.ts";
import { newEtag, newId } from "../util.ts";

export const MAX_PAGES = 50;
export const MAX_DEPTH = 6;

const pageId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "a lower-case slug: letters, digits and hyphens, up to 80 characters")
  .describe("The page's stable slug, chosen by the author, e.g. overview.");

const refsInput = z
  .strictObject({
    objectives: z.array(id("objective")).max(50).optional(),
    sources: z.array(id("source")).max(100).optional(),
    insights: z.array(id("insight")).max(100).optional(),
    assumptions: z.array(id("assumption")).max(100).optional(),
    decisions: z.array(id("decision")).max(100).optional(),
  })
  .optional();

function productPath(ctx: OpContext) {
  return `${ctx.scope.tenant!.slug}/${ctx.scope.team!.slug}/${ctx.scope.product!.slug}`;
}

async function loadPage(ctx: OpContext, page: string, lock = false) {
  let q = ctx.db.selectFrom("story_pages").selectAll().where("product_id", "=", productId(ctx)).where("page_id", "=", page);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw notFound(`Story page "${page}" has never been published in this product.`);
  return row;
}

function pageSummary(p: { page_id: string; title: string; summary: string; version_count: number; current_version_id: string; archived_at: string | null; etag: string; updated_at: string; updated_by: unknown }) {
  return { page_id: p.page_id, title: p.title, summary: p.summary, current_version: p.version_count, current_version_id: p.current_version_id, archived_at: p.archived_at, etag: p.etag, updated_at: p.updated_at, updated_by: p.updated_by };
}

export const guidance = defineOperation({
  name: "story.guidance",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Design and writing guidance for Story pages: tokens, stylesheet, recipes, layouts, editorial passes, checklist and a starter page.",
  description:
    "Read this before publishing. Pages render in a sandbox with no network and cannot use the app's components or theme, so use the returned native HTML and CSS. section narrows the response: all, design, components, layouts, writing, checklist. Every section keeps the rendering rules, link templates and limits.",
  input: z.strictObject({ section: z.enum(["all", "design", "components", "layouts", "writing", "checklist"]).default("all") }),
  rest: { method: "GET", path: "/story/guidance" },
  mcp: { tool: "story", action: "guidance" },
  async handler(ctx, input) {
    const links = linkTemplates(ctx.ports.config.publicBaseUrl, productPath(ctx));
    const base = {
      section: input.section,
      version: GUIDANCE_VERSION,
      available_sections: ["all", "design", "components", "layouts", "writing", "checklist"],
      format: "One self-contained HTML document with inline CSS and optional bounded inline JavaScript; no remote resources.",
      rendering:
        "HTML is untrusted and shown in a sandboxed frame. Bounded inline scripts run; forms, frames, remote resources, same-origin access and navigating the parent are blocked. Use target=\"_blank\" rel=\"noopener noreferrer\" on evidence and related-page links. Replace every REPLACE placeholder and adapt recipes to the content.",
      links,
      limits: { html_characters: STORY_HTML_MAX, inline_scripts: 10, script_characters: 32000, pages_per_product: MAX_PAGES, hierarchy_depth: MAX_DEPTH },
      provisional:
        "The design values are a neutral placeholder until WhatBuild's design system is chosen; they will change, and pages published now keep the values they embed.",
    };
    const design = { tokens: TOKENS, rules: DESIGN_RULES, integration: "The frame cannot inherit the app's stylesheet, so paste the stylesheet once into a <style> element; it embeds resolved values, not a runtime import." };
    switch (input.section) {
      case "design":
        return { ...base, design, stylesheet: STYLESHEET };
      case "components":
        return { ...base, components: components(links), stylesheet: STYLESHEET };
      case "layouts":
        return { ...base, layouts: layouts(), stylesheet: STYLESHEET };
      case "writing":
        return { ...base, workflow: WORKFLOW, content: CONTENT_RULES, writing: WRITING };
      case "checklist":
        return { ...base, checklist: CHECKLIST };
      default:
        return { ...base, workflow: WORKFLOW, content: CONTENT_RULES, design, stylesheet: STYLESHEET, components: components(links), layouts: layouts(), writing: WRITING, checklist: CHECKLIST, starter_html: starterHtml() };
    }
  },
});

export const listPages = defineOperation({
  name: "story.list_pages",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "The Story's pages, without HTML: title, summary, current version and etag.",
  description: "Archived pages are left out unless include_archived. The hierarchy (get_hierarchy) is the reader's navigation.",
  input: z.strictObject({ include_archived: z.boolean().default(false) }),
  rest: { method: "GET", path: "/story/pages" },
  mcp: { tool: "story", action: "list_pages" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("story_pages").selectAll().where("product_id", "=", productId(ctx));
    if (!input.include_archived) q = q.where("archived_at", "is", null);
    const rows = await q.orderBy("title").execute();
    return { items: rows.map(pageSummary) };
  },
});

async function versionView(ctx: OpContext, versionId: string, withHtml: boolean) {
  const v = await ctx.db.selectFrom("story_versions").selectAll().where("version_id", "=", versionId).where("product_id", "=", productId(ctx)).executeTakeFirstOrThrow();
  return {
    version_id: v.version_id,
    version: v.n,
    page_id: v.page_id,
    title: v.title,
    summary: v.summary,
    note: v.note,
    refs: v.refs,
    published_at: v.created_at,
    published_by: v.created_by,
    ...(withHtml ? { html: v.html } : { html_chars: v.html.length }),
  };
}

export const getPage = defineOperation({
  name: "story.get_page",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read a Story page's current version, with its HTML and the page etag you need to publish again.",
  description: "404 means the page has never been published. An archived page stays readable here. Read this before revising a page, and keep what is useful.",
  input: z.strictObject({ page_id: pageId, include_html: z.boolean().default(true) }),
  rest: { method: "GET", path: "/story/pages/:page_id" },
  mcp: { tool: "story", action: "get_page" },
  async handler(ctx, input) {
    const p = await loadPage(ctx, input.page_id);
    return { ...pageSummary(p), current: await versionView(ctx, p.current_version_id, input.include_html) };
  },
});

export const listVersions = defineOperation({
  name: "story.list_versions",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "A page's published versions, newest first, without HTML.",
  description: "Versions are immutable and numbered 1, 2, 3…; read any one with get_version.",
  input: z.strictObject({ page_id: pageId, limit: z.number().int().min(1).max(100).default(25), before: z.number().int().min(1).optional().describe("Only versions numbered below this.") }),
  rest: { method: "GET", path: "/story/pages/:page_id/versions" },
  mcp: { tool: "story", action: "list_versions" },
  async handler(ctx, input) {
    await loadPage(ctx, input.page_id);
    let q = ctx.db
      .selectFrom("story_versions")
      .select(["version_id", "n", "title", "summary", "note", "created_at", "created_by"])
      .where("product_id", "=", productId(ctx))
      .where("page_id", "=", input.page_id);
    if (input.before) q = q.where("n", "<", input.before);
    const rows = await q.orderBy("n", "desc").limit(input.limit + 1).execute();
    const items = rows.slice(0, input.limit).map((v) => ({ version_id: v.version_id, version: v.n, title: v.title, summary: v.summary, note: v.note, published_at: v.created_at, published_by: v.created_by }));
    return { items, next_before: rows.length > input.limit ? items[items.length - 1]!.version : null };
  },
});

export const getVersion = defineOperation({
  name: "story.get_version",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read one published version of a page, by number.",
  description: "Includes the page's current archived_at, so a reader browsing history still sees an archive notice.",
  input: z.strictObject({ page_id: pageId, version: z.number().int().min(1), include_html: z.boolean().default(true) }),
  rest: { method: "GET", path: "/story/pages/:page_id/versions/:version" },
  mcp: { tool: "story", action: "get_version" },
  async handler(ctx, input) {
    const p = await loadPage(ctx, input.page_id);
    const v = await ctx.db.selectFrom("story_versions").select("version_id").where("product_id", "=", productId(ctx)).where("page_id", "=", input.page_id).where("n", "=", input.version).executeTakeFirst();
    if (!v) throw notFound(`Page "${input.page_id}" has no version ${input.version}.`);
    return { ...(await versionView(ctx, v.version_id, input.include_html)), page_archived_at: p.archived_at, is_current: v.version_id === p.current_version_id };
  },
});

export const publish = defineOperation({
  name: "story.publish",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Publish a new version of a Story page (creating the page on its first version).",
  description:
    "Call guidance first, and get_page before revising. Omit expected_etag only for a page's first version; otherwise pass the page etag. html is one self-contained document (omit it for a generated title page). The HTML is validated and every problem is listed at once (422). Publishing never places the page in the navigation: call set_hierarchy afterwards. Never invent facts, owners or dates, and never present an unconfirmed assumption as settled.",
  input: z.strictObject({
    page_id: pageId.default("overview"),
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(2000).default(""),
    html: z.string().min(1).max(STORY_HTML_MAX).optional(),
    note: z.string().max(500).default("").describe("What changed in this version."),
    refs: refsInput,
    expected_etag: expectedEtag.optional(),
  }),
  rest: { method: "POST", path: "/story/pages/:page_id/versions" },
  mcp: { tool: "story", action: "publish" },
  async handler(ctx, input) {
    const refs = await validateRefs(ctx, input.refs ?? EMPTY_REFS);
    const html =
      input.html ??
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title><style>${STYLESHEET}</style></head><body><main class="wb-page wb-prose"><h1>${escapeHtml(input.title)}</h1>${input.summary ? `<p class="wb-lead">${escapeHtml(input.summary)}</p>` : ""}</main></body></html>`;
    const problems = inspectStoryHtml(html);
    if (problems.length) throw invalid("invalid_html", `The page was not published: ${problems.join(" ")}`, { problems });
    const existing = await ctx.db.selectFrom("story_pages").selectAll().where("product_id", "=", productId(ctx)).where("page_id", "=", input.page_id).forUpdate().executeTakeFirst();
    const version_id = newId();
    if (!existing) {
      if (input.expected_etag) throw conflict("stale_etag", `Page "${input.page_id}" does not exist yet; omit expected_etag for its first version.`);
      const count = await ctx.db.selectFrom("story_pages").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", productId(ctx)).executeTakeFirst();
      if (Number(count?.n ?? 0) >= MAX_PAGES) throw conflict("quota_exceeded", `A product's Story holds at most ${MAX_PAGES} pages.`, { quota: "story_pages", limit: MAX_PAGES, used: Number(count?.n ?? 0), unit: "pages" });
      await ctx.db
        .insertInto("story_versions")
        .values({ version_id, tenant_id: tenantId(ctx), product_id: productId(ctx), page_id: input.page_id, n: 1, title: input.title, summary: input.summary, html, note: input.note, refs: json(refs), previous_version_id: null, created_by: json(ctx.actor) })
        .execute();
      await ctx.db
        .insertInto("story_pages")
        .values({ tenant_id: tenantId(ctx), product_id: productId(ctx), page_id: input.page_id, title: input.title, summary: input.summary, current_version_id: version_id, version_count: 1, etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor) })
        .execute();
      await recordActivity(ctx, { action: "published", entity_type: "story_page", entity_id: input.page_id, entity_title: input.title, summary: "Published the first version" });
    } else {
      if (existing.archived_at) throw conflict("page_archived", `Page "${input.page_id}" is archived; restore it before publishing.`);
      if (!input.expected_etag) throw conflict("stale_etag", `Page "${input.page_id}" exists; read it with get_page and pass its etag.`, { current_etag: existing.etag });
      checkEtag(input.expected_etag, existing.etag, "story page");
      const n = existing.version_count + 1;
      await ctx.db
        .insertInto("story_versions")
        .values({ version_id, tenant_id: tenantId(ctx), product_id: productId(ctx), page_id: input.page_id, n, title: input.title, summary: input.summary, html, note: input.note, refs: json(refs), previous_version_id: existing.current_version_id, created_by: json(ctx.actor) })
        .execute();
      await ctx.db
        .updateTable("story_pages")
        .set({ title: input.title, summary: input.summary, current_version_id: version_id, version_count: n, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
        .where("product_id", "=", productId(ctx))
        .where("page_id", "=", input.page_id)
        .execute();
      await recordActivity(ctx, { action: "updated", entity_type: "story_page", entity_id: input.page_id, entity_title: input.title, summary: `Published version ${n}${input.note ? `: ${input.note}` : ""}` });
    }
    const p = await loadPage(ctx, input.page_id);
    return { ...pageSummary(p), current: await versionView(ctx, p.current_version_id, false), placed: await isPlaced(ctx, input.page_id) };
  },
});

async function storedHierarchy(ctx: OpContext) {
  return ctx.db.selectFrom("story_hierarchies").selectAll().where("product_id", "=", productId(ctx)).executeTakeFirst();
}

function flatten(nodes: StoryNode[]): string[] {
  return nodes.flatMap((n) => [n.page_id, ...flatten(n.children)]);
}

async function isPlaced(ctx: OpContext, page: string) {
  const h = await storedHierarchy(ctx);
  return h ? flatten(h.items).includes(page) : false;
}

export const getHierarchy = defineOperation({
  name: "story.get_hierarchy",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "The Story's navigation tree with its own etag, enriched with each page's current title and summary.",
  description:
    "A stored node whose page is missing or archived is skipped and its children promoted into its place. Live pages not yet placed are listed in `unplaced` (and appended at the top level of `items`), so every published page appears exactly once. etag is null before the first save.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/story/hierarchy" },
  mcp: { tool: "story", action: "get_hierarchy" },
  async handler(ctx) {
    const h = await storedHierarchy(ctx);
    const pages = await ctx.db.selectFrom("story_pages").select(["page_id", "title", "summary", "archived_at", "version_count", "updated_at"]).where("product_id", "=", productId(ctx)).execute();
    const live = new Map(pages.filter((p) => !p.archived_at).map((p) => [p.page_id, p]));
    const used = new Set<string>();
    type Enriched = { page_id: string; title: string; description: string; children: Enriched[] };
    const resolve = (nodes: StoryNode[]): Enriched[] =>
      nodes.flatMap((n) => {
        const p = live.get(n.page_id);
        const kids = resolve(n.children);
        if (!p || used.has(n.page_id)) return kids;
        used.add(n.page_id);
        return [{ page_id: p.page_id, title: p.title, description: p.summary, children: kids }];
      });
    const items = resolve(h?.items ?? []);
    const unplaced = [...live.values()]
      .filter((p) => !used.has(p.page_id))
      .sort((a, b) => (a.page_id === "overview" ? -1 : b.page_id === "overview" ? 1 : a.title.localeCompare(b.title) || a.page_id.localeCompare(b.page_id)))
      .map((p) => ({ page_id: p.page_id, title: p.title, description: p.summary, children: [] as Enriched[] }));
    return { etag: h?.etag ?? null, items: [...items, ...unplaced], unplaced: unplaced.map((u) => u.page_id), updated_at: h?.updated_at ?? null };
  },
});

const nodeSchema: z.ZodType<StoryNode> = z.lazy(() => z.strictObject({ page_id: pageId, children: z.array(nodeSchema).default([]) })) as z.ZodType<StoryNode>;

export const setHierarchy = defineOperation({
  name: "story.set_hierarchy",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Replace the Story's navigation tree. Uses the hierarchy's own etag; never touches page content.",
  description: `The whole tree, not a patch: nodes are {page_id, children}. Each page at most once, depth at most ${MAX_DEPTH}, every page live and published. Pass expected_etag from get_hierarchy, or null before the first save. Pages you leave out become unplaced.`,
  input: z.strictObject({ items: z.array(nodeSchema).max(MAX_PAGES), expected_etag: expectedEtag.nullable() }),
  rest: { method: "PUT", path: "/story/hierarchy" },
  mcp: { tool: "story", action: "set_hierarchy" },
  async handler(ctx, input) {
    const h = await ctx.db.selectFrom("story_hierarchies").selectAll().where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
    if (h) {
      if (!input.expected_etag) throw conflict("stale_etag", "The hierarchy has been saved before; read it and pass its etag.", { current_etag: h.etag });
      checkEtag(input.expected_etag, h.etag, "story hierarchy");
    } else if (input.expected_etag) throw conflict("stale_etag", "No hierarchy has been saved yet; pass expected_etag null.");
    const ids = flatten(input.items);
    const dup = ids.find((x, i) => ids.indexOf(x) !== i);
    if (dup) throw invalid("invalid_hierarchy", `Page "${dup}" appears more than once.`);
    const depth = (nodes: StoryNode[]): number => (nodes.length ? 1 + Math.max(...nodes.map((n) => depth(n.children))) : 0);
    if (depth(input.items) > MAX_DEPTH) throw invalid("invalid_hierarchy", `The tree is deeper than ${MAX_DEPTH} levels.`);
    const pages = ids.length ? await ctx.db.selectFrom("story_pages").select(["page_id", "archived_at"]).where("product_id", "=", productId(ctx)).where("page_id", "in", ids).execute() : [];
    const missing = ids.filter((x) => !pages.some((p) => p.page_id === x));
    const archived = pages.filter((p) => p.archived_at).map((p) => p.page_id);
    if (missing.length) throw invalid("invalid_hierarchy", `Unpublished pages: ${missing.join(", ")}.`);
    if (archived.length) throw invalid("invalid_hierarchy", `Archived pages: ${archived.join(", ")}.`);
    const etag = newEtag();
    if (h) await ctx.db.updateTable("story_hierarchies").set({ items: json(input.items), etag, updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", productId(ctx)).execute();
    else await ctx.db.insertInto("story_hierarchies").values({ product_id: productId(ctx), tenant_id: tenantId(ctx), items: json(input.items), etag, updated_by: json(ctx.actor) }).execute();
    await recordActivity(ctx, { action: "organized", entity_type: "story_hierarchy", entity_id: null, entity_title: "Story navigation", summary: `Arranged ${ids.length} page${ids.length === 1 ? "" : "s"} in the navigation` });
    return getHierarchy.handler(ctx, {});
  },
});

function removeFromTree(nodes: StoryNode[], page: string): { nodes: StoryNode[]; promoted: string[] } {
  const promoted: string[] = [];
  const walk = (list: StoryNode[]): StoryNode[] =>
    list.flatMap((n) => {
      if (n.page_id === page) {
        promoted.push(...n.children.map((c) => c.page_id));
        return walk(n.children);
      }
      return [{ page_id: n.page_id, children: walk(n.children) }];
    });
  return { nodes: walk(nodes), promoted };
}

export const archivePage = defineOperation({
  name: "story.archive_page",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Archive a Story page: out of the navigation, its sub-pages promoted into its place. Erases nothing.",
  description: "The page and all its versions stay readable by id. Restore returns it unplaced. Pass the page's etag.",
  input: z.strictObject({ page_id: pageId, expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/story/pages/:page_id/archive" },
  mcp: { tool: "story", action: "archive_page" },
  async handler(ctx, input) {
    const p = await loadPage(ctx, input.page_id, true);
    checkEtag(input.expected_etag, p.etag, "story page");
    if (p.archived_at) return { page_id: p.page_id, archived_at: p.archived_at, promoted_children: [] };
    const h = await ctx.db.selectFrom("story_hierarchies").selectAll().where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
    let promoted: string[] = [];
    if (h) {
      const r = removeFromTree(h.items, p.page_id);
      promoted = r.promoted;
      await ctx.db.updateTable("story_hierarchies").set({ items: json(r.nodes), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", productId(ctx)).execute();
    }
    await ctx.db.updateTable("story_pages").set({ archived_at: ctx.now, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", productId(ctx)).where("page_id", "=", p.page_id).execute();
    await recordActivity(ctx, { action: "archived", entity_type: "story_page", entity_id: p.page_id, entity_title: p.title, summary: promoted.length ? `Archived the page; promoted ${promoted.length} sub-page${promoted.length === 1 ? "" : "s"}` : "Archived the page" });
    return { page_id: p.page_id, archived_at: ctx.now, promoted_children: promoted };
  },
});

export const restorePage = defineOperation({
  name: "story.restore_page",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Restore an archived Story page. It returns unplaced; add it to the hierarchy with set_hierarchy.",
  description: "Pass the page's etag.",
  input: z.strictObject({ page_id: pageId, expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/story/pages/:page_id/restore" },
  mcp: { tool: "story", action: "restore_page" },
  async handler(ctx, input) {
    const p = await loadPage(ctx, input.page_id, true);
    checkEtag(input.expected_etag, p.etag, "story page");
    if (!p.archived_at) return { page_id: p.page_id, archived_at: null };
    await ctx.db.updateTable("story_pages").set({ archived_at: null, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", productId(ctx)).where("page_id", "=", p.page_id).execute();
    await recordActivity(ctx, { action: "restored", entity_type: "story_page", entity_id: p.page_id, entity_title: p.title, summary: "Restored the page (unplaced)" });
    return { page_id: p.page_id, archived_at: null };
  },
});

export const storyOps = [guidance, listPages, getPage, listVersions, getVersion, publish, getHierarchy, setHierarchy, archivePage, restorePage];
