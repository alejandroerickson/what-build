import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

describe("the migration that makes an outcome current or archived", () => {
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

  it("archives the archived ones as of their last change, makes achieved ones current, drops status, and rewrites saved sandbox baselines the same way", async () => {
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0023_outcomes_current_or_archived.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    await client.query(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1)`, [actor]);
    await client.query(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'core', 'Core', $1)`, [actor]);
    await client.query(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('P1', 'T1', 'M1', 'crew', 'Crew', 'e', $1, $1)`, [actor]);
    const rows: [string, string][] = [["O1", "active"], ["O2", "achieved"], ["O3", "archived"]];
    for (const [id, status] of rows)
      await client.query(
        `insert into outcomes (outcome_id, tenant_id, product_id, title, status, position, etag, created_by, updated_by, updated_at)
         values ($1, 'T1', 'P1', $1, $2, 1, 'e', $3, $3, '2026-09-01T12:00:00Z')`,
        [id, status, actor],
      );
    await client.query(`insert into sandbox_baselines (baseline_id, tenant_id, counts, created_by) values ('B1', 'T1', '{}', $1)`, [actor]);
    await client.query(`insert into sandbox_baseline_rows (baseline_id, tenant_id, table_name, row) select 'B1', 'T1', 'outcomes', to_jsonb(o) from outcomes o`);
    await client.query("commit");

    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));

    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    const after = await client.query<{ outcome_id: string; archived_at: Date | null }>("select outcome_id, archived_at from outcomes order by outcome_id");
    expect(Object.fromEntries(after.rows.map((r) => [r.outcome_id, r.archived_at?.toISOString() ?? null]))).toEqual({
      O1: null,
      O2: null,
      O3: "2026-09-01T12:00:00.000Z",
    });
    const columns = await client.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'outcomes'");
    expect(columns.rows.map((c) => c.column_name)).not.toContain("status");
    const saved = await client.query<{ row: Record<string, unknown> }>("select row from sandbox_baseline_rows where baseline_id = 'B1' and table_name = 'outcomes' order by row->>'outcome_id'");
    for (const r of saved.rows) expect(r.row).not.toHaveProperty("status");
    expect(saved.rows.map((r) => r.row["archived_at"] === null)).toEqual([true, true, false]);
    // A reset reads the saved rows back into the table, the archived one archived.
    const restored = await client.query<{ archived_at: Date | null }>(
      "select r.archived_at from sandbox_baseline_rows b cross join lateral jsonb_populate_record(null::outcomes, b.row) as r where b.table_name = 'outcomes' and b.row->>'outcome_id' = 'O3'",
    );
    expect(restored.rows[0]!.archived_at?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    await client.query("commit");
  });
});
