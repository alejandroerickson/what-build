import { actorOf, createTenantWithTeam, execute, houseStyle, json, loadSandbox, newEtag, OPERATIONS_BY_NAME, type Env, type Principal, type ScopeRef } from "@whatbuild/core";
import { sql } from "kysely";
import { findOrCreateAccount } from "./auth/identity.ts";
import {
  MOCKUP, HANDOFF_HTML, HANDOFF_NOTES, INTERVIEW_AGENT_NOTES, INTERVIEW_RECORDER_EXPORT, INTERVIEW_TXT, INTERVIEW_VTT, OVERVIEW_NOTES, OWNER_NOTES_MD, RESEARCH_EXPORT_MD, SAMPLE, STORY_HTML,
} from "./seed-content.ts";
import { syncSandboxTenant } from "./public-sandbox.ts";
import type { Worker } from "./worker.ts";

export const SEED_ACCOUNTS = [
  { email: "riley@example.com", display_name: "Riley Chen" },
  { email: "sam@example.com", display_name: "Sam Okafor" },
  { email: "jordan@example.com", display_name: "Jordan Ellis" },
] as const;

async function call(env: Env, who: Principal, name: string, input: Record<string, unknown>, ref: ScopeRef = {}) {
  const op = OPERATIONS_BY_NAME.get(name);
  if (!op) throw new Error(`no operation ${name}`);
  return (await execute(env, who, op, input, ref)).result as Record<string, unknown>;
}

async function upload(env: Env, who: Principal, ref: ScopeRef, tenantId: string, recordId: string, path: string, text: string, role: "primary" | "origin" = "primary") {
  const grant = (await call(env, who, "files.request_upload", { record_id: recordId, path, role }, ref)) as { grant_id: string };
  const g = await env.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return trx.selectFrom("upload_grants").select(["blob_key", "media_type"]).where("grant_id", "=", grant.grant_id).executeTakeFirstOrThrow();
  });
  await env.ports.blobs.put(g.blob_key!, new TextEncoder().encode(text), { contentType: g.media_type ?? "text/plain" });
  await call(env, who, "files.complete_upload", { record_id: recordId, path }, ref);
}

