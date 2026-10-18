import { sql } from "kysely";
import { json, type ActorSnapshot, type Db, type Tx } from "./db.ts";
import { blobKeyFor } from "./ops/attachments.ts";
import { indexSource } from "./text-index.ts";
import type { Ports } from "./ports.ts";
import { collapse, newEtag, newId, slugify, uniq } from "./util.ts";

/**
 * Insights and decisions are retired. Each one still held in a product becomes a Markdown source in
 * Evidence with the same id, so every link and reference to it keeps working, tagged with what it
 * was: an insight as an analysis and an insight, a decision as a decision. Its earlier
 * revisions become earlier versions of the file, and an assumption's link to a decision becomes a
 * line in the decision's document. Its history in the activity log becomes the source's history.
 * Then the original is deleted.
 *
 * The text goes to object storage, which only the worker reaches, so a migration or a sandbox reset
 * queues a move_to_evidence job per product and the worker runs this, one product per transaction.
 * Running it again finds nothing left to move.
 */

const MOVER: ActorSnapshot = { account_id: "system", display_name: "WhatBuild", surface: null, client: "move" };

const STATUS_WORD: Record<string, string> = { unconfirmed: "Unconfirmed", confirmed: "Confirmed", refuted: "Refuted", superseded: "Superseded" };

const day = (iso: string) => iso.slice(0, 10);
const who = (a: ActorSnapshot | null | undefined) => (a ? `${a.display_name}${a.surface === "mcp" ? " through an agent" : ""}` : "someone");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Queue a move for every product of a tenant that still holds an insight or a decision. Returns how many were queued. */
export async function queueEvidenceMoves(db: Db | Tx, enqueue: (kind: string, payload: Record<string, unknown>) => Promise<void>): Promise<number> {
  const r = await sql<{ product_id: string }>`
    select product_id from insights
    union select product_id from register_entries where kind = 'decision'
    order by product_id`.execute(db);
  for (const p of r.rows) await enqueue("move_to_evidence", { product_id: p.product_id });
  return r.rows.length;
}

interface Version {
  markdown: string;
  at: string;
  by: ActorSnapshot;
}

interface Lookup {
  title: (id: string) => string | null;
}

/** An insight as a document: its title, summary and body, as the product export always wrote it. */
function insightMarkdown(v: { title: string; summary: string; body: string }): string {
  return `# ${v.title}\n\n${v.summary ? `${v.summary}\n\n` : ""}${v.body.trim()}\n`;
}

/** A decision as a document: the choice and its reasoning, which holds the passages it cited. */
function decisionMarkdown(v: { statement: string; body: string }): string {
  const parts = [`# ${oneLine(v.statement)}`];
  if (v.body.trim()) parts.push(v.body.trim());
  return parts.join("\n\n") + "\n";
}

const section = (title: string, lines: string[]) => (lines.length ? [`## ${title}\n\n${lines.join("\n")}`] : []);

/** Write a document's versions, oldest first, as one Markdown attachment, and queue the newest to be read: its text becomes the source's. */
async function writeFile(db: Tx, ports: Ports, tenantId: string, recordId: string, path: string, versions: Version[]) {
  const file_id = newId();
  const ids = versions.map(() => newId());
  await db
    .insertInto("files")
    .values({ file_id, tenant_id: tenantId, record_id: recordId, path, current_version_id: ids[ids.length - 1]!, added_at: versions[0]!.at, added_by: json(versions[0]!.by) })
    .execute();
  for (const [i, v] of versions.entries()) {
    const blob_key = blobKeyFor(tenantId, recordId, ids[i]!);
    const stored = await ports.blobs.put(blob_key, new TextEncoder().encode(v.markdown), { contentType: "text/markdown" });
    await db
      .insertInto("file_versions")
      .values({ file_version_id: ids[i]!, tenant_id: tenantId, record_id: recordId, file_id, blob_key, size: stored.size, sha256: stored.sha256, media_type: "text/markdown", created_at: v.at, created_by: json(v.by) })
      .execute();
  }
  await db.insertInto("jobs").values({ tenant_id: tenantId, kind: "derive", payload: json({ record_id: recordId, file_version_id: ids[ids.length - 1]! }) }).execute();
}

