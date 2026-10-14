import { sql } from "kysely";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { z } from "zod";
import { productId, recordActivity, tenantId } from "../common.ts";
import { json, type Tx } from "../db.ts";
import { conflict } from "../errors.ts";
import type { Ports } from "../ports.ts";
import { defineOperation } from "../registry.ts";
import { newId } from "../util.ts";

export const EXPORT_FORMAT = "whatbuild-product-bundle";
export const EXPORT_FORMAT_VERSION = 1;
const EXPORT_DAYS = 7;

export const exportProduct = defineOperation({
  name: "products.export",
  scope: "product",
  access: "read",
  mutates: true,
  // Export is never blocked, not even by archiving.
  allowArchivedProduct: true,
  summary: "Export the whole product to one ZIP: every source file, parse, note, outcome, revision, assumption, review, Story version, mockup version and activity event.",
  description:
    "Any role may export, always — export is never blocked. The bundle is built in the background; call products(action=\"exports\") to see when it is ready and get a download grant. Readable with a ZIP tool and nothing else: JSON, Markdown, HTML and the original files.",
  input: z.strictObject({}),
  rest: { method: "POST", path: "/exports" },
  mcp: { tool: "products", action: "export" },
  async handler(ctx) {
    const pending = await ctx.db.selectFrom("exports").select("export_id").where("product_id", "=", productId(ctx)).where("status", "=", "pending").executeTakeFirst();
    if (pending) throw conflict("export_in_progress", "An export of this product is already being built; check products(action=\"exports\").", { export_id: pending.export_id });
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
  description: "Exports are kept for seven days. GET the grant's url with its headers to download the ZIP.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/exports" },
  mcp: { tool: "products", action: "exports" },
  async handler(ctx) {
    const rows = await ctx.db.selectFrom("exports").selectAll().where("product_id", "=", productId(ctx)).where("expires_at", ">", ctx.now).orderBy("export_id", "desc").limit(20).execute();
    return {
      items: rows.map((r) => {
        const grant =
          r.status === "ready"
            ? {
                method: "GET",
                url: `${ctx.ports.config.publicBaseUrl}/api/v1/downloads/export/${r.export_id}`,
                headers: { "X-WhatBuild-Download-Grant": ctx.ports.grants.sign({ v: 1, purpose: "export", t: tenantId(ctx), e: r.export_id, exp: Math.floor(Date.parse(ctx.now) / 1000) + ctx.ports.config.grantTtlSeconds }) },
              }
            : null;
        return { export_id: r.export_id, status: r.status, size: r.size === null ? null : Number(r.size), file_count: r.file_count, error: r.error, created_at: r.created_at, created_by: r.created_by, completed_at: r.completed_at, expires_at: r.expires_at, download: grant };
      }),
    };
  },
});

export const exportOps = [exportProduct, listExports];

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
      layout: "records/<record_id>/record.json · files/<file_version_id>/<path> · derived/<derivation_id>/* · assumptions.json · story/* · mockups/*",
    }),
  );
  add("outcomes.json", j(await db.selectFrom("outcomes").selectAll().where("product_id", "=", pid).orderBy("position").execute()));

  const records = await db.selectFrom("records").selectAll().where("product_id", "=", pid).orderBy("record_id").execute();
  for (const r of records) {
    const base = `records/${r.record_id}`;
    const fileRows = await db.selectFrom("files").selectAll().where("record_id", "=", r.record_id).execute();
    const versions = await db.selectFrom("file_versions").selectAll().where("record_id", "=", r.record_id).execute();
    add(`${base}/record.json`, j({ ...r, files: fileRows.map((f) => ({ ...f, versions: versions.filter((v) => v.file_id === f.file_id).map(({ blob_key: _k, ...v }) => v) })) }));
    for (const v of versions) {
      const f = fileRows.find((x) => x.file_id === v.file_id);
      try {
        add(`${base}/files/${v.file_version_id}/${f?.path ?? "file"}`, await ports.blobs.get(v.blob_key));
      } catch {
        add(`${base}/files/${v.file_version_id}/MISSING.txt`, "The stored bytes for this version could not be read at export time.\n");
      }
    }
    for (const d of await db.selectFrom("derivations").selectAll().where("record_id", "=", r.record_id).execute()) {
      for (const s of ["segments.jsonl", "text.md", "outline.md", "manifest.json"]) {
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
    const lineage = await db.selectFrom("lineage").selectAll().where("record_id", "=", r.record_id).executeTakeFirst();
    if (lineage) add(`${base}/lineage.json`, j(lineage));
  }

  const entries = await db.selectFrom("register_entries").selectAll().where("product_id", "=", pid).where("kind", "=", "assumption").orderBy("entry_id").execute();
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
  add(
    "README.txt",
    `WhatBuild product bundle: ${product.name} (${tenant.name} / ${team.name}).\n\n` +
      "Everything is plain files: JSON for structured data, Markdown for parsed text and mockup briefs and notes,\n" +
      "HTML for Story versions and mockup pages (a Story version that shows a mockup page names it in its JSON),\n" +
      "each mockup version's prototype under mockups/<id>/v<n>/prototype/ as it was uploaded,\n" +
      "and every stored version of every source file under records/<id>/files/. Offsets in segments.jsonl are Unicode\n" +
      "code points into the text.md beside it.\n",
  );
  zip.end();
  const stored = await upload;
  await db.updateTable("exports").set({ status: "ready", blob_key: key, size: stored.size, file_count: files, completed_at: new Date().toISOString() }).where("export_id", "=", ex.export_id).execute();
  return { size: stored.size, files };
}

export async function markExportFailed(db: Tx, exportId: string, error: string) {
  await db.updateTable("exports").set({ status: "failed", error: error.slice(0, 500), completed_at: new Date().toISOString() }).where("export_id", "=", exportId).execute();
}

