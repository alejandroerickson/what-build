import { sql } from "kysely";
import type { z } from "zod";
import { json, type ActorSnapshot, type Db } from "./db.ts";
import { checkConnectorScope, type ConnectorScope } from "./connector-scope.ts";
import { AppError, conflict, invalid } from "./errors.ts";
import { resolveIdAlias } from "./id-aliases.ts";
import { resolveScope, type ScopeRef } from "./policy.ts";
import type { Ports } from "./ports.ts";
import type { OpContext, OperationDef, Principal, Scope } from "./registry.ts";
import { admitVisitor, checkVisitorInput, countVisitorWrite, isVisitor, loadSandbox, lockSandbox, visitorActor, visitorName, type SandboxContext } from "./public-sandbox.ts";
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

/** Fields sources no longer have, and what to send instead. */
const RETIRED_SOURCE_FIELDS = new Set(["kind", "organization", "folder"]);
const RETIRED_SOURCE_HINT =
  " Sources have no kind, organization or folder any more: say what the material is and whom it concerns with tags, reusing the ones sources(action=\"facets\") lists.";

/** A hint when a call to a sources, files or search operation names a field sources no longer have. */
function retiredFieldHint(op: OperationDef, error: z.ZodError): string {
  if (!["sources", "files", "search"].includes(op.mcp.tool)) return "";
  const named = error.issues.some((i) => i.code === "unrecognized_keys" && (i as { keys: string[] }).keys.some((k) => RETIRED_SOURCE_FIELDS.has(k)));
  return named ? RETIRED_SOURCE_HINT : "";
}

export function parseInput<I extends z.ZodType>(op: OperationDef<I>, raw: unknown): z.output<I> {
  const parsed = op.input.safeParse(resolveIdAlias(op, raw ?? {}));
  if (!parsed.success) {
    throw invalid("invalid_input", `${formatIssues(parsed.error)}. Nothing was changed.${retiredFieldHint(op, parsed.error)}`, { operation: op.name });
  }
  return parsed.data;
}

/**
 * The public sandbox a call is in, if any. A call addressed to a sandbox is in it. So is any call
 * outside a tenant from an account that a sandbox invitation created, which is how the sandbox's
 * limits cover the calls that name no organization.
 */
async function sandboxOf(env: Env, principal: Principal, scope: Scope): Promise<SandboxContext | null> {
  if (scope.tenant) {
    if (!scope.tenant.sandbox) return null;
    const visitor = isVisitor(scope);
    return { ...(await loadSandbox(env.db, scope.tenant.tenant_id)), visitor, appears_as: visitor ? visitorName(scope.tenant.tenant_id, principal.account_id) : null };
  }
  if (!principal.sandbox_only) return null;
  const held = await env.db
    .selectFrom("memberships as m")
    .innerJoin("tenants as t", "t.tenant_id", "m.tenant_id")
    .select("m.tenant_id")
    .where("m.account_id", "=", principal.account_id)
    .where("m.role", "=", "visitor")
    .where("t.sandbox", "=", true)
    .executeTakeFirst();
  if (!held) return null;
  return { ...(await loadSandbox(env.db, held.tenant_id)), visitor: true, appears_as: visitorName(held.tenant_id, principal.account_id) };
}

/**
 * For the routes that serve bytes outside the registry (a file, a Story page's HTML): what a
 * visitor's read meets in `execute`, so a closed sandbox serves them nothing and a download is a call.
 */
export async function admitRead(env: Env, principal: Principal, scope: Scope, name: string): Promise<void> {
  const sandbox = await sandboxOf(env, principal, scope);
  if (sandbox?.visitor) await admitVisitor(env.db, sandbox, principal, { name, mutates: false }, Boolean(scope.tenant));
}

/**
 * The one way an operation runs, whichever door the call came through: resolve and authorize the
 * scope, apply a public sandbox's limits to a visitor, validate the input strictly, then run the
 * handler in one transaction that is scoped to the tenant (row-level security) and writes its
 * activity event alongside the change. A call through a scoped MCP connector also stays inside it.
 */
export async function execute(
  env: Env,
  principal: Principal,
  op: OperationDef,
  rawInput: unknown,
  ref: ScopeRef = {},
  connector: ConnectorScope | null = null,
): Promise<{ result: unknown; scope: Scope }> {
  // Scope first: a caller who cannot see the product learns nothing, not even whether their input was valid.
  const raw = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const scope = await resolveScope(env.db, principal, op.scope, op.access, refFromInput(op, raw, ref), op.name);
  if (connector) checkConnectorScope(connector, op, scope);
  const sandbox = await sandboxOf(env, principal, scope);
  const visitor = sandbox?.visitor ? sandbox : null;
  if (visitor) await admitVisitor(env.db, visitor, principal, op, Boolean(scope.tenant));
  const input = parseInput(op, rawInput) as Record<string, unknown>;
  if (visitor) checkVisitorInput(visitor, op, input);
  if (op.mutates && scope.product?.archived_at && !op.allowArchivedProduct)
    throw conflict("product_archived", `Product ${scope.product.name} is archived and read-only. Restore it first.`);
  let enqueued = false;
  const now = new Date().toISOString();
  // In a sandbox a visitor writes under a made-up name, and their own never reaches a handler.
  const masked = visitor && scope.tenant ? { principal: { ...principal, display_name: visitor.appears_as ?? "Visitor", email: "" }, actor: visitorActor(principal, scope.tenant.tenant_id) } : null;
  const result = await env.db.transaction().execute(async (trx) => {
    if (scope.tenant) await sql`select set_config('app.tenant_id', ${scope.tenant.tenant_id}, true)`.execute(trx);
    if (sandbox && scope.tenant) await lockSandbox(trx, sandbox.tenant_id, op.exclusive ? "exclusive" : "shared");
    if (visitor) await countVisitorWrite(trx, visitor, principal, op);
    const ctx: OpContext = {
      principal: masked?.principal ?? principal,
      actor: masked?.actor ?? actorOf(principal),
      db: trx,
      scope,
      sandbox,
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
