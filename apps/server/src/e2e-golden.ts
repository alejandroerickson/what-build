import { BASELINE_TABLES, hashParts, inputFingerprint, isCurrent, json, newId, partHash, type Db, type LineageInput } from "@whatbuild/core";
import type pg from "pg";
import { checkReferences, storedColumns } from "./organization-copy.ts";

/**
 * Shaping a restored copy of production into the end-to-end golden master
 * (okf/operations/end-to-end-tests.md): only the public sandbox's organization stays, and a second
 * organization, not a sandbox, gets a copy of its content under new ids, so every plan can run the
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
 * Copy one organization's content into a new organization that is not a sandbox: its teams,
 * products and everything in them, the activity log and the memberships of everyone but its
 * visitors, with every id made new and every reference to an old id, in any column or JSON,
 * pointing at the new one. Files are shared.
 */
export async function copyTenant(c: pg.Client, fromTenantId: string, slug: string, name: string) {
  // The copy may be from before some of these tables existed: its own migrations come later.
  const present = new Set(await tablesWith(c, "tenant_id"));
  const tables = [...BASELINE_TABLES, "memberships"].filter((t) => present.has(t));
  const people = (await c.query<{ account_id: string; sandbox_only: boolean }>("select account_id, sandbox_only from accounts")).rows;
  const accounts = new Set(people.map((p) => p.account_id));
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const t of tables) rows.set(t, (await c.query<{ row: Record<string, unknown> }>(`select to_jsonb(x) as row from ${t} x where tenant_id = $1`, [fromTenantId])).rows.map((r) => r.row));
  // A visitor belongs to the sandbox alone: an account an invitation made, or anyone holding a
  // visitor's seat there. None of their grants is copied, the seat or a role on a team or product.
  const visitors = new Set(people.filter((p) => p.sandbox_only).map((p) => p.account_id));
  for (const m of rows.get("memberships") ?? []) if (m["scope_type"] === "tenant" && m["role"] === "visitor") visitors.add(m["account_id"] as string);

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
    await c.query("insert into tenants select * from jsonb_populate_record(null::tenants, $1)", [{ ...t, tenant_id: ids.get(fromTenantId), slug, name, sandbox: false }]);
    for (const table of tables) {
      const cols = await storedColumns(c, table);
      const list = rows
        .get(table)!
        .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, SHARED(k) ? v : remap(v)])))
        .filter((row) => table !== "memberships" || !visitors.has(row["account_id"] as string));
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

/**
 * A view's lineage fingerprints its inputs, and a fingerprint covers ids (a source's file version and
 * derivation, an assumption's citations), so the copy's ids would make every view's inputs look
 * changed. Where an input was current in the original, its fingerprint and parts are taken again
 * from the copy; where it had changed, it stays changed in the same parts.
 */
export async function refreshCopiedLineage(db: Db, ids: Map<string, string>) {
  const original = new Map([...ids].map(([from, to]) => [to, from]));
  const rows = await db.selectFrom("lineage").select(["record_id", "product_id", "inputs"]).execute();
  for (const row of rows.filter((r) => original.has(r.product_id))) {
    const inputs: LineageInput[] = [];
    for (const input of row.inputs) {
      const was = await inputFingerprint(db, original.get(row.product_id)!, { kind: input.kind, id: original.get(input.id) ?? input.id });
      const now = await inputFingerprint(db, row.product_id, input);
      if (now.fingerprint && now.parts && isCurrent(input, was)) {
        // Current in the original, by the same rule check uses: current in the copy, fingerprinted as it is there.
        inputs.push({ kind: input.kind, id: input.id, fingerprint: now.fingerprint, parts: hashParts(now.parts) });
        continue;
      }
      // Changed in the original: each part that still matched there is taken again from the copy, so
      // the copy reports the same parts changed.
      const parts = input.parts && was.parts && now.parts
        ? Object.fromEntries(Object.entries(input.parts).map(([k, h]) => [k, k in was.parts!.values && h === partHash(was.parts!.values[k]) ? partHash(now.parts!.values[k]) : h]))
        : input.parts;
      inputs.push({ ...input, ...(parts ? { parts } : {}) });
    }
    await db.updateTable("lineage").set({ inputs: json(inputs) }).where("record_id", "=", row.record_id).execute();
  }
}
