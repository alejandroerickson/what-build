import { randomBytes } from "node:crypto";
import { usageSettled } from "@whatbuild/core";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createDb, migrate } from "../src/database.ts";
import { chooseOrganizations, copyOrganizations, DEPLOYMENT_TABLES, organizationsToPull, ownedByInstanceOwners } from "../src/organization-copy.ts";
import { syncExampleTenant } from "../src/example-organization.ts";
import { startHarness, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

let h: Harness;
let source: pg.Client;
let target: pg.Client;
let kept: Organization;
let left: Organization;
let loner: string;
/** An organization a customer owns alone. */
let theirs: { slug: string; id: string };

const adminUrlOf = (database: string) => {
  const url = new URL(inject("adminUrl"));
  url.pathname = `/${database}`;
  return url.toString();
};

/** Every row of every table in the database, as text, so a test can look for anything in it. */
async function everything(c: pg.Client) {
  const tables = (await c.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).rows;
  const parts: string[] = [];
  for (const { table_name: t } of tables) parts.push(...(await c.query<{ row: string }>(`select x::text as row from "${t}" x`)).rows.map((r) => r.row));
  return parts.join("\n");
}

beforeAll(async () => {
  h = await startHarness();
  const owner = await h.signIn("owner@sample.example", "Sample Owner");
  kept = await buildOrganization(h, owner, "Sample Example", "Kept7Q");
  left = await buildOrganization(h, owner, "Private Ideas", "Left9Z");
  expect(await syncExampleTenant(h.db, kept.tenant.slug, () => {})).toBe(kept.tenant.id);
  // Someone who belongs only to the organization left behind, signed in, with an agent connected.
  const other = await h.signIn("ideas@sample.example", "Left9Z Ideas Person");
  expect((await owner.api("POST", `/api/v1/tenants/${left.tenant.slug}/members`, { email: "ideas@sample.example", role: "editor", team: left.team.slug })).status).toBe(201);
  await h.connectAgent(other);
  loner = (await other.api("GET", "/api/v1/me")).body.account_id;
  // The organization left behind is owned by a customer too, beside the instance owner.
  expect((await owner.api("POST", `/api/v1/tenants/${left.tenant.slug}/members`, { email: "ideas@sample.example", role: "owner" })).status).toBe(201);
  const customer = await h.signIn("customer@sample.example", "Sample Customer");
  const made = await customer.api("POST", "/api/v1/tenants", { name: "Customer Work" });
  expect(made.status).toBe(201);
  theirs = { slug: made.body.tenant.slug, id: made.body.tenant.tenant_id };
  await usageSettled();

  // The deployment, read as its backup role reads it: past row-level security.
  const name = (await sql<{ db: string }>`select current_database() as db`.execute(h.db)).rows[0]!.db;
  source = new pg.Client({ connectionString: adminUrlOf(name) });
  await source.connect();
  // An allowance to create organizations, and someone on the public site's interest list.
  await source.query("insert into tenant_allowances (email, allowed, etag, created_by, updated_by) values ('owner@sample.example', 3, 'e1', '{}', '{}')");
  await source.query("insert into interest (interest_id, email) values ('01JZZZZZZZZZZZZZZZZZZZZZZZ', 'interested@sample.example')");
  // The copy: the same schema and no rows, as a schema-only restore of the deployment leaves it.
  const copy = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: inject("adminUrl") });
  await admin.connect();
  await admin.query(`create database "${copy}" owner whatbuild`);
  await admin.end();
  const app = createDb(inject("appUrlTemplate").replace("{db}", copy), 1);
  await migrate(app.db, () => {});
  await app.pool.end();
  target = new pg.Client({ connectionString: adminUrlOf(copy) });
  await target.connect();
  await target.query("delete from schema_migrations");
});

afterAll(async () => {
  await source?.end();
  await target?.end();
  await h?.close();
});

