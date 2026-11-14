import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// Migration 0046 removes assumptions: every assumption in every organization goes, with its reviews,
// its earlier wordings, its entries in the activity log and the tombstones of ones deleted before.
// A decision still waiting to move into Evidence stays with its review, and so does everything else.

describe("the migration that removes assumptions", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const at = files.indexOf("0046_no_assumptions.sql");
  let client: pg.Client;
  const q = (text: string, values: unknown[] = []) => client.query(text, values);
  const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });

  /** Runs `fn` in a transaction that sees the organization's rows, as row-level security allows. */
  async function inTenant<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
    await q("begin");
    try {
      await q("select set_config('app.tenant_id', $1, true)", [tenant]);
      const out = await fn();
      await q("commit");
      return out;
    } catch (error) {
      await q("rollback");
      throw error;
    }
  }

  /** The ids left in each table the migration reads, in one organization. */
  const left = (tenant: string) =>
    inTenant(tenant, async () => ({
      entries: (await q("select entry_id, kind from register_entries order by entry_id")).rows,
      reviews: (await q("select review_id from reviews order by review_id")).rows.map((r) => r.review_id),
      revisions: (await q("select object_type, object_id from revisions order by object_id")).rows,
      activity: (await q("select entity_type, entity_id from activity order by entity_id")).rows,
      tombstones: (await q("select object_type, object_id from tombstones order by object_id")).rows,
      outcomes: (await q("select outcome_id from outcomes")).rows.map((r) => r.outcome_id),
    }));

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: inject("appUrlTemplate").replace("{db}", name) });
    await client.connect();

    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await q(readFileSync(`${dir}${f}`, "utf8"));

    for (const t of ["T1", "T2"]) {
      const p = `P${t}`;
      await inTenant(t, async () => {
        await q("insert into tenants (tenant_id, slug, name, created_by) values ($1, $2, $2, $3)", [t, t.toLowerCase(), actor]);
        await q("insert into products (product_id, tenant_id, slug, name, etag, created_by, updated_by) values ($1, $2, 'crew', 'Crew', 'e', $3, $3)", [p, t, actor]);
        await q("insert into outcomes (outcome_id, tenant_id, product_id, title, position, etag, created_by, updated_by) values ($1, $2, $3, 'Plan the week', 1, 'e', $4, $4)", [`O${t}`, t, p, actor]);
        const entry = (id: string, kind: string) =>
          q(
            `insert into register_entries (entry_id, tenant_id, product_id, kind, statement, body, links, outcome_ids, tags, author, author_type, status, review_count, etag, updated_by)
             values ($1, $2, $3, $4, $1, '', '[]', $5, '{}', $6, 'human', 'confirmed', 1, 'e', $6)`,
            [id, t, p, kind, [`O${t}`], actor],
          );
        await entry(`A${t}`, "assumption");
        await entry(`D${t}`, "decision");
        for (const [review, of] of [[`RA${t}`, `A${t}`], [`RD${t}`, `D${t}`]])
          await q("insert into reviews (review_id, tenant_id, entry_id, status, note, reviewer, reviewer_type) values ($1, $2, $3, 'confirmed', 'Heard it twice.', $4, 'human')", [review, t, of, actor]);
        for (const [type, id] of [["assumption", `A${t}`], ["outcome", `O${t}`]])
          await q(
            "insert into revisions (revision_id, tenant_id, object_type, object_id, n, content, replaced_by, written_at, written_by) values ($1, $2, $3, $4, 1, '{}', $5, now(), $5)",
            [`V${id}`, t, type, id, actor],
          );
        for (const [type, id] of [["assumption", `A${t}`], ["outcome", `O${t}`]])
          await q(
            "insert into activity (activity_id, tenant_id, product_id, actor, actor_account_id, channel, action, entity_type, entity_id, entity_title, summary) values ($1, $2, $3, $4, 'a1', 'web', 'created', $5, $6, $6, 'Created')",
            [`E${id}`, t, p, actor, type, id],
          );
        for (const [type, id] of [["assumption", `GA${t}`], ["source", `GS${t}`]])
          await q("insert into tombstones (tenant_id, product_id, object_type, object_id, title, reason, deleted_by) values ($1, $2, $3, $4, $4, 'A mistake', $5)", [t, p, type, id, actor]);
      });
    }
    await q(readFileSync(`${dir}${files[at]}`, "utf8"));
  });
  afterAll(async () => client?.end());

  it("deletes every assumption, with its review, earlier wording, activity and tombstone, in every organization", async () => {
    for (const t of ["T1", "T2"]) {
      expect(await left(t), t).toEqual({
        entries: [{ entry_id: `D${t}`, kind: "decision" }],
        reviews: [`RD${t}`],
        revisions: [{ object_type: "outcome", object_id: `O${t}` }],
        activity: [{ entity_type: "outcome", entity_id: `O${t}` }],
        tombstones: [{ object_type: "source", object_id: `GS${t}` }],
        outcomes: [`O${t}`],
      });
    }
  });

  it("refuses an assumption written after it, and keeps taking a decision", async () => {
    const write = (id: string, kind: string) =>
      inTenant("T1", () =>
        q(
          `insert into register_entries (entry_id, tenant_id, product_id, kind, statement, author, author_type, etag, updated_by)
           values ($1, 'T1', 'PT1', $2, $1, $3, 'human', 'e', $3)`,
          [id, kind, actor],
        ),
      );
    await expect(write("A-late", "assumption")).rejects.toThrow(/register_entries_kind_check/);
    await expect(write("D-late", "decision")).resolves.toBeDefined();
  });
});
