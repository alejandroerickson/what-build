import { sql } from "kysely";
import type { z } from "zod";
import { json, type ActorSnapshot, type Db } from "./db.ts";
import { AppError, conflict, invalid } from "./errors.ts";
import { resolveIdAlias } from "./id-aliases.ts";
import { resolveScope, type ScopeRef } from "./policy.ts";
import type { Ports } from "./ports.ts";
import type { OpContext, OperationDef, Principal, Scope } from "./registry.ts";
import { formatIssues } from "./schemas.ts";

export interface Env {
  db: Db;
  ports: Ports;
}

export function actorOf(p: Principal): ActorSnapshot {
  return { account_id: p.account_id, display_name: p.display_name, surface: p.surface, client: p.client };
}

/** Scope fields that ride inside `input` for tenant- and team-scoped operations. */
function refFromInput(op: OperationDef, input: Record<string, unknown>, ref: ScopeRef): ScopeRef {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  if (op.scope === "tenant") return { tenant: str(input["tenant"]) ?? ref.tenant };
  if (op.scope === "team") return { tenant: str(input["tenant"]) ?? ref.tenant, team: str(input["team"]) ?? ref.team };
  return ref;
}

export function parseInput<I extends z.ZodType>(op: OperationDef<I>, raw: unknown): z.output<I> {
  const parsed = op.input.safeParse(resolveIdAlias(op, raw ?? {}));
  if (!parsed.success) {
    throw invalid("invalid_input", `${formatIssues(parsed.error)}. Nothing was changed.`, { operation: op.name });
  }
  return parsed.data;
}

/**
 * The one way an operation runs, whichever door the call came through: resolve and authorize the
 * scope, validate the input strictly, then run the handler in one transaction that is
 * scoped to the tenant (row-level security) and writes its activity event alongside the change.
 */
export async function execute(env: Env, principal: Principal, op: OperationDef, rawInput: unknown, ref: ScopeRef = {}): Promise<{ result: unknown; scope: Scope }> {
  // Scope first: a caller who cannot see the product learns nothing, not even whether their input was valid.
  const raw = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const scope = await resolveScope(env.db, principal, op.scope, op.access, refFromInput(op, raw, ref), op.name);
  const input = parseInput(op, rawInput) as Record<string, unknown>;
  if (op.mutates && scope.product?.archived_at && !op.allowArchivedProduct)
    throw conflict("product_archived", `Product ${scope.product.name} is archived and read-only. Restore it first.`);
  let enqueued = false;
  const now = new Date().toISOString();
  const result = await env.db.transaction().execute(async (trx) => {
    if (scope.tenant) await sql`select set_config('app.tenant_id', ${scope.tenant.tenant_id}, true)`.execute(trx);
    const ctx: OpContext = {
      principal,
      actor: actorOf(principal),
      db: trx,
      scope,
      ports: env.ports,
      now,
      async enqueue(kind, payload) {
        await trx.insertInto("jobs").values({ tenant_id: scope.tenant?.tenant_id ?? "", kind, payload: json(payload) }).execute();
        enqueued = true;
      },
    };
    return op.handler(ctx, input as never);
  });
  if (enqueued) env.ports.notifyJobs?.();
  return { result, scope };
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const pg = e as { code?: string; constraint?: string; message?: string };
  if (pg?.code === "23505") return conflict("conflict", "That conflicts with something that already exists. Read the current state and retry.", { constraint: pg.constraint });
  if (pg?.code === "40001" || pg?.code === "40P01") return conflict("concurrent_change", "Another change landed at the same moment. Retry.");
  return new AppError(500, "internal", "WhatBuild hit an unexpected error. It has been logged; try again, and report it with submit_feedback if it repeats.");
}
