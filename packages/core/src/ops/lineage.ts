import { z } from "zod";
import { productId, recordActivity, tenantId } from "../common.ts";
import { json, type LineageInput } from "../db.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { id } from "../schemas.ts";
import { canonicalJson, sha256Hex } from "../util.ts";
import { loadRecord } from "./sources.ts";

const inputRef = z.strictObject({ kind: z.enum(["record", "assumption", "decision"]), id: z.string().min(1) });

type Status = "current" | "changed" | "archived" | "deleted" | "missing";

/** A fingerprint of an input as it is now, or why it cannot be fingerprinted. */
async function fingerprint(ctx: OpContext, ref: { kind: string; id: string }): Promise<{ fingerprint: string | null; status: Exclude<Status, "changed" | "current"> | "ok" }> {
  if (ref.kind === "record") {
    const r = await ctx.db.selectFrom("records").selectAll().where("record_id", "=", ref.id).executeTakeFirst();
    if (!r || r.product_id !== productId(ctx)) {
      const t = await ctx.db.selectFrom("tombstones").select("object_id").where("object_id", "=", ref.id).executeTakeFirst();
      return { fingerprint: null, status: t ? "deleted" : "missing" };
    }
    const primary = await ctx.db.selectFrom("files").select("current_version_id").where("record_id", "=", r.record_id).where("role", "=", "primary").executeTakeFirst();
    const fp = sha256Hex(canonicalJson({ kind: r.kind, title: r.title, date: r.date, organization: r.organization, primary_version: primary?.current_version_id ?? null, derivation: r.current_derivation_id, archived: Boolean(r.archived_at) }));
    return { fingerprint: fp, status: r.archived_at ? "archived" : "ok" };
  }
  const e = await ctx.db.selectFrom("register_entries").selectAll().where("entry_id", "=", ref.id).executeTakeFirst();
  if (!e || e.product_id !== productId(ctx) || e.kind !== ref.kind) return { fingerprint: null, status: "missing" };
  const fp = sha256Hex(canonicalJson({ statement: e.statement, body: e.body, citations: e.citations, status: e.status, review_count: e.review_count, archived: Boolean(e.archived_at) }));
  return { fingerprint: fp, status: e.archived_at ? "archived" : "ok" };
}

export const capture = defineOperation({
  name: "lineage.capture",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Fingerprint up to 50 inputs (sources, assumptions, decisions) before you generate a view from them.",
  description:
    "Step 1 of 3: capture the inputs, generate the view, upload it as a new source (kind view, analysis or digest), then call write with the untouched fingerprints. An archived input is refused.",
  input: z.strictObject({ inputs: z.array(inputRef).min(1).max(50) }),
  rest: { method: "POST", path: "/lineage/capture" },
  mcp: { tool: "lineage", action: "capture" },
  async handler(ctx, input) {
    const seen = new Set<string>();
    const out: LineageInput[] = [];
    for (const ref of input.inputs) {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) throw invalid("duplicate_input", `Input ${key} is listed twice.`);
      seen.add(key);
      const f = await fingerprint(ctx, ref);
      if (f.status !== "ok") throw conflict("input_unavailable", `Input ${ref.kind} ${ref.id} is ${f.status}; a view cannot be built on it.`);
      out.push({ kind: ref.kind, id: ref.id, fingerprint: f.fingerprint! });
    }
    return { inputs: out, captured_at: ctx.now };
  },
});

export const write = defineOperation({
  name: "lineage.write",
  scope: "product",
  access: "write",
  mutates: true,
  summary: "Register a view source's input baseline. Write-once: a changed input must never quietly become a new baseline.",
  description:
    "Pass the view's record_id, the inputs exactly as capture returned them, and the query_spec that describes how you selected them. Refused with 409 if any input changed since capture (regenerate the view) or if the view already has lineage (create a new view).",
  input: z.strictObject({
    record_id: id("source").describe("The view source."),
    inputs: z.array(z.strictObject({ kind: z.enum(["record", "assumption", "decision"]), id: z.string().min(1), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(50),
    query_spec: z.strictObject({
      description: z.string().min(1).max(2000).describe("How the inputs were chosen, in words."),
      query: z.string().max(2000).optional(),
      mode: z.enum(["substring", "ranked"]).optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  rest: { method: "POST", path: "/sources/:record_id/lineage" },
  mcp: { tool: "lineage", action: "write" },
  async handler(ctx, input) {
    const view = await loadRecord(ctx, input.record_id, { live: true });
    if (input.inputs.some((i) => i.kind === "record" && i.id === view.record_id)) throw invalid("invalid_input", "A view cannot list itself as an input.");
    const existing = await ctx.db.selectFrom("lineage").select("record_id").where("record_id", "=", view.record_id).executeTakeFirst();
    if (existing) throw conflict("lineage_exists", "This source already has lineage; create a new view to regenerate.");
    for (const i of input.inputs) {
      const f = await fingerprint(ctx, i);
      if (f.status !== "ok" || f.fingerprint !== i.fingerprint) throw conflict("input_changed", `Input ${i.kind} ${i.id} changed since capture (${f.status === "ok" ? "changed" : f.status}); regenerate the view.`);
    }
    await ctx.db.insertInto("lineage").values({ record_id: view.record_id, tenant_id: tenantId(ctx), product_id: productId(ctx), inputs: json(input.inputs), query_spec: json(input.query_spec), generated_by: json(ctx.actor) }).execute();
    await recordActivity(ctx, { action: "lineage_registered", entity_type: "source", entity_id: view.record_id, entity_title: view.title, summary: `Registered ${input.inputs.length} input${input.inputs.length === 1 ? "" : "s"} for this view` });
    return { record_id: view.record_id, inputs: input.inputs, query_spec: input.query_spec, registered_at: ctx.now };
  },
});

export const check = defineOperation({
  name: "lineage.check",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Is this view stale? Reports each direct input as current, changed, archived, deleted or missing.",
  description: "Direct inputs only; nothing is regenerated. registered_at marks when lineage was written, not when any model ran. 404 means the source has no lineage.",
  input: z.strictObject({ record_id: id("source") }),
  rest: { method: "GET", path: "/sources/:record_id/lineage" },
  mcp: { tool: "lineage", action: "check" },
  async handler(ctx, input) {
    await loadRecord(ctx, input.record_id);
    const l = await ctx.db.selectFrom("lineage").selectAll().where("record_id", "=", input.record_id).executeTakeFirst();
    if (!l) throw notFound("This source has no lineage.");
    const checks = [];
    for (const i of l.inputs) {
      const f = await fingerprint(ctx, i);
      const status: Status = f.status === "ok" ? (f.fingerprint === i.fingerprint ? "current" : "changed") : f.status;
      checks.push({ kind: i.kind, id: i.id, status });
    }
    return { record_id: l.record_id, query_spec: l.query_spec, registered_at: l.generated_at, registered_by: l.generated_by, stale: checks.some((c) => c.status !== "current"), input_checks: checks, checked_at: ctx.now, scope: "direct_inputs" };
  },
});

export const lineageOps = [capture, write, check];
