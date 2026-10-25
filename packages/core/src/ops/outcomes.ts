import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { checkEtag, keepRevision, productId, recordActivity, tenantId } from "../common.ts";
import { json, type OutcomesTable } from "../db.ts";
import { checkConfirmation, DELETE_GUIDANCE, deleteGuards, dropRevisions, leaveTombstone, refuseIfDeleted } from "../deletion.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { roleAtLeast } from "../policy.ts";
import { refuseVisitorWrite } from "../public-sandbox.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { expectedEtag, id } from "../schemas.ts";
import { likeContaining, newEtag, newId } from "../util.ts";
import { adviseIdeaCard, CARD_FRAMES, CARD_GUIDANCE, CARD_HTML_MAX, CARD_ICON_NAMES, checkCardSides, checkIdeaCard } from "../idea-card.ts";
import { DOWNLOAD_GRANT_HEADER, requesterClaims } from "./attachments.ts";

type Row = Selectable<OutcomesTable>;

const outcomeId = id("outcome").describe("The outcome id. id is accepted as another name for it.");

/**
 * What an outcome is, said once for every operation that writes one. Outcomes are the product's
 * compass: the evidence, the assumptions, the mockups and the Story are all read against them, so
 * an outcome says where the product is going and never retells how the team found out.
 */
const WHAT_AN_OUTCOME_IS =
  "An outcome is what the product's users should be able to achieve with it: the compass the evidence, assumptions, mockups and Story are read against, so write it to last. " +
  "Each outcome is a card on the Idea screen. Title: what the user achieves, from their side (\"The crew lead plans next week in minutes\"), shown in the card's head. " +
  "card_html is the front, which people see first: a picture of the outcome that someone new to the team takes in at a glance, drawn with the card kit; call outcomes(action=\"card_guidance\") before drawing one, and outcomes(action=\"card_preview\") to look at it before writing it. " +
  "description is the back: what success looks like for the users and what it means, in depth (Markdown, up to 6,000 characters), which agents read first and people open with More info. " +
  "The two sides say the same thing and change together: a call that changes one sends the other too, unchanged if it still agrees, and one that sends only one side is refused with card_sides_together. " +
  "Neither side cites or retells evidence: no sources, quotes, calls, emails, dates, named customers or people who asked, journeys, assumptions or mockups. " +
  "Evidence belongs in sources, and what it suggests in assumptions, which point at the outcome through outcome_ids. An id or a link to a record is refused. Keep the set small.";

/** The most characters an outcome's back holds. */
const DESCRIPTION_MAX = 6000;

/** An outcome as a list gives it: its front's length in place of the front, which outcomes.get gives. */
function listed(row: Row) {
  const { card_html, ...rest } = row;
  return { ...rest, card_chars: card_html.length };
}

/** Said after a write that leaves an outcome with no front. */
const NO_FRONT = 'This outcome has no front yet, so people see its text and a request for a picture: draw one in card_html, sent with its description, after reading outcomes(action="card_guidance").';

/**
 * An outcome as a write returns it: with a note when it has no front, and, when the write touched
 * its card, advice on what the guidance asks that the card misses.
 */
function written(row: Row, touchedCard: boolean) {
  if (!row.card_html) return { ...row, note: NO_FRONT };
  const card_advice = touchedCard ? adviseIdeaCard({ kind: "outcome", front: row.card_html, back: row.description, title: row.title }) : [];
  return card_advice.length ? { ...row, card_advice } : row;
}

/** Any id names a record (a source, an assumption, a mockup, a Story page), and an outcome names none. */
const RECORD_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

function refuseReferences(text: { title?: string; description?: string; card_html?: string }) {
  for (const field of ["title", "description", "card_html"] as const) {
    const found = text[field] && RECORD_ID.exec(text[field]!);
    if (found)
      throw invalid(
        "outcome_cites_a_record",
        `An outcome cites nothing: its ${field} names the record ${found[0]}. Say what the users achieve and what success looks like for them, and put the evidence in an assumption that points at this outcome through outcome_ids.`,
        { field, id: found[0] },
      );
  }
}

