import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// Migration 0044 removes teams: a team's role becomes a role on all products where the
// organization had one team, and on each of the team's products where it had several; a team admin
// becomes a product creator; product slugs become unique in their organization, the address a
// product had under its team is kept where its slug changed, and the teams go.

describe("the migration that removes teams", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const url = inject("appUrlTemplate").replace("{db}", name);
  let client: pg.Client;
  const q = (text: string, values: unknown[] = []) => client.query(text, values);
  const grants = async (account: string) =>
    (await q("select scope_type, scope_id, role from memberships where account_id = $1 order by scope_type, scope_id", [account])).rows as { scope_type: string; scope_id: string; role: string }[];

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();

    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0044_no_teams.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await q(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    const people = ["ann", "ben", "cy", "dee", "eve", "fay"];
    for (const p of people) await q("insert into accounts (account_id, email, display_name) values ($1, $2, $1)", [p, `${p}@example.com`]);

    // One organization with one team, whose second product's slug names one of the organization's pages.
    await q(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'solo', 'Solo', $1), ('T2', 'duo', 'Duo', $1)`, [actor]);
    await q(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('M1', 'T1', 'product-team', 'Product team', $1)`, [actor]);
    await q(
      `insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by, created_at) values
       ('P1', 'T1', 'M1', 'crew', 'Crew', 'e', $1, $1, '2026-01-01'), ('P2', 'T1', 'M1', 'members', 'Members', 'e', $1, $1, '2026-01-02')`,
      [actor],
    );
    // Another with two teams, each with a product of the same slug, the second made later.
    await q(`insert into teams (team_id, tenant_id, slug, name, created_by) values ('N1', 'T2', 'alpha', 'Alpha', $1), ('N2', 'T2', 'beta', 'Beta', $1)`, [actor]);
    await q(
      `insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by, created_at) values
       ('Q1', 'T2', 'N1', 'app', 'App', 'e', $1, $1, '2026-01-01'), ('Q2', 'T2', 'N2', 'app', 'App again', 'e', $1, $1, '2026-01-02'),
       ('Q3', 'T2', 'N2', 'tool', 'Tool', 'e', $1, $1, '2026-01-03')`,
      [actor],
    );
    const grant = (id: string, tenant: string, type: string, scope: string, account: string, role: string) =>
      q("insert into memberships (membership_id, tenant_id, scope_type, scope_id, account_id, role, created_by) values ($1, $2, $3, $4, $5, $6, $7)", [id, tenant, type, scope, account, role, actor]);
    await grant("G01", "T1", "tenant", "T1", "cy", "admin");
    await grant("G02", "T1", "team", "M1", "ann", "editor");
    await grant("G03", "T1", "tenant", "T1", "ben", "member");
    await grant("G04", "T1", "team", "M1", "ben", "admin");
    await grant("G05", "T1", "team", "M1", "cy", "admin");
    await grant("G06", "T1", "product", "P1", "dee", "reader");
    await grant("G07", "T2", "team", "N2", "eve", "editor");
    await grant("G08", "T2", "product", "Q2", "eve", "viewer");
    await grant("G09", "T2", "product", "Q3", "eve", "admin");
    await grant("G10", "T2", "team", "N1", "fay", "admin");
    const invite = (id: string, tenant: string, team: string, email: string, accepted: boolean) =>
      q(
        `insert into invitations (invitation_id, tenant_id, scope_type, scope_id, email, role, token_hash, expires_at, accepted_at, created_by)
         values ($1, $2, 'team', $3, $4, 'viewer', $1, now() + interval '7 days', $5, $6)`,
        [id, tenant, team, email, accepted ? new Date().toISOString() : null, actor],
      );
    await invite("I1", "T1", "M1", "new@example.com", false);
    await invite("I2", "T2", "N2", "open@example.com", false);
    await invite("I3", "T2", "N1", "took@example.com", true);

    await q(readFileSync(`${dir}${files[at]}`, "utf8"));
  });
  afterAll(async () => client?.end());

  it("makes a team's role a role on all products where the organization had one team, and a team admin a product creator", async () => {
    expect(await grants("ann")).toEqual([{ scope_type: "all_products", scope_id: "T1", role: "editor" }]);
    expect(await grants("ben")).toEqual([
      { scope_type: "all_products", scope_id: "T1", role: "admin" },
      { scope_type: "tenant", scope_id: "T1", role: "creator" },
    ]);
    // An organization admin stays one; the team's role is kept on all products.
    expect(await grants("cy")).toEqual([
      { scope_type: "all_products", scope_id: "T1", role: "admin" },
      { scope_type: "tenant", scope_id: "T1", role: "admin" },
    ]);
    expect(await grants("dee")).toEqual([{ scope_type: "product", scope_id: "P1", role: "reader" }]);
  });

  it("makes it a role on each of the team's products where it had several, keeping the higher of two roles on one product", async () => {
    expect(await grants("eve")).toEqual([
      { scope_type: "product", scope_id: "Q2", role: "editor" },
      { scope_type: "product", scope_id: "Q3", role: "admin" },
    ]);
    expect(await grants("fay")).toEqual([
      { scope_type: "product", scope_id: "Q1", role: "admin" },
      { scope_type: "tenant", scope_id: "T2", role: "creator" },
    ]);
    const ids = (await q("select membership_id from memberships where membership_id not like 'G%'")).rows.map((r: { membership_id: string }) => r.membership_id);
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("gives a product whose slug another product of its organization had first, or that names an organization page, a new slug, and keeps its address", async () => {
    const slugs = Object.fromEntries((await q("select product_id, slug from products order by product_id")).rows.map((r: { product_id: string; slug: string }) => [r.product_id, r.slug]));
    expect(slugs).toEqual({ P1: "crew", P2: "members-2", Q1: "app", Q2: "app-2", Q3: "tool" });
    expect((await q("select tenant_id, team_slug, product_slug, product_id from team_addresses order by product_id")).rows).toEqual([
      { tenant_id: "T1", team_slug: "product-team", product_slug: "members", product_id: "P2" },
      { tenant_id: "T2", team_slug: "beta", product_slug: "app", product_id: "Q2" },
    ]);
    await expect(q("update products set slug = 'crew' where product_id = 'P2'")).rejects.toThrow(/products_tenant_id_slug_key/);
  });

  it("turns invitations to a team into invitations to all products, ending the open ones where there were several teams", async () => {
    const rows = (await q("select invitation_id, scope_type, scope_id, expires_at > now() as open from invitations order by invitation_id")).rows;
    expect(rows).toEqual([
      { invitation_id: "I1", scope_type: "all_products", scope_id: "T1", open: true },
      { invitation_id: "I2", scope_type: "all_products", scope_id: "T2", open: false },
      { invitation_id: "I3", scope_type: "all_products", scope_id: "T2", open: true },
    ]);
  });

  it("drops the teams and every column that named one, and takes no grant on a team again", async () => {
    expect((await q("select 1 from information_schema.tables where table_name = 'teams'")).rowCount).toBe(0);
    expect((await q("select table_name from information_schema.columns where column_name = 'team_id' and table_schema = 'public'")).rowCount).toBe(0);
    await expect(q(`insert into memberships (membership_id, tenant_id, scope_type, scope_id, account_id, role, created_by) values ('X', 'T1', 'team', 'M1', 'ann', 'viewer', '{}')`)).rejects.toThrow(/memberships_scope_type_check/);
    expect((await q("select 1 from pg_proc where proname = 'ulid_0044'")).rowCount).toBe(0);
  });
});
