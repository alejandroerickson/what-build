import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { adviseSourceCard, inspectIdeaCard, SOURCE_CARD_EXAMPLES } from "@whatbuild/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOURCE_CARDS } from "../src/seed-content.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// A source's card is a picture of it that people tell it apart by: HTML in the Idea card kit, on a
// board of one size, kept beside the summary and notes with an etag of its own. It is checked as an
// Idea card's front is, served in the same sandbox, not searched, and named in the list by its etag.

let h: Harness;
let alice: Browser;
let rita: Browser;
let vic: Browser;
let P: string;
let product: string;

const CARD = `<style>.dots{display:grid;grid-template-columns:repeat(8,1fr);gap:12px;height:100%}.dots i{border-radius:50%;background:var(--hue-solid)}</style>
<div class="dots" data-hue="teal" aria-hidden="true"><i></i><i></i><i></i></div>`;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  rita = await h.signIn("rita@example.com", "Rita Reader");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Source Card Co" });
  const p = await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/products`, { name: "Pictured" });
  product = p.body.path;
  P = `/api/v1/p/${product}`;
  for (const [email, role] of [["rita@example.com", "story_reader"], ["vic@example.com", "viewer"]] as const)
    expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { product: "pictured", email, role })).status).toBe(201);
});
afterAll(async () => h?.close());

async function source(title: string) {
  const r = await alice.api("POST", `${P}/sources`, { title });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { record_id: string; etag: string };
}
const write = (id: string, body: Record<string, unknown>, who = alice) => who.api("PUT", `${P}/sources/${id}/agent-notes/card`, body);

describe("a source's card", () => {
  it("is written, read and replaced with its own etag, and the list names it by that etag", async () => {
    const s = await source("Crew lead survey, spring round");
    expect((await alice.api("GET", `${P}/sources/${s.record_id}/agent-notes/card`)).status).toBe(404);
    const first = await write(s.record_id, { content: CARD });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.chars).toBe(CARD.length);
    // No summary yet, which the advice says.
    expect(first.body.card_advice.some((a: string) => a.includes("no text summary"))).toBe(true);
    const read = await alice.api("GET", `${P}/sources/${s.record_id}/agent-notes/card`);
    expect(read.body.content).toBe(CARD);
    expect(read.body.etag).toBe(first.body.etag);
    // Replacing it takes its etag, not the source's.
    const stale = await write(s.record_id, { content: CARD, expected_etag: s.etag });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toContain("its card has its own");
    const second = await write(s.record_id, { content: `${CARD}<!-- again -->`, expected_etag: first.body.etag });
    expect(second.status).toBe(200);
    const listed = (await alice.api("GET", `${P}/sources?include_summary=true`)).body.records.find((r: { record_id: string }) => r.record_id === s.record_id);
    expect(listed.card_etag).toBe(second.body.etag);
    expect(listed.summary).toBeNull();
    expect(JSON.stringify(listed)).not.toContain("dots");
    // The full read lists it among the agent notes, with its etag.
    const full = (await alice.api("GET", `${P}/sources/${s.record_id}?detail=full`)).body;
    expect(full.agent_notes.map((n: { kind: string }) => n.kind)).toContain("card");
    // Cleared, it is gone.
    const cleared = await write(s.record_id, { content: "", expected_etag: second.body.etag });
    expect(cleared.body.etag).toBeNull();
    expect((await alice.api("GET", `${P}/sources?include_summary=true`)).body.records.find((r: { record_id: string }) => r.record_id === s.record_id).card_etag).toBeNull();
  });

  it("is refused for what an Idea card's front is refused for, listing every problem", async () => {
    const s = await source("A source with a bad card");
    const bad = await write(s.record_id, { content: '<script>alert(1)</script><a href="https://example.com">x</a><img src="https://example.com/a.png">' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("invalid_card");
    expect(bad.body.error.details.problems.length).toBeGreaterThanOrEqual(3);
    expect((await alice.api("GET", `${P}/sources/${s.record_id}/agent-notes/card`)).status).toBe(404);
  });

  it("says, when a summary is written with no card, that the source has none", async () => {
    const s = await source("A source with a summary only");
    const summary = await alice.api("PUT", `${P}/sources/${s.record_id}/agent-notes/summary`, { content: "What it says." });
    expect(summary.status).toBe(200);
    expect(summary.body.note).toContain("no card yet");
    await write(s.record_id, { content: CARD });
    const again = await alice.api("PUT", `${P}/sources/${s.record_id}/agent-notes/summary`, { content: "What it says now.", expected_etag: summary.body.etag });
    expect(again.body).not.toHaveProperty("note");
  });

  it("is served on its board, in the card kit's sandbox, to a viewer and not to a Story reader", async () => {
    const s = await source("Owner call, autumn");
    await write(s.record_id, { content: CARD });
    const card = await vic.api("GET", `${P}/sources/${s.record_id}/card?theme=dark`);
    expect(card.status).toBe(200);
    expect(card.body).toContain(CARD);
    expect(card.body).toContain("<title>Owner call, autumn</title>");
    expect(card.body).toContain("width:640px;height:480px;overflow:hidden");
    expect(card.body).toContain('data-wb-theme="dark"');
    expect(card.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect((await rita.api("GET", `${P}/sources/${s.record_id}/card`)).status).toBe(403);
    const none = await source("No card");
    expect((await vic.api("GET", `${P}/sources/${none.record_id}/card`)).status).toBe(404);
  });

  it("is not searched: its words are the summary's", async () => {
    const s = await source("A source with a card");
    await write(s.record_id, { content: `<p style="font-size:60px">quixotical</p>` });
    const found = await alice.api("GET", `${P}/search?query=quixotical`);
    expect(found.status).toBe(200);
    expect(JSON.stringify(found.body)).not.toContain(s.record_id);
  });

});

describe("a source card's preview", () => {
  it("checks a card as a write would, writes nothing, and gives a grant to the card on its board", async () => {
    const s = await source("Previewed");
    const bad = await alice.api("POST", `${P}/sources/${s.record_id}/card-preview`, { card_html: "<script>alert(1)</script>" });
    expect(bad.status).toBe(422);
    const r = await alice.api("POST", `${P}/sources/${s.record_id}/card-preview`, { card_html: CARD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.written).toBe(false);
    expect(r.body.frame).toMatchObject({ width: 640, height: 480 });
    const doc = await fetch(`${r.body.preview.url}?theme=light`, { headers: r.body.preview.headers });
    expect(doc.status).toBe(200);
    const html = await doc.text();
    expect(html).toContain(CARD);
    expect(html).toContain("width:640px;height:480px");
    expect(html).not.toContain("data-limit=");
    expect((await alice.api("GET", `${P}/sources/${s.record_id}/agent-notes/card`)).status).toBe(404);
    expect((await vic.api("POST", `${P}/sources/${s.record_id}/card-preview`, { card_html: CARD })).status).toBe(403);
  });

  it("gives guidance, and every drawn card in it and in the sample product passes with no advice", async () => {
    const g = (await vic.api("GET", `${P}/evidence/card-guidance`)).body;
    expect(g.guidance).toContain("memory hook");
    expect(g.frame).toMatchObject({ width: 640, height: 480 });
    expect(g.icons.length).toBeGreaterThan(10);
    for (const [name, card] of [...Object.entries(SOURCE_CARD_EXAMPLES), ...Object.entries(SOURCE_CARDS)]) {
      expect(inspectIdeaCard(card), name).toEqual([]);
      expect(adviseSourceCard({ front: card, title: "A source", summary: "What it says." }), name).toEqual([]);
    }
  });

  it("advises on what the guidance asks and a card misses", () => {
    const advice = adviseSourceCard({ front: `<p style="color:#c00">${"A long sentence about the call. ".repeat(10)} Owner interview, Oak and Ash</p>`, title: "Owner interview, Oak and Ash", summary: null });
    expect(advice.some((a) => a.includes("words"))).toBe(true);
    expect(advice.some((a) => a.includes("repeats the source's title"))).toBe(true);
    expect(advice.some((a) => a.includes("fixed colours"))).toBe(true);
    expect(advice.some((a) => a.includes("no text summary"))).toBe(true);
    expect(adviseSourceCard({ front: "<p>Just words</p>" }).some((a) => a.includes("no drawing"))).toBe(true);
  });
});

describe("an agent", () => {
  it("writes a card and reads the guidance through the derived tools", async () => {
    const token = await h.connectAgent(alice, "card-agent", undefined, "editor");
    const client = new Client({ name: "card-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const call = async (name: string, action: string, params: Record<string, unknown>) =>
      JSON.parse(((await client.callTool({ name, arguments: { action, product, params } })).content as { text: string }[])[0]!.text);
    const s = await source("Written by an agent");
    expect((await call("derived_read", "card_guidance", {})).guidance).toContain("Drawing a source's card");
    const preview = await call("derived_read", "card_preview", { record_id: s.record_id, card_html: CARD });
    expect(preview.preview.url).toContain(h.config.contentUrl ? "/documents/" : "/card-preview/");
    const written = await call("derived_write", "write_note", { record_id: s.record_id, note_kind: "card", content: CARD });
    expect(written.chars).toBe(CARD.length);
    await client.close();
  });
});