async function load(ctx: OpContext, outcomeId: string, lock = false) {
  let q = ctx.db.selectFrom("outcomes").selectAll().where("outcome_id", "=", outcomeId).where("product_id", "=", productId(ctx));
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) {
    await refuseIfDeleted(ctx, "outcome", outcomeId, `Outcome ${outcomeId}`);
    throw notFound(`Outcome ${outcomeId} doesn’t exist in this product.`);
  }
  return row as Row;
}

/** Referenced outcomes that are archived: hidden from the outcomes list, but still linkable. */
export async function archivedOutcomeIds(ctx: OpContext, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await ctx.db.selectFrom("outcomes").select("outcome_id").where("product_id", "=", productId(ctx)).where("archived_at", "is not", null).where("outcome_id", "in", [...new Set(ids)]).execute();
  return new Set(rows.map((r) => r.outcome_id));
}

export const listOutcomes = defineOperation({
  name: "outcomes.list",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "List the product's outcomes in order: the compass every other part of the product is read against.",
  description:
    "Outcomes are what the product's users should be able to achieve with it, under the product concept. Read them at the start of any work in a product, and check what you write against them. " +
    "Assumptions point at them through outcome_ids; an outcome points at nothing. To see the assumptions that serve one, list assumptions with its outcome_id. " +
    "Archived outcomes are left out unless include_archived; archived_hidden says how many were left out. An archived outcome can still be linked, and assumptions flag such links in archived_outcome_ids. " +
    "Each item's description is the back of its card, the text agents read; card_chars is the length of its front, the picture people see first (0 when it has none), and outcomes(action=\"get\") returns the front itself.",
  input: z.strictObject({
    include_archived: z.boolean().default(false),
    query: z.string().max(500).optional().describe("Case-insensitive substring of title or description."),
    limit: z.number().int().min(1).max(100).default(100),
    cursor: z.string().optional(),
  }),
  rest: { method: "GET", path: "/outcomes" },
  mcp: { tool: "outcomes", action: "list" },
  async handler(ctx, input) {
    let q = ctx.db.selectFrom("outcomes").selectAll().where("product_id", "=", productId(ctx));
    if (!input.include_archived) q = q.where("archived_at", "is", null);
    if (input.query) q = q.where(sql<boolean>`(title ilike ${likeContaining(input.query)} or description ilike ${likeContaining(input.query)})`);
    if (input.cursor) q = q.where("position", ">", Number(input.cursor));
    const rows = (await q.orderBy("position").orderBy("outcome_id").limit(input.limit + 1).execute()) as Row[];
    const items = rows.slice(0, input.limit);
    let archived_hidden = 0;
    if (!input.include_archived) {
      let a = ctx.db.selectFrom("outcomes").select((eb) => eb.fn.countAll<number>().as("n")).where("product_id", "=", productId(ctx)).where("archived_at", "is not", null);
      if (input.query) a = a.where(sql<boolean>`(title ilike ${likeContaining(input.query)} or description ilike ${likeContaining(input.query)})`);
      archived_hidden = Number((await a.executeTakeFirst())?.n ?? 0);
    }
    // Outcomes with no front, for whoever can draw them.
    const bare = roleAtLeast(ctx.scope.role, "editor") ? items.filter((o) => !o.card_html && !o.archived_at).length : 0;
    const notes = [
      archived_hidden ? `${archived_hidden} archived outcome${archived_hidden === 1 ? " is" : "s are"} not listed; pass include_archived to see ${archived_hidden === 1 ? "it" : "them"}.` : "",
      bare ? `${bare} of these outcomes ${bare === 1 ? "has" : "have"} no front yet (card_chars 0), so people see only ${bare === 1 ? "its" : "their"} text: offer the person to draw ${bare === 1 ? "it" : "them"} (outcomes(action="card_guidance")).` : "",
    ].filter(Boolean);
    return {
      items: items.map(listed),
      next_cursor: rows.length > input.limit ? String(items[items.length - 1]!.position) : null,
      archived_hidden,
      ...(notes.length ? { note: notes.join(" ") } : {}),
    };
  },
});

