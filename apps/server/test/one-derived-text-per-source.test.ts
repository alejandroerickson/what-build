import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { indexSources } from "@whatbuild/core";
import { renderMarkdown, type Block } from "@whatbuild/parsers";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb } from "../src/database.ts";

// Migration 0030 gives each source whose primary had passages one derived text, laid out as the
// parsers lay out a file's text; does the same to saved sandbox baselines; drops passages, file
// roles and provenance; and queues every attachment to be read again and every product to be
// indexed for search. The test database may count length() in bytes, so the texts here are ASCII.

interface Passage {
  text: string;
  speaker?: string;
  start_ms?: number;
  heading_level?: number;
}

/** A timed transcript: a speaker's consecutive cues run on as one turn, a heading closes a turn, a cue may name no one, and an hour on the clock reads h:mm:ss. */
const CALL: Passage[] = [
  { text: "# Kickoff", heading_level: 1 },
  { text: "We export everything to a spreadsheet.", speaker: "Dana", start_ms: 1_000 },
  { text: "Mostly by hand.", speaker: "Dana", start_ms: 5_000 },
  { text: "Why Friday?", speaker: "Sam", start_ms: 9_000 },
  { text: "Music plays.", start_ms: 3_723_000 },
  { text: "## Wrap-up", heading_level: 2 },
  { text: "Thanks, all.", speaker: "Ana_B", start_ms: 3_725_000 },
];
const CALL_TEXT =
  "# Kickoff\n\n**Dana** (0:01): We export everything to a spreadsheet. Mostly by hand.\n\n**Sam** (0:09): Why Friday?\n\n(1:02:03) Music plays.\n\n## Wrap-up\n\n**Ana\\_B** (1:02:05): Thanks, all.\n";

/** An untimed transcript: a speaker's later paragraphs are not labelled again, until someone else speaks. */
const VISIT: Passage[] = [
  { text: "# Visit   notes", heading_level: 1 },
  { text: "How do you plan?", speaker: "Interviewer" },
  { text: "By the week.", speaker: "Dana" },
  { text: "On Fridays, mostly.", speaker: "Dana" },
  { text: "  Written up after the visit.  " },
  { text: "One more thing.", speaker: "Dana" },
];
const visitText = (when: string) =>
  `# Visit notes\n\n**Interviewer:** How do you plan?\n\n**Dana:** ${when}\n\nOn Fridays, mostly.\n\nWritten up after the visit.\n\n**Dana:** One more thing.\n`;

/** A long turn runs on to about 1,200 characters; the next cue opens a paragraph of its own. */
const LONG: Passage[] = ["a", "b", "c"].map((c, i) => ({ text: c.repeat(700), speaker: "Dana", start_ms: i * 20_000 }));
const LONG_TEXT = `**Dana** (0:00): ${"a".repeat(700)} ${"b".repeat(700)}\n\n**Dana** (0:40): ${"c".repeat(700)}\n`;

const PARSER = { account_id: "system", display_name: "WhatBuild", surface: null, client: "parser" };
const READ_AT = { D1: "2026-09-01T10:00:00.000Z", D2: "2026-09-02T10:00:00.000Z", D4: "2026-09-04T10:00:00.000Z", D6: "2026-09-06T10:00:00.000Z" };

const blocks = (passages: Passage[]): Block[] => passages.map((p) => ({ text: p.text, speaker: p.speaker ?? null, start_ms: p.start_ms ?? null, ...(p.heading_level ? { heading_level: p.heading_level } : {}) }));

