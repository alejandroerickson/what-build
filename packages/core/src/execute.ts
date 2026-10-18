import { sql } from "kysely";
import type { z } from "zod";
import { json, type ActorSnapshot, type Db } from "./db.ts";
import { checkConnectorScope, type ConnectorScope } from "./connector-scope.ts";
import { AppError, conflict, invalid } from "./errors.ts";
import { resolveAliases, wrongFieldHint } from "./field-aliases.ts";
import { resolveScope, type ScopeRef } from "./policy.ts";
import type { Ports } from "./ports.ts";
import { capRole, connectionNeeds, LEVEL_NAMES, levelAllows, type OpContext, type OperationDef, type Principal, type Scope } from "./registry.ts";
import { admitVisitor, checkVisitorInput, countVisitorWrite, isVisitor, loadSandbox, lockSandbox, visitorActor, visitorName, type SandboxContext } from "./public-sandbox.ts";
import { formatIssues, nullCharacterPaths, nullCharacterSentence, wordList } from "./schemas.ts";
import { feedbackOff } from "./feedback.ts";
import { countCall } from "./usage.ts";

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

/** Dimensions and their filters, which sources and assumptions no longer have. The filter that took their place is `tags` on sources and search, `tag` on assumptions. */
const RETIRED_DIMENSION_FIELDS = new Set(["dimensions", "customer", "product_area", "lifecycle_stage"]);
const retiredDimensionHint = (tool: string) =>
  ` Sources and assumptions have no dimensions (customer, product area, lifecycle stage) any more: say whom the material concerns and what it bears on with tags, and filter by ${tool === "assumptions" ? "`tag`" : "`tags`"}.`;

/** Citations and the graph around them, which nothing takes any more (decision: evidence is searched, not cited). */
const RETIRED_CITATION_FIELDS = new Set(["citations", "refs", "related_records"]);
const RETIRED_CITATION_HINT =
  " Nothing takes citations, refs or related sources any more: evidence is found by searching, not cited. Say in words what the work rests on (an assumption's body, a Story page's notes, a source's notes), naming a source by its id where it helps, and find what bears on it with search.";

/** Values a field no longer takes, and what took their place. */
const RETIRED_VALUES: { ops: string[]; field: string; values: string[]; hint: string }[] = [
  {
    ops: ["derived.write_note", "derived.read_note"],
    field: "note_kind",
    values: ["outline"],
    hint: " A source has no outline any more: note_kind is summary (what the source is and what it tells the team, which people read) or notes (anything else worth keeping). Find your way through a long source with search and derived(action=\"text\") windows.",
  },
];

/** Participants, where a source came from, and provenance, which sources and assumptions no longer have. */
const RETIRED_DETAIL_FIELDS = new Set(["participants", "source_system", "provenance_depth"]);
const RETIRED_DETAIL_HINT =
  " Sources have no participants, source system or provenance, and assumptions no provenance, any more: a source is described by its title, date and tags, and anything else worth keeping goes in its notes.";

/** File roles and the provenance a file could carry, which attachments do not have. */
const RETIRED_ATTACHMENT_FIELDS = new Set(["role", "derived_from", "derivation_note", "derived_by"]);
const RETIRED_ATTACHMENT_HINT =
  " Attachments have no role or provenance any more: every attachment's text is read and kept, never searched, and the source's derived text is taken from one of them. Say what an attachment was made from in the source's notes.";

/**
 * A hint for what the call named that this operation does not take: fields sources no longer
 * have, a neighbouring operation's, or a value a field no longer takes.
 */
function retiredFieldHint(op: OperationDef, error: z.ZodError, input: unknown): string {
  const unknown = error.issues.filter((i) => i.code === "unrecognized_keys").flatMap((i) => (i as { keys: string[] }).keys);
  const retired = ["sources", "attachments", "search"].includes(op.mcp.tool) && unknown.some((k) => RETIRED_SOURCE_FIELDS.has(k));
  const dimensions = ["sources", "attachments", "search", "assumptions"].includes(op.mcp.tool) && unknown.some((k) => RETIRED_DIMENSION_FIELDS.has(k));
  const details = ["sources", "attachments", "search", "assumptions"].includes(op.mcp.tool) && unknown.some((k) => RETIRED_DETAIL_FIELDS.has(k));
  const attachment = op.mcp.tool === "attachments" && unknown.some((k) => RETIRED_ATTACHMENT_FIELDS.has(k));
  const cited = unknown.some((k) => RETIRED_CITATION_FIELDS.has(k));
  const anchored = op.name === "sources.annotate" && unknown.some((k) => k === "seq_start" || k === "seq_end");
  const sent = (field: string) => (input && typeof input === "object" ? (input as Record<string, unknown>)[field] : undefined);
  const values = RETIRED_VALUES.filter(
    (v) => v.ops.includes(op.name) && v.values.includes(String(sent(v.field))) && error.issues.some((i) => i.path.length === 1 && i.path[0] === v.field),
  );
  return (
    (retired ? RETIRED_SOURCE_HINT : "") + (dimensions ? retiredDimensionHint(op.mcp.tool) : "") + (details ? RETIRED_DETAIL_HINT : "") + (attachment ? RETIRED_ATTACHMENT_HINT : "") +
    (cited ? RETIRED_CITATION_HINT : "") + (anchored ? " A comment is on the whole source: it takes no segment range." : "") + values.map((v) => v.hint).join("") + wrongFieldHint(op, unknown)
  );
}

