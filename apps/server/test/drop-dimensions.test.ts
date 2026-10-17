import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { startHarness, type Browser, type Harness } from "./harness.ts";

let h: Harness;
let alice: Browser;
let P: string;

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Example Research" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Scheduling" });
  P = `/api/v1/p/${p.body.path}`;
});
afterAll(async () => h?.close());

describe("sources and assumptions without dimensions", () => {
  it("returns no dimensions, and refuses them and their filters with a hint to use tags", async () => {
    const created = await alice.api("POST", `${P}/sources`, { title: "Interview — Example Co", tags: ["interview", "example co"] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).not.toHaveProperty("dimensions");
    const assumption = await alice.api("POST", `${P}/assumptions`, { statement: "Crew leads plan the week on Sunday evening." });
    expect(assumption.status, JSON.stringify(assumption.body)).toBe(201);
    expect(assumption.body).not.toHaveProperty("dimensions");

    const refusals = [
      await alice.api("POST", `${P}/sources`, { title: "Interview — Example Co", dimensions: { customer: "Example Co" } }),
      await alice.api("PATCH", `${P}/sources/${created.body.record_id}`, { expected_etag: created.body.etag, dimensions: { lifecycle_stage: "discovery" } }),
      await alice.api("GET", `${P}/sources?customer=example%20co`),
      await alice.api("GET", `${P}/search?query=week&lifecycle_stage=discovery`),
      await alice.api("POST", `${P}/assumptions`, { statement: "Crew leads plan the week on Sunday evening.", dimensions: { product_area: "planning" } }),
    ];
    for (const r of refusals) {
      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(/no dimensions .* any more: .* with tags/);
    }
    // Elsewhere an unknown field gets no such hint.
    const other = await alice.api("POST", `${P}/outcomes`, { title: "An outcome", customer: "x" });
    expect(other.status).toBe(422);
    expect(other.body.error.message).not.toMatch(/dimensions/);
  });
});

describe("the migration that drops dimensions", () => {
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

  it("drops the dimensions of sources, register entries and saved sandbox baselines, and leaves tags as they were", async () => {
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0027_drop_dimensions.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    await client.query(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1)`, [actor]);
    await client.query(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'core', 'Core', $1)`, [actor]);
    await client.query(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('P1', 'T1', 'M1', 'crew', 'Crew', 'e', $1, $1)`, [actor]);
    await client.query(
      `insert into records (record_id, tenant_id, team_id, product_id, title, tags, dimensions, slug, etag, uploaded_by, updated_by)
       values ('R1', 'T1', 'M1', 'P1', 'R1', $1, $2, 'R1', 'e', $3, $3)`,
      [["interview"], JSON.stringify({ customer: "fernside cleaning", lifecycle_stage: "discovery" }), actor],
    );
    await client.query(
      `insert into register_entries (entry_id, tenant_id, product_id, kind, statement, citations, tags, dimensions, author, author_type, etag, updated_by)
       values ('A1', 'T1', 'P1', 'assumption', 'A1', '[]', $1, $2, $3, 'human', 'e', $3)`,
      [["planning"], JSON.stringify({ product_area: "planning" }), actor],
    );
    await client.query(`insert into sandbox_baselines (baseline_id, tenant_id, counts, created_by) values ('B1', 'T1', '{}', $1)`, [actor]);
    await client.query(
      `insert into sandbox_baseline_rows (baseline_id, tenant_id, table_name, row)
       select 'B1', 'T1', 'records', to_jsonb(r) from records r
       union all select 'B1', 'T1', 'register_entries', to_jsonb(e) from register_entries e`,
    );
    await client.query("commit");

    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));

    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    expect((await client.query("select tags from records")).rows).toEqual([{ tags: ["interview"] }]);
    expect((await client.query("select tags from register_entries")).rows).toEqual([{ tags: ["planning"] }]);
    const columns = await client.query("select table_name from information_schema.columns where table_name in ('records', 'register_entries') and column_name = 'dimensions'");
    expect(columns.rows).toEqual([]);
    const saved = await client.query<{ table_name: string; row: Record<string, unknown> }>("select table_name, row from sandbox_baseline_rows where baseline_id = 'B1' order by table_name");
    expect(saved.rows.map((r) => [r.table_name, r.row["tags"]])).toEqual([
      ["records", ["interview"]],
      ["register_entries", ["planning"]],
    ]);
    for (const r of saved.rows) expect(r.row).not.toHaveProperty("dimensions");
    await client.query("commit");
  });
});
