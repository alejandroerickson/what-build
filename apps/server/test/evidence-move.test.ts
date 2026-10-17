import { readFileSync } from "node:fs";
import { newId } from "@whatbuild/core";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncSandboxTenant } from "../src/public-sandbox.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

/**
 * Insights and decisions were retired: migration 0015 queues a job per product that holds any, and
 * the worker stores each as a source in Evidence with the same id. These rows are written the way
 * WhatBuild stored them before, straight into the tables, because nothing can create them now.
 */
const MIGRATION = readFileSync(new URL("../src/migrations/0015_insights_and_decisions_to_evidence.sql", import.meta.url), "utf8");

let h: Harness;
let olive: Browser;
let org: string;
let tenantId: string;
let productId: string;
let P: string;
let source: string;
let outcome: string;
let assumption: string;
const insight = newId();
const draft = newId();
const decision = newId();

const actor = (name: string, surface: string | null = "web") => JSON.stringify({ account_id: `acct-${name.toLowerCase()}`, display_name: name, surface, client: null });

async function inTenant<T>(fn: (trx: Transaction<any>) => Promise<T>): Promise<T> {
  return h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx as Transaction<any>);
  });
}

async function primaryText(recordId: string) {
  return (await olive.api("GET", `${P}/sources/${recordId}/derived/text`)).body.text as string;
}

/** An insight with an earlier revision, the way insights.create and insights.update stored them. */
async function storeInsight(trx: Transaction<any>, id: string, o: { title: string; status: string; refs: Record<string, string[]>; reviewed?: boolean }) {
  await sql`insert into insights (insight_id, tenant_id, product_id, title, summary, body, status, refs, revision, reviewed_revision, reviewed_at, reviewed_by, etag, created_at, created_by, updated_at, updated_by)
    values (${id}, ${tenantId}, ${productId}, ${o.title}, 'Crews learn the plan from a text.', ${"## Observed\n\nCrews read the plan in a text, then call the office."}, ${o.status}, ${JSON.stringify(o.refs)}::jsonb, 2,
      ${o.reviewed ? 1 : null}, ${o.reviewed ? "2026-09-02T10:00:00Z" : null}, ${o.reviewed ? actor("Riley") : null}::jsonb, 'e1', '2026-09-01T09:00:00Z', ${actor("Sam", "mcp")}::jsonb, '2026-09-03T09:00:00Z', ${actor("Sam", "mcp")}::jsonb)`.execute(trx);
  await sql`insert into revisions (revision_id, tenant_id, object_type, object_id, n, content, replaced_by, written_at, written_by)
    values (${newId()}, ${tenantId}, 'insight', ${id}, 1, ${JSON.stringify({ title: o.title, summary: "", body: "Crews read the plan in a text.", revision: 1 })}::jsonb, ${actor("Sam", "mcp")}::jsonb, '2026-09-01T09:00:00Z', ${actor("Sam", "mcp")}::jsonb)`.execute(trx);
}

beforeAll(async () => {
  h = await startHarness();
  olive = await h.signIn("olive@example.com", "Olive Owner");
  const t = await olive.api("POST", "/api/v1/tenants", { name: "Moving Co" });
  org = t.body.tenant.slug;
  tenantId = t.body.tenant.tenant_id;
  const p = await olive.api("POST", `/api/v1/teams/${org}/${t.body.team.slug}/products`, { name: "Planner" });
  P = `/api/v1/p/${p.body.path}`;
  productId = p.body.product_id;
  const created = await olive.api("POST", `${P}/sources/with-upload`, { tags: ["notes"], title: "Visit notes — Example Co, Sep 2026", path: "visit.md", role: "primary" });
  source = created.body.record.record_id;
  await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body: "# Visit\n\n- Crews text the office.\n- Nobody called it a crisis.\n" });
  await h.worker.drain();
  outcome = (await olive.api("POST", `${P}/outcomes`, { title: "Send the week in minutes" })).body.outcome_id;
  assumption = (await olive.api("POST", `${P}/assumptions`, { statement: "Crews read texts before calls." })).body.id;

  await inTenant(async (trx) => {
    await storeInsight(trx, insight, { title: "Texts carry the plan", status: "published", reviewed: true, refs: { outcomes: [outcome], sources: [source], insights: [draft], assumptions: [assumption], decisions: [decision] } });
    await storeInsight(trx, draft, { title: "Calls follow the text", status: "draft", refs: { outcomes: [], sources: [], insights: [], assumptions: [], decisions: [] } });
    // A decision's cited passages are in its body, where the migration that retired citations put them.
    await sql`insert into register_entries (entry_id, tenant_id, product_id, kind, statement, body, links, outcome_ids, tags, author, author_type, status, review_count, etag, updated_by)
      values (${decision}, ${tenantId}, ${productId}, 'decision', 'Send each crew a generated message.', ${"Typed messages are where mistakes enter.\n\n**Passages cited**\n\n- “Crews text the office.” (Visit notes — Example Co, Sep 2026)"},
        ${JSON.stringify([{ id: assumption, type: "supports" }])}::jsonb, ${[outcome]}, ${["hand-off"]}, ${actor("Riley")}::jsonb, 'human', 'confirmed', 1, 'e2', ${actor("Riley")}::jsonb)`.execute(trx);
    await sql`insert into reviews (review_id, tenant_id, entry_id, status, note, reviewer, reviewer_type, confidence)
      values (${newId()}, ${tenantId}, ${decision}, 'confirmed', 'Agreed on Thursday.', ${actor("Riley")}::jsonb, 'human', 'medium')`.execute(trx);
    await sql`update register_entries set links = ${JSON.stringify([{ id: decision, type: "contradicts" }])}::jsonb where entry_id = ${assumption}`.execute(trx);
  });
});
afterAll(async () => h?.close());

