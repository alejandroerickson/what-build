import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;
let productPath: string;
let recordId: string;
let agentToken: string;

const cite = () => [{ record_id: recordId, seq_start: 0, seq_end: 0 }];

function text(r: unknown): any {
  const content = (r as { content: { text: string }[] }).content;
  const t = content[0]!.text;
  return JSON.parse(t.startsWith("{") ? t : t.slice(t.indexOf("\n") + 1));
}

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Edit Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Ledger" });
  productPath = p.body.path;
  P = `/api/v1/p/${productPath}`;
  await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "ledger", email: "vic@example.com", role: "viewer" });
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Finance lead interview — Example Co, Sep 2026", date: "2026-09-03", path: "call.vtt", role: "primary" });
  recordId = created.body.record.record_id;
  const up = created.body.upload;
  await fetch(up.url, { method: "PUT", headers: up.headers, body: VTT });
  await alice.api("POST", `${P}/sources/${recordId}/uploads/complete`, { record_id: recordId, path: "call.vtt" });
  await h.worker.drain();
  agentToken = await h.connectAgent(alice);
});
afterAll(async () => h?.close());

describe("text edits", () => {
  let id: string;
  let etag: string;

  it("replaces an exact passage and returns what changed with a short diff", async () => {
    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Friday close", body: "## Friday\n\nNumbers close on Friday, and the pricing review follows on Friday afternoon." });
    expect(a.status).toBe(201);
    id = a.body.id;
    const r = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: a.body.etag, edits: [{ old_text: "on Friday,", new_text: "on Thursday," }, { field: "statement", old_text: "Friday", new_text: "Thursday" }] });
    expect(r.status).toBe(200);
    expect(r.body.changed).toEqual(["statement", "body"]);
    expect(r.body.diff).toEqual([
      { field: "statement", at: 0, before: "", removed: "Fri", added: "Thurs", after: "day close" },
      expect.objectContaining({ field: "body", removed: "Fri", added: "Thurs" }),
    ]);
    const got = await alice.api("GET", `${P}/assumptions/${id}`);
    expect(got.body.statement).toBe("Thursday close");
    expect(got.body.body).toBe("## Friday\n\nNumbers close on Thursday, and the pricing review follows on Friday afternoon.");
    etag = got.body.etag;
  });

  it("refuses an edit that matches nothing, or more than once, and changes nothing", async () => {
    const none = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: etag, edits: [{ old_text: "Monday", new_text: "Tuesday" }] });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe("edit_not_found");
    const twice = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: etag, edits: [{ old_text: "close", new_text: "shut" }, { old_text: "Friday", new_text: "Sunday" }] });
    expect(twice.status).toBe(422);
    expect(twice.body.error.code).toBe("edit_ambiguous");
    expect(twice.body.error.details).toMatchObject({ edit: 1, occurrences: 2 });
    const both = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: etag, body: "New body", edits: [{ old_text: "Numbers", new_text: "Totals" }] });
    expect(both.status).toBe(422);
    const got = await alice.api("GET", `${P}/assumptions/${id}`);
    expect(got.body.etag).toBe(etag);
  });

  it("refuses a viewer and a stale etag", async () => {
    const viewer = await vic.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: etag, edits: [{ old_text: "Numbers", new_text: "Totals" }] });
    expect(viewer.status).toBe(403);
    const stale = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: "stale", edits: [{ old_text: "Numbers", new_text: "Totals" }] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
  });

  it("gives a diff for a whole-body replacement too", async () => {
    const r = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: etag, body: "## Friday\n\nTotals close on Thursday, and the pricing review follows on Friday afternoon." });
    expect(r.body.diff).toEqual([{ field: "body", at: 11, before: "## Friday\n\n", removed: "Number", added: "Total", after: "s close on Thursday, and the pricing rev" }]);
  });
});

describe("register edits", () => {
  let id: string;
  let etag: string;

  it("replaces an exact passage before the first review, with changed and diff", async () => {
    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Finance closes the numbers on Friday.", body: "Dana said so (see D1).", citations: cite() });
    expect(a.status).toBe(201);
    id = a.body.id;
    const r = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: a.body.etag, edits: [{ old_text: "(see D1)", new_text: "(see the export decision)" }], tags: ["finance"] });
    expect(r.status).toBe(200);
    expect(r.body.body).toBe("Dana said so (see the export decision).");
    expect(r.body.changed).toEqual(["body", "tags"]);
    expect(r.body.diff).toEqual([{ field: "body", at: 18, before: "Dana said so (see ", removed: "D1", added: "the export decision", after: ")." }]);
    etag = r.body.etag;
  });

  it("refuses edits once any review has frozen the entry", async () => {
    const rv = await alice.api("POST", `${P}/assumptions/${id}/review`, { expected_etag: etag, status: "unconfirmed", note: "Evidence mixed." });
    expect(rv.body.frozen).toBe(true);
    const r = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: rv.body.etag, edits: [{ old_text: "Dana", new_text: "The finance lead" }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("frozen");
    etag = rv.body.etag;
  });

  it("says in the review guidance that any review freezes the entry", async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    const d = text(await client.callTool({ name: "assumptions", arguments: { action: "review", describe: true } }));
    expect(d.description).toContain("freezes the entry's statement, body and citations");
    await client.close();
  });
});

