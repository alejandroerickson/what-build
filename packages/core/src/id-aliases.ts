import { invalid } from "./errors.ts";
import type { OperationDef } from "./registry.ts";

/**
 * The entity id goes by `outcome_id` on outcomes but by `id` on assumptions. Each tool also accepts the other convention for its own entity id, so a caller who
 * guesses either name is understood. Canonical names stay as they are, so no caller breaks.
 */
const ALIASES: Record<string, { canonical: string; alias: string }> = {
  outcomes: { canonical: "outcome_id", alias: "id" },
  assumptions: { canonical: "id", alias: "assumption_id" },
};

/** The alias an operation accepts for its entity id, if any. */
export function idAliasOf(op: OperationDef): { canonical: string; alias: string } | null {
  const a = ALIASES[op.mcp.tool];
  const shape = (op.input as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  return a && a.canonical in shape && !(a.alias in shape) ? a : null;
}

/** Rename an alias to the canonical field before strict validation. Returns the input unchanged when there is none. */
export function resolveIdAlias(op: OperationDef, raw: unknown): unknown {
  const a = idAliasOf(op);
  if (!a || !raw || typeof raw !== "object" || Array.isArray(raw) || !(a.alias in raw)) return raw;
  const { [a.alias]: value, ...rest } = raw as Record<string, unknown>;
  if (rest[a.canonical] !== undefined && rest[a.canonical] !== value)
    throw invalid("invalid_input", `${a.alias} and ${a.canonical} name different items; ${a.alias} is another name for ${a.canonical}, so send one. Nothing was changed.`, { operation: op.name });
  return { ...rest, [a.canonical]: value };
}
