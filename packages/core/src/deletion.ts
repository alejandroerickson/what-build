import { sql } from "kysely";
import { z } from "zod";
import { productId, tenantId } from "./common.ts";
import { json } from "./db.ts";
import { gone, invalid } from "./errors.ts";
import type { OpContext } from "./registry.ts";
import { expectedEtag } from "./schemas.ts";

/**
 * Permanent delete, the same for everything that has it: an admin's call, after a preview of what
 * it destroys, with three guards that are not permissions (the object's etag, a reason, and the
 * exact words below), leaving a tombstone that says who deleted what, when and why.
 */

/** What `confirm` must say, exactly, for any permanent delete. */
export const DELETE_CONFIRMATION = "delete permanently";

/** The guards every permanent delete takes beside the object's id. */
export const deleteGuards = {
  expected_etag: expectedEtag.describe("The etag from the delete_impact result you showed the person. If the object changed since, the delete is refused with 409 stale_etag."),
  reason: z.string().trim().min(1).max(500).describe("Why it is being deleted, in the person's words. Recorded on the tombstone."),
  confirm: z.string().describe(`Must be exactly "${DELETE_CONFIRMATION}".`),
};

/** What every delete's guidance says, after what it destroys. */
export const DELETE_GUIDANCE =
  "This is permanent and cannot be undone. Needs admin, and a connection at Admin. Call the matching delete_impact first, show the person what it will destroy, and delete only once they approve that impact: never slip a delete into a run of other actions, and even with a delete approved in advance, read delete_impact first and stop to ask when it would destroy more than they approved. " +
  `Pass the impact's etag as expected_etag, the person's reason, and confirm set to exactly "${DELETE_CONFIRMATION}".`;

/** Refuse a delete whose confirmation is not the exact words. */
export function checkConfirmation(confirm: string, alternative: string): void {
  if (confirm !== DELETE_CONFIRMATION)
    throw invalid("confirmation_required", `Deleting is permanent. Set confirm to exactly "${DELETE_CONFIRMATION}", or ${alternative} instead.`);
}

export type TombstoneType = "source" | "assumption" | "annotation" | "outcome" | "story_page" | "mockup" | "product";

/** Leave the record of a delete. A Story page deleted again under the same id replaces its earlier tombstone. */
export async function leaveTombstone(
  ctx: OpContext,
  t: { object_type: TombstoneType; object_id: string; title: string; reason: string; product_id?: string },
): Promise<void> {
  await ctx.db
    .insertInto("tombstones")
    .values({ tenant_id: tenantId(ctx), product_id: t.product_id ?? productId(ctx), object_type: t.object_type, object_id: t.object_id, title: t.title, reason: t.reason, deleted_at: ctx.now, deleted_by: json(ctx.actor) })
    .onConflict((oc) => oc.columns(["product_id", "object_type", "object_id"]).doUpdateSet({ title: t.title, reason: t.reason, deleted_at: ctx.now, deleted_by: json(ctx.actor) }))
    .execute();
}

/** The tombstone of an object of this product, if it was deleted. */
export async function tombstoneOf(ctx: OpContext, objectType: TombstoneType, objectId: string) {
  return ctx.db
    .selectFrom("tombstones")
    .selectAll()
    .where("product_id", "=", productId(ctx))
    .where("object_type", "=", objectType)
    .where("object_id", "=", objectId)
    .executeTakeFirst();
}

/** Answer a read of a deleted object with 410 and its tombstone; return when it was never deleted. */
export async function refuseIfDeleted(ctx: OpContext, objectType: TombstoneType, objectId: string, what: string): Promise<void> {
  const tomb = await tombstoneOf(ctx, objectType, objectId);
  if (tomb) throw gone(`${objectType}_deleted`, `${what} was deleted permanently on ${tomb.deleted_at}.`, { tombstone: tomb });
}

/** Revisions kept for objects that are going, which go with them. */
export async function dropRevisions(ctx: OpContext, objectType: string, objectIds: string[]): Promise<void> {
  if (!objectIds.length) return;
  await ctx.db.deleteFrom("revisions").where("object_type", "=", objectType).where("object_id", "in", objectIds).execute();
}

/** Every Story page version, current or earlier, whose refs name an object of this kind. */
export async function storyVersionsReferring(ctx: OpContext, kind: "outcomes" | "assumptions", objectId: string) {
  const rows = await ctx.db
    .selectFrom("story_versions as v")
    .innerJoin("story_pages as p", (j) => j.onRef("p.product_id", "=", "v.product_id").onRef("p.page_id", "=", "v.page_id"))
    .select(["v.page_id", "p.title", "v.n", "v.version_id", "p.current_version_id"])
    .where("v.product_id", "=", productId(ctx))
    .where(sql<boolean>`v.refs -> ${kind} ? ${objectId}`)
    .orderBy("p.title")
    .orderBy("v.n", "desc")
    .execute();
  return rows.map((v) => ({ page_id: v.page_id, title: v.title, version: v.n, is_current: v.version_id === v.current_version_id }));
}

/** Every mockup version, current or earlier, whose refs name an object of this kind. */
export async function mockupVersionsReferring(ctx: OpContext, kind: "outcomes" | "assumptions", objectId: string) {
  const rows = await ctx.db
    .selectFrom("mockup_versions as v")
    .innerJoin("mockups as m", "m.mockup_id", "v.mockup_id")
    .select(["v.mockup_id", "m.title", "v.n", "v.version_id", "m.current_version_id"])
    .where("v.product_id", "=", productId(ctx))
    .where(sql<boolean>`v.refs -> ${kind} ? ${objectId}`)
    .orderBy("m.title")
    .orderBy("v.n", "desc")
    .execute();
  return rows.map((v) => ({ mockup_id: v.mockup_id, title: v.title, version: v.n, is_current: v.version_id === v.current_version_id }));
}
