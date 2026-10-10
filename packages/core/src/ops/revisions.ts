import { z } from "zod";
import { productId } from "../common.ts";
import { notFound } from "../errors.ts";
import { defineOperation, type OperationDef, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";

/**
 * The three revision operations on an object with an authored body (an outcome): list the kept
 * revisions, read one, and restore one — which writes the old text as a new update, recorded like
 * any other, and never rewinds history.
 */
function revisionOps(cfg: {
  tool: string;
  objectType: string;
  idField: string;
  label: string;
  /** Confirms the object exists in this product. */
  exists: (ctx: OpContext, objectId: string) => Promise<boolean>;
  /** The update operation to call on restore. */
  update: OperationDef;
  /** Maps kept content to update fields. */
  toUpdate: (content: Record<string, unknown>) => Record<string, unknown>;
}) {
  const idSchema = id(cfg.label);
  const list = defineOperation({
    name: `${cfg.tool}.revisions`,
    scope: "product",
    access: "read",
    mutates: false,
    summary: `List the kept revisions of a ${cfg.label}: who replaced which text, and when. No bodies.`,
    description: `Revision n holds the text as it was before the nth overwrite. Use get_revision to read one and restore_revision to bring it back.`,
    input: z.strictObject({ [cfg.idField]: idSchema, limit: z.number().int().min(1).max(200).default(50) }),
    rest: { method: "GET", path: `/${cfg.tool}/:${cfg.idField}/revisions` },
    mcp: { tool: cfg.tool, action: "revisions" },
    async handler(ctx, input) {
      const oid = (input as Record<string, string>)[cfg.idField]!;
      if (!(await cfg.exists(ctx, oid))) throw notFound(`No such ${cfg.label} in this product.`);
      const rows = await ctx.db
        .selectFrom("revisions")
        .select(["n", "written_at", "written_by", "replaced_at", "replaced_by"])
        .where("object_type", "=", cfg.objectType)
        .where("object_id", "=", oid)
        .orderBy("n", "desc")
        .limit((input as { limit: number }).limit)
        .execute();
      return { items: rows };
    },
  });
  const get = defineOperation({
    name: `${cfg.tool}.get_revision`,
    scope: "product",
    access: "read",
    mutates: false,
    summary: `Read one kept revision of a ${cfg.label}.`,
    description: "Returns the text as it was, with who wrote it and who replaced it.",
    input: z.strictObject({ [cfg.idField]: idSchema, n: z.number().int().min(1) }),
    rest: { method: "GET", path: `/${cfg.tool}/:${cfg.idField}/revisions/:n` },
    mcp: { tool: cfg.tool, action: "get_revision" },
    async handler(ctx, input) {
      const oid = (input as Record<string, string>)[cfg.idField]!;
      if (!(await cfg.exists(ctx, oid))) throw notFound(`No such ${cfg.label} in this product.`);
      const row = await ctx.db
        .selectFrom("revisions")
        .selectAll()
        .where("object_type", "=", cfg.objectType)
        .where("object_id", "=", oid)
        .where("n", "=", (input as { n: number }).n)
        .executeTakeFirst();
      if (!row) throw notFound("No such revision.");
      return { n: row.n, content: row.content, written_at: row.written_at, written_by: row.written_by, replaced_at: row.replaced_at, replaced_by: row.replaced_by };
    },
  });
  const restore = defineOperation({
    name: `${cfg.tool}.restore_revision`,
    scope: "product",
    access: "write",
    mutates: true,
    summary: `Bring back a kept revision of a ${cfg.label} as a new update.`,
    description: "The current text is itself kept as a revision first, so restoring is always reversible.",
    input: z.strictObject({ [cfg.idField]: idSchema, n: z.number().int().min(1), expected_etag: expectedEtag }),
    rest: { method: "POST", path: `/${cfg.tool}/:${cfg.idField}/revisions/:n/restore` },
    mcp: { tool: cfg.tool, action: "restore_revision" },
    async handler(ctx, input) {
      const i = input as Record<string, unknown>;
      const oid = i[cfg.idField] as string;
      const row = await ctx.db
        .selectFrom("revisions")
        .selectAll()
        .where("object_type", "=", cfg.objectType)
        .where("object_id", "=", oid)
        .where("n", "=", i["n"] as number)
        .executeTakeFirst();
      if (!row) throw notFound("No such revision.");
      return cfg.update.handler(ctx, { [cfg.idField]: oid, expected_etag: i["expected_etag"], ...cfg.toUpdate(row.content) } as never);
    },
  });
  return [list, get, restore];
}

import { updateOutcome } from "./outcomes.ts";

export const revisionOpsList = [
  ...revisionOps({
    tool: "outcomes",
    objectType: "outcome",
    idField: "outcome_id",
    label: "outcome",
    exists: async (ctx, oid) => Boolean(await ctx.db.selectFrom("outcomes").select("outcome_id").where("outcome_id", "=", oid).where("product_id", "=", productId(ctx)).executeTakeFirst()),
    update: updateOutcome as unknown as OperationDef,
    toUpdate: (c) => ({ title: c["title"], description: c["description"] }),
  }),
];
