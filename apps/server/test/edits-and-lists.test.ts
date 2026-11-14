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
  const p = await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/products`, { name: "Ledger" });
  productPath = p.body.path;
  P = `/api/v1/p/${productPath}`;
  await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { product: "ledger", email: "vic@example.com", role: "viewer" });
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
  const BODY = "## Friday\n\nNumbers close on Friday, and the pricing review follows on Friday afternoon.";

  it("replaces exact text and returns what changed with a short diff", async () => {
    const s = await alice.api("POST", `${P}/sources`, { title: "Friday close" });
    expect(s.status).toBe(201);
    id = s.body.record_id;
    const first = await alice.api("PUT", `${P}/sources/${id}/derived/text`, { content: BODY });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const r = await alice.api("PUT", `${P}/sources/${id}/derived/text`, { expected_etag: first.body.etag, edits: [{ old_text: "on Friday,", new_text: "on Thursday," }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.diff).toEqual([expect.objectContaining({ field: "text", removed: "Fri", added: "Thurs" })]);
    const got = await alice.api("GET", `${P}/sources/${id}/derived/text`);
    expect(got.body.text).toBe("## Friday\n\nNumbers close on Thursday, and the pricing review follows on Friday afternoon.");
    etag = got.body.etag;
  });

  it("refuses an edit that matches nothing, or more than once, and changes nothing", async () => {
    const none = await alice.api("PUT", `${P}/sources/${id}/derived/text`, { expected_etag: etag, edits: [{ old_text: "Monday", new_text: "Tuesday" }] });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe("edit_not_found");
    const twice = await alice.api("PUT", `${P}/sources/${id}/derived/text`, { expected_etag: etag, edits: [{ old_text: "close", new_text: "shut" }, { old_text: "Friday", new_text: "Sunday" }] });
    expect(twice.status).toBe(422);
    expect(twice.body.error.code).toBe("edit_ambiguous");
    expect(twice.body.error.details).toMatchObject({ edit: 1, occurrences: 2 });
    const both = await alice.api("PUT", `${P}/sources/${id}/derived/text`, { expected_etag: etag, content: "New text", edits: [{ old_text: "Numbers", new_text: "Totals" }] });
    expect(both.status).toBe(422);
    const got = await alice.api("GET", `${P}/sources/${id}/derived/text`);
    expect(got.body.etag).toBe(etag);
  });

  it("refuses a viewer and a stale etag", async () => {
    const viewer = await vic.api("PUT", `${P}/sources/${id}/derived/text`, { expected_etag: etag, edits: [{ old_text: "Numbers", new_text: "Totals" }] });
    expect(viewer.status).toBe(403);
    const stale = await alice.api("PUT", `${P}/sources/${id}/derived/text`, { expected_etag: "stale", edits: [{ old_text: "Numbers", new_text: "Totals" }] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_etag");
  });
});

describe("archived outcomes", () => {
  it("are counted when hidden from the list, and listed when included", async () => {
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
    expect(all.body.note ?? "").not.toContain("include_archived");

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
    expect(cited.body.error.message).toContain("keep the evidence in sources");
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
  it("accept id for an outcome's id, and refuse two different ids", async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    const call = (name: string, action: string, params: Record<string, unknown>) => client.callTool({ name, arguments: { action, params, product: productPath } });
    const obj = await alice.api("POST", `${P}/outcomes`, { title: "Alias aim" });
    const other = await alice.api("POST", `${P}/outcomes`, { title: "Another aim" });

    expect(text(await call("outcomes_read", "get", { id: obj.body.outcome_id })).title).toBe("Alias aim");
    expect(text(await call("outcomes_read", "revisions", { id: obj.body.outcome_id })).items).toBeDefined();
    // The canonical name still works.
    expect(text(await call("outcomes_read", "get", { outcome_id: obj.body.outcome_id })).title).toBe("Alias aim");

    const clash = await call("outcomes_read", "get", { id: obj.body.outcome_id, outcome_id: other.body.outcome_id });
    expect(clash.isError).toBe(true);
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
