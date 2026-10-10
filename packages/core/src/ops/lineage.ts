import { z } from "zod";
import { productId, recordActivity, tenantId } from "../common.ts";
import { json, type Db, type LineageInput } from "../db.ts";
import { conflict, invalid, notFound } from "../errors.ts";
import { defineOperation, type OpContext } from "../registry.ts";
import { id } from "../schemas.ts";
import { canonicalJson, sha256Hex } from "../util.ts";
import { loadRecord } from "./sources.ts";

const inputRef = z.strictObject({ kind: z.enum(["record", "assumption"]), id: z.string().min(1) });

type Status = "current" | "changed" | "archived" | "deleted" | "missing";

/** The parts a fingerprint covers, and when each last changed, as far as the data records it. */
interface Parts {
  values: Record<string, unknown>;
  changedAt: Record<string, string | null>;
}

export interface Fingerprint {
  fingerprint: string | null;
  status: Exclude<Status, "changed" | "current"> | "ok";
  parts?: Parts;
}

/** A short hash of one part's value: enough to tell that it changed, without storing the content. */
export const partHash = (value: unknown) => sha256Hex(canonicalJson(value)).slice(0, 16);

export const hashParts = (parts: Parts): Record<string, string> => Object.fromEntries(Object.entries(parts.values).map(([k, v]) => [k, partHash(v)]));

/** A fingerprint of an input as it is now, or why it cannot be fingerprinted. */
const fingerprint = (ctx: OpContext, ref: { kind: string; id: string }) => inputFingerprint(ctx.db, productId(ctx), ref);

/** A fingerprint of an input of a view in this product as it is now, or why it cannot be fingerprinted. */
export async function inputFingerprint(db: Db, product: string, ref: { kind: string; id: string }): Promise<Fingerprint> {
  const ctx = { db };
  if (ref.kind === "record") {
    const r = await ctx.db.selectFrom("records").selectAll().where("record_id", "=", ref.id).executeTakeFirst();
    if (!r || r.product_id !== product) {
      const t = await ctx.db.selectFrom("tombstones").select("object_id").where("object_id", "=", ref.id).executeTakeFirst();
      return { fingerprint: null, status: t ? "deleted" : "missing" };
    }
    const primary = await ctx.db.selectFrom("files").select("current_version_id").where("record_id", "=", r.record_id).where("role", "=", "primary").executeTakeFirst();
    const values = { title: r.title, date: r.date, primary_version: primary?.current_version_id ?? null, derivation: r.current_derivation_id, archived: Boolean(r.archived_at) };
    const version = values.primary_version ? await ctx.db.selectFrom("file_versions").select("created_at").where("file_version_id", "=", values.primary_version).executeTakeFirst() : undefined;
    const derivation = values.derivation ? await ctx.db.selectFrom("derivations").select("created_at").where("derivation_id", "=", values.derivation).executeTakeFirst() : undefined;
    const changedAt = {
      title: r.updated_at,
      date: r.updated_at,
      primary_version: version?.created_at ?? null,
      derivation: derivation?.created_at ?? null,
      archived: r.archived_at ?? r.updated_at,
    };
    return { fingerprint: sha256Hex(canonicalJson(values)), status: r.archived_at ? "archived" : "ok", parts: { values, changedAt } };
  }
  const e = await ctx.db.selectFrom("register_entries").selectAll().where("entry_id", "=", ref.id).executeTakeFirst();
  if (!e || e.product_id !== product || e.kind !== ref.kind) return { fingerprint: null, status: "missing" };
  const values = { statement: e.statement, body: e.body, citations: e.citations, status: e.status, review_count: e.review_count, archived: Boolean(e.archived_at) };
  const changedAt = Object.fromEntries(Object.keys(values).map((k) => [k, e.updated_at]));
  return { fingerprint: sha256Hex(canonicalJson(values)), status: e.archived_at ? "archived" : "ok", parts: { values, changedAt } };
}

const PARTS_NOT_RECORDED =
  "Parts not recorded: this input was fingerprinted before WhatBuild stored what each fingerprint covers, or as a decision before decisions moved into Evidence, so only the whole fingerprint can be compared.";

/**
 * The parts of an input that differ from what was stored. A part stored then and no longer covered
 * (a source's kind and organization, which became tags) is ignored, and so is one covered now that
 * was not stored then.
 */
function changedParts(stored: Record<string, string>, now: Parts): string[] {
  return Object.keys(now.values).filter((k) => k in stored && stored[k] !== partHash(now.values[k]));
}

/**
 * Whether an input still matches its baseline: part by part where the parts were stored, else as a
 * whole, a source with the kind and organization it was fingerprinted with.
 */
export function isCurrent(stored: LineageInput, now: Fingerprint): boolean {
  if (stored.parts && now.parts) return changedParts(stored.parts, now.parts).length === 0;
  if (stored.was && now.parts) return sha256Hex(canonicalJson({ ...now.parts.values, ...stored.was })) === stored.fingerprint;
  return now.fingerprint === stored.fingerprint;
}

