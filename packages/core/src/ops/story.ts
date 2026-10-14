import { sql } from "kysely";
import { z } from "zod";
import { checkEtag, EMPTY_REFS, productId, recordActivity, tenantId, validateRefs } from "../common.ts";
import { checkCitationList, CITATION_MAX_COUNT, citationInput, citationViews, snapshotAll } from "../citations.ts";
import { json, type Db, type MockupPageRef, type Refs, type StoryNode } from "../db.ts";
import { checkConfirmation, DELETE_GUIDANCE, deleteGuards, leaveTombstone, refuseIfDeleted } from "../deletion.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { readsOnlyTheStory } from "../policy.ts";
import { refuseVisitorWrite } from "../public-sandbox.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { escapeHtml, inspectStoryCss, inspectStoryHtml, STORY_CSS_MAX, STORY_HTML_MAX } from "../story-html.ts";
import { composePrintDocument, PRINT_MAX_PAGES, printOrder } from "../story-print.ts";
import {
  ANTI_PATTERNS, CARRIED_TYPEFACES, catalogue, CHECKLIST, components, COMPOSITIONS, CONTENT_RULES, DESIGN_PASSES, DESIGN_TOOLS, GUIDANCE_VERSION, linkTemplates, SANDBOX_RULES,
  starterHtml, STYLE_WORKFLOW, TASTE, VOCABULARY, WORKFLOW, WRITING,
} from "../story-guidance.ts";
import { HOUSE_STYLE_IDS, houseStyle, pageDocument, PLAIN_STYLESHEET } from "../story-styles.ts";
import { newEtag, newId, randomToken, sha256Hex, uniq } from "../util.ts";
import { DOWNLOAD_GRANT_HEADER } from "./files.ts";

export const MAX_PAGES = 50;
export const MAX_DEPTH = 6;

const pageId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "a lower-case slug: letters, digits and hyphens, up to 80 characters")
  .describe("The page's stable slug, chosen by the author, e.g. overview.");

const refsInput = z
  .strictObject({
    outcomes: z.array(id("outcome")).max(50).optional(),
    sources: z.array(id("source")).max(100).optional(),
    assumptions: z.array(id("assumption")).max(100).optional(),
  })
  .optional();

function productPath(ctx: OpContext) {
  return `${ctx.scope.tenant!.slug}/${ctx.scope.team!.slug}/${ctx.scope.product!.slug}`;
}

async function loadPage(ctx: OpContext, page: string, lock = false) {
  let q = ctx.db.selectFrom("story_pages").selectAll().where("product_id", "=", productId(ctx)).where("page_id", "=", page);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) {
    // A reader is told no more of a deleted page than of an archived one.
    if (!readsOnlyTheStory(ctx.scope.role)) await refuseIfDeleted(ctx, "story_page", page, `Story page "${page}"`);
    throw notFound(`Story page "${page}" has never been published in this product.`);
  }
  return row;
}

/**
 * A page as its reader may read it. A Story reader is given only live pages: an archived page is
 * what the team took out of the Story, so for a reader it is not found, by id as in the lists.
 */
async function loadReadablePage(ctx: OpContext, page: string) {
  const row = await loadPage(ctx, page);
  if (row.archived_at && readsOnlyTheStory(ctx.scope.role)) throw notFound(`Story page "${page}" has never been published in this product.`);
  return row;
}

function pageSummary(p: { page_id: string; title: string; summary: string; version_count: number; current_version_id: string; archived_at: string | null; etag: string; updated_at: string; updated_by: unknown }) {
  return { page_id: p.page_id, title: p.title, summary: p.summary, current_version: p.version_count, current_version_id: p.current_version_id, archived_at: p.archived_at, etag: p.etag, updated_at: p.updated_at, updated_by: p.updated_by };
}

type StyleRow = { name: string; summary: string; based_on: string | null; rules: string; stylesheet: string; specimen_html: string | null; etag: string; updated_at: string; updated_by: unknown };