describe("the migration to one derived text per source", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const url = inject("appUrlTemplate").replace("{db}", name);
  let client: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();

    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0030_one_derived_text_per_source.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    const q = (text: string, values: unknown[] = []) => client.query(text, values);
    /** A file with its versions (the last is current), each version's reading, and the record pointing at its current one. */
    const file = async (o: { file: string; record: string; path: string; role: string; versions: string[]; added_at: string; provenance?: boolean }) => {
      await q(
        `insert into files (file_id, tenant_id, record_id, path, role, current_version_id, derived_from, derivation_note, derived_by, added_at, added_by, role_changed_at, role_changed_by)
         values ($1, current_setting('app.tenant_id'), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [o.file, o.record, o.path, o.role, o.versions.at(-1), o.provenance ? ["call.vtt"] : [], o.provenance ? "Exported from the recorder." : null, o.provenance ? "human" : null, o.added_at, actor, o.provenance ? o.added_at : null, o.provenance ? actor : null],
      );
      for (const v of o.versions)
        await q(
          `insert into file_versions (file_version_id, tenant_id, record_id, file_id, blob_key, size, sha256, media_type, created_by)
           values ($1, current_setting('app.tenant_id'), $2, $3, $4, 10, $5, 'text/plain', $6)`,
          [v, o.record, o.file, `t/x/r/${o.record}/f/${v}`, "0".repeat(64), actor],
        );
    };
    const reading = async (o: { derivation: string; record: string; version: string; path: string; status: string; at: string; passages: Passage[]; current?: boolean }) => {
      await q(
        `insert into derivations (derivation_id, tenant_id, record_id, file_version_id, source_path, status, status_detail, parser, parser_version, segment_count, text_chars, blob_prefix, created_at)
         values ($1, current_setting('app.tenant_id'), $2, $3, $4, $5, $6, 'webvtt', '1', $7, 0, $8, $9)`,
        [o.derivation, o.record, o.version, o.path, o.status, o.status === "ready" ? null : "the file could not be read", o.passages.length, `t/x/r/${o.record}/d/${o.derivation}`, o.at],
      );
      for (const [seq, p] of o.passages.entries())
        await q(
          `insert into segments (tenant_id, record_id, derivation_id, seq, text, speaker, start_ms, end_ms, char_start, char_end, heading_level, is_current)
           values (current_setting('app.tenant_id'), $1, $2, $3, $4, $5, $6, $7, 0, 0, $8, $9)`,
          [o.record, o.derivation, seq, p.text, p.speaker ?? null, p.start_ms ?? null, p.start_ms === undefined ? null : p.start_ms + 1_000, p.heading_level ?? null, o.current ?? true],
        );
      if (o.current ?? true) await q("update records set current_derivation_id = $1 where record_id = $2", [o.derivation, o.record]);
    };
    const record = (id: string, product: string, team: string) =>
      q(`insert into records (record_id, tenant_id, team_id, product_id, title, tags, slug, etag, uploaded_by, updated_by) values ($1, current_setting('app.tenant_id'), $2, $3, $1, '{}', $1, 'e', $4, $4)`, [
        id,
        team,
        product,
        actor,
      ]);

    await q("begin");
    await q("select set_config('app.tenant_id', 'T1', true)");
    await q(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1), ('T2', 'other', 'Other', $1)`, [actor]);
    await q(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'core', 'Core', $1)`, [actor]);
    await q(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('P1', 'T1', 'M1', 'crew', 'Crew', 'e', $1, $1), ('P2', 'T1', 'M1', 'yard', 'Yard', 'e', $1, $1)`, [actor]);
    for (const id of ["R1", "R2", "R3", "R4"]) await record(id, "P1", "M1");
    await record("R5", "P2", "M1");
    // R1: a timed transcript, read twice, with the recorder's export kept as its origin file.
    await file({ file: "F1", record: "R1", path: "call.vtt", role: "primary", versions: ["V0", "V1"], added_at: "2026-09-01T09:00:00Z" });
    await file({ file: "F1o", record: "R1", path: "recorder-export.txt", role: "origin", versions: ["V1o"], added_at: "2026-09-01T09:05:00Z", provenance: true });
    await reading({ derivation: "D0", record: "R1", version: "V0", path: "call.vtt", status: "ready", at: "2026-08-01T10:00:00Z", passages: [{ text: "An older reading." }], current: false });
    await reading({ derivation: "D1", record: "R1", version: "V1", path: "call.vtt", status: "ready", at: READ_AT.D1, passages: CALL });
    // R2: an untimed transcript; R3: a file that could not be read; R4: one long turn; R5: no file at all.
    await file({ file: "F2", record: "R2", path: "visit.txt", role: "primary", versions: ["V2"], added_at: "2026-09-02T09:00:00Z" });
    await reading({ derivation: "D2", record: "R2", version: "V2", path: "visit.txt", status: "ready", at: READ_AT.D2, passages: VISIT });
    await file({ file: "F3", record: "R3", path: "deck.docx", role: "primary", versions: ["V3"], added_at: "2026-09-03T09:00:00Z" });
    await reading({ derivation: "D3", record: "R3", version: "V3", path: "deck.docx", status: "failed", at: "2026-09-03T10:00:00Z", passages: [] });
    await file({ file: "F4", record: "R4", path: "long.vtt", role: "primary", versions: ["V4"], added_at: "2026-09-04T09:00:00Z" });
    await reading({ derivation: "D4", record: "R4", version: "V4", path: "long.vtt", status: "ready", at: READ_AT.D4, passages: LONG });
    await q(
      `insert into upload_grants (grant_id, tenant_id, product_id, record_id, path, role, max_bytes, derived_from, derivation_note, derived_by, principal, expires_at)
       values ('G1', 'T1', 'P1', 'R2', 'visit-photo.txt', 'supplement', 1000, '{visit.txt}', 'Typed up', 'human', $1, now() + interval '1 hour')`,
      [actor],
    );
    // A baseline saved as a public sandbox saves one: each row as JSON, without generated columns.
    await q(`insert into sandbox_baselines (baseline_id, tenant_id, counts, created_by) values ('B1', 'T1', '{}', $1)`, [actor]);
    await q(
      `insert into sandbox_baseline_rows (baseline_id, tenant_id, table_name, row)
       select 'B1', 'T1', 'records', to_jsonb(r) from records r
       union all select 'B1', 'T1', 'files', to_jsonb(f) from files f
       union all select 'B1', 'T1', 'file_versions', to_jsonb(v) from file_versions v
       union all select 'B1', 'T1', 'derivations', to_jsonb(d) from derivations d
       union all select 'B1', 'T1', 'segments', to_jsonb(s) - 'tsv' from segments s`,
    );
    await q(`update sandbox_baselines set counts = (select jsonb_object_agg(table_name, n) from (select table_name, count(*)::int as n from sandbox_baseline_rows group by 1) c)`);
    // Changed after the baseline was saved, so the two can be told apart.
    await q("update segments set text = 'By the month.' where derivation_id = 'D2' and seq = 2");
    await q("commit");

    // Another organization, migrated in a turn of its own.
    await q("begin");
    await q("select set_config('app.tenant_id', 'T2', true)");
    await q(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M2', 'T2', 'core', 'Core', $1)`, [actor]);
    await q(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('Q1', 'T2', 'M2', 'desk', 'Desk', 'e', $1, $1)`, [actor]);
    await record("R6", "Q1", "M2");
    await file({ file: "F6", record: "R6", path: "notes.md", role: "primary", versions: ["V6"], added_at: "2026-09-06T09:00:00Z" });
    await reading({ derivation: "D6", record: "R6", version: "V6", path: "notes.md", status: "ready", at: READ_AT.D6, passages: [{ text: "Other tenant words." }] });
    await q("commit");

    await q(readFileSync(`${dir}${files[at]}`, "utf8"));
  });
  afterAll(async () => client?.end());

  /** Rows read inside one organization's row-level security. */
  async function inTenant<T extends pg.QueryResultRow>(tenant: string, text: string): Promise<T[]> {
    await client.query("begin");
    try {
      await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      return (await client.query<T>(text)).rows;
    } finally {
      await client.query("commit");
    }
  }

  it("gives each source whose primary had passages its derived text, laid out as the parsers lay out a file's text", async () => {
    const rows = await inTenant<{ record_id: string; tenant_id: string; content: string; chars: number; from_file_version_id: string; updated_at: Date; updated_by: unknown; etag: string }>(
      "T1",
      "select * from source_texts order by record_id",
    );
    expect(rows.map((r) => [r.record_id, r.content])).toEqual([
      ["R1", CALL_TEXT],
      ["R2", visitText("By the month.")],
      ["R4", LONG_TEXT],
    ]);
    // The same rules as the parsers: what a file read today would say, given the same blocks.
    expect(renderMarkdown(blocks(CALL))).toBe(CALL_TEXT);
    expect(renderMarkdown(blocks(LONG))).toBe(LONG_TEXT);
    expect(renderMarkdown(blocks(VISIT.map((p) => (p.text === "By the week." ? { ...p, text: "By the month." } : p))))).toBe(rows[1]!.content);
    for (const [r, version, at] of [[rows[0]!, "V1", READ_AT.D1], [rows[1]!, "V2", READ_AT.D2], [rows[2]!, "V4", READ_AT.D4]] as const) {
      expect(r).toMatchObject({ tenant_id: "T1", chars: r.content.length, from_file_version_id: version, updated_by: PARSER });
      expect(r.updated_at.toISOString()).toBe(at);
      expect(r.etag).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(new Set(rows.map((r) => r.etag)).size).toBe(3);
    const other = await inTenant<{ record_id: string; content: string; from_file_version_id: string }>("T2", "select record_id, content, from_file_version_id from source_texts");
    expect(other).toEqual([{ record_id: "R6", content: "Other tenant words.\n", from_file_version_id: "V6" }]);
    // The search index is left to the worker.
    expect(await inTenant("T1", "select 1 from text_chunks")).toEqual([]);
  });

  it("does the same to a saved sandbox baseline, from the passages it saved", async () => {
    const saved = await inTenant<{ table_name: string; row: Record<string, unknown> }>("T1", "select table_name, row from sandbox_baseline_rows where baseline_id = 'B1' order by table_name, row->>'record_id', row->>'file_id'");
    const of = (table: string) => saved.filter((r) => r.table_name === table).map((r) => r.row);
    expect(of("segments")).toEqual([]);
    const texts = of("source_texts");
    expect(texts.map((t) => [t["record_id"], t["content"], t["from_file_version_id"]])).toEqual([
      ["R1", CALL_TEXT, "V1"],
      ["R2", visitText("By the week."), "V2"],
      ["R4", LONG_TEXT, "V4"],
    ]);
    for (const t of texts) {
      expect(t).toMatchObject({ tenant_id: "T1", chars: (t["content"] as string).length, updated_by: PARSER });
      expect(t["etag"]).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(texts.map((t) => new Date(t["updated_at"] as string).toISOString())).toEqual([READ_AT.D1, READ_AT.D2, READ_AT.D4]);
    // Files keep what they are and lose their role and provenance; records and readings lose what passages needed.
    expect(of("files").map((f) => f["path"])).toEqual(["call.vtt", "recorder-export.txt", "visit.txt", "deck.docx", "long.vtt"]);
    for (const f of of("files")) for (const k of ["role", "derived_from", "derivation_note", "derived_by", "role_changed_at", "role_changed_by"]) expect(f).not.toHaveProperty(k);
    for (const r of of("records")) expect(r).not.toHaveProperty("current_derivation_id");
    expect(of("records")).toHaveLength(5);
    for (const d of of("derivations")) expect(d).not.toHaveProperty("segment_count");
    expect(of("derivations")).toHaveLength(5);
    const [baseline] = await inTenant<{ counts: Record<string, number> }>("T1", "select counts from sandbox_baselines where baseline_id = 'B1'");
    expect(baseline!.counts).toEqual({ records: 5, files: 5, file_versions: 6, derivations: 5, source_texts: 3 });
  });

  it("drops passages, the record's current reading, file roles and provenance, and a reading's passage count", async () => {
    expect((await client.query("select to_regclass('public.segments') as t")).rows[0].t).toBeNull();
    const columns = await client.query<{ c: string }>(
      `select table_name || '.' || column_name as c from information_schema.columns
       where table_schema = 'public' and table_name in ('records', 'files', 'upload_grants', 'derivations')
         and column_name in ('current_derivation_id', 'role', 'derived_from', 'derivation_note', 'derived_by', 'role_changed_at', 'role_changed_by', 'segment_count')`,
    );
    expect(columns.rows).toEqual([]);
    const indexes = (await client.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'public' and tablename in ('files', 'derivations')")).rows.map((r) => r.indexname);
    expect(indexes).toContain("derivations_version");
    expect(indexes).not.toContain("files_one_primary");
    expect((await client.query("select proname from pg_proc where proname in ('text_from_passages_0030', 'clock_0030')")).rows).toEqual([]);
    // Both new tables are an organization's alone.
    const guarded = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('source_texts', 'text_chunks') order by relname",
    );
    expect(guarded.rows).toEqual([
      { relname: "source_texts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "text_chunks", relrowsecurity: true, relforcerowsecurity: true },
    ]);
    // What the rows held otherwise stays.
    expect(await inTenant("T1", "select file_id, path, current_version_id from files where file_id = 'F1o'")).toEqual([{ file_id: "F1o", path: "recorder-export.txt", current_version_id: "V1o" }]);
    expect(await inTenant("T1", "select grant_id, path from upload_grants")).toEqual([{ grant_id: "G1", path: "visit-photo.txt" }]);
    expect(await inTenant("T1", "select derivation_id from derivations order by 1")).toEqual(["D0", "D1", "D2", "D3", "D4"].map((derivation_id) => ({ derivation_id })));
  });

  it("queues every attachment to be read again, quietly, and every product to be indexed", async () => {
    const jobs = await client.query<{ tenant_id: string; kind: string; payload: Record<string, unknown> }>("select tenant_id, kind, payload from jobs order by job_id");
    const derive = (tenant: string) => jobs.rows.filter((j) => j.kind === "derive" && j.tenant_id === tenant).map((j) => j.payload);
    const read = (record_id: string, file_version_id: string) => ({ record_id, file_version_id, force: true, quiet: true });
    // Each attachment's current version, an origin file's too, in the order the attachments were added.
    expect(derive("T1")).toEqual([read("R1", "V1"), read("R1", "V1o"), read("R2", "V2"), read("R3", "V3"), read("R4", "V4")]);
    expect(derive("T2")).toEqual([read("R6", "V6")]);
    const index = jobs.rows.filter((j) => j.kind === "index_texts").map((j) => [j.tenant_id, j.payload["product_id"]]);
    expect(index.sort()).toEqual([["T1", "P1"], ["T1", "P2"], ["T2", "Q1"]]);
    expect(jobs.rows.every((j) => j.kind === "derive" || j.kind === "index_texts")).toBe(true);
  });

  it("leaves texts that the queued index job makes searchable", async () => {
    const { db, pool } = createDb(url, 1);
    try {
      const indexed = await db.transaction().execute(async (trx) => {
        await sql`select set_config('app.tenant_id', 'T1', true)`.execute(trx);
        return indexSources(trx, { product_id: "P1" });
      });
      expect(indexed).toBe(4);
    } finally {
      await pool.end();
    }
    const pieces = await inTenant<{ record_id: string; field: string; n: number; char_start: number; char_end: number; text: string }>(
      "T1",
      "select record_id, field, n, char_start, char_end, text from text_chunks where field = 'text' order by record_id, n",
    );
    expect(pieces.filter((p) => p.record_id === "R1")).toEqual([{ record_id: "R1", field: "text", n: 0, char_start: 0, char_end: CALL_TEXT.length, text: CALL_TEXT }]);
    // A long text is cut into pieces that join back into it.
    const long = pieces.filter((p) => p.record_id === "R4");
    expect(long.length).toBeGreaterThan(1);
    for (const p of long) expect(LONG_TEXT.slice(p.char_start, p.char_end)).toBe(p.text);
    expect(await inTenant("T1", "select record_id, field from text_chunks where field = 'title' order by record_id")).toEqual(["R1", "R2", "R3", "R4"].map((record_id) => ({ record_id, field: "title" })));
  });
});
