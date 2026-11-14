import { z } from "zod";
import { checkEtag, productId, recordActivity, tenantId } from "../common.ts";
import { json } from "../db.ts";
import { refuseIfDeleted } from "../deletion.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { newEtag, newId } from "../util.ts";

/**
 * How a product's mockups are arranged, by hand: each sits in one folder or in none, folders are
 * one level deep, and the folders, the mockups in each and the mockups in none keep the order they
 * are given. Arranging is no change to a mockup: it makes no version and leaves the mockup's etag
 * and its address as they were, so someone publishing its next version is never refused for it.
 */

export const MOCKUP_FOLDER_NAME_MAX = 80;

/** How the arrangement works, as every operation that changes it says it. */
const ARRANGING_TEXT =
  "A mockup sits in one folder or in none, and folders hold no folders. People see the mockups in no folder first, then each folder with its own, all in the order they were given; nothing reorders them by itself, and a new mockup goes to the top of where it is put. Arranging changes no mockup: its etag, its versions and its address stay as they were. People arrange them in the web app too, so read the list again before relying on an order you read earlier.";

const folderId = id("mockup folder");
const folderName = z
  .string()
  .trim()
  .min(1)
  .max(MOCKUP_FOLDER_NAME_MAX)
  .describe(`The folder's name, up to ${MOCKUP_FOLDER_NAME_MAX} characters. A product has one folder of a name, whatever its capitals.`);

type FolderRow = { folder_id: string; name: string; position: number; etag: string; created_at: string; updated_at: string; updated_by: unknown };

function folderView(f: FolderRow, mockupCount: number) {
  return { folder_id: f.folder_id, name: f.name, etag: f.etag, mockup_count: mockupCount, created_at: f.created_at, updated_at: f.updated_at, updated_by: f.updated_by };
}

/** The product's folders, in their order. */
async function folderRows(ctx: OpContext, lock = false): Promise<FolderRow[]> {
  let q = ctx.db
    .selectFrom("mockup_folders")
    .select(["folder_id", "name", "position", "etag", "created_at", "updated_at", "updated_by"])
    .where("product_id", "=", productId(ctx))
    .orderBy("position")
    .orderBy("folder_id");
  if (lock) q = q.forUpdate();
  return q.execute();
}

/** The product's folders in their order, each with how many mockups that are not archived it holds. */
export async function mockupFolders(ctx: OpContext) {
  const rows = await folderRows(ctx);
  const counts = await ctx.db
    .selectFrom("mockups")
    .select((eb) => ["folder_id", eb.fn.countAll<number>().as("n")])
    .where("product_id", "=", productId(ctx))
    .where("archived_at", "is", null)
    .where("folder_id", "is not", null)
    .groupBy("folder_id")
    .execute();
  const n = new Map(counts.map((c) => [c.folder_id, Number(c.n)]));
  return rows.map((f) => folderView(f, n.get(f.folder_id) ?? 0));
}

/** A folder of this product, or 404. */
export async function loadMockupFolder(ctx: OpContext, id: string) {
  const f = await ctx.db
    .selectFrom("mockup_folders")
    .select(["folder_id", "name", "position", "etag", "created_at", "updated_at", "updated_by"])
    .where("product_id", "=", productId(ctx))
    .where("folder_id", "=", id)
    .executeTakeFirst();
  if (!f) throw notFound(`There is no mockup folder ${id} in this product. mockups_read(action="list") gives the folders it has.`);
  return f;
}

/** Mockups as the team arranged them: those in no folder, then each folder's, in the folders' order. */
export function inArrangedOrder<T extends { mockup_id: string; folder_id: string | null; position: number }>(rows: T[], folders: { folder_id: string }[]): T[] {
  const place = new Map(folders.map((f, i) => [f.folder_id, i]));
  const of = (r: T) => (r.folder_id === null ? -1 : (place.get(r.folder_id) ?? folders.length));
  // Two mockups made at the same moment may share a place: the newer one is first, as a new mockup is.
  return [...rows].sort((a, b) => of(a) - of(b) || a.position - b.position || (a.mockup_id < b.mockup_id ? 1 : a.mockup_id > b.mockup_id ? -1 : 0));
}

