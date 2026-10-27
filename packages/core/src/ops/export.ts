import { sql } from "kysely";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { z } from "zod";
import { productId, recordActivity, tenantId } from "../common.ts";
import { json, type RegisterEntriesTable, type Tx } from "../db.ts";
import { conflict } from "../errors.ts";
import type { Ports } from "../ports.ts";
import { defineOperation } from "../registry.ts";
import { requesterClaims } from "./attachments.ts";
import { newId } from "../util.ts";

export const EXPORT_FORMAT = "whatbuild-product-bundle";
export const EXPORT_FORMAT_VERSION = 2;
const EXPORT_DAYS = 7;

/**
 * Every kind of file a bundle holds, in the order README.txt lists them. bundle.json's layout and
 * README.txt are both made from it, and a test holds it to what an export writes. In a path, <…>
 * stands for one name, v<n> for a version number, and <path> for a path that may have folders.
 */
export const BUNDLE_LAYOUT: readonly { path: string; holds: string }[] = [
  { path: "bundle.json", holds: "The format and its version, when and by whom the product was exported, the product, and this layout." },
  { path: "README.txt", holds: "This file." },
  { path: "outcomes.json", holds: "The product's outcomes." },
  { path: "records/<record_id>/record.json", holds: "A source: its details, its derived text's details, and its attachments with their versions." },
  { path: "records/<record_id>/text.md", holds: "The source's derived text, the Markdown search reads." },
  { path: "records/<record_id>/attachments/<file_version_id>/<path>", holds: "Every stored version of every attachment, byte for byte; MISSING.txt where the bytes could not be read." },
  { path: "records/<record_id>/derived/<derivation_id>/<file>", holds: "What an attachment was read as: text.md and manifest.json, with segments.jsonl in readings made while sources had passages." },
  { path: "records/<record_id>/annotations.json", holds: "The source's comments." },
  { path: "records/<record_id>/agent-notes/<kind>.md", holds: "The source's summary (summary.md) and notes (notes.md)." },
  { path: "assumptions.json", holds: "The assumptions, each with its reviews." },
  { path: "revisions.json", holds: "Earlier texts of the outcomes, the assumptions, the comments and the product concept." },
  { path: "story/hierarchy.json", holds: "The Story's page tree and its Published mockups." },
  { path: "story/style.json", holds: "The Story style, when the product has one." },
  { path: "story/style.css", holds: "The Story style's stylesheet." },
  { path: "story/pages/<page_id>/page.json", holds: "A Story page." },
  { path: "story/pages/<page_id>/v<n>.json", holds: "One version of the page. A version that shows a mockup page names it here and has no HTML of its own." },
  { path: "story/pages/<page_id>/v<n>.html", holds: "That version's HTML." },
  { path: "mockups/<mockup_id>/mockup.json", holds: "A mockup." },
  { path: "mockups/<mockup_id>/v<n>/version.json", holds: "One version of its canvas: the pages in order, each without its HTML and notes." },
  { path: "mockups/<mockup_id>/v<n>/brief.md", holds: "The version's brief." },
  { path: "mockups/<mockup_id>/v<n>/pages/<page_id>.html", holds: "A page's HTML. A page that enters the prototype has none; version.json gives its entry." },
  { path: "mockups/<mockup_id>/v<n>/pages/<page_id>.notes.md", holds: "A page's design notes." },
  { path: "mockups/<mockup_id>/v<n>/files/<path>", holds: "A file the version carries for collaborators." },
  { path: "mockups/<mockup_id>/v<n>/prototype/<path>", holds: "A file of the version's prototype, as it was uploaded." },
  { path: "tombstones.json", holds: "What was deleted permanently: what it was, who deleted it, when and why." },
  { path: "activity.jsonl", holds: "The activity log, one event a line." },
];

/**
 * The columns of an assumption a bundle holds: every one but the search vector the database keeps
 * for itself. Listing them against the table's type makes a new column fail the typecheck until it
 * is added here.
 */
const ASSUMPTION_COLUMNS = Object.keys({
  entry_id: 1, tenant_id: 1, product_id: 1, kind: 1, statement: 1, body: 1, links: 1, outcome_ids: 1, tags: 1, author: 1, author_type: 1,
  status: 1, review_count: 1, archived_at: 1, etag: 1, created_at: 1, updated_at: 1, updated_by: 1,
} satisfies Record<keyof RegisterEntriesTable, 1>) as (keyof RegisterEntriesTable)[];

