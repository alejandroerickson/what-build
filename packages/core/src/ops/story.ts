import { z } from "zod";
import { checkEtag, EMPTY_REFS, productId, recordActivity, tenantId, validateRefs } from "../common.ts";
import { checkCitationList, CITATION_MAX_COUNT, citationInput, citationViews, snapshotAll } from "../citations.ts";
import { json, type Refs, type StoryNode } from "../db.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { escapeHtml, inspectStoryHtml, STORY_HTML_MAX } from "../story-html.ts";
import { composePrintDocument, PRINT_MAX_PAGES, printOrder } from "../story-print.ts";
import {
  CHECKLIST, components, CONTENT_RULES, DESIGN_RULES, GUIDANCE_VERSION, layouts, linkTemplates, starterHtml, STYLESHEET, TOKENS, WORKFLOW, WRITING,
} from "../story-guidance.ts";
import { newEtag, newId, randomToken, uniq } from "../util.ts";

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

export const NOTES_MAX = 20_000;

function notesView(p: { agent_notes: string; agent_notes_etag: string; agent_notes_updated_at: string | null; agent_notes_updated_by: unknown }) {
  return { content: p.agent_notes, etag: p.agent_notes_etag, updated_at: p.agent_notes_updated_at, updated_by: p.agent_notes_updated_by };
}

type ResolvedRef = { id: string; title: string | null; status: string | null; kind?: string; archived: boolean; missing: boolean };