/** The place that puts a new mockup first in a folder, or first among those in none. */
export async function topOfFolder(ctx: OpContext, folder: string | null): Promise<number> {
  let q = ctx.db.selectFrom("mockups").select((eb) => eb.fn.min("position").as("first")).where("product_id", "=", productId(ctx));
  q = folder === null ? q.where("folder_id", "is", null) : q.where("folder_id", "=", folder);
  const r = await q.executeTakeFirst();
  return r?.first === null || r?.first === undefined ? 0 : Number(r.first) - 1;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Two calls at once may both find a name free; the database lets one of them have it, and the other is told as if it had come second. */
async function unlessNameTaken<T>(write: Promise<T>, name: string, what: string): Promise<T> {
  try {
    return await write;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw conflict("folder_name_taken", `Nothing was ${what}: this product has a folder named ${name} already. Use it, or choose another name.`, { name });
    throw e;
  }
}

function nameTaken(name: string, by: FolderRow, what: string) {
  return conflict("folder_name_taken", `Nothing was ${what}: this product has a folder named ${by.name} already. Use it, or choose another name.`, { folder_id: by.folder_id, name: by.name });
}

export const createMockupFolder = defineOperation({
  name: "mockups.create_folder",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Make a folder for mockups. It goes after the product's other folders, empty.",
  description: `${ARRANGING_TEXT} A product holds as many folders as the team makes, and one of a name, whatever its capitals (409 folder_name_taken, whose details give the folder that has it). move puts a mockup in it, publish puts a new mockup in it, and move_folder gives it another place among the folders.`,
  input: z.strictObject({ name: folderName }),
  rest: { method: "POST", path: "/mockup-folders" },
  mcp: { tool: "mockups", action: "create_folder" },
  async handler(ctx, input) {
    const rows = await folderRows(ctx, true);
    const taken = rows.find((f) => sameName(f.name, input.name));
    if (taken) throw nameTaken(input.name, taken, "made");
    const folder_id = newId();
    await unlessNameTaken(
      ctx.db
        .insertInto("mockup_folders")
        .values({
          folder_id,
          tenant_id: tenantId(ctx),
          product_id: productId(ctx),
          name: input.name,
          position: rows.length ? Math.max(...rows.map((f) => f.position)) + 1 : 0,
          etag: newEtag(),
          created_by: json(ctx.actor),
          updated_by: json(ctx.actor),
        })
        .execute(),
      input.name,
      "made",
    );
    await recordActivity(ctx, { action: "folder_created", entity_type: "mockup", entity_id: folder_id, entity_title: input.name, summary: "Made the folder" });
    return folderView(await loadMockupFolder(ctx, folder_id), 0);
  },
});

export const renameMockupFolder = defineOperation({
  name: "mockups.rename_folder",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Rename a folder of mockups.",
  description: "Pass the folder's etag, which list gives. The mockups in it stay in it. A product has one folder of a name, whatever its capitals (409 folder_name_taken).",
  input: z.strictObject({ folder_id: folderId, name: folderName, expected_etag: expectedEtag }),
  rest: { method: "PATCH", path: "/mockup-folders/:folder_id" },
  mcp: { tool: "mockups", action: "rename_folder" },
  async handler(ctx, input) {
    const rows = await folderRows(ctx, true);
    const f = rows.find((r) => r.folder_id === input.folder_id) ?? (await loadMockupFolder(ctx, input.folder_id));
    checkEtag(input.expected_etag, f.etag, "folder");
    if (f.name !== input.name) {
      const taken = rows.find((r) => r.folder_id !== f.folder_id && sameName(r.name, input.name));
      if (taken) throw nameTaken(input.name, taken, "renamed");
      await unlessNameTaken(
        ctx.db.updateTable("mockup_folders").set({ name: input.name, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) }).where("folder_id", "=", f.folder_id).execute(),
        input.name,
        "renamed",
      );
      await recordActivity(ctx, { action: "folder_renamed", entity_type: "mockup", entity_id: f.folder_id, entity_title: input.name, summary: `Renamed the folder, which was ${f.name}` });
    }
    const counted = (await mockupFolders(ctx)).find((r) => r.folder_id === f.folder_id);
    return counted ?? folderView(await loadMockupFolder(ctx, f.folder_id), 0);
  },
});

