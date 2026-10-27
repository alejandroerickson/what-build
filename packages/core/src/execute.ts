import { SpanStatusCode, trace } from "@opentelemetry/api";
import { sql } from "kysely";
import type { z } from "zod";
import { json, type ActorSnapshot, type Db } from "./db.ts";
import { checkConnectorScope, type ConnectorScope } from "./connector-scope.ts";
import { AppError, conflict, invalid } from "./errors.ts";
import { resolveAliases, wrongFieldHint } from "./field-aliases.ts";
import { exampleReadOnly, isGuest, resolveScope, type ScopeRef } from "./policy.ts";
import type { Ports } from "./ports.ts";
import { capRole, connectionNeeds, LEVEL_NAMES, levelAllows, type OpContext, type OperationDef, type Principal, type Scope } from "./registry.ts";
import { admitCall, checkInput, countWrite, limitsFor, tallyOf } from "./limits.ts";
import { formatIssues, nullCharacterPaths, nullCharacterSentence, wordList } from "./schemas.ts";
import { feedbackOff } from "./feedback.ts";
import { isInstanceOwner } from "./tenant-allowance.ts";
import { clientFamily, countCall } from "./usage.ts";

const tracer = trace.getTracer("whatbuild");

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
  " Sources have no kind, organization or folder any more: say what the material is and whom it concerns with tags, reusing the ones sources_read(action=\"facets\") lists.";

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
    hint: " A source has no outline any more: note_kind is summary (what the source is and what it tells the team, which people read) or notes (anything else worth keeping). Find your way through a long source with search and derived_read(action=\"text\") windows.",
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

/** What a call to a tool with actions carries beside an action's fields. A standalone tool takes none of them. */
const GROUPED_ARGUMENTS = ["action", "params", "describe"];

/**
 * A standalone tool called as a grouped one is: its fields are its arguments, with no action,
 * params or describe beside them. Said in place of "not a field", which could suggest a field.
 */
function standaloneSentence(op: OperationDef, sent: string[]): string {
  const fields = Object.keys((op.input as unknown as { shape?: Record<string, unknown> }).shape ?? {});
  return (
    `${wordList(sent.map((k) => `\`${k}\``))} ${sent.length === 1 ? "is not an argument" : "are not arguments"} of ${op.mcp.tool}: it is a tool of its own, ` +
    `${fields.length ? `whose arguments are its fields (${wordList(fields)})` : "which takes no arguments"}, and only the tools with actions take action, params and describe.`
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
 * For the routes that serve bytes outside the registry (a file, a Story page's HTML): what a read
 * meets in `execute`, so a download is a call against the limit on calls a minute.
 */
export async function admitRead(env: Env, principal: Principal, scope: Scope, name: string): Promise<void> {
  const limits = await limitsFor(env.db, scope);
  if (limits) await admitCall(env.db, limits, principal, { name, mutates: false });
}

/**
 * The one way an operation runs, whichever door the call came through: resolve and authorize the
 * scope, refuse a guest's write in the example organization, apply the limits of a free
 * organization, validate the input strictly, run any slow `prepare` step outside a transaction,
 * then run the handler in one transaction that is scoped to the tenant (row-level security), counts
 * the day's use on every plan, and writes its activity event alongside the change. A call through a scoped MCP connector also stays
 * inside it.
 */
export async function execute(
  env: Env,
  principal: Principal,
  op: OperationDef,
  rawInput: unknown,
  ref: ScopeRef = {},
  connector: ConnectorScope | null = null,
): Promise<{ result: unknown; scope: Scope }> {
  // Every call is counted, however it ends (`usage.ts`), and is a span of the request's trace,
  // which names the operation, the door, the agent client's family and the outcome, and nobody.
  const reached: { scope?: Scope } = {};
  const example = () => Boolean(reached.scope?.tenant?.example);
  const count = (outcome: string) => countCall(env, principal, { operation: op.name, feature: op.mcp.tool, outcome, example: example() });
  return tracer.startActiveSpan(op.name, { attributes: { "whatbuild.operation": op.name, ...(principal.surface ? { "whatbuild.door": principal.surface } : {}), ...(principal.surface === "mcp" ? { "whatbuild.client": clientFamily(principal) } : {}) } }, async (span) => {
    try {
      const ran = await run(env, principal, op, rawInput, ref, connector, reached);
      count("ok");
      span.setAttributes({ "whatbuild.outcome": "ok", "whatbuild.example": example() });
      return ran;
    } catch (e) {
      const err = toAppError(e);
      count(err.code);
      span.setAttributes({ "whatbuild.outcome": err.code, "whatbuild.example": example() });
      if (err.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.end();
    }
  });
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
  const asInstanceOwner = Boolean(op.allowInstanceOwners) && isInstanceOwner(env.ports.config, principal.email);
  const resolved = await resolveScope(env.db, principal, op.scope, op.access, refFromInput(op, raw, ref), op.name, { asInstanceOwner, allowances: env.ports.config });
  // An agent acts with the lower of the person's role and its connection's level.
  const scope: Scope = principal.level ? { ...resolved, role: capRole(resolved.role, principal.level) } : resolved;
  reached.scope = scope;
  if (connector) checkConnectorScope(connector, op, scope);
  // The example organization is read by everyone and changed by nobody but its members.
  if (op.mutates && isGuest(scope)) throw await exampleReadOnly(env.db, env.ports.config, principal, scope.tenant!.name, op.name);
  const limits = await limitsFor(env.db, scope);
  if (limits) await admitCall(env.db, limits, principal, op);
  // A day's use is counted on every plan, so an organization moved to the free plan during a day meets what that day already used.
  const tally = limits ?? (scope.tenant ? tallyOf(scope.tenant.tenant_id) : null);
  const input = parseInput(op, rawInput) as Record<string, unknown>;
  if (limits) checkInput(limits, op, input);
  if (op.mutates && scope.product?.archived_at && !op.allowArchivedProduct)
    throw conflict("product_archived", `Product ${scope.product.name} is archived and read-only. Restore it first.`);
  let enqueued = false;
  const now = new Date().toISOString();
  const inTransaction = <T>(fn: (ctx: OpContext) => Promise<T>, mode: "read" | "call") => {
    const tx = env.db.transaction();
    return (mode === "read" ? tx.setAccessMode("read only") : tx).execute(async (trx) => {
      if (scope.tenant) await sql`select set_config('app.tenant_id', ${scope.tenant.tenant_id}, true)`.execute(trx);
      if (tally && mode === "call") await countWrite(trx, tally, limits, principal, op, input);
      return fn({
        principal,
        actor: actorOf(principal),
        db: trx,
        scope,
        limits,
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
    ? await op.prepare({ principal, scope, ports: env.ports, limits, now, read: (fn) => inTransaction(fn, "read") }, input as never)
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
      `Only the person can raise it, under Connect an agent in WhatBuild.`,
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