/** A version's references with their current titles, so a reader can list them without a request per id. */
async function resolveRefs(ctx: OpContext, refs: Refs): Promise<Record<keyof Refs, ResolvedRef[]>> {
  const pid = productId(ctx);
  const some = (ids: string[] | undefined) => (ids?.length ? ids : [""]);
  const [objectives, sources, insights, entries] = await Promise.all([
    ctx.db.selectFrom("objectives").select(["objective_id as id", "title", "status"]).where("product_id", "=", pid).where("objective_id", "in", some(refs.objectives)).execute(),
    ctx.db.selectFrom("records").select(["record_id as id", "title", "kind", "archived_at"]).where("product_id", "=", pid).where("record_id", "in", some(refs.sources)).execute(),
    ctx.db.selectFrom("insights").select(["insight_id as id", "title", "status"]).where("product_id", "=", pid).where("insight_id", "in", some(refs.insights)).execute(),
    ctx.db
      .selectFrom("register_entries")
      .select(["entry_id as id", "statement", "status", "archived_at"])
      .where("product_id", "=", pid)
      .where("entry_id", "in", some([...(refs.assumptions ?? []), ...(refs.decisions ?? [])]))
      .execute(),
  ]);
  const missing = (id: string): ResolvedRef => ({ id, title: null, status: null, archived: false, missing: true });
  return {
    objectives: (refs.objectives ?? []).map((i) => {
      const o = objectives.find((x) => x.id === i);
      return o ? { id: i, title: o.title, status: o.status, archived: o.status === "archived", missing: false } : missing(i);
    }),
    sources: (refs.sources ?? []).map((i) => {
      const r = sources.find((x) => x.id === i);
      return r ? { id: i, title: r.title, status: null, kind: r.kind, archived: Boolean(r.archived_at), missing: false } : missing(i);
    }),
    insights: (refs.insights ?? []).map((i) => {
      const r = insights.find((x) => x.id === i);
      return r ? { id: i, title: r.title, status: r.status, archived: r.status === "archived", missing: false } : missing(i);
    }),
    assumptions: (refs.assumptions ?? []).map((i) => {
      const r = entries.find((x) => x.id === i);
      return r ? { id: i, title: r.statement, status: r.status, archived: Boolean(r.archived_at), missing: false } : missing(i);
    }),
    decisions: (refs.decisions ?? []).map((i) => {
      const r = entries.find((x) => x.id === i);
      return r ? { id: i, title: r.statement, status: r.status, archived: Boolean(r.archived_at), missing: false } : missing(i);
    }),
  };
}

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
    resolved_refs: await resolveRefs(ctx, v.refs),
    citations: await citationViews(ctx, v.citations),
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
  summary: "Read a Story page's current version, with its HTML, citations, notes for agents, and the page etag you need to publish again.",
  description:
    "404 means the page has never been published. An archived page stays readable here. Read this before revising a page, and keep what is useful. agent_notes holds what agents keep about the page — its purpose, sources still to fold in, structural decisions — with its own etag for write_notes; read it before revising.",
  input: z.strictObject({ page_id: pageId, include_html: z.boolean().default(true) }),
  rest: { method: "GET", path: "/story/pages/:page_id" },
  mcp: { tool: "story", action: "get_page" },
  async handler(ctx, input) {
    const p = await loadPage(ctx, input.page_id);
    return { ...pageSummary(p), agent_notes: notesView(p), current: await versionView(ctx, p.current_version_id, input.include_html) };
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
      .select(["version_id", "n", "title", "summary", "note", "created_at", "created_by", "citations"])
      .where("product_id", "=", productId(ctx))
      .where("page_id", "=", input.page_id);
    if (input.before) q = q.where("n", "<", input.before);
    const rows = await q.orderBy("n", "desc").limit(input.limit + 1).execute();
    const items = rows.slice(0, input.limit).map((v) => ({ version_id: v.version_id, version: v.n, title: v.title, summary: v.summary, note: v.note, citation_count: v.citations.length, published_at: v.created_at, published_by: v.created_by }));
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
    `Call guidance first, and get_page before revising (read its agent_notes too). Omit expected_etag only for a page's first version; otherwise pass the page etag. html is one self-contained document (omit it for a generated title page). The HTML is validated and every problem is listed at once (422). citations lists up to ${CITATION_MAX_COUNT} exact passages the page draws on, {record_id, seq_start, seq_end, quote?}, each frozen as a snapshot as in the registers; refs and citations belong to the version, so pass the full lists each time — nothing carries over from the previous version. Publishing never places the page in the navigation: call set_hierarchy afterwards, and update the page's notes with write_notes. Never invent facts, owners or dates, and never present an unconfirmed assumption as settled.`,
  input: z.strictObject({
    page_id: pageId.default("overview"),
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(2000).default(""),
    html: z.string().min(1).max(STORY_HTML_MAX).optional(),
    note: z.string().max(500).default("").describe("What changed in this version."),
    refs: refsInput,
    citations: z.array(citationInput).max(CITATION_MAX_COUNT).optional().describe(`Up to ${CITATION_MAX_COUNT} exact passages the page draws on: {record_id, seq_start, seq_end, quote?}. Read each passage first.`),
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
    const citations = await snapshotAll(ctx, input.citations ?? [], "page version");
    const existing = await ctx.db.selectFrom("story_pages").selectAll().where("product_id", "=", productId(ctx)).where("page_id", "=", input.page_id).forUpdate().executeTakeFirst();
    const version_id = newId();
    if (!existing) {
      if (input.expected_etag) throw conflict("stale_etag", `Page "${input.page_id}" does not exist yet; omit expected_etag for its first version.`);
      const count = await ctx.db.selectFrom("story_pages").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", productId(ctx)).executeTakeFirst();
      if (Number(count?.n ?? 0) >= MAX_PAGES) throw conflict("quota_exceeded", `A product's Story holds at most ${MAX_PAGES} pages.`, { quota: "story_pages", limit: MAX_PAGES, used: Number(count?.n ?? 0), unit: "pages" });
      await ctx.db
        .insertInto("story_versions")
        .values({ version_id, tenant_id: tenantId(ctx), product_id: productId(ctx), page_id: input.page_id, n: 1, title: input.title, summary: input.summary, html, note: input.note, refs: json(refs), citations: json(citations), previous_version_id: null, created_by: json(ctx.actor) })
        .execute();
      await ctx.db
        .insertInto("story_pages")
        .values({ tenant_id: tenantId(ctx), product_id: productId(ctx), page_id: input.page_id, title: input.title, summary: input.summary, current_version_id: version_id, version_count: 1, etag: newEtag(), agent_notes_etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor) })
        .execute();
      await recordActivity(ctx, { action: "published", entity_type: "story_page", entity_id: input.page_id, entity_title: input.title, summary: "Published the first version" });
    } else {
      if (existing.archived_at) throw conflict("page_archived", `Page "${input.page_id}" is archived; restore it before publishing.`);
      if (!input.expected_etag) throw conflict("stale_etag", `Page "${input.page_id}" exists; read it with get_page and pass its etag.`, { current_etag: existing.etag });
      checkEtag(input.expected_etag, existing.etag, "story page");
      const n = existing.version_count + 1;
      await ctx.db
        .insertInto("story_versions")
        .values({ version_id, tenant_id: tenantId(ctx), product_id: productId(ctx), page_id: input.page_id, n, title: input.title, summary: input.summary, html, note: input.note, refs: json(refs), citations: json(citations), previous_version_id: existing.current_version_id, created_by: json(ctx.actor) })
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
    const { placed, ...view } = await resolvedHierarchy(ctx);
    void placed;
    return view;
  },
});

