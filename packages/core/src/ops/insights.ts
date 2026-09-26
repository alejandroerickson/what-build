import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, EMPTY_REFS, keepRevision, productId, recordActivity, tenantId, validateRefs } from "../common.ts";
import { json, type InsightsTable, type Refs } from "../db.ts";
import { notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { newEtag, newId } from "../util.ts";

export const BODY_MAX = 100_000;
const STATUS = z.enum(["draft", "published", "archived"]);

const refsInput = z
  .strictObject({
    objectives: z.array(id("objective")).max(50).optional(),
    sources: z.array(id("source")).max(100).optional(),
    insights: z.array(id("insight")).max(100).optional(),
    assumptions: z.array(id("assumption")).max(100).optional(),
    decisions: z.array(id("decision")).max(100).optional(),
  })
  .describe("Structural references, each validated to exist in this product. They do not establish agreement and do not replace citations.");

type Row = Selectable<InsightsTable>;

async function load(ctx: OpContext, insightId: string, lock = false): Promise<Row> {
  let q = ctx.db.selectFrom("insights").selectAll().where("insight_id", "=", insightId).where("product_id", "=", productId(ctx));
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw notFound(`Insight ${insightId} does not exist in this product.`);
  return row;
}

function summaryOf(r: Row) {
  return {
    insight_id: r.insight_id,
    title: r.title,
    summary: r.summary,
    status: r.status,
    refs: r.refs,
    ref_counts: Object.fromEntries(Object.entries(r.refs).map(([k, v]) => [k, (v as string[]).length])),
    revision: r.revision,
    body_chars: r.body.length,
    etag: r.etag,
    created_at: r.created_at,
    created_by: r.created_by,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
  };
}

export const listInsights = defineOperation({
  name: "insights.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List insights, newest first, without bodies.",
  description: "Filter by status, by an objective or a source they reference, or by a substring of title, summary or body. Archived insights are left out unless status is \"archived\". Use get for the body.",
  input: z.strictObject({
    status: STATUS.optional(),
    objective_id: id("objective").optional(),
    source_id: id("source").optional(),
    query: z.string().max(500).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().optional(),
  }),
  rest: { method: "GET", path: "/insights" },
  mcp: { tool: "insights", action: "list" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("insights").selectAll().where("product_id", "=", productId(ctx));
    q = input.status ? q.where("status", "=", input.status) : q.where("status", "!=", "archived");
    if (input.objective_id) q = q.where(sql<boolean>`refs->'objectives' ? ${input.objective_id}`);
    if (input.source_id) q = q.where(sql<boolean>`refs->'sources' ? ${input.source_id}`);
    if (input.query) {
      const like = `%${input.query}%`;
      q = q.where(sql<boolean>`(title ilike ${like} or summary ilike ${like} or body ilike ${like})`);
    }
    if (input.cursor) q = q.where("insight_id", "<", input.cursor);
    const rows = await q.orderBy("insight_id", "desc").limit(input.limit + 1).execute();
    const items = rows.slice(0, input.limit).map(summaryOf);
    return { items, next_cursor: rows.length > input.limit ? items[items.length - 1]!.insight_id : null };
  },
});

export const getInsight = defineOperation({
  name: "insights.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read an insight, with its body in a bounded window.",
  description: `The body comes back in a window (offset and limit, default 20,000 characters, at most ${BODY_MAX}) with truncated and body_chars; page through long bodies. The etag guards update.`,
  input: z.strictObject({ insight_id: id("insight"), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(BODY_MAX).default(20_000) }),
  rest: { method: "GET", path: "/insights/:insight_id" },
  mcp: { tool: "insights", action: "get" },
  async handler(ctx, input) {
    const r = await load(ctx, input.insight_id);
    const body = r.body.slice(input.offset, input.offset + input.limit);
    return { ...summaryOf(r), body, offset: input.offset, truncated: input.offset + input.limit < r.body.length };
  },
});

export const createInsight = defineOperation({
  name: "insights.create",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Write an insight: a readable Markdown synthesis, the default home for a group of observations.",
  description:
    "Prefer one coherent document with useful headings and evidence links over many small items. Cite evidence in prose with source ids and passage ranges so another agent can verify it; use the registers only for the few assumptions and decisions that need explicit agreement. Separate what a source says from your interpretation. Starts as a draft unless status says otherwise.",
  input: z.strictObject({
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(1000).default("").describe("Plain text shown in lists."),
    body: z.string().min(1).max(BODY_MAX).describe("The insight as Markdown, without HTML: headings, lists, tables and [text](url) links. HTML tags are shown as text, not rendered."),
    status: z.enum(["draft", "published"]).default("draft"),
    refs: refsInput.optional(),
  }),
  rest: { method: "POST", path: "/insights" },
  mcp: { tool: "insights", action: "create" },
  async handler(ctx, input) {
    const insight_id = newId();
    const refs = await validateRefs(ctx, input.refs ?? EMPTY_REFS, insight_id);
    await ctx.db
      .insertInto("insights")
      .values({
        insight_id, tenant_id: tenantId(ctx), product_id: productId(ctx), title: input.title, summary: input.summary, body: input.body,
        status: input.status, refs: json(refs), etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    await recordActivity(ctx, { action: "created", entity_type: "insight", entity_id: insight_id, entity_title: input.title, summary: `Wrote a ${input.status === "draft" ? "draft" : "published"} insight` });
    return { ...summaryOf(await load(ctx, insight_id)), body: input.body };
  },
});

export const updateInsight = defineOperation({
  name: "insights.update",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Revise an insight: text, status (publish, unpublish, archive) or references. Pass only what changes.",
  description:
    "Requires expected_etag. Fields you omit keep their values; a refs group you pass replaces that group only. Any change to title, summary or body keeps the previous text as a revision, so nothing is lost to an overwrite.",
  input: z.strictObject({
    insight_id: id("insight"),
    expected_etag: expectedEtag,
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(1000).optional(),
    body: z.string().min(1).max(BODY_MAX).optional(),
    status: STATUS.optional(),
    refs: refsInput.optional(),
  }),
  rest: { method: "PATCH", path: "/insights/:insight_id" },
  mcp: { tool: "insights", action: "update" },
  async handler(ctx, input) {
    const r = await load(ctx, input.insight_id, true);
    checkEtag(input.expected_etag, r.etag, "insight");
    const refs: Refs = input.refs ? await validateRefs(ctx, { ...r.refs, ...input.refs }, r.insight_id) : r.refs;
    const textChanged = (["title", "summary", "body"] as const).filter((k) => input[k] !== undefined && input[k] !== r[k]);
    let revision = r.revision;
    if (textChanged.length) {
      await keepRevision(ctx, "insight", r.insight_id, { title: r.title, summary: r.summary, body: r.body, revision: r.revision }, r.updated_at, r.updated_by);
      revision += 1;
    }
    const refsChanged = JSON.stringify(refs) !== JSON.stringify(r.refs);
    const statusChanged = input.status !== undefined && input.status !== r.status;
    if (!textChanged.length && !refsChanged && !statusChanged) return { ...summaryOf(r), changed: [] };
    await ctx.db
      .updateTable("insights")
      .set({
        title: input.title ?? r.title,
        summary: input.summary ?? r.summary,
        body: input.body ?? r.body,
        status: input.status ?? r.status,
        refs: json(refs),
        revision,
        etag: newEtag(),
        updated_at: ctx.now,
        updated_by: json(ctx.actor),
      })
      .where("insight_id", "=", r.insight_id)
      .execute();
    const changed = [...textChanged, ...(refsChanged ? ["references"] : []), ...(statusChanged ? ["status"] : [])];
    const action = statusChanged
      ? input.status === "published" ? "published" : input.status === "archived" ? "archived" : r.status === "archived" ? "restored" : "unpublished"
      : "updated";
    await recordActivity(ctx, {
      action,
      entity_type: "insight",
      entity_id: r.insight_id,
      entity_title: input.title ?? r.title,
      summary: statusChanged ? `Changed status from ${r.status} to ${input.status}` : `Changed ${changed.join(", ")}${textChanged.length ? ` (revision ${revision})` : ""}`,
    });
    return { ...summaryOf(await load(ctx, r.insight_id)), changed };
  },
});

export const insightOps = [listInsights, getInsight, createInsight, updateInsight];
