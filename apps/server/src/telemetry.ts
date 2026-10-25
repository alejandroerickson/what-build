import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { context, diag, DiagLogLevel, isSpanContextValid, SpanKind, SpanStatusCode, trace, type DiagLogger, type Span } from "@opentelemetry/api";
import type { LogEvent } from "kysely";

/**
 * Operational telemetry about the service (§2.8): traces of its own work, a request ID on every
 * request, and error lines that name the request they happened in. A span carries what a log line
 * may: a method, a masked path, a route's pattern, an operation's name, a door, an agent client's
 * family, an outcome or error code, a job's kind, a statement's verb and table. Never content, a
 * query's values or its text, an address, a name, an id or a token.
 *
 * Traces are sent only when the deployment names where, with OpenTelemetry's own settings:
 * OTEL_EXPORTER_OTLP_ENDPOINT (or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT), OTEL_EXPORTER_OTLP_HEADERS
 * for a service that takes a key in a header, and OTEL_SERVICE_NAME or OTEL_RESOURCE_ATTRIBUTES to
 * rename it. Google's endpoint, https://telemetry.googleapis.com, is reached as the service's own
 * identity, which needs Cloud Telemetry Traces Writer (roles/telemetry.tracesWriter).
 */
export const tracer = trace.getTracer("whatbuild");

const GOOGLE_ENDPOINT = /^https:\/\/telemetry\.googleapis\.com(:443)?(\/|$)/;

/** The Google Cloud project traces go to, when they go to Google's endpoint: its log lines then name their trace for Cloud Logging. */
let googleProject: string | null = null;

export interface Tracing {
  /** Send what is still waiting, then stop. */
  shutdown(): Promise<void>;
}

/**
 * Start sending traces when the environment names where; null when it names nowhere, or when
 * setting up fails, which the log says once and which never stops the server. The exporter and the
 * resource read the rest of OpenTelemetry's settings from the same environment.
 */