async function resolvedHierarchy(ctx: OpContext) {
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
  return { etag: h?.etag ?? null, items: [...items, ...unplaced], placed: items, unplaced: unplaced.map((u) => u.page_id), updated_at: h?.updated_at ?? null };
}

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

export const writeNotes = defineOperation({
  name: "story.write_notes",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Replace a Story page's notes for agents: the Markdown memory agents keep while writing and maintaining the page.",
  description:
    `Notes are not versioned with the HTML and readers do not see them on the page. Keep them short and current: what the page is for and who reads it, sources and insights still to fold in, decisions about structure, and anything the next agent should not undo. Read them (get_page → agent_notes) before revising, and update them after publishing. The whole note is replaced; pass agent_notes.etag from get_page as expected_etag (it is not the page etag). At most ${NOTES_MAX.toLocaleString("en-US")} characters; an empty string clears the notes.`,
  input: z.strictObject({ page_id: pageId, notes: z.string().max(NOTES_MAX), expected_etag: expectedEtag }),
  rest: { method: "PUT", path: "/story/pages/:page_id/notes" },
  mcp: { tool: "story", action: "write_notes" },
  async handler(ctx, input) {
    const p = await loadPage(ctx, input.page_id, true);
    checkEtag(input.expected_etag, p.agent_notes_etag, "page's notes");
    if (input.notes === p.agent_notes) return { page_id: p.page_id, agent_notes: notesView(p), changed: false };
    await ctx.db
      .updateTable("story_pages")
      .set({ agent_notes: input.notes, agent_notes_etag: newEtag(), agent_notes_updated_at: ctx.now, agent_notes_updated_by: json(ctx.actor) })
      .where("product_id", "=", productId(ctx))
      .where("page_id", "=", p.page_id)
      .execute();
    await recordActivity(ctx, { action: "notes_updated", entity_type: "story_page", entity_id: p.page_id, entity_title: p.title, summary: input.notes ? "Updated the notes for agents" : "Cleared the notes for agents" });
    return { page_id: p.page_id, agent_notes: notesView(await loadPage(ctx, p.page_id)), changed: true };
  },
});

export const checkStoryCitations = defineOperation({
  name: "story.check_citations",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Re-resolve a Story page version's citations against the sources as they are now. Reports drift; never rewrites.",
  description:
    "Checks the current version unless version is given. Per citation: ok, relocated (text intact at another range, which it gives), text_changed, record_archived, record_deleted or record_missing, plus version_drift when the source's primary file has a newer version than the snapshot's. A matching quote establishes textual integrity only, not truth.",
  input: z.strictObject({ page_id: pageId, version: z.number().int().min(1).optional() }),
  rest: { method: "GET", path: "/story/pages/:page_id/check-citations" },
  mcp: { tool: "story", action: "check_citations" },
  async handler(ctx, input) {
    const p = await loadPage(ctx, input.page_id);
    let q = ctx.db.selectFrom("story_versions").select(["n", "citations"]).where("product_id", "=", productId(ctx)).where("page_id", "=", p.page_id);
    q = input.version ? q.where("n", "=", input.version) : q.where("version_id", "=", p.current_version_id);
    const v = await q.executeTakeFirst();
    if (!v) throw notFound(`Page "${p.page_id}" has no version ${input.version}.`);
    return { page_id: p.page_id, version: v.n, checked_at: ctx.now, ...(await checkCitationList(ctx, v.citations)) };
  },
});

