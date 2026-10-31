import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// Migration 0041 moves each product's Published mockups to the end of its Story tree, in the order
// readers flipped through them, and drops the section's column.

describe("the migration to one Story tree", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const url = inject("appUrlTemplate").replace("{db}", name);
  let client: pg.Client;

  const items = async (tenant: string, product: string) => {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
    const r = await client.query("select items, etag from story_hierarchies where product_id = $1", [product]);
    await client.query("commit");
    return r.rows[0] as { items: unknown; etag: string } | undefined;
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();

    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0041_the_story_is_one_tree.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await client.query(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    const q = (text: string, values: unknown[] = []) => client.query(text, values);
    /** A live page, or an archived one, whose one version shows a mockup page when `shows` is true. */
    const storyPage = async (product: string, page: string, shows: boolean, at: string, archived = false) => {
      const version = `${product}-${page}`;
      const ref = shows ? JSON.stringify({ mockup_id: "X", mockup_version_id: "XV", version: 1, page_id: "one" }) : null;
      await q(
        `insert into story_versions (version_id, tenant_id, product_id, page_id, n, title, summary, html, mockup, previous_version_id, created_at, created_by)
         values ($1, current_setting('app.tenant_id'), $2, $3, 1, $3, '', '', $4, null, $5, $6)`,
        [version, product, page, ref, at, actor],
      );
      await q(
        `insert into story_pages (tenant_id, product_id, page_id, title, summary, current_version_id, version_count, etag, agent_notes_etag, archived_at, created_by, updated_by)
         values (current_setting('app.tenant_id'), $1, $2, $2, '', $3, 1, 'e', 'n', $4, $5, $5)`,
        [product, page, version, archived ? at : null, actor],
      );
    };
    const tree = (product: string, nodes: unknown, mockups: string[]) =>
      q(`insert into story_hierarchies (product_id, tenant_id, items, mockups, etag, updated_by) values ($1, current_setting('app.tenant_id'), $2, $3, 'old', $4)`, [product, JSON.stringify(nodes), JSON.stringify(mockups), actor]);

    await q("begin");
    await q("select set_config('app.tenant_id', 'T1', true)");
    await q(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'sample', 'Sample', $1), ('T2', 'other', 'Other', $1)`, [actor]);
    await q(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'core', 'Core', $1)`, [actor]);
    await q(
      `insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values
       ('P1', 'T1', 'M1', 'one', 'One', 'e', $1, $1), ('P2', 'T1', 'M1', 'two', 'Two', 'e', $1, $1), ('P3', 'T1', 'M1', 'three', 'Three', 'e', $1, $1)`,
      [actor],
    );
    // P1: a tree, a saved order for two mockups, a third no one ordered, one that was placed before it was promoted, and one archived.
    await storyPage("P1", "intro", false, "2026-09-01T00:00:00Z");
    await storyPage("P1", "late", true, "2026-09-05T00:00:00Z");
    await storyPage("P1", "second", true, "2026-09-02T00:00:00Z");
    await storyPage("P1", "first", true, "2026-09-03T00:00:00Z");
    await storyPage("P1", "nested", true, "2026-09-04T00:00:00Z");
    await storyPage("P1", "gone", true, "2026-09-01T00:00:00Z", true);
    await tree("P1", [{ page_id: "intro", children: [{ page_id: "nested", children: [] }] }], ["first", "gone", "second"]);
    // P2: mockups and a page of its own, but no tree saved yet.
    await storyPage("P2", "own", false, "2026-09-01T00:00:00Z");
    await storyPage("P2", "b", true, "2026-09-02T00:00:00Z");
    await storyPage("P2", "a", true, "2026-09-03T00:00:00Z");
    // P3: a tree and no mockups, which is left as it is.
    await storyPage("P3", "only", false, "2026-09-01T00:00:00Z");
    await tree("P3", [{ page_id: "only", children: [] }], []);
    await q("commit");

    // Another tenant's mockups, to see the rows are rewritten in every tenant.
    await q("begin");
    await q("select set_config('app.tenant_id', 'T2', true)");
    await q(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M2', 'T2', 'core', 'Core', $1)`, [actor]);
    await q(`insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('Q1', 'T2', 'M2', 'desk', 'Desk', 'e', $1, $1)`, [actor]);
    await storyPage("Q1", "theirs", true, "2026-09-01T00:00:00Z");
    await q("commit");

    await client.query(readFileSync(`${dir}${files[at]}`, "utf8"));
  });
  afterAll(async () => client?.end());

  const leaf = (page_id: string) => ({ page_id, children: [] });

  it("moves the Published mockups to the end of the tree, the saved order first, leaving what the tree names where it stands", async () => {
    const h = await items("T1", "P1");
    expect(h?.items).toEqual([{ page_id: "intro", children: [leaf("nested")] }, leaf("first"), leaf("second"), leaf("late")]);
    expect(h?.etag).not.toBe("old");
  });

  it("gives a product whose tree was never saved one holding its mockups, in the order they were published", async () => {
    expect((await items("T1", "P2"))?.items).toEqual([leaf("b"), leaf("a")]);
  });

  it("leaves a tree with no mockups to move as it was, and reaches every tenant", async () => {
    expect(await items("T1", "P3")).toEqual({ items: [leaf("only")], etag: "old" });
    expect((await items("T2", "Q1"))?.items).toEqual([leaf("theirs")]);
  });

  it("drops the section's column", async () => {
    const c = await client.query("select 1 from information_schema.columns where table_name = 'story_hierarchies' and column_name = 'mockups'");
    expect(c.rowCount).toBe(0);
  });
});
