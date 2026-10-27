import type { ActorSnapshot, Db } from "./db.ts";
import { json } from "./db.ts";
import { defaultPlans, definedPlans, GUEST_DEFAULTS, GUEST_FIELDS, LIMITS, type GuestSettings, type Limits, type PlanSettings } from "./plans.ts";
import { newEtag } from "./util.ts";

/**
 * What an instance owner sets for the whole deployment, stored in `instance_settings` and read over
 * what the deployment's configuration defines (`plans.ts`): the guests' settings (key `guests`) and
 * each plan's limits and price (key `plan:<plan>`). Every call that meets a limit reads them, so they are kept for a few seconds;
 * a change made through this process is read at once, and by another instance within that time.
 */

interface Row {
  key: string;
  value: Record<string, unknown>;
  etag: string;
  updated_at: string;
  updated_by: ActorSnapshot | null;
}

const KEPT_MS = 15_000;
let kept: { at: number; rows: Map<string, Row> } | null = null;

/** Forget what was read, so the next call reads the stored settings again. */
export function forgetSettings(): void {
  kept = null;
}

async function rows(db: Db): Promise<Map<string, Row>> {
  if (kept && Date.now() - kept.at < KEPT_MS) return kept.rows;
  const found = await db.selectFrom("instance_settings").select(["key", "value", "etag", "updated_at", "updated_by"]).execute();
  const map = new Map(found.map((r) => [r.key, r as Row]));
  kept = { at: Date.now(), rows: map };
  return map;
}

/** A stored value of the right kind, or nothing. Totals may be null: no limit. */
function readLimit(key: keyof Limits, v: unknown): number | boolean | null | undefined {
  const info = LIMITS.find((l) => l.key === key);
  if (!info) return undefined;
  if (info.group === "switch") return typeof v === "boolean" ? v : undefined;
  if (v === null) return info.group === "total" || key === "sent_bytes_per_day" ? null : undefined;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/** Each plan's limits and price as the deployment has them: an instance owner's changes over what its configuration defines. */
export async function readPlans(db: Db): Promise<PlanSettings> {
  const stored = await rows(db);
  const plans = defaultPlans();
  for (const { id } of definedPlans()) {
    const row = stored.get(`plan:${id}`);
    if (!row) continue;
    const limits = (row.value["limits"] ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(limits)) {
      const read = readLimit(k as keyof Limits, v);
      if (read !== undefined) (plans[id]!.limits as Record<string, unknown>)[k] = read;
    }
    const price = row.value["price"];
    // A price an instance owner set, or cleared (null), replaces the configured one.
    if (price === null || (typeof price === "string" && !price.trim())) plans[id]!.price = null;
    else if (typeof price === "string") plans[id]!.price = price.trim();
  }
  return plans;
}

/** The guests' settings as the deployment has them, its own changes over the defaults. */
export async function readGuests(db: Db): Promise<GuestSettings> {
  const row = (await rows(db)).get("guests");
  const out: GuestSettings = { ...GUEST_DEFAULTS };
  for (const f of GUEST_FIELDS) {
    const v = row?.value[f.key];
    if (f.unit === "switch" ? typeof v === "boolean" : typeof v === "number" && Number.isInteger(v) && v >= 0) (out as unknown as Record<string, unknown>)[f.key] = v;
  }
  return out;
}

/** Who changed a setting last, and the etag that guards it; null until it is first changed. */
export async function settingRecord(db: Db, key: string): Promise<{ etag: string | null; updated_at: string | null; updated_by: ActorSnapshot | null; value: Record<string, unknown> }> {
  const row = (await rows(db)).get(key);
  return { etag: row?.etag ?? null, updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null, value: row?.value ?? {} };
}

/** Store a setting's value whole, with a new etag, and read every setting again from the next call. */
export async function saveSetting(db: Db, key: string, value: Record<string, unknown>, actor: ActorSnapshot, now: string): Promise<string> {
  const etag = newEtag();
  await db
    .insertInto("instance_settings")
    .values({ key, value: json(value), etag, updated_at: now, updated_by: json(actor) })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: json(value), etag, updated_at: now, updated_by: json(actor) }))
    .execute();
  forgetSettings();
  return etag;
}