describe("copying an organization out of a deployment", () => {
  it("chooses the example organization unless organizations are named, and refuses one the deployment does not have", async () => {
    expect((await chooseOrganizations(source, [])).map((o) => o.slug)).toEqual([kept.tenant.slug]);
    expect((await chooseOrganizations(source, [left.tenant.slug])).map((o) => o.slug)).toEqual([left.tenant.slug]);
    await expect(chooseOrganizations(source, ["no-such-org"])).rejects.toThrow(/no organization no-such-org/);
    // A deployment that has not yet taken the release that replaced the public sandbox marks its sandbox instead.
    await source.query("alter table tenants rename column example to sandbox");
    try {
      expect(await chooseOrganizations(source, [])).toEqual([expect.objectContaining({ slug: kept.tenant.slug, example: true })]);
    } finally {
      await source.query("alter table tenants rename column sandbox to example");
    }
  });

  it("refuses a table it has no rule for", async () => {
    await source.query("create table stray_notes (note text)");
    try {
      await expect(copyOrganizations(source, target, [kept.tenant.id])).rejects.toThrow(/no rule for stray_notes/);
    } finally {
      await source.query("drop table stray_notes");
    }
    expect((await target.query("select 1 from tenants")).rowCount).toBe(0);
  });

  it("takes the organization's rows, its people and the schema's record, and nothing of any other organization or of the deployment", async () => {
    const counts = await copyOrganizations(source, target, [kept.tenant.id]);

    expect((await target.query("select tenant_id from tenants")).rows).toEqual([{ tenant_id: kept.tenant.id }]);
    const owned = (await target.query<{ table_name: string }>("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id' and table_name <> 'tenants'")).rows.map((r) => r.table_name);
    for (const t of owned) {
      const want = (await source.query<{ n: number }>(`select count(*)::int as n from "${t}" where tenant_id = $1`, [kept.tenant.id])).rows[0]!.n;
      expect((await target.query<{ n: number }>(`select count(*)::int as n from "${t}"`)).rows[0]!.n, t).toBe(want);
      expect(counts[t], t).toBe(want);
    }
    expect(counts["records"]).toBeGreaterThan(0);
    expect(counts["jobs"]).toBeGreaterThan(0);

    // Its members, and no one who belongs only elsewhere.
    const people = (await target.query<{ account_id: string }>("select account_id from accounts")).rows.map((r) => r.account_id).sort();
    expect(people).toEqual([kept.ownerAccountId, kept.member.accountId].sort());
    expect(people).not.toContain(loner);

    // The deployment's own rows stay behind, though the source has some in each of these.
    for (const t of ["sessions", "oauth_clients", "oauth_tokens", "tenant_allowances", "interest", "usage_calls", "usage_people"]) {
      expect(DEPLOYMENT_TABLES).toContain(t);
      expect((await source.query(`select 1 from "${t}" limit 1`)).rowCount, t).toBe(1);
      expect((await target.query<{ n: number }>(`select count(*)::int as n from "${t}"`)).rows[0]!.n, t).toBe(0);
    }
    expect((await target.query("select name from schema_migrations order by 1")).rows).toEqual((await source.query("select name from schema_migrations order by 1")).rows);

    const all = await everything(target);
    expect(all).toContain(kept.marker);
    expect(all).not.toContain(left.marker);
    for (const s of left.secrets.filter((s) => !kept.secrets.includes(s))) expect(all).not.toContain(s);
    expect(all).not.toContain(left.tenant.id);

    // A job queued in the copy takes the next number after the ones it holds.
    const max = (await target.query<{ n: string }>("select max(job_id)::text as n from jobs")).rows[0]!.n;
    const next = (await target.query<{ job_id: string }>("insert into jobs (tenant_id, kind, payload) values ($1, 'noop', '{}') returning job_id::text", [kept.tenant.id])).rows[0]!.job_id;
    expect(BigInt(next)).toBeGreaterThan(BigInt(max));
  });
});

describe("a copy outside production", () => {
  // owner@sample.example runs the deployment; the customer and the person who co-owns the organization left behind do not.
  const instanceOwners = ["owner@sample.example"];

  it("is an organization's only when every one of its owners is an instance owner", () => {
    expect(ownedByInstanceOwners(["owner@sample.example"], instanceOwners)).toBe(true);
    expect(ownedByInstanceOwners(["Owner@Sample.example"], instanceOwners)).toBe(true);
    expect(ownedByInstanceOwners(["owner@sample.example", "customer@sample.example"], instanceOwners)).toBe(false);
    expect(ownedByInstanceOwners([], instanceOwners)).toBe(false);
  });

  it("takes the example organization, which an instance owner owns", async () => {
    expect((await organizationsToPull(source, { slugs: [], instanceOwners })).organizations.map((o) => o.slug)).toEqual([kept.tenant.slug]);
    expect((await organizationsToPull(source, { slugs: [kept.tenant.slug], instanceOwners })).organizations.map((o) => o.slug)).toEqual([kept.tenant.slug]);
  });

  it("refuses an organization a customer owns, alone or beside an instance owner, says why, and names none of its people", async () => {
    const alone = organizationsToPull(source, { slugs: [theirs.slug], instanceOwners });
    await expect(alone).rejects.toThrow(/holds only organizations an instance owner owns/);
    await expect(alone).rejects.toThrow(new RegExp(`${theirs.slug}: 1 of its 1 owner is not an instance owner`));
    await expect(alone).rejects.toThrow(/Customers' organizations never leave production/);
    await expect(alone).rejects.not.toThrow(/customer@sample\.example/);
    const shared = organizationsToPull(source, { slugs: [kept.tenant.slug, left.tenant.slug], instanceOwners });
    await expect(shared).rejects.toThrow(new RegExp(`This one is not:\\n  ${left.tenant.slug}: 1 of its 2 owners is not an instance owner`));
    await expect(shared).rejects.not.toThrow(/ideas@sample\.example/);
    // An organization of instance owners only is refused too while the deployment names others as its instance owners.
    await expect(organizationsToPull(source, { slugs: [], instanceOwners: ["someone-else@sample.example"] })).rejects.toThrow(new RegExp(`${kept.tenant.slug}: 1 of its 1 owner is not an instance owner`));
  });

  it("takes with --all every organization the instance owners own, and only counts the others", async () => {
    const all = await organizationsToPull(source, { slugs: [], all: true, instanceOwners });
    expect(all.organizations.map((o) => o.slug)).toEqual([kept.tenant.slug]);
    const tenants = (await source.query<{ n: number }>("select count(*)::int as n from tenants")).rows[0]!.n;
    expect(all.others).toBe(tenants - 1);
    await expect(organizationsToPull(source, { slugs: [], all: true, instanceOwners: ["nobody@sample.example"] })).rejects.toThrow(/own no organization/);
  });

  it("takes the organizations named, whoever owns them, only to move them into another production deployment", async () => {
    expect((await organizationsToPull(source, { slugs: [theirs.slug, left.tenant.slug], instanceOwners: null })).organizations.map((o) => o.slug).sort()).toEqual([theirs.slug, left.tenant.slug].sort());
    await expect(organizationsToPull(source, { slugs: [], all: true, instanceOwners: null })).rejects.toThrow(/names its organizations/);
  });
});