/** Move every insight and decision a product holds into Evidence. Returns how many of each moved, or null when the product is gone. */
export async function runEvidenceMove(db: Tx, ports: Ports, job: { tenant_id: string; product_id: string }): Promise<{ insights: number; decisions: number } | null> {
  const pid = job.product_id;
  const product = await db.selectFrom("products").select(["team_id"]).where("product_id", "=", pid).executeTakeFirst();
  if (!product) return null;
  const insights = await db.selectFrom("insights").selectAll().where("product_id", "=", pid).orderBy("insight_id").forUpdate().execute();
  const decisions = await db.selectFrom("register_entries").selectAll().where("product_id", "=", pid).where("kind", "=", "decision").orderBy("entry_id").forUpdate().execute();
  const moving = new Set([...insights.map((i) => i.insight_id), ...decisions.map((d) => d.entry_id)]);
  const records = await db.selectFrom("records").select(["record_id", "title"]).where("product_id", "=", pid).execute();
  const outcomes = await db.selectFrom("outcomes").select(["outcome_id", "title"]).where("product_id", "=", pid).execute();
  const entries = await db.selectFrom("register_entries").select(["entry_id", "kind", "statement", "links"]).where("product_id", "=", pid).execute();
  const titles = new Map<string, string>([
    ...records.map((r) => [r.record_id, r.title] as const),
    ...outcomes.map((o) => [o.outcome_id, o.title] as const),
    ...insights.map((i) => [i.insight_id, i.title] as const),
    ...entries.map((e) => [e.entry_id, oneLine(e.statement)] as const),
  ]);
  const names: Lookup = { title: (id) => titles.get(id) ?? null };
  const revisions = moving.size
    ? await db.selectFrom("revisions").selectAll().where("object_type", "in", ["insight", "decision"]).where("object_id", "in", [...moving]).orderBy("n").execute()
    : [];
  const today = day(new Date().toISOString());

  const insertRecord = async (v: {
    record_id: string; title: string; tags: string[];
    archived: { at: string; by: ActorSnapshot } | null; uploaded: { at: string; by: ActorSnapshot }; updated: { at: string; by: ActorSnapshot };
  }) => {
    await db
      .insertInto("records")
      .values({
        record_id: v.record_id, tenant_id: job.tenant_id, team_id: product.team_id, product_id: pid, title: v.title, date: null,
        tags: v.tags, slug: slugify(v.title), copied_from: json(null),
        archived_at: v.archived?.at ?? null, archived_by: v.archived ? json(v.archived.by) : json(null), etag: newEtag(),
        uploaded_at: v.uploaded.at, uploaded_by: json(v.uploaded.by), updated_at: v.updated.at, updated_by: json(v.updated.by),
      })
      .execute();
    await db
      .insertInto("activity")
      .values({
        activity_id: newId(), tenant_id: job.tenant_id, team_id: product.team_id, product_id: pid, actor: json(MOVER), actor_account_id: MOVER.account_id, channel: null,
        action: "moved_to_evidence", entity_type: "source", entity_id: v.record_id, entity_title: collapse(v.title, 200),
        summary: `Moved this ${v.tags.includes("insight") ? "insight" : "decision"} into Evidence as a source`,
      })
      .execute();
  };

  for (const i of insights) {
    if (records.some((r) => r.record_id === i.insight_id)) continue;
    const refs = i.refs;
    const kept = revisions.filter((r) => r.object_id === i.insight_id);
    const reviewed = i.reviewed_revision === null ? "" : ` ${who(i.reviewed_by)} marked revision ${i.reviewed_revision} reviewed on ${day(i.reviewed_at!)}${i.reviewed_revision === i.revision ? "" : ", and it was changed after that"}.`;
    const footer = [
      `---\n\n*Moved into Evidence from Exploration on ${today}, where it was ${i.status === "draft" ? "a draft" : i.status === "archived" ? "an archived" : "a published"} insight.* It was at revision ${i.revision}.${reviewed} Written by ${who(i.created_by)} on ${day(i.created_at)}; last changed by ${who(i.updated_by)} on ${day(i.updated_at)}.`,
      ...section("It referred to", [
        ...(refs.outcomes ?? []).map((o) => `- Outcome: ${names.title(o) ?? "an outcome"} (\`${o}\`)`),
        ...(refs.sources ?? []).map((s) => `- Source: ${names.title(s) ?? "a source"} (\`${s}\`)`),
        ...(refs.insights ?? []).map((s) => `- Insight, now a source: ${names.title(s) ?? "an insight"} (\`${s}\`)`),
        ...(refs.assumptions ?? []).map((s) => `- Assumption: ${names.title(s) ?? "an assumption"} (\`${s}\`)`),
        ...(refs.decisions ?? []).map((s) => `- Decision, now a source: ${names.title(s) ?? "a decision"} (\`${s}\`)`),
      ]),
    ].join("\n\n");
    const versions: Version[] = [
      ...kept.map((r) => ({ markdown: insightMarkdown({ title: String(r.content["title"] ?? i.title), summary: String(r.content["summary"] ?? ""), body: String(r.content["body"] ?? "") }), at: r.written_at, by: r.written_by })),
      { markdown: `${insightMarkdown(i)}\n${footer}\n`, at: i.updated_at, by: i.updated_by },
    ];
    await insertRecord({
      record_id: i.insight_id, title: i.title, tags: i.status === "draft" ? ["analysis", "insight", "draft"] : ["analysis", "insight"],
      archived: i.status === "archived" ? { at: i.updated_at, by: i.updated_by } : null, uploaded: { at: i.created_at, by: i.created_by }, updated: { at: i.updated_at, by: i.updated_by },
    });
    await writeFile(db, ports, job.tenant_id, i.insight_id, `${slugify(i.title)}.md`, versions);
    if (i.summary.trim())
      await db.insertInto("agent_notes").values({ record_id: i.insight_id, kind: "summary", tenant_id: job.tenant_id, content: i.summary, updated_at: i.updated_at, updated_by: json(i.updated_by), etag: newEtag() }).execute();
  }

  for (const d of decisions) {
    if (records.some((r) => r.record_id === d.entry_id)) continue;
    const reviews = await db.selectFrom("reviews").selectAll().where("entry_id", "=", d.entry_id).orderBy("review_id").execute();
    const kept = revisions.filter((r) => r.object_id === d.entry_id);
    const label = (id: string) => {
      const e = entries.find((x) => x.entry_id === id);
      return `the ${e?.kind ?? "entry"} “${names.title(id) ?? id}” (\`${id}\`)`;
    };
    const out = d.links.map((l) => `- ${l.type === "supports" ? "Supports" : l.type === "contradicts" ? "Contradicts" : "Supersedes"} ${label(l.id)}`);
    const into = entries
      .filter((e) => e.entry_id !== d.entry_id)
      .flatMap((e) => e.links.filter((l) => l.id === d.entry_id).map((l) => `- ${l.type === "supports" ? "Supported by" : l.type === "contradicts" ? "Contradicted by" : "Superseded by"} ${label(e.entry_id)}`));
    const footer = [
      `## Status\n\n${STATUS_WORD[d.status] ?? d.status}${d.review_count ? `, after ${d.review_count} review${d.review_count === 1 ? "" : "s"}` : ", not reviewed"}.`,
      ...section("Outcomes", d.outcome_ids.map((o) => `- ${names.title(o) ?? "An outcome"} (\`${o}\`)`)),
      ...section("Links", [...out, ...into]),
      ...section(
        "Reviews",
        reviews.map((r) => `- ${day(r.created_at)}, ${who(r.reviewer)}, ${r.reviewer_type === "human" ? "a person" : "an agent"}: ${r.status}${r.confidence ? `, with ${r.confidence} confidence` : ""}. ${oneLine(r.note)}`),
      ),
      `---\n\n*Moved into Evidence from Exploration on ${today}, where it was a decision.* Recorded by ${who(d.author)} (${d.author_type === "human" ? "a person" : "an agent"}) on ${day(d.created_at)}.`,
    ].join("\n\n");
    const versions: Version[] = [
      ...kept.map((r) => ({ markdown: decisionMarkdown({ statement: String(r.content["statement"] ?? d.statement), body: String(r.content["body"] ?? "") }), at: r.written_at, by: r.written_by })),
      { markdown: `${decisionMarkdown(d)}\n${footer}\n`, at: d.updated_at, by: d.updated_by },
    ];
    await insertRecord({
      record_id: d.entry_id, title: collapse(d.statement, 300), tags: uniq(["decision", ...d.tags]),
      archived: d.archived_at ? { at: d.archived_at, by: d.updated_by } : null, uploaded: { at: d.created_at, by: d.author }, updated: { at: d.updated_at, by: d.updated_by },
    });
    await writeFile(db, ports, job.tenant_id, d.entry_id, `${slugify(d.statement)}.md`, versions);
  }

  if (decisions.length) {
    const gone = decisions.map((d) => d.entry_id);
    for (const e of entries.filter((x) => x.kind === "assumption" && x.links.some((l) => gone.includes(l.id))))
      await db.updateTable("register_entries").set({ links: json(e.links.filter((l) => !gone.includes(l.id))), etag: newEtag() }).where("entry_id", "=", e.entry_id).execute();
  }
  if (moving.size) {
    await db.updateTable("activity").set({ entity_type: "source" }).where("product_id", "=", pid).where("entity_type", "in", ["insight", "decision"]).where("entity_id", "in", [...moving]).execute();
    await db.deleteFrom("revisions").where("object_type", "in", ["insight", "decision"]).where("object_id", "in", [...moving]).execute();
    await db.deleteFrom("insights").where("product_id", "=", pid).where("insight_id", "in", [...moving]).execute();
    await db.deleteFrom("register_entries").where("product_id", "=", pid).where("kind", "=", "decision").where("entry_id", "in", [...moving]).execute();
  }
  // Search reads the new sources' titles, tags and summaries now; their text once it is read.
  for (const id of moving) await indexSource(db, id);
  return { insights: insights.length, decisions: decisions.length };
}