export const exportProduct = defineOperation({
  name: "products.export",
  scope: "product",
  access: "read",
  mutates: true,
  // No archiving stops an export; only the free plan's daily allowance limits it.
  allowArchivedProduct: true,
  summary:
    "Export the whole product to one ZIP: every source with its attachments, texts, summary, notes and comments, and the outcomes, assumptions with their reviews, earlier texts, Story versions, mockup versions, tombstones and activity.",
  description:
    "A viewer, editor or admin may export, at any time, and an archived product exports too. A reader, who reads only the Story, is refused (403). On the free plan each person's exports are limited by exports_per_day (409 quota_exceeded, or 403 plan_restricted when it is 0); writing's own allowance never stops an export. A guest of the example organization exports nothing (403 example_read_only). One export of a product is built at a time (409 export_in_progress). The bundle is built in the background; call products_read(action=\"exports\") to see when it is ready and get a download grant. Readable with a ZIP tool and nothing else: JSON, Markdown, HTML and the original files, each kind listed in the bundle's README.txt.",
  input: z.strictObject({}),
  rest: { method: "POST", path: "/exports" },
  mcp: { tool: "products", action: "export" },
  async handler(ctx) {
    const pending = await ctx.db.selectFrom("exports").select("export_id").where("product_id", "=", productId(ctx)).where("status", "=", "pending").executeTakeFirst();
    if (pending) throw conflict("export_in_progress", "An export of this product is already being built; check products_read(action=\"exports\").", { export_id: pending.export_id });
    const export_id = newId();
    await ctx.db
      .insertInto("exports")
      .values({ export_id, tenant_id: tenantId(ctx), product_id: productId(ctx), created_by: json(ctx.actor), expires_at: new Date(Date.parse(ctx.now) + EXPORT_DAYS * 86400_000).toISOString() })
      .execute();
    await ctx.enqueue("export", { export_id });
    await recordActivity(ctx, { action: "export_requested", entity_type: "product", entity_id: productId(ctx), entity_title: ctx.scope.product!.name, summary: "Asked for an export of the product" });
    return { export_id, status: "pending" };
  },
});

export const listExports = defineOperation({
  name: "products.exports",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Recent exports of this product, with a download grant for each ready one.",
  description: "Exports are kept for seven days. GET the grant's url with its headers to download the ZIP. A guest of the example organization gets none: the example is read where it is.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/exports" },
  mcp: { tool: "products", action: "exports" },
  async handler(ctx) {
    // Its members may export it; its guests neither export it nor take away what they exported.
    if (ctx.scope.tenantRole === "guest") return { items: [] };
    const rows = await ctx.db.selectFrom("exports").selectAll().where("product_id", "=", productId(ctx)).where("expires_at", ">", ctx.now).orderBy("export_id", "desc").limit(20).execute();
    return {
      items: rows.map((r) => {
        const grant =
          r.status === "ready"
            ? {
                method: "GET",
                url: `${ctx.ports.config.publicBaseUrl}/api/v1/downloads/export/${r.export_id}`,
                headers: { "X-WhatBuild-Download-Grant": ctx.ports.grants.sign({ v: 1, purpose: "export", t: tenantId(ctx), e: r.export_id, ...requesterClaims(ctx.principal), exp: Math.floor(Date.parse(ctx.now) / 1000) + ctx.ports.config.grantTtlSeconds }) },
              }
            : null;
        return { export_id: r.export_id, status: r.status, size: r.size === null ? null : Number(r.size), file_count: r.file_count, error: r.error, created_at: r.created_at, created_by: r.created_by, completed_at: r.completed_at, expires_at: r.expires_at, download: grant };
      }),
    };
  },
});

export const exportOps = [exportProduct, listExports];

/** A bundle's README.txt: what it is, then every kind of file it holds and what each holds. */
export function bundleReadme(what: string): string {
  return (
    `WhatBuild product bundle: ${what}.\n\n` +
    "Everything is plain files: JSON for structured data, Markdown for texts, HTML for pages, and\n" +
    "every attachment as it was uploaded. In a path, <…> stands for one name, v<n> for a version\n" +
    "number, and <path> for a path that may have folders. What each file holds:\n\n" +
    BUNDLE_LAYOUT.map((f) => `${f.path}\n    ${f.holds}\n`).join("")
  );
}

/**
 * Build a product bundle in the worker. Streams the ZIP into the blob store so a large product
 * never has to fit in memory at once.
 */