export const moveMockupFolder = defineOperation({
  name: "mockups.move_folder",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Give a folder of mockups another place among the product's folders.",
  description: `${ARRANGING_TEXT} before_folder_id is the folder it goes in front of; omit it, or pass null, to put it last. It answers with the folders in their new order.`,
  input: z.strictObject({
    folder_id: folderId,
    before_folder_id: folderId.nullable().optional().describe("The folder it goes in front of. Omit, or null, to put it after every other folder."),
  }),
  rest: { method: "POST", path: "/mockup-folders/:folder_id/move" },
  mcp: { tool: "mockups", action: "move_folder" },
  async handler(ctx, input) {
    const rows = await folderRows(ctx, true);
    const f = rows.find((r) => r.folder_id === input.folder_id) ?? (await loadMockupFolder(ctx, input.folder_id));
    const before = input.before_folder_id ?? null;
    if (before === f.folder_id) throw invalid("invalid_move", "Nothing was moved: before_folder_id names the folder being moved. Name the folder it goes in front of, or leave it out to put it last.");
    const others = rows.filter((r) => r.folder_id !== f.folder_id);
    const at = before === null ? others.length : others.findIndex((r) => r.folder_id === before);
    if (at < 0) throw notFound(`Nothing was moved: there is no mockup folder ${before} in this product to go in front of. mockups_read(action="list") gives the folders it has.`);
    const next = [...others.slice(0, at), f, ...others.slice(at)];
    if (next.some((r, i) => r.folder_id !== rows[i]!.folder_id)) {
      for (const [i, r] of next.entries()) if (r.position !== i) await ctx.db.updateTable("mockup_folders").set({ position: i }).where("folder_id", "=", r.folder_id).execute();
      await recordActivity(ctx, {
        action: "folder_moved",
        entity_type: "mockup",
        entity_id: f.folder_id,
        entity_title: f.name,
        summary: before === null ? "Moved the folder after the others" : `Moved the folder in front of ${others[at]!.name}`,
      });
    }
    return { folders: await mockupFolders(ctx) };
  },
});

export const removeMockupFolder = defineOperation({
  name: "mockups.remove_folder",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Remove a folder of mockups. Its mockups stay, in no folder.",
  description:
    "Removing a folder deletes no mockup: the ones in it, archived ones included, go after the mockups that are in no folder, in the order they had. mockups_unfiled names them. The folder itself is gone; create_folder makes one of the same name again.",
  input: z.strictObject({ folder_id: folderId }),
  rest: { method: "POST", path: "/mockup-folders/:folder_id/remove" },
  mcp: { tool: "mockups", action: "remove_folder" },
  async handler(ctx, input) {
    const all = await ctx.db.selectFrom("mockups").select(["mockup_id", "folder_id", "position"]).where("product_id", "=", productId(ctx)).orderBy("mockup_id").forUpdate().execute();
    const f = await loadMockupFolder(ctx, input.folder_id);
    const inside = inArrangedOrder(all.filter((m) => m.folder_id === f.folder_id), [f]);
    const last = Math.max(-1, ...all.filter((m) => m.folder_id === null).map((m) => m.position));
    for (const [i, m] of inside.entries()) await ctx.db.updateTable("mockups").set({ folder_id: null, position: last + 1 + i }).where("mockup_id", "=", m.mockup_id).execute();
    await ctx.db.deleteFrom("mockup_folders").where("folder_id", "=", f.folder_id).execute();
    await recordActivity(ctx, {
      action: "folder_removed",
      entity_type: "mockup",
      entity_id: f.folder_id,
      entity_title: f.name,
      summary: inside.length ? `Removed the folder; its ${inside.length === 1 ? "mockup is" : `${inside.length} mockups are`} in no folder now` : "Removed the folder, which was empty",
    });
    return { removed: true, folder_id: f.folder_id, name: f.name, mockups_unfiled: inside.map((m) => m.mockup_id) };
  },
});

