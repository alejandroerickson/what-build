import { createTenantWithTeam, execute, OPERATIONS_BY_NAME, STORY_STYLESHEET, type Env, type Principal, type ScopeRef } from "@whatbuild/core";
import { sql } from "kysely";
import { findOrCreateAccount } from "./auth/identity.ts";
import { INSIGHT, INTERVIEW_TXT, INTERVIEW_VTT, OWNER_NOTES_MD, RESEARCH_EXPORT_MD, SAMPLE, STORY_HTML } from "./seed-content.ts";
import type { Worker } from "./worker.ts";

export const SEED_ACCOUNTS = [
  { email: "riley@example.com", display_name: "Riley Chen" },
  { email: "sam@example.com", display_name: "Sam Okafor" },
];

async function call(env: Env, who: Principal, name: string, input: Record<string, unknown>, ref: ScopeRef = {}) {
  const op = OPERATIONS_BY_NAME.get(name);
  if (!op) throw new Error(`no operation ${name}`);
  return (await execute(env, who, op, input, ref)).result as Record<string, unknown>;
}

async function upload(env: Env, who: Principal, ref: ScopeRef, tenantId: string, recordId: string, path: string, text: string) {
  const grant = (await call(env, who, "files.request_upload", { record_id: recordId, path, role: "primary" }, ref)) as { grant_id: string };
  const g = await env.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return trx.selectFrom("upload_grants").select(["blob_key", "media_type"]).where("grant_id", "=", grant.grant_id).executeTakeFirstOrThrow();
  });
  await env.ports.blobs.put(g.blob_key!, new TextEncoder().encode(text), { contentType: g.media_type ?? "text/plain" });
  await call(env, who, "files.complete_upload", { record_id: recordId, path }, ref);
}

/**
 * Seed two accounts and a fully derived sample product, through the same operations the adapters
 * use, so paths, attribution and activity match production. Idempotent: it does nothing if the
 * sample tenant already exists.
 */
