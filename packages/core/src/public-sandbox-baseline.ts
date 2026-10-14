import { sql } from "kysely";
import { json, type ActorSnapshot, type Db } from "./db.ts";
import { conflict, notFound } from "./errors.ts";
import { queueEvidenceMoves } from "./evidence-move.ts";
import { lockSettings } from "./public-sandbox.ts";
import { newId } from "./util.ts";

/**
 * A baseline is a public sandbox's content at one moment: every row of content in the tables below
 * that carries the organization's `tenant_id`, each held as JSON. A reset deletes the organization's
 * content and puts a baseline back, ids and all, so links keep working from one day to the next.
 *
 * Blobs are immutable and keyed by file version, so a baseline refers to them and never copies
 * them. A blob goes only when no row and no kept baseline refers to it.
 */

/**
 * The tables a baseline holds, each after the tables it refers to. A reset deletes in the reverse
 * order. A baseline saved before insights and decisions moved into Evidence still holds them; a
 * reset puts them back and the worker moves them again.
 */
export const BASELINE_TABLES = [
  "teams", "products",
  "records", "files", "file_versions", "derivations", "segments", "annotations", "agent_notes", "lineage",
  "outcomes", "insights", "revisions", "register_entries", "reviews",
  "story_pages", "story_versions", "story_hierarchies", "story_styles",
  "mockups", "mockup_versions", "mockup_pages", "mockup_files", "mockup_prototype_files",
  "activity", "tombstones",
] as const;

/** Every other table that carries `tenant_id`, and why a baseline leaves it out. A test holds the two lists complete. */
export const NOT_IN_BASELINE: Record<string, string> = {
  memberships: "Access is not content: a reset never gives back a role that was taken away, or takes one that was given.",
  invitations: "Access, as memberships.",
  sandbox_invites: "Access, as memberships.",
  sandbox_settings: "The sandbox's own settings, which a reset reads.",
  sandbox_usage: "Counters; a reset clears them.",
  sandbox_baselines: "The baselines themselves.",
  sandbox_baseline_rows: "The baselines themselves.",
  jobs: "Work in progress; a reset drops what has not run.",
  upload_grants: "An upload in progress does not outlive a reset.",
  mockup_uploads: "An upload in progress does not outlive a reset.",
  story_previews: "A preview lasts as long as its grant, and not past a reset.",
  exports: "A visitor's export does not outlive a reset.",
  feedback: "Goes to the maintainers, and names no tenant.",
};

/**
 * The rows of a table that are content. The activity log is two things: what happened in a product,
 * which is content and goes back with it, and what happened to the organization (people, access,
 * the sandbox's settings, baselines and resets), which is its record and stays through every reset.
 */
const CONTENT_ONLY: Record<string, string> = { activity: "product_id is not null" };

const contentOf = (table: string) => (CONTENT_ONLY[table] ? sql` and ${sql.raw(CONTENT_ONLY[table]!)}` : sql``);

/** How many baselines a sandbox keeps. The newest is the one in use unless staff reset to an earlier one. */
export const BASELINES_KEPT = 3;

const BLOB_CHUNK = 500;

type Enqueue = (kind: string, payload: Record<string, unknown>) => Promise<void>;

interface BlobRefs {
  keys: Set<string>;
  prefixes: Set<string>;
}

async function columnsOf(trx: Db, table: string): Promise<{ stored: string[]; generated: string[] }> {
  const r = await sql<{ attname: string; attgenerated: string }>`
    select attname, attgenerated from pg_attribute
    where attrelid = to_regclass(${`public.${table}`}) and attnum > 0 and not attisdropped
    order by attnum`.execute(trx);
  return { stored: r.rows.filter((c) => !c.attgenerated).map((c) => c.attname), generated: r.rows.filter((c) => c.attgenerated).map((c) => c.attname) };
}

