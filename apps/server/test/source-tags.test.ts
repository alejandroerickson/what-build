import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let vic: Browser;
let P: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Research" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Scheduling" });
  P = `/api/v1/p/${p.body.path}`;
  vic = await h.signIn("vic@example.com", "Vic Example");
  const g = await alice.api("POST", `/api/v1/tenants/${t.body.tenant.slug}/members`, { team: t.body.team.slug, email: "vic@example.com", role: "editor" });
  expect(g.status).toBe(201);
});
afterAll(async () => h?.close());

async function make(who: Browser, title: string, tags: string[]) {
  const r = await who.api("POST", `${P}/sources`, { title, tags });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.record_id as string;
}

describe("describing sources with tags", () => {
  it("lists the tags in use, most used first, and who added sources; filters by tag, by who added and by when", async () => {
    const empty = await alice.api("GET", `${P}/sources/facets`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ sources: 0, tags: [], tags_truncated: false, added_by: [] });

    const a = await make(alice, "Workshop whiteboard — Example Co", ["Workshop", "example co"]);
    const b = await make(alice, "Support notes on Example Co", ["example co", "internal"]);
    const c = await make(vic, "Meeting transcript — Other Co", ["meeting", "other co"]);
    const archived = await make(vic, "Old deck", ["deck", "example co"]);
    await alice.api("POST", `${P}/sources/archive`, { record_ids: [archived] });

    const f = await alice.api("GET", `${P}/sources/facets`);
    expect(f.body.sources).toBe(3);
    expect(f.body.tags).toEqual([
      { tag: "example co", count: 2 },
      { tag: "internal", count: 1 },
      { tag: "meeting", count: 1 },
      { tag: "other co", count: 1 },
      { tag: "workshop", count: 1 },
    ]);
    expect(f.body.added_by.map((p: { display_name: string; count: number }) => [p.display_name, p.count])).toEqual([
      ["Alice Example", 2],
      ["Vic Example", 1],
    ]);
    const withArchived = await alice.api("GET", `${P}/sources/facets?include_archived=true`);
    expect(withArchived.body.tags[0]).toEqual({ tag: "example co", count: 3 });
    expect(withArchived.body.tags.map((t: { tag: string }) => t.tag)).toContain("deck");

    const ids = async (q: string) => (await alice.api("GET", `${P}/sources?${q}`)).body.records.map((r: { record_id: string }) => r.record_id).sort();
    expect(await ids("tags=example%20co")).toEqual([a, b].sort());
    expect(await ids("tags=EXAMPLE%20CO,internal")).toEqual([b]);
    const vicId = f.body.added_by.find((p: { display_name: string }) => p.display_name === "Vic Example").account_id;
    expect(await ids(`added_by=${vicId}`)).toEqual([c]);
    expect(await ids(`added_by=${vicId}&include_archived=true`)).toEqual([c, archived].sort());
    // Added since a moment: a day back finds them all; tomorrow, none.
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(await ids(`added_since=${encodeURIComponent(dayAgo)}`)).toEqual([a, b, c].sort());
    expect(await ids(`added_since=${tomorrow}`)).toEqual([]);
    // The metadata query matches titles and tags.
    expect(await ids("query=whiteboard")).toEqual([a]);
    expect(await ids("query=internal")).toEqual([b]);

    // A summary carries tags, and no kind, organization or folder.
    const got = await alice.api("GET", `${P}/sources/${a}`);
    expect(got.body.tags).toEqual(["workshop", "example co"]);
    for (const k of ["kind", "kind_label", "organization", "folder", "folder_label"]) expect(got.body).not.toHaveProperty(k);
  });

  it("refuses the retired kind and organization, and says to use tags", async () => {
    const created = await alice.api("POST", `${P}/sources`, { title: "Interview — Example Co", kind: "interview_transcript", organization: "Example Co" });
    expect(created.status).toBe(422);
    expect(created.body.error.message).toMatch(/^`kind` and `organization` are not fields of this action\./);
    expect(created.body.error.message).toMatch(/with tags/);
    const listed = await alice.api("GET", `${P}/sources?kind=interview_transcript`);
    expect(listed.status).toBe(422);
    expect(listed.body.error.message).toMatch(/with tags/);
    // Elsewhere an unknown field gets no such hint.
    const other = await alice.api("POST", `${P}/outcomes`, { title: "An outcome", kind: "x" });
    expect(other.status).toBe(422);
    expect(other.body.error.message).not.toMatch(/with tags/);
  });

  it("serves facets over MCP as a sources action, with no kinds action left", async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    const token = await h.connectAgent(alice);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const facets = await client.callTool({ name: "sources", arguments: { action: "facets", product: P.replace("/api/v1/p/", ""), params: {} } });
    expect(facets.isError).toBeFalsy();
    const t = (facets.content as { text: string }[])[0]!.text;
    expect(JSON.parse(t.slice(t.indexOf("{"))).tags.length).toBeGreaterThan(0);
    const kinds = await client.callTool({ name: "sources", arguments: { action: "kinds" } });
    expect(kinds.isError).toBe(true);
    expect((kinds.content as { text: string }[])[0]!.text).toMatch(/^422: Unknown sources action/);
    await client.close();
  });
});