/** Which stored parts differ from the input as it is now, and when the latest of those changes was made. */
function diffParts(stored: Record<string, string> | undefined, now: Parts | undefined) {
  if (!stored || !now) return { changed_parts: null, last_changed_at: null, detail: PARTS_NOT_RECORDED };
  const changed = changedParts(stored, now);
  const times = changed.map((k) => now.changedAt[k]).filter((t): t is string => Boolean(t));
  const latest = times.length ? times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
  return { changed_parts: changed, last_changed_at: latest };
}

const DIRECT_ONLY =
  "Direct inputs only: a view built on an assumption is not told when a source that assumption cites is re-derived or edited; capture that source as an input too if it matters.";

export const capture = defineOperation({
  name: "lineage.capture",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Fingerprint up to 50 inputs (sources and assumptions) before you generate a view from them.",
  description: `Step 1 of 3: capture the inputs, generate the view, upload it as a new source tagged view (or analysis, digest), then call write with the untouched fingerprints and captured_at. An archived input is refused. ${DIRECT_ONLY}`,
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
    "Pass the view's record_id, the inputs exactly as capture returned them, captured_at from the same capture, and the query_spec that describes how you selected them. Refused with 409 if any input changed since capture (regenerate the view) or if the view already has lineage (create a new view). What each fingerprint covers is stored too, so check can say which parts of an input changed.",
  input: z.strictObject({
    record_id: id("source").describe("The view source."),
    inputs: z.array(z.strictObject({ kind: z.enum(["record", "assumption"]), id: z.string().min(1), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(50),
    captured_at: z.iso.datetime({ offset: true }).optional().describe("captured_at exactly as capture returned it."),
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
    if (input.captured_at && Date.parse(input.captured_at) > Date.parse(ctx.now)) throw invalid("invalid_input", "captured_at is in the future; pass it exactly as capture returned it.");
    const existing = await ctx.db.selectFrom("lineage").select("record_id").where("record_id", "=", view.record_id).executeTakeFirst();
    if (existing) throw conflict("lineage_exists", "This source already has lineage; create a new view to regenerate.");
    const stored: LineageInput[] = [];
    for (const i of input.inputs) {
      const f = await fingerprint(ctx, i);
      if (f.status !== "ok" || f.fingerprint !== i.fingerprint) throw conflict("input_changed", `Input ${i.kind} ${i.id} changed since capture (${f.status === "ok" ? "changed" : f.status}); regenerate the view.`);
      stored.push({ kind: i.kind, id: i.id, fingerprint: i.fingerprint, parts: hashParts(f.parts!) });
    }
    const capturedAt = input.captured_at ?? null;
    await ctx.db
      .insertInto("lineage")
      .values({ record_id: view.record_id, tenant_id: tenantId(ctx), product_id: productId(ctx), inputs: json(stored), query_spec: json(input.query_spec), captured_at: capturedAt, generated_by: json(ctx.actor) })
      .execute();
    await recordActivity(ctx, { action: "lineage_registered", entity_type: "source", entity_id: view.record_id, entity_title: view.title, summary: `Registered ${input.inputs.length} input${input.inputs.length === 1 ? "" : "s"} for this view` });
    return { record_id: view.record_id, inputs: input.inputs, query_spec: input.query_spec, captured_at: capturedAt, registered_at: ctx.now };
  },
});

export const check = defineOperation({
  name: "lineage.check",
  scope: "product",
  access: "read",
  mutates: false,
  summary: "Is this view stale? Reports each direct input as current, changed, archived, deleted or missing, and which parts of a changed input changed.",
  description: `A changed input lists changed_parts (for a source: title, date, primary_version, derivation, archived; for an assumption: statement, body, citations, status, review_count, archived) and last_changed_at, when the latest of those changes was made as far as WhatBuild records it. Lineage written before parts were stored reports changed_parts null with a note. Nothing is regenerated. captured_at is when capture fingerprinted the inputs (null if write was not given it); registered_at marks when lineage was written; neither is when any model ran. 404 means the source has no lineage. ${DIRECT_ONLY}`,
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
      const status: Status = f.status === "ok" ? (isCurrent(i, f) ? "current" : "changed") : f.status;
      checks.push(status === "changed" ? { kind: i.kind, id: i.id, status, ...diffParts(i.parts, f.parts) } : { kind: i.kind, id: i.id, status });
    }
    return {
      record_id: l.record_id,
      query_spec: l.query_spec,
      captured_at: l.captured_at,
      registered_at: l.generated_at,
      registered_by: l.generated_by,
      stale: checks.some((c) => c.status !== "current"),
      input_checks: checks,
      checked_at: ctx.now,
      scope: "direct_inputs",
    };
  },
});

export const lineageOps = [capture, write, check];
