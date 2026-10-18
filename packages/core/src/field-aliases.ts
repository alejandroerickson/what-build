import { invalid } from "./errors.ts";
import type { OperationDef } from "./registry.ts";

interface Alias {
  canonical: string;
  alias: string;
}

/**
 * The entity id goes by `outcome_id` on outcomes but by `id` on assumptions. Each tool also accepts the other convention for its own entity id, so a caller who
 * guesses either name is understood.
 */
const ID_ALIASES: Record<string, Alias> = {
  outcomes: { canonical: "outcome_id", alias: "id" },
  assumptions: { canonical: "id", alias: "assumption_id" },
};

/** Fields an operation also accepts under the name a caller reads them by: a page's notes come back as `agent_notes.content`. */
const FIELD_ALIASES: Record<string, Alias[]> = {
  "story.write_notes": [{ canonical: "notes", alias: "content" }],
};

/**
 * Fields a caller sends to the wrong operation because a neighbouring one takes them, and what to
 * say: refused as unknown, with the hint added to the message.
 */
const WRONG_FIELD_HINTS: Record<string, { fields: string[]; hint: string }> = {
  // What the passage reader took (start, end, unit, seq), and length, a common guess at limit.
  "derived.text": {
    fields: ["start", "end", "unit", "seq", "length"],
    hint: " derived(action=\"text\") reads by code-point offset: send offset and limit, where the window starts (such as a little before a search hit's char_start) and how many characters it holds. There are no passages to read by number.",
  },
};

/** A hint when a call names a field a neighbouring operation takes, or "". */
export function wrongFieldHint(op: OperationDef, unknownKeys: string[]): string {
  const h = WRONG_FIELD_HINTS[op.name];
  return h && unknownKeys.some((k) => h.fields.includes(k)) ? h.hint : "";
}

/** The aliases an operation accepts. Canonical names stay as they are, so no caller breaks. */
export function aliasesOf(op: OperationDef): Alias[] {
  const shape = (op.input as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  const id = ID_ALIASES[op.mcp.tool];
  return [...(id ? [id] : []), ...(FIELD_ALIASES[op.name] ?? [])].filter((a) => a.canonical in shape && !(a.alias in shape));
}

/** Rename each alias to its canonical field before strict validation. Returns the input unchanged when there is none. */
export function resolveAliases(op: OperationDef, raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  let input = raw as Record<string, unknown>;
  for (const a of aliasesOf(op)) {
    if (!(a.alias in input)) continue;
    const { [a.alias]: value, ...rest } = input;
    if (rest[a.canonical] !== undefined && rest[a.canonical] !== value)
      throw invalid("invalid_input", `\`${a.alias}\` and \`${a.canonical}\` differ; \`${a.alias}\` is another name for \`${a.canonical}\`, so send one. Nothing was changed.`, { operation: op.name });
    input = { ...rest, [a.canonical]: value };
  }
  return input;
}
