import { CONTENT_TABLES, newId } from "@whatbuild/core";
import type pg from "pg";
import { checkReferences, storedColumns } from "./organization-copy.ts";

/**
 * Shaping a restored copy of production into the end-to-end golden master
 * (okf/operations/end-to-end-tests.md): only the example organization stays, and a second
 * organization, not the example, gets a copy of its content under new ids, so every plan can run the
 * same products both ways. Run as the embedded server's superuser, which row-level security does
 * not restrict.
 */

const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Columns that hold file storage keys. The copy shares the files: blobs are immutable, and keys are never parsed back into ids. */
const SHARED = (column: string) => column.includes("blob");

async function tablesWith(c: pg.Client, column: string) {
  const r = await c.query<{ table_name: string }>(
    "select table_name from information_schema.columns where table_schema = 'public' and column_name = $1 and table_name <> 'tenants' order by 1",
    [column],
  );
  return r.rows.map((x) => x.table_name);
}

/**
 * Remove every organization but one, the accounts that belong to none of what is left, and what
 * only a running deployment needs: sessions, tokens, sign-in links, the public site's interest
 * list. Foreign keys are checked once at the end rather than ordered table by table.
 */
export async function keepOnlyTenant(c: pg.Client, tenantId: string) {
  await c.query("begin");
  try {
    await c.query("set local session_replication_role = replica");
    for (const t of await tablesWith(c, "tenant_id")) await c.query(`delete from ${t} where tenant_id is distinct from $1`, [tenantId]);
    await c.query("delete from tenants where tenant_id <> $1", [tenantId]);
    for (const t of ["sessions", "oauth_codes", "oauth_tokens", "oauth_clients", "email_tokens", "interest"]) await c.query(`delete from ${t}`);
    await c.query("delete from accounts a where not exists (select 1 from memberships m where m.account_id = a.account_id)");
    await c.query("delete from tenant_allowances t where not exists (select 1 from accounts a where lower(a.email) = lower(t.email))");
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
  await checkReferences(c, "The golden master");
}

/**
 * Copy one organization's content into a new organization that is not the example: its teams,
 * products and everything in them, the search index of their sources, the activity log and its
 * memberships, with every id made new and every reference to an old
 * id, in any column or JSON, pointing at the new one. Files are shared.
 */
export async function copyTenant(c: pg.Client, fromTenantId: string, slug: string, name: string) {
  // The copy may be from before some of these tables existed: its own migrations come later.
  const present = new Set(await tablesWith(c, "tenant_id"));
  // The index is copied with what it indexes, as it stands once the build's jobs are done, so the
  // copy finds what the original finds. A piece's offsets hold, since a new id is as long as the old.
  const tables = [...CONTENT_TABLES, "text_chunks", "memberships"].filter((t) => present.has(t));
  const people = (await c.query<{ account_id: string }>("select account_id from accounts")).rows;
  const accounts = new Set(people.map((p) => p.account_id));
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const t of tables) rows.set(t, (await c.query<{ row: Record<string, unknown> }>(`select to_jsonb(x) as row from ${t} x where tenant_id = $1`, [fromTenantId])).rows.map((r) => r.row));

  // Every id the organization's rows name, other than people's: those are the ones made new. A new
  // id keeps the old one's time (a ULID's first ten characters), so lists ordered by id, such as
  // activity, keep the original's order in the copy.
  const again = (old: string) => old.slice(0, 10) + newId().slice(10);
  const ids = new Map<string, string>([[fromTenantId, again(fromTenantId)]]);
  for (const list of rows.values())
    for (const row of list)
      for (const [col, v] of Object.entries(row)) if ((col.endsWith("_id") || col === "id") && typeof v === "string" && ID.test(v) && !accounts.has(v) && !ids.has(v)) ids.set(v, again(v));
  const pattern = new RegExp([...ids.keys()].join("|"), "g");
  const remap = (v: unknown): unknown =>
    typeof v === "string" ? v.replace(pattern, (m) => ids.get(m)!) : Array.isArray(v) ? v.map(remap) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)])) : v;

  await c.query("begin");
  try {
    const t = (await c.query<{ row: Record<string, unknown> }>("select to_jsonb(t) as row from tenants t where tenant_id = $1", [fromTenantId])).rows[0]!.row;
    await c.query("insert into tenants select * from jsonb_populate_record(null::tenants, $1)", [{ ...t, tenant_id: ids.get(fromTenantId), slug, name, example: false }]);
    for (const table of tables) {
      const cols = await storedColumns(c, table);
      const list = rows
        .get(table)!
        .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, SHARED(k) ? v : remap(v)])));
      for (let i = 0; i < list.length; i += 500)
        await c.query(`insert into ${table} (${cols.join(", ")}) select ${cols.join(", ")} from jsonb_populate_recordset(null::${table}, $1)`, [JSON.stringify(list.slice(i, i + 500))]);
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
  await checkReferences(c, "The golden master");
  return ids;
}