/** The blobs the organization's rows refer to now. */
async function liveBlobs(trx: Db, tenantId: string): Promise<BlobRefs> {
  const versions = await trx.selectFrom("file_versions").select("blob_key").where("tenant_id", "=", tenantId).execute();
  const grants = await trx.selectFrom("upload_grants").select("blob_key").where("tenant_id", "=", tenantId).where("uploaded_at", "is not", null).execute();
  const exports = await trx.selectFrom("exports").select("blob_key").where("tenant_id", "=", tenantId).execute();
  const canvases = await trx.selectFrom("mockup_uploads").select("blob_key").where("tenant_id", "=", tenantId).where("uploaded_at", "is not", null).where("used_at", "is", null).execute();
  const derivations = await trx.selectFrom("derivations").select("blob_prefix").where("tenant_id", "=", tenantId).execute();
  const prototypes = await trx.selectFrom("mockup_prototype_files").select("blob_key").distinct().where("tenant_id", "=", tenantId).execute();
  return {
    keys: new Set([...versions, ...grants, ...exports, ...canvases, ...prototypes].map((r) => r.blob_key).filter((k): k is string => Boolean(k))),
    prefixes: new Set(derivations.map((d) => d.blob_prefix)),
  };
}

/** The blobs the organization's baselines refer to: all of them, or only the ones named. */
export async function baselineBlobs(trx: Db, tenantId: string, baselineIds?: string[]): Promise<BlobRefs> {
  if (baselineIds && !baselineIds.length) return { keys: new Set(), prefixes: new Set() };
  const only = baselineIds ? sql`and baseline_id in (${sql.join(baselineIds)})` : sql``;
  const r = await sql<{ table_name: string; ref: string | null }>`
    select distinct table_name, coalesce(row->>'blob_key', row->>'blob_prefix') as ref
    from sandbox_baseline_rows
    where tenant_id = ${tenantId} and table_name in ('file_versions', 'mockup_prototype_files', 'derivations') ${only}`.execute(trx);
  return {
    keys: new Set(r.rows.filter((x) => x.table_name !== "derivations" && x.ref).map((x) => x.ref!)),
    prefixes: new Set(r.rows.filter((x) => x.table_name === "derivations" && x.ref).map((x) => x.ref!)),
  };
}

const minus = (a: Set<string>, ...others: Set<string>[]) => [...a].filter((k) => others.every((o) => !o.has(k)));

/** Queue the deletion of blobs nothing refers to any more. Returns how many were queued. */
async function dropBlobs(enqueue: Enqueue, keys: string[], prefixes: string[]): Promise<number> {
  for (let i = 0; i < keys.length; i += BLOB_CHUNK) await enqueue("delete_blobs", { keys: keys.slice(i, i + BLOB_CHUNK), prefixes: [] });
  for (let i = 0; i < prefixes.length; i += BLOB_CHUNK) await enqueue("delete_blobs", { keys: [], prefixes: prefixes.slice(i, i + BLOB_CHUNK) });
  return keys.length + prefixes.length;
}

/**
 * What a blob-deleting job may delete in a tenant: everything it names that no baseline refers
 * to. A source deleted by the sandbox's staff keeps its bytes while a baseline would bring it back.
 */
export async function blobsSafeToDelete(trx: Db, tenantId: string, keys: string[], prefixes: string[]): Promise<{ keys: string[]; prefixes: string[] }> {
  if (!keys.length && !prefixes.length) return { keys, prefixes };
  const tenant = await trx.selectFrom("tenants").select("sandbox").where("tenant_id", "=", tenantId).executeTakeFirst();
  const any = await trx.selectFrom("sandbox_baselines").select("baseline_id").where("tenant_id", "=", tenantId).limit(1).executeTakeFirst();
  if (!tenant?.sandbox && !any) return { keys, prefixes };
  const held = await baselineBlobs(trx, tenantId);
  return { keys: keys.filter((k) => !held.keys.has(k)), prefixes: prefixes.filter((p) => !held.prefixes.has(p)) };
}

/**
 * Save the organization's content as a new baseline and put it in use. The caller's transaction
 * is scoped to the tenant and holds the sandbox's lock alone.
 */
