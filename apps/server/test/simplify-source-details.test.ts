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

describe("sources without participants, source system or provenance", () => {
  it("returns none of them, and refuses them with a hint that a source is its title, date and tags", async () => {
    const created = await alice.api("POST", `${P}/sources`, { title: "Interview — Example Co", tags: ["interview", "example co"] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    for (const k of ["participants", "source_system", "provenance_depth"]) expect(created.body).not.toHaveProperty(k);
    const full = await alice.api("GET", `${P}/sources/${created.body.record_id}?detail=full`);
    for (const k of ["participants", "source_system", "provenance_depth", "outline"]) expect(full.body).not.toHaveProperty(k);
    const assumption = await alice.api("POST", `${P}/assumptions`, { statement: "Crew leads plan the week on Sunday evening." });
    expect(assumption.status, JSON.stringify(assumption.body)).toBe(201);
    expect(assumption.body).not.toHaveProperty("provenance_depth");

    const refusals = [
      await alice.api("POST", `${P}/sources`, { title: "Interview — Example Co", participants: ["Dana"] }),
      await alice.api("PATCH", `${P}/sources/${created.body.record_id}`, { expected_etag: created.body.etag, source_system: "a meeting tool" }),
      await alice.api("GET", `${P}/sources?provenance_depth=primary`),
      await alice.api("GET", `${P}/search?query=week&provenance_depth=primary`),
      await alice.api("POST", `${P}/assumptions`, { statement: "Crew leads plan the week on Sunday evening.", provenance_depth: "derived" }),
    ];
    for (const r of refusals) {
      expect(r.status).toBe(422);
      expect(r.body.error.message).toMatch(/no participants, source system or provenance, .* any more: a source is described by its title, date and tags/);
    }
  });

  it("keeps a summary and notes that people write and clear, and no outline", async () => {
    const created = await alice.api("POST", `${P}/sources`, { title: "Workshop — Example Co", tags: ["workshop"] });
    const id = created.body.record_id as string;
    const summary = await alice.api("PUT", `${P}/sources/${id}/agent-notes/summary`, { content: "Crews plan by the week." });
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    expect((await alice.api("GET", `${P}/sources/${id}/agent-notes/summary`)).body).toMatchObject({ content: "Crews plan by the week.", updated_by: { display_name: "Alice Example", surface: "web" } });
    expect((await alice.api("PUT", `${P}/sources/${id}/agent-notes/notes`, { content: "## Follow up\n\n- Ask about Fridays." })).status).toBe(200);
    const outline = await alice.api("PUT", `${P}/sources/${id}/agent-notes/outline`, { content: "- ¶1" });
    expect(outline.status).toBe(422);
    expect((await alice.api("GET", `${P}/sources/${id}/derived/outline`)).status).toBe(404);

    const cleared = await alice.api("PUT", `${P}/sources/${id}/agent-notes/summary`, { content: "  ", expected_etag: summary.body.etag });
    expect(cleared.status).toBe(200);
    expect((await alice.api("GET", `${P}/sources/${id}/agent-notes/summary`)).status).toBe(404);
    const full = await alice.api("GET", `${P}/sources/${id}?detail=full`);
    expect(full.body.agent_notes.map((n: { kind: string }) => n.kind)).toEqual(["notes"]);
    const log = await alice.api("GET", `${P}/activity?entity_id=${id}`);
    expect(log.body.items.filter((i: { action: string }) => i.action === "agent_note_written").map((i: { summary: string }) => i.summary)).toEqual([
      "Cleared the summary",
      "Wrote the notes",
      "Wrote the summary",
    ]);
  });
});

describe("the migration that simplifies a source's details", () => {
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

  it("drops participants, source system, provenance, comment anchors and agent outlines, here and in saved sandbox baselines", async () => {
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0029_simplify_source_details.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    await client.query(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1)`, [actor]);
    await client.query(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'core', 'Core', $1)`, [actor]);
    await client.query(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('P1', 'T1', 'M1', 'crew', 'Crew', 'e', $1, $1)`, [actor]);
    await client.query(
      `insert into records (record_id, tenant_id, team_id, product_id, title, tags, participants, source_system, provenance_depth, slug, etag, uploaded_by, updated_by)
       values ('R1', 'T1', 'M1', 'P1', 'R1', $1, $2, 'a meeting tool', 'primary', 'R1', 'e', $3, $3)`,
      [["interview"], ["Dana (crew lead)"], actor],
    );
    await client.query(
      `insert into register_entries (entry_id, tenant_id, product_id, kind, statement, tags, provenance_depth, author, author_type, etag, updated_by)
       values ('A1', 'T1', 'P1', 'assumption', 'A1', $1, 'derived', $2, 'human', 'e', $2)`,
      [["planning"], actor],
    );
    await client.query(
      `insert into annotations (annotation_id, tenant_id, product_id, record_id, seq_start, seq_end, note, anchor, etag, created_by, updated_by)
       values ('N1', 'T1', 'P1', 'R1', 0, 2, 'Friday is set by the close.', $1, 'e', $2, $2)`,
      [JSON.stringify({ seq_start: 0, seq_end: 2, quote: "Dana: We export everything." }), actor],
    );
    for (const kind of ["summary", "outline", "notes"])
      await client.query(`insert into agent_notes (record_id, kind, tenant_id, content, updated_by) values ('R1', $1, 'T1', $2, $3)`, [kind, `The ${kind}.`, actor]);
    await client.query(`insert into sandbox_baselines (baseline_id, tenant_id, counts, created_by) values ('B1', 'T1', '{}', $1)`, [actor]);
    await client.query(
      `insert into sandbox_baseline_rows (baseline_id, tenant_id, table_name, row)
       select 'B1', 'T1', 'records', to_jsonb(r) from records r
       union all select 'B1', 'T1', 'register_entries', to_jsonb(e) from register_entries e
       union all select 'B1', 'T1', 'annotations', to_jsonb(a) from annotations a
       union all select 'B1', 'T1', 'agent_notes', to_jsonb(n) from agent_notes n`,
    );
    await client.query("commit");

    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));

    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    expect((await client.query("select title, tags from records")).rows).toEqual([{ title: "R1", tags: ["interview"] }]);
    expect((await client.query("select tags from register_entries")).rows).toEqual([{ tags: ["planning"] }]);
    expect((await client.query("select note from annotations")).rows).toEqual([{ note: "Friday is set by the close." }]);
    expect((await client.query("select kind from agent_notes order by kind")).rows).toEqual([{ kind: "notes" }, { kind: "summary" }]);
    await expect(client.query(`insert into agent_notes (record_id, kind, tenant_id, content, updated_by) values ('R1', 'outline', 'T1', 'x', $1)`, [actor])).rejects.toThrow(/agent_notes_kind_check/);
    await client.query("rollback");

    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    const columns = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where (table_name = 'records' and column_name in ('participants', 'source_system', 'provenance_depth'))
          or (table_name = 'register_entries' and column_name = 'provenance_depth')
          or (table_name = 'annotations' and column_name in ('seq_start', 'seq_end', 'anchor'))`,
    );
    expect(columns.rows).toEqual([]);
    const saved = await client.query<{ table_name: string; row: Record<string, unknown> }>("select table_name, row from sandbox_baseline_rows where baseline_id = 'B1' order by table_name, row->>'kind'");
    expect(saved.rows.map((r) => [r.table_name, r.row["kind"] ?? null])).toEqual([
      ["agent_notes", "notes"],
      ["agent_notes", "summary"],
      ["annotations", null],
      ["records", null],
      ["register_entries", "assumption"],
    ]);
    for (const k of ["participants", "source_system", "provenance_depth", "seq_start", "seq_end", "anchor"]) for (const r of saved.rows) expect(r.row).not.toHaveProperty(k);
    expect(saved.rows.find((r) => r.table_name === "annotations")!.row["note"]).toBe("Friday is set by the close.");
    await client.query("commit");
  });
});