async function loadStyle(ctx: OpContext, lock = false) {
  let q = ctx.db.selectFrom("story_styles").selectAll().where("product_id", "=", productId(ctx));
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

function styleView(s: StyleRow, withCss: boolean) {
  const base = houseStyle(s.based_on ?? "");
  return {
    name: s.name,
    summary: s.summary,
    based_on: s.based_on,
    based_on_name: base?.name ?? null,
    kind: s.based_on ? ("house" as const) : ("team" as const),
    rules: s.rules,
    ...(withCss ? { stylesheet: s.stylesheet } : { stylesheet_chars: s.stylesheet.length }),
    has_own_specimen: s.specimen_html !== null,
    etag: s.etag,
    updated_at: s.updated_at,
    updated_by: s.updated_by,
  };
}

const GUIDANCE_SECTIONS = ["all", "style", "design", "components", "writing", "checklist"] as const;

export const guidance = defineOperation({
  name: "story.guidance",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "How to write and design Story pages: choosing the product's Story style, taste, anti-patterns, design passes, recipes, compositions, writing rules and a checklist.",
  description:
    "Read this before publishing. The Story follows the product's Story style (get_style), never WhatBuild's app look: the team's own design system, or a house style adopted for the product. house_style returns that style's full stylesheet, rules and a starter page, so you can show it or adopt it. section narrows the response: all, style, design, components, writing, checklist. Every section keeps the rendering rules, link templates and limits.",
  input: z.strictObject({
    section: z.enum(GUIDANCE_SECTIONS).default("all"),
    house_style: z.enum(HOUSE_STYLE_IDS).optional().describe(`A house style to return in full: ${HOUSE_STYLE_IDS.join(", ")}.`),
  }),
  rest: { method: "GET", path: "/story/guidance" },
  mcp: { tool: "story", action: "guidance" },
  async handler(ctx, input) {
    const links = linkTemplates(ctx.ports.config.publicBaseUrl, productPath(ctx));
    const current = await loadStyle(ctx);
    const picked = input.house_style ? houseStyle(input.house_style)! : undefined;
    const base = {
      section: input.section,
      version: GUIDANCE_VERSION,
      available_sections: GUIDANCE_SECTIONS,
      format: "One self-contained HTML document with inline CSS and optional bounded inline JavaScript; no remote resources.",
      rendering:
        "HTML is untrusted and shown in a sandboxed frame. Bounded inline scripts run; forms, frames, remote resources, same-origin access and navigating the parent are blocked. Use target=\"_blank\" rel=\"noopener noreferrer\" on every link; a link to another page of this Story (links.story_page) is shown in place by the app. Replace every REPLACE placeholder and adapt recipes to the content.",
      product_style: current
        ? { name: current.name, based_on: current.based_on, summary: current.summary, etag: current.etag, read_with: 'story(action="get_style")' }
        : { none: true, next: "Settle the Story style with the person before the first page: see style_workflow." },
      links,
      limits: { html_characters: STORY_HTML_MAX, stylesheet_characters: STORY_CSS_MAX, inline_scripts: 10, script_characters: 32000, pages_per_product: MAX_PAGES, hierarchy_depth: MAX_DEPTH },
      ...(picked ? { house_style: { ...picked, starter_html: starterHtml(picked.stylesheet) } } : {}),
    };
    const style = { style_workflow: STYLE_WORKFLOW, house_styles: catalogue(), carried_typefaces: CARRIED_TYPEFACES, vocabulary: VOCABULARY };
    const design = { taste: TASTE, anti_patterns: ANTI_PATTERNS, design_passes: DESIGN_PASSES, design_tools: DESIGN_TOOLS, sandbox_rules: SANDBOX_RULES, compositions: COMPOSITIONS };
    switch (input.section) {
      case "style":
        return { ...base, ...style };
      case "design":
        return { ...base, ...design };
      case "components":
        return { ...base, vocabulary: VOCABULARY, components: components(links), compositions: COMPOSITIONS };
      case "writing":
        return { ...base, workflow: WORKFLOW, content: CONTENT_RULES, writing: WRITING };
      case "checklist":
        return { ...base, checklist: CHECKLIST, anti_patterns: ANTI_PATTERNS };
      default:
        return { ...base, workflow: WORKFLOW, ...style, ...design, content: CONTENT_RULES, components: components(links), writing: WRITING, checklist: CHECKLIST };
    }
  },
});

export const STYLE_RULES_MAX = 20_000;

export const getStyle = defineOperation({
  name: "story.get_style",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "The product's Story style: the design system every Story page follows, with its rules and stylesheet. Also lists the house styles.",
  description:
    "Read this before writing or restyling any page, and paste the stylesheet into the page's <style>. style is null until someone sets one: then ask the person whether their company has a design system to follow, or offer a house style (guidance with house_style shows one in full), and save the choice with set_style. kind is house (adopted from a house style, possibly adapted) or team (the team's own design system). include_stylesheet false leaves the CSS out. To see a page in the style, preview it: the page a preview serves carries the stylesheet where publish puts it, so a page published with body never needs the CSS from here.",
  input: z.strictObject({ include_stylesheet: z.boolean().default(true) }),
  rest: { method: "GET", path: "/story/style" },
  mcp: { tool: "story", action: "get_style" },
  async handler(ctx, input) {
    const s = await loadStyle(ctx);
    return { style: s ? styleView(s, input.include_stylesheet) : null, house_styles: catalogue() };
  },
});

export const setStyle = defineOperation({
  name: "story.set_style",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Set the product's Story style: adopt a house style, or save the team's own design system as one stylesheet and its rules.",
  description:
    `house_style adopts a house style whole (${HOUSE_STYLE_IDS.join(", ")}); pass other fields with it to adapt it. Without house_style, fields you omit carry forward from the current style; the first style needs name, rules and stylesheet, and is the team's own. Pass based_on: null when you replace an adopted house style with the team's own design system. A team stylesheet should style the shared vocabulary (guidance → vocabulary) so pages can move between styles; the app previews it on a sample page unless you pass specimen_html, a page in the style, validated like a Story page. The stylesheet follows the same rules as a page's <style>: no @import and data: URIs only. A typeface WhatBuild carries (guidance → carried_typefaces) needs no font file: name it in quotes in font-family. expected_etag is the style's etag, required once a style exists. Setting a style does not restyle published pages: republish them in the new style.`,
  input: z.strictObject({
    house_style: z.enum(HOUSE_STYLE_IDS).optional().describe("Adopt this house style."),
    name: z.string().trim().min(1).max(80).optional(),
    summary: z.string().trim().max(300).optional(),
    rules: z.string().min(1).max(STYLE_RULES_MAX).optional().describe("Markdown: the style's character, type, colour, signature moves and what to avoid."),
    stylesheet: z.string().min(1).max(STORY_CSS_MAX).optional(),
    specimen_html: z.string().max(STORY_HTML_MAX).nullable().optional().describe("A page that shows the style; null returns to the sample page."),
    based_on: z.enum(HOUSE_STYLE_IDS).nullable().optional().describe("The house style this adapts, or null when it is the team's own design system. Carried forward when omitted."),
    expected_etag: expectedEtag.optional().describe("The style's etag from get_style. Required once a style exists."),
  }),
  rest: { method: "PUT", path: "/story/style" },
  mcp: { tool: "story", action: "set_style" },
  async handler(ctx, input) {
    const current = await loadStyle(ctx, true);
    if (current) {
      if (input.expected_etag === undefined) throw conflict("stale_etag", "This product already has a Story style; read it with get_style and pass its etag as expected_etag.", { current_etag: current.etag });
      checkEtag(input.expected_etag, current.etag, "Story style");
    }
    const house = input.house_style ? houseStyle(input.house_style)! : undefined;
    const start = house
      ? { name: house.name, summary: house.summary, based_on: house.id as string | null, rules: house.rules, stylesheet: house.stylesheet, specimen_html: null as string | null }
      : current
        ? { name: current.name, summary: current.summary, based_on: current.based_on, rules: current.rules, stylesheet: current.stylesheet, specimen_html: current.specimen_html }
        : null;
    if (!start && (!input.name || !input.rules || !input.stylesheet))
      throw invalid("invalid_input", "The first Story style needs house_style, or name, rules and stylesheet for the team’s own design system.");
    const next = {
      name: input.name ?? start!.name,
      summary: input.summary ?? start?.summary ?? "",
      based_on: input.based_on !== undefined ? input.based_on : (start?.based_on ?? null),
      rules: input.rules ?? start!.rules,
      stylesheet: input.stylesheet ?? start!.stylesheet,
      specimen_html: input.specimen_html !== undefined ? input.specimen_html : (start?.specimen_html ?? null),
    };
    const problems = [...inspectStoryCss(next.stylesheet), ...(next.specimen_html !== null ? inspectStoryHtml(next.specimen_html).map((p) => `Specimen: ${p}`) : [])];
    if (problems.length) throw invalid("invalid_style", `The Story style was not saved: ${problems.join(" ")}`, { problems });
    if (current && (["name", "summary", "based_on", "rules", "stylesheet", "specimen_html"] as const).every((k) => current[k] === next[k]))
      return { style: styleView(current, false), changed: false };
    const etag = newEtag();
    const row = { ...next, etag, updated_at: ctx.now, updated_by: json(ctx.actor) };
    if (current) await ctx.db.updateTable("story_styles").set(row).where("product_id", "=", productId(ctx)).execute();
    else await ctx.db.insertInto("story_styles").values({ ...row, product_id: productId(ctx), tenant_id: tenantId(ctx) }).execute();
    await recordActivity(ctx, {
      action: current ? "updated" : "created",
      entity_type: "story_style",
      entity_id: productId(ctx),
      entity_title: next.name,
      summary: house ? `Adopted the ${house.name} house style for the Story` : current ? "Updated the Story style" : "Set the team's design system as the Story style",
    });
    return { style: styleView((await loadStyle(ctx))!, false), changed: true };
  },
});

export const listPages = defineOperation({
  name: "story.list_pages",
  scope: "product",
  access: "story",
  mutates: false,
  summary: "The Story's pages, without HTML: title, summary, current version and etag.",
  description: "Archived pages are left out unless include_archived; a reader (the Story-only role) is never given them. The hierarchy (get_hierarchy) is the reader's navigation.",
  input: z.strictObject({ include_archived: z.boolean().default(false) }),
  rest: { method: "GET", path: "/story/pages" },
  mcp: { tool: "story", action: "list_pages" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("story_pages").selectAll().where("product_id", "=", productId(ctx));
    if (!input.include_archived || readsOnlyTheStory(ctx.scope.role)) q = q.where("archived_at", "is", null);
    const rows = await q.orderBy("title").execute();
    return { items: rows.map(pageSummary) };
  },
});

export const NOTES_MAX = 20_000;

function notesView(p: { agent_notes: string; agent_notes_etag: string; agent_notes_updated_at: string | null; agent_notes_updated_by: unknown }) {
  return { content: p.agent_notes, etag: p.agent_notes_etag, updated_at: p.agent_notes_updated_at, updated_by: p.agent_notes_updated_by };
}

type ResolvedRef = { id: string; title: string | null; status: string | null; archived: boolean; missing: boolean };

/** A version's references with their current titles, so a reader can list them without a request per id. */
export async function resolveRefs(ctx: OpContext, refs: Refs): Promise<Record<keyof Refs, ResolvedRef[]>> {
  const pid = productId(ctx);
  const some = (ids: string[] | undefined) => (ids?.length ? ids : [""]);
  const [outcomes, sources, entries] = await Promise.all([
    ctx.db.selectFrom("outcomes").select(["outcome_id as id", "title", "archived_at"]).where("product_id", "=", pid).where("outcome_id", "in", some(refs.outcomes)).execute(),
    ctx.db.selectFrom("records").select(["record_id as id", "title", "archived_at"]).where("product_id", "=", pid).where("record_id", "in", some(refs.sources)).execute(),
    ctx.db
      .selectFrom("register_entries")
      .select(["entry_id as id", "statement", "status", "archived_at"])
      .where("product_id", "=", pid)
      .where("entry_id", "in", some(refs.assumptions))
      .execute(),
  ]);
  const missing = (id: string): ResolvedRef => ({ id, title: null, status: null, archived: false, missing: true });
  return {
    outcomes: (refs.outcomes ?? []).map((i) => {
      const o = outcomes.find((x) => x.id === i);
      return o ? { id: i, title: o.title, status: null, archived: Boolean(o.archived_at), missing: false } : missing(i);
    }),
    sources: (refs.sources ?? []).map((i) => {
      const r = sources.find((x) => x.id === i);
      return r ? { id: i, title: r.title, status: null, archived: Boolean(r.archived_at), missing: false } : missing(i);
    }),
    assumptions: (refs.assumptions ?? []).map((i) => {
      const r = entries.find((x) => x.id === i);
      return r ? { id: i, title: r.statement, status: r.status, archived: Boolean(r.archived_at), missing: false } : missing(i);
    }),
  };
}

/**
 * The HTML a version shows: its own, or the page of a mockup version it points at. Mockup versions
 * are immutable, so the Story holds the reference and never a copy.
 */
export async function shownHtml(db: Db, v: { html: string; mockup: MockupPageRef | null }): Promise<string> {
  if (!v.mockup) return v.html;
  const p = await db.selectFrom("mockup_pages").select("html").where("version_id", "=", v.mockup.mockup_version_id).where("page_id", "=", v.mockup.page_id).executeTakeFirst();
  return p?.html ?? "";
}

/** What a reader needs to lay out a mockup page (its size); the team also sees which mockup and version it is. */
async function mockupView(ctx: OpContext, ref: MockupPageRef) {
  const page = await ctx.db.selectFrom("mockup_pages").select(["title", "width", "height"]).where("version_id", "=", ref.mockup_version_id).where("page_id", "=", ref.page_id).executeTakeFirst();
  const size = { width: page?.width ?? 1280, height: page?.height ?? 800 };
  if (readsOnlyTheStory(ctx.scope.role)) return size;
  const m = await ctx.db.selectFrom("mockups").select(["title", "version_count", "archived_at"]).where("product_id", "=", productId(ctx)).where("mockup_id", "=", ref.mockup_id).executeTakeFirst();
  return {
    ...size,
    mockup_id: ref.mockup_id,
    mockup_title: m?.title ?? null,
    version: ref.version,
    page_id: ref.page_id,
    page_title: page?.title ?? null,
    current_version: m?.version_count ?? null,
    mockup_archived: Boolean(m?.archived_at),
  };
}

/**
 * A version as its reader may see it. A Story reader gets the page itself and how it was published;
 * what it draws on (refs, cited passages) belongs to the evidence, which a reader does not browse.
 */
async function versionView(ctx: OpContext, versionId: string, withHtml: boolean) {
  const v = await ctx.db.selectFrom("story_versions").selectAll().where("version_id", "=", versionId).where("product_id", "=", productId(ctx)).executeTakeFirstOrThrow();
  const drawsOn = readsOnlyTheStory(ctx.scope.role)
    ? {}
    : { refs: v.refs, resolved_refs: await resolveRefs(ctx, v.refs), citations: await citationViews(ctx, v.citations) };
  return {
    version_id: v.version_id,
    version: v.n,
    page_id: v.page_id,
    title: v.title,
    summary: v.summary,
    ...drawsOn,
    ...(v.mockup ? { mockup: await mockupView(ctx, v.mockup) } : {}),
    published_at: v.created_at,
    published_by: v.created_by,
    ...(await htmlFields(ctx, v, withHtml)),
  };
}

async function htmlFields(ctx: OpContext, v: { html: string; mockup: MockupPageRef | null }, withHtml: boolean) {
  const html = await shownHtml(ctx.db, v);
  return { html_sha256: sha256Hex(html), ...(withHtml ? { html } : { html_chars: html.length }) };
}

export const getPage = defineOperation({
  name: "story.get_page",
  scope: "product",
  access: "story",
  mutates: false,
  summary: "Read a Story page's current version, with its HTML, citations, notes for agents, and the page etag you need to publish again.",
  description:
    "404 means the page has never been published. An archived page stays readable here, except to a reader (the Story-only role), who gets 404 for it. Read this before revising a page, and keep what is useful. agent_notes holds what agents keep about the page — its purpose, sources still to fold in, choices about its structure — with its own etag for write_notes; read it before revising. include_html false leaves out the HTML (html_chars and html_sha256 stay). A reader (the Story-only role) gets the page without agent_notes, refs, resolved_refs or citations.",
  input: z.strictObject({ page_id: pageId, include_html: z.boolean().default(true) }),
  rest: { method: "GET", path: "/story/pages/:page_id" },
  mcp: { tool: "story", action: "get_page" },
  async handler(ctx, input) {
    const p = await loadReadablePage(ctx, input.page_id);
    const notes = readsOnlyTheStory(ctx.scope.role) ? {} : { agent_notes: notesView(p) };
    return { ...pageSummary(p), ...notes, current: await versionView(ctx, p.current_version_id, input.include_html) };
  },
});

export const listVersions = defineOperation({
  name: "story.list_versions",
  scope: "product",
  access: "story",
  mutates: false,
  summary: "A page's published versions, newest first, without HTML.",
  description:
    "Versions are immutable and numbered 1, 2, 3…; read any one with get_version, and restore one with publish from_version. html_sha256 tells versions with identical HTML apart without reading it. A reader (the Story-only role) gets 404 for an archived page.",
  input: z.strictObject({ page_id: pageId, limit: z.number().int().min(1).max(100).default(25), before: z.number().int().min(1).optional().describe("Only versions numbered below this.") }),
  rest: { method: "GET", path: "/story/pages/:page_id/versions" },
  mcp: { tool: "story", action: "list_versions" },
  async handler(ctx, input) {
    await loadReadablePage(ctx, input.page_id);
    let q = ctx.db
      .selectFrom("story_versions")
      .select(["version_id", "n", "title", "summary", "created_at", "created_by", "citations"])
      .select(
        sql<string>`encode(sha256(convert_to(coalesce((select mp.html from mockup_pages mp where mp.version_id = story_versions.mockup->>'mockup_version_id' and mp.page_id = story_versions.mockup->>'page_id'), html), 'UTF8')), 'hex')`.as("html_sha256"),
      )
      .where("product_id", "=", productId(ctx))
      .where("page_id", "=", input.page_id);
    if (input.before) q = q.where("n", "<", input.before);
    const rows = await q.orderBy("n", "desc").limit(input.limit + 1).execute();
    const reader = readsOnlyTheStory(ctx.scope.role);
    const items = rows.slice(0, input.limit).map((v) => ({ version_id: v.version_id, version: v.n, title: v.title, summary: v.summary, ...(reader ? {} : { citation_count: v.citations.length }), html_sha256: v.html_sha256, published_at: v.created_at, published_by: v.created_by }));
    return { items, next_before: rows.length > input.limit ? items[items.length - 1]!.version : null };
  },
});

export const getVersion = defineOperation({
  name: "story.get_version",
  scope: "product",
  access: "story",
  mutates: false,
  summary: "Read one published version of a page, by number.",
  description: "Includes the page's current archived_at, so someone browsing history still sees an archive notice. A reader (the Story-only role) gets it without refs, resolved_refs or citations, and gets 404 for an archived page.",
  input: z.strictObject({ page_id: pageId, version: z.number().int().min(1), include_html: z.boolean().default(true) }),
  rest: { method: "GET", path: "/story/pages/:page_id/versions/:version" },
  mcp: { tool: "story", action: "get_version" },
  async handler(ctx, input) {
    const p = await loadReadablePage(ctx, input.page_id);
    const v = await ctx.db.selectFrom("story_versions").select("version_id").where("product_id", "=", productId(ctx)).where("page_id", "=", input.page_id).where("n", "=", input.version).executeTakeFirst();
    if (!v) throw notFound(`Page "${input.page_id}" has no version ${input.version}.`);
    return { ...(await versionView(ctx, v.version_id, input.include_html)), page_archived_at: p.archived_at, is_current: v.version_id === p.current_version_id };
  },
});

/**
 * The page generated when a first version omits html: its title and summary, in the product's Story
 * style when it has one and in a plain page otherwise.
 */
function titlePageHtml(title: string, summary: string, stylesheet: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${stylesheet}</style></head><body><main class="page"><header class="opening"><h1>${escapeHtml(title)}</h1>${summary ? `<p class="lead">${escapeHtml(summary)}</p>` : ""}</header></main></body></html>`;
}

/** The title page as it was generated before Story styles, so an old one is still recognised. */
function legacyTitlePageHtml(title: string, summary: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style></style></head><body><main class="wb-page wb-prose"><h1>${escapeHtml(title)}</h1>${summary ? `<p class="wb-lead">${escapeHtml(summary)}</p>` : ""}</main></body></html>`;
}

/** Whether html is a generated title page for this title and summary, under any stylesheet. */
function isTitlePage(html: string, title: string, summary: string) {
  const unstyled = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/, "<style></style>");
  const u = unstyled(html);
  return u === unstyled(titlePageHtml(title, summary, "")) || u === legacyTitlePageHtml(title, summary);
}

