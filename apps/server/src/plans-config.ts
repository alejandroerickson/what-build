import { readFileSync } from "node:fs";
import { LIMITS, PLAN_ID, UNLIMITED, type Limits, type PlanDefinition } from "@whatbuild/core";

/**
 * The plans a deployment offers, read from `WHATBUILD_PLANS`: JSON, or the path of a JSON file,
 * `{ "plans": [{ id, name, about, price, limits }] }` (`deploy/plans.example.json`). A deployment
 * that sets nothing offers no plans, and every organization on it is unlimited. Every limit is
 * required, so a plan never meets a limit nobody chose; a size may be bytes or a string such as
 * "10 MB" (1 MB is 1,048,576 bytes, as the app writes sizes). A plan that cannot be read stops the
 * server from starting, saying what is wrong.
 */
export function plansFrom(value: string | undefined): PlanDefinition[] {
  const raw = value?.trim();
  if (!raw) return [];
  let text = raw;
  if (!raw.startsWith("{")) {
    try {
      text = readFileSync(raw, "utf8");
    } catch {
      throw new Error(`WHATBUILD_PLANS names ${raw}, which can't be read. Give the plans as JSON, or the path of a JSON file such as deploy/plans.example.json.`);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`WHATBUILD_PLANS is not JSON: ${(e as Error).message}.`);
  }
  const list = (parsed as { plans?: unknown })?.plans;
  if (!Array.isArray(list)) throw new Error('WHATBUILD_PLANS must be { "plans": [ … ] }, as deploy/plans.example.json is.');
  const seen = new Set<string>();
  return list.map((p, i) => {
    const where = `WHATBUILD_PLANS, plan ${i + 1}`;
    if (!p || typeof p !== "object") throw new Error(`${where} is not an object.`);
    const { id, name, about, price, limits } = p as Record<string, unknown>;
    if (typeof id !== "string" || !PLAN_ID.test(id)) throw new Error(`${where}: id must be lowercase letters, digits, - and _, starting with a letter, such as "free".`);
    if (id === UNLIMITED) throw new Error(`${where}: "${UNLIMITED}" is the plan with no limits, which every deployment has; give this plan another id.`);
    if (seen.has(id)) throw new Error(`${where}: the id ${id} is used twice.`);
    seen.add(id);
    if (typeof name !== "string" || !name.trim() || name.length > 40) throw new Error(`${where} (${id}): name must be 1 to 40 characters, as people read it, such as "Free".`);
    if (about !== undefined && (typeof about !== "string" || about.length > 200)) throw new Error(`${where} (${id}): about must be a sentence of at most 200 characters.`);
    if (price !== undefined && price !== null && (typeof price !== "string" || price.length > 60)) throw new Error(`${where} (${id}): price must be text of at most 60 characters, such as "$20 a month", or null.`);
    return {
      id,
      name: name.trim(),
      about: typeof about === "string" ? about.trim() : "",
      price: typeof price === "string" && price.trim() ? price.trim() : null,
      limits: limitsFrom(limits, `${where} (${id})`),
    };
  });
}

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };

/** Every limit of one plan, each checked against what it may be. */
function limitsFrom(value: unknown, where: string): Limits {
  if (!value || typeof value !== "object") throw new Error(`${where}: limits must be an object with every limit, as deploy/plans.example.json has.`);
  const given = value as Record<string, unknown>;
  const unknown = Object.keys(given).filter((k) => !LIMITS.some((l) => l.key === k));
  if (unknown.length) throw new Error(`${where}: ${unknown.join(", ")} ${unknown.length === 1 ? "is not a limit" : "are not limits"}. The limits are ${LIMITS.map((l) => l.key).join(", ")}.`);
  const missing = LIMITS.filter((l) => !(l.key in given)).map((l) => l.key);
  if (missing.length) throw new Error(`${where}: every limit must be given; ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing.`);
  const out: Record<string, unknown> = {};
  for (const l of LIMITS) {
    const v = given[l.key];
    const nullable = l.group === "total" || l.key === "sent_bytes_per_day";
    if (l.group === "switch") {
      if (typeof v !== "boolean") throw new Error(`${where}: ${l.key} must be true or false.`);
      out[l.key] = v;
    } else if (v === null && nullable) out[l.key] = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[l.key] = v;
    else if (typeof v === "string" && l.unit === "bytes") {
      const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)\s*$/i.exec(v);
      if (!m) throw new Error(`${where}: ${l.key} must be bytes, or a size such as "10 MB".`);
      out[l.key] = Math.round(Number(m[1]) * UNITS[m[2]!.toLowerCase()]!);
    } else throw new Error(`${where}: ${l.key} must be a whole number of at least 0${nullable ? ", or null for no limit" : ""}${l.unit === "bytes" ? ', or a size such as "10 MB"' : ""}.`);
  }
  return out as Limits;
}

/**
 * The plan organizations someone other than an instance owner starts get
 * (`WHATBUILD_NEW_ORGANIZATION_PLAN`): one the deployment defines, or unlimited when it names none.
 */
export function startingPlanFrom(value: string | undefined, plans: PlanDefinition[]): string {
  const id = value?.trim().toLowerCase();
  if (!id || id === UNLIMITED) return UNLIMITED;
  if (plans.some((p) => p.id === id)) return id;
  throw new Error(
    plans.length
      ? `WHATBUILD_NEW_ORGANIZATION_PLAN names ${id}, which WHATBUILD_PLANS doesn't define; it defines ${plans.map((p) => p.id).join(", ")}.`
      : `WHATBUILD_NEW_ORGANIZATION_PLAN names ${id}, but WHATBUILD_PLANS defines no plans. Define them (see deploy/plans.example.json), or leave the setting out so every organization is unlimited.`,
  );
}