/** What a grouped tool's call carries beside an action's fields. A standalone tool takes none of them. */
const GROUPED_ARGUMENTS = ["action", "params", "describe"];

/**
 * A standalone tool called as a grouped one is: its fields are its arguments, with no action,
 * params or describe beside them. Said in place of "not a field", which could suggest a field.
 */
function standaloneSentence(op: OperationDef, sent: string[]): string {
  const fields = Object.keys((op.input as unknown as { shape?: Record<string, unknown> }).shape ?? {});
  return (
    `${wordList(sent.map((k) => `\`${k}\``))} ${sent.length === 1 ? "is not an argument" : "are not arguments"} of ${op.mcp.tool}: it is a tool of its own, ` +
    `${fields.length ? `whose arguments are its fields (${wordList(fields)})` : "which takes no arguments"}, and only the grouped tools take action, params and describe.`
  );
}

/**
 * Validate an operation's input strictly, whichever door it came through. A field that holds a
 * null character is refused too, by name, since Postgres keeps no such character in text: one the
 * schema already refused is left to that refusal.
 */
export function parseInput<I extends z.ZodType>(op: OperationDef<I>, raw: unknown): z.output<I> {
  const input = resolveAliases(op, raw ?? {});
  const parsed = op.input.safeParse(input);
  const refused = parsed.success ? [] : parsed.error.issues.flatMap((i) => (i.code === "unrecognized_keys" ? (i as { keys: string[] }).keys.map((k) => [...i.path, k]) : [i.path]));
  const nul = nullCharacterPaths(input).filter((p) => !refused.some((r) => r.every((k, n) => p[n] === k)));
  if (!parsed.success || nul.length) {
    const shape = (op.input as unknown as { shape?: Record<string, unknown> }).shape ?? {};
    const envelope = !op.mcp.action && input && typeof input === "object" ? GROUPED_ARGUMENTS.filter((k) => k in input && !(k in shape)) : [];
    const problems = [
      envelope.length ? standaloneSentence(op, envelope) : "",
      parsed.success ? "" : formatIssues(parsed.error, input, { schema: op.input, skip: envelope }),
      nul.length ? nullCharacterSentence(nul) : "",
    ]
      .filter(Boolean)
      .join(" ");
    throw invalid("invalid_input", `${problems} Nothing was changed; correct the call and send it again.${parsed.success ? "" : retiredFieldHint(op, parsed.error, input)}`, {
      operation: op.name,
      ...(nul.length ? { fields: nul.map((p) => p.join(".")) } : {}),
    });
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
    // Anyone but its staff meets its limits; only someone who came in by an invitation link is a visitor.
    return { ...(await loadSandbox(env.db, scope.tenant.tenant_id)), visitor, member: visitor && scope.tenantRole !== "visitor", appears_as: visitor ? visitorName(scope.tenant.tenant_id, principal.account_id) : null };
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
  return { ...(await loadSandbox(env.db, held.tenant_id)), visitor: true, member: false, appears_as: visitorName(held.tenant_id, principal.account_id) };
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
 * scope, apply a public sandbox's limits to a visitor, validate the input strictly, run any slow
 * `prepare` step outside a transaction, then run the handler in one transaction that is scoped to
 * the tenant (row-level security) and writes its activity event alongside the change. A call
 * through a scoped MCP connector also stays inside it.
 */
export async function execute(
  env: Env,
  principal: Principal,
  op: OperationDef,
  rawInput: unknown,
  ref: ScopeRef = {},
  connector: ConnectorScope | null = null,
): Promise<{ result: unknown; scope: Scope }> {
  // Every call is counted, however it ends (`usage.ts`).
  const reached: { scope?: Scope } = {};
  const count = (outcome: string) =>
    countCall(env, principal, { operation: op.name, feature: op.mcp.tool, outcome, sandbox: reached.scope?.tenant ? Boolean(reached.scope.tenant.sandbox) : Boolean(principal.sandbox_only) });
  try {
    const ran = await run(env, principal, op, rawInput, ref, connector, reached);
    count("ok");
    return ran;
  } catch (e) {
    count(toAppError(e).code);
    throw e;
  }
}

async function run(
  env: Env,
  principal: Principal,
  op: OperationDef,
  rawInput: unknown,
  ref: ScopeRef,
  connector: ConnectorScope | null,
  reached: { scope?: Scope },
): Promise<{ result: unknown; scope: Scope }> {
  // What the operation is comes before where it lands: refusing a call for its kind tells nothing about any product.
  if (op.webOnly && principal.surface !== "web")
    throw new AppError(403, "web_only", `Only a person can do ${op.name}, in the WhatBuild web app. Nothing was changed.`);
  if (!levelAllows(principal.level, op)) throw connectionLevelTooLow(op, principal);
  // Nor one the person turned off for this connection, whatever was sent with it.
  if (op.name === "submit_feedback" && principal.feedback === false) throw feedbackOff();
  // Scope first: a caller who cannot see the product learns nothing, not even whether their input was valid.
  const raw = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const resolved = await resolveScope(env.db, principal, op.scope, op.access, refFromInput(op, raw, ref), op.name);
  // An agent acts with the lower of the person's role and its connection's level.
  const scope: Scope = principal.level ? { ...resolved, role: capRole(resolved.role, principal.level) } : resolved;
  reached.scope = scope;
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
  const inTransaction = <T>(fn: (ctx: OpContext) => Promise<T>, mode: "read" | "call") => {
    const tx = env.db.transaction();
    return (mode === "read" ? tx.setAccessMode("read only") : tx).execute(async (trx) => {
      if (scope.tenant) await sql`select set_config('app.tenant_id', ${scope.tenant.tenant_id}, true)`.execute(trx);
      if (sandbox && scope.tenant) await lockSandbox(trx, sandbox.tenant_id, op.exclusive ? "exclusive" : "shared");
      if (visitor && mode === "call") await countVisitorWrite(trx, visitor, principal, op, input);
      return fn({
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
      });
    });
  };
  // Slow work, such as a download, runs before the transaction, so it never holds a database connection.
  const prepared = op.prepare
    ? await op.prepare({ principal: masked?.principal ?? principal, scope, ports: env.ports, sandbox, now, read: (fn) => inTransaction(fn, "read") }, input as never)
    : undefined;
  const result = await inTransaction((ctx) => op.handler(ctx, input as never, prepared), "call");
  if (enqueued) env.ports.notifyJobs?.();
  return { result, scope };
}

/** The refusal for an agent whose connection is below what the operation needs. */
function connectionLevelTooLow(op: OperationDef, principal: Principal): AppError {
  const level = principal.level!;
  const needed = connectionNeeds(op);
  return new AppError(
    403,
    "connection_level",
    `This connection is set to ${LEVEL_NAMES[level]}, and ${op.name} needs ${LEVEL_NAMES[needed]}. Nothing was changed. ` +
      `Tell the person: only they can raise it, under Connect an agent in WhatBuild. Never look for a way around it.`,
    { level, needed },
  );
}

/**
 * How the caller reports an unexpected error that repeats, as its door names the way: an agent
 * with the submit_feedback tool (or to the person, when they turned it off), a person with Submit
 * feedback in the web app's account menu, and both when the door does not say who called.
 */
function reportIt(caller?: Pick<Principal, "surface" | "feedback">): string {
  if (caller?.surface === "mcp") return caller.feedback === false ? "tell the person if it repeats" : "report it with submit_feedback if it repeats";
  if (caller?.surface === "web") return "report it with Submit feedback, in the account menu, if it repeats";
  return "report it if it repeats: an agent with submit_feedback, a person with Submit feedback in the web app's account menu";
}

/** Any error as the one shape both doors answer with; `caller` says how to report an unexpected one. */
export function toAppError(e: unknown, caller?: Pick<Principal, "surface" | "feedback">): AppError {
  if (e instanceof AppError) return e;
  const pg = e as { code?: string; constraint?: string; message?: string };
  if (pg?.code === "23505") return conflict("conflict", "That conflicts with something that already exists. Read the current state and retry.", { constraint: pg.constraint });
  if (pg?.code === "40001" || pg?.code === "40P01") return conflict("concurrent_change", "Another change landed at the same moment. Retry.");
  return new AppError(500, "internal", `WhatBuild hit an unexpected error. It has been logged; try again, and ${reportIt(caller)}.`);
}
