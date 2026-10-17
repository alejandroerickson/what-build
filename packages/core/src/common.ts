import { json, type ActorSnapshot, type Refs } from "./db.ts";
import { invalid, staleEtag } from "./errors.ts";
import type { OpContext } from "./registry.ts";
import { collapse, newId, normalizeKey, sameEtag, uniq } from "./util.ts";

export type EntityType =
  | "product"
  | "team"
  | "tenant"
  | "membership"
  | "source"
  | "outcome"
  | "assumption"
  | "story_page"
  | "mockup"
  | "story_hierarchy"
  | "story_style"
  | "annotation"
  | "sandbox"
  | "feedback";

/**
 * Append one activity event in the caller's transaction. Events name objects; they never quote
 * content, bodies, passages or email addresses.
 */
export async function recordActivity(
  ctx: OpContext,
  e: { action: string; entity_type: EntityType; entity_id: string | null; entity_title: string | null; summary: string },
): Promise<void> {
  const tenantId = ctx.scope.tenant?.tenant_id;
  if (!tenantId) return;
  await ctx.db
    .insertInto("activity")
    .values({
      activity_id: newId(),
      tenant_id: tenantId,
      team_id: ctx.scope.team?.team_id ?? null,
      product_id: ctx.scope.product?.product_id ?? null,
      actor: json(ctx.actor),
      actor_account_id: ctx.actor.account_id,
      channel: ctx.actor.surface,
      action: e.action,
      entity_type: e.entity_type,
      entity_id: e.entity_id,
      entity_title: e.entity_title ? collapse(e.entity_title, 200) : null,
      summary: collapse(e.summary, 280) || e.action,
    })
    .execute();
}

/** Keep the previous text of an authored body whenever it is overwritten. Never rewinds history. */
export async function keepRevision(
  ctx: OpContext,
  objectType: string,
  objectId: string,
  previous: Record<string, unknown>,
  writtenAt: string,
  writtenBy: ActorSnapshot,
): Promise<number> {
  const row = await ctx.db
    .selectFrom("revisions")
    .select((eb) => eb.fn.max("n").as("n"))
    .where("object_type", "=", objectType)
    .where("object_id", "=", objectId)
    .executeTakeFirst();
  const n = Number(row?.n ?? 0) + 1;
  await ctx.db
    .insertInto("revisions")
    .values({
      revision_id: newId(),
      tenant_id: ctx.scope.tenant!.tenant_id,
      object_type: objectType,
      object_id: objectId,
      n,
      content: json(previous),
      replaced_by: json(ctx.actor),
      written_at: writtenAt,
      written_by: json(writtenBy),
    })
    .execute();
  return n;
}

export function checkEtag(expected: string, current: string, what: string) {
  if (!sameEtag(expected, current)) throw staleEtag(current, what);
}

export function productId(ctx: OpContext): string {
  return ctx.scope.product!.product_id;
}

export function tenantId(ctx: OpContext): string {
  return ctx.scope.tenant!.tenant_id;
}

export function normalizeTags(tags: string[] | undefined): string[] {
  return uniq((tags ?? []).map((t) => normalizeKey(t)).filter(Boolean));
}

export const EMPTY_REFS: Refs = { outcomes: [], sources: [], assumptions: [] };

/**
 * Check that every referenced id exists in this product and is of the named kind. References never
 * cross products: that keeps a product exportable as a closed bundle.
 */
export async function validateRefs(ctx: OpContext, refs: Partial<Refs>): Promise<Refs> {
  const pid = productId(ctx);
  const out: Refs = {
    outcomes: uniq(refs.outcomes ?? []),
    sources: uniq(refs.sources ?? []),
    assumptions: uniq(refs.assumptions ?? []),
  };
  const missing: string[] = [];
  const check = async (ids: string[], found: Promise<{ id: string; product_id: string }[]>, label: string) => {
    if (!ids.length) return;
    const rows = await found;
    const byId = new Map(rows.map((r) => [r.id, r.product_id]));
    for (const i of ids) {
      const p = byId.get(i);
      if (!p) missing.push(`${label} ${i}`);
      else if (p !== pid) throw invalid("cross_product_reference", `${label} ${i} belongs to another product; references stay inside one product.`);
    }
  };
  await check(
    out.outcomes,
    ctx.db.selectFrom("outcomes").select(["outcome_id as id", "product_id"]).where("outcome_id", "in", out.outcomes.length ? out.outcomes : [""]).execute(),
    "outcome",
  );
  await check(
    out.sources,
    ctx.db.selectFrom("records").select(["record_id as id", "product_id"]).where("record_id", "in", out.sources.length ? out.sources : [""]).execute(),
    "source",
  );
  await check(
    out.assumptions,
    ctx.db
      .selectFrom("register_entries")
      .select(["entry_id as id", "product_id"])
      .where("kind", "=", "assumption")
      .where("entry_id", "in", out.assumptions.length ? out.assumptions : [""])
      .execute(),
    "assumption",
  );
  if (missing.length) throw invalid("unknown_reference", `These references do not exist in this product: ${missing.join(", ")}.`);
  return out;
}

/** Page through rows ordered by a descending ULID column. */
export function pageOf<T>(rows: T[], limit: number, key: (row: T) => string): { items: T[]; next_cursor: string | null } {
  const items = rows.slice(0, limit);
  const next = rows.length > limit && items.length ? key(items[items.length - 1]!) : null;
  return { items, next_cursor: next };
}