describe("the migration that turns kinds and organizations into tags", () => {
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

  it("puts each kind and organization in front of the tags, once, rewrites saved sandbox baselines the same way, and keeps what older lineage fingerprinted", async () => {
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0017_sources_are_tagged.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    await client.query(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1)`, [actor]);
    await client.query(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'core', 'Core', $1)`, [actor]);
    await client.query(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('P1', 'T1', 'M1', 'crew', 'Crew', 'e', $1, $1)`, [actor]);
    const rows: [string, string, string | null, string[]][] = [
      ["R1", "interview_transcript", "  Fernside   Cleaning ", ["planning", "fernside cleaning"]],
      ["R2", "other", null, ["misc"]],
      ["R3", "analysis", null, ["insight", "draft"]],
      ["R4", "sales_call_recording", "Oak & Ash Grounds", []],
      ["R5", "deck", "", ["deck"]],
    ];
    for (const [id, kind, org, tags] of rows)
      await client.query(
        `insert into records (record_id, tenant_id, team_id, product_id, kind, title, organization, tags, folder, slug, etag, uploaded_by, updated_by)
         values ($1, 'T1', 'M1', 'P1', $2, $1, $3, $4, 'misc', $1, 'e', $5, $5)`,
        [id, kind, org, tags, actor],
      );
    // A view written before parts were stored, with one input written since.
    const inputs = [
      { kind: "record", id: "R1", fingerprint: "a".repeat(64) },
      { kind: "record", id: "R4", fingerprint: "b".repeat(64), parts: { title: "0123456789abcdef" } },
      { kind: "assumption", id: "A1", fingerprint: "c".repeat(64) },
    ];
    await client.query(`insert into lineage (record_id, tenant_id, product_id, inputs, query_spec, generated_by) values ('R5', 'T1', 'P1', $1, '{}', $2)`, [JSON.stringify(inputs), actor]);
    await client.query(`insert into sandbox_baselines (baseline_id, tenant_id, counts, created_by) values ('B1', 'T1', '{}', $1)`, [actor]);
    await client.query(
      `insert into sandbox_baseline_rows (baseline_id, tenant_id, table_name, row)
       select 'B1', 'T1', 'records', to_jsonb(r) from records r where record_id in ('R1', 'R4')
       union all select 'B1', 'T1', 'lineage', to_jsonb(l) from lineage l`,
    );
    await client.query("commit");

    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));

    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    const after = await client.query<{ record_id: string; tags: string[] }>("select record_id, tags from records order by record_id");
    expect(Object.fromEntries(after.rows.map((r) => [r.record_id, r.tags]))).toEqual({
      R1: ["interview", "fernside cleaning", "planning"],
      R2: ["misc"],
      R3: ["analysis", "insight", "draft"],
      R4: ["sales", "oak & ash grounds"],
      R5: ["deck"],
    });
    const columns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'records'");
    const names = columns.rows.map((c) => c.column_name);
    for (const gone of ["kind", "organization", "folder"]) expect(names).not.toContain(gone);
    const saved = await client.query<{ row: Record<string, unknown> }>("select row from sandbox_baseline_rows where baseline_id = 'B1' and table_name = 'records' and row->>'record_id' = 'R1'");
    expect(saved.rows[0]!.row["tags"]).toEqual(["interview", "fernside cleaning", "planning"]);
    for (const gone of ["kind", "organization", "folder"]) expect(saved.rows[0]!.row).not.toHaveProperty(gone);
    // Only the input checked whole keeps what it was fingerprinted with, live and in the baseline.
    const kept = [
      { ...inputs[0], was: { kind: "interview_transcript", organization: "  Fernside   Cleaning " } },
      inputs[1],
      inputs[2],
    ];
    const lineage = await client.query<{ inputs: unknown }>("select inputs from lineage where record_id = 'R5'");
    expect(lineage.rows[0]!.inputs).toEqual(kept);
    const savedLineage = await client.query<{ row: { inputs: unknown } }>("select row from sandbox_baseline_rows where baseline_id = 'B1' and table_name = 'lineage'");
    expect(savedLineage.rows[0]!.row.inputs).toEqual(kept);
    await client.query("commit");
  });
});
