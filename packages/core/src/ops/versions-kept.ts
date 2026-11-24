import { sql } from "kysely";
import { productId, recordActivity } from "../common.ts";
import { gone, notFound, type AppError } from "../errors.ts";
import { productTotal } from "../limits.ts";
import type { OpContext } from "../registry.ts";

/**
 * The versions a mockup and a Story page keep: as many as the organization's plan says
 * (`mockup_versions_max`, `story_page_versions_max`; 10 where no plan says otherwise, the unlimited
 * plan among them). Publishing a version past them deletes the oldest, so it is publishing that
 * trims, and a plan that keeps fewer than an object holds trims it at its next version.
 *
 * - The newest versions are kept, the current one always among them.
 * - A mockup also keeps every version a Story page version shows, since the Story shows it as it was
 *   published. When the last Story version showing one goes, so does that mockup version, if the
 *   mockup holds more than its plan keeps.
 * - Numbers are never reused: an object's next version follows its newest, so a deleted version's
 *   number stays a gap, and reading it answers that it was deleted.
 */

/** How many versions each mockup, or each Story page, keeps on this call's plan; null keeps every one. */
export function versionsKept(ctx: Pick<OpContext, "limits">, key: "mockup_versions_max" | "story_page_versions_max"): number | null {
  const n = productTotal(ctx.limits, key);
  return n === null ? null : Math.max(1, n);
}

/** "version 3", "versions 1 and 2", "versions 1 to 4", "versions 2 and 6 to 15", from numbers in order. */
export function versionWords(ns: number[]): string {
  const items: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++;
    if (j - i >= 2) items.push(`${ns[i]} to ${ns[j]}`);
    else for (let k = i; k <= j; k++) items.push(String(ns[k]));
    i = j + 1;
  }
  const last = items.pop()!;
  return ns.length === 1 ? `version ${last}` : `versions ${items.length ? `${items.join(", ")} and ${last}` : last}`;
}

/**
 * Delete a mockup's versions past what its plan keeps, but for those a Story page version shows, with
 * their pages, files and prototype rows, and the prototype bytes no version holds any more. Returns
 * the numbers of the versions deleted, oldest first.
 */
export async function trimMockupVersions(ctx: OpContext, mockup: { mockup_id: string; title: string }): Promise<number[]> {
  const keep = versionsKept(ctx, "mockup_versions_max");
  if (keep === null) return [];
  const pid = productId(ctx);
  const older = (await ctx.db.selectFrom("mockup_versions").select(["version_id", "n"]).where("product_id", "=", pid).where("mockup_id", "=", mockup.mockup_id).orderBy("n", "desc").execute()).slice(keep);
  if (!older.length) return [];
  // Locked before the Story is read: a promotion of one of them (which takes it FOR SHARE) either
  // commits first, and is seen below, or waits, and then finds it gone.
  await ctx.db.selectFrom("mockup_versions").select("version_id").where("version_id", "in", older.map((v) => v.version_id)).forUpdate().execute();
  const shown = new Set(
    (
      await ctx.db
        .selectFrom("story_versions")
        .select(sql<string>`mockup->>'mockup_version_id'`.as("version_id"))
        .where("product_id", "=", pid)
        .where(sql<boolean>`mockup->>'mockup_id' = ${mockup.mockup_id}`)
        .execute()
    ).map((r) => r.version_id),
  );
  const going = older.filter((v) => !shown.has(v.version_id)).sort((a, b) => a.n - b.n);
  if (!going.length) return [];
  const ids = going.map((v) => v.version_id);
  const keys = (await ctx.db.selectFrom("mockup_prototype_files").select("blob_key").distinct().where("version_id", "in", ids).execute()).map((r) => r.blob_key);
  await ctx.db.deleteFrom("mockup_prototype_files").where("version_id", "in", ids).execute();
  await ctx.db.deleteFrom("mockup_files").where("version_id", "in", ids).execute();
  await ctx.db.deleteFrom("mockup_pages").where("version_id", "in", ids).execute();
  await ctx.db.deleteFrom("mockup_versions").where("version_id", "in", ids).execute();
  if (keys.length) {
    // A version carries its base's prototype bytes forward, so a blob goes only once no version holds it.
    const held = new Set((await ctx.db.selectFrom("mockup_prototype_files").select("blob_key").where("blob_key", "in", keys).execute()).map((r) => r.blob_key));
    const free = keys.filter((k) => !held.has(k));
    for (let i = 0; i < free.length; i += 500) await ctx.enqueue("delete_blobs", { keys: free.slice(i, i + 500), prefixes: [] });
  }
  const ns = going.map((v) => v.n);
  await recordActivity(ctx, {
    action: "versions_deleted",
    entity_type: "mockup",
    entity_id: mockup.mockup_id,
    entity_title: mockup.title,
    summary: `Deleted ${versionWords(ns)}: the organization's plan keeps each mockup's newest ${keep}${older.length > going.length ? ", and those a Story page shows" : ""}`,
  });
  return ns;
}