export const getOutcome = defineOperation({
  name: "outcomes.get",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Read one outcome, both sides of its card, with its etag.",
  description: "card_html is the front of its card, the picture people see first; description its back, the text agents read and people open with More info. Read both before changing either. The etag guards update, archive and restore.",
  input: z.strictObject({ outcome_id: outcomeId }),
  rest: { method: "GET", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "get" },
  async handler(ctx, input) {
    return load(ctx, input.outcome_id);
  },
});

export const createOutcome = defineOperation({
  name: "outcomes.create",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Add an outcome: something the product's users should be able to achieve with it, not a feature, a task or a finding.",
  description: `${WHAT_AN_OUTCOME_IS} Propose outcomes to the person and add them once they agree, each with both sides. A new outcome goes to the end of the order unless position places it.`,
  input: z.strictObject({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(DESCRIPTION_MAX).default("").describe("The back of the card, which agents read first: Markdown, up to 6,000 characters, on what success looks like for the users."),
    card_html: z.string().max(CARD_HTML_MAX).default("").describe("The front of the card, the picture people see first: HTML in the card kit (outcomes(action=\"card_guidance\")). Draw it with the description: without it, people see only text."),
    position: z.number().optional().describe("Ordering key, as on update: to place the outcome between two others, use a value between their positions. Omit to put it last."),
  }),
  rest: { method: "POST", path: "/outcomes" },
  mcp: { tool: "outcomes", action: "create" },
  async handler(ctx, input) {
    refuseReferences(input);
    checkIdeaCard(input.card_html, "The outcome");
    const last = await ctx.db.selectFrom("outcomes").select((eb) => eb.fn.max("position").as("p")).where("product_id", "=", productId(ctx)).executeTakeFirst();
    const outcome_id = newId();
    await ctx.db
      .insertInto("outcomes")
      .values({
        outcome_id, tenant_id: tenantId(ctx), product_id: productId(ctx), title: input.title, description: input.description, card_html: input.card_html,
        position: input.position ?? Number(last?.p ?? 0) + 1, etag: newEtag(), created_by: json(ctx.actor), updated_by: json(ctx.actor),
      })
      .execute();
    await recordActivity(ctx, { action: "created", entity_type: "outcome", entity_id: outcome_id, entity_title: input.title, summary: "Added an outcome" });
    return written(await load(ctx, outcome_id), true);
  },
});

export const updateOutcome = defineOperation({
  name: "outcomes.update",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Change an outcome's title, the two sides of its card, or its position. Pass only what changes, and both sides when either changes.",
  description:
    `Requires expected_etag from your latest read. Fields you omit keep their values. The previous title and both sides are kept as a revision. ${WHAT_AN_OUTCOME_IS} ` +
    "An outcome changes when the person changes what the product is for, not when evidence arrives: when evidence challenges one, tell the person and propose new wording rather than adding the evidence to it. To retire one, archive it.",
  input: z.strictObject({
    outcome_id: outcomeId,
    expected_etag: expectedEtag,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(DESCRIPTION_MAX).optional().describe("The back of the card, which agents read first: Markdown. Send card_html with it."),
    card_html: z.string().trim().min(1, "An outcome's front cannot be emptied; send a new one.").max(CARD_HTML_MAX).optional().describe("The front of the card, the picture people see first: HTML in the card kit. Send description with it."),
    position: z.number().optional().describe("Ordering key; to move between two outcomes, use a value between their positions."),
  }),
  rest: { method: "PATCH", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "update" },
  async handler(ctx, input) {
    refuseReferences(input);
    const row = await load(ctx, input.outcome_id, true);
    checkEtag(input.expected_etag, row.etag, "outcome");
    checkCardSides({ back: row.description, front: row.card_html }, { back: input.description, front: input.card_html }, { what: "The outcome", back: "description", read: 'outcomes(action="get")' });
    checkIdeaCard(input.card_html, "The outcome");
    const changed = (["title", "description", "card_html", "position"] as const).filter((k) => input[k] !== undefined && input[k] !== row[k]);
    if (changed.some((k) => k !== "position"))
      await keepRevision(ctx, "outcome", row.outcome_id, { title: row.title, description: row.description, card_html: row.card_html }, row.updated_at, row.updated_by);
    if (changed.length) {
      await ctx.db
        .updateTable("outcomes")
        .set({
          title: input.title ?? row.title,
          description: input.description ?? row.description,
          card_html: input.card_html ?? row.card_html,
          position: input.position ?? row.position,
          etag: newEtag(),
          updated_at: ctx.now,
          updated_by: json(ctx.actor),
        })
        .where("outcome_id", "=", row.outcome_id)
        .execute();
      await recordActivity(ctx, {
        action: changed.includes("position") && changed.length === 1 ? "reordered" : "updated",
        entity_type: "outcome",
        entity_id: row.outcome_id,
        entity_title: input.title ?? row.title,
        summary: `Changed ${changed.map((k) => (k === "card_html" ? "front" : k)).join(", ")}`,
      });
    }
    return written(await load(ctx, row.outcome_id), changed.some((k) => k !== "position"));
  },
});