async function titleStylesheet(ctx: OpContext) {
  return (await loadStyle(ctx))?.stylesheet ?? PLAIN_STYLESHEET;
}

/**
 * A page from its body alone: the markup that goes inside <body>, wrapped in a document that carries
 * the product's Story style. An agent then never sends the stylesheet, and every page has the same one.
 */
function bodyDocument(title: string, stylesheet: string, body: string) {
  if (/<!doctype|<\/?(?:html|head|body)[\s>]/i.test(body))
    throw invalid("invalid_input", "body is the markup inside <body>, usually one <main class=\"page\">: leave out the doctype, <html>, <head> and <body>. Send html for a whole document.");
  return pageDocument(title, stylesheet, body.trim());
}

/** The same page under another stylesheet: the first <style> block is replaced, the rest kept. */
function restyled(html: string, stylesheet: string) {
  const block = /<style>[\s\S]*?<\/style>/;
  if (!block.test(html)) throw invalid("invalid_input", "This page has no <style> block to replace. Publish it again with body, which takes the product’s Story style.");
  return html.replace(block, () => `<style>\n${stylesheet}</style>`);
}

/** Apply exact find/replace edits in order; each find must occur exactly once in the text it meets. */
function patchHtml(html: string, edits: { find: string; replace: string }[], refused: string) {
  const problems: string[] = [];
  let out = html;
  edits.forEach(({ find, replace }, i) => {
    const at = out.indexOf(find);
    if (at < 0) problems.push(`Edit ${i + 1}: its find text does not occur in the HTML.`);
    else if (out.indexOf(find, at + 1) >= 0) problems.push(`Edit ${i + 1}: its find text occurs more than once; include more context.`);
    else out = out.slice(0, at) + replace + out.slice(at + find.length);
  });
  if (problems.length) throw invalid("invalid_patch", `${refused}: ${problems.join(" ")}`, { problems });
  return out;
}

