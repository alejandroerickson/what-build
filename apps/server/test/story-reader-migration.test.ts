import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

// Migration 0045 names the role that reads only the Story story_reader: every grant and invitation
// that held reader holds story_reader, in every organization, and every other role stays as it was.

describe("the migration that names the Story-only role story_reader", () => {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const url = inject("appUrlTemplate").replace("{db}", name);
  let client: pg.Client;
  const q = (text: string, values: unknown[] = []) => client.query(text, values);

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query(`create database "${name}" owner whatbuild`).catch(async () => admin.query(`create database "${name}"`));
    await admin.end();
    client = new pg.Client({ connectionString: url });
    await client.connect();

    const dir = fileURLToPath(new URL("../src/migrations/", import.meta.url));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf("0045_story_reader_role.sql");
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await q(readFileSync(`${dir}${f}`, "utf8"));

    const actor = JSON.stringify({ account_id: "a1", display_name: "Sample", surface: "web", client: null });
    for (const p of ["ann", "ben", "cy", "dee"]) await q("insert into accounts (account_id, email, display_name) values ($1, $2, $1)", [p, `${p}@example.com`]);
    await q(`insert into tenants (tenant_id, slug, name, created_by) values ('T1', 'one', 'One', $1), ('T2', 'two', 'Two', $1)`, [actor]);
    await q(
      `insert into products (product_id, tenant_id, slug, name, etag, created_by, updated_by) values
       ('P1', 'T1', 'crew', 'Crew', 'e', $1, $1), ('Q1', 'T2', 'app', 'App', 'e', $1, $1)`,
      [actor],
    );
    const grant = (id: string, tenant: string, type: string, scope: string, account: string, role: string) =>
      q("insert into memberships (membership_id, tenant_id, scope_type, scope_id, account_id, role, created_by) values ($1, $2, $3, $4, $5, $6, $7)", [id, tenant, type, scope, account, role, actor]);
    await grant("G1", "T1", "product", "P1", "ann", "reader");
    await grant("G2", "T1", "tenant", "T1", "ann", "member");
    await grant("G3", "T1", "all_products", "T1", "ben", "reader");
    await grant("G4", "T1", "product", "P1", "cy", "viewer");
    await grant("G5", "T2", "product", "Q1", "dee", "reader");
    await grant("G6", "T2", "tenant", "T2", "cy", "owner");
    const invite = (id: string, tenant: string, type: string, scope: string, role: string, accepted: boolean) =>
      q(
        `insert into invitations (invitation_id, tenant_id, scope_type, scope_id, email, role, token_hash, expires_at, accepted_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $1, now() + interval '7 days', $7, $8)`,
        [id, tenant, type, scope, `${id.toLowerCase()}@example.com`, role, accepted ? new Date().toISOString() : null, actor],
      );
    await invite("I1", "T1", "product", "P1", "reader", false);
    await invite("I2", "T2", "all_products", "T2", "reader", true);
    await invite("I3", "T1", "product", "P1", "editor", false);

    await q(readFileSync(`${dir}${files[at]}`, "utf8"));
  });
  afterAll(async () => client?.end());

  it("names every reader's grant story_reader, in every organization, on a product or on all products", async () => {
    const rows = (await q("select membership_id, role from memberships order by membership_id")).rows;
    expect(rows).toEqual([
      { membership_id: "G1", role: "story_reader" },
      { membership_id: "G2", role: "member" },
      { membership_id: "G3", role: "story_reader" },
      { membership_id: "G4", role: "viewer" },
      { membership_id: "G5", role: "story_reader" },
      { membership_id: "G6", role: "owner" },
    ]);
  });

  it("names every invitation as a reader story_reader, open or accepted, and leaves the others", async () => {
    const rows = (await q("select invitation_id, role from invitations order by invitation_id")).rows;
    expect(rows).toEqual([
      { invitation_id: "I1", role: "story_reader" },
      { invitation_id: "I2", role: "story_reader" },
      { invitation_id: "I3", role: "editor" },
    ]);
  });

  it("leaves no grant or invitation named reader", async () => {
    expect((await q("select 1 from memberships where role = 'reader' union all select 1 from invitations where role = 'reader'")).rowCount).toBe(0);
  });
});