export const moveMockup = defineOperation({
  name: "mockups.move",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Put a mockup in a folder, take it out of one, or give it another place among the mockups beside it.",
  description: `${ARRANGING_TEXT} folder_id is the folder it goes in, or null for none; omit it to keep the mockup where it is and only reorder it. before_mockup_id is the mockup it goes in front of, which must be in that same folder (or, for none, in no folder); omit it to put the mockup last there (422 invalid_move when that mockup is somewhere else). It takes no etag and changes none. An archived mockup is restored first (409 mockup_archived). It answers with the folder and order, the mockups there that are not archived, as they now stand.`,
  input: z.strictObject({
    mockup_id: id("mockup"),
    folder_id: folderId.nullable().optional().describe("The folder to put it in; null for no folder. Omit to leave it in the folder it is in."),
    before_mockup_id: id("mockup").nullable().optional().describe("The mockup it goes in front of, in that folder. Omit, or null, to put it last there."),
  }),
  rest: { method: "POST", path: "/mockups/:mockup_id/move" },
  mcp: { tool: "mockups", action: "move" },
  async handler(ctx, input) {
    // Every mockup of the product is held, so two moves at once are applied one after the other.
    const all = await ctx.db
      .selectFrom("mockups")
      .select(["mockup_id", "title", "folder_id", "position", "archived_at"])
      .where("product_id", "=", productId(ctx))
      // In one order every time, so two moves at once wait for each other and never for one another's rows.
      .orderBy("mockup_id")
      .forUpdate()
      .execute();
    const m = all.find((r) => r.mockup_id === input.mockup_id);
    if (!m) {
      await refuseIfDeleted(ctx, "mockup", input.mockup_id, `Mockup ${input.mockup_id}`);
      throw notFound(`There is no mockup ${input.mockup_id} in this product.`);
    }
    if (m.archived_at) throw conflict("mockup_archived", "This mockup is archived; restore it before moving it.");
    const target = input.folder_id === undefined ? m.folder_id : input.folder_id;
    const folder = target === null ? null : await loadMockupFolder(ctx, target);
    const where = folder ? `the folder ${folder.name}` : "no folder";
    const before = input.before_mockup_id ?? null;
    if (before === m.mockup_id) throw invalid("invalid_move", "Nothing was moved: before_mockup_id names the mockup being moved. Name the mockup it goes in front of, or leave it out to put it last.");
    const here = inArrangedOrder(all.filter((r) => r.folder_id === target), folder ? [folder] : []);
    const others = here.filter((r) => r.mockup_id !== m.mockup_id);
    const at = before === null ? others.length : others.findIndex((r) => r.mockup_id === before);
    if (at < 0)
      throw invalid(
        "invalid_move",
        `Nothing was moved: mockup ${before} is not in ${where}, so the mockup cannot go in front of it there. mockups_read(action="list") gives each mockup's folder_id.`,
        { before_mockup_id: before, folder_id: target },
      );
    const next = [...others.slice(0, at), m, ...others.slice(at)];
    const moved = m.folder_id !== target || next.some((r, i) => r.mockup_id !== here[i]?.mockup_id);
    if (moved) {
      for (const [i, r] of next.entries()) {
        if (r.mockup_id === m.mockup_id) await ctx.db.updateTable("mockups").set({ folder_id: target, position: i }).where("mockup_id", "=", r.mockup_id).execute();
        else if (r.position !== i) await ctx.db.updateTable("mockups").set({ position: i }).where("mockup_id", "=", r.mockup_id).execute();
      }
      await recordActivity(ctx, {
        action: "moved",
        entity_type: "mockup",
        entity_id: m.mockup_id,
        entity_title: m.title,
        summary: m.folder_id === target ? `Moved the mockup among those in ${where}` : folder ? `Moved the mockup into ${where}` : "Moved the mockup out of its folder",
      });
    }
    return {
      mockup_id: m.mockup_id,
      title: m.title,
      moved,
      folder: folder ? { folder_id: folder.folder_id, name: folder.name } : null,
      order: next.filter((r) => !r.archived_at).map((r) => r.mockup_id),
    };
  },
});

export const mockupFolderOps = [createMockupFolder, renameMockupFolder, moveMockupFolder, removeMockupFolder, moveMockup];