/** The fields a later version takes from its base version when the call omits them. */
const CARRIED = ["title", "summary", "html", "refs", "citations"] as const;

const publishInput = z.strictObject({
  page_id: pageId.default("overview"),
  title: z.string().trim().min(1).max(200).optional().describe("Required on a page's first version; omit it later to keep the title."),
  summary: z.string().max(2000).optional().describe("A short description of the page, shown in navigation and lists. Omit it on a later version to keep it."),
  html: z.string().min(1).max(STORY_HTML_MAX).optional().describe("The whole page. On a first version, omit it for a generated title page; on a later version, omit it to keep the HTML."),
  body: z
    .string()
    .min(1)
    .max(STORY_HTML_MAX)
    .optional()
    .describe('Instead of html: only the markup inside <body>, usually one <main class="page">. WhatBuild wraps it in a document with the product\'s Story style stylesheet, so you never send the stylesheet.'),
  restyle: z.boolean().optional().describe("A later version only, instead of html, body or patch_html: keep the page and replace its stylesheet with the product's current Story style. Use it on each page after set_style."),
  patch_html: z
    .array(z.strictObject({ find: z.string().min(1).max(20_000), replace: z.string().max(100_000) }))
    .min(1)
    .max(50)
    .optional()
    .describe("A later version only, instead of html: exact find/replace edits applied in order to the base version's HTML. Each find must occur exactly once, or nothing is published."),
  refs: refsInput.describe("The objects the page draws on, in full. Omit it on a later version to keep the refs."),
  citations: z
    .array(citationInput)
    .max(CITATION_MAX_COUNT)
    .optional()
    .describe(`Up to ${CITATION_MAX_COUNT} exact passages the page draws on, in full: {record_id, seq_start, seq_end, quote?}. Read each passage first. Omit it on a later version to keep the citations.`),
  from_version: z.number().int().min(1).optional().describe("Start from this earlier version instead of the current one: omitted fields are taken from it. Alone, it restores that version as a new one."),
  expected_etag: expectedEtag.optional(),
});

type PublishInput = z.output<typeof publishInput>;

/**
 * The version a publish call makes, with every check story.publish makes, in its order, and
 * nothing written. publish stores it and preview shows it, so the two never disagree. `refused`
 * begins each refusal that lists problems: what publish did, or what it would do.
 */
async function draftVersion(ctx: OpContext, input: PublishInput, opts: { lock: boolean; refused: string }) {
  const pid = productId(ctx);
  let pq = ctx.db.selectFrom("story_pages").selectAll().where("product_id", "=", pid).where("page_id", "=", input.page_id);
  if (opts.lock) pq = pq.forUpdate();
  const existing = await pq.executeTakeFirst();
  const ways = [input.html !== undefined && "html", input.body !== undefined && "body", input.patch_html && "patch_html", input.restyle && "restyle"].filter(Boolean);
  if (ways.length > 1) throw invalid("invalid_input", `Pass one of html, body, patch_html and restyle, not ${ways.join(" and ")}.`);
  if (!existing) {
    if (input.expected_etag) throw conflict("stale_etag", `Page "${input.page_id}" doesn’t exist yet; omit expected_etag for its first version.`);
    if (input.from_version) throw notFound(`Page "${input.page_id}" has never been published, so it has no version ${input.from_version}.`);
    if (!input.title) throw invalid("invalid_input", "A page’s first version needs a title.");
    if (input.patch_html) throw invalid("invalid_input", "patch_html edits an earlier version; a page’s first version needs html or body.");
    if (input.restyle) throw invalid("invalid_input", "restyle changes an earlier version’s stylesheet; a page’s first version needs html or body.");
    const summary = input.summary ?? "";
    const html = input.html ?? (input.body !== undefined ? bodyDocument(input.title, await titleStylesheet(ctx), input.body) : titlePageHtml(input.title, summary, await titleStylesheet(ctx)));
    const problems = inspectStoryHtml(html);
    if (problems.length) throw invalid("invalid_html", `${opts.refused}: ${problems.join(" ")}`, { problems });
    const refs = await validateRefs(ctx, input.refs ?? EMPTY_REFS);
    const citations = await snapshotAll(ctx, input.citations ?? [], "page version");
    const count = await ctx.db.selectFrom("story_pages").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst();
    if (Number(count?.n ?? 0) >= MAX_PAGES) throw conflict("quota_exceeded", `A product’s Story holds at most ${MAX_PAGES} pages.`, { quota: "story_pages", limit: MAX_PAGES, used: Number(count?.n ?? 0), unit: "pages" });
    return { existing: null, n: 1, title: input.title, summary, html, refs, citations, mockup: null, carried: [] as (typeof CARRIED)[number][], based_on_version: null };
  }
  if (existing.archived_at) throw conflict("page_archived", `Page "${input.page_id}" is archived; restore it before publishing.`);
  if (!input.expected_etag) throw conflict("stale_etag", `Page "${input.page_id}" exists; read it with get_page and pass its etag.`, { current_etag: existing.etag });
  checkEtag(input.expected_etag, existing.etag, "story page");
  let base = ctx.db.selectFrom("story_versions").select(["n", "title", "summary", "html", "refs", "citations", "mockup"]).where("product_id", "=", pid).where("page_id", "=", input.page_id);
  base = input.from_version ? base.where("n", "=", input.from_version) : base.where("version_id", "=", existing.current_version_id);
  const from = await base.executeTakeFirst();
  if (!from) throw notFound(`Page "${input.page_id}" has no version ${input.from_version}; its versions run from 1 to ${existing.version_count}.`, { version_count: existing.version_count });
  const carried = CARRIED.filter((f) => input[f] === undefined && !(f === "html" && ways.length > 0));
  const title = input.title ?? from.title;
  const summary = input.summary ?? from.summary;
  if (from.mockup && (input.patch_html || input.restyle))
    throw invalid("invalid_input", `Version ${from.n} shows page "${from.mockup.page_id}" of a mockup, so it has no HTML of its own to ${input.patch_html ? "patch" : "restyle"}. Send html or body to replace it, or promote_mockup to show another version of the mockup page.`);
  if (input.restyle && !(await loadStyle(ctx))) throw conflict("no_story_style", "This product has no Story style to restyle the page in. Set one with set_style first.");
  // A version that shows a mockup page keeps showing it until html or body replaces it.
  const keepsMockup = from.mockup && input.html === undefined && input.body === undefined ? from.mockup : null;
  // A generated title page follows a new title or summary rather than keeping the old one.
  const html = keepsMockup
    ? ""
    : input.html ??
    (input.body !== undefined
      ? bodyDocument(title, await titleStylesheet(ctx), input.body)
      : input.patch_html
        ? patchHtml(from.html, input.patch_html, opts.refused)
        : input.restyle
          ? restyled(from.html, await titleStylesheet(ctx))
          : isTitlePage(from.html, from.title, from.summary)
            ? titlePageHtml(title, summary, await titleStylesheet(ctx))
            : from.html);
  const problems = keepsMockup ? [] : inspectStoryHtml(html);
  if (problems.length) throw invalid("invalid_html", `${opts.refused}: ${problems.join(" ")}`, { problems });
  const refs = input.refs ? await validateRefs(ctx, input.refs) : from.refs;
  const citations = input.citations ? await snapshotAll(ctx, input.citations, "page version") : from.citations;
  return { existing, n: existing.version_count + 1, title, summary, html, refs, citations, mockup: keepsMockup, carried, based_on_version: input.from_version ?? existing.version_count };
}