describe("register lists", () => {
  it("show frozen, superseded_by and link counts, and filter by status", async () => {
    const old = await alice.api("POST", `${P}/assumptions`, { statement: "Exports run weekly.", citations: cite() });
    const other = await alice.api("POST", `${P}/assumptions`, { statement: "Exports stay in the spreadsheet.", citations: cite(), links: [{ id: old.body.id, type: "supports" }] });
    const s = await alice.api("POST", `${P}/assumptions/${old.body.id}/supersede`, { expected_etag: old.body.etag, note: "Wrong cadence.", statement: "Exports run every Friday.", citations: cite() });
    expect(s.status).toBe(200);
    const list = await alice.api("GET", `${P}/assumptions?query=Exports`);
    const byId = new Map(list.body.items.map((i: any) => [i.id, i]));
    expect(byId.get(old.body.id)).toMatchObject({ frozen: true, status: "superseded", superseded_by: [s.body.entry.id], link_count: 0, linked_from_count: 2 });
    expect(byId.get(other.body.id)).toMatchObject({ frozen: false, superseded_by: [], link_count: 1, linked_from_count: 0 });
    expect(byId.get(s.body.entry.id)).toMatchObject({ frozen: false, link_count: 1, linked_from_count: 0 });
    const current = await alice.api("GET", `${P}/assumptions?query=Exports&status=unconfirmed,confirmed`);
    expect(current.body.items.map((i: any) => i.id).sort()).toEqual([other.body.id, s.body.entry.id].sort());
    const got = await alice.api("GET", `${P}/assumptions/${old.body.id}`);
    expect(got.body.superseded_by).toEqual([s.body.entry.id]);
  });
});

describe("archived outcomes", () => {
  it("are counted when hidden from the list, and flagged where they are referenced", async () => {
    const live = await alice.api("POST", `${P}/outcomes`, { title: "Close faster" });
    const gone = await alice.api("POST", `${P}/outcomes`, { title: "Retired aim", status: "archived" });
    const list = await alice.api("GET", `${P}/outcomes`);
    expect(list.body.items.map((o: any) => o.outcome_id)).toEqual([live.body.outcome_id]);
    expect(list.body.archived_hidden).toBe(1);
    expect(list.body.note).toContain('status "archived"');
    const archived = await alice.api("GET", `${P}/outcomes?status=archived`);
    expect(archived.body).toMatchObject({ archived_hidden: 0 });
    expect(archived.body.note).toBeUndefined();

    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Linked too.", citations: cite(), outcome_ids: [gone.body.outcome_id] });
    expect(a.body.archived_outcome_ids).toEqual([gone.body.outcome_id]);
    const al = await alice.api("GET", `${P}/assumptions?query=Linked`);
    expect(al.body.items[0].archived_outcome_ids).toEqual([gone.body.outcome_id]);
  });
});

describe("id aliases", () => {
  it("accept the other id convention on every entity tool, and refuse two different ids", async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    const call = (name: string, action: string, params: Record<string, unknown>) => client.callTool({ name, arguments: { action, params, product: productPath } });
    const obj = await alice.api("POST", `${P}/outcomes`, { title: "Alias aim" });
    const other = await alice.api("POST", `${P}/outcomes`, { title: "Another aim" });
    const as = await alice.api("POST", `${P}/assumptions`, { statement: "Alias premise.", citations: cite() });

    expect(text(await call("outcomes", "get", { id: obj.body.outcome_id })).title).toBe("Alias aim");
    expect(text(await call("outcomes", "revisions", { id: obj.body.outcome_id })).items).toBeDefined();
    expect(text(await call("assumptions", "get", { assumption_id: as.body.id })).statement).toBe("Alias premise.");
    // The canonical names still work.
    expect(text(await call("assumptions", "get", { id: as.body.id })).statement).toBe("Alias premise.");
    expect(text(await call("outcomes", "get", { outcome_id: obj.body.outcome_id })).title).toBe("Alias aim");

    const clash = await call("outcomes", "get", { id: obj.body.outcome_id, outcome_id: other.body.outcome_id });
    expect(clash.isError).toBe(true);
    const wrongKind = await call("assumptions", "get", { outcome_id: obj.body.outcome_id });
    expect(wrongKind.isError).toBe(true);
    // Over REST the path carries the canonical id; an agreeing alias in the body is accepted.
    const u = await alice.api("PATCH", `${P}/outcomes/${obj.body.outcome_id}`, { id: obj.body.outcome_id, expected_etag: obj.body.etag, description: "Faster." });
    expect(u.status).toBe(200);
    await client.close();
  });
});
