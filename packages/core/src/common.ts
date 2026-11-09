import { json, type ActorSnapshot } from "./db.ts";
import { staleEtag } from "./errors.ts";
import type { OpContext } from "./registry.ts";
import { collapse, newId, normalizeKey, sameEtag, uniq } from "./util.ts";

export type EntityType =
  | "product"
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
  | "feedback";

/** Items in a sentence: "a", "a and b", "a, b and c". */
export function listed(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What the activity log calls each part of an object that changed: the words the app uses for it,
 * never the name of its field. `front` and `concept's front` are what older entries say, and some
 * of the names after them are fields objects no longer have, which entries recorded before then name.
 * Words that hold for one kind of object only are in CHANGED_WORDS_OF.
 */
const CHANGED_WORDS: Readonly<Record<string, string>> = {
  title: "the title",
  date: "the date",
  tags: "the tags",
  name: "the name",
  slug: "the short name in links",
  statement: "the statement",
  body: "the text",
  links: "the links",
  outcome_ids: "the outcomes it bears on",
  description: "the text",
  card_html: "the picture",
  front: "the picture",
  position: "its place in the order",
  concept: "the concept",
  "concept's front": "the concept's picture",
  summary: "the summary",
  status: "the status",
  references: "what it cites",
  citations: "what it cites",
  dimensions: "the dimensions",
  provenance_depth: "how far it is from the evidence",
};

/**
 * Words for one kind of object, ahead of CHANGED_WORDS. A source's fields that are gone are read
 * as a source's. Insights and decisions became sources, and their entries with them, so a source's
 * `body` (an insight's or a decision's text) and `links` (a decision's) keep the plain words, never
 * an assumption's.
 */
const SOURCE_WORDS: Readonly<Record<string, string>> = {
  kind: "the kind of material",
  organization: "the organization it is from",
  participants: "the participants",
  related_records: "the related sources",
};
const CHANGED_WORDS_OF: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  assumption: { body: "why the team holds it", links: "the links to other assumptions" },
  source: SOURCE_WORDS,
  insight: SOURCE_WORDS,
  decision: SOURCE_WORDS,
};

/** The words for a field of this kind of object, if it has any. */
function wordsFor(entityType: string, field: string): string | undefined {
  const own = Object.hasOwn(CHANGED_WORDS_OF, entityType) ? CHANGED_WORDS_OF[entityType]! : {};
  if (Object.hasOwn(own, field)) return own[field];
  return Object.hasOwn(CHANGED_WORDS, field) ? CHANGED_WORDS[field] : undefined;
}

/** A field's name, which has an underscore in it ("source_system"), for one no words were given for. */
const FIELD_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** Whether an entry names this as a field: one with words, or a name no words were given for. */
const isField = (entityType: string, field: string) => wordsFor(entityType, field) !== undefined || FIELD_NAME.test(field);

/** What the log calls a part that changed: its words, or its name read as words, never `_ids` or `snake_case`. */
function changedPart(entityType: string, field: string): string {
  return wordsFor(entityType, field) ?? `the ${field.replace(/_ids?$/, (end) => (end === "_ids" ? "s" : "")).replace(/_/g, " ")}`;
}

/** The sentence for a change to these fields, for a kind of object named as an entry stores it. */
const changedSentence = (entityType: string, fields: readonly string[]) => `Changed ${listed(fields.map((f) => changedPart(entityType, f)))}`;

/** An activity entry's summary for a change to these fields of this kind of object: "Changed the title and the tags". */
export function changedSummary(entityType: EntityType, fields: readonly string[]): string {
  return changedSentence(entityType, fields);
}

const REFILED = "Refiled under ";
const REVISION = " (revision ";

/**
 * The same sentence for an entry recorded with the fields' names ("Changed outcome_ids, tags"),
 * including an insight's, which ended with its revision ("Changed title, body (revision 2)"), and a
 * source's that was refiled ("Refiled under …; changed title, kind"), in the words for the kind of
 * object the entry is about. Any other summary, one already in words or a word that is not a field
 * ("Changed everything") included, comes back as it is. Read with string operations, so a long
 * summary costs no more than its length.
 */
export function changedInWords(entityType: string, summary: string): string {
  let refiled = "";
  let rest: string;
  if (summary.startsWith(REFILED)) {
    const at = summary.lastIndexOf("; changed ");
    if (at <= REFILED.length) return summary;
    refiled = summary.slice(0, at);
    rest = summary.slice(at + "; changed ".length);
  } else if (summary.startsWith("Changed ")) {
    rest = summary.slice("Changed ".length);
  } else return summary;
  const revision = rest.lastIndexOf(REVISION);
  if (revision > 0 && rest.endsWith(")") && /^\d+$/.test(rest.slice(revision + REVISION.length, -1))) rest = rest.slice(0, revision);
  const fields = rest.split(", ");
  if (!fields.every((f) => isField(entityType, f))) return summary;
  const changed = changedSentence(entityType, fields);
  return refiled ? `${refiled}; c${changed.slice(1)}` : changed;
}

/**
 * Append one activity event in the caller's transaction. Events name objects; they never quote
 * content, bodies, a source's text or email addresses.
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

/** Page through rows ordered by a descending ULID column. */
export function pageOf<T>(rows: T[], limit: number, key: (row: T) => string): { items: T[]; next_cursor: string | null } {
  const items = rows.slice(0, limit);
  const next = rows.length > limit && items.length ? key(items[items.length - 1]!) : null;
  return { items, next_cursor: next };
}
