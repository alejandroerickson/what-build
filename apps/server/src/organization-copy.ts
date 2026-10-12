import type pg from "pg";

/**
 * A copy of some of a deployment's organizations (okf/operations/copying-an-organization.md): their
 * rows, read from the deployment in one snapshot through a role that bypasses row-level security,
 * and written into an empty database with the deployment's schema. Nothing of any other
 * organization is read. The accounts that come along are the ones the copied rows refer to.
 */

export type Organization = { tenant_id: string; slug: string; name: string; sandbox: boolean };

/**
 * What belongs to the deployment rather than to an organization, and stays behind: sign-in and
 * connections, allowances to create organizations, the public site's interest list, usage counts.
 */
export const DEPLOYMENT_TABLES = [
  "sessions", "email_tokens", "personal_access_tokens", "oauth_clients", "oauth_codes", "oauth_tokens",
  "tenant_allowances", "interest", "usage_calls", "usage_people",
];

/** The organizations named by slug, or, with none named, the deployment's public sandbox. Reads no other organization. */
export async function chooseOrganizations(c: pg.Client, slugs: string[]): Promise<Organization[]> {
  if (!slugs.length) {
    const sandbox = (await c.query<Organization>("select tenant_id, slug, name, sandbox from tenants where sandbox order by slug")).rows;
    if (sandbox.length === 1) return sandbox;
    throw new Error(
      sandbox.length
        ? `The deployment has ${sandbox.length} public sandboxes: name the organizations with --org <slug>.`
        : "The deployment has no public sandbox: name the organizations with --org <slug>, or take everything with --all.",
    );
  }
  const found = (await c.query<Organization>("select tenant_id, slug, name, sandbox from tenants where slug = any($1) order by slug", [slugs])).rows;
  const missing = slugs.filter((s) => !found.some((t) => t.slug === s));
  if (missing.length) throw new Error(`The deployment has no organization ${missing.join(", ")}.`);
  return found;
}

async function tablesWith(c: pg.Client, column: string) {
  const r = await c.query<{ table_name: string }>(
    "select table_name from information_schema.columns where table_schema = 'public' and column_name = $1 and table_name <> 'tenants' order by 1",
    [column],
  );
  return r.rows.map((x) => x.table_name);
}

export async function storedColumns(c: pg.Client, table: string) {
  const r = await c.query<{ attname: string }>(
    "select attname from pg_attribute where attrelid = to_regclass($1) and attnum > 0 and not attisdropped and attgenerated = '' order by attnum",
    [`public.${table}`],
  );
  return r.rows.map((x) => x.attname);
}

/**
 * Copy the organizations' rows from `source` into `target`, which has the same schema and no rows.
 * `source` reads in one repeatable-read snapshot, as pg_dump does; `target` is a superuser's, so
 * row-level security and triggers stay out of the way and foreign keys are checked once at the end.
 * A table the copy has no rule for stops it: someone decides whether it belongs to organizations.
 * Returns how many rows of each table it copied, every table of the schema included.
 */