export async function seed(env: Env, worker: Worker, log: (m: string) => void = console.log) {
  const existing = await env.db.selectFrom("tenants").select("tenant_id").where("slug", "=", "harbor-labs").executeTakeFirst();
  if (existing) {
    log("seed: the sample tenant already exists; nothing to do.");
    return;
  }
  const accounts = [];
  for (const a of SEED_ACCOUNTS) accounts.push((await findOrCreateAccount(env.db, a.email, a.display_name)).account);
  const riley: Principal = { ...accounts[0]!, auth_kind: "dev", surface: "web", client: null };
  const samAgent: Principal = { ...accounts[1]!, auth_kind: "dev", surface: "mcp", client: "claude-code" };

  const created = await env.db.transaction().execute((trx) =>
    createTenantWithTeam(trx, { account_id: riley.account_id, display_name: riley.display_name, surface: "web", client: null }, { name: SAMPLE.tenant, slug: "harbor-labs", team_name: SAMPLE.team }),
  );
  const tenant = created.tenant.slug;
  const team = created.team.slug;
  await call(env, riley, "members.grant", { tenant, team, email: accounts[1]!.email, role: "editor" });
  const product = (await call(env, riley, "products.create", { tenant, team, name: SAMPLE.product, slug: "crewboard", idea: SAMPLE.idea })) as { product_id: string };
  const ref: ScopeRef = { product: product.product_id };

  const objectiveIds: string[] = [];
  for (const o of SAMPLE.objectives) objectiveIds.push(String((await call(env, riley, "objectives.create", o, ref))["objective_id"]));

  const mk = async (who: Principal, meta: Record<string, unknown>, path: string, text: string) => {
    const r = await call(env, who, "sources.create", meta, ref);
    await upload(env, who, ref, created.tenant.tenant_id, String(r["record_id"]), path, text);
    return String(r["record_id"]);
  };
  const vtt = await mk(samAgent, { kind: "interview_transcript", title: "Crew lead interview — Greenline Landscaping, Aug 2026", date: "2026-08-14", organization: "Greenline Landscaping", participants: ["Marisol (crew lead)", "Interviewer"], source_system: "meeting recorder", tags: ["planning", "hand-off"], dimensions: { customer: "Greenline Landscaping", lifecycle_stage: "discovery" }, provenance_depth: "primary" }, "interview.vtt", INTERVIEW_VTT);
  const txt = await mk(samAgent, { kind: "interview_transcript", title: "Owner interview — Oak & Ash Grounds, Aug 2026", date: "2026-08-19", organization: "Oak & Ash Grounds", participants: ["Dev (owner)", "Interviewer"], source_system: "manual", tags: ["planning", "scheduling-errors"], dimensions: { customer: "Oak & Ash Grounds", lifecycle_stage: "discovery" }, provenance_depth: "primary" }, "transcript.txt", INTERVIEW_TXT);
  const notes = await mk(riley, { kind: "interviewer_notes", title: "Owner call notes — Fernside Cleaning, Aug 2026", date: "2026-08-21", organization: "Fernside Cleaning", participants: ["Priya (owner)"], tags: ["planning", "cleaning"], provenance_depth: "primary" }, "notes.md", OWNER_NOTES_MD);
  const survey = await mk(samAgent, { kind: "user_research_export", title: "Crew lead planning survey — spring round, 23 responses", date: "2026-05-30", source_system: "survey tool", tags: ["planning", "survey"], dimensions: { lifecycle_stage: "research" }, provenance_depth: "derived" }, "survey-summary.md", RESEARCH_EXPORT_MD);

  // The worker derives passages exactly as it would in production.
  await worker.drain();

  const insight = await call(
    env,
    samAgent,
    "insights.create",
    { title: INSIGHT.title, summary: INSIGHT.summary, body: INSIGHT.body({ vtt, txt, survey, notes }), status: "published", refs: { objectives: [objectiveIds[0]!, objectiveIds[1]!], sources: [vtt, txt, notes, survey] } },
    ref,
  );
  const assumption = await call(
    env,
    samAgent,
    "assumptions.create",
    {
      statement: "Crew leads think about the week in jobs, not in time slots.",
      body: "Marisol and the survey comments say jobs first; Dev and Priya plan day by day. If the split follows the trade, the first version may need both views.",
      citations: [
        { record_id: vtt, seq_start: 7, seq_end: 7 },
        { record_id: txt, seq_start: 8, seq_end: 9, quote: "By the day, if I'm honest." },
      ],
      objective_ids: [objectiveIds[2]!],
      tags: ["planning-model"],
      author_type: "agent",
      provenance_depth: "primary",
    },
    ref,
  );
  const decision = await call(
    env,
    riley,
    "decisions.create",
    {
      statement: "Test generating each crew's message from the plan before building the planning grid.",
      body: "The hand-off is where mistakes reach customers. A message generator is small, testable with two crews in a week, and useful whichever planning model wins.",
      citations: [{ record_id: vtt, seq_start: 8, seq_end: 10 }],
      objective_ids: [objectiveIds[1]!],
      author_type: "human",
      provenance_depth: "primary",
    },
    ref,
  );
  const decisionEtag = String(decision["etag"]);
  await call(env, riley, "decisions.review", { id: decision["id"], expected_etag: decisionEtag, status: "confirmed", note: "Agreed in the Thursday review. Sam to set up the two-crew test.", reviewer_type: "human", confidence: "medium" }, ref);

  const base = env.ports.config.publicBaseUrl;
  const path = `${tenant}/${team}/crewboard`;
  await call(
    env,
    samAgent,
    "story.publish",
    {
      page_id: "overview",
      title: "Where Crewboard's discovery stands",
      summary: "Planning costs an afternoon a week; the hand-off is where mistakes happen.",
      html: STORY_HTML(
        {
          insight: `${base}/t/${path}/insights/${insight["insight_id"]}`,
          assumption: `${base}/t/${path}/insights/assumptions/${assumption["id"]}`,
          decision: `${base}/t/${path}/insights/decisions/${decision["id"]}`,
        },
        STORY_STYLESHEET,
      ),
      note: "First version.",
      refs: { insights: [String(insight["insight_id"])], assumptions: [String(assumption["id"])], decisions: [String(decision["id"])] },
    },
    ref,
  );
  await call(env, samAgent, "story.set_hierarchy", { items: [{ page_id: "overview", children: [] }], expected_etag: null }, ref);
  await call(env, riley, "sources.annotate", { record_id: vtt, note: "This is the moment to design for: the typed message, not the spreadsheet.", seq_start: 8, seq_end: 8, tags: ["hand-off"] }, ref);
  log(`seed: created ${SAMPLE.tenant} / ${SAMPLE.team} / ${SAMPLE.product} with ${SEED_ACCOUNTS.map((a) => a.email).join(" and ")}.`);
}