export const publish = defineOperation({
  name: "story.publish",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Publish a new version of a Story page (creating the page on its first version). A later version keeps whatever you omit.",
  description:
    `Call guidance first, and get_page before revising (read its agent_notes too). Send the same call to preview first: it checks everything publish checks and gives you the exact page to look at, publishing nothing. A page's first version: omit expected_etag, give a title, and give body (or html for a whole document of your own, or neither for a generated title page). Prefer body: it is only the markup inside <body>, and WhatBuild puts the product's Story style around it, so the stylesheet is never sent and every page carries the same one. A later version: pass the page etag and send only what changes — the title, summary, html, refs and citations you omit are taken from the current version, and carried_forward in the result names them. To change a sentence, patch_html applies exact find/replace edits instead of re-sending the page. After set_style, restyle: true gives a page the new stylesheet and keeps its content. from_version: N starts from that earlier version instead, so from_version alone restores it as a new version; compare html_sha256 to confirm the HTML is identical. Pass an empty list to clear refs or citations. The HTML is validated and every problem is listed at once (422). citations lists up to ${CITATION_MAX_COUNT} exact passages the page draws on, {record_id, seq_start, seq_end, quote?}, each frozen as a snapshot, as an assumption's citations are; carried citations keep their snapshots. summary describes the page itself. Publishing never places the page in the navigation: call set_hierarchy afterwards, and update the page's notes with write_notes (agent_notes_etag is in the result). If a response is lost, sending the same call again is safe: once the version has landed it fails with stale_etag, and get_page shows it. Never invent facts, owners or dates, and never present an unconfirmed assumption as settled.`,
  input: publishInput,
  rest: { method: "POST", path: "/story/pages/:page_id/versions" },
  mcp: { tool: "story", action: "publish" },
  async handler(ctx, input) {
    const pid = productId(ctx);
    const d = await draftVersion(ctx, input, { lock: true, refused: "The page was not published" });
    const version_id = newId();
    const values = { version_id, tenant_id: tenantId(ctx), product_id: pid, page_id: input.page_id, n: d.n, title: d.title, summary: d.summary, html: d.html, refs: json(d.refs), citations: json(d.citations), created_by: json(ctx.actor) };
    if (!d.existing) {
      await ctx.db.insertInto("story_versions").values({ ...values, previous_version_id: null }).execute();
      await ctx.db
        .insertInto("story_pages")
        .values({ tenant_id: tenantId(ctx), product_id: pid, page_id: input.page_id, title: d.title, summary: d.summary, current_version_id: version_id, version_count: 1, etag: newEtag(), agent_notes_etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor) })
        .execute();
      await recordActivity(ctx, { action: "published", entity_type: "story_page", entity_id: input.page_id, entity_title: d.title, summary: "Published the first version" });
    } else {
      await ctx.db.insertInto("story_versions").values({ ...values, mockup: d.mockup ? json(d.mockup) : null, previous_version_id: d.existing.current_version_id }).execute();
      await ctx.db
        .updateTable("story_pages")
        .set({ title: d.title, summary: d.summary, current_version_id: version_id, version_count: d.n, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
        .where("product_id", "=", pid)
        .where("page_id", "=", input.page_id)
        .execute();
      await recordActivity(ctx, { action: "updated", entity_type: "story_page", entity_id: input.page_id, entity_title: d.title, summary: `Published version ${d.n}${input.from_version ? ` from version ${input.from_version}` : ""}` });
    }
    const p = await loadPage(ctx, input.page_id);
    return {
      ...pageSummary(p),
      current: await versionView(ctx, p.current_version_id, false),
      based_on_version: d.based_on_version,
      carried_forward: d.carried,
      agent_notes_etag: p.agent_notes_etag,
      placed: await isPlaced(ctx, input.page_id),
    };
  },
});

/** The grant purpose that GETs a preview's document. */
export const STORY_PREVIEW_PURPOSE = "story_preview";
/** The previews a product keeps at once; a new one beyond them drops the oldest. */
export const PREVIEWS_KEPT = 20;

export const preview = defineOperation({
  name: "story.preview",
  scope: "product",
  access: "write",
  mutates: false,
  summary: "Check a publish without publishing: the same call, every check publish makes, and a short-lived grant to GET the exact page it would store.",
  description:
    `Send exactly what you would send to publish. preview makes every check publish makes, and refuses with the same error where publish would (422 invalid_html listing every problem, 409 stale_etag, 404 for an unknown from_version…); it creates no version, records no activity and changes nothing anyone sees. Otherwise it returns what publish would make (new_page, based_on_version, carried_forward, title, summary, html_chars, html_sha256) and a grant: GET url with exactly the headers given to receive the document publish would store, served as a published page is, in the same sandbox and with the carried typefaces embedded. Add ?theme=light or ?theme=dark for the app's light and dark schemes; without one the page follows the browser's. Open it in a browser at desktop width (1280) and phone width (390), in light and dark, and look at it; a headless browser takes the headers as extra HTTP headers (Playwright: new_context(extra_http_headers=headers, viewport=…)). When it looks right, send the same params to publish: its html_sha256 matches the preview's unless the page or the Story style changed in between. The grant expires (expires_at) and a product keeps its ${PREVIEWS_KEPT} newest previews; preview again for a new one. Keep the grant header out of reports and logs.`,
  input: publishInput,
  rest: { method: "POST", path: "/story/pages/:page_id/preview" },
  mcp: { tool: "story", action: "preview" },
  async handler(ctx, input) {
    // A preview answers whether publish would, so it is refused wherever publish would be.
    if (ctx.scope.product!.archived_at) throw conflict("product_archived", `Product ${ctx.scope.product!.name} is archived and read-only. Restore it first.`);
    if (ctx.sandbox?.visitor) refuseVisitorWrite(ctx.sandbox, { name: "story.preview", mutates: true });
    const d = await draftVersion(ctx, input, { lock: false, refused: "The page would not be published" });
    const shown = await shownHtml(ctx.db, d);
    const pid = productId(ctx);
    // A preview lives as long as its grant, and a product keeps only its newest ones.
    const kept = await ctx.db.selectFrom("story_previews").select("preview_id").where("product_id", "=", pid).where("expires_at", ">", ctx.now).orderBy("created_at", "desc").orderBy("preview_id", "desc").limit(PREVIEWS_KEPT - 1).execute();
    let drop = ctx.db.deleteFrom("story_previews").where("product_id", "=", pid);
    if (kept.length) drop = drop.where("preview_id", "not in", kept.map((k) => k.preview_id));
    await drop.execute();
    const preview_id = newId();
    const expiresAt = new Date(Date.parse(ctx.now) + ctx.ports.config.grantTtlSeconds * 1000);
    await ctx.db
      .insertInto("story_previews")
      .values({ preview_id, tenant_id: tenantId(ctx), product_id: pid, page_id: input.page_id, html: shown, shows_mockup: Boolean(d.mockup), created_by: json(ctx.actor), expires_at: expiresAt.toISOString(), created_at: ctx.now })
      .execute();
    const token = ctx.ports.grants.sign({ v: 1, purpose: STORY_PREVIEW_PURPOSE, t: tenantId(ctx), sp: preview_id, exp: Math.floor(expiresAt.getTime() / 1000) });
    return {
      page_id: input.page_id,
      new_page: !d.existing,
      based_on_version: d.based_on_version,
      carried_forward: d.carried,
      title: d.title,
      summary: d.summary,
      ...(d.mockup ? { shows_mockup: { mockup_id: d.mockup.mockup_id, version: d.mockup.version, page_id: d.mockup.page_id } } : {}),
      html_chars: shown.length,
      html_sha256: sha256Hex(shown),
      published: false,
      preview: {
        preview_id,
        method: "GET",
        url: `${ctx.ports.config.publicBaseUrl}/api/v1/downloads/story-preview/${preview_id}`,
        headers: { [DOWNLOAD_GRANT_HEADER]: token },
        expires_at: expiresAt.toISOString(),
      },
      next: "GET url with these headers in a browser at 1280 and 390 wide, adding ?theme=light and ?theme=dark, and look at each. Then send the same params to publish. Keep the grant header out of reports and logs.",
    };
  },
});

async function storedHierarchy(ctx: OpContext) {
  return ctx.db.selectFrom("story_hierarchies").selectAll().where("product_id", "=", productId(ctx)).executeTakeFirst();
}

function flatten(nodes: StoryNode[]): string[] {
  return nodes.flatMap((n) => [n.page_id, ...flatten(n.children)]);
}

/** Whether a page appears in the navigation: in the tree, or among the Published mockups, where every live page showing a mockup page appears. */
async function isPlaced(ctx: OpContext, page: string) {
  const h = await resolvedHierarchy(ctx);
  return flatten(h.items).includes(page) || h.mockups.some((m) => m.page_id === page);
}

export const getHierarchy = defineOperation({
  name: "story.get_hierarchy",
  scope: "product",
  access: "story",
  mutates: false,
  summary: "The Story's navigation: the page tree, then the Published mockups in order, with its own etag and each page's current title and summary.",
  description:
    "items is the tree as saved, so it round-trips: send it back to set_hierarchy as it is, or with pages added or moved. A stored node whose page is missing, archived or showing a mockup page is skipped and its children promoted into its place. unplaced lists the live pages not yet placed, {page_id, title, description}, overview first then by title; they are never in items, and readers see them at the end of the tree until you place one by adding it to items. mockups is the Published mockups section: every live page whose current version shows a page of a mockup (story.promote_mockup), flat, in the order set_hierarchy gave, then any not yet ordered, in the order their current versions were published. Every live page appears exactly once: in items, in unplaced or in mockups. etag is null before the first save.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/story/hierarchy" },
  mcp: { tool: "story", action: "get_hierarchy" },
  async handler(ctx) {
    return resolvedHierarchy(ctx);
  },
});