/**
 * Delete a Story page's versions past what its plan keeps. A mockup version that only those showed
 * goes too, by its mockup's own trim. Returns the numbers of the page's versions deleted, oldest first.
 */
export async function trimStoryVersions(ctx: OpContext, page: { page_id: string; title: string }): Promise<number[]> {
  const keep = versionsKept(ctx, "story_page_versions_max");
  if (keep === null) return [];
  const pid = productId(ctx);
  const going = (await ctx.db.selectFrom("story_versions").select(["version_id", "n", "mockup"]).where("product_id", "=", pid).where("page_id", "=", page.page_id).orderBy("n", "desc").execute())
    .slice(keep)
    .sort((a, b) => a.n - b.n);
  if (!going.length) return [];
  await ctx.db.deleteFrom("story_versions").where("version_id", "in", going.map((v) => v.version_id)).execute();
  const ns = going.map((v) => v.n);
  await recordActivity(ctx, {
    action: "versions_deleted",
    entity_type: "story_page",
    entity_id: page.page_id,
    entity_title: page.title,
    summary: `Deleted ${versionWords(ns)}: the organization's plan keeps each Story page's newest ${keep}`,
  });
  const mockupIds = [...new Set(going.flatMap((v) => (v.mockup ? [v.mockup.mockup_id] : [])))];
  if (mockupIds.length) {
    const mockups = await ctx.db.selectFrom("mockups").select(["mockup_id", "title"]).where("product_id", "=", pid).where("mockup_id", "in", mockupIds).execute();
    for (const m of mockups) await trimMockupVersions(ctx, m);
  }
  return ns;
}

/**
 * The refusal for a version number a mockup or a Story page does not hold: 410 version_deleted, with
 * the versions it keeps, for one its plan's trim deleted; otherwise the 404 `otherwise` says.
 */
export async function noSuchVersion(ctx: OpContext, of: { mockup_id: string } | { page_id: string }, n: number, otherwise: string): Promise<AppError> {
  const pid = productId(ctx);
  const rows =
    "mockup_id" in of
      ? await ctx.db.selectFrom("mockup_versions").select("n").where("product_id", "=", pid).where("mockup_id", "=", of.mockup_id).orderBy("n").execute()
      : await ctx.db.selectFrom("story_versions").select("n").where("product_id", "=", pid).where("page_id", "=", of.page_id).orderBy("n").execute();
  const kept = rows.map((r) => r.n);
  const newest = kept[kept.length - 1] ?? 0;
  if (n < 1 || n > newest) return notFound(otherwise, { versions_kept: kept });
  const what = "mockup_id" in of ? "mockup" : "Story page";
  return gone(
    "version_deleted",
    `Version ${n} of this ${what} was deleted: the organization's plan keeps each ${what}'s newest versions${what === "mockup" ? ", and those a Story page shows" : ""}. It keeps ${versionWords(kept)}.`,
    { version: n, versions_kept: kept },
  );
}
