import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRowSecurity } from "../src/database.ts";
import { startHarness, type Harness } from "./harness.ts";
import { buildOrganization, type Organization } from "./organization-fixture.ts";

// The third of the three layers of tenant isolation: forced row-level security on every content
// table, keyed on the transaction-local app.tenant_id. Read from the migrated schema itself, so a
// future migration that adds a table and forgets the policy fails here.

/**
 * Tables that carry tenant_id without row-level security, and why. Each is reached only through the
 * authorization layer, as okf/spec/04-data-model.md §4.15 says. A table leaves this list when it
 * gains the policy; a new one joins it only with a reason the specification gives.
 */
const DIRECTORY_WITH_TENANT_ID: Record<string, string> = {
  tenants: "directory: the organization itself, resolved before a transaction is scoped to it",
  tenant_slugs: "directory: the slugs an organization had before, resolved with it",
  teams: "directory: resolved by the policy module before a transaction is scoped",
  products: "directory: resolved by the policy module before a transaction is scoped",
  memberships: "directory: the grants authorization reads",
  invitations: "directory: looked up by token before the invitee belongs to the organization",
  jobs: "the job queue: claimed across tenants by the worker, which then scopes each job's transaction",
  feedback: "write-only from both front doors; it names no organization, and its digest goes to the deployment's own address",
  limit_counters: "operational: the counters behind a free organization's limits",
};

/** Tables with no tenant_id at all: they belong to no organization. */
const NOT_TENANT_DATA: Record<string, string> = {
  schema_migrations: "the migration runner's record",
  accounts: "directory: people, who may belong to several organizations",
  sessions: "directory: a person's browser sessions",
  email_tokens: "directory: sign-in links",
  oauth_clients: "directory: registered MCP clients",
  oauth_codes: "directory: OAuth authorization codes",
  oauth_tokens: "directory: OAuth tokens, which are a person's",
  tenant_allowances: "directory: how many organizations an address may create",
  interest: "the public site's interest form; nobody there belongs to an organization yet",
  feedback_counts: "how many reports a person sent today, for the daily limit; no organization, and never which reports",
  usage_calls: "how the service is used: counts of calls, naming no organization, product or person",
  usage_people: "who came back, under a pseudonym: no organization, product or account",
};

/** Guarded tables the organization below leaves empty, and why. */
const EMPTY_HERE: Record<string, string> = {
  insights: "retired: what it held moved into sources, and nothing writes it",
};

interface TableRow {
  name: string;
  rls: boolean;
  forced: boolean;
  owner: string;
  has_tenant: boolean;
}