export async function copyOrganizations(source: pg.Client, target: pg.Client, tenantIds: string[]) {
  const inTenants = `tenant_id in (${tenantIds.map((id) => source.escapeLiteral(id)).join(", ")})`;
  const counts: Record<string, number> = {};
  await source.query("begin isolation level repeatable read read only");
  try {
    const owned = await tablesWith(source, "tenant_id");
    const all = (await source.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows.map((r) => r.table_name);
    const unknown = all.filter((t) => !owned.includes(t) && !["tenants", "accounts", "schema_migrations", ...DEPLOYMENT_TABLES].includes(t));
    if (unknown.length)
      throw new Error(`The copy has no rule for ${unknown.join(", ")}: say in apps/server/src/organization-copy.ts whether ${unknown.length === 1 ? "it belongs" : "they belong"} to the deployment or to an organization.`);

    // The people the organizations' rows point at: members above all.
    const accountRefs = await source.query<{ child: string; col: string }>(`
      select conrelid::regclass::text as child, (select attname from pg_attribute where attrelid = conrelid and attnum = conkey[1]) as col
      from pg_constraint where contype = 'f' and confrelid = 'public.accounts'::regclass and connamespace = 'public'::regnamespace`);
    const people = accountRefs.rows.filter((r) => owned.includes(r.child)).map((r) => `select "${r.col}" from "${r.child}" where ${inTenants}`);

    await target.query("begin");
    try {
      await target.query("set local session_replication_role = replica");
      const copy = async (table: string, where: string) => {
        const cols = (await storedColumns(target, table)).map((col) => `"${col}"`).join(", ");
        await source.query(`declare rows_of no scroll cursor for select to_jsonb(x) as row from "${table}" x where ${where}`);
        let n = 0;
        for (;;) {
          const batch = (await source.query<{ row: Record<string, unknown> }>("fetch 500 from rows_of")).rows.map((r) => r.row);
          if (!batch.length) break;
          await target.query(`insert into "${table}" (${cols}) select ${cols} from jsonb_populate_recordset(null::"${table}", $1)`, [JSON.stringify(batch)]);
          n += batch.length;
        }
        await source.query("close rows_of");
        counts[table] = n;
      };
      await copy("tenants", inTenants);
      for (const table of owned) await copy(table, inTenants);
      await copy("accounts", people.length ? `account_id in (${people.join(" union ")})` : "false");
      await copy("schema_migrations", "true");
      for (const table of all) counts[table] ??= 0;
      await setSequences(target);
      await target.query("commit");
    } catch (e) {
      await target.query("rollback");
      throw e;
    }
  } finally {
    await source.query("rollback");
  }
  await checkReferences(target, "The copy");
  await checkFileKeys(target);
  return counts;
}

/** Each sequence a column draws from continues after the rows the copy holds. */
async function setSequences(c: pg.Client) {
  const seqs = await c.query<{ seq: string; tbl: string; col: string }>(`
    select s.oid::regclass::text as seq, t.relname as tbl, a.attname as col
    from pg_class s
    join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
    join pg_class t on t.oid = d.refobjid
    join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
    where s.relkind = 'S' and s.relnamespace = 'public'::regnamespace`);
  for (const s of seqs.rows) await c.query(`select setval($1::regclass, coalesce(max("${s.col}"), 1), max("${s.col}") is not null) from "${s.tbl}"`, [s.seq]);
}

/**
 * Every stored file an organization's rows name is under its own folder, t/<tenant_id>/, which is
 * what a copy takes of the files. A key outside it would be a file the copy leaves behind.
 */
async function checkFileKeys(c: pg.Client) {
  const r = await c.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name like '%blob%' and data_type = 'text' and table_name in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id') order by 1, 2",
  );
  const outside: string[] = [];
  for (const { table_name: t, column_name: col } of r.rows) {
    const n = (await c.query<{ n: number }>(`select count(*)::int as n from "${t}" where "${col}" is not null and "${col}" not like 't/' || tenant_id || '/%'`)).rows[0]!.n;
    if (n) outside.push(`${n} rows of ${t} (${col})`);
  }
  if (outside.length) throw new Error(`Some files are outside their organization's folder, so the copy would miss them:\n  ${outside.join("\n  ")}`);
}

/** Every foreign key holds: nothing points at a row the database does not have. */
export async function checkReferences(c: pg.Client, what: string) {
  const fks = await c.query<{ child: string; parent: string; cols: string[]; pcols: string[] }>(`
    select conrelid::regclass::text as child, confrelid::regclass::text as parent,
      array(select attname::text from pg_attribute where attrelid = conrelid and attnum = any(conkey) order by array_position(conkey, attnum)) as cols,
      array(select attname::text from pg_attribute where attrelid = confrelid and attnum = any(confkey) order by array_position(confkey, attnum)) as pcols
    from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`);
  const broken: string[] = [];
  for (const fk of fks.rows) {
    const notNull = fk.cols.map((col) => `c.${col} is not null`).join(" and ");
    const match = fk.cols.map((col, i) => `p.${fk.pcols[i]} = c.${col}`).join(" and ");
    const r = await c.query<{ n: number }>(`select count(*)::int as n from ${fk.child} c where ${notNull} and not exists (select 1 from ${fk.parent} p where ${match})`);
    if (r.rows[0]!.n) broken.push(`${r.rows[0]!.n} rows of ${fk.child} (${fk.cols.join(", ")}) point at missing ${fk.parent}`);
  }
  if (broken.length) throw new Error(`${what} would have broken references:\n  ${broken.join("\n  ")}`);
}
