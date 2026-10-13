import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Dana>We export everything to a spreadsheet every Friday.

00:00:05.000 --> 00:00:09.000
<v Sam>Why Friday?

00:00:09.000 --> 00:00:14.000
<v Dana>Because that is when the numbers close and the pricing review happens.
`;

const NOTES = "# Planning\n\n4 of 5 participants plan by the week.\n\nThe ops lead signs off on Fridays.\n";

let h: Harness;
let alice: Browser;
let P: string;
let tenantId: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Research" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Scheduling" });
  P = `/api/v1/p/${p.body.path}`;
  const mine = await alice.api("GET", "/api/v1/me/products");
  tenantId = mine.body.items[0].tenant.tenant_id;
});
afterAll(async () => h?.close());

async function upload(tag: string, path: string, body: string) {
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: [tag], title: `Sample ${path}`, path, role: "primary" });
  expect(created.status).toBe(201);
  const recordId: string = created.body.record.record_id;
  const put = await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body });
  expect(put.status).toBe(201);
  await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path });
  await h.worker.drain();
  return recordId;
}

/**
 * Stand in for a snapshot written before a parser change: rewrite the stored quote and range of
 * each citation directly, as an older derivation would have captured them.
 */
async function rewriteSnapshots(entryId: string, changes: { quote: string; seq_start?: number; seq_end?: number }[]) {
  await h.db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    const row = await trx.selectFrom("register_entries").select("citations").where("entry_id", "=", entryId).executeTakeFirstOrThrow();
    const citations = row.citations.map((c, i) => ({ ...c, ...changes[i] }));
    await trx.updateTable("register_entries").set({ citations: JSON.stringify(citations) as never }).where("entry_id", "=", entryId).execute();
  });
}

async function rederive(recordId: string) {
  const before = await alice.api("GET", `${P}/sources/${recordId}/derived/manifest`);
  const r = await alice.api("POST", `${P}/sources/${recordId}/rederive`, {});
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ queued: true, previous_derivation_id: before.body.derivation_id });
  await h.worker.drain();
  const after = await alice.api("GET", `${P}/sources/${recordId}/derived/manifest`);
  expect(after.body.derivation_id).not.toBe(before.body.derivation_id);
  return after.body.derivation_id as string;
}

describe("checking citations after a re-parse", () => {
  it("matches a quote across markup and spacing, relocates it, flags the new derivation, and still catches changed words", async () => {
    const recordId = await upload("notes", "notes.md", NOTES);
    const cite = (seq: number, quote: string) => ({ record_id: recordId, seq_start: seq, seq_end: seq, quote });
    const a = await alice.api("POST", `${P}/assumptions`, {
      statement: "Most teams plan by the week.",
      citations: [cite(1, "4 of 5 participants plan"), cite(2, "signs off"), cite(1, "4 of 5 participants plan")],
    });
    expect(a.status).toBe(201);

    const fresh = await alice.api("POST", `${P}/assumptions/${a.body.id}/check-citations`, {});
    expect(fresh.body.valid).toBe(true);
    expect(fresh.body.citations[0]).toMatchObject({ status: "ok", derivation_changed: false });
    expect(fresh.body.citations[0].current_derivation_id).toBeUndefined();

    await rewriteSnapshots(a.body.id, [
      { quote: "**4 of 5 participants**  plan" },
      { quote: "`signs off`", seq_start: 1, seq_end: 1 },
      { quote: "**5 of 5 participants** plan" },
    ]);
    const current = await rederive(recordId);
    const check = await alice.api("POST", `${P}/assumptions/${a.body.id}/check-citations`, {});
    expect(check.body.valid).toBe(false);
    const [markup, moved, changed] = check.body.citations;
    expect(markup).toMatchObject({ status: "ok", quote_match: "normalized", derivation_changed: true, current_derivation_id: current });
    expect(markup.note).toMatch(/the cited range/);
    expect(moved).toMatchObject({ status: "relocated", relocated: { seq_start: 2, seq_end: 2 }, quote_match: "normalized", derivation_changed: true });
    expect(moved.note).toMatch(/segments 2–2/);
    expect(changed).toMatchObject({ status: "text_changed", derivation_changed: true, current_derivation_id: current });
    expect(changed.quote_match).toBeUndefined();
  });

  it("sets speaker labels aside only where the source gives the passage that speaker", async () => {
    const recordId = await upload("interview", "call.vtt", VTT);
    const cite = { record_id: recordId, seq_start: 2, seq_end: 2, quote: "Because that is when" };
    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Numbers close on Fridays.", citations: [cite, cite, cite] });
    expect(a.status).toBe(201);
    await rewriteSnapshots(a.body.id, [{ quote: "Dana: Because that is when" }, { quote: "**Dana:** Because that is when" }, { quote: "Sam: Because that is when" }]);
    await rederive(recordId);
    const check = await alice.api("POST", `${P}/assumptions/${a.body.id}/check-citations`, {});
    expect(check.body.citations.map((c: { status: string }) => c.status)).toEqual(["ok", "ok", "text_changed"]);
    expect(check.body.citations[0].quote_match).toBe("normalized");
  });

  it("flags a changed derivation on a Story page's citations too", async () => {
    const recordId = await upload("notes", "visit.md", NOTES);
    const html = "<!doctype html><html><head><title>Overview</title></head><body><h1>Overview</h1><p>Plans are weekly.</p></body></html>";
    const v = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", html, citations: [{ record_id: recordId, seq_start: 1, seq_end: 1, quote: "plan by the week" }] });
    expect(v.status).toBe(201);
    const current = await rederive(recordId);
    const check = await alice.api("GET", `${P}/story/pages/overview/check-citations`);
    expect(check.body.valid).toBe(true);
    expect(check.body.citations[0]).toMatchObject({ status: "ok", derivation_changed: true, current_derivation_id: current });
  });
});

describe("checking citations after a new version of the file", () => {
  it("is valid once every quote holds in the new file's passages, and not while they are unread", async () => {
    const recordId = await upload("notes", "record.md", NOTES);
    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Plans are weekly.", citations: [{ record_id: recordId, seq_start: 1, seq_end: 1, quote: "plan by the week" }] });
    expect(a.status).toBe(201);
    const grant = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { path: "record.md", role: "primary" });
    expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: NOTES + "\nAdded at the end.\n" })).status).toBe(201);
    const unread = await alice.api("POST", `${P}/assumptions/${a.body.id}/check-citations`, {});
    expect(unread.body).toMatchObject({ valid: false, rederived: false });
    expect(unread.body.unverified_note).toMatch(/newer file/);
    await h.worker.drain();
    const read = await alice.api("POST", `${P}/assumptions/${a.body.id}/check-citations`, {});
    expect(read.body).toMatchObject({ valid: true, rederived: true });
    expect(read.body.unverified_note).toBeUndefined();
    expect(read.body.citations[0]).toMatchObject({ status: "ok", version_drift: true, derivation_changed: true });
  });

  it("points what uses the source at where each quote is now, and at none once it is gone", async () => {
    const recordId = await upload("notes", "moved.md", NOTES);
    const a = await alice.api("POST", `${P}/assumptions`, {
      statement: "Sign-off is on Fridays.",
      citations: [
        { record_id: recordId, seq_start: 2, seq_end: 2, quote: "signs off on Fridays" },
        { record_id: recordId, seq_start: 1, seq_end: 1, quote: "plan by the week" },
      ],
    });
    expect(a.status).toBe(201);
    const before = await alice.api("GET", `${P}/sources/${recordId}/used-by`);
    expect(before.body.assumptions[0].citations).toEqual([{ seq_start: 2, seq_end: 2 }, { seq_start: 1, seq_end: 1 }]);
    // Two paragraphs added above renumber the sign-off; the planning line is dropped.
    const grant = await alice.api("POST", `${P}/sources/${recordId}/uploads`, { path: "moved.md", role: "primary" });
    const next = "# Planning\n\nNew opening.\n\nAnother new paragraph.\n\nThe ops lead signs off on Fridays.\n";
    expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: next })).status).toBe(201);
    await h.worker.drain();
    const after = await alice.api("GET", `${P}/sources/${recordId}/used-by`);
    expect(after.body.assumptions[0].citations).toEqual([
      { seq_start: 3, seq_end: 3, moved_from: { seq_start: 2, seq_end: 2 } },
      { seq_start: 1, seq_end: 1, quote_not_found: true },
    ]);
    // The snapshot itself is unchanged.
    const entry = await alice.api("GET", `${P}/assumptions/${a.body.id}`);
    expect(entry.body.citations.map((c: { seq_start: number }) => c.seq_start)).toEqual([2, 1]);
  });
});

describe("citing a quote that differs only in markup", () => {
  it("refuses it, and gives the passage's own words to quote", async () => {
    const recordId = await upload("notes", "brief.md", NOTES);
    const bad = await alice.api("POST", `${P}/assumptions`, { statement: "x", citations: [{ record_id: recordId, seq_start: 1, seq_end: 1, quote: "**4 of 5 participants** plan" }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("quote_not_found");
    expect(bad.body.error.details.exact_quote).toBe("4 of 5 participants plan");
    const wrong = await alice.api("POST", `${P}/assumptions`, { statement: "x", citations: [{ record_id: recordId, seq_start: 1, seq_end: 1, quote: "**3 of 5 participants** plan" }] });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details).toBeUndefined();
  });
});

describe("reading a timed transcript and anchoring notes", () => {
  let recordId: string;
  beforeAll(async () => {
    recordId = await upload("interview", "turns.vtt", VTT);
  });

  it("asks whether segment numbers were meant when a small window with no unit reads no cues", async () => {
    const seqLike = await alice.api("GET", `${P}/sources/${recordId}/passage?start=0&end=2`);
    expect(seqLike.body.unit).toBe("ms");
    expect(seqLike.body.segments).toEqual([]);
    expect(seqLike.body.warning).toMatch(/did you mean unit: "seq" \(segments 0–2\)\?/);
    const gap = await alice.api("GET", `${P}/sources/${recordId}/passage?start=100&end=200`);
    expect(gap.body.warning).toBe("No cue overlaps this window: a gap between cues.");
    const explicit = await alice.api("GET", `${P}/sources/${recordId}/passage?start=0&end=2&unit=ms`);
    expect(explicit.body.warning).toBe("No cue overlaps this window: a gap between cues.");
  });

  it("keeps each speaker's name in a note anchored across turns", async () => {
    const a = await alice.api("POST", `${P}/sources/${recordId}/annotations`, { record_id: recordId, note: "Friday is set by the close.", seq_start: 0, seq_end: 2 });
    expect(a.status).toBe(201);
    expect(a.body.anchor.quote).toBe(
      "Dana: We export everything to a spreadsheet every Friday.\n\nSam: Why Friday?\n\nDana: Because that is when the numbers close and the pricing review happens.",
    );
  });
});