interface PolicyRow {
  table: string;
  name: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

let h: Harness;
let tables: TableRow[];
let policies: PolicyRow[];
let appRole: string;
let org: Organization;

/** The policy expression Postgres stores for `tenant_id = current_setting('app.tenant_id', true)`. */
const TENANT_PREDICATE = /^\(tenant_id = current_setting\('app\.tenant_id'::text, true\)\)$/;

beforeAll(async () => {
  h = await startHarness();
  org = await buildOrganization(h, await h.signIn("rls-owner@example.com", "Rowan"), "Larkspur Holdings", "LARKSPUR9");
  appRole = (await sql<{ u: string }>`select current_user as u`.execute(h.db)).rows[0]!.u;
  tables = (
    await sql<TableRow>`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced, pg_get_userbyid(c.relowner) as owner,
        exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped) as has_tenant
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p')
      order by c.relname`.execute(h.db)
  ).rows;
  policies = (
    await sql<PolicyRow>`
      select tablename as table, policyname as name, permissive, roles, cmd, qual, with_check
      from pg_policies where schemaname = current_schema()`.execute(h.db)
  ).rows;
});
afterAll(async () => h?.close());

const guarded = () => tables.filter((t) => t.has_tenant && !(t.name in DIRECTORY_WITH_TENANT_ID));

describe("row-level security in the migrated schema", () => {
  it("connects as a role that row-level security binds, so it must be forced on the tables that role owns", async () => {
    const r = await checkRowSecurity(h.db);
    expect(r.enforced, `${r.role} is a superuser or has BYPASSRLS`).toBe(true);
    // The application owns its tables (it runs the migrations), and an owner bypasses row-level
    // security unless the table forces it.
    expect(tables.length).toBeGreaterThan(30);
    expect(tables.filter((t) => t.owner !== appRole).map((t) => t.name)).toEqual([]);
  });

  it("enables and forces row-level security on every table with tenant_id, except the directory tables the specification names", () => {
    const missing = guarded().filter((t) => !t.rls || !t.forced).map((t) => `${t.name} (enabled ${t.rls}, forced ${t.forced})`);
    expect(missing).toEqual([]);
    // The exemptions stay true: each names a table that exists, carries tenant_id and has no policy.
    for (const name of Object.keys(DIRECTORY_WITH_TENANT_ID)) {
      const t = tables.find((x) => x.name === name);
      expect(t, `${name} is listed as exempt but does not exist`).toBeTruthy();
      expect(t!.has_tenant, `${name} is listed as exempt but has no tenant_id`).toBe(true);
      expect(t!.rls, `${name} now has row-level security: take it off the exempt list`).toBe(false);
    }
  });

  it("gives every guarded table a policy that reads and writes only the transaction's tenant, and none that widens it", () => {
    for (const t of guarded()) {
      const own = policies.filter((p) => p.table === t.name);
      expect(own.length, `${t.name} has row-level security but no policy`).toBeGreaterThan(0);
      // Permissive policies are OR-ed: one without the tenant predicate would open the table.
      for (const p of own.filter((x) => x.permissive === "PERMISSIVE")) {
        expect(p.qual ?? "", `${t.name}.${p.name} USING`).toMatch(TENANT_PREDICATE);
        if (p.cmd !== "SELECT" && p.cmd !== "DELETE") expect(p.with_check ?? p.qual ?? "", `${t.name}.${p.name} WITH CHECK`).toMatch(TENANT_PREDICATE);
      }
      const all = own.find((p) => p.permissive === "PERMISSIVE" && p.cmd === "ALL");
      expect(all, `${t.name} needs a policy for every command`).toBeTruthy();
    }
  });

  it("knows every table: one without tenant_id must be named as belonging to no organization", () => {
    const unknown = tables.filter((t) => !t.has_tenant && !(t.name in NOT_TENANT_DATA)).map((t) => t.name);
    expect(unknown, "a new table holds no tenant_id: content tables carry tenant_id and the policy").toEqual([]);
    for (const name of Object.keys(NOT_TENANT_DATA)) expect(tables.some((t) => t.name === name), `${name} is listed but does not exist`).toBe(true);
  });
});

describe("row-level security at work", () => {
  /** Rows of each guarded table visible in a transaction scoped to `tenant` (or to none). */
  async function visible(tenant: string | null): Promise<Record<string, number>> {
    return h.db.transaction().execute(async (trx) => {
      if (tenant !== null) await sql`select set_config('app.tenant_id', ${tenant}, true)`.execute(trx);
      const out: Record<string, number> = {};
      for (const t of guarded()) out[t.name] = Number((await sql<{ n: string }>`select count(*) as n from ${sql.table(t.name)}`.execute(trx)).rows[0]!.n);
      return out;
    });
  }

  it("shows an organization's rows to its own transactions only", async () => {
    const own = await visible(org.tenant.id);
    // The organization fills every guarded table but these; an empty one would prove nothing below.
    const empty = Object.entries(own).filter(([, n]) => n === 0).map(([name]) => name);
    expect(empty.sort(), JSON.stringify(own)).toEqual(Object.keys(EMPTY_HERE).sort());
    const other = await visible("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(Object.entries(other).filter(([, n]) => n > 0)).toEqual([]);
    const unscoped = await visible(null);
    expect(Object.entries(unscoped).filter(([, n]) => n > 0)).toEqual([]);
  });

  it("refuses to move a row to another tenant, or to write one for another tenant, in every guarded table", async () => {
    const own = await visible(org.tenant.id);
    for (const t of guarded()) {
      if (!own[t.name]) continue;
      const error = await h.db
        .transaction()
        .execute(async (trx) => {
          await sql`select set_config('app.tenant_id', ${org.tenant.id}, true)`.execute(trx);
          await sql`update ${sql.table(t.name)} set tenant_id = 'another-tenant'`.execute(trx);
          return null;
        })
        .catch((e: { code?: string; message?: string }) => e);
      expect(error?.code, `${t.name}: ${error?.message ?? "the update went through"}`).toBe("42501");
    }
    // An insert for another tenant meets the same check.
    const insert = await h.db
      .transaction()
      .execute(async (trx) => {
        await sql`select set_config('app.tenant_id', ${org.tenant.id}, true)`.execute(trx);
        await sql`insert into tombstones (tenant_id, product_id, object_type, object_id, title, reason, deleted_by) values ('another-tenant', 'p', 'source', 'x', 't', 'r', '{}')`.execute(trx);
      })
      .catch((e: { code?: string }) => e);
    expect((insert as { code?: string } | undefined)?.code).toBe("42501");
  });
});