export async function saveBaseline(trx: Db, tenantId: string, by: ActorSnapshot, note: string, enqueue: Enqueue) {
  await lockSettings(trx, tenantId);
  const baseline_id = newId();
  await trx.insertInto("sandbox_baselines").values({ baseline_id, tenant_id: tenantId, note, counts: json({}), created_by: json(by) }).execute();
  const counts: Record<string, number> = {};
  for (const table of BASELINE_TABLES) {
    const { generated } = await columnsOf(trx, table);
    // A generated column is computed again on the way back in, so it is left out.
    const r = await sql`
      insert into sandbox_baseline_rows (baseline_id, tenant_id, table_name, row)
      select ${baseline_id}, ${tenantId}, ${table}, to_jsonb(t) - ${sql.val(generated)}::text[]
      from ${sql.table(table)} as t where t.tenant_id = ${tenantId}${contentOf(table)}`.execute(trx);
    counts[table] = Number(r.numAffectedRows ?? 0);
  }
  await trx.updateTable("sandbox_baselines").set({ counts: json(counts) }).where("baseline_id", "=", baseline_id).execute();
  // The content is the baseline at this moment, as it is after a reset: a sandbox that has never been
  // reset has nothing overdue, and its first reset comes at the next scheduled hour.
  await trx
    .updateTable("sandbox_settings")
    .set({ baseline_id, last_reset_at: sql<string>`coalesce(last_reset_at, now())` })
    .where("tenant_id", "=", tenantId)
    .execute();

  // Keep the newest few. A blob that only a dropped baseline referred to goes with it.
  const all = await trx.selectFrom("sandbox_baselines").select("baseline_id").where("tenant_id", "=", tenantId).orderBy("baseline_id", "desc").execute();
  const dropped = all.slice(BASELINES_KEPT).map((b) => b.baseline_id);
  let blobs_dropped = 0;
  if (dropped.length) {
    const gone = await baselineBlobs(trx, tenantId, dropped);
    await trx.deleteFrom("sandbox_baselines").where("baseline_id", "in", dropped).execute();
    const kept = await baselineBlobs(trx, tenantId);
    const live = await liveBlobs(trx, tenantId);
    blobs_dropped = await dropBlobs(enqueue, minus(gone.keys, kept.keys, live.keys), minus(gone.prefixes, kept.prefixes, live.prefixes));
  }
  const row = await trx.selectFrom("sandbox_baselines").selectAll().where("baseline_id", "=", baseline_id).executeTakeFirstOrThrow();
  return { ...baselineView(row, baseline_id), baselines_dropped: dropped.length, blobs_dropped };
}

export function baselineView(b: { baseline_id: string; note: string; counts: Record<string, number>; created_at: string; created_by: ActorSnapshot }, inUse: string | null) {
  const c = b.counts;
  return {
    baseline_id: b.baseline_id,
    in_use: b.baseline_id === inUse,
    note: b.note,
    created_at: b.created_at,
    created_by: b.created_by,
    rows: Object.values(c).reduce((n, x) => n + x, 0),
    holds: {
      products: c["products"] ?? 0,
      sources: c["records"] ?? 0,
      passages: c["segments"] ?? 0,
      outcomes: c["outcomes"] ?? 0,
      assumptions: c["register_entries"] ?? 0,
      story_pages: c["story_pages"] ?? 0,
      mockups: c["mockups"] ?? 0,
    },
  };
}

/**
 * Put the organization's content back to a baseline: delete every row of content it holds, insert
 * the baseline's, drop work in progress and the day's counters, and queue the deletion of blobs
 * nothing refers to any more. People and their access are left as they are, except that a grant on
 * a team or product the baseline does not hold goes, and a visitor idle past the limit gives up
 * their seat. The caller's transaction is scoped to the tenant and holds the sandbox's lock alone.
 */