describe("moving insights and decisions into Evidence", () => {
  it("queues one job for each product that holds any", async () => {
    await sql.raw(MIGRATION).execute(h.db);
    const jobs = await sql<{ payload: { product_id: string } }>`select payload from jobs where kind = 'move_to_evidence' and done_at is null`.execute(h.db);
    expect(jobs.rows.map((j) => j.payload.product_id)).toEqual([productId]);
    await h.worker.drain();
  });

  it("stores an insight as an analysis with the same id, its revisions as earlier versions, and what it was", async () => {
    const r = (await olive.api("GET", `${P}/sources/${insight}?detail=full`)).body;
    expect(r).toMatchObject({ title: "Texts carry the plan", tags: ["analysis", "insight"], derived_status: "ready", archived_at: null });
    expect(r.uploaded_by.display_name).toBe("Sam");
    expect(r.agent_notes.map((n: { kind: string }) => n.kind)).toEqual(["summary"]);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatchObject({ path: "texts-carry-the-plan.md", role: "primary" });
    const versions = await inTenant((trx) => trx.selectFrom("file_versions").select(["created_at"]).where("record_id", "=", insight).orderBy("created_at").execute());
    expect(versions).toHaveLength(2);
    const text = await primaryText(insight);
    expect(text).toContain("Crews read the plan in a text, then call the office.");
    expect(text).toContain("where it was a published insight");
    expect(text).toContain("Riley marked revision 1 reviewed on 2026-09-02, and it was changed after that");
    expect(text).toContain(`Outcome: Send the week in minutes`);
    expect(text).toContain(`Decision, now a source: Send each crew a generated message. (${decision})`);
    const draftSource = (await olive.api("GET", `${P}/sources/${draft}`)).body;
    expect(draftSource.tags).toEqual(["analysis", "insight", "draft"]);
    const found = await olive.api("GET", `${P}/search?query=${encodeURIComponent("then call the office")}`);
    expect(found.body.hits.map((x: { record_id: string }) => x.record_id)).toContain(insight);
  });

  it("stores a decision as a source with its evidence, links and reviews in the text", async () => {
    const r = (await olive.api("GET", `${P}/sources/${decision}?detail=full`)).body;
    expect(r).toMatchObject({ title: "Send each crew a generated message.", tags: ["decision", "hand-off"], derived_status: "ready" });
    const text = await primaryText(decision);
    expect(text).toContain("Typed messages are where mistakes enter.");
    expect(text).toContain("“Crews text the office.” (Visit notes — Example Co, Sep 2026)");
    expect(text).toContain(`Supports the assumption “Crews read texts before calls.” (${assumption})`);
    expect(text).toContain(`Contradicted by the assumption “Crews read texts before calls.” (${assumption})`);
    expect(text).toContain("Riley, a person: confirmed, with medium confidence. Agreed on Thursday.");
    expect(text).toContain("Confirmed, after 1 review.");
  });

  it("drops an assumption's link to a decision, and leaves nothing of them behind", async () => {
    const a = (await olive.api("GET", `${P}/assumptions/${assumption}`)).body;
    expect(a.links).toEqual([]);
    const left = await inTenant(async (trx) => ({
      insights: (await sql<{ n: number }>`select count(*)::int as n from insights`.execute(trx)).rows[0]!.n,
      decisions: (await sql<{ n: number }>`select count(*)::int as n from register_entries where kind = 'decision'`.execute(trx)).rows[0]!.n,
      revisions: (await sql<{ n: number }>`select count(*)::int as n from revisions where object_type in ('insight', 'decision')`.execute(trx)).rows[0]!.n,
    }));
    expect(left).toEqual({ insights: 0, decisions: 0, revisions: 0 });
    const moved = (await olive.api("GET", `${P}/activity?entity_id=${insight}`)).body.items;
    expect(moved.some((e: { action: string; actor: { display_name: string } }) => e.action === "moved_to_evidence" && e.actor.display_name === "WhatBuild")).toBe(true);
  });

  it("has nothing left to queue once they have moved", async () => {
    await sql.raw(MIGRATION).execute(h.db);
    expect((await sql<{ n: number }>`select count(*)::int as n from jobs where kind = 'move_to_evidence' and done_at is null`.execute(h.db)).rows[0]!.n).toBe(0);
  });

  it("moves them again after a sandbox reset puts back a baseline that still holds them", async () => {
    await syncSandboxTenant(h.db, org, () => {});
    const again = newId();
    await inTenant((trx) => storeInsight(trx, again, { title: "Saved before the move", status: "published", refs: { outcomes: [], sources: [source], insights: [], assumptions: [], decisions: [] } }));
    const T = `/api/v1/tenants/${org}`;
    expect((await olive.api("POST", `${T}/sandbox/baselines`, { note: "Holds an insight" })).status).toBe(200);
    const reset = await olive.api("POST", `${T}/sandbox/reset`, { confirm: "reset the sandbox" });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect((await olive.api("GET", `${P}/sources/${again}`)).status).toBe(404);
    await h.worker.drain();
    expect((await olive.api("GET", `${P}/sources/${again}`)).body).toMatchObject({ title: "Saved before the move", tags: ["analysis", "insight"], derived_status: "ready" });
  });
});
