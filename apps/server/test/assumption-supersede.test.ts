import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Correcting an assumption with supersede records a review of the old entry. Who judged it
// superseded is declared as in review: a person's correction an agent relays is the person's.

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;
let productPath: string;
let client: Client;

/** A tool's answer: its JSON, or the status its error text begins with. */
function result(r: unknown): { status: number; json: any } {
  const t = (r as { content: { text: string }[] }).content[0]!.text;
  if (t.startsWith("{")) return { status: 200, json: JSON.parse(t) };
  return { status: Number(t.slice(0, 3)), json: JSON.parse(t.slice(t.indexOf("\n") + 1)) };
}

async function entry(statement: string) {
  const r = await alice.api("POST", `${P}/assumptions`, { statement, body: "The visit notes say so." });
  expect(r.status).toBe(201);
  return r.body as { id: string; etag: string };
}

const supersedeOverMcp = (params: Record<string, unknown>) => client.callTool({ name: "assumptions_write", arguments: { action: "supersede", product: productPath, params } });
const latestReview = async (id: string) => (await alice.api("GET", `${P}/assumptions/${id}`)).body.reviews[0];
const supersededSummaries = async (id: string) =>
  (await alice.api("GET", `${P}/activity?entity_id=${id}`)).body.items.filter((i: { action: string }) => i.action === "superseded").map((i: { summary: string }) => i.summary);

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  vic = await h.signIn("vic@example.com", "Vic Viewer");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Correction Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Planner" });
  productPath = p.body.path;
  P = `/api/v1/p/${productPath}`;
  expect((await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, product: "planner", email: "vic@example.com", role: "viewer" })).status).toBe(201);
  client = new Client({ name: "correcting-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(alice, "Correcting agent", "/mcp", "editor")}` } } }));
});
afterAll(async () => {
  await client?.close();
  await h?.close();
});

describe("who judged an assumption superseded", () => {
  it("is the person when an agent relays their correction and says so", async () => {
    const old = await entry("Crews plan on Sundays.");
    const r = result(await supersedeOverMcp({ id: old.id, expected_etag: old.etag, note: "The person said crews plan on Fridays.", reviewer_type: "human", author_type: "human", statement: "Crews plan on Fridays." }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.entry).toMatchObject({ statement: "Crews plan on Fridays.", author_type: "human" });
    expect(await latestReview(old.id)).toMatchObject({ status: "superseded", note: "The person said crews plan on Fridays.", reviewer_type: "human", confidence: null });
    expect(await supersededSummaries(old.id)).toEqual(["Superseded by a corrected entry"]);
  });

  it("is the agent when it says nothing, as in review", async () => {
    const old = await entry("Crews plan on paper.");
    const r = result(await supersedeOverMcp({ id: old.id, expected_etag: old.etag, note: "The calls show a spreadsheet.", statement: "Crews plan in a spreadsheet." }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.entry.author_type).toBe("agent");
    expect(await latestReview(old.id)).toMatchObject({ status: "superseded", reviewer_type: "agent" });
    expect(await supersededSummaries(old.id)).toEqual(["Superseded by a corrected entry (agent review)"]);
  });

  it("is the person in the web app unless they say otherwise", async () => {
    const old = await entry("Crews plan alone.");
    const r = await alice.api("POST", `${P}/assumptions/${old.id}/supersede`, { expected_etag: old.etag, note: "They plan with the office.", statement: "Crews plan with the office." });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await latestReview(old.id)).toMatchObject({ reviewer_type: "human" });
    const other = await entry("Crews plan weekly.");
    const relayed = await alice.api("POST", `${P}/assumptions/${other.id}/supersede`, { expected_etag: other.etag, note: "An agent's reading.", reviewer_type: "agent", statement: "Crews plan daily." });
    expect(relayed.status).toBe(200);
    expect(await latestReview(other.id)).toMatchObject({ reviewer_type: "agent" });
  });

  it("refuses a reviewer_type that is neither, a stale etag, and a viewer, changing nothing", async () => {
    const old = await entry("Crews plan monthly.");
    const odd = await alice.api("POST", `${P}/assumptions/${old.id}/supersede`, { expected_etag: old.etag, note: "x", reviewer_type: "robot", statement: "Crews plan weekly." });
    expect(odd.status).toBe(422);
    const stale = await alice.api("POST", `${P}/assumptions/${old.id}/supersede`, { expected_etag: "stale", note: "x", reviewer_type: "human", statement: "Crews plan weekly." });
    expect(stale.status).toBe(409);
    const viewer = await vic.api("POST", `${P}/assumptions/${old.id}/supersede`, { expected_etag: old.etag, note: "x", reviewer_type: "human", statement: "Crews plan weekly." });
    expect(viewer.status).toBe(403);
    const after = await alice.api("GET", `${P}/assumptions/${old.id}`);
    expect(after.body).toMatchObject({ status: "unconfirmed", review_count: 0, etag: old.etag });
  });

  it("is described in supersede's guidance", async () => {
    const r = await client.callTool({ name: "assumptions_write", arguments: { action: "supersede", describe: true } });
    const text = (r as { content: { text: string }[] }).content[0]!.text;
    expect(text).toContain("reviewer_type says who judged the old entry superseded, as in review");
    expect(text).toContain('"reviewer_type"');
  });
});