export async function resetToBaseline(
  trx: Db,
  tenantId: string,
  opts: { baseline_id?: string | undefined; by: ActorSnapshot; scheduled: boolean; idle_days: number; now: string; enqueue: Enqueue },
) {
  const settings = await lockSettings(trx, tenantId);
  const baselineId = opts.baseline_id ?? settings.baseline_id;
  if (!baselineId) throw conflict("no_baseline", "This sandbox has no baseline to reset to. Save one first with sandbox(action=\"save_baseline\").");
  const baseline = await trx.selectFrom("sandbox_baselines").select("baseline_id").where("baseline_id", "=", baselineId).where("tenant_id", "=", tenantId).executeTakeFirst();
  if (!baseline) throw notFound("No such baseline in this sandbox. List them with sandbox(action=\"baselines\").");

  const before = await liveBlobs(trx, tenantId);

  await sql`delete from jobs where tenant_id = ${tenantId} and done_at is null and kind in ('derive', 'export', 'move_to_evidence')`.execute(trx);
  for (const table of ["exports", "upload_grants", "mockup_uploads", "story_previews", ...[...BASELINE_TABLES].reverse()])
    await sql`delete from ${sql.table(table)} where tenant_id = ${tenantId}${contentOf(table)}`.execute(trx);
  await trx.deleteFrom("sandbox_usage").where("tenant_id", "=", tenantId).execute();

  let rows = 0;
  for (const table of BASELINE_TABLES) {
    const first = await sql<{ keys: string[] }>`
      select array(select jsonb_object_keys(row)) as keys from sandbox_baseline_rows
      where baseline_id = ${baselineId} and table_name = ${table} limit 1`.execute(trx);
    const saved = first.rows[0]?.keys;
    if (!saved) continue;
    // Only the columns the baseline holds: one added since keeps its default, one dropped since is ignored.
    const { stored } = await columnsOf(trx, table);
    const columns = stored.filter((c) => saved.includes(c));
    const list = sql.join(columns.map((c) => sql.ref(c)));
    const from = sql.join(columns.map((c) => sql.ref(`r.${c}`)));
    const r = await sql`
      insert into ${sql.table(table)} (${list})
      select ${from} from sandbox_baseline_rows b
      cross join lateral jsonb_populate_record(null::${sql.table(table)}, b.row) as r
      where b.baseline_id = ${baselineId} and b.table_name = ${table}`.execute(trx);
    rows += Number(r.numAffectedRows ?? 0);
  }

  const dangling = await sql`
    delete from memberships m where m.tenant_id = ${tenantId} and (
      (m.scope_type = 'team' and not exists (select 1 from teams t where t.team_id = m.scope_id)) or
      (m.scope_type = 'product' and not exists (select 1 from products p where p.product_id = m.scope_id)))`.execute(trx);
  let visitors_removed = 0;
  if (opts.idle_days > 0) {
    const idle = await sql`
      delete from memberships m
      where m.tenant_id = ${tenantId} and m.scope_type = 'tenant' and m.role = 'visitor'
        and m.created_at < now() - make_interval(days => ${opts.idle_days})
        and not exists (select 1 from sessions s where s.account_id = m.account_id and s.last_seen_at > now() - make_interval(days => ${opts.idle_days}))
        and not exists (select 1 from oauth_tokens o where o.account_id = m.account_id and coalesce(o.last_used_at, o.created_at) > now() - make_interval(days => ${opts.idle_days}))`.execute(trx);
    visitors_removed = Number(idle.numAffectedRows ?? 0);
  }

  await queueEvidenceMoves(trx, opts.enqueue);

  const kept = await baselineBlobs(trx, tenantId);
  const blobs_dropped = await dropBlobs(opts.enqueue, minus(before.keys, kept.keys), minus(before.prefixes, kept.prefixes));

  const last_reset = {
    baseline_id: baselineId,
    scheduled: opts.scheduled,
    by: opts.by,
    rows,
    blobs_dropped,
    grants_removed: Number(dangling.numAffectedRows ?? 0),
    visitors_removed,
  };
  await trx.updateTable("sandbox_settings").set({ baseline_id: baselineId, last_reset_at: opts.now, last_reset: json(last_reset) }).where("tenant_id", "=", tenantId).execute();
  return { reset: true, reset_at: opts.now, ...last_reset };
}