/**
 * Seed three accounts (an owner, an editor and a Story reader) and a fully derived sample product, through the same operations the adapters
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
  const product = (await call(env, riley, "products.create", { tenant, team, name: SAMPLE.product, slug: "crewboard", concept: SAMPLE.concept })) as { product_id: string };
  const ref: ScopeRef = { product: product.product_id };
  await call(env, riley, "members.grant", { tenant, team, product: "crewboard", email: accounts[2]!.email, role: "reader" });

  const outcomeIds: string[] = [];
  for (const o of SAMPLE.outcomes) outcomeIds.push(String((await call(env, riley, "outcomes.create", o, ref))["outcome_id"]));

  const mk = async (who: Principal, meta: Record<string, unknown>, path: string, text: string) => {
    const r = await call(env, who, "sources.create", meta, ref);
    await upload(env, who, ref, created.tenant.tenant_id, String(r["record_id"]), path, text);
    return String(r["record_id"]);
  };
  const vtt = await mk(samAgent, { title: "Crew lead interview — Greenline Landscaping, Aug 2026", date: "2026-08-14", participants: ["Marisol (crew lead)", "Interviewer"], source_system: "meeting recorder", tags: ["interview", "greenline landscaping", "planning", "hand-off"], provenance_depth: "primary" }, "interview.vtt", INTERVIEW_VTT);
  const txt = await mk(samAgent, { title: "Owner interview — Oak & Ash Grounds, Aug 2026", date: "2026-08-19", participants: ["Dev (owner)", "Interviewer"], source_system: "manual", tags: ["interview", "oak & ash grounds", "planning", "scheduling-errors"], provenance_depth: "primary" }, "transcript.txt", INTERVIEW_TXT);
  const notes = await mk(riley, { title: "Owner call notes — Fernside Cleaning, Aug 2026", date: "2026-08-21", participants: ["Priya (owner)"], tags: ["interview", "fernside cleaning", "planning", "cleaning"], provenance_depth: "primary" }, "notes.md", OWNER_NOTES_MD);
  const survey = await mk(samAgent, { title: "Crew lead planning survey — spring round, 23 responses", date: "2026-05-30", source_system: "survey tool", tags: ["research", "survey", "planning"], provenance_depth: "derived" }, "survey-summary.md", RESEARCH_EXPORT_MD);

  // The Greenline call keeps the recorder's export as its origin file (kept, not searched).
  await upload(env, samAgent, ref, created.tenant.tenant_id, vtt, "recorder-export.txt", INTERVIEW_RECORDER_EXPORT, "origin");

  // The worker derives passages exactly as it would in production.
  await worker.drain();

  // The agent's description, outline and working notes for the Greenline call.
  for (const note_kind of ["summary", "outline", "notes"] as const) {
    await call(env, samAgent, "derived.write_note", { record_id: vtt, note_kind, content: INTERVIEW_AGENT_NOTES[note_kind] }, ref);
  }

  const base = env.ports.config.publicBaseUrl;
  const path = `${tenant}/${team}/crewboard`;
  const assumption = await call(
    env,
    samAgent,
    "assumptions.create",
    {
      statement: "Crew leads think about the week in jobs, not in time slots.",
      body: "Marisol and the survey comments say jobs first; Dev and Priya plan day by day. If the split follows the trade, the first version may need both views.",
      outcome_ids: [outcomeIds[2]!],
      tags: ["planning-model"],
      author_type: "agent",
      provenance_depth: "primary",
    },
    ref,
  );

  await call(env, samAgent, "story.set_style", { house_style: "clear" }, ref);
  const sampleStylesheet = houseStyle("clear")!.stylesheet;
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
          assumption: `${base}/t/${path}/exploration/assumptions/${assumption["id"]}`,
          handOff: `${base}/t/${path}/story/hand-off-test`,
        },
        sampleStylesheet,
      ),
    },
    ref,
  );
  await call(
    env,
    samAgent,
    "story.publish",
    {
      page_id: "hand-off-test",
      title: "The hand-off test",
      summary: "Two crews get their week as a generated message instead of a typed one.",
      html: HANDOFF_HTML(sampleStylesheet),
    },
    ref,
  );
  await call(env, samAgent, "story.set_hierarchy", { items: [{ page_id: "overview", children: [{ page_id: "hand-off-test", children: [] }] }], expected_etag: null }, ref);
  for (const [page_id, notesText] of [["overview", OVERVIEW_NOTES], ["hand-off-test", HANDOFF_NOTES]] as const) {
    const page = (await call(env, samAgent, "story.get_page", { page_id, include_html: false }, ref)) as { agent_notes: { etag: string } };
    await call(env, samAgent, "story.write_notes", { page_id, notes: notesText, expected_etag: page.agent_notes.etag }, ref);
  }
  const mockup = await call(
    env,
    samAgent,
    "mockups.publish",
    {
      title: MOCKUP.title,
      summary: MOCKUP.summary,
      brief: MOCKUP.brief,
      pages: [
        { page_id: "jobs-board", title: "Jobs board", notes: MOCKUP.notes.jobs, html: MOCKUP.pages.jobs },
        { page_id: "day-planner", title: "Day planner", notes: MOCKUP.notes.days, html: MOCKUP.pages.days },
      ],
      files: [
        { path: "DESIGN.md", content: MOCKUP.files.design },
        { path: "components/job-card.html", content: MOCKUP.files.card },
      ],
    },
    ref,
  );
  await call(
    env,
    samAgent,
    "mockups.publish",
    {
      mockup_id: mockup["mockup_id"],
      expected_etag: mockup["etag"],
      pages: [
        { page_id: "jobs-board", notes: MOCKUP.notes.jobsRevised },
        { page_id: "day-planner" },
        { page_id: "crew-message", title: "Crew message", notes: MOCKUP.notes.message, width: 390, height: 760, html: MOCKUP.pages.message },
      ],
    },
    ref,
  );
  // Each page of the mockup on the Story, under Published mockups, for stakeholders to flip through.
  for (const page of ["jobs-board", "day-planner", "crew-message"]) await call(env, samAgent, "story.promote_mockup", { mockup_id: mockup["mockup_id"], mockup_page_id: page }, ref);
  await call(env, riley, "sources.annotate", { record_id: vtt, note: "This is the moment to design for: the typed message, not the spreadsheet.", seq_start: 8, seq_end: 8, tags: ["hand-off"] }, ref);
  // Sam may start one organization of their own; Riley, the instance's owner in development, gave it.
  const sam = SEED_ACCOUNTS[1].email;
  await env.db
    .insertInto("tenant_allowances")
    .values({ email: sam, allowed: 1, note: "Sample: may start one organization", etag: newEtag(), created_by: json(actorOf(riley)), updated_by: json(actorOf(riley)) })
    .onConflict((oc) => oc.column("email").doNothing())
    .execute();
  log(`seed: created ${SAMPLE.tenant} / ${SAMPLE.team} / ${SAMPLE.product} with ${SEED_ACCOUNTS.map((a) => a.email).join(" and ")}.`);
}

/**
 * For local development with WHATBUILD_SANDBOX_TENANT set: make the named organization the public
 * sandbox, save its content as the first baseline, and make one invitation to try it with. Each
 * step is skipped once it has been done.
 */
export async function seedSandbox(env: Env, slug: string, log: (m: string) => void = console.log) {
  const tenantId = await syncSandboxTenant(env.db, slug, log);
  if (!tenantId) return;
  const owner = await env.db
    .selectFrom("memberships as m")
    .innerJoin("accounts as a", "a.account_id", "m.account_id")
    .select(["a.account_id", "a.email", "a.display_name"])
    .where("m.tenant_id", "=", tenantId)
    .where("m.scope_type", "=", "tenant")
    .where("m.role", "=", "owner")
    .executeTakeFirst();
  if (!owner) return;
  const who: Principal = { ...owner, auth_kind: "dev", surface: "web", client: null };
  if (!(await loadSandbox(env.db, tenantId)).baseline_id) {
    await call(env, who, "sandbox.save_baseline", { tenant: slug, note: "The sample content, as seeded" });
    log(`seed: saved the sandbox's first baseline.`);
  }
  const invited = await env.db.selectFrom("sandbox_invites").select("invite_id").where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!invited) {
    const inv = await call(env, who, "sandbox.create_invite", { tenant: slug, label: "Local development", places: 25 });
    log(`seed: an invitation to the sandbox, shown this once: ${String(inv["invite_link"])}`);
  }
}
