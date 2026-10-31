import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boundedSearch, SearchGate, toAppError, type AppError } from "@whatbuild/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, watchPool } from "../src/database.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

// Search reads the words kept beside a page's HTML, and a search cannot take the server with it.

let h: Harness;
let alice: Browser;
let P: string;
let path: string;
let tenantId: string;

const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sample</title></head><body>${body}</body></html>`;

const search = async (query: string, extra = "") => {
  const r = await alice.api("GET", `${P}/search?mode=plain&strict=true&query=${encodeURIComponent(query)}${extra}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { results: { kind: string; id: string; title: string; snippet: string | null; missing: string[]; meta: Record<string, unknown> }[] };
};

/** The ids of what holds the word, of one kind. */
const holding = async (word: string, kind: "mockup" | "story") => (await search(word, `&kind=${kind}`)).results.filter((r) => !r.missing.length).map((r) => r.id);

const wordsOf = async (html: string) => (await sql<{ t: string }>`select html_search_text(${html}) as t`.execute(h.db)).rows[0]!.t;

const publishMockup = async (title: string, body: string, also: Record<string, unknown> = {}) => {
  const r = await alice.api("POST", `${P}/mockups`, { title, brief: "A sample.", pages: [{ page_id: "board", title: "Board", html: page(body) }], ...also });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { mockup_id: string; etag: string };
};

const publishStory = async (id: string, title: string, body: string) => {
  const r = await alice.api("POST", `${P}/story/pages/${id}/versions`, { title, html: page(body) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { etag: string };
};

const until = async (what: () => Promise<boolean> | boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await what())) {
    if (Date.now() > end) throw new Error("It did not happen in time.");
    await new Promise((r) => setTimeout(r, 15));
  }
};

/** Statements still running that read a page's words: none, once a search has been stopped. */
const runningSearches = async () =>
  (await sql<{ n: number }>`select count(*)::int as n from pg_stat_activity where state = 'active' and pid <> pg_backend_pid() and (query like '%mockup_pages%' or query like '%story_versions%')`.execute(h.db)).rows[0]!.n;

/** A search reads mockups, so it waits for as long as this holds them: a search as slow as can be, without a test hook in the server. */
const whileSearchesAreStuck = async <T>(fn: () => Promise<T>): Promise<T> => {
  const c = new pg.Client({ connectionString: h.config.databaseUrl });
  await c.connect();
  await c.query("begin");
  await c.query("lock table mockups in access exclusive mode");
  try {
    return await fn();
  } finally {
    await c.query("rollback");
    await c.end();
  }
};

const gateOf = (options: ConstructorParameters<typeof SearchGate>[0]) => (h.ports.searches = new SearchGate(options));

beforeAll(async () => {
  h = await startHarness();
  alice = await h.signIn("alice@example.com", "Alice Admin");
  const t = await alice.api("POST", "/api/v1/tenants", { name: "Pages Co" });
  tenantId = t.body.tenant.tenant_id;
  const p = await alice.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Crew board", concept: "Plan the week." });
  path = p.body.path;
  P = `/api/v1/p/${path}`;
});
afterAll(async () => h?.close());
afterEach(() => {
  h.ports.searches = new SearchGate();
});

