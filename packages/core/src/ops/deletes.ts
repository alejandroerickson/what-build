import { sql } from "kysely";
import { z } from "zod";
import { checkEtag, productId, recordActivity, tenantId } from "../common.ts";
import { checkConfirmation, DELETE_CONFIRMATION, DELETE_GUIDANCE, deleteGuards, leaveTombstone } from "../deletion.ts";
import { conflict, invalid } from "../errors.ts";
import { CONTENT_TABLES } from "../tenant-tables.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { ownerAddresses, tellOwnersDeleted } from "../organization-notices.ts";
import { isInstanceOwner } from "../tenant-allowance.ts";

/**
 * Deleting what holds everything else: a product, with everything in it, and an organization, with
 * every team, product and grant in it. Both are typed by name as well as guarded like every other
 * delete. Closing an organization is a person's act in the web app alone.
 */

const BLOB_CHUNK = 500;

/** Queue the deletion of blobs nothing refers to any more, a chunk to a job. */
async function dropBlobs(ctx: OpContext, keys: string[], prefixes: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += BLOB_CHUNK) await ctx.enqueue("delete_blobs", { keys: keys.slice(i, i + BLOB_CHUNK), prefixes: [] });
  for (let i = 0; i < prefixes.length; i += BLOB_CHUNK) await ctx.enqueue("delete_blobs", { keys: [], prefixes: prefixes.slice(i, i + BLOB_CHUNK) });
}

const count = async (q: Promise<{ n: number | string | bigint } | undefined>) => Number((await q)?.n ?? 0);

/** The name typed to confirm, which must be the name itself. */
const typedName = (what: string) => z.string().describe(`The ${what}'s name, typed exactly as the person confirmed it.`);

function checkTypedName(typed: string, name: string, what: string): void {
  if (typed.trim() !== name) throw invalid("name_mismatch", `name must be the ${what}'s name exactly, as the person typed it: ${name}. Nothing was changed.`);
}

// ---- A product ----------------------------------------------------------------------------------

/** What a product holds, archived or not: what deleting it destroys. */
async function productContents(ctx: OpContext) {
  const pid = productId(ctx);
  const db = ctx.db;
  const files = await db
    .selectFrom("file_versions as v")
    .innerJoin("records as r", "r.record_id", "v.record_id")
    .select((eb) => [eb.fn.countAll<number>().as("n"), eb.fn.coalesce(eb.fn.sum<number>("v.size"), sql<number>`0`).as("bytes")])
    .where("r.product_id", "=", pid)
    .executeTakeFirst();
  return {
    sources: await count(db.selectFrom("records").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst()),
    stored_files: Number(files?.n ?? 0),
    bytes: Number(files?.bytes ?? 0),
    comments: await count(db.selectFrom("annotations").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst()),
    outcomes: await count(db.selectFrom("outcomes").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst()),
    assumptions: await count(db.selectFrom("register_entries").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst()),
    story_pages: await count(db.selectFrom("story_pages").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst()),
    mockups: await count(db.selectFrom("mockups").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst()),
    exports: await count(db.selectFrom("exports").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", pid).executeTakeFirst()),
    people: await count(
      db.selectFrom("memberships").select((eb) => eb.fn.countAll<number>().as("n")).where("scope_type", "=", "product").where("scope_id", "=", pid).executeTakeFirst(),
    ),
  };
}

async function productDeletion(ctx: OpContext) {
  const p = await ctx.db.selectFrom("products").select(["product_id", "name", "etag", "archived_at"]).where("product_id", "=", productId(ctx)).executeTakeFirstOrThrow();
  const contents = await productContents(ctx);
  return {
    product_id: p.product_id,
    name: p.name,
    path: `${ctx.scope.tenant!.slug}/${ctx.scope.team!.slug}/${ctx.scope.product!.slug}`,
    etag: p.etag,
    archived: Boolean(p.archived_at),
    contents,
    after_delete:
      "Everything in the product goes, archived or not: its concept, outcomes, sources with their attachments, derived texts, summaries, notes and comments, assumptions with their reviews, mockups, the Story, exports and activity. " +
      "Roles given on this product go with it; roles on its team and organization stay. A connector scoped to this product reaches nothing.",
    reversible_alternative: 'products_write(action="archive") hides it and makes it read-only, and erases nothing; export it first to keep a copy.',
  };
}

export const productDeleteImpact = defineOperation({
  name: "products.delete_impact",
  scope: "product",
  access: "admin",
  mutates: false,
  allowArchivedProduct: true,
  summary: "Preview exactly what deleting a whole product would destroy (product admins).",
  description:
    "Read-only. Show the person this result before proposing to delete the product: contents counts everything in it, archived or not. Pass this result's etag as the delete's expected_etag, and its name as name.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/delete-impact" },
  mcp: { tool: "products", action: "delete_impact" },
  async handler(ctx) {
    return productDeletion(ctx);
  },
});

