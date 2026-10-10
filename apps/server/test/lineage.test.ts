import { canonicalJson, sha256Hex } from "@whatbuild/core";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let P: string;
let tenantSlug: string;
let notes: string;
let survey: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Research" });
  tenantSlug = t.body.tenant.slug;
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Scheduling" });
  P = `/api/v1/p/${p.body.path}`;
  notes = await upload("notes", "visit.md", "# Visit\n\nCrews text the office.\n\nThe numbers close on Fridays.\n");
  survey = await upload("notes", "survey.md", "# Survey\n\nMost crews plan by the week.\n");
  await h.worker.drain();
});
afterAll(async () => h?.close());

async function upload(tag: string, path: string, body: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path, role: "primary" });
  expect(created.status).toBe(201);
  const recordId: string = created.body.record.record_id;
  const put = await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body });
  expect(put.status).toBe(201);
  await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path });
  return recordId;
}

async function view(title: string) {
  const v = await alice.api("POST", `${P}/sources`, { tags: ["view"], title });
  expect(v.status).toBe(201);
  return v.body.record_id as string;
}

async function source(recordId: string) {
  return (await alice.api("GET", `${P}/sources/${recordId}?detail=full`)).body;
}

describe("lineage of a view", () => {
  let viewId: string;
  let assumptionId: string;

  it("stores captured_at, and shows the lineage on the view and from each input source", async () => {
    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Crews plan by the week.", citations: [{ record_id: survey, seq_start: 1, seq_end: 1 }] });
    expect(a.status).toBe(201);
    assumptionId = a.body.id;
    viewId = await view("Planning cadence across visits");
    const inputs = [
      { kind: "record", id: notes },
      { kind: "record", id: survey },
      { kind: "assumption", id: assumptionId },
    ];
    const cap = await alice.api("POST", `${P}/lineage/capture`, { inputs });
    expect(cap.status).toBe(200);
    const future = await alice.api("POST", `${P}/sources/${viewId}/lineage`, {
      record_id: viewId,
      inputs: cap.body.inputs,
      captured_at: new Date(Date.now() + 3_600_000).toISOString(),
      query_spec: { description: "Every source about planning." },
    });
    expect(future.status).toBe(422);
    const w = await alice.api("POST", `${P}/sources/${viewId}/lineage`, { record_id: viewId, inputs: cap.body.inputs, captured_at: cap.body.captured_at, query_spec: { description: "Every source about planning." } });
    expect(w.status).toBe(200);
    expect(w.body.captured_at).toBe(cap.body.captured_at);

    const c = await alice.api("GET", `${P}/sources/${viewId}/lineage`);
    expect(c.body).toMatchObject({ stale: false, scope: "direct_inputs" });
    expect(Date.parse(c.body.captured_at)).toBe(Date.parse(cap.body.captured_at));
    expect(c.body.input_checks.map((x: { status: string }) => x.status)).toEqual(["current", "current", "current"]);

    const full = await source(viewId);
    expect(full.has_lineage).toBe(true);
    expect(full.lineage).toMatchObject({ scope: "direct_inputs", inputs, query_spec: { description: "Every source about planning." } });
    expect(Date.parse(full.lineage.captured_at)).toBe(Date.parse(cap.body.captured_at));
    expect((await source(notes)).lineage).toBeNull();

    for (const input of [notes, survey]) {
      const using = await alice.api("GET", `${P}/sources/${input}/used-by`);
      expect(using.body.views).toEqual([expect.objectContaining({ record_id: viewId, tags: ["view"], title: "Planning cadence across visits" })]);
    }
  });

  it("says which parts of a changed input changed, and when", async () => {
    const before = await source(notes);
    const u = await alice.api("PATCH", `${P}/sources/${notes}`, { expected_etag: before.etag, title: "Ops lead visit — Example Co" });
    expect(u.status).toBe(200);
    const a = await alice.api("GET", `${P}/assumptions/${assumptionId}`);
    const e = await alice.api("PATCH", `${P}/assumptions/${assumptionId}`, { expected_etag: a.body.etag, statement: "Crews plan by the week, not the day." });
    expect(e.status).toBe(200);

    const c = await alice.api("GET", `${P}/sources/${viewId}/lineage`);
    expect(c.body.stale).toBe(true);
    const [n, s, as] = c.body.input_checks;
    expect(n).toMatchObject({ id: notes, status: "changed", changed_parts: ["title"] });
    expect(Date.parse(n.last_changed_at)).toBeGreaterThanOrEqual(Date.parse(c.body.registered_at));
    expect(s).toEqual({ kind: "record", id: survey, status: "current" });
    expect(as).toMatchObject({ id: assumptionId, status: "changed", changed_parts: ["statement"] });
    expect(as.last_changed_at).toBeTruthy();
  });

  it("says honestly that lineage written before parts were stored cannot name them", async () => {
    const older = await view("Survey summary");
    const cap = await alice.api("POST", `${P}/lineage/capture`, { inputs: [{ kind: "record", id: survey }] });
    const w = await alice.api("POST", `${P}/sources/${older}/lineage`, { record_id: older, inputs: cap.body.inputs, query_spec: { description: "The survey." } });
    expect(w.status).toBe(200);
    expect(w.body.captured_at).toBeNull();
    const tenant = await h.db.selectFrom("tenants").select("tenant_id").where("slug", "=", tenantSlug).executeTakeFirstOrThrow();
    await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenant.tenant_id}, true)`.execute(trx);
      await trx.updateTable("lineage").set({ inputs: JSON.stringify(cap.body.inputs) }).where("record_id", "=", older).execute();
    });
    const before = await source(survey);
    await alice.api("PATCH", `${P}/sources/${survey}`, { expected_etag: before.etag, date: "2026-09-01" });
    const c = await alice.api("GET", `${P}/sources/${older}/lineage`);
    expect(c.body.captured_at).toBeNull();
    expect(c.body.input_checks[0]).toMatchObject({ status: "changed", changed_parts: null, last_changed_at: null });
    expect(c.body.input_checks[0].detail).toMatch(/^Parts not recorded/);
  });

  it("keeps a view written before parts were stored current when its sources only lost their kind and organization", async () => {
    const older = await view("Visit summary");
    const cap = await alice.api("POST", `${P}/lineage/capture`, { inputs: [{ kind: "record", id: notes }] });
    expect((await alice.api("POST", `${P}/sources/${older}/lineage`, { record_id: older, inputs: cap.body.inputs, query_spec: { description: "The visit." } })).status).toBe(200);
    // As migration 0017 leaves such an input: fingerprinted whole, with the kind and organization it had.
    const r = await source(notes);
    const was = { kind: "interviewer_notes", organization: "Example Co" };
    const primary = r.files.find((f: { role: string }) => f.role === "primary").file_version_id;
    const values = { title: r.title, date: r.date, primary_version: primary, derivation: r.manifest.derivation_id, archived: false, ...was };
    const legacy = [{ kind: "record", id: notes, fingerprint: sha256Hex(canonicalJson(values)), was }];
    const tenant = await h.db.selectFrom("tenants").select("tenant_id").where("slug", "=", tenantSlug).executeTakeFirstOrThrow();
    await h.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenant.tenant_id}, true)`.execute(trx);
      await trx.updateTable("lineage").set({ inputs: JSON.stringify(legacy) }).where("record_id", "=", older).execute();
    });
    const current = await alice.api("GET", `${P}/sources/${older}/lineage`);
    expect(current.body).toMatchObject({ stale: false, input_checks: [{ id: notes, status: "current" }] });
    await alice.api("PATCH", `${P}/sources/${notes}`, { expected_etag: r.etag, title: "Sample visit notes" });
    const changed = await alice.api("GET", `${P}/sources/${older}/lineage`);
    expect(changed.body.input_checks[0]).toMatchObject({ status: "changed", changed_parts: null });
  });
});
