import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

/** The text a citation's quote becomes in an assumption's body: one line, at most 500 characters. */
const line = (quote: string, title: string) => {
  const q = quote.replace(/\s+/g, " ").trim();
  return `- “${q.length > 500 ? `${q.slice(0, 499).trimEnd()}…` : q}” (${title})`;
};

describe("the migration that retires citations, refs, lineage and related sources", () => {
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

  it("writes each assumption's cited quotes into its body, live and in saved baselines, and drops the rest", async () => {
    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0028_citations_refs_and_lineage_retired.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    const cite = (record_id: string, quote: string) => ({ record_id, seq_start: 1, seq_end: 2, quote, derivation_id: "D", file_version_id: "F" });
    const long = "the week ".repeat(70);
    const citations = {
      A1: [cite("R1", "Two hours\n  if nothing's weird."), cite("X1", long), cite("R9", "Gone without a trace.")],
      A3: [cite("R2", "By the day, if I'm honest.")],
      E1: [cite("R1", "We decided on Fridays.")],
    };
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    await client.query(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1)`, [actor]);
    await client.query(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'core', 'Core', $1)`, [actor]);
    await client.query(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('P1', 'T1', 'M1', 'crew', 'Crew', 'e', $1, $1)`, [actor]);
    for (const [id, title, related] of [["R1", "Crew lead interview — Greenline, Aug 2026", ["R2"]], ["R2", "Owner interview — Oak & Ash, Aug 2026", []]] as const)
      await client.query(
        `insert into records (record_id, tenant_id, team_id, product_id, title, related_records, slug, etag, uploaded_by, updated_by)
         values ($1, 'T1', 'M1', 'P1', $2, $3, $1, 'e', $4, $4)`,
        [id, title, related, actor],
      );
    await client.query(`insert into tombstones (tenant_id, product_id, object_type, object_id, title, reason, deleted_by) values ('T1', 'P1', 'source', 'X1', 'Spring survey export', 'Duplicate', $1)`, [actor]);
    const entries: [string, string, string, unknown[]][] = [
      ["A1", "assumption", "Leads plan by the job.\n\n", citations.A1],
      ["A2", "assumption", "Nothing cited.", []],
      ["A3", "assumption", "", citations.A3],
      ["E1", "decision", "Plans close on Friday.", citations.E1],
    ];
    for (const [id, kind, body, cited] of entries)
      await client.query(
        `insert into register_entries (entry_id, tenant_id, product_id, kind, statement, body, citations, author, author_type, etag, updated_by)
         values ($1, 'T1', 'P1', $2, $1, $3, $4, $5, 'agent', 'etag-' || $1, $5)`,
        [id, kind, body, JSON.stringify(cited), actor],
      );
    await client.query(
      `insert into revisions (revision_id, tenant_id, object_type, object_id, n, content, replaced_by, written_at, written_by)
       values ('V1', 'T1', 'assumption', 'A1', 1, $1, $2, now(), $2)`,
      [JSON.stringify({ statement: "A1", body: "Earlier.", citations: citations.A1 }), actor],
    );
    const refs = JSON.stringify({ outcomes: [], sources: ["R1"], assumptions: ["A1"] });
    await client.query(
      `insert into story_versions (version_id, tenant_id, product_id, page_id, n, title, html, refs, citations, created_by)
       values ('S1', 'T1', 'P1', 'overview', 1, 'Overview', '<p>Hi</p>', $1, $2, $3)`,
      [refs, JSON.stringify(citations.A3), actor],
    );
    await client.query(`insert into mockups (mockup_id, tenant_id, product_id, title, current_version_id, version_count, etag, created_by, updated_by) values ('K1', 'T1', 'P1', 'Board', 'KV1', 1, 'e', $1, $1)`, [actor]);
    await client.query(
      `insert into mockup_versions (version_id, tenant_id, product_id, mockup_id, n, title, refs, citations, created_by) values ('KV1', 'T1', 'P1', 'K1', 1, 'Board', $1, $2, $3)`,
      [refs, JSON.stringify(citations.A3), actor],
    );
    await client.query(`insert into lineage (record_id, tenant_id, product_id, inputs, query_spec, generated_by) values ('R2', 'T1', 'P1', $1, '{}', $2)`, [JSON.stringify([{ kind: "record", id: "R1", fingerprint: "f" }]), actor]);
    await client.query(`insert into sandbox_baselines (baseline_id, tenant_id, counts, created_by) values ('B1', 'T1', '{"records": 2, "lineage": 1}', $1)`, [actor]);
    await client.query(
      `insert into sandbox_baseline_rows (baseline_id, tenant_id, table_name, row)
       select 'B1', 'T1', 'records', to_jsonb(r) from records r
       union all select 'B1', 'T1', 'tombstones', to_jsonb(d) from tombstones d
       union all select 'B1', 'T1', 'register_entries', to_jsonb(e) - 'tsv' from register_entries e
       union all select 'B1', 'T1', 'revisions', to_jsonb(v) from revisions v
       union all select 'B1', 'T1', 'story_versions', to_jsonb(s) from story_versions s
       union all select 'B1', 'T1', 'mockup_versions', to_jsonb(k) from mockup_versions k
       union all select 'B1', 'T1', 'lineage', to_jsonb(l) from lineage l`,
    );
    await client.query("commit");

    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));

    const a1 = [
      "Leads plan by the job.",
      ["**Passages cited**", [line("Two hours\n  if nothing's weird.", "Crew lead interview — Greenline, Aug 2026"), line(long, "Spring survey export"), line("Gone without a trace.", "a source no longer in WhatBuild")].join("\n")].join("\n\n"),
    ].join("\n\n");
    const bodies = {
      A1: a1,
      A2: "Nothing cited.",
      A3: `**Passages cited**\n\n${line("By the day, if I'm honest.", "Owner interview — Oak & Ash, Aug 2026")}`,
      E1: `Plans close on Friday.\n\n**Passages cited**\n\n${line("We decided on Fridays.", "Crew lead interview — Greenline, Aug 2026")}`,
    };

    await client.query("begin");
    await client.query("select set_config('app.tenant_id', 'T1', true)");
    const after = await client.query<{ entry_id: string; body: string; etag: string }>("select entry_id, body, etag from register_entries order by entry_id");
    expect(Object.fromEntries(after.rows.map((r) => [r.entry_id, r.body]))).toEqual(bodies);
    // A changed body is a new version of the entry; an untouched one keeps its etag.
    const etags = Object.fromEntries(after.rows.map((r) => [r.entry_id, r.etag]));
    expect(etags["A2"]).toBe("etag-A2");
    for (const changed of ["A1", "A3", "E1"]) expect(etags[changed]).not.toBe(`etag-${changed}`);
    const revision = await client.query<{ content: Record<string, unknown> }>("select content from revisions where revision_id = 'V1'");
    expect(revision.rows[0]!.content).toEqual({ statement: "A1", body: "Earlier." });

    const columns = await client.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('register_entries', 'story_versions', 'mockup_versions', 'records')",
    );
    const held = columns.rows.map((c) => `${c.table_name}.${c.column_name}`);
    for (const gone of ["register_entries.citations", "story_versions.refs", "story_versions.citations", "mockup_versions.refs", "mockup_versions.citations", "records.related_records"]) expect(held).not.toContain(gone);
    const lineage = await client.query("select to_regclass('public.lineage') as t");
    expect(lineage.rows[0].t).toBeNull();
    expect(await client.query("select 1 from pg_proc where proname = 'passages_cited_0028'").then((r) => r.rowCount)).toBe(0);

    // A reset puts back what the migration left live.
    const saved = await client.query<{ table_name: string; row: Record<string, unknown> }>("select table_name, row from sandbox_baseline_rows where baseline_id = 'B1'");
    const of = (table: string) => saved.rows.filter((r) => r.table_name === table).map((r) => r.row);
    expect(Object.fromEntries(of("register_entries").map((r) => [r["entry_id"], r["body"]]))).toEqual(bodies);
    for (const r of of("register_entries")) expect(r).not.toHaveProperty("citations");
    for (const r of [...of("story_versions"), ...of("mockup_versions")]) {
      expect(r).not.toHaveProperty("refs");
      expect(r).not.toHaveProperty("citations");
    }
    for (const r of of("records")) expect(r).not.toHaveProperty("related_records");
    expect(of("revisions")[0]!["content"]).toEqual({ statement: "A1", body: "Earlier." });
    expect(of("lineage")).toEqual([]);
    const baseline = await client.query<{ counts: Record<string, number> }>("select counts from sandbox_baselines where baseline_id = 'B1'");
    expect(baseline.rows[0]!.counts).toEqual({ records: 2 });
    await client.query("commit");
  });
});
