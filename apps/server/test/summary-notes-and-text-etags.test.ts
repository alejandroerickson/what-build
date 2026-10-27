import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OPERATIONS_BY_NAME } from "@whatbuild/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A source's summary, its notes and its derived text each have an etag of their own. A write
// takes none while the part does not exist yet, and the part's current etag once it does: without
// one, with a stale one, or with another of the source's etags, it is refused with
// 409 stale_etag and current_etag, and a message saying what to pass. Over REST and MCP alike.

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;
let path: string;
let agent: Client;
let readOnlyAgent: Client;

async function connect(token: string) {
  const client = new Client({ name: "etag-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Etag Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  path = p.body.path;
  P = `/api/v1/p/${path}`;
  await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email: "vic@example.com", role: "viewer" });
  agent = await connect(await h.connectAgent(alice, "Etag agent"));
  readOnlyAgent = await connect(await h.connectAgent(alice, "Read-only agent", "/mcp", "viewer"));
});
afterAll(async () => {
  await agent?.close();
  await readOnlyAgent?.close();
  await h?.close();
});

async function source(title: string) {
  const r = await alice.api("POST", `${P}/sources`, { title });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { record_id: string; etag: string };
}

const note = (id: string, kind: string, body: Record<string, unknown>, who = alice, headers?: Record<string, string>) => who.api("PUT", `${P}/sources/${id}/agent-notes/${kind}`, body, headers);
const readNote = (id: string, kind: string, who = alice) => who.api("GET", `${P}/sources/${id}/agent-notes/${kind}`);
const text = (id: string, body: Record<string, unknown>, who = alice) => who.api("PUT", `${P}/sources/${id}/derived/text`, body);
const full = async (id: string) => (await alice.api("GET", `${P}/sources/${id}?detail=full`)).body;

/** One call to a derived tool (derived_read for a read), answered as REST answers it: its status and its body. */
async function mcp(client: Client, action: string, params: Record<string, unknown>) {
  const name = ["read_note", "text", "manifest", "list"].includes(action) ? "derived_read" : "derived_write";
  const r = (await client.callTool({ name, arguments: { action, params, product: path } })) as { content: { text: string }[]; isError?: boolean };
  const out = r.content[0]!.text;
  return r.isError ? { status: Number(out.slice(0, 3)), body: JSON.parse(out.slice(out.indexOf("\n") + 1)) } : { status: 200, body: JSON.parse(out) };
}

function refused(r: { status: number; body: any }, message: RegExp, current: string | null) {
  expect(r.status, JSON.stringify(r.body)).toBe(409);
  expect(r.body.error).toMatchObject({ code: "stale_etag", details: { current_etag: current } });
  expect(r.body.error.message).toMatch(message);
}