const printInput = z.strictObject({
  page_ids: z
    .array(pageId)
    .min(1)
    .max(PRINT_MAX_PAGES)
    .describe(`The pages to include, 1 to ${PRINT_MAX_PAGES}; exactly these, never their sub-pages. In REST, a comma-separated list.`),
});

/** The chosen pages with their current versions, in tree order with outline levels. */
async function printPages(ctx: OpContext, ids: string[]) {
  const wanted = uniq(ids);
  const rows = await ctx.db
    .selectFrom("story_pages as p")
    .innerJoin("story_versions as v", "v.version_id", "p.current_version_id")
    .select(["p.page_id", "p.title", "p.archived_at", "v.n", "v.created_at", "v.html"])
    .where("p.product_id", "=", productId(ctx))
    .where("p.page_id", "in", wanted)
    .execute();
  const missing = wanted.filter((w) => !rows.some((r) => r.page_id === w));
  if (missing.length) throw notFound(`These Story pages have never been published in this product: ${missing.join(", ")}.`, { missing });
  const h = await resolvedHierarchy(ctx);
  const order = printOrder(h.placed, rows.map((r) => ({ page_id: r.page_id, title: r.title })));
  return order.map((slot) => {
    const r = rows.find((x) => x.page_id === slot.page_id)!;
    return { page_id: r.page_id, title: r.title, version: r.n, published_at: r.created_at, archived: Boolean(r.archived_at), depth: slot.depth, level: slot.level, html: r.html };
  });
}

function printPath(ctx: OpContext, ids: string[]) {
  return `/api/v1/p/${productPath(ctx)}/story/print?page_ids=${ids.map(encodeURIComponent).join(",")}`;
}

export const printView = defineOperation({
  name: "story.print_view",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Plan a print view of chosen Story pages, to save as PDF from a browser: their order, heading levels and the view's address.",
  description:
    "Includes exactly the pages named, each at its current version, in the Story's tree order (a depth-first walk of the hierarchy; unplaced pages after, by title). level is the page's outline level among the chosen pages: 1 for a page with no chosen ancestor. url opens one HTML document — a title block, contents, then each page — that a person prints to PDF from their browser; page scripts do not run there, so content a page draws with JavaScript is left out. 404 lists pages that have never been published.",
  input: printInput,
  rest: { method: "GET", path: "/story/print-view" },
  mcp: { tool: "story", action: "print_view" },
  async handler(ctx, input) {
    const pages = await printPages(ctx, input.page_ids);
    const path = printPath(ctx, pages.map((p) => p.page_id));
    return {
      product: { name: ctx.scope.product!.name, path: productPath(ctx) },
      pages: pages.map(({ html, ...p }) => ({ ...p, html_chars: html.length })),
      path,
      url: `${ctx.ports.config.publicBaseUrl}${path}`,
    };
  },
});

/**
 * The print view document itself. Not a registry operation (it answers HTML, not JSON): the REST
 * adapter serves it at GET /story/print with the headers from printResponseHeaders(nonce).
 */
export const printDocument = defineOperation({
  name: "story.print_view",
  scope: "product",
  access: "read",
  mutates: false,
  summary: printView.summary,
  description: printView.description,
  input: printInput,
  rest: { method: "GET", path: "/story/print" },
  mcp: { tool: "story", action: "print_view" },
  async handler(ctx, input) {
    const pages = await printPages(ctx, input.page_ids);
    const nonce = randomToken(18);
    const html = composePrintDocument({ productName: ctx.scope.product!.name, exportedAt: ctx.now, pages, nonce });
    return { html, nonce };
  },
});

export const storyOps = [guidance, listPages, getPage, listVersions, getVersion, publish, writeNotes, checkStoryCitations, printView, getHierarchy, setHierarchy, archivePage, restorePage];
