import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider, type ReadableSpan } from "@opentelemetry/sdk-trace";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, createPorts } from "../src/app.ts";
import { logError, querySummary, requestIdOf, tracer, withRequestId } from "../src/telemetry.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// What a trace holds is what a log line may (okf/spec/02-architecture.md, Observability): the
// spans of a request, its operation, its statements and the worker's jobs, named by pattern, kind,
// verb and table, never by a name, an address, an id or what was sent.

const spans = new InMemorySpanExporter();
let h: Harness;
let alice: Browser;
let P: string;
let slugs: string[];
let agent: Client;

const ULID = /[0-9A-HJKMNP-TV-Z]{26}/;
const finished = () => spans.getFinishedSpans();
const inTrace = (traceId: string) => finished().filter((s) => s.spanContext().traceId === traceId);
const childrenOf = (parent: ReadableSpan) => finished().filter((s) => s.parentSpanContext?.spanId === parent.spanContext().spanId);
/** Everything a span says: its name and its attributes' values. */
const said = (list: ReadableSpan[]) => JSON.stringify(list.map((s) => [s.name, s.attributes]));

beforeAll(async () => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }));
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Example");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Trace Co" });
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Yard Planner" });
  P = `/api/v1/p/${p.body.path}`;
  slugs = String(p.body.path).split("/");
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await h.connectAgent(alice, "Claude Code (trace-co-private-label)")}` } } }),
  );
  agent = client;
});
afterAll(async () => {
  await agent?.close();
  await h?.close();
  trace.disable();
  context.disable();
});

describe("a request's trace", () => {
  it("holds the request, its operation and its statements, named by route and kind, never by a name or an id", async () => {
    const created = await alice.api("POST", `${P}/sources/with-upload`, { title: "Crew call with the yard office", tags: ["call"], path: "call.md" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.headers.get("x-request-id")!;
    expect(id).toMatch(/^[0-9a-f]{32}$/);

    const all = inTrace(id);
    const request = all.find((s) => s.kind === SpanKind.SERVER)!;
    expect(request.parentSpanContext).toBeUndefined();
    expect(request.attributes).toMatchObject({
      "http.request.method": "POST",
      "http.route": "/api/v1/p/:tenant/:team/:product/sources/with-upload",
      "url.path": "/api/v1/p/:org/:team/:product/sources/with-upload",
      "http.response.status_code": 201,
      "whatbuild.operation": created.headers.get("x-whatbuild-operation"),
    });
    expect(request.name).toBe("POST /api/v1/p/:tenant/:team/:product/sources/with-upload");

    // The session is looked up before the operation runs, in the request's own span.
    expect(childrenOf(request).map((s) => s.name)).toContain("SELECT sessions");
    const operation = childrenOf(request).find((s) => s.kind === SpanKind.INTERNAL);
    expect(operation!.name).toBe(created.headers.get("x-whatbuild-operation"));
    expect(operation!.attributes).toMatchObject({ "whatbuild.door": "web", "whatbuild.outcome": "ok", "whatbuild.sandbox": false });
    expect(operation!.attributes).not.toHaveProperty("whatbuild.client");

    const statements = childrenOf(operation!);
    expect(statements.length).toBeGreaterThan(2);
    for (const s of statements) {
      expect(s.kind).toBe(SpanKind.CLIENT);
      expect(s.attributes["db.system.name"]).toBe("postgresql");
      expect(s.name).toMatch(/^[A-Z]+( [a-z_0-9]+)?$/);
    }
    expect(statements.map((s) => s.name)).toEqual(expect.arrayContaining(["BEGIN", "COMMIT", "INSERT records"]));
    // A statement's span is placed from the time Kysely measured, inside its operation's.
    const ms = ([sec, nano]: [number, number]) => sec * 1e3 + nano / 1e6;
    for (const s of statements) {
      expect(ms(s.startTime)).toBeGreaterThanOrEqual(ms(operation!.startTime) - 1);
      expect(ms(s.endTime)).toBeLessThanOrEqual(ms(operation!.endTime) + 1);
      expect(ms(s.endTime)).toBeGreaterThanOrEqual(ms(s.startTime));
    }

    const text = said(all);
    for (const name of [...slugs, "alice", "example.com", "Crew call", "call.md", "yard"]) expect(text.toLowerCase()).not.toContain(name.toLowerCase());
    expect(text).not.toMatch(ULID);
  });

  it("names an agent's client by its family and a refusal by its code, which is not an error", async () => {
    spans.reset();
    expect((await agent.callTool({ name: "sources", arguments: { action: "list", product: slugs.join("/") } })).isError).toBeFalsy();
    expect((await agent.callTool({ name: "sources", arguments: { action: "list", product: "no-such/team/product" } })).isError).toBe(true);
    const operations = finished().filter((s) => s.name === "sources.list");
    expect(operations.map((s) => s.attributes["whatbuild.outcome"])).toEqual(["ok", expect.not.stringMatching(/^ok$/)]);
    for (const s of operations) {
      expect(s.attributes).toMatchObject({ "whatbuild.door": "mcp", "whatbuild.client": "Claude Code" });
      expect(s.status.code).toBe(SpanStatusCode.UNSET);
    }
    const requests = finished().filter((s) => s.kind === SpanKind.SERVER);
    expect(requests.map((s) => s.name)).toContain("POST /mcp");
    expect(said(finished())).not.toContain("private-label");
  });

  it("is named by the request's ID on its log line, which the response carries", async () => {
    // A server that logs, as one outside the tests does, on the same database.
    const app = createApp({ db: h.db, ports: createPorts(h.config, h.blobs, h.mailer), config: { ...h.config, env: "development" } });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    let res: Response;
    try {
      res = await app.request("/api/v1/meta");
    } finally {
      spy.mockRestore();
    }
    const id = res.headers.get("x-request-id")!;
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l["path"] === "/api/v1/meta");
    expect(line).toMatchObject({ method: "GET", status: 200, request_id: id });
    expect(inTrace(id).find((s) => s.kind === SpanKind.SERVER)?.name).toBe("GET /api/v1/meta");
  });

  it("gives every response an ID, the untraced ones too", async () => {
    spans.reset();
    const a = await fetch(`${h.baseUrl}/health`);
    const b = await fetch(`${h.baseUrl}/health`);
    expect(a.headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/);
    expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
    // The health check, like the app's assets and a prototype's files, is never traced.
    expect(finished()).toEqual([]);
    const missing = await fetch(`${h.baseUrl}/api/v1/nothing-here`);
    expect(inTrace(missing.headers.get("x-request-id")!).map((s) => s.name)).toEqual(["GET /api/v1/nothing-here"]);
  });
});

describe("the worker's trace", () => {
  it("is one for each job, holding its statements", async () => {
    await h.worker.drain();
    spans.reset();
    const created = await alice.api("POST", `${P}/sources/with-upload`, { title: "Yard notes", tags: ["notes"], path: "notes.txt" });
    expect((await fetch(created.body.upload.url, { method: "PUT", headers: created.body.upload.headers, body: "Crews text the office.\n" })).status).toBe(201);
    await h.worker.drain();
    const job = finished().find((s) => s.name === "job derive")!;
    expect(job.parentSpanContext).toBeUndefined();
    expect(job.kind).toBe(SpanKind.CONSUMER);
    expect(job.attributes).toMatchObject({ "whatbuild.job.kind": "derive", "whatbuild.job.attempt": 1 });
    expect(childrenOf(job).map((s) => s.name)).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
    expect(said(inTrace(job.spanContext().traceId))).not.toMatch(ULID);
  });

  it("makes no span for a statement outside a request or a job", async () => {
    spans.reset();
    await sql`select 1`.execute(h.db);
    await h.worker.drain();
    expect(finished()).toEqual([]);
  });
});

describe("an unexpected error", () => {
  it("is one line naming its request, and its span records only the error's kind", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: string) => void lines.push(line));
    const mode = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    let traceId = "";
    try {
      await tracer.startActiveSpan("GET /t/:org/:team/:product", async (span) => {
        traceId = span.spanContext().traceId;
        await withRequestId(requestIdOf(span), async () => logError("GET /t/:org/:team/:product", new URIError("URI malformed")));
        span.end();
      });
    } finally {
      process.env["NODE_ENV"] = mode;
      spy.mockRestore();
    }
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ severity: "ERROR", request_id: traceId, message: expect.stringMatching(/^GET \/t\/:org\/:team\/:product: URIError: URI malformed\n/) });
    const span = inTrace(traceId)[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes).toEqual({ "error.type": "URIError" });
  });
});

describe("a statement's summary", () => {
  it("is its verb and the first table it names, and nothing else of its text", () => {
    expect(querySummary(`select "title", "tags" from "records" where "tenant_id" = $1 and "title" ilike $2`).summary).toBe("SELECT records");
    expect(querySummary(`insert into "jobs" ("tenant_id", "kind") values ($1, $2)`).summary).toBe("INSERT jobs");
    expect(querySummary("update jobs set attempts = attempts + 1 where job_id = (select job_id from jobs limit 1)").summary).toBe("UPDATE jobs");
    expect(querySummary("delete from sandbox_usage where starts_at < now()").summary).toBe("DELETE sandbox_usage");
    expect(querySummary("select set_config('app.tenant_id', $1, true)").summary).toBe("SELECT");
    expect(querySummary(`select u.id from unnest($1::text[]) as u join "records" r on r.record_id = u.id`).summary).toBe("SELECT records");
    expect(querySummary("  /* a note */ with recent as (select 1) select * from recent").summary).toBe("WITH recent");
    expect(querySummary("begin").summary).toBe("BEGIN");
  });
});