describe("a source's summary and notes", () => {
  it("take no etag for the first write, then return the etag every read gives, apart from the source's", async () => {
    const s = await source("Crew lead interview — Example Co, Sep 2026");
    const w = await note(s.record_id, "summary", { content: "Crews plan by the week." });
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    expect(w.body).toMatchObject({ record_id: s.record_id, note_kind: "summary", chars: "Crews plan by the week.".length, etag: expect.any(String) });
    expect(w.headers.get("etag")).toBe(`"${w.body.etag}"`);

    const read = await readNote(s.record_id, "summary");
    expect(read.body).toMatchObject({ content: "Crews plan by the week.", etag: w.body.etag, updated_by: { display_name: "Alice Example" } });
    // The time the write answered with is the time it stored.
    expect(read.body.updated_at).toBe(w.body.updated_at);
    expect(read.headers.get("etag")).toBe(`"${w.body.etag}"`);

    const n = await note(s.record_id, "notes", { content: "Ask about Fridays." });
    expect(n.status).toBe(200);
    const f = await full(s.record_id);
    expect(f.agent_notes).toEqual(
      expect.arrayContaining([
        { kind: "summary", etag: w.body.etag, updated_at: w.body.updated_at, updated_by: expect.objectContaining({ display_name: "Alice Example" }) },
        { kind: "notes", etag: n.body.etag, updated_at: n.body.updated_at, updated_by: expect.objectContaining({ display_name: "Alice Example" }) },
      ]),
    );
    // The summary and notes are written apart from the source, which keeps its etag.
    expect(f.etag).toBe(s.etag);
    expect(new Set([s.etag, w.body.etag, n.body.etag]).size).toBe(3);
  });

  it("refuse a write or a clearing without the etag once there is one, saying which etag to pass", async () => {
    const s = await source("Owner call — Example Co");
    const first = await note(s.record_id, "summary", { content: "The first summary." });
    const again = await note(s.record_id, "summary", { content: "A summary written without reading the first." });
    refused(again, /^This source already has a summary; read it with derived_read\(action="read_note", note_kind="summary"\) and pass its etag as expected_etag\.$/, first.body.etag);
    refused(await note(s.record_id, "summary", { content: "" }), /already has a summary/, first.body.etag);
    expect((await readNote(s.record_id, "summary")).body).toMatchObject({ content: "The first summary.", etag: first.body.etag });

    const notes = await note(s.record_id, "notes", { content: "First notes." });
    refused(await note(s.record_id, "notes", { content: "Other notes." }), /^This source already has notes; read them with derived_read\(action="read_note", note_kind="notes"\) and pass their etag as expected_etag\.$/, notes.body.etag);
    expect((await readNote(s.record_id, "notes")).body.content).toBe("First notes.");
  });

  it("refuse a stale etag, and name another of the source's etags sent in its place", async () => {
    const s = await source("Workshop — Example Co");
    const summary = await note(s.record_id, "summary", { content: "Crews text the office." });
    const notes = await note(s.record_id, "notes", { content: "Follow up on the radios." });
    const written = await text(s.record_id, { content: "Crews text the office every Friday.\n" });
    expect(written.status, JSON.stringify(written.body)).toBe(200);

    refused(
      await note(s.record_id, "summary", { content: "x", expected_etag: "an-old-etag" }),
      /^That is not the current etag of this source's summary\. Read it again with derived_read\(action="read_note", note_kind="summary"\), see what it says now, and pass its etag\.$/,
      summary.body.etag,
    );
    refused(await note(s.record_id, "notes", { content: "x", expected_etag: "an-old-etag" }), /^That is not the current etag of this source's notes\. Read them again/, notes.body.etag);
    const pass = /Pass the summary's etag: derived_read\(action="read_note", note_kind="summary"\) returns it, as does sources_read\(action="get", detail="full"\) in agent_notes\.$/;
    const withSource = await note(s.record_id, "summary", { content: "x", expected_etag: s.etag });
    refused(withSource, /^That is the source's etag; its summary has its own\. /, summary.body.etag);
    expect(withSource.body.error.message).toMatch(pass);
    refused(await note(s.record_id, "summary", { content: "x", expected_etag: notes.body.etag }), /^That is the etag of the source's notes; its summary has its own\. /, summary.body.etag);
    refused(await note(s.record_id, "summary", { content: "x", expected_etag: written.body.etag }), /^That is the etag of the source's derived text; its summary has its own\. /, summary.body.etag);
    // The source's etag is named while it is current. Once an attachment moves it on, the one read
    // before is no one's current etag: the refusal says so, and not that the summary changed.
    const grant = await alice.api("POST", `${P}/sources/${s.record_id}/uploads`, { record_id: s.record_id, path: "notes.txt" });
    expect((await fetch(grant.body.url, { method: "PUT", headers: grant.body.headers, body: "Radios are kept at the depot.\n" })).status).toBe(201);
    const moved = (await full(s.record_id)).etag;
    expect(moved).not.toBe(s.etag);
    refused(await note(s.record_id, "summary", { content: "x", expected_etag: s.etag }), /^That is not the current etag of this source's summary\. /, summary.body.etag);
    refused(await note(s.record_id, "summary", { content: "x", expected_etag: moved }), /^That is the source's etag; its summary has its own\. /, summary.body.etag);
    refused(await note(s.record_id, "notes", { content: "x", expected_etag: summary.body.etag }), /^That is the etag of the source's summary; its notes have their own\. Pass the notes' etag/, notes.body.etag);
    expect((await readNote(s.record_id, "summary")).body).toMatchObject({ content: "Crews text the office.", etag: summary.body.etag });
    expect((await readNote(s.record_id, "notes")).body).toMatchObject({ content: "Follow up on the radios.", etag: notes.body.etag });
  });

  it("replace and clear with the current etag, take none again once cleared, and log each write", async () => {
    const s = await source("Site visit — Example Co");
    const first = await note(s.record_id, "summary", { content: "Crews plan by the day." });
    const second = await note(s.record_id, "summary", { content: "Crews plan by the week.", expected_etag: first.body.etag });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.etag).not.toBe(first.body.etag);
    // Sent again with the etag it was read with, a write is refused: someone wrote since.
    refused(await note(s.record_id, "summary", { content: "Crews plan by the day.", expected_etag: first.body.etag }), /^That is not the current etag of this source's summary\./, second.body.etag);
    // REST also takes the etag as If-Match.
    const third = await note(s.record_id, "summary", { content: "Crews plan by the week, then the day." }, alice, { "if-match": `"${second.body.etag}"` });
    expect(third.status, JSON.stringify(third.body)).toBe(200);

    const cleared = await note(s.record_id, "summary", { content: " ", expected_etag: third.body.etag });
    expect(cleared.body).toMatchObject({ chars: 0, etag: null });
    const gone = await readNote(s.record_id, "summary");
    expect(gone.status).toBe(404);
    expect(gone.body.error.message).toBe('No summary has been written for this source. To write one, send derived_write(action="write_note") without expected_etag.');
    expect((await full(s.record_id)).agent_notes).toEqual([]);
    // With nothing to match, an etag is refused, and the refusal says to leave it out.
    refused(
      await note(s.record_id, "summary", { content: "Back again.", expected_etag: third.body.etag }),
      /^This source has no summary now, so there is no etag to match: derived_read\(action="read_note", note_kind="summary"\) answers 404\. Leave expected_etag out for the first write\.$/,
      null,
    );
    expect((await note(s.record_id, "summary", { content: "Back again." })).status).toBe(200);
    const log = await alice.api("GET", `${P}/activity?entity_id=${s.record_id}`);
    expect(log.body.items.filter((i: { action: string }) => i.action === "agent_note_written").map((i: { summary: string }) => i.summary)).toEqual([
      "Wrote the summary",
      "Cleared the summary",
      "Wrote the summary",
      "Wrote the summary",
      "Wrote the summary",
    ]);
  });

  it("are written only by editors, and by an agent only at a level that writes", async () => {
    const s = await source("Dispatcher call — Example Co");
    const w = await note(s.record_id, "summary", { content: "Gate codes go stale." });
    // A viewer reads them, etag and all, and cannot write them, with or without it.
    expect((await readNote(s.record_id, "summary", vic)).body).toMatchObject({ content: "Gate codes go stale.", etag: w.body.etag });
    for (const body of [{ content: "A viewer's summary.", expected_etag: w.body.etag }, { content: "A viewer's summary." }]) {
      const r = await note(s.record_id, "summary", body, vic);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("forbidden");
    }
    expect((await note(s.record_id, "notes", { content: "A viewer's first notes." }, vic)).status).toBe(403);
    const r = await mcp(readOnlyAgent, "write_note", { record_id: s.record_id, note_kind: "summary", content: "An agent's summary.", expected_etag: w.body.etag });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("connection_level");
    expect((await mcp(readOnlyAgent, "read_note", { record_id: s.record_id, note_kind: "summary" })).body.etag).toBe(w.body.etag);
    expect((await readNote(s.record_id, "summary")).body).toMatchObject({ content: "Gate codes go stale.", etag: w.body.etag });
  });

  it("answer an agent over MCP as they answer REST", async () => {
    const s = await source("Survey export — Example Co");
    const first = await mcp(agent, "write_note", { record_id: s.record_id, note_kind: "notes", content: "Read the free-text answers." });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ note_kind: "notes", etag: expect.any(String) });
    const read = await mcp(agent, "read_note", { record_id: s.record_id, note_kind: "notes" });
    expect(read.body).toMatchObject({ content: "Read the free-text answers.", etag: first.body.etag, updated_at: first.body.updated_at });
    expect((await readNote(s.record_id, "notes")).body.etag).toBe(first.body.etag);

    refused(await mcp(agent, "write_note", { record_id: s.record_id, note_kind: "notes", content: "Unread." }), /already has notes; read them/, first.body.etag);
    refused(await mcp(agent, "write_note", { record_id: s.record_id, note_kind: "notes", content: "Unread.", expected_etag: s.etag }), /^That is the source's etag; its notes have their own\./, first.body.etag);
    const second = await mcp(agent, "write_note", { record_id: s.record_id, note_kind: "notes", content: "Read them twice.", expected_etag: read.body.etag });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await readNote(s.record_id, "notes")).body).toMatchObject({ content: "Read them twice.", etag: second.body.etag, updated_by: { surface: "mcp" } });
    // An agent learns the etags from the source's full read too.
    const got = (await agent.callTool({ name: "sources_read", arguments: { action: "get", params: { record_id: s.record_id, detail: "full" }, product: path } })) as { content: { text: string }[] };
    expect(JSON.parse(got.content[0]!.text).agent_notes).toEqual([expect.objectContaining({ kind: "notes", etag: second.body.etag })]);
  });
});

describe("a source's derived text", () => {
  it("takes no etag for the first text, and its current one once there is one", async () => {
    const s = await source("Board photo notes — Example Co");
    const first = await text(s.record_id, { content: "Monday column is full.\n" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const missing = /^This source already has a derived text; read it with derived_read\(action="text"\) and pass its etag as expected_etag\.$/;
    // Every way to write it: whole, removed, by edits, or from an attachment.
    for (const body of [{ content: "Rewritten unread.\n" }, { content: "" }, { edits: [{ old_text: "Monday", new_text: "Tuesday" }] }, { from_attachment: "board.txt" }])
      refused(await text(s.record_id, body), missing, first.body.etag);
    const pass = /Pass the derived text's etag: derived_read\(action="text"\) returns it, as does sources_read\(action="get", detail="full"\) as text\.etag\.$/;
    const withSource = await text(s.record_id, { content: "x\n", expected_etag: s.etag });
    refused(withSource, /^That is the source's etag; its derived text has its own\. /, first.body.etag);
    expect(withSource.body.error.message).toMatch(pass);
    const summary = await note(s.record_id, "summary", { content: "A full Monday." });
    refused(await text(s.record_id, { content: "x\n", expected_etag: summary.body.etag }), /^That is the etag of the source's summary; its derived text has its own\. /, first.body.etag);
    const stale = await text(s.record_id, { content: "x\n", expected_etag: "an-old-etag" });
    refused(stale, /^That is not the current etag of this source's derived text\. Read it again with derived_read\(action="text"\), see what it says now, and pass its etag\.$/, first.body.etag);
    expect((await alice.api("GET", `${P}/sources/${s.record_id}/derived/text`)).body).toMatchObject({ text: "Monday column is full.\n", etag: first.body.etag });

    const edited = await text(s.record_id, { edits: [{ old_text: "Monday", new_text: "Tuesday" }], expected_etag: first.body.etag });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    refused(await text(s.record_id, { content: "Back to Monday.\n", expected_etag: first.body.etag }), /^That is not the current etag of this source's derived text\./, edited.body.etag);
  });

  it("says to leave the etag out when there is no text to match", async () => {
    const s = await source("Typed-up notes — Example Co");
    const first = await text(s.record_id, { content: "Typed up by hand.\n" });
    const removed = await text(s.record_id, { content: "", expected_etag: first.body.etag });
    expect(removed.body).toMatchObject({ chars: 0, etag: null });
    refused(
      await text(s.record_id, { content: "Typed again.\n", expected_etag: first.body.etag }),
      /^This source has no derived text now, so there is no etag to match: derived_read\(action="text"\) answers 404\. Leave expected_etag out for the first write\.$/,
      null,
    );
    const bare = await source("Nothing written yet — Example Co");
    refused(await text(bare.record_id, { content: "Words.\n", expected_etag: bare.etag }), /no derived text now.*Leave expected_etag out/, null);
    expect((await text(s.record_id, { content: "Typed again.\n" })).status).toBe(200);
  });

  it("is written only by editors, and answers an agent over MCP as it answers REST", async () => {
    const s = await source("Route sheet — Example Co");
    const first = await mcp(agent, "write_text", { record_id: s.record_id, content: "Crews leave at six.\n" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    refused(await mcp(agent, "write_text", { record_id: s.record_id, content: "Crews leave at seven.\n" }), /already has a derived text/, first.body.etag);
    refused(await mcp(agent, "write_text", { record_id: s.record_id, content: "Crews leave at seven.\n", expected_etag: s.etag }), /^That is the source's etag; its derived text has its own\./, first.body.etag);
    const window = await mcp(agent, "text", { record_id: s.record_id });
    expect(window.body.etag).toBe(first.body.etag);
    expect((await mcp(agent, "write_text", { record_id: s.record_id, edits: [{ old_text: "six", new_text: "seven" }], expected_etag: window.body.etag })).status).toBe(200);

    const now = (await full(s.record_id)).text.etag;
    expect((await text(s.record_id, { content: "A viewer's text.\n", expected_etag: now }, vic)).status).toBe(403);
    const r = await mcp(readOnlyAgent, "write_text", { record_id: s.record_id, content: "A read-only agent's text.\n", expected_etag: now });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("connection_level");
    expect((await full(s.record_id)).text.etag).toBe(now);
  });
});

describe("refusals of retired inputs", () => {
  it("name what replaced a source's outline, citations, refs and related sources", async () => {
    const s = await source("Retired fields — Example Co");
    for (const r of [await note(s.record_id, "outline", { content: "- One" }), await readNote(s.record_id, "outline"), await mcp(agent, "write_note", { record_id: s.record_id, note_kind: "outline", content: "- One" })]) {
      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(/A source has no outline any more: note_kind is summary .* or notes .*\. Find your way through a long source with search and derived_read\(action="text"\) windows\./);
    }
    // Another value of the field gets no word about outlines.
    expect((await note(s.record_id, "draft", { content: "x" })).body.error.message).not.toMatch(/outline/);

    const a = (await alice.api("POST", `${P}/assumptions`, { statement: "Crew leads plan by the week." })).body;
    const cited = /Nothing takes citations, refs or related sources any more: evidence is found by searching, not cited\. Say in words what the work rests on/;
    for (const r of [
      await alice.api("PATCH", `${P}/assumptions/${a.id}`, { expected_etag: a.etag, citations: [] }),
      await alice.api("POST", `${P}/story/pages/overview/versions`, { title: "Overview", body: "<p>Hi</p>", refs: { sources: [s.record_id] } }),
      await alice.api("POST", `${P}/sources`, { title: "Related — Example Co", related_records: [s.record_id] }),
      await alice.api("PATCH", `${P}/sources/${s.record_id}`, { expected_etag: s.etag, related_records: [] }),
    ]) {
      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(cited);
    }
  });

  it("say derived text reads by offset and limit, for a passage's fields and for length", async () => {
    const s = await source("Window fields — Example Co");
    await text(s.record_id, { content: "Plan the week, then the day.\n" });
    const hint = /reads by code-point offset: send offset and limit, where the window starts \(.*\) and how many characters it holds\. There are no passages to read by number\./;
    for (const q of ["start=1&end=3", "seq=1", "length=10", "unit=passage"]) {
      const r = await alice.api("GET", `${P}/sources/${s.record_id}/derived/text?${q}`);
      expect(r.status, q).toBe(422);
      expect(r.body.error.message, q).toMatch(hint);
    }
    const r = await mcp(agent, "text", { record_id: s.record_id, length: 10 });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(hint);
  });

  it("name the filter dimensions gave way to: tags on sources, tag on assumptions", async () => {
    const sources = await alice.api("GET", `${P}/sources?customer=example`);
    expect(sources.body.error.message).toMatch(/no dimensions .* any more: .* with tags, and filter by `tags`\.$/);
    const assumptions = await alice.api("GET", `${P}/assumptions?customer=example`);
    expect(assumptions.body.error.message).toMatch(/no dimensions .* any more: .* with tags, and filter by `tag`\.$/);
  });
});

describe("numbers in what derived says", () => {
  it("are written with separators, in its refusals and its descriptions", async () => {
    const s = await source("Long notes — Example Co");
    const long = await note(s.record_id, "notes", { content: "x".repeat(100_001) });
    expect(long.status).toBe(422);
    expect(long.body.error.message).toMatch(/^`content`: a summary or notes hold at most 100,000 characters\./);
    const window = await alice.api("GET", `${P}/sources/${s.record_id}/derived/text?limit=20001`);
    expect(window.body.error.message).toMatch(/^`limit`: at most 20,000 characters a call\./);
    const tooLong = await text(s.record_id, { content: "x".repeat(2_000_001) });
    expect(tooLong.body.error).toMatchObject({ code: "too_long", message: expect.stringMatching(/^A derived text written here holds at most 2,000,000 characters; this one has 2,000,001\./) });
    expect(OPERATIONS_BY_NAME.get("derived.text")!.summary).toContain("at most 20,000 characters");
    expect(OPERATIONS_BY_NAME.get("derived.write_text")!.description).toContain("up to 2,000,000 characters");
    expect(OPERATIONS_BY_NAME.get("derived.write_note")!.description).toContain("up to 100,000 characters");
    for (const name of ["derived.text", "derived.write_text", "derived.write_note"]) {
      const op = OPERATIONS_BY_NAME.get(name)!;
      expect(`${op.summary} ${op.description}`, name).not.toMatch(/\d{5}/);
    }
  });

  it("say what derived text returns: the source's words, not its title, tags, summary or notes", () => {
    const d = OPERATIONS_BY_NAME.get("derived.text")!.description;
    expect(d).toMatch(/^The derived text is the source's words alone, as one Markdown document\. Search reads it beside the source's title, tags, summary, notes and comments, none of which this returns/);
    expect(d).toMatch(/etag \(the one write_text takes\)/);
  });
});

describe("the migration that gives summaries and notes etags", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  let client: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: inject("appUrlTemplate").replace("{db}", name) });
    await client.connect();
  });
  afterAll(async () => client?.end());

  it("gives every summary and note an etag of its own, here and in saved sandbox baselines, and keeps the table's row-level security", async () => {
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0031_summaries_and_notes_have_etags.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    await client.query(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1)`, [actor]);
    await client.query(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'core', 'Core', $1)`, [actor]);
    await client.query(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('P1', 'T1', 'M1', 'crew', 'Crew', 'e', $1, $1)`, [actor]);
    for (const id of ["R1", "R2"])
      await client.query(`insert into records (record_id, tenant_id, team_id, product_id, title, tags, slug, etag, uploaded_by, updated_by) values ($1, 'T1', 'M1', 'P1', $1, '{}', $1, 'e', $2, $2)`, [id, actor]);
    for (const [record, kind] of [["R1", "summary"], ["R1", "notes"], ["R2", "summary"]])
      await client.query(`insert into agent_notes (record_id, kind, tenant_id, content, updated_by) values ($1, $2, 'T1', $3, $4)`, [record, kind, `The ${kind} of ${record}.`, actor]);
    await client.query(`insert into sandbox_baselines (baseline_id, tenant_id, counts, created_by) values ('B1', 'T1', '{"agent_notes": 3}', $1)`, [actor]);
    await client.query(`insert into sandbox_baseline_rows (baseline_id, tenant_id, table_name, row) select 'B1', 'T1', 'agent_notes', to_jsonb(n) from agent_notes n`);
    await client.query("commit");

    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));

    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    const live = (await client.query<{ record_id: string; kind: string; content: string; etag: string }>("select record_id, kind, content, etag from agent_notes order by record_id, kind")).rows;
    expect(live.map((n) => [n.record_id, n.kind, n.content])).toEqual([
      ["R1", "notes", "The notes of R1."],
      ["R1", "summary", "The summary of R1."],
      ["R2", "summary", "The summary of R2."],
    ]);
    for (const n of live) expect(n.etag).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(live.map((n) => n.etag)).size).toBe(3);
    // A reset puts each saved note back with the etag the baseline holds for it.
    const saved = (await client.query<{ row: Record<string, string> }>("select row from sandbox_baseline_rows where table_name = 'agent_notes'")).rows.map((r) => r.row);
    expect(saved).toHaveLength(3);
    for (const r of saved) expect(r["etag"]).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(saved.map((r) => r["etag"])).size).toBe(3);
    // A row written without one still gets one.
    await client.query(`insert into records (record_id, tenant_id, team_id, product_id, title, tags, slug, etag, uploaded_by, updated_by) values ('R3', 'T1', 'M1', 'P1', 'R3', '{}', 'R3', 'e', $1, $1)`, [actor]);
    await client.query(`insert into agent_notes (record_id, kind, tenant_id, content, updated_by) values ('R3', 'summary', 'T1', 'Later.', $1)`, [actor]);
    expect((await client.query("select etag from agent_notes where record_id = 'R3'")).rows[0].etag).toMatch(/^[0-9a-f]{32}$/);
    await client.query("commit");

    const rls = await client.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'agent_notes'");
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await client.query("select polname from pg_policy where polrelid = 'agent_notes'::regclass");
    expect(policies.rows).toEqual([{ polname: "tenant_isolation" }]);
    // Outside a tenant, the rows stay hidden.
    expect((await client.query("select count(*)::int as n from agent_notes")).rows[0].n).toBe(0);
  });
});
