import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Postgres keeps no null character (U+0000) in text. A call that sends one in any string is
// refused where every operation's input is checked, naming the field, whichever door it came
// through, and nothing strips it. Before, it reached the database and answered 500.

let h: Harness;
let alice: Browser;
let P: string;
let path: string;
let client: Client;

function result(r: unknown): { status: number; json: any } {
  const t = (r as { content: { text: string }[] }).content[0]!.text;
  if (t.startsWith("{")) return { status: 200, json: JSON.parse(t) };
  return { status: Number(t.slice(0, 3)), json: JSON.parse(t.slice(t.indexOf("\n") + 1)) };
}

/** A refusal naming these fields. */
const refusesNul = (body: { error: { code: string; message: string; details?: { fields?: string[] } } }, ...fields: string[]) => {
  expect(body.error.code, JSON.stringify(body)).toBe("invalid_input");
  for (const f of fields) expect(body.error.message).toContain(`\`${f}\``);
  expect(body.error.message).toContain("null character (U+0000)");
  expect(body.error.message).toContain("Nothing was changed");
  expect(body.error.details?.fields).toEqual(fields);
};

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@nul.example", "Alice Nul");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Nul Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Gate" });
  path = p.body.path;
  P = `/api/v1/p/${path}`;
  const s = await alice.api("POST", `${P}/sources`, { title: "Gate notes — Example Co", tags: ["notes"] });
  expect((await alice.api("PUT", `${P}/sources/${s.body.record_id}/derived/text`, { content: "The gate opens at nine.\n" })).status).toBe(200);
  client = new Client({ name: "nul-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(alice)}` } } }));
});
afterAll(async () => {
  await client?.close();
  await h?.close();
});

describe("a null character over REST", () => {
  it("in the query string is refused by name, in search, lists and cursors", async () => {
    for (const [url, field] of [
      [`${P}/search?query=ga%00te`, "query"],
      [`${P}/search?query=ga%00te&mode=ranked`, "query"],
      [`${P}/sources?query=ga%00te`, "query"],
      [`${P}/sources?cursor=x%00`, "cursor"],
      [`${P}/activity?cursor=01%00`, "cursor"],
      [`${P}/assumptions?tag=a%00b`, "tag"],
    ] as const) {
      const r = await alice.api("GET", url);
      expect(r.status, url).toBe(422);
      refusesNul(r.body, field);
    }
  });

  it("in the path is refused by name, the product's own address included", async () => {
    const id = await alice.api("GET", `${P}/assumptions/ab%00c`);
    expect(id.status).toBe(422);
    refusesNul(id.body, "id");
    const [tenant, team, product] = path.split("/");
    const scoped = await alice.api("GET", `/api/v1/p/${tenant}/${team}/${product}%00/sources`);
    expect(scoped.status).toBe(422);
    refusesNul(scoped.body, "product");
    const members = await alice.api("GET", `/api/v1/tenants/${tenant}%00/members`);
    expect(members.status).toBe(422);
    refusesNul(members.body, "tenant");
  });

  it("in the body is refused by name, however deep, and changes nothing", async () => {
    const outcome = await alice.api("POST", `${P}/outcomes`, { title: "Open the\u0000 gate" });
    expect(outcome.status).toBe(422);
    refusesNul(outcome.body, "title");
    const assumption = await alice.api("POST", `${P}/assumptions`, { statement: "Crews open the gate.", tags: ["gate", "ni\u0000ne"], body: "\u0000" });
    expect(assumption.status).toBe(422);
    refusesNul(assumption.body, "tags.1", "body");
    expect((await alice.api("GET", `${P}/outcomes`)).body.items).toEqual([]);
    expect((await alice.api("GET", `${P}/assumptions`)).body.items).toEqual([]);
  });

  it("is named beside the schema's own refusals, and left to them for a field they already refuse", async () => {
    const r = await alice.api("POST", `${P}/outcomes`, { title: "Gate\u0000", colour: "red" });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/^`colour` is not a field of this action\. `title` holds a null character/);
    const id = await alice.api("GET", `${P}/sources/01%00`);
    expect(id.body.error.message).toContain("must be a source id");
    expect(id.body.error.message).not.toContain("null character");
  });
});

describe("a null character over MCP", () => {
  it("in an action's params, a standalone tool's arguments or the product is refused by name", async () => {
    const search = result(await client.callTool({ name: "search", arguments: { product: path, query: "ga\u0000te" } }));
    expect(search.status).toBe(422);
    refusesNul(search.json, "query");
    const list = result(await client.callTool({ name: "sources", arguments: { action: "list", product: path, params: { cursor: "x\u0000" } } }));
    expect(list.status).toBe(422);
    refusesNul(list.json, "cursor");
    const activity = result(await client.callTool({ name: "activity", arguments: { action: "list", product: path, params: { cursor: "01\u0000" } } }));
    expect(activity.status).toBe(422);
    refusesNul(activity.json, "cursor");
    const product = result(await client.callTool({ name: "outcomes", arguments: { action: "list", product: `${path}\u0000` } }));
    expect(product.status).toBe(422);
    refusesNul(product.json, "product");
    // What the person reaches is still found, and searched, without one.
    const ok = result(await client.callTool({ name: "search", arguments: { product: path, query: "gate" } }));
    expect(ok.status).toBe(200);
    expect(ok.json.hits.length).toBeGreaterThan(0);
  });
});