export const outcomeCardGuidance = defineOperation({
  name: "outcomes.card_guidance",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "How to draw an Idea card, an outcome's or the product concept's: how to choose what the front shows, the card kit's parts with examples, its pictograms, the room a front has, how to write the back, and a check before sending.",
  description:
    "Read it before writing card_html with outcomes(action=\"create\") or (action=\"update\"), or products(action=\"create\") or (action=\"update_concept\"). The same for every product: guidance is the reference as Markdown, icons the pictogram names data-icon accepts, frames the widths and most height each front is shown at, and max_chars the longest front. outcomes(action=\"card_preview\") shows a front as the Idea screen will, with its height limit marked, before you write it. A write that touches a card returns card_advice when the card misses something this guidance asks.",
  input: z.strictObject({}),
  rest: { method: "GET", path: "/idea/card-guidance" },
  mcp: { tool: "outcomes", action: "card_guidance" },
  async handler() {
    return { guidance: CARD_GUIDANCE, icons: [...CARD_ICON_NAMES], frames: CARD_FRAMES, max_chars: CARD_HTML_MAX };
  },
});

/** Archive or restore: one switch, two operations, as for sources and mockups. */
async function setArchived(ctx: OpContext, input: { outcome_id: string; expected_etag: string }, archived: boolean) {
  const row = await load(ctx, input.outcome_id, true);
  checkEtag(input.expected_etag, row.etag, "outcome");
  if (Boolean(row.archived_at) === archived) return row;
  await ctx.db
    .updateTable("outcomes")
    .set({ archived_at: archived ? ctx.now : null, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
    .where("outcome_id", "=", row.outcome_id)
    .execute();
  await recordActivity(ctx, {
    action: archived ? "archived" : "restored",
    entity_type: "outcome",
    entity_id: row.outcome_id,
    entity_title: row.title,
    summary: archived ? "Archived the outcome" : "Restored the outcome",
  });
  return load(ctx, row.outcome_id);
}

export const archiveOutcome = defineOperation({
  name: "outcomes.archive",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Archive an outcome the product no longer aims at: out of the list, still linkable, its text kept.",
  description: "Pass the outcome's etag. Assumptions that point at it flag it in archived_outcome_ids. Restore brings it back.",
  input: z.strictObject({ outcome_id: outcomeId, expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/outcomes/:outcome_id/archive" },
  mcp: { tool: "outcomes", action: "archive" },
  async handler(ctx, input) {
    return setArchived(ctx, input, true);
  },
});

export const restoreOutcome = defineOperation({
  name: "outcomes.restore",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Restore an archived outcome.",
  description: "Pass the outcome's etag. It returns to its place in the order.",
  input: z.strictObject({ outcome_id: outcomeId, expected_etag: expectedEtag }),
  rest: { method: "POST", path: "/outcomes/:outcome_id/restore" },
  mcp: { tool: "outcomes", action: "restore" },
  async handler(ctx, input) {
    return setArchived(ctx, input, false);
  },
});

/** What deleting an outcome destroys, and what points at it. */
async function deletion(ctx: OpContext, row: Row) {
  const assumptions = await ctx.db
    .selectFrom("register_entries")
    .select(["entry_id", "statement"])
    .where("product_id", "=", productId(ctx))
    .where(sql<boolean>`${row.outcome_id} = any(outcome_ids)`)
    .orderBy("entry_id", "desc")
    .execute();
  return {
    outcome_id: row.outcome_id,
    title: row.title,
    etag: row.etag,
    archived: Boolean(row.archived_at),
    assumptions: assumptions.map((a) => ({ id: a.entry_id, statement: a.statement })),
    after_delete: "Its title, both sides of its card and its earlier versions go. It is removed from the outcome_ids of the assumptions that serve it.",
    reversible_alternative: 'outcomes(action="archive") takes it out of the list and keeps it linkable.',
  };
}

export const outcomeDeleteImpact = defineOperation({
  name: "outcomes.delete_impact",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Preview exactly what deleting an outcome would destroy, and what points at it.",
  description:
    "Read-only. Show the person this result before proposing a delete. assumptions lists the assumptions it would be removed from. Pass this result's etag as the delete's expected_etag.",
  input: z.strictObject({ outcome_id: outcomeId }),
  rest: { method: "GET", path: "/outcomes/:outcome_id/delete-impact" },
  mcp: { tool: "outcomes", action: "delete_impact" },
  async handler(ctx, input) {
    return deletion(ctx, await load(ctx, input.outcome_id));
  },
});

export const deleteOutcome = defineOperation({
  name: "outcomes.delete",
  scope: "product",
  access: "admin",
  mutates: true,
  summary: "DELETE PERMANENTLY — cannot be undone. Destroys an outcome and its history; archiving it is the reversible alternative.",
  description:
    'Archiving it (outcomes(action="archive")) is the reversible alternative and almost always what is wanted. ' +
    DELETE_GUIDANCE +
    " Leaves a tombstone: reads return 410 with who, when and why.",
  input: z.strictObject({ outcome_id: outcomeId, ...deleteGuards }),
  rest: { method: "DELETE", path: "/outcomes/:outcome_id" },
  mcp: { tool: "outcomes", action: "delete" },
  async handler(ctx, input) {
    checkConfirmation(input.confirm, 'archive it with outcomes(action="archive")');
    const row = await load(ctx, input.outcome_id, true);
    checkEtag(input.expected_etag, row.etag, "outcome");
    const impact = await deletion(ctx, row);
    // The assumptions that served it stop naming it; their etags change, so no stale write names it again.
    for (const a of impact.assumptions)
      await ctx.db
        .updateTable("register_entries")
        .set({ outcome_ids: sql`array_remove(outcome_ids, ${row.outcome_id})`, etag: newEtag(), updated_at: ctx.now, updated_by: json(ctx.actor) })
        .where("entry_id", "=", a.id)
        .execute();
    await leaveTombstone(ctx, { object_type: "outcome", object_id: row.outcome_id, title: row.title, reason: input.reason });
    await dropRevisions(ctx, "outcome", [row.outcome_id]);
    await ctx.db.deleteFrom("outcomes").where("outcome_id", "=", row.outcome_id).execute();
    await recordActivity(ctx, { action: "deleted", entity_type: "outcome", entity_id: row.outcome_id, entity_title: row.title, summary: "Deleted the outcome permanently" });
    const { etag, reversible_alternative, ...rest } = impact;
    void etag;
    void reversible_alternative;
    return { deleted: true, ...rest, reason: input.reason };
  },
});

/** The grant purpose that GETs a card preview's document. */
export const CARD_PREVIEW_PURPOSE = "card_preview";
/** The card previews a product keeps at once; a new one beyond them drops the oldest. */
const CARD_PREVIEWS_KEPT = 20;

export const outcomeCardPreview = defineOperation({
  name: "outcomes.card_preview",
  scope: "product",
  access: "write",
  mutates: false,
  summary: "Look at a card's front before writing it: every check a write makes, its advice, and a short-lived grant to GET the front as the Idea screen shows it, with the height it may take marked.",
  description:
    "Send the front you mean to write (card_html), for an outcome or the product concept (kind), with the title and the back it goes with when you have them, for their advice. " +
    "preview refuses what a write would refuse (422 invalid_card, listing every problem; outcome_cites_a_record) and writes nothing anyone sees. Otherwise it returns card_advice, frame (the widths the front is shown at and the most height a desktop shows) and a grant: " +
    "GET url with exactly the headers given to receive the front in the document the Idea screen shows it in, with a dashed line where a desktop stops showing it and a note on it saying how tall the front is and whether it fits. " +
    "Open it in a browser or a headless one (Playwright: new_context(extra_http_headers=headers, viewport=…)) at the frame's width and at 390 wide, adding ?theme=light and ?theme=dark, and look at each: nothing below the line, nothing running into anything else. A phone shows the whole front, so the line applies to the desktop width only. " +
    `The grant expires (expires_at) and a product keeps its ${CARD_PREVIEWS_KEPT} newest card previews; preview again for a new one. Keep the grant header out of reports and logs.`,
  input: z.strictObject({
    kind: z.enum(["outcome", "concept"]).default("outcome").describe("Whose front: an outcome's, or the product concept's."),
    card_html: z.string().trim().min(1).max(CARD_HTML_MAX).describe("The front, as you would write it."),
    title: z.string().trim().max(200).optional().describe("An outcome's title, for advice on a front that repeats it."),
    back: z.string().max(8000).optional().describe("The back the front goes with (description or concept), for advice on it."),
  }),
  rest: { method: "POST", path: "/idea/card-preview" },
  mcp: { tool: "outcomes", action: "card_preview" },
  async handler(ctx, input) {
    // A preview answers whether the write would land, so it is refused wherever the write would be.
    if (ctx.scope.product!.archived_at) throw conflict("product_archived", `Product ${ctx.scope.product!.name} is archived and read-only. Restore it first.`);
    if (ctx.sandbox?.visitor) refuseVisitorWrite(ctx.sandbox, { name: "outcomes.card_preview", mutates: true });
    const what = input.kind === "concept" ? "The product concept" : "The outcome";
    if (input.kind === "outcome") refuseReferences({ card_html: input.card_html });
    checkIdeaCard(input.card_html, what);
    const pid = productId(ctx);
    // A preview lives as long as its grant, and a product keeps only its newest ones.
    const kept = await ctx.db.selectFrom("card_previews").select("preview_id").where("product_id", "=", pid).where("expires_at", ">", ctx.now).orderBy("created_at", "desc").orderBy("preview_id", "desc").limit(CARD_PREVIEWS_KEPT - 1).execute();
    let drop = ctx.db.deleteFrom("card_previews").where("product_id", "=", pid);
    if (kept.length) drop = drop.where("preview_id", "not in", kept.map((k) => k.preview_id));
    await drop.execute();
    const preview_id = newId();
    const expiresAt = new Date(Date.parse(ctx.now) + ctx.ports.config.grantTtlSeconds * 1000);
    const title = input.kind === "concept" ? `${ctx.scope.product!.name}: product concept` : input.title || "Outcome";
    await ctx.db
      .insertInto("card_previews")
      .values({ preview_id, tenant_id: tenantId(ctx), product_id: pid, kind: input.kind, title, card_html: input.card_html, created_by: json(ctx.actor), expires_at: expiresAt.toISOString(), created_at: ctx.now })
      .execute();
    const token = ctx.ports.grants.sign({ v: 1, purpose: CARD_PREVIEW_PURPOSE, t: tenantId(ctx), cp: preview_id, ...requesterClaims(ctx.principal), exp: Math.floor(expiresAt.getTime() / 1000) });
    const frame = CARD_FRAMES[input.kind];
    return {
      kind: input.kind,
      card_chars: input.card_html.length,
      card_advice: adviseIdeaCard({ kind: input.kind, front: input.card_html, back: input.back, title: input.title }),
      frame,
      written: false,
      preview: {
        preview_id,
        method: "GET",
        url: `${ctx.ports.config.publicBaseUrl}/api/v1/downloads/card-preview/${preview_id}`,
        headers: { [DOWNLOAD_GRANT_HEADER]: token },
        expires_at: expiresAt.toISOString(),
      },
      next: `GET url with these headers in a browser ${frame.width} and 390 wide, adding ?theme=light and ?theme=dark: at ${frame.width} the front ends above the dashed line, and nothing runs into anything else at either width. Then write it, with its back. Keep the grant header out of reports and logs.`,
    };
  },
});

export const outcomeOps = [listOutcomes, getOutcome, createOutcome, updateOutcome, archiveOutcome, restoreOutcome, outcomeDeleteImpact, deleteOutcome, outcomeCardGuidance, outcomeCardPreview];