/** The product's live pages, and whether each one's current version shows a page of a mockup. */
async function livePages(ctx: OpContext) {
  const pages = await ctx.db
    .selectFrom("story_pages as p")
    .innerJoin("story_versions as v", "v.version_id", "p.current_version_id")
    .select(["p.page_id", "p.title", "p.summary", "v.created_at as published_at", sql<boolean>`v.mockup is not null`.as("shows_mockup")])
    .where("p.product_id", "=", productId(ctx))
    .where("p.archived_at", "is", null)
    .execute();
  return new Map(pages.map((p) => [p.page_id, p]));
}

async function resolvedHierarchy(ctx: OpContext) {
  const h = await storedHierarchy(ctx);
  const live = await livePages(ctx);
  const used = new Set<string>();
  type Enriched = { page_id: string; title: string; description: string; children: Enriched[] };
  // A page showing a mockup page belongs to the Published mockups, so the tree skips it as it skips an archived one.
  const resolve = (nodes: StoryNode[]): Enriched[] =>
    nodes.flatMap((n) => {
      const p = live.get(n.page_id);
      const kids = resolve(n.children);
      if (!p || p.shows_mockup || used.has(n.page_id)) return kids;
      used.add(n.page_id);
      return [{ page_id: p.page_id, title: p.title, description: p.summary, children: kids }];
    });
  const items = resolve(h?.items ?? []);
  const unplaced = [...live.values()]
    .filter((p) => !p.shows_mockup && !used.has(p.page_id))
    .sort((a, b) => (a.page_id === "overview" ? -1 : b.page_id === "overview" ? 1 : a.title.localeCompare(b.title) || a.page_id.localeCompare(b.page_id)))
    .map((p) => ({ page_id: p.page_id, title: p.title, description: p.summary }));
  const ordered = uniq(h?.mockups ?? []).flatMap((id) => {
    const p = live.get(id);
    return p?.shows_mockup ? [p] : [];
  });
  const later = [...live.values()]
    .filter((p) => p.shows_mockup && !ordered.includes(p))
    .sort((a, b) => a.published_at.localeCompare(b.published_at) || a.page_id.localeCompare(b.page_id));
  const mockups = [...ordered, ...later].map((p) => ({ page_id: p.page_id, title: p.title, description: p.summary }));
  return { etag: h?.etag ?? null, items, unplaced, mockups, updated_at: h?.updated_at ?? null };
}

// title and description are accepted so get_hierarchy's items can be sent back as they are; only page_id and children are stored.
type NodeInput = StoryNode & { title?: string; description?: string };
const nodeSchema: z.ZodType<NodeInput> = z.lazy(() =>
  z.strictObject({ page_id: pageId, title: z.string().optional(), description: z.string().optional(), children: z.array(nodeSchema).default([]) }),
) as z.ZodType<NodeInput>;
const bareNodes = (nodes: NodeInput[]): StoryNode[] => nodes.map((n) => ({ page_id: n.page_id, children: bareNodes(n.children) }));