export const deleteProduct = defineOperation({
  name: "products.delete",
  scope: "product",
  access: "admin",
  mutates: true,
  allowReadOnlyOrganization: true,
  allowArchivedProduct: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Destroys a whole product and everything in it; archive is the reversible alternative (product admins).",
  description:
    'Archiving (products_write(action="archive")) is the reversible alternative, and an export (products_export(action="export")) keeps a copy. ' +
    DELETE_GUIDANCE.replace("the matching delete_impact", 'products_read(action="delete_impact")') +
    " name must be the product's name, typed exactly as the person confirmed it. Leaves a tombstone. The bytes of its files go shortly after, except those a copy in another product still uses.",
  input: z.strictObject({ ...deleteGuards, name: typedName("product") }),
  rest: { method: "DELETE", path: "" },
  mcp: { tool: "products", action: "delete" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, 'archive it with products_write(action="archive")');
    const pid = productId(ctx);
    const tid = tenantId(ctx);
    const p = await ctx.db.selectFrom("products").selectAll().where("product_id", "=", pid).forUpdate().executeTakeFirstOrThrow();
    checkEtag(input.expected_etag, p.etag, "product");
    checkTypedName(input.name, p.name, "product");
    const impact = await productDeletion(ctx);
    const db = ctx.db;

    const records = (await db.selectFrom("records").select("record_id").where("product_id", "=", pid).execute()).map((r) => r.record_id);
    const versions = records.length ? await db.selectFrom("file_versions").select("blob_key").where("record_id", "in", records).execute() : [];
    const grants = records.length ? await db.selectFrom("upload_grants").select("blob_key").where("record_id", "in", records).where("uploaded_at", "is not", null).execute() : [];
    const derivations = records.length ? await db.selectFrom("derivations").select("blob_prefix").where("record_id", "in", records).execute() : [];
    const exports = await db.selectFrom("exports").select(["export_id", "blob_key"]).where("product_id", "=", pid).execute();
    const canvases = await db.selectFrom("mockup_uploads").select("blob_key").where("product_id", "=", pid).where("uploaded_at", "is not", null).where("used_at", "is", null).execute();
    const prototypes = await db.selectFrom("mockup_prototype_files").select("blob_key").distinct().where("product_id", "=", pid).execute();
    const keys = [...new Set([...versions, ...grants, ...exports, ...canvases, ...prototypes].map((r) => r.blob_key).filter((k): k is string => Boolean(k)))];
    // Work queued for the product would find nothing; it goes now.
    await sql`
      delete from jobs where tenant_id = ${tid} and done_at is null and kind in ('derive', 'export', 'move_to_evidence')
        and (payload->>'product_id' = ${pid} or payload->>'record_id' = any(${records}::text[]) or payload->>'export_id' = any(${exports.map((e) => e.export_id)}::text[]))`.execute(db);

    // Earlier text of what is going goes with it.
    const authored = [
      pid,
      ...records,
      ...(await db.selectFrom("annotations").select("annotation_id").where("product_id", "=", pid).execute()).map((r) => r.annotation_id),
      ...(await db.selectFrom("outcomes").select("outcome_id").where("product_id", "=", pid).execute()).map((r) => r.outcome_id),
      ...(await db.selectFrom("register_entries").select("entry_id").where("product_id", "=", pid).execute()).map((r) => r.entry_id),
    ];
    await db.deleteFrom("revisions").where("object_id", "in", authored).execute();
    for (const table of ["mockup_uploads", "story_previews", "card_previews", "mockup_prototype_files", "mockup_files", "mockup_pages", "mockup_versions", "mockups", "story_versions", "story_pages", "story_hierarchies", "story_styles", "register_entries", "outcomes", "insights", "exports", "activity", "tombstones"] as const)
      await db.deleteFrom(table).where("product_id", "=", pid).execute();
    // A source takes its attachments, versions, uploads, readings, derived text, search index and notes with it.
    await db.deleteFrom("records").where("product_id", "=", pid).execute();
    await db.deleteFrom("invitations").where("scope_type", "=", "product").where("scope_id", "=", pid).execute();
    await db.deleteFrom("memberships").where("scope_type", "=", "product").where("scope_id", "=", pid).execute();
    await db.deleteFrom("products").where("product_id", "=", pid).execute();

    // A copy of a source in another product shares its bytes, which stay while it does.
    const stillUsed = keys.length ? new Set((await db.selectFrom("file_versions").select("blob_key").where("blob_key", "in", keys).execute()).map((r) => r.blob_key)) : new Set<string>();
    await dropBlobs(ctx, keys.filter((k) => !stillUsed.has(k)), derivations.map((d) => d.blob_prefix));

    await leaveTombstone(ctx, { object_type: "product", object_id: pid, title: p.name, reason: input.reason });
    // Recorded on the team, since the product's own log is gone with it.
    await recordActivity({ ...ctx, scope: { ...ctx.scope, product: null } }, { action: "deleted", entity_type: "product", entity_id: pid, entity_title: p.name, summary: "Deleted the product permanently" });
    const { etag, reversible_alternative, ...rest } = impact;
    void etag;
    void reversible_alternative;
    return { deleted: true, ...rest, reason: input.reason };
  },
});

