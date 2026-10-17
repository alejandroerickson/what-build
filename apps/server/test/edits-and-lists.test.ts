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
  const created = await alice.api("POST", `${P}/sources/with-upload`, { tags: ["interview"], title: "Finance lead interview — Example Co, Sep 2026", date: "2026-09-03", path: "call.vtt" });
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

  it("replaces exact text and returns what changed with a short diff", async () => {
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

  it("replaces exact text before the first review, with changed and diff", async () => {
    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Finance closes the numbers on Friday.", body: "Dana said so (see D1)." });
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

  it("refuses an outcome from another product when outcomes change, as when the entry is created", async () => {
    const [tenant, team] = productPath.split("/");
    const other = await alice.api("POST", `/api/v1/teams/${tenant}/${team}/products`, { name: "Elsewhere" });
    const outcome = await alice.api("POST", `/api/v1/p/${other.body.path}/outcomes`, { title: "Belongs to Elsewhere" });
    const created = await alice.api("POST", `${P}/assumptions`, { statement: "x", outcome_ids: [outcome.body.outcome_id] });
    expect(created.body.error.code).toBe("unknown_reference");
    // Outcomes and tags stay editable after a review, so the check must hold there too.
    const r = await alice.api("PATCH", `${P}/assumptions/${id}`, { expected_etag: etag, outcome_ids: [outcome.body.outcome_id] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("unknown_reference");
    expect((await alice.api("GET", `${P}/assumptions/${id}`)).body.outcome_ids).toEqual([]);
  });

  it("says in the review guidance that any review freezes the entry", async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    const d = text(await client.callTool({ name: "assumptions", arguments: { action: "review", describe: true } }));
    expect(d.description).toContain("freezes the entry's statement and body");
    await client.close();
  });
});

describe("register lists", () => {
  it("show frozen, superseded_by and link counts, and filter by status", async () => {
    const old = await alice.api("POST", `${P}/assumptions`, { statement: "Exports run weekly." });
    const other = await alice.api("POST", `${P}/assumptions`, { statement: "Exports stay in the spreadsheet.", links: [{ id: old.body.id, type: "supports" }] });
    const s = await alice.api("POST", `${P}/assumptions/${old.body.id}/supersede`, { expected_etag: old.body.etag, note: "Wrong cadence.", statement: "Exports run every Friday." });
    expect(s.status).toBe(200);
    const list = await alice.api("GET", `${P}/assumptions?query=Exports&status=unconfirmed,confirmed,refuted,superseded`);
    const byId = new Map(list.body.items.map((i: any) => [i.id, i]));
    expect(byId.get(old.body.id)).toMatchObject({ frozen: true, status: "superseded", superseded_by: [s.body.entry.id], link_count: 0, linked_from_count: 2 });
    expect(byId.get(other.body.id)).toMatchObject({ frozen: false, superseded_by: [], link_count: 1, linked_from_count: 0 });
    expect(byId.get(s.body.entry.id)).toMatchObject({ frozen: false, link_count: 1, linked_from_count: 0 });
    const current = await alice.api("GET", `${P}/assumptions?query=Exports&status=unconfirmed,confirmed`);
    expect(current.body.items.map((i: any) => i.id).sort()).toEqual([other.body.id, s.body.entry.id].sort());
    const got = await alice.api("GET", `${P}/assumptions/${old.body.id}`);
    expect(got.body.superseded_by).toEqual([s.body.entry.id]);
  });

  it("list the current entries by default, the ones the counts count, and say how many they left out", async () => {
    const t = await alice.api("POST", "/api/v1/tenants", { name: "Count Co" });
    const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Counted" });
    const Q = `/api/v1/p/${p.body.path}`;
    const outcome = await alice.api("POST", `${Q}/outcomes`, { title: "Plan the week" });
    const on = { outcome_ids: [outcome.body.outcome_id] };
    const kept = await alice.api("POST", `${Q}/assumptions`, { statement: "Crews plan weekly.", ...on });
    const old = await alice.api("POST", `${Q}/assumptions`, { statement: "Crews plan daily.", ...on });
    const replaced = await alice.api("POST", `${Q}/assumptions/${old.body.id}/supersede`, { expected_etag: old.body.etag, note: "Wrong cadence.", statement: "Crews plan every Monday.", ...on });
    const wrong = await alice.api("POST", `${Q}/assumptions`, { statement: "Crews never plan.", ...on });
    expect((await alice.api("POST", `${Q}/assumptions/${wrong.body.id}/review`, { expected_etag: wrong.body.etag, status: "refuted", note: "They do." })).status).toBe(200);

    const current = [kept.body.id, replaced.body.entry.id].sort();
    const list = await alice.api("GET", `${Q}/assumptions`);
    expect(list.body.items.map((i: any) => i.id).sort()).toEqual(current);
    expect(list.body.not_current_hidden).toBe(2);
    expect(list.body.note).toContain("refuted or superseded");
    const narrowed = await alice.api("GET", `${Q}/assumptions?query=weekly`);
    expect(narrowed.body).toMatchObject({ not_current_hidden: 0 });
    expect(narrowed.body.note).toBeUndefined();

    // The same number everywhere: the list, the product's counts in products.list and get, and the list filtered by the outcome.
    const listed = (await alice.api("GET", "/api/v1/me/products")).body.items.find((i: any) => i.product_id === p.body.product_id);
    expect(listed.counts.assumptions).toBe(current.length);
    expect((await alice.api("GET", Q)).body.counts.assumptions).toBe(current.length);
    expect((await alice.api("GET", `${Q}/assumptions?outcome_id=${outcome.body.outcome_id}`)).body.items).toHaveLength(current.length);

    // Over MCP too, and asking for every status lists every entry with nothing left out.
    const client = new Client({ name: "count-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${agentToken}` } } }));
    const mcp = text(await client.callTool({ name: "assumptions", arguments: { action: "list", product: p.body.path } }));
    expect(mcp.items.map((i: any) => i.id).sort()).toEqual(current);
    const every = text(await client.callTool({ name: "assumptions", arguments: { action: "list", product: p.body.path, params: { status: ["unconfirmed", "confirmed", "refuted", "superseded"] } } }));
    expect(every.items).toHaveLength(4);
    expect(every.not_current_hidden).toBe(0);
    await client.close();
  });
});

describe("archived outcomes", () => {
  it("are counted when hidden from the list, listed when included, and flagged where they are referenced", async () => {
    const live = await alice.api("POST", `${P}/outcomes`, { title: "Close faster" });
    const made = await alice.api("POST", `${P}/outcomes`, { title: "Retired aim" });
    expect(made.body.archived_at).toBeNull();
    expect(made.body).not.toHaveProperty("status");
    expect(made.body).not.toHaveProperty("counts");
    const stale = await alice.api("POST", `${P}/outcomes/${made.body.outcome_id}/archive`, { expected_etag: "nope" });
    expect(stale.status).toBe(409);
    const gone = await alice.api("POST", `${P}/outcomes/${made.body.outcome_id}/archive`, { expected_etag: made.body.etag });
    expect(gone.status).toBe(200);
    expect(gone.body.archived_at).not.toBeNull();
    const list = await alice.api("GET", `${P}/outcomes`);
    expect(list.body.items.map((o: any) => o.outcome_id)).toEqual([live.body.outcome_id]);
    expect(list.body.archived_hidden).toBe(1);
    expect(list.body.note).toContain("include_archived");
    const all = await alice.api("GET", `${P}/outcomes?include_archived=true`);
    expect(all.body.items.map((o: any) => o.outcome_id)).toEqual([live.body.outcome_id, gone.body.outcome_id]);
    expect(all.body).toMatchObject({ archived_hidden: 0 });
    expect(all.body.note).toBeUndefined();

    const a = await alice.api("POST", `${P}/assumptions`, { statement: "Linked too.", outcome_ids: [gone.body.outcome_id] });
    expect(a.body.archived_outcome_ids).toEqual([gone.body.outcome_id]);
    const al = await alice.api("GET", `${P}/assumptions?query=Linked`);
    expect(al.body.items[0].archived_outcome_ids).toEqual([gone.body.outcome_id]);

    const back = await alice.api("POST", `${P}/outcomes/${gone.body.outcome_id}/restore`, { expected_etag: gone.body.etag });
    expect(back.status).toBe(200);
    expect(back.body.archived_at).toBeNull();
    expect((await alice.api("GET", `${P}/outcomes`)).body.items.map((o: any) => o.outcome_id)).toEqual([live.body.outcome_id, gone.body.outcome_id]);
    const events = (await alice.api("GET", `${P}/activity?entity_id=${gone.body.outcome_id}`)).body.items.map((e: any) => e.action);
    expect(events).toEqual(expect.arrayContaining(["archived", "restored"]));
  });

  it("have no status to set: an outcome is current until archived", async () => {
    const r = await alice.api("POST", `${P}/outcomes`, { title: "Done already", status: "achieved" });
    expect(r.status).toBe(422);
  });
});

describe("what an outcome holds", () => {
  it("refuses an id or a link to a record in its title or description, and says where the evidence goes", async () => {
    const cited = await alice.api("POST", `${P}/outcomes`, { title: "Crews plan the week", description: `As source ${recordId}, its second paragraph, shows.` });
    expect(cited.status).toBe(422);
    expect(cited.body.error.code).toBe("outcome_cites_a_record");
    expect(cited.body.error.message).toContain("outcome_ids");
    expect(cited.body.error.details).toMatchObject({ field: "description", id: recordId });
    const linked = await alice.api("POST", `${P}/outcomes`, { title: `Plan the week [call](/t/a/b/c/evidence/${recordId})` });
    expect(linked.status).toBe(422);

    const plain = await alice.api("POST", `${P}/outcomes`, { title: "Crews plan the week", description: "Friday planning takes under half an hour." });
    expect(plain.status).toBe(201);
    const edited = await alice.api("PATCH", `${P}/outcomes/${plain.body.outcome_id}`, { expected_etag: plain.body.etag, description: `See source ${recordId}.` });
    expect(edited.status).toBe(422);
    expect((await alice.api("GET", `${P}/outcomes/${plain.body.outcome_id}`)).body.description).toBe("Friday planning takes under half an hour.");
  });
});

describe("id aliases", () => {
  it("accept the other id convention on every entity tool, and refuse two different ids", async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    const call = (name: string, action: string, params: Record<string, unknown>) => client.callTool({ name, arguments: { action, params, product: productPath } });
    const obj = await alice.api("POST", `${P}/outcomes`, { title: "Alias aim" });
    const other = await alice.api("POST", `${P}/outcomes`, { title: "Another aim" });
    const as = await alice.api("POST", `${P}/assumptions`, { statement: "Alias premise." });

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

describe("calls that once cost an agent a refusal", () => {
  it("places a new outcome by position, as update does", async () => {
    const first = await alice.api("POST", `${P}/outcomes`, { title: "Position first", position: -10 });
    expect(first.status).toBe(201);
    const list = await alice.api("GET", `${P}/outcomes`);
    expect(list.body.items[0].outcome_id).toBe(first.body.outcome_id);
  });

  it("says derived text reads by offset and limit when sent start and end", async () => {
    const r = await alice.api("GET", `${P}/sources/${recordId}/derived/text?start=0&end=2`);
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/send offset and limit/);
    expect((await alice.api("GET", `${P}/sources/${recordId}/derived/text?offset=0&limit=20`)).status).toBe(200);
  });

  it("saves a Story's first hierarchy without expected_etag, and asks for it after", async () => {
    expect((await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", body: "<main class=\"page\"><h1>Overview</h1></main>" })).status).toBe(201);
    const first = await alice.api("PUT", `${P}/story/hierarchy`, { items: [{ page_id: "overview", children: [] }] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await alice.api("PUT", `${P}/story/hierarchy`, { items: [{ page_id: "overview", children: [] }] });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/get_hierarchy/);
  });
});
