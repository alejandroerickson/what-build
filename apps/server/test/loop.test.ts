import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withoutParserLabel } from "../../../packages/core/src/ops/activity.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Dana>We export everything to a spreadsheet every Friday 📊.

00:00:05.000 --> 00:00:09.000
<v Sam>Why Friday?

00:00:09.000 --> 00:00:14.000
<v Dana>Because that is when the numbers close and the pricing review happens.
`;

let h: Harness;
let alice: Browser;
let P: string; // product path prefix
let recordId: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
});
afterAll(async () => h?.close());

describe("the discovery loop through REST", () => {
  it("creates a tenant, a team and a product", async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Acme Research" });
    expect(t.status).toBe(201);
    expect(t.body.tenant.slug).toBe("acme-research");
    const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Onboarding", concept: "Make setup take minutes." });
    expect(p.status).toBe(201);
    expect(p.body.path).toBe("acme-research/product-team/onboarding");
    P = `/api/v1/p/${p.body.path}`;
    const list = await alice.api("GET", "/api/v1/me/products");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].your_role).toBe("admin");
  });

  it("keeps outcomes with etags, refuses stale writes, and keeps revisions", async () => {
    const o = await alice.api("POST", `${P}/outcomes`, { title: "Know how teams plan", description: "First." });
    expect(o.status).toBe(201);
    const stale = await alice.api("PATCH", `${P}/outcomes/${o.body.outcome_id}`, { expected_etag: "nope", title: "x" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
    expect(stale.body.error.details.current_etag).toBe(o.body.etag);
    const u = await alice.api("PATCH", `${P}/outcomes/${o.body.outcome_id}`, { title: "Know how teams plan their week" }, { "if-match": `"${o.body.etag}"` });
    expect(u.status).toBe(200);
    expect(u.body.title).toBe("Know how teams plan their week");
    expect(u.body.description).toBe("First.");
    const revs = await alice.api("GET", `${P}/outcomes/${o.body.outcome_id}/revisions`);
    expect(revs.body.items).toHaveLength(1);
    const rev = await alice.api("GET", `${P}/outcomes/${o.body.outcome_id}/revisions/1`);
    expect(rev.body.content.title).toBe("Know how teams plan");
  });

  it("refuses unknown fields and over-limit pages", async () => {
    const r = await alice.api("POST", `${P}/outcomes`, { title: "x", colour: "red" });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/^`colour` is not a field of this action\./);
    const l = await alice.api("GET", `${P}/sources?limit=500`);
    expect(l.status).toBe(422);
  });

  it("leads a refusal with its cause: unknown fields with the likely rename, then what is missing", async () => {
    const renamed = await alice.api("POST", `${P}/outcomes`, { name: "x" });
    expect(renamed.status).toBe(422);
    expect(renamed.body.error.message).toBe("`name` is not a field of this action; did you mean `title`? `title` is required. Nothing was changed; correct the call and send it again.");
    // No close match: the unknown fields and the missing one are named apart, unknown first.
    const both = await alice.api("POST", `${P}/outcomes`, { colour: "red", size: 3 });
    expect(both.body.error.message).toMatch(/^`colour` and `size` are not fields of this action\. `title` is required\. Nothing was changed/);
    // A wrong value is worded without the library's "Invalid input" preamble.
    const wrong = await alice.api("POST", `${P}/outcomes`, { title: 7 });
    expect(wrong.body.error.message).toMatch(/^`title`: expected string, received number\. Nothing was changed/);
    expect(wrong.body.error.message).not.toMatch(/Invalid input/);
  });

  it("uploads through a grant, derives on the queue, and serves exact passages", async () => {
    const created = await alice.api("POST", `${P}/sources/with-upload`, {
      title: "Ops lead interview — Example Co, Sep 2026", date: "2026-09-03",
      path: "call.vtt", role: "primary", tags: ["Interview", " Example   Co ", "Pricing", "interview"],
    });
    expect(created.status).toBe(201);
    recordId = created.body.record.record_id;
    // Tags are stored lower-case with their spacing collapsed, without repeats.
    expect(created.body.record.tags).toEqual(["interview", "example co", "pricing"]);
    const up = created.body.upload;
    expect(up.url).toBe(`${h.baseUrl}/api/v1/uploads/${up.grant_id}`);
    // The relay takes the bytes on the service's own host; the grant header is the credential.
    const put = await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
    expect(put.status).toBe(201);
    const replay = await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
    expect(replay.status).toBe(409);
    const badGrant = await fetch(up.url, { method: "PUT", headers: { ...up.headers, "X-WhatBuild-Upload-Grant": "x.y" }, body: VTT });
    expect(badGrant.status).toBe(401);
    const completed = await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "call.vtt", derived_by: "human" });
    expect(completed.status).toBe(200);
    expect(completed.body.search_status).toBe("pending");

    let brief = await alice.api("GET", `${P}/sources/${recordId}`);
    expect(brief.body.derived_status).toBe("pending");
    // Derivation never runs inside the request: it waits for the worker.
    await h.worker.drain();
    brief = await alice.api("GET", `${P}/sources/${recordId}`);
    expect(brief.body.derived_status).toBe("ready");
    expect(brief.body.segment_count).toBe(3);
    expect(brief.body.duration_ms).toBe(14000);

    const full = await alice.api("GET", `${P}/sources/${recordId}?detail=full`);
    expect(full.body.files[0]).toMatchObject({ path: "call.vtt", role: "primary", searchable: true, derived_by: "human" });
    expect(full.body.manifest.parser).toBe("webvtt");
    expect(full.body.outline).toContain("Dana");

    const byTime = await alice.api("GET", `${P}/sources/${recordId}/passage?start=4000&end=6000`);
    expect(byTime.body.unit).toBe("ms");
    expect(byTime.body.segments.map((s: { seq: number }) => s.seq)).toEqual([0, 1]);
    const bySeq = await alice.api("GET", `${P}/sources/${recordId}/passage?start=2&end=9&unit=seq`);
    expect(bySeq.body.out_of_range).toBe(true);
    expect(bySeq.body.segments[0].text).toContain("numbers close");
    // Code-point offsets: the emoji counts once.
    const seg0 = byTime.body.segments[0];
    expect(seg0.char_end - seg0.char_start).toBe(Array.from(seg0.text as string).length);
    const tooWide = await alice.api("GET", `${P}/sources/${recordId}/passage?start=0&end=500&unit=seq`);
    expect(tooWide.status).toBe(422);
    expect(tooWide.body.error.code).toBe("window_too_large");
    expect(tooWide.body.error.message).toContain("segment numbers");
    // One segment by its seq, as a hit names it: segments, though the source is timed.
    const one = await alice.api("GET", `${P}/sources/${recordId}/passage?seq=1`);
    expect(one.body).toMatchObject({ unit: "seq", requested: { start: 1, end: 1 }, returned: { seq_start: 1, seq_end: 1 } });
    for (const q of ["seq=1&start=0&end=2", "seq=1&unit=ms", "start=0"]) {
      const refused = await alice.api("GET", `${P}/sources/${recordId}/passage?${q}`);
      expect(refused.status, q).toBe(422);
      expect(refused.body.error.code, q).toBe("invalid_input");
    }

    const bytes = await alice.api("GET", `${P}/sources/${recordId}/file?path=call.vtt`);
    expect(bytes.status).toBe(200);
    expect(bytes.body).toContain("WEBVTT");
    expect(bytes.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("searches exact text and ranked queries, and says what it covered", async () => {
    const s = await alice.api("GET", `${P}/search?query=numbers%20close`);
    expect(s.body.hits).toHaveLength(1);
    expect(s.body.hits[0]).toMatchObject({ record_id: recordId, seq: 2, speaker: "Dana" });
    expect(s.body.records[recordId].title).toContain("Ops lead");
    expect(s.body.coverage.records_considered).toBe(1);
    const r = await alice.api("GET", `${P}/search?query=${encodeURIComponent('(friday OR pricing) NOT why')}&mode=ranked`);
    expect(r.status).toBe(200);
    expect(r.body.hits.map((x: { seq: number }) => x.seq).sort()).toEqual([0, 2]);
    const bad = await alice.api("GET", `${P}/search?query=${encodeURIComponent('"unclosed')}&mode=ranked`);
    expect(bad.status).toBe(422);
  });

  it("records a cited assumption with a frozen snapshot, reviews it, and checks citations", async () => {
    const a = await alice.api("POST", `${P}/assumptions`, {
      statement: "Teams close their numbers on Fridays.",
      citations: [{ record_id: recordId, seq_start: 2, seq_end: 2, quote: "numbers close" }],
    });
    expect(a.status).toBe(201);
    expect(a.body.status).toBe("unconfirmed");
    expect(a.body.author_type).toBe("human");
    expect(a.body.citations[0].quote).toBe("numbers close");
    const badQuote = await alice.api("POST", `${P}/assumptions`, { statement: "x", citations: [{ record_id: recordId, seq_start: 0, seq_end: 0, quote: "not there" }] });
    expect(badQuote.status).toBe(422);
    expect(badQuote.body.error.code).toBe("quote_not_found");
    const agentConfidence = await alice.api("POST", `${P}/assumptions/${a.body.id}/review`, { expected_etag: a.body.etag, status: "confirmed", note: "x", reviewer_type: "agent", confidence: "high" });
    expect(agentConfidence.status).toBe(422);
    const rv = await alice.api("POST", `${P}/assumptions/${a.body.id}/review`, { expected_etag: a.body.etag, status: "confirmed", note: "Heard in two calls.", confidence: "medium" });
    expect(rv.status).toBe(200);
    expect(rv.body.status).toBe("confirmed");
    expect(rv.body.human_review.confidence).toBe("medium");
    const frozen = await alice.api("PATCH", `${P}/assumptions/${a.body.id}`, { expected_etag: rv.body.etag, statement: "changed" });
    expect(frozen.status).toBe(409);
    expect(frozen.body.error.code).toBe("frozen");
    const check = await alice.api("POST", `${P}/assumptions/${a.body.id}/check-citations`, {});
    expect(check.body.valid).toBe(true);
    const sup = await alice.api("POST", `${P}/assumptions/${a.body.id}/supersede`, {
      expected_etag: rv.body.etag, note: "Narrower wording.", statement: "The numbers close on Fridays.", citations: [{ record_id: recordId, seq_start: 2, seq_end: 2 }],
    });
    expect(sup.status).toBe(200);
    expect(sup.body.entry.links).toEqual([expect.objectContaining({ id: a.body.id, type: "supersedes" })]);
    const old = await alice.api("GET", `${P}/assumptions/${a.body.id}`);
    expect(old.body.status).toBe("superseded");
    // The list names each entry's successors, so history can be shown under its correction.
    const all = await alice.api("GET", `${P}/assumptions?status=superseded,confirmed,unconfirmed`);
    const byId = (id: string) => all.body.items.find((x: { id: string }) => x.id === id);
    expect(byId(a.body.id).superseded_by).toEqual([sup.body.entry.id]);
    expect(byId(sup.body.entry.id).superseded_by).toEqual([]);
  });

  it("records assumptions before there is evidence, and cites it later", async () => {
    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Crew leads plan on Sunday evenings." });
    expect(a.status).toBe(201);
    expect(a.body.citations).toEqual([]);
    expect(a.body.status).toBe("unconfirmed");
    const check = await alice.api("POST", `${P}/assumptions/${a.body.id}/check-citations`, {});
    expect(check.body.valid).toBe(true);
    const log = await alice.api("GET", `${P}/activity?entity_id=${a.body.id}`);
    expect(log.body.items[0].summary).toBe("Recorded an unconfirmed assumption with no citations yet");
    const cited = await alice.api("PATCH", `${P}/assumptions/${a.body.id}`, { expected_etag: a.body.etag, citations: [{ record_id: recordId, seq_start: 2, seq_end: 2 }] });
    expect(cited.status).toBe(200);
    expect(cited.body.changed).toEqual(["citations"]);
    expect(cited.body.citations).toHaveLength(1);
    const tooMany = await alice.api("POST", `${P}/assumptions`, { statement: "x", citations: Array.from({ length: 21 }, () => ({ record_id: recordId, seq_start: 2, seq_end: 2 })) });
    expect(tooMany.status).toBe(422);
  });

  it("counts only current assumptions, as the default lists show them", async () => {
    const o = await alice.api("POST", `${P}/outcomes`, { title: "Know when numbers close" });
    const cite = [{ record_id: recordId, seq_start: 2, seq_end: 2 }];
    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Numbers close weekly.", citations: cite, outcome_ids: [o.body.outcome_id] });
    const sup = await alice.api("POST", `${P}/assumptions/${a.body.id}/supersede`, {
      expected_etag: a.body.etag, note: "Sharper.", statement: "Numbers close every Friday.", citations: cite, outcome_ids: [o.body.outcome_id],
    });
    expect(sup.status).toBe(200);
    const d = await alice.api("POST", `${P}/assumptions`, { statement: "Plans move to Monday.", citations: cite, outcome_ids: [o.body.outcome_id] });
    await alice.api("POST", `${P}/assumptions/${d.body.id}/review`, { expected_etag: d.body.etag, status: "refuted", note: "Friday stayed." });
    const objs = await alice.api("GET", `${P}/outcomes`);
    const mine = objs.body.items.find((x: { outcome_id: string }) => x.outcome_id === o.body.outcome_id);
    expect(mine.counts).toEqual({ assumptions: 1 });
    const onOutcome = await alice.api("GET", `${P}/assumptions?status=unconfirmed,confirmed&outcome_id=${o.body.outcome_id}`);
    expect(onOutcome.body.items).toHaveLength(mine.counts.assumptions);
    const product = await alice.api("GET", P);
    const current = await alice.api("GET", `${P}/assumptions?status=unconfirmed,confirmed&limit=100`);
    expect(product.body.counts.assumptions).toBe(current.body.items.length);
  });

  it("lists what uses a source", async () => {
    const forRecord = await alice.api("GET", `${P}/sources/${recordId}/used-by`);
    expect(forRecord.body.assumptions.length).toBeGreaterThan(0);
  });

  it("publishes Story versions, validates HTML, and serves pages sandboxed", async () => {
    const bad = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "x", html: '<html><body><script src="https://x.test/a.js"></script><iframe></iframe></body></html>' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.problems.length).toBe(2);
    const v1 = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Where we stand", html: "<!doctype html><title>t</title><h1>Hello</h1>" });
    expect(v1.status).toBe(201);
    expect(v1.body.current.version).toBe(1);
    expect(v1.body.placed).toBe(false);
    const noEtag = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Again" });
    expect(noEtag.status).toBe(409);
    const v2 = await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Where we stand now", expected_etag: v1.body.etag });
    expect(v2.body.current.version).toBe(2);
    const tree = await alice.api("GET", `${P}/story/hierarchy`);
    expect(tree.body.etag).toBeNull();
    expect(tree.body.items).toEqual([]);
    expect(tree.body.unplaced).toEqual([{ page_id: "overview", title: "Where we stand now", description: expect.any(String) }]);
    const set = await alice.api("PUT", `${P}/story/hierarchy`, { items: [{ page_id: "overview", children: [] }], expected_etag: null });
    expect(set.status).toBe(200);
    expect(set.body.unplaced).toEqual([]);
    const html = await alice.api("GET", `${P}/story/pages/overview/versions/1/html`);
    expect(html.body).toContain("<h1>Hello</h1>");
    expect(html.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    const guidance = await alice.api("GET", `${P}/story/guidance?section=writing`);
    expect(guidance.body.writing.fact_guardrails.length).toBeGreaterThan(0);
    expect(guidance.body.stylesheet).toBeUndefined();
  });

  it("exports the whole product to a self-describing ZIP, any role, built by the worker", async () => {
    const started = await alice.api("POST", `${P}/exports`, {});
    expect(started.status).toBe(201);
    expect(started.body.status).toBe("pending");
    await h.worker.drain();
    const list = await alice.api("GET", `${P}/exports`);
    const ex = list.body.items[0];
    expect(ex.status).toBe("ready");
    const res = await fetch(ex.download.url, { headers: ex.download.headers });
    expect(res.status).toBe(200);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files);
    expect(names).toContain("bundle.json");
    expect(names.some((n) => n.startsWith(`records/${recordId}/files/`) && n.endsWith("/call.vtt"))).toBe(true);
    expect(names.some((n) => n.startsWith(`records/${recordId}/derived/`) && n.endsWith("/segments.jsonl"))).toBe(true);
    expect(names).toContain("assumptions.json");
    expect(names).toContain("story/pages/overview/v2.html");
    expect(names).toContain("activity.jsonl");
    expect(new TextDecoder().decode(files["bundle.json"]!)).toContain("whatbuild-product-bundle");
    const viaSession = await fetch(`${h.baseUrl}${P}/exports/${ex.export_id}/file`, { headers: { cookie: alice.cookie } });
    expect(viaSession.status).toBe(200);
  });

  it("records every change in the activity log, attributed and without content", async () => {
    const a = await alice.api("GET", `${P}/activity?limit=100`);
    const actions = a.body.items.map((i: { entity_type: string; action: string }) => `${i.entity_type}:${i.action}`);
    expect(actions).toContain("source:created");
    expect(actions).toContain("source:derived");
    expect(actions).toContain("assumption:reviewed");
    expect(actions).toContain("story_page:published");
    // A parse line says what a person understands: the file and its passages, never the parser's own label.
    const parsed = a.body.items.find((i: { action: string }) => i.action === "derived");
    expect(parsed.summary).toMatch(/^Parsed \S+ into \d+ passages?$/);
    expect(withoutParserLabel("Parsed notes.md into 5 passages (markdown 2)")).toBe("Parsed notes.md into 5 passages");
    for (const i of a.body.items) expect(JSON.stringify(i)).not.toContain("alice@example.com");
    const one = await alice.api("GET", `${P}/activity?entity_id=${recordId}`);
    expect(one.body.items.every((i: { entity_id: string }) => i.entity_id === recordId)).toBe(true);
  });

  it("archives out of search and restores; deletes permanently only with every guard", async () => {
    await alice.api("POST", `${P}/sources/archive`, { record_ids: [recordId] });
    const s = await alice.api("GET", `${P}/search?query=numbers%20close`);
    expect(s.body.hits).toHaveLength(0);
    await alice.api("POST", `${P}/sources/restore`, { record_ids: [recordId] });
    expect((await alice.api("GET", `${P}/search?query=numbers%20close`)).body.hits).toHaveLength(1);

    const impact = await alice.api("GET", `${P}/sources/${recordId}/delete-impact`);
    expect(impact.body.citations.length).toBeGreaterThan(0);
    const noConfirm = await alice.api("DELETE", `${P}/sources/${recordId}`, { expected_etag: impact.body.etag, reason: "wrong file", confirm: "yes" });
    expect(noConfirm.status).toBe(422);
    expect(noConfirm.body.error.code).toBe("confirmation_required");
    const del = await alice.api("DELETE", `${P}/sources/${recordId}`, { expected_etag: impact.body.etag, reason: "wrong file", confirm: "delete permanently" });
    expect(del.status).toBe(200);
    const gone = await alice.api("GET", `${P}/sources/${recordId}`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.details.tombstone.reason).toBe("wrong file");
    const entries = await alice.api("GET", `${P}/assumptions?status=superseded,confirmed,unconfirmed`);
    const e = entries.body.items[0];
    const check = await alice.api("POST", `${P}/assumptions/${e.id}/check-citations`, {});
    expect(check.body.citations[0].status).toBe("record_deleted");
    // The quotation the team wrote down survives the source.
    const read = await alice.api("GET", `${P}/assumptions/${e.id}`);
    expect(read.body.citations[0].quote.length).toBeGreaterThan(0);
    await h.worker.drain();
    expect([...h.blobs.blobs.keys()].some((k) => k.includes(recordId))).toBe(false);
  });
  it("lists each product with the counts products.get reports, across organizations", async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Beacon Labs" });
    const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Dispatch" });
    await alice.api("POST", `/api/v1/p/${p.body.path}/outcomes`, { title: "Know who is on call" });
    const list = await alice.api("GET", "/api/v1/me/products");
    expect(list.body.items).toHaveLength(2);
    for (const item of list.body.items) {
      const one = await alice.api("GET", `/api/v1/p/${item.path}`);
      expect(item.counts).toEqual(one.body.counts);
    }
    const dispatch = list.body.items.find((i: { path: string }) => i.path === p.body.path);
    expect(dispatch.counts).toEqual({ sources: 0, outcomes: 1, assumptions: 0, mockups: 0, story_pages: 0 });
    const onboarding = list.body.items.find((i: { path: string }) => i.path !== p.body.path);
    expect(onboarding.counts.outcomes).toBeGreaterThan(1);
  });
});