export const setHierarchy = defineOperation({
  name: "story.set_hierarchy",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Replace the Story's navigation tree, and order its Published mockups. Uses the hierarchy's own etag; never touches page content.",
  description: `items is the whole tree, not a patch: nodes are {page_id, children}; the title and description get_hierarchy adds are accepted and ignored, so its items can be sent back as they are. Each page at most once, depth at most ${MAX_DEPTH}, every page live and published, and none showing a mockup page: those are always in the Published mockups section, never in the tree. Pages you leave out of items become unplaced; to place an unplaced page, add it to items. mockups orders that section, a flat list of the page ids that show mockup pages; ones you leave out follow in the order their current versions were published, and omitting mockups keeps the order as it is. Pass expected_etag from get_hierarchy; before the first save its etag is null, and expected_etag may be null or left out.`,
  input: z.strictObject({
    items: z.array(nodeSchema).max(MAX_PAGES),
    mockups: z.array(pageId).max(MAX_PAGES).optional().describe("The order of the Published mockups: ids of pages whose current version shows a mockup page. Omit it to keep the order as it is."),
    expected_etag: expectedEtag.nullable().optional().describe("The etag get_hierarchy gave; null, or omitted, before the first save (get_hierarchy then gives etag: null)."),
  }),
  rest: { method: "PUT", path: "/story/hierarchy" },
  mcp: { tool: "story", action: "set_hierarchy" },
  async handler(ctx, input) {
    const h = await ctx.db.selectFrom("story_hierarchies").selectAll().where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
    if (h) {
      if (!input.expected_etag) throw conflict("stale_etag", "The hierarchy has been saved before; read it with get_hierarchy and pass its etag as expected_etag.", { current_etag: h.etag });
      checkEtag(input.expected_etag, h.etag, "story hierarchy");
    } else if (input.expected_etag) throw conflict("stale_etag", "No hierarchy has been saved yet; pass expected_etag null.");
    const ids = flatten(input.items);
    const order = input.mockups ?? null;
    const all = [...ids, ...(order ?? [])];
    const dup = all.find((x, i) => all.indexOf(x) !== i);
    if (dup) throw invalid("invalid_hierarchy", `Page "${dup}" appears more than once.`);
    const depth = (nodes: StoryNode[]): number => (nodes.length ? 1 + Math.max(...nodes.map((n) => depth(n.children))) : 0);
    if (depth(input.items) > MAX_DEPTH) throw invalid("invalid_hierarchy", `The tree is deeper than ${MAX_DEPTH} levels.`);
    const pages = all.length ? await ctx.db.selectFrom("story_pages").select(["page_id", "archived_at"]).where("product_id", "=", productId(ctx)).where("page_id", "in", all).execute() : [];
    const missing = all.filter((x) => !pages.some((p) => p.page_id === x));
    const archived = pages.filter((p) => p.archived_at).map((p) => p.page_id);
    if (missing.length) throw invalid("invalid_hierarchy", `Unpublished pages: ${missing.join(", ")}.`);
    if (archived.length) throw invalid("invalid_hierarchy", `Archived pages: ${archived.join(", ")}.`);
    const live = await livePages(ctx);
    const inTree = ids.filter((x) => live.get(x)?.shows_mockup);
    if (inTree.length) throw invalid("invalid_hierarchy", `These pages show mockup pages, so they belong in mockups, not items: ${inTree.join(", ")}.`);
    const notMockups = (order ?? []).filter((x) => !live.get(x)?.shows_mockup);
    if (notMockups.length) throw invalid("invalid_hierarchy", `These pages don’t show a mockup page, so they belong in items, not mockups: ${notMockups.join(", ")}.`);
    const etag = newEtag();
    const set = { items: json(bareNodes(input.items)), ...(order ? { mockups: json(order) } : {}), etag };
    if (h) await ctx.db.updateTable("story_hierarchies").set({ ...set, updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", productId(ctx)).execute();
    else await ctx.db.insertInto("story_hierarchies").values({ product_id: productId(ctx), tenant_id: tenantId(ctx), ...set, updated_by: json(ctx.actor) }).execute();
    const arranged = `Arranged ${ids.length} page${ids.length === 1 ? "" : "s"} in the navigation`;
    await recordActivity(ctx, { action: "organized", entity_type: "story_hierarchy", entity_id: null, entity_title: "Story navigation", summary: order ? `${arranged} and ordered ${order.length} published mockup${order.length === 1 ? "" : "s"}` : arranged });
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
  description: "The page and all its versions stay readable by id, except to a reader (the Story-only role), who is given no archived page. Restore returns it unplaced. Pass the page's etag.",
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
      const mockups = h.mockups.filter((x) => x !== p.page_id);
      await ctx.db.updateTable("story_hierarchies").set({ items: json(r.nodes), mockups: json(mockups), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", productId(ctx)).execute();
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
  summary: "Restore an archived Story page. It returns unplaced, or at the end of the Published mockups if it shows a mockup page; place it with set_hierarchy.",
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
    `Notes are not versioned with the HTML and readers do not see them on the page. Keep them short and current: what the page is for and who reads it, sources still to fold in, choices about its structure, and anything the next agent should not undo. Read them (get_page → agent_notes) before revising, and update them after publishing. The whole note is replaced. Pass the notes etag as expected_etag — agent_notes_etag from publish, or agent_notes.etag from get_page; it is not the page etag. While the notes are empty you may omit it. At most ${NOTES_MAX.toLocaleString("en-US")} characters; an empty string clears the notes.`,
  input: z.strictObject({
    page_id: pageId,
    notes: z.string().max(NOTES_MAX),
    expected_etag: expectedEtag.optional().describe("The notes etag (agent_notes_etag from publish, or agent_notes.etag from get_page). Optional while the notes are empty."),
  }),
  rest: { method: "PUT", path: "/story/pages/:page_id/notes" },
  mcp: { tool: "story", action: "write_notes" },
  async handler(ctx, input) {
    const p = await loadPage(ctx, input.page_id, true);
    if (input.expected_etag === undefined) {
      if (p.agent_notes)
        throw conflict("stale_etag", "This page already has notes for agents; read them (get_page → agent_notes) and pass agent_notes.etag as expected_etag.", { current_etag: p.agent_notes_etag });
    } else if (input.expected_etag === p.etag && p.etag !== p.agent_notes_etag) {
      throw conflict("stale_etag", "That is the page etag; the notes have their own. Pass agent_notes_etag from publish, or agent_notes.etag from get_page.", { current_etag: p.agent_notes_etag });
    } else checkEtag(input.expected_etag, p.agent_notes_etag, "page's notes");
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
    "Checks the current version unless version is given. Per citation: ok, relocated (text intact at another range, which it gives), text_changed, record_archived, record_deleted or record_missing, plus version_drift when the source's primary file has a newer version than the snapshot's. A matching quote establishes textual integrity only, not truth. valid is true when every citation is ok against the passages of each source's current file; rederived says a source was parsed again since a snapshot, so read those passages before relying on an ok.",
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

const mockupPageId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "a page_id on the mockup's canvas")
  .describe("The page on the mockup's canvas, by its page_id.");

/** A free Story slug from a mockup page's own: the same, or with -2, -3… when a page already has it. */
async function freeSlug(ctx: OpContext, want: string) {
  const taken = new Set((await ctx.db.selectFrom("story_pages").select("page_id").where("product_id", "=", productId(ctx)).execute()).map((p) => p.page_id));
  if (!taken.has(want)) return want;
  for (let i = 2; ; i++) {
    const next = `${want.slice(0, 80 - String(i).length - 1)}-${i}`;
    if (!taken.has(next)) return next;
  }
}

export const promoteMockup = defineOperation({
  name: "story.promote_mockup",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Show one page of a mockup in the Story: a Story page version that points at that page as it is in one mockup version, never a copy.",
  description:
    "page_id chooses the Story page. A page_id no page has yet creates the page under that id. The page_id of an existing page, with its etag, publishes that page's next version showing the mockup page, which is how a Story page moves to a newer mockup version: it never follows the mockup by itself. Without page_id, the new page's id is the mockup page's own slug, with -2, -3… if that is taken. A new page is titled with the mockup page's title unless you give one. Name the page_id when you can: if a response is lost, the same call sent again then fails with stale_etag instead of making a second page. version is the mockup version, the current one when omitted. The version takes the mockup version's refs and citations. The Story page shows the mockup page at its own size, scaled to fit, in the same sandbox; a Story reader sees it there and nothing else of the mockup. Publishing html or body on the page later replaces it with HTML of its own. The page joins the end of the Story's Published mockups, a section of its own after the navigation tree, where every page showing a mockup page appears and none of them is ever in the tree; reorder the section with set_hierarchy's mockups. Once html or body replaces the mockup page, the page leaves the section and is unplaced.",
  input: z.strictObject({
    mockup_id: id("mockup"),
    mockup_page_id: mockupPageId,
    version: z.number().int().min(1).optional().describe("The mockup version; the current one when omitted."),
    page_id: pageId
      .optional()
      .describe("The Story page. An id no page has yet creates the page under it; an existing page's id, with expected_etag, shows the mockup page there as its next version. Omitted, a new page takes the mockup page's slug (with -2, -3… if taken)."),
    title: z.string().trim().min(1).max(200).optional().describe("The Story page's title: the mockup page's title for a new page, or the page's own title for an existing one, when omitted."),
    summary: z.string().max(2000).optional().describe("A short description of the Story page."),
    expected_etag: expectedEtag.optional(),
  }),
  rest: { method: "POST", path: "/story/promote-mockup" },
  mcp: { tool: "story", action: "promote_mockup" },
  async handler(ctx, input) {
    const pid = productId(ctx);
    const m = await ctx.db.selectFrom("mockups").select(["mockup_id", "title", "version_count", "current_version_id"]).where("product_id", "=", pid).where("mockup_id", "=", input.mockup_id).executeTakeFirst();
    if (!m) throw notFound(`There is no mockup ${input.mockup_id} in this product.`);
    let vq = ctx.db.selectFrom("mockup_versions").select(["version_id", "n", "refs", "citations"]).where("mockup_id", "=", m.mockup_id);
    vq = input.version ? vq.where("n", "=", input.version) : vq.where("version_id", "=", m.current_version_id);
    const mv = await vq.executeTakeFirst();
    if (!mv) throw notFound(`Mockup ${m.mockup_id} has no version ${input.version}; its versions run from 1 to ${m.version_count}.`);
    const pages = await ctx.db.selectFrom("mockup_pages").select(["page_id", "title"]).where("version_id", "=", mv.version_id).orderBy("position").execute();
    const mp = pages.find((p) => p.page_id === input.mockup_page_id);
    if (!mp) throw notFound(`Version ${mv.n} of the mockup has no page "${input.mockup_page_id}". Its pages: ${pages.map((p) => p.page_id).join(", ")}.`, { pages: pages.map((p) => p.page_id) });

    const ref: MockupPageRef = { mockup_id: m.mockup_id, mockup_version_id: mv.version_id, version: mv.n, page_id: mp.page_id };
    const refs = { outcomes: mv.refs.outcomes ?? [], sources: mv.refs.sources ?? [], assumptions: mv.refs.assumptions ?? [] };
    const what = `"${mp.title}" from the mockup "${m.title}", version ${mv.n}`;
    const existing = input.page_id
      ? await ctx.db.selectFrom("story_pages").selectAll().where("product_id", "=", pid).where("page_id", "=", input.page_id).forUpdate().executeTakeFirst()
      : undefined;
    const version_id = newId();
    let pageIdOut: string;
    if (!existing) {
      if (input.expected_etag) throw conflict("stale_etag", `Page "${input.page_id}" doesn’t exist yet; omit expected_etag to create it.`);
      const count = await ctx.db.selectFrom("story_pages").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst();
      if (Number(count?.n ?? 0) >= MAX_PAGES) throw conflict("quota_exceeded", `A product’s Story holds at most ${MAX_PAGES} pages.`, { quota: "story_pages", limit: MAX_PAGES, used: Number(count?.n ?? 0), unit: "pages" });
      pageIdOut = input.page_id ?? (await freeSlug(ctx, mp.page_id));
      const title = input.title ?? mp.title;
      const summary = input.summary ?? `From the mockup "${m.title}", version ${mv.n}.`;
      await ctx.db
        .insertInto("story_versions")
        .values({ version_id, tenant_id: tenantId(ctx), product_id: pid, page_id: pageIdOut, n: 1, title, summary, html: "", refs: json(refs), citations: json(mv.citations), mockup: json(ref), previous_version_id: null, created_by: json(ctx.actor) })
        .execute();
      await ctx.db
        .insertInto("story_pages")
        .values({ tenant_id: tenantId(ctx), product_id: pid, page_id: pageIdOut, title, summary, current_version_id: version_id, version_count: 1, etag: newEtag(), agent_notes_etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor) })
        .execute();
      await recordActivity(ctx, { action: "published", entity_type: "story_page", entity_id: pageIdOut, entity_title: title, summary: `Promoted ${what}` });
    } else {
      if (existing.archived_at) throw conflict("page_archived", `Page "${existing.page_id}" is archived; restore it before publishing.`);
      if (!input.expected_etag) throw conflict("stale_etag", `Page "${existing.page_id}" exists; read it with get_page and pass its etag.`, { current_etag: existing.etag });
      checkEtag(input.expected_etag, existing.etag, "story page");
      pageIdOut = existing.page_id;
      const title = input.title ?? existing.title;
      const summary = input.summary ?? existing.summary;
      const n = existing.version_count + 1;
      await ctx.db
        .insertInto("story_versions")
        .values({ version_id, tenant_id: tenantId(ctx), product_id: pid, page_id: pageIdOut, n, title, summary, html: "", refs: json(refs), citations: json(mv.citations), mockup: json(ref), previous_version_id: existing.current_version_id, created_by: json(ctx.actor) })
        .execute();
      await ctx.db
        .updateTable("story_pages")
        .set({ title, summary, current_version_id: version_id, version_count: n, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
        .where("product_id", "=", pid)
        .where("page_id", "=", pageIdOut)
        .execute();
      await recordActivity(ctx, { action: "updated", entity_type: "story_page", entity_id: pageIdOut, entity_title: title, summary: `Published version ${n}, showing ${what}` });
    }
    const p = await loadPage(ctx, pageIdOut);
    return {
      ...pageSummary(p),
      current: await versionView(ctx, p.current_version_id, false),
      based_on_version: existing ? existing.version_count : null,
      carried_forward: [],
      agent_notes_etag: p.agent_notes_etag,
      placed: await isPlaced(ctx, pageIdOut),
    };
  },
});

/** The Story pages whose current version shows a page of this mockup, for the mockup's own view. */
export async function storyPagesShowing(ctx: OpContext, mockupId: string) {
  const rows = await ctx.db
    .selectFrom("story_pages as p")
    .innerJoin("story_versions as v", "v.version_id", "p.current_version_id")
    .select(["p.page_id", "p.title", "p.etag", "p.archived_at", "v.mockup"])
    .where("p.product_id", "=", productId(ctx))
    .where(sql<boolean>`v.mockup->>'mockup_id' = ${mockupId}`)
    .orderBy("p.title")
    .execute();
  return rows.map((r) => ({ page_id: r.page_id, title: r.title, etag: r.etag, archived_at: r.archived_at, mockup_page_id: r.mockup!.page_id, version: r.mockup!.version }));
}

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
    .select(["p.page_id", "p.title", "p.archived_at", "v.n", "v.created_at", "v.html", "v.mockup"])
    .where("p.product_id", "=", productId(ctx))
    .where("p.page_id", "in", wanted)
    .execute()
    // A reader is given only live pages, so an archived one is missing for them.
    .then((rs) => (readsOnlyTheStory(ctx.scope.role) ? rs.filter((r) => !r.archived_at) : rs));
  const missing = wanted.filter((w) => !rows.some((r) => r.page_id === w));
  if (missing.length) throw notFound(`These Story pages have never been published in this product: ${missing.join(", ")}.`, { missing });
  const h = await resolvedHierarchy(ctx);
  const story = [...h.items, ...[...h.unplaced, ...h.mockups].map((m) => ({ page_id: m.page_id, children: [] }))];
  const order = printOrder(story, rows.map((r) => ({ page_id: r.page_id, title: r.title })));
  const pages = [];
  for (const slot of order) {
    const r = rows.find((x) => x.page_id === slot.page_id)!;
    pages.push({ page_id: r.page_id, title: r.title, version: r.n, published_at: r.created_at, archived: Boolean(r.archived_at), depth: slot.depth, level: slot.level, html: await shownHtml(ctx.db, r) });
  }
  return pages;
}

function printPath(ctx: OpContext, ids: string[]) {
  return `/api/v1/p/${productPath(ctx)}/story/print?page_ids=${ids.map(encodeURIComponent).join(",")}`;
}

export const printView = defineOperation({
  name: "story.print_view",
  scope: "product",
  access: "story",
  mutates: false,
  summary: "Plan a print view of chosen Story pages, to save as PDF from a browser: their order, heading levels and the view's address.",
  description:
    "Includes exactly the pages named, each at its current version, in the Story's order: a depth-first walk of the tree, the pages not yet placed, then the Published mockups in their order; archived pages after, by title; a reader (the Story-only role) is never given an archived page, which is missing for them. level is the page's outline level among the chosen pages: 1 for a page with no chosen ancestor. url opens one HTML document — a title block, contents, then each page — that a person prints to PDF from their browser; page scripts do not run there, so content a page draws with JavaScript is left out. 404 lists pages that have never been published.",
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
  access: "story",
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

/** What deleting a Story page destroys. */
async function pageDeletion(ctx: OpContext, p: Awaited<ReturnType<typeof loadPage>>) {
  const h = await ctx.db.selectFrom("story_hierarchies").select(["items", "mockups"]).where("product_id", "=", productId(ctx)).executeTakeFirst();
  const promoted = h ? removeFromTree(h.items, p.page_id).promoted : [];
  const current = await ctx.db.selectFrom("story_versions").select("mockup").where("version_id", "=", p.current_version_id).executeTakeFirst();
  return {
    page_id: p.page_id,
    title: p.title,
    etag: p.etag,
    archived: Boolean(p.archived_at),
    version_count: p.version_count,
    sub_pages_promoted: promoted,
    shows_mockup: current?.mockup ? { mockup_id: current.mockup.mockup_id, version: current.mockup.version, page_id: current.mockup.page_id } : null,
    after_delete:
      `Every version of the page (${p.version_count}) goes, with its HTML, notes, refs and citations. ` +
      (promoted.length ? `Its ${promoted.length} sub-page${promoted.length === 1 ? "" : "s"} move up into its place in the navigation. ` : "") +
      "Links to it from other pages stop opening. A mockup it shows is not touched.",
    reversible_alternative: 'story(action="archive_page") takes it out of the navigation and erases nothing.',
  };
}

export const pageDeleteImpact = defineOperation({
  name: "story.delete_page_impact",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Preview exactly what deleting a Story page would destroy.",
  description: "Read-only. Show the person this result before proposing a delete. sub_pages_promoted lists the sub-pages that would move up into its place. Pass this result's etag as the delete's expected_etag.",
  input: z.strictObject({ page_id: pageId }),
  rest: { method: "GET", path: "/story/pages/:page_id/delete-impact" },
  mcp: { tool: "story", action: "delete_page_impact" },
  async handler(ctx, input) {
    return pageDeletion(ctx, await loadPage(ctx, input.page_id));
  },
});

export const deletePage = defineOperation({
  name: "story.delete_page",
  scope: "product",
  access: "admin",
  mutates: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Destroys a Story page with every version; archive_page is the reversible alternative.",
  description:
    'Archiving (story(action="archive_page")) is the reversible alternative and almost always what is wanted. ' +
    DELETE_GUIDANCE.replace("the matching delete_impact", "delete_page_impact").replace("read delete_impact first", "read delete_page_impact first") +
    " Leaves a tombstone: reads return 410 with who, when and why, except to a reader, who is told only that there is no such page.",
  input: z.strictObject({ page_id: pageId, ...deleteGuards }),
  rest: { method: "DELETE", path: "/story/pages/:page_id" },
  mcp: { tool: "story", action: "delete_page" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, 'archive it with story(action="archive_page")');
    const p = await loadPage(ctx, input.page_id, true);
    checkEtag(input.expected_etag, p.etag, "story page");
    const impact = await pageDeletion(ctx, p);
    const h = await ctx.db.selectFrom("story_hierarchies").selectAll().where("product_id", "=", productId(ctx)).forUpdate().executeTakeFirst();
    if (h) {
      const r = removeFromTree(h.items, p.page_id);
      const mockups = h.mockups.filter((x) => x !== p.page_id);
      await ctx.db.updateTable("story_hierarchies").set({ items: json(r.nodes), mockups: json(mockups), etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("product_id", "=", productId(ctx)).execute();
    }
    await leaveTombstone(ctx, { object_type: "story_page", object_id: p.page_id, title: p.title, reason: input.reason });
    await ctx.db.deleteFrom("story_versions").where("product_id", "=", productId(ctx)).where("page_id", "=", p.page_id).execute();
    await ctx.db.deleteFrom("story_pages").where("product_id", "=", productId(ctx)).where("page_id", "=", p.page_id).execute();
    await recordActivity(ctx, {
      action: "deleted",
      entity_type: "story_page",
      entity_id: p.page_id,
      entity_title: p.title,
      summary: impact.sub_pages_promoted.length ? `Deleted the page permanently; promoted ${impact.sub_pages_promoted.length} sub-page${impact.sub_pages_promoted.length === 1 ? "" : "s"}` : "Deleted the page permanently",
    });
    const { etag, reversible_alternative, ...rest } = impact;
    void etag;
    void reversible_alternative;
    return { deleted: true, ...rest, reason: input.reason };
  },
});

export const storyOps = [guidance, getStyle, setStyle, listPages, getPage, listVersions, getVersion, preview, publish, promoteMockup, writeNotes, checkStoryCitations, printView, getHierarchy, setHierarchy, archivePage, restorePage, pageDeleteImpact, deletePage];