export async function runExport(db: Tx, ports: Ports, job: { tenant_id: string; export_id: string }) {
  const ex = await db.selectFrom("exports").selectAll().where("export_id", "=", job.export_id).executeTakeFirst();
  if (!ex || ex.status !== "pending") return null;
  const pid = ex.product_id;
  const product = await db.selectFrom("products").selectAll().where("product_id", "=", pid).executeTakeFirstOrThrow();
  const team = await db.selectFrom("teams").select(["slug", "name"]).where("team_id", "=", product.team_id).executeTakeFirstOrThrow();
  const tenant = await db.selectFrom("tenants").select(["slug", "name"]).where("tenant_id", "=", product.tenant_id).executeTakeFirstOrThrow();

  let files = 0;
  const chunks: Uint8Array[] = [];
  let push: ((c: Uint8Array) => void) | null = null;
  let finish: (() => void) | null = null;
  let fail: ((e: Error) => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (c) => controller.enqueue(c);
      finish = () => controller.close();
      fail = (e) => controller.error(e);
      for (const c of chunks.splice(0)) controller.enqueue(c);
    },
  });
  const zip = new Zip((err, data, final) => {
    if (err) return fail?.(err);
    if (push) push(data);
    else chunks.push(data);
    if (final) finish?.();
  });
  const add = (path: string, data: Uint8Array | string) => {
    const f = new ZipPassThrough(path);
    zip.add(f);
    f.push(typeof data === "string" ? strToU8(data) : data, true);
    files++;
  };
  const key = `t/${ex.tenant_id}/exports/${ex.export_id}.zip`;
  const upload = ports.blobs.putStream(key, stream, { contentType: "application/zip", maxBytes: 10 * 1024 * 1024 * 1024 });

  const j = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  add(
    "bundle.json",
    j({
      format: EXPORT_FORMAT,
      format_version: EXPORT_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      exported_by: ex.created_by,
      server_version: ports.config.serverVersion,
      tenant,
      team,
      product: { product_id: product.product_id, slug: product.slug, name: product.name, concept: product.concept, created_at: product.created_at, archived_at: product.archived_at },
      layout: BUNDLE_LAYOUT.map((f) => f.path).join(" · "),
    }),
  );
  add("outcomes.json", j(await db.selectFrom("outcomes").selectAll().where("product_id", "=", pid).orderBy("position").execute()));

  const records = await db.selectFrom("records").selectAll().where("product_id", "=", pid).orderBy("record_id").execute();
  for (const r of records) {
    const base = `records/${r.record_id}`;
    const fileRows = await db.selectFrom("files").selectAll().where("record_id", "=", r.record_id).execute();
    const versions = await db.selectFrom("file_versions").selectAll().where("record_id", "=", r.record_id).execute();
    const text = await db.selectFrom("source_texts").selectAll().where("record_id", "=", r.record_id).executeTakeFirst();
    add(
      `${base}/record.json`,
      j({
        ...r,
        text: text ? { chars: text.chars, from_file_version_id: text.from_file_version_id, updated_at: text.updated_at, updated_by: text.updated_by } : null,
        attachments: fileRows.map((f) => ({ ...f, versions: versions.filter((v) => v.file_id === f.file_id).map(({ blob_key: _k, ...v }) => v) })),
      }),
    );
    if (text) add(`${base}/text.md`, text.content);
    for (const v of versions) {
      const f = fileRows.find((x) => x.file_id === v.file_id);
      try {
        add(`${base}/attachments/${v.file_version_id}/${f?.path ?? "file"}`, await ports.blobs.get(v.blob_key));
      } catch {
        add(`${base}/attachments/${v.file_version_id}/MISSING.txt`, "The stored bytes for this version could not be read at export time.\n");
      }
    }
    for (const d of await db.selectFrom("derivations").selectAll().where("record_id", "=", r.record_id).execute()) {
      // segments.jsonl is in readings made while sources had passages.
      for (const s of ["text.md", "manifest.json", "segments.jsonl"]) {
        try {
          add(`${base}/derived/${d.derivation_id}/${s}`, await ports.blobs.get(`${d.blob_prefix}/${s}`));
        } catch {
          // A sidecar that cannot be read is left out; the manifest row in record.json remains.
        }
      }
    }
    const notes = await db.selectFrom("annotations").selectAll().where("record_id", "=", r.record_id).execute();
    if (notes.length) add(`${base}/annotations.json`, j(notes));
    const agent = await db.selectFrom("agent_notes").selectAll().where("record_id", "=", r.record_id).execute();
    for (const a of agent) add(`${base}/agent-notes/${a.kind}.md`, a.content);
  }

  const entries = await db.selectFrom("register_entries").select(ASSUMPTION_COLUMNS).where("product_id", "=", pid).where("kind", "=", "assumption").orderBy("entry_id").execute();
  const reviews = entries.length ? await db.selectFrom("reviews").selectAll().where("entry_id", "in", entries.map((e) => e.entry_id)).orderBy("review_id").execute() : [];
  add("assumptions.json", j(entries.map((e) => ({ ...e, reviews: reviews.filter((r) => r.entry_id === e.entry_id) }))));

  const objectIds = [...entries.map((e) => e.entry_id), pid];
  const outcomes = await db.selectFrom("outcomes").select("outcome_id").where("product_id", "=", pid).execute();
  const noteIds = (await db.selectFrom("annotations").select("annotation_id").where("product_id", "=", pid).execute()).map((a) => a.annotation_id);
  const revs = await db.selectFrom("revisions").selectAll().where("object_id", "in", [...objectIds, ...outcomes.map((o) => o.outcome_id), ...noteIds]).orderBy("object_id").orderBy("n").execute();
  add("revisions.json", j(revs));

  const pages = await db.selectFrom("story_pages").selectAll().where("product_id", "=", pid).execute();
  const hierarchy = await db.selectFrom("story_hierarchies").selectAll().where("product_id", "=", pid).executeTakeFirst();
  add("story/hierarchy.json", j(hierarchy ?? { items: [] }));
  const style = await db.selectFrom("story_styles").selectAll().where("product_id", "=", pid).executeTakeFirst();
  if (style) {
    const { stylesheet, ...meta } = style;
    add("story/style.json", j(meta));
    add("story/style.css", stylesheet);
  }
  for (const p of pages) {
    add(`story/pages/${p.page_id}/page.json`, j(p));
    for (const v of await db.selectFrom("story_versions").selectAll().where("product_id", "=", pid).where("page_id", "=", p.page_id).orderBy("n").execute()) {
      const { html, ...meta } = v;
      add(`story/pages/${p.page_id}/v${v.n}.json`, j(meta));
      // A version that shows a mockup page has no HTML of its own: its JSON names the page under mockups/.
      if (!v.mockup) add(`story/pages/${p.page_id}/v${v.n}.html`, html);
    }
  }
  for (const m of await db.selectFrom("mockups").selectAll().where("product_id", "=", pid).orderBy("mockup_id").execute()) {
    add(`mockups/${m.mockup_id}/mockup.json`, j(m));
    for (const v of await db.selectFrom("mockup_versions").selectAll().where("mockup_id", "=", m.mockup_id).orderBy("n").execute()) {
      const { brief, ...meta } = v;
      const pages = await db.selectFrom("mockup_pages").selectAll().where("version_id", "=", v.version_id).orderBy("position").execute();
      const dir = `mockups/${m.mockup_id}/v${v.n}`;
      add(`${dir}/version.json`, j({ ...meta, pages: pages.map(({ html, notes, ...p }) => (void html, void notes, p)) }));
      add(`${dir}/brief.md`, brief);
      for (const p of pages) {
        // A page that enters the prototype has no HTML of its own; version.json gives its entry.
        if (p.html !== null) add(`${dir}/pages/${p.page_id}.html`, p.html);
        add(`${dir}/pages/${p.page_id}.notes.md`, p.notes);
      }
      for (const x of await db.selectFrom("mockup_files").select(["path", "content"]).where("version_id", "=", v.version_id).orderBy(sql`path collate "C"`).execute()) add(`${dir}/files/${x.path}`, x.content);
      for (const r of await db.selectFrom("mockup_prototype_files").select(["path", "blob_key"]).where("version_id", "=", v.version_id).orderBy(sql`path collate "C"`).execute())
        add(`${dir}/prototype/${r.path}`, await ports.blobs.get(r.blob_key));
    }
  }
  add("tombstones.json", j(await db.selectFrom("tombstones").selectAll().where("product_id", "=", pid).execute()));
  const activity = await db.selectFrom("activity").selectAll().where("product_id", "=", pid).orderBy("activity_id").execute();
  add("activity.jsonl", activity.map((a) => JSON.stringify(a)).join("\n") + (activity.length ? "\n" : ""));
  add("README.txt", bundleReadme(`${product.name} (${tenant.name} / ${team.name})`));
  zip.end();
  const stored = await upload;
  await db.updateTable("exports").set({ status: "ready", blob_key: key, size: stored.size, file_count: files, completed_at: new Date().toISOString() }).where("export_id", "=", ex.export_id).execute();
  return { size: stored.size, files };
}

export async function markExportFailed(db: Tx, exportId: string, error: string) {
  await db.updateTable("exports").set({ status: "failed", error: error.slice(0, 500), completed_at: new Date().toISOString() }).where("export_id", "=", exportId).execute();
}