export async function startTracing(version: string): Promise<Tracing | null> {
  const env = process.env;
  const endpoint = env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"]?.trim() || env["OTEL_EXPORTER_OTLP_ENDPOINT"]?.trim();
  if (!endpoint || env["OTEL_SDK_DISABLED"]?.trim().toLowerCase() === "true") return null;
  try {
    const [{ TracerProvider, BatchSpanProcessor }, { OTLPTraceExporter }, { AsyncLocalStorageContextManager }, { defaultResource, detectResources, envDetector, resourceFromAttributes }] = await Promise.all([
      import("@opentelemetry/sdk-trace"),
      import("@opentelemetry/exporter-trace-otlp-proto"),
      import("@opentelemetry/context-async-hooks"),
      import("@opentelemetry/resources"),
    ]);
    let headers: (() => Promise<Record<string, string>>) | undefined;
    let project: string | null = null;
    if (GOOGLE_ENDPOINT.test(endpoint)) {
      const { GoogleAuth } = await import("google-auth-library");
      const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
      const client = await auth.getClient();
      project = resourceAttribute(env, "gcp.project_id") ?? (await auth.getProjectId());
      headers = async () => Object.fromEntries((await client.getRequestHeaders()).entries());
    }
    // The settings' own names win over WhatBuild's: OTEL_SERVICE_NAME, then OTEL_RESOURCE_ATTRIBUTES.
    const resource = defaultResource()
      .merge(resourceFromAttributes({ "service.name": "whatbuild", "service.version": version, ...(project ? { "gcp.project_id": project } : {}) }))
      .merge(detectResources({ detectors: [envDetector] }));
    const provider = new TracerProvider({ resource, spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter(headers ? { headers } : {}) })] });
    diag.setLogger(onceAMinute, DiagLogLevel.WARN);
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(provider);
    googleProject = project;
    return { shutdown: () => provider.shutdown().catch(() => undefined) };
  } catch (e) {
    console.warn(JSON.stringify({ at: new Date().toISOString(), severity: "WARNING", event: "tracing_off", message: `Traces are not sent: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) }));
    return null;
  }
}

/** One key of OTEL_RESOURCE_ATTRIBUTES ("key=value,key=value"). */
function resourceAttribute(env: NodeJS.ProcessEnv, key: string): string | null {
  for (const pair of (env["OTEL_RESOURCE_ATTRIBUTES"] ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === key) return decodeURIComponent(pair.slice(at + 1).trim()) || null;
  }
  return null;
}

/** OpenTelemetry's own warnings (an export refused, say), at most one line a minute, so a failing endpoint cannot fill the log. */
let lastWarning = 0;
const warnOnceAMinute = (message: string, ...args: unknown[]) => {
  if (Date.now() - lastWarning < 60_000) return;
  lastWarning = Date.now();
  console.warn(JSON.stringify({ at: new Date().toISOString(), severity: "WARNING", event: "tracing", message: [message, ...args.map((a) => (a instanceof Error ? a.message : String(a)))].join(" ").slice(0, 500) }));
};
const onceAMinute: DiagLogger = { error: warnOnceAMinute, warn: warnOnceAMinute, info: () => {}, debug: () => {}, verbose: () => {} };

// ---- Requests ------------------------------------------------------------------------------------

const request = new AsyncLocalStorage<{ id: string }>();

/** A request's ID: its trace's when it is traced, so a log line and its trace share it; otherwise one of the same form. */
export function requestIdOf(span: Span | undefined): string {
  const ctx = span?.spanContext();
  return ctx && isSpanContextValid(ctx) ? ctx.traceId : randomBytes(16).toString("hex");
}

/** Run a request's handlers with its ID, which the error lines logged while it runs name. */
export function withRequestId<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return request.run({ id }, fn);
}

/**
 * What a log line adds to name its request and, when traces go to Google, its trace, which Cloud
 * Logging links to. The request's own line, written once its handlers are done, passes its ID.
 */
export function requestFields(span: Span | undefined = trace.getActiveSpan(), id: string | undefined = request.getStore()?.id): Record<string, string | boolean> {
  const ctx = span?.spanContext();
  const traced = ctx && isSpanContextValid(ctx) && span!.isRecording();
  return {
    ...(id ? { request_id: id } : {}),
    ...(traced && googleProject
      ? { "logging.googleapis.com/trace": `projects/${googleProject}/traces/${ctx.traceId}`, "logging.googleapis.com/spanId": ctx.spanId, "logging.googleapis.com/trace_sampled": true }
      : {}),
  };
}

/**
 * An unexpected error: one line, with severity ERROR so the log's alert sees it, naming the request
 * it happened in. The trace records only the error's type: its message may quote what was sent.
 */
export function logError(label: string, e: unknown): void {
  const span = trace.getActiveSpan();
  span?.setStatus({ code: SpanStatusCode.ERROR });
  span?.setAttribute("error.type", errorType(e));
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
  if (process.env["NODE_ENV"] === "development" || process.env["NODE_ENV"] === "test") console.error(`${label}:`, e);
  else console.error(JSON.stringify({ at: new Date().toISOString(), severity: "ERROR", message: `${label}: ${text}`, ...requestFields(span) }));
}

/** An error's kind: a Postgres error's SQLSTATE, a system error's code, or the error's class. */
export function errorType(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/i.test(code)) return code;
  return e instanceof Error ? e.constructor.name.slice(0, 60) : typeof e;
}

// ---- Database ------------------------------------------------------------------------------------

const VERB = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?([a-z]+)/i;
const TABLE = /\b(?:from|into|update|join)\s+(?:only\s+)?"?([a-z_][a-z0-9_]{0,62})(?![a-z0-9_])"?(?!\s*\()/i;

/** A statement's verb and the first table it names ("SELECT sources"): never its text, which may be built around what was sent. */
export function querySummary(sqlText: string): { verb: string; table: string | null; summary: string } {
  const verb = (VERB.exec(sqlText)?.[1] ?? "query").toUpperCase().slice(0, 20);
  const table = TABLE.exec(sqlText)?.[1]?.toLowerCase() ?? null;
  return { verb, table, summary: table ? `${verb} ${table}` : verb };
}

/**
 * Kysely's log, as a span for each statement run inside a traced request or job, which Kysely
 * reports when it ends. Statements outside one (the worker's polling, the usage counts' writes)
 * make none.
 */
export function querySpan(event: LogEvent): void {
  const parent = trace.getActiveSpan();
  if (!parent?.isRecording()) return;
  const { verb, table, summary } = querySummary(event.query.sql);
  const end = performance.now();
  const span = tracer.startSpan(summary, {
    kind: SpanKind.CLIENT,
    startTime: end - event.queryDurationMillis,
    attributes: { "db.system.name": "postgresql", "db.operation.name": verb, "db.query.summary": summary, ...(table ? { "db.collection.name": table } : {}) },
  });
  if (event.level === "error") {
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute("error.type", errorType(event.error));
  }
  span.end(end);
}