describe("a page's words", () => {
  it.each([
    ["words between two scripts", "<p>alpha</p><script>x</script><p>between</p><script>y</script><p>omega</p>", "alpha between omega"],
    ["words between two styles", "<style>a{}</style><p>between</p><style>b{}</style>", "between"],
    ["words between a script and a style, either way round", "<script>y</script><p>one</p><style>a{}</style><p>two</p><script>z</script>", "one two"],
    ["any case", "<SCRIPT TYPE='x'>x</script><p>between</p><Style>a{}</STYLE>", "between"],
    ["space in a closing tag", "<script>x</script ><p>between</p><style>y</style\n>", "between"],
    ["blocks over many lines", "<script>\nx\n</script><p>between</p><style>\na{}\n</style>", "between"],
    ["markup inside a script", `<script>x = "<div>hidden</div>";</script><p>shown</p>`, "shown"],
    ["a tag whose name only starts like one", "<scripted>keep</scripted><styled>this</styled>", "keep this"],
    ["a comment, even holding tags or a >", "<!-- <p>hidden</p> a > b --><p>shown</p>", "shown"],
    ["a script never closed", "<p>alpha</p><script>x <p>beta</p>", "alpha x beta"],
    ["an SVG's words, not its paths", '<svg viewBox="0 0 9 9"><title>Chart</title><path d="M0 0L10 10Z"/><text x="1">Revenue</text></svg>', "Chart Revenue"],
    ["a picture held in a data: URI", '<img src="data:image/png;base64,QUJDREVG" alt="Photo"><p>shown</p>', "shown"],
    ["a < that opens no tag", "<p>a < b and c > d</p>", "a < b and c > d"],
    ["entities, as blanks", "<p>Q&amp;A&nbsp;today</p>", "Q A today"],
    ["a tag before punctuation, with no space left", "<p><b>word</b>, then <i>another</i>.</p>", "word, then another."],
  ])("handles %s", async (_what, html, words) => {
    expect(await wordsOf(html)).toBe(words);
  });

  it("stays quick on the worst shapes a page's limit allows", async () => {
    const shapes: [string, string][] = [
      ["one huge script holding markup", `<script>${'x="<div></div>";\n'.repeat(55_000)}</script>`],
      ["thousands of small blocks", "<style>a{}</style><p>between</p>".repeat(30_000)],
      ["thousands of small scripts", "<script>a</script><p>w</p>".repeat(36_000)],
      ["blocks opened and never closed", "<style>a{}<p>between</p>".repeat(40_000)],
      ["blocks opened and closed as the other kind", "<script></style><style></script>".repeat(30_000)],
      ["a script tag that never ends", `<script ${"a ".repeat(490_000)}`],
      ["comments opened and never closed", "<!-- a ".repeat(140_000)],
      ["a tag that never ends", `<div ${"x".repeat(990_000)}`],
      ["angle brackets alone", "<".repeat(990_000)],
      ["ampersands alone", "&a".repeat(495_000)],
      ["spaces before punctuation", "  ,".repeat(330_000)],
      ["spaces alone", " ".repeat(990_000)],
    ];
    for (const [what, html] of shapes) {
      const began = Date.now();
      await wordsOf(html);
      expect(Date.now() - began, what).toBeLessThan(3000);
    }
  });

  it("finds a page's words through both doors, for mockups and Story pages alike", async () => {
    const body = "<script>scriptword()</script><p>betweenword <b>shownword</b></p><script>morescript()</script><svg><text>chartword</text></svg>";
    const { mockup_id } = await publishMockup("Doors", body);
    await publishStory("doors", "Doors", body);
    for (const word of ["betweenword", "shownword", "chartword"]) {
      expect(await holding(word, "mockup")).toEqual([mockup_id]);
      expect(await holding(word, "story")).toEqual(["doors"]);
    }
    for (const word of ["scriptword", "morescript"]) {
      expect(await holding(word, "mockup")).toEqual([]);
      expect(await holding(word, "story")).toEqual([]);
    }
    const token = await h.connectAgent(alice, "search-agent");
    const client = new Client({ name: "search-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const r = await client.callTool({ name: "search", arguments: { product: path, mode: "plain", query: "betweenword" } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const results = JSON.parse((r.content as { text: string }[])[0]!.text).results as { kind: string; id: string; snippet: string }[];
    expect(results.map((x) => x.kind).sort()).toEqual(["mockup", "story"]);
    expect(results[0]!.snippet).toContain("betweenword");
    await client.close();
  });

  it("indexes a page of mostly markup whole, however large, and takes the first 200,000 characters of one that is all words", async () => {
    // Nearly a megabyte of HTML, a few words of it: nothing is lost to the cap.
    const markup = `<style>${".c{color:red}\n".repeat(32_000)}</style><svg><path d="${"M0 0L1 1".repeat(45_000)}"/><text>wordinthechart</text></svg><img src="data:image/png;base64,${"QUJD".repeat(30_000)}"><p>wordafterall</p>`;
    expect(markup.length).toBeGreaterThan(900_000);
    const heavy = await publishMockup("Heavy", markup);
    expect(await holding("wordinthechart", "mockup")).toEqual([heavy.mockup_id]);
    expect(await holding("wordafterall", "mockup")).toEqual([heavy.mockup_id]);

    // A page that is all different words saves, and its first words are found.
    const all = Array.from({ length: 100_000 }, (_, i) => `w${i}x`).join(" ");
    expect(all.length).toBeGreaterThan(200_000);
    const wordy = await publishMockup("Wordy", `<p>wordatthestart ${all} wordattheend</p>`);
    expect(await holding("wordatthestart", "mockup")).toEqual([wordy.mockup_id]);
    expect(await holding("wordattheend", "mockup")).toEqual([]);
  });

  it("fits any 200,000 characters in a search vector, the costliest words among them", async () => {
    const costliest = Array.from({ length: 100_000 }, (_, i) => String.fromCodePoint(0x20000 + i)).join(" ");
    const r = await sql<{ n: number }>`select length(to_tsvector('simple', html_search_text(${costliest})))::int as n`.execute(h.db);
    expect(r.rows[0]!.n).toBeGreaterThan(0);
  });

  it("leaves a page's words out of what a page reads as", async () => {
    const { mockup_id } = await publishMockup("Reads", "<p>readword</p>");
    await publishStory("reads", "Reads", "<p>readword</p>");
    const reads = [
      await alice.api("GET", `${P}/mockups/${mockup_id}`),
      await alice.api("GET", `${P}/mockups/${mockup_id}/versions/1`),
      await alice.api("GET", `${P}/story/pages/reads`),
      await alice.api("GET", `${P}/story/pages/reads/versions/1`),
    ];
    for (const r of reads) {
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toMatch(/search_text|"tsv"/);
    }
  });
});

describe("a page saved again", () => {
  it("is found by its new words and not its old ones, and its earlier version still reads as it did", async () => {
    const m = await publishMockup("Versions", "<p>oldmockupword</p>");
    const s = await publishStory("versions", "Versions", "<p>oldstoryword</p>");
    const again = await alice.api("POST", `${P}/mockups`, { mockup_id: m.mockup_id, expected_etag: m.etag, pages: [{ page_id: "board", html: page("<p>newmockupword</p>") }] });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const story = await alice.api("POST", `${P}/story/pages/versions/versions`, { expected_etag: s.etag, html: page("<p>newstoryword</p>") });
    expect(story.status, JSON.stringify(story.body)).toBe(201);
    expect(await holding("newmockupword", "mockup")).toEqual([m.mockup_id]);
    expect(await holding("oldmockupword", "mockup")).toEqual([]);
    expect(await holding("newstoryword", "story")).toEqual(["versions"]);
    expect(await holding("oldstoryword", "story")).toEqual([]);
    const first = await alice.api("GET", `${P}/mockups/${m.mockup_id}/versions/1?include_html=true`);
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(1);
    expect(first.body.pages[0].html).toContain("oldmockupword");
  });

  it("leaves the words of the save that won when several land at once, for mockups and Story pages", async () => {
    for (let round = 0; round < 5; round++) {
      const m = await publishMockup(`Race ${round}`, `<p>raceold${round}</p>`);
      const s = await publishStory(`race-${round}`, `Race ${round}`, `<p>raceold${round}</p>`);
      const words = Array.from({ length: 6 }, (_, i) => `race${round}n${i}`);
      const mockups = await Promise.all(words.map((w) => alice.api("POST", `${P}/mockups`, { mockup_id: m.mockup_id, expected_etag: m.etag, pages: [{ page_id: "board", html: page(`<p>${w}</p>`) }] })));
      const stories = await Promise.all(words.map((w) => alice.api("POST", `${P}/story/pages/race-${round}/versions`, { expected_etag: s.etag, html: page(`<p>${w}</p>`) })));
      for (const [answers, kind, id] of [[mockups, "mockup", m.mockup_id], [stories, "story", `race-${round}`]] as const) {
        const won = answers.flatMap((a, i) => (a.status === 201 ? [words[i]!] : []));
        expect(won, JSON.stringify(answers.map((a) => a.status))).toHaveLength(1);
        for (const a of answers) if (a.status !== 201) expect(a.status).toBe(409);
        for (const w of words) expect(await holding(w, kind)).toEqual(w === won[0] ? [id] : []);
        expect(await holding(`raceold${round}`, kind)).toEqual([]);
      }
    }
  });

  it("is found by one version's words or the other's while it is saved, never by both or neither", async () => {
    let m = await publishMockup("Atomic", "<p>atomicfirst</p>");
    let saving = true;
    const answers: string[][] = [];
    const searching = (async () => {
      while (saving) {
        const r = await search("atomicfirst atomicsecond", "&kind=mockup");
        answers.push(r.results.find((x) => x.id === m.mockup_id)?.missing ?? ["nothing"]);
      }
    })();
    for (let i = 0; i < 12; i++) {
      const r = await alice.api("POST", `${P}/mockups`, { mockup_id: m.mockup_id, expected_etag: m.etag, pages: [{ page_id: "board", html: page(i % 2 ? "<p>atomicfirst</p>" : "<p>atomicsecond</p>") }] });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      m = { mockup_id: m.mockup_id, etag: r.body.etag };
    }
    saving = false;
    await searching;
    expect(answers.length).toBeGreaterThan(0);
    for (const missing of answers) expect(["atomicfirst", "atomicsecond"]).toContain(missing.length === 1 ? missing[0] : `${missing.length} words missing`);
  });
});

describe("a slow search", () => {
  it("is stopped at its time limit with a useful answer, gives its connection back, and leaves other work alone", async () => {
    const gate = gateOf({ budgetMs: 400 });
    const began = Date.now();
    const r = await whileSearchesAreStuck(() => alice.api("GET", `${P}/search?mode=plain&query=crew`));
    expect(r.status).toBe(503);
    expect(r.body.error).toMatchObject({ code: "search_timed_out", details: { budget_ms: 400 } });
    expect(r.body.error.message).toContain("Nothing was changed");
    expect(Date.now() - began).toBeLessThan(2500);
    expect(gate.running).toBe(0);
    expect(await runningSearches()).toBe(0);

    // The limit went with its transaction: no connection carries it, and a write has none.
    const settings = await Promise.all(Array.from({ length: 5 }, () => sql<{ s: string }>`select pg_sleep(0.05), current_setting('statement_timeout') as s`.execute(h.db)));
    expect(new Set(settings.map((x) => x.rows[0]!.s))).toEqual(new Set(["0"]));
    expect((await alice.api("POST", `${P}/outcomes`, { title: "After the stopped search" })).status).toBe(201);
    expect((await search("crew")).results).toBeDefined();
  });

  it("over MCP gets the same answer", async () => {
    gateOf({ budgetMs: 300 });
    const token = await h.connectAgent(alice, "slow-agent");
    const client = new Client({ name: "slow-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const r = await whileSearchesAreStuck(() => client.callTool({ name: "search", arguments: { product: path, mode: "plain", query: "crew" } }));
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toContain("search_timed_out");
    await client.close();
  });

  it("is ended by its statement's own limit when every connection is taken, so nothing can cancel it", async () => {
    const { db, pool } = createDb(h.config.databaseUrl, 1, 50);
    const gate = new SearchGate({ budgetMs: 300 });
    const began = Date.now();
    const stopped = await boundedSearch({ db, gate }, undefined, (begin) =>
      db.transaction().execute(async (trx) => {
        await begin(trx);
        await sql`select pg_sleep(30)`.execute(trx);
      }),
    ).catch((e: AppError) => e);
    expect((stopped as AppError).code).toBe("search_timed_out");
    expect(Date.now() - began).toBeLessThan(5000);
    expect(gate.running).toBe(0);
    await until(() => pool.idleCount === 1);
    await pool.end();
  });

  it("stops a statement after the first one, as well as the one running when time ran out", async () => {
    const gate = new SearchGate({ budgetMs: 200 });
    const began = Date.now();
    const stopped = await boundedSearch({ db: h.db, gate }, undefined, (begin) =>
      h.db.transaction().execute(async (trx) => {
        await begin(trx);
        // Time runs out here, with nothing running to cancel, and the next statement is cancelled.
        await new Promise((r) => setTimeout(r, 300));
        await sql`select pg_sleep(30)`.execute(trx);
      }),
    ).catch((e: AppError) => e);
    expect((stopped as AppError).code).toBe("search_timed_out");
    expect(Date.now() - began).toBeLessThan(3000);
  });

  it("leaves its connection alone once it has ended, whatever that connection does next", async () => {
    const { db, pool } = createDb(h.config.databaseUrl, 1);
    const gate = new SearchGate({ budgetMs: 150 });
    await boundedSearch({ db, gate }, undefined, (begin) => db.transaction().execute((trx) => begin(trx)));
    // The search has finished, and its one connection now serves something else past its time limit.
    await expect(sql`select pg_sleep(0.4)`.execute(db)).resolves.toBeDefined();
    await pool.end();
  });
});

describe("many searches at once", () => {
  it("leaves the connections other work needs, and refuses what it cannot run, with a burst stuck", async () => {
    const gate = gateOf({ budgetMs: 1200, slots: 2, queue: 3, waitMs: 300 });
    const answers = await whileSearchesAreStuck(async () => {
      const burst = Promise.all(Array.from({ length: 25 }, (_, i) => alice.api("GET", `${P}/search?mode=plain&query=${encodeURIComponent(`crew${i}`)}`)));
      await until(() => gate.running === 2);
      expect(gate.waiting).toBeLessThanOrEqual(3);
      // People go on loading pages while every search is stuck.
      for (let i = 0; i < 5; i++) {
        const began = Date.now();
        const ordinary = await Promise.all([alice.api("GET", `${P}/outcomes`), alice.api("GET", `${P}/assumptions`), alice.api("GET", `${P}/sources`)]);
        for (const r of ordinary) expect(r.status).toBe(200);
        expect(Date.now() - began).toBeLessThan(1000);
      }
      return burst;
    });
    const codes = answers.map((r) => r.body.error?.code);
    for (const r of answers) expect(r.status).toBe(503);
    expect(new Set(codes)).toEqual(new Set(["search_timed_out", "search_busy"]));
    expect(answers.find((r) => r.body.error?.code === "search_busy")!.headers.get("retry-after")).toBe("1");
    expect(gate.running).toBe(0);
    expect(gate.waiting).toBe(0);
    await until(async () => (await runningSearches()) === 0);
    expect((await search("crew")).results).toBeDefined();
  });

  it("takes waiting searches first come, first served, each holding a slot until it ends", async () => {
    const gate = new SearchGate({ slots: 1, queue: 2, waitMs: 2000 });
    const order: number[] = [];
    await gate.enter();
    const waiting = [1, 2].map((n) => gate.enter().then(() => order.push(n)));
    await expect(gate.enter()).rejects.toMatchObject({ code: "search_busy" });
    expect(gate.waiting).toBe(2);
    gate.leave();
    await waiting[0];
    expect(order).toEqual([1]);
    gate.leave();
    await waiting[1];
    expect(order).toEqual([1, 2]);
    expect(gate.running).toBe(1);
    gate.leave();
    expect(gate.running).toBe(0);
  });

  it("takes a search out of the queue when whoever asked goes, or when it has waited as long as it may", async () => {
    const gate = new SearchGate({ slots: 1, queue: 5, waitMs: 60 });
    await gate.enter();
    const gone = new AbortController();
    const cancelled = gate.enter(gone.signal);
    gone.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "search_cancelled" });
    await expect(gate.enter()).rejects.toMatchObject({ code: "search_busy" });
    expect(gate.waiting).toBe(0);
    gate.leave();
    await gate.enter(new AbortController().signal);
    gate.leave();
    const already = new AbortController();
    already.abort();
    await expect(gate.enter(already.signal)).rejects.toMatchObject({ code: "search_cancelled" });
    expect(gate.running).toBe(0);
  });
});

describe("whoever asked going away", () => {
  it("stops the search and its statement at once, in the web app's door", async () => {
    const gate = gateOf({ budgetMs: 30_000 });
    await whileSearchesAreStuck(async () => {
      const gone = new AbortController();
      const pending = fetch(`${h.baseUrl}${P}/search?mode=plain&query=crew`, { headers: { cookie: alice.cookie, origin: h.baseUrl }, signal: gone.signal }).catch((e: Error) => e);
      await until(async () => gate.running === 1 && (await runningSearches()) > 0);
      gone.abort();
      expect(await pending).toBeInstanceOf(Error);
      // Long before its time limit, and with what it was waiting for still held.
      await until(() => gate.running === 0, 2000);
      await until(async () => (await runningSearches()) === 0, 2000);
    });
  });

  it("stops the search and its statement at once, in an agent's door", async () => {
    const gate = gateOf({ budgetMs: 30_000 });
    const token = await h.connectAgent(alice, "leaving-agent");
    await whileSearchesAreStuck(async () => {
      const gone = new AbortController();
      const pending = fetch(`${h.baseUrl}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { product: path, mode: "plain", query: "crew" } } }),
        signal: gone.signal,
      }).catch((e: Error) => e);
      await until(async () => gate.running === 1 && (await runningSearches()) > 0);
      gone.abort();
      expect(await pending).toBeInstanceOf(Error);
      await until(() => gate.running === 0, 2000);
      await until(async () => (await runningSearches()) === 0, 2000);
    });
  });

  it("says nothing about it to a search that finished", async () => {
    const gate = gateOf({});
    const finished = new AbortController();
    const r = await fetch(`${h.baseUrl}${P}/search?mode=plain&query=crew`, { headers: { cookie: alice.cookie, origin: h.baseUrl }, signal: finished.signal });
    expect(r.status).toBe(200);
    finished.abort();
    expect(gate.running).toBe(0);
    expect((await search("crew")).results).toBeDefined();
  });
});

describe("waiting for a connection", () => {
  it("ends with an answer that says the server is busy, not a hang", async () => {
    const { db, pool } = createDb(h.config.databaseUrl, 1, 100);
    const held = await pool.connect();
    const began = Date.now();
    const e = await sql`select 1`.execute(db).catch((x: unknown) => x);
    expect(Date.now() - began).toBeLessThan(2000);
    expect(toAppError(e)).toMatchObject({ status: 503, code: "database_busy", details: { retry_after_seconds: 5 } });
    held.release();
    await pool.end();
    // The same when a new connection takes as long, as the pool words it.
    expect(toAppError(new Error("Connection terminated due to connection timeout"))).toMatchObject({ status: 503, code: "database_busy" });
  });

  it("is said in the log once it has lasted, in numbers alone", async () => {
    const lines: string[] = [];
    const pool = { totalCount: 10, idleCount: 0, waitingCount: 4 };
    const stop = watchPool(pool, { running: 3, waiting: 2 }, 15, (l) => lines.push(l));
    await until(() => lines.length > 0);
    const line = JSON.parse(lines[0]!);
    expect(line).toMatchObject({ severity: "ERROR", event: "database_pool_saturated", connections: 10, idle: 0, requests_waiting: 4, searches_running: 3, searches_waiting: 2 });
    expect(Object.keys(line).sort()).toEqual(["at", "connections", "event", "idle", "requests_waiting", "searches_running", "searches_waiting", "severity"]);
    pool.waitingCount = 0;
    await new Promise((r) => setTimeout(r, 50));
    const after = lines.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(lines.length).toBe(after);
    stop();
    // People waiting at one look and gone by the next is an ordinary busy moment: it says nothing.
    let looks = 0;
    const brief: string[] = [];
    const quiet = watchPool({ totalCount: 10, idleCount: 0, get waitingCount() { return ++looks % 2; } }, { running: 0, waiting: 0 }, 5, (l) => brief.push(l));
    await until(() => looks > 4);
    quiet();
    expect(brief).toEqual([]);
  });
});

describe("a product with many heavy pages", () => {
  const heavy = (i: number, n: number) =>
    page(`<style>${`.c${i}{color:red}\n`.repeat(2_400)}</style><section><h2>Screen ${i}</h2><p>commonword rare${i}x page ${n}</p></section><script>${`f${i}("<div></div>");\n`.repeat(2_600)}</script><p>afterscript${i}x</p>`);

  let mockupId = "";
  beforeAll(async () => {
    // 200 pages of about 90 KB each, about 18 MB, in mockups of ten pages.
    for (let m = 0; m < 20; m++) {
      const pages = Array.from({ length: 10 }, (_, n) => ({ page_id: `p${n}`, title: `Screen ${n}`, html: heavy(m * 10 + n, n) }));
      const r = await alice.api("POST", `${P}/mockups`, { title: `Heavy ${m}`, brief: "One of many.", pages });
      expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
      if (m === 7) mockupId = r.body.mockup_id;
    }
  }, 120_000);

  it("is searched inside the budget, for a rare word and for a word on every page", async () => {
    for (const query of ["rare75x", "afterscript75x", "commonword", "commonword screen page"]) {
      const began = Date.now();
      const r = await search(query, "&kind=mockup");
      expect(Date.now() - began, query).toBeLessThan(1000);
      expect(r.results.length).toBeGreaterThan(0);
    }
    expect((await search("afterscript75x", "&kind=mockup")).results.map((r) => r.id)).toEqual([mockupId]);
  });

  it("takes its words through the migration, every page that was there before it", async () => {
    const c = new pg.Client({ connectionString: h.config.databaseUrl });
    await c.connect();
    await c.query("begin");
    try {
      await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const before = (await c.query<{ n: number }>("select count(*)::int as n from mockup_pages")).rows[0]!.n;
      expect(before).toBeGreaterThanOrEqual(200);
      // As the tables stood before it, with what they hold now.
      await c.query("alter table mockup_pages drop column search_text, drop column tsv");
      await c.query("alter table story_versions drop column search_text, drop column tsv");
      await c.query("drop function html_search_text(text)");
      const began = Date.now();
      await c.query(readFileSync(fileURLToPath(new URL("../src/migrations/0040_html_pages_keep_their_words.sql", import.meta.url)), "utf8"));
      expect(Date.now() - began).toBeLessThan(20_000);
      const after = (await c.query<{ all: number; kept: number; found: number }>(
        "select count(*)::int as all, (count(*) filter (where tsv is not null))::int as kept, (count(*) filter (where tsv @@ to_tsquery('simple', 'afterscript75x')))::int as found from mockup_pages",
      )).rows[0]!;
      expect(after).toMatchObject({ all: before, kept: before, found: 1 });
    } finally {
      await c.query("rollback");
      await c.end();
    }
  });
});