// ---- An organization ----------------------------------------------------------------------------

/** Every table that holds an organization's rows and is not its content, children first. */
const ORGANIZATION_TABLES = ["jobs", "limit_counters", "exports", "upload_grants", "mockup_uploads", "story_previews", "card_previews", "tenant_slugs"] as const;

/** What deleting an organization destroys, read inside its scope (`app.tenant_id` set to it). */
export async function organizationDeletion(ctx: OpContext, tid: string = tenantId(ctx)) {
  const db = ctx.db;
  const t = await db.selectFrom("tenants").select(["tenant_id", "slug", "name", "example"]).where("tenant_id", "=", tid).executeTakeFirstOrThrow();
  const products = await db.selectFrom("products").select(["product_id", "name", "archived_at"]).where("tenant_id", "=", tid).orderBy("name").execute();
  const files = await db
    .selectFrom("file_versions")
    .select((eb) => [eb.fn.countAll<number>().as("n"), eb.fn.coalesce(eb.fn.sum<number>("size"), sql<number>`0`).as("bytes")])
    .where("tenant_id", "=", tid)
    .executeTakeFirst();
  const people = await db.selectFrom("memberships").select("account_id").distinct().where("tenant_id", "=", tid).execute();
  return {
    tenant_id: t.tenant_id,
    slug: t.slug,
    name: t.name,
    example: t.example,
    contents: {
      teams: await count(db.selectFrom("teams").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", tid).executeTakeFirst()),
      products: products.map((p) => ({ product_id: p.product_id, name: p.name, archived: Boolean(p.archived_at) })),
      sources: await count(db.selectFrom("records").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", tid).executeTakeFirst()),
      stored_files: Number(files?.n ?? 0),
      bytes: Number(files?.bytes ?? 0),
      people: people.length,
      pending_invitations: await count(
        db.selectFrom("invitations").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", tid).where("accepted_at", "is", null).where("expires_at", ">", ctx.now).executeTakeFirst(),
      ),
    },
    after_delete:
      "Everything in the organization goes at once: every team and product with all they hold, archived or not, its activity, and every role and invitation in it. Its people keep their accounts and their roles in other organizations. Its slug, and any it had before, are free for another organization to take.",
  };
}

export function refuseExample(d: { example: boolean; name: string }): void {
  if (d.example) throw conflict("example_organization", `${d.name} is this deployment's example organization, which every account reads, so it can't be deleted. Name another one where the service is deployed (WHATBUILD_EXAMPLE_TENANT) first. Nothing was changed.`);
}

export const organizationDeleteImpact = defineOperation({
  name: "products.delete_tenant_impact",
  scope: "tenant",
  access: "owner",
  mutates: false,
  webOnly: "a person does it in the web app: one of its owners on the organization's Members page (`/t/<organization>/members`), Delete this organization, or an owner of this WhatBuild on Organizations (`/instance`), Delete on its row",
  allowInstanceOwners: true,
  summary: "Preview exactly what deleting an organization would destroy (its owners and the instance's, in the web app).",
  description: "Read-only. What the web app shows before an organization is deleted, to one of its owners or an owner of this instance: its teams, products, sources, files and people.",
  input: z.strictObject({ tenant: z.string().min(1) }),
  rest: { method: "GET", path: "/delete-impact" },
  mcp: { tool: "products", action: "delete_tenant_impact" },
  async handler(ctx) {
    return organizationDeletion(ctx);
  },
});

export const deleteOrganization = defineOperation({
  name: "products.delete_tenant",
  scope: "tenant",
  access: "owner",
  mutates: true,
  allowReadOnlyOrganization: true,
  webOnly: "a person does it in the web app: one of its owners on the organization's Members page (`/t/<organization>/members`), Delete this organization, or an owner of this WhatBuild on Organizations (`/instance`), Delete on its row",
  allowInstanceOwners: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Destroys an organization and everything in it (its owners and the instance's, in the web app).",
  description:
    `An act in the web app, never an agent's, of one of the organization's owners or an owner of this instance, who may delete any organization. Needs the organization's name typed exactly, a reason, and confirm set to exactly "${DELETE_CONFIRMATION}". ` +
    "Everything goes at once, from the product and from the file store shortly after; the example organization can't be deleted. When an owner of this instance deletes it, its other owners are mailed that it was (owners_notified says how many).",
  input: z.strictObject({ tenant: z.string().min(1), reason: deleteGuards.reason, confirm: deleteGuards.confirm, name: typedName("organization") }),
  rest: { method: "DELETE", path: "" },
  mcp: { tool: "products", action: "delete_tenant" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, "leave it");
    const tid = tenantId(ctx);
    const db = ctx.db;
    const t = await db.selectFrom("tenants").select(["tenant_id", "name", "example"]).where("tenant_id", "=", tid).forUpdate().executeTakeFirstOrThrow();
    checkTypedName(input.name, t.name, "organization");
    refuseExample(t);
    const impact = await organizationDeletion(ctx);
    // An owner of this instance deleting it tells its owners, who would otherwise find it gone. Their addresses go with it, so they are read first.
    const owners = isInstanceOwner(ctx.ports.config, ctx.principal.email) ? await ownerAddresses(db, tid, ctx.principal.account_id) : [];
    await destroyOrganization(ctx, tid);
    const owners_notified = owners.length ? await tellOwnersDeleted(ctx, owners, t) : 0;
    return { deleted: true, ...impact, reason: input.reason, owners_notified };
  },
});

/**
 * Delete an organization and everything in it, inside its scope (`app.tenant_id` set to it): its
 * rows now, children first, and its bytes on jobs that outlive it. Deleting it, and removing the
 * account of its only owner, both come here.
 */
export async function destroyOrganization(ctx: OpContext, tid: string): Promise<void> {
  const db = ctx.db;
  const versions = await db.selectFrom("file_versions").select("blob_key").where("tenant_id", "=", tid).execute();
  const grants = await db.selectFrom("upload_grants").select("blob_key").where("tenant_id", "=", tid).where("uploaded_at", "is not", null).execute();
  const exports = await db.selectFrom("exports").select("blob_key").where("tenant_id", "=", tid).execute();
  const canvases = await db.selectFrom("mockup_uploads").select("blob_key").where("tenant_id", "=", tid).where("uploaded_at", "is not", null).where("used_at", "is", null).execute();
  const prototypes = await db.selectFrom("mockup_prototype_files").select("blob_key").distinct().where("tenant_id", "=", tid).execute();
  const derivations = await db.selectFrom("derivations").select("blob_prefix").where("tenant_id", "=", tid).execute();
  const keys = [...new Set([...versions, ...grants, ...exports, ...canvases, ...prototypes].map((r) => r.blob_key).filter((k): k is string => Boolean(k)))];

  for (const table of ORGANIZATION_TABLES) await sql`delete from ${sql.table(table)} where tenant_id = ${tid}`.execute(db);
  // Content, children before what they refer to.
  for (const table of [...CONTENT_TABLES].reverse()) await sql`delete from ${sql.table(table)} where tenant_id = ${tid}`.execute(db);
  await db.deleteFrom("invitations").where("tenant_id", "=", tid).execute();
  await db.deleteFrom("memberships").where("tenant_id", "=", tid).execute();
  await db.deleteFrom("tenants").where("tenant_id", "=", tid).execute();

  // The bytes go after the rows, on jobs that outlive the organization.
  await dropBlobs(ctx, keys, derivations.map((d) => d.blob_prefix));
}

export const deleteOps = [productDeleteImpact, deleteProduct, organizationDeleteImpact, deleteOrganization];
