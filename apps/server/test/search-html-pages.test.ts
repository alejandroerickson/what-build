import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boundedSearch, SearchGate, toAppError, type AppError } from "@whatbuild/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createDb, migrate, migrationNames, watchPool } from "../src/database.ts";
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

/** What the migration is: the file itself. */
const migrationFile = (name: string) => readFileSync(fileURLToPath(new URL(`../src/migrations/${name}`, import.meta.url)), "utf8");
const THE_MIGRATION = "0040_html_pages_keep_their_words.sql";

/** A letter of four bytes (CJK Extension B). */
const bigLetter = (k: number) => String.fromCodePoint(0x20000 + k);
/** `n` such letters, each `k` its own. */
const bigPart = (k: number, n: number) => Array.from({ length: n }, (_, d) => bigLetter((Math.floor(k / 200 ** d) % 200) * 200 + d)).join("");
/** Words of `parts` parts of `n` such letters, up to the 200,000 characters a page's words are cut at. */
const hyphened = (n: number, parts = 2) => {
  const words: string[] = [];
  const each = parts * n + parts;
  for (let k = 0; words.length * each < 200_000; ) words.push(Array.from({ length: parts }, () => bigPart(k++, n)).join("-"));
  return words.join(" ");
};
const base36 = (i: number) => i.toString(36).padStart(4, "0");
const list = (n: number, word: (i: number) => string) => Array.from({ length: n }, (_, i) => word(i)).join(" ");

/** Pages of unusual words, as `<p>` so each is a page. Those marked `over` do not fit a vector whole. */
const UNUSUAL: { what: string; words: string; over?: boolean }[] = [
  { words: list(49_991, (i) => `${bigLetter(2 * i)}-${bigLetter(2 * i + 1)}`), over: true },
  { words: hyphened(127), over: true },
  { words: hyphened(3), over: true },
  { words: hyphened(3, 16), over: true },
  { words: list(40_000, (i) => `a-${base36(i)}.co/${base36(i)}`) },
  { words: list(25_000, (i) => `http://${base36(i)}.co/${base36(i)}/${base36(i + 1)}`) },
  { words: list(40_000, (i) => `${base36(i)}@a-b.co`) },
  { words: list(40_000, (i) => `${base36(i)}.co`) },
  { words: list(40_000, (i) => `/${base36(i)}/a.b`) },
  { words: list(25_000, (i) => `${base36(i)}-${base36(i + 50_000)}`) },
  { words: `${"\u023A".repeat(1023)} ${"\u023A".repeat(1023)}x` },
  { words: "y".repeat(5000) },
  { words: "./".repeat(100_000) },
  { words: "~/".repeat(100_000) },
  { words: "a_".repeat(100_000) },
  { words: "a1@".repeat(66_000) },
  { words: "<!-- ".repeat(40_000) },
  { words: "<!-- a ".repeat(28_000) },
].map((c, i) => ({ what: `unusual page ${i}`, ...c }));

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
    ["entities that stand for no letter, as blanks", "<p>Q&amp;A&nbsp;today</p>", "Q A today"],
    ["a tag before punctuation, with no space left", "<p><b>word</b>, then <i>another</i>.</p>", "word, then another."],
    ["a letter by its name", "<p>caf&eacute; cr&egrave;me, CAF&Eacute;.</p>", "café crème, CAFÉ."],
    ["a letter by its number", "caf&#233; caf&#xE9; caf&#xe9; caf&#XE9;", "café café café café"],
    ["a number with leading zeros", "caf&#00000000000000000233; caf&#x00000000000000000E9;", "café café"],
    ["letters beyond Latin, by name and by number", "&alpha;&#x3B2; &#x6F22;&#x5B57; &Scaron;koda &#xD55C;&#xAE00; &Afr; &fjlig;ord", "αβ 漢字 Škoda 한글 𝔄 fjord"],
    ["a letter's combining mark", "cafe&#769;", "cafe\u0301"],
    ["a number browsers read in windows-1252, as the letter they show", "&#138;koda &#x9E; &#131;", "Škoda ž ƒ"],
    ["an ampersand in text and a semicolon in text", "a & b; c &d e; fish &;", "a & b; c &d e; fish &;"],
    ["what only looks like a reference, for want of its semicolon", "caf&eacute caf&#233 caf&#xE9", "caf&eacute caf&#233 caf&#xE9"],
    ["one pass only, so an escaped reference is no reference", "&amp;eacute; &amp;lt; &amp;#233; &#38;eacute; &&#101;acute;", "eacute; lt; #233; eacute; &eacute;"],
    ["what a < is followed by, never a tag", "<&#115;cript>alert(1)</&#115;cript> x <&eacute;>", "< script>alert(1)</ script> x < é>"],
    ["a < before an ampersand that starts no reference, as written", "if a<&b then c</&d", "if a<&b then c</&d"],
    ["a < before what only looks like a reference, as written", "x<&eacute y</&#233", "x<&eacute y</&#233"],
    ["a < before a reference to no letter, as a word break", "a<&lt;b c</&nbsp;d", "a< b c</ d"],
  ])("handles %s", async (_what, html, words) => {
    expect(await wordsOf(html)).toBe(words);
  });

  it.each([
    ["markup, in every spelling", "&lt; &LT; &#60; &#060; &#x3C; &#x3c; &#X3C; &gt; &GT; &#62; &#x3e; &amp; &AMP; &#38; &#x26; &quot; &#34; &apos; &#39; &#x27; &#96; &grave; &sol; &#47;"],
    ["space, joiners and a soft hyphen", "&nbsp; &#160; &#xA0; &ensp; &thinsp; &shy; &#173; &zwj; &zwnj; &#10; &NewLine; &Tab;"],
    ["punctuation and symbols", "&rsquo; &#8217; &mdash; &#8212; &hellip; &copy; &euro; &#150; &#146; &times; &divide; &#x1F600; &#128512; &trade;"],
    ["digits", "&#48; &#x39; &#x661;"],
    ["a name nobody defined, or any other shape of one", "&nosuch; &Eacute2; &a#b; &##65; &#xx41; &#x#41; &#12a; &#xZZ;"],
    ["numbers that are no character", "&#; &#x; &#0; &#00; &#x0; &#X000; &#xD800; &#xDFFF; &#55296; &#57343; &#1114112; &#x110000; &#x7FFFFFFF; &#2147483648; &#4294967296; &#99999999999999999999999999; &#xFFFFFFFFFFFFFFFFFFFFFFFF;"],
    ["controls, noncharacters and direction overrides", "&#1; &#x1F; &#127; &#x81; &#x9D; &#xFDD0; &#xFFFE; &#xFFFF; &#x1FFFF; &#x10FFFF; &#x202E; &#xFEFF;"],
  ])("leaves %s a word break, with no error", async (_what, refs) => {
    for (const ref of refs.split(" ")) expect(await wordsOf(`x${ref}y`), ref).toBe("x y");
  });

  it("never holds a tag or a < made of a reference, so what reads it as text has nothing to escape that the page did not say", async () => {
    const words = await wordsOf("&lt;script&gt;alert(1)&lt;/script&gt; &#60;img src=x onerror=alert(1)&#62; &#x3C;b&#x3E; <&#115;cript>x</&#115;cript> <&#98;>y</&#98;>");
    expect(words).toBe("script alert(1) /script img src=x onerror=alert(1) b < script>x</ script> < b>y</ b>");
    expect(words).not.toMatch(/<\/?[a-z]/i);
    // The parser of a search vector would drop a whole tag, and the word with it.
    const v = await sql<{ v: string }>`select to_tsvector('simple', html_search_text(${"<&#115;cript>"}))::text as v`.execute(h.db);
    expect(v.rows[0]!.v).toBe("'script':1");
  });

  it.each([
    ["an ampersand in text", "if a<&b then c &d; e"],
    ["a < before punctuation", "x <, y"],
    ["references to no letter", "a<&lt;b q &amp; a , b &nosuch; &#0;c"],
    ["one and a semicolon alone", "<& </& &; ;"],
  ])("reads a page with no letter's reference as it read before references gave letters: %s", async (_what, text) => {
    const was = text.replace(/&[a-zA-Z0-9#]+;/g, " ").replace(/\s+/g, " ").replace(/ ([,.;:!?)])/g, "$1").trim();
    expect(await wordsOf(text)).toBe(was);
  });

  it("gives a search vector nothing to take for a tag or a comment, so it finds what the words say", async () => {
    const vector = async (html: string) => (await sql<{ v: string }>`select words_search_vector(html_search_text(${html}))::text as v`.execute(h.db)).rows[0]!.v;
    // Punctuation closes on the space &lt; left, so the words look as though the page wrote a tag.
    expect(await wordsOf("<&lt;:&#115;cript>x word")).toBe("<:script>x word");
    expect(await vector("<&lt;:&#115;cript>x word")).toBe("'script':1 'word':3 'x':2");
    expect(await vector("<:script>x word")).toBe("'script':1 'word':3 'x':2");
    expect(await vector("<&#115;cript>x word")).toBe("'script':1 'word':3 'x':2");
    expect(await vector("a <!-- b c")).toBe("'a':1 'b':2 'c':3");
  });

  describe("a run with no space in it", () => {
    const vector = async (words: string) => (await sql<{ v: string }>`select words_search_vector(${words})::text as v`.execute(h.db)).rows[0]!.v;
    const says = async (words: string, word: string) => (await sql<{ s: boolean }>`select words_search_vector(${words}) @@ to_tsquery('simple', ${`'${word}'`}) as s`.execute(h.db)).rows[0]!.s;
    /** Whether the parser here takes letters beyond ASCII for letters and their punctuation for punctuation, as it does in every locale but C. */
    const readsPunctuation = async () => (await sql<{ s: boolean }>`select length(to_tsvector('simple', 'x。y')) = 2 as s`.execute(h.db)).rows[0]!.s;

    /** Twenty clauses of forty letters each, joined by a full stop with no space. */
    const clauses = Array.from({ length: 20 }, (_, i) => Array.from({ length: 40 }, (_, k) => String.fromCodePoint(0x4e00 + i * 100 + k)).join(""));
    /** Eighty words joined by commas with no space, 879 characters; three of them lie across a place every 255 characters. */
    const listed = Array.from({ length: 80 }, (_, i) => ({ 23: "wordlingxa", 46: "wordlingub", 69: "wordlingrc" })[i] ?? `wordling${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);

    it("is whole up to its limit, and only a word longer than that is cut through", async () => {
      expect(await vector("x".repeat(255))).toBe(`'${"x".repeat(255)}':1`);
      expect(await vector(`${"x".repeat(255)}${"y".repeat(10)}`)).toBe(`'${"x".repeat(255)}':1 '${"y".repeat(10)}':2`);
      // A word of two hundred characters, or an address, is whole.
      const address = `https://example.com/${"path/".repeat(40)}end`;
      expect(await vector(address)).toContain(`'example.com/${"path/".repeat(40)}end'`);
    });

    it("is cut where a word ends, so every clause of a language written without spaces is found", async () => {
      if (!(await readsPunctuation())) return;
      const words = clauses.join("。");
      expect(words.length).toBeGreaterThan(255 * 3);
      for (const clause of clauses) expect(await says(words, clause), clause).toBe(true);
      const { mockup_id } = await publishMockup("Clauses", `<p>${words}</p>`);
      await publishStory("clauses", "Clauses", `<p>${words}</p>`);
      for (const k of [6, 12, 18]) {
        expect(await holding(clauses[k]!, "mockup")).toEqual([mockup_id]);
        expect(await holding(clauses[k]!, "story")).toEqual(["clauses"]);
      }
    });

    it("is cut where a word ends, so every word of a list with no spaces is found", async () => {
      const words = listed.join(",");
      expect(words.length).toBe(879);
      for (const word of listed) expect(await says(words, word), word).toBe(true);
      const { mockup_id } = await publishMockup("List", `<p>${words}</p>`);
      await publishStory("list", "List", `<p>${words}</p>`);
      for (const word of ["wordlingxa", "wordlingub", "wordlingrc"]) {
        expect(await holding(word, "mockup")).toEqual([mockup_id]);
        expect(await holding(word, "story")).toEqual(["list"]);
      }
      // The excerpt was never cut: it shows the words as the page has them.
      const r = await search("wordlingub", "&kind=mockup");
      expect(r.results.find((x) => x.id === mockup_id)!.snippet).toContain("wordlingub");
    });

    it("is cut through only when nothing in reach ends a word, and a word past the limit is found by the start of each piece", async () => {
      const run = Array.from({ length: 600 }, (_, k) => String.fromCodePoint(0x4e00 + k)).join("");
      const lexemes = (await sql<{ l: string[] }>`select tsvector_to_array(words_search_vector(${run})) as l`.execute(h.db)).rows[0]!.l;
      expect(lexemes.map((l) => [...l].length).sort((a, b) => b - a)).toEqual([255, 255, 90]);
      expect(lexemes.join("").length).toBe(600);
      expect(await says(run, run.slice(0, 255))).toBe(true);
      expect(await says(run, run.slice(255, 510))).toBe(true);
      // Where something in reach does end a word, the long word after it starts a piece of its own.
      const after = `${"a".repeat(20)},${"b".repeat(300)}`;
      expect(await vector(after)).toContain(`'${"a".repeat(20)}':1`);
      expect(await vector(after)).toContain(`'${"b".repeat(255)}':2`);
    });

    it("leaves a run ended by any of ASCII's spaces alone, and any run that is not past the limit", async () => {
      for (const space of [" ", "\t", "\n", "\r", "\f", "\v"]) {
        const words = `${"a,".repeat(100)}end${space}${"b-".repeat(100)}end`;
        expect(await vector(words), JSON.stringify(space)).toBe((await sql<{ v: string }>`select to_tsvector('simple', ${words})::text as v`.execute(h.db)).rows[0]!.v);
      }
    });

    it("takes as an end of a word what is no letter, mark or number, in any script", async () => {
      const parsed = async (words: string) => (await sql<{ v: string }>`select to_tsvector('simple', ${words})::text as v`.execute(h.db)).rows[0]!.v;
      const [a, b] = ["a".repeat(200), "b".repeat(200)];
      for (const end of [",", ";", ":", ".", "/", "-", "_", "@", "!", "?", ")", "\u00A0", "\u2014", "\u2026", "\u3000", "\u3001", "\u3002", "\uFF01", "\uFF0C", "\u060C", "\u061F", "\u06D4", "\u0964", "\u0E5A", "\u{1F389}"]) {
        expect(await vector(`${a}${end}${b}`), end).toBe(await parsed(`${a}${end} ${b}`));
      }
      for (const within of ["\u00E9", "\u4E00", "\u0E01", "\u0627", "\u0301", "7", "\u0663", "\u2460"]) {
        const words = `${a}${within}${b}`;
        expect(await vector(words), within).toBe(await parsed(`${words.slice(0, 255)} ${words.slice(255)}`));
      }
    });

    it("does not follow a collation, as an immutable function may not", async () => {
      const words = [clauses.join("。"), listed.join(","), `${"x".repeat(300)}\u3000${"y".repeat(300)}`, `${"x".repeat(300)}\u00A0${"y".repeat(300)}`];
      for (const text of words) {
        const r = await sql<{ d: string; c: string; p: string }>`select words_search_vector(${text} collate "default")::text as d, words_search_vector(${text} collate "C")::text as c, words_search_vector(${text} collate "POSIX")::text as p`.execute(h.db);
        expect(r.rows[0]!.c).toBe(r.rows[0]!.d);
        expect(r.rows[0]!.p).toBe(r.rows[0]!.d);
      }
      const fn = (await sql<{ v: string; src: string }>`select provolatile as v, prosrc as src from pg_proc where proname = 'words_search_vector'`.execute(h.db)).rows[0]!;
      expect(fn.v).toBe("i");
      // A regular expression's classes follow the database's locale, and its ranges do not.
      expect(fn.src).not.toMatch(/\\[sSwWdD]|\[\[:|\[\[\.|\[\[=/);
    });
  });

  it("is computed in functions that name nothing of ours, so a backup restores with an empty search_path", async () => {
    await h.db.transaction().execute(async (trx) => {
      await sql`set local search_path = ''`.execute(trx);
      const r = await sql<{ t: string }>`select public.html_search_text(${"caf&eacute; caf&#233; caf&#xE9; &#138;"}) as t`.execute(trx);
      expect(r.rows[0]!.t).toBe("café café café Š");
      // The vector's function too, the way a vector too long takes it.
      const v = await sql<{ n: number }>`select length(public.words_search_vector(${hyphened(3)})) as n`.execute(trx);
      expect(v.rows[0]!.n).toBeGreaterThan(0);
    });
  });

  it("stands alone: no index, view or other object depends on the words", async () => {
    const r = await sql<{ d: string }>`
      select d.classid::regclass::text || ' ' || d.objid::text as d from pg_depend d
      join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
      where d.refobjid in ('mockup_pages'::regclass, 'story_versions'::regclass) and a.attname in ('search_text', 'tsv')
        and d.classid <> 'pg_attrdef'::regclass`.execute(h.db);
    expect(r.rows).toEqual([]);
  });

  it("stays quick on every unusual page, at a page's limit", async () => {
    const pages = [
      `<script>${'x="<div></div>";\n'.repeat(55_000)}</script>`,
      "<style>a{}</style><p>between</p>".repeat(30_000),
      "<script>a</script><p>w</p>".repeat(36_000),
      "<style>a{}<p>between</p>".repeat(40_000),
      "<script></style><style></script>".repeat(30_000),
      `<script ${"a ".repeat(490_000)}`,
      "<!-- a ".repeat(140_000),
      `<div ${"x".repeat(990_000)}`,
      "<".repeat(990_000),
      "&a".repeat(495_000),
      "&".repeat(1_000_000),
      `${"&".repeat(999_999)};`,
      ";".repeat(1_000_000),
      "&;".repeat(500_000),
      "&a;".repeat(333_000),
      "&eacute;".repeat(125_000),
      "&#233;".repeat(166_000),
      "&#xE9;".repeat(166_000),
      "&#0;".repeat(250_000),
      "&#;".repeat(333_000),
      "</&#97;".repeat(142_000),
      `&${"a".repeat(999_000)};`,
      `&#${"9".repeat(999_000)};`,
      "  ,".repeat(330_000),
      " ".repeat(990_000),
      "\u4E00".repeat(200_000),
      `,${"x".repeat(254)}`.repeat(784),
      ...UNUSUAL.map(({ words }) => words),
    ];
    for (const [i, html] of pages.entries()) {
      const began = Date.now();
      await sql`select words_search_vector(html_search_text(${html}))`.execute(h.db);
      expect(Date.now() - began, `page ${i}`).toBeLessThan(3000);
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

  describe("whatever the words are, a search vector never raises", () => {
    // A product of their own: this makes more mockups than the product around it may hold.
    let around = "";
    beforeAll(async () => {
      around = P;
      const [tenant, team] = path.split("/");
      const p = await alice.api("POST", `/api/v1/teams/${tenant}/${team}/products`, { name: "Unusual words", concept: "Words of every kind." });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      P = `/api/v1/p/${p.body.path}`;
    });
    afterAll(() => {
      P = around;
    });

    const vectorOf = async (words: string) => (await sql<{ v: string | null; n: number | null }>`select words_search_vector(${words})::text as v, length(words_search_vector(${words}))::int as n`.execute(h.db)).rows[0]!;

    it("takes as many of them as fit, and the words that do not fit are not found", async () => {
      for (const { what, words } of UNUSUAL.filter((x) => x.over)) {
        // Over the limit whole, or this would prove nothing.
        const whole = await sql`select to_tsvector('simple', ${words})`.execute(h.db).then(() => null, (e: { code: string }) => e.code);
        expect(whole, what).toBe("54000");
        const tagged = `firstword ${words} lastword`;
        const r = (await sql<{ first: boolean; last: boolean; n: number }>`select words_search_vector(${tagged}) @@ to_tsquery('simple', 'firstword') as first, words_search_vector(${tagged}) @@ to_tsquery('simple', 'lastword') as last, length(words_search_vector(${tagged}))::int as n`.execute(h.db)).rows[0]!;
        expect(r, what).toMatchObject({ first: true, last: false });
        expect(r.n, what).toBeGreaterThan(100);
      }
    });

    it.each(UNUSUAL.map((c) => [c.what, c.words] as const))("holds for %s", async (_what, words) => {
      expect((await vectorOf(words)).v).not.toBeNull();
    });

    it("holds for text nobody planned, and gives an empty text an empty vector and no text none", async () => {
      // The same text every run, so a failure can be repeated.
      let seed = 20_260_731;
      const next = (n: number) => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % n;
      const pieces = [" ", " ", "-", "-", ".", "/", "@", "://", "_", ":", "<", ">", "&", ";", "#", "=", "?", "1", "2.5", "1e9", "a", "co", "http", "\u023A", "\u0130", "é", "ß", "\u05D0", "\u0627", "漢", "\u0301", "\uD83D\uDE00", "\uFFFD", "\u200D"];
      for (let round = 0; round < 20; round++) {
        const size = 1 + next(60);
        const fragments = Array.from({ length: size }, () => (next(2) ? pieces[next(pieces.length)]! : bigPart(next(40_000), 1 + next(4))));
        let text = "";
        while (text.length < 300_000) text += fragments[next(size)]! + (next(3) ? "" : bigPart(next(40_000), 2));
        expect((await sql<{ t: boolean }>`select words_search_vector(html_search_text(${text})) is not null as t`.execute(h.db)).rows[0]!.t, `round ${round}`).toBe(true);
      }
      expect((await vectorOf("")).v).toBe("");
      expect((await sql<{ v: string | null }>`select words_search_vector(null) as v`.execute(h.db)).rows[0]!.v).toBeNull();
    });

    it("is let go when its statement is cancelled, rather than catching that as well", async () => {
      await expect(
        h.db.transaction().execute(async (trx) => {
          await sql`set local statement_timeout = '1ms'`.execute(trx);
          await sql`select words_search_vector(${hyphened(3)})`.execute(trx);
        }),
      ).rejects.toMatchObject({ code: "57014" });
    });

    it("saves each such page and finds its first words, as a mockup and as a Story page, and leaves its HTML whole", async () => {
      for (const [i, { what, words, over }] of UNUSUAL.entries()) {
        const first = `unusualfirst${i}x`;
        const last = `unusuallast${i}x`;
        const body = `<p>${first} ${words} ${last}</p>`;
        const m = await publishMockup(`Unusual ${i}`, body);
        await publishStory(`unusual-${i}`, `Unusual ${i}`, body);
        expect(await holding(first, "mockup"), what).toEqual([m.mockup_id]);
        expect(await holding(first, "story"), what).toEqual([`unusual-${i}`]);
        if (over) {
          expect(await holding(last, "mockup"), what).toEqual([]);
          expect(await holding(last, "story"), what).toEqual([]);
        }
        const read = await alice.api("GET", `${P}/mockups/${m.mockup_id}/versions/1?include_html=true`);
        expect(read.body.pages[0].html, what).toBe(page(body));
      }
    }, 120_000);

    it("saves such words spelled by number, at a page's whole limit", async () => {
      const spelled = list(49_991, (i) => `&#x${(0x20000 + 2 * i).toString(16)};-&#x${(0x20001 + 2 * i).toString(16)};`);
      const body = `<p>spelledfirstword ${spelled}</p>`;
      expect(page(body).length).toBeLessThan(1_000_000);
      const m = await publishMockup("Spelled unusual", body);
      await publishStory("spelled-unusual", "Spelled unusual", body);
      expect(await holding("spelledfirstword", "mockup")).toEqual([m.mockup_id]);
      expect(await holding("spelledfirstword", "story")).toEqual(["spelled-unusual"]);
    });

    it("keeps the first 200,000 characters of words beside the vector, whatever the vector holds", async () => {
      const r = await sql<{ w: number }>`select length(html_search_text(${hyphened(3)}))::int as w`.execute(h.db);
      expect(r.rows[0]!.w).toBeLessThanOrEqual(200_000);
      expect(r.rows[0]!.w).toBeGreaterThan(190_000);
    });
  });

  it("saves a page of references that are no character, for mockups and Story pages alike", async () => {
    const body = `<p>savedword ${"&#0; &#xD800; &#1114112; &#99999999999999999999; &#xFFFFFFFFFFFF; ".repeat(100)}</p>`;
    const { mockup_id } = await publishMockup("Odd numbers", body);
    await publishStory("odd-numbers", "Odd numbers", body);
    expect(await holding("savedword", "mockup")).toEqual([mockup_id]);
    expect(await holding("savedword", "story")).toEqual(["odd-numbers"]);
  });

  describe("spelled with an entity", () => {
    let mockupId = "";
    beforeAll(async () => {
      const body = "<p>Le Caf&eacute; du coin, la cr&#232;me, l'ann&#xE9;e, mon r&eacute;sum&eacute;, un cafe&#769; et cinco a&ntilde;os.</p>";
      ({ mockup_id: mockupId } = await publishMockup("Entities", body));
      await publishStory("entities", "Entities", body);
    });

    it.each([
      ["as it is stored", "café"],
      ["in capitals", "CAFÉ"],
      ["a letter from a decimal number", "crème"],
      ["a letter from a hex number", "année"],
      ["while it is typed", "caf"],
      ["without its accent, whose root starts the same", "cafe"],
    ])("is found %s", async (_how, word) => {
      expect(await holding(word, "mockup")).toEqual([mockupId]);
      expect(await holding(word, "story")).toEqual(["entities"]);
    });

    it("is not found without an accent that comes before the root's end, as the index keeps accents, like a word written out", async () => {
      expect(await holding("résumé", "mockup")).toEqual([mockupId]);
      expect(await holding("resume", "mockup")).toEqual([]);
      expect(await holding("anos", "mockup")).toEqual([]);
      const written = await publishMockup("Written out", "<p>mon pâté</p>");
      expect(await holding("pâté", "mockup")).toEqual([written.mockup_id]);
      expect(await holding("pate", "mockup")).toEqual([]);
    });

    it("is shown and marked as the letter, in an excerpt", async () => {
      const r = await alice.api("GET", `${P}/search?mode=plain&strict=true&kind=mockup&query=${encodeURIComponent("crème")}`);
      const hit = r.body.results.find((x: { id: string }) => x.id === mockupId) as { snippet: string; snippet_marks: [number, number][] };
      expect(hit.snippet).toContain("Le Café du coin, la crème,");
      expect(hit.snippet_marks.map(([a, b]) => hit.snippet.slice(a, b))).toEqual(["crème"]);
    });

    it("is found by an agent too", async () => {
      const token = await h.connectAgent(alice, "entity-agent");
      const client = new Client({ name: "entity-agent", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
      const r = await client.callTool({ name: "search", arguments: { product: path, mode: "plain", query: "crème" } });
      expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
      const results = JSON.parse((r.content as { text: string }[])[0]!.text).results as { kind: string; id: string; snippet: string }[];
      expect(results.map((x) => x.id).sort()).toEqual(["entities", mockupId].sort());
      expect(results[0]!.snippet).toContain("crème");
      await client.close();
    });
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

describe("what has no stored vector", () => {
  // A product of its own: a search here reads nothing but these.
  let around = "";
  const unusual = (n: number) => "a1@".repeat(Math.floor(n / 3));
  beforeAll(async () => {
    around = P;
    const [tenant, team] = path.split("/");
    const p = await alice.api("POST", `/api/v1/teams/${tenant}/${team}/products`, { name: "Long texts", concept: "Texts at their limits." });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    P = `/api/v1/p/${p.body.path}`;
  });
  afterAll(() => {
    P = around;
  });

  /** Publishes and searches for a word beside it, within the time a search has. */
  const foundWithin = async (word: string, kind: string) => {
    const began = Date.now();
    const r = await search(word, `&kind=${kind}`);
    expect(Date.now() - began, word).toBeLessThan(5000);
    return r.results.filter((x) => !x.missing.length).map((x) => x.id);
  };

  it("takes a brief at its limit no longer than a search has, on a canvas of every page it may hold, and the word beside it is found", async () => {
    const pages = Array.from({ length: 48 }, (_, n) => ({ page_id: `p${n}`, title: `Screen ${n}`, html: page(`<p>screen ${n}</p>`) }));
    const r = await alice.api("POST", `${P}/mockups`, { title: "At the brief's limit", brief: `briefmarkword ${unusual(49_000)}`, pages });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    expect(await foundWithin("briefmarkword", "mockup")).toEqual([r.body.mockup_id]);
    // Neither does it hold up a word in anything else, or one that nothing says.
    expect(await foundWithin("screen", "mockup")).toEqual([r.body.mockup_id]);
    expect(await foundWithin("absentword", "mockup")).toEqual([]);
  });

  it("finds a word in an ordinary brief, summary, title, page title and notes, each as it did", async () => {
    const r = await alice.api("POST", `${P}/mockups`, {
      title: "Plain titleonlyword",
      summary: "A plain summaryonlyword.",
      brief: "A plain **briefonlyword** in Markdown.",
      pages: [{ page_id: "first", title: "Pagetitleonlyword", notes: "A plain notesonlyword.", html: page("<p>Nothing else.</p>") }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    for (const word of ["titleonlyword", "summaryonlyword", "briefonlyword", "pagetitleonlyword", "notesonlyword"]) expect(await foundWithin(word, "mockup"), word).toEqual([r.body.mockup_id]);
  });

  it("takes a summary, notes and a page title at their limits the same way", async () => {
    const pages = Array.from({ length: 12 }, (_, n) => ({ page_id: `p${n}`, title: unusual(200), notes: `notesmarkword ${unusual(9_900)}`, html: page("<p>Nothing else.</p>") }));
    const r = await alice.api("POST", `${P}/mockups`, { title: "At the notes' limit", summary: `summarymarkword ${unusual(1_900)}`, pages });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    expect(await foundWithin("summarymarkword", "mockup")).toEqual([r.body.mockup_id]);
    expect(await foundWithin("notesmarkword", "mockup")).toEqual([r.body.mockup_id]);
  });

  it("takes a Story page's title and summary, an outcome's description and a source's title the same way", async () => {
    const s = await alice.api("POST", `${P}/story/pages/long-summary/versions`, { title: unusual(200), summary: `storymarkword ${unusual(1_900)}`, html: page("<p>Nothing else.</p>") });
    expect(s.status, JSON.stringify(s.body).slice(0, 300)).toBe(201);
    expect(await foundWithin("storymarkword", "story")).toEqual(["long-summary"]);
    const o = await alice.api("POST", `${P}/outcomes`, { title: "Long description", description: `outcomemarkword ${unusual(5_900)}` });
    expect(o.status, JSON.stringify(o.body).slice(0, 300)).toBeLessThan(300);
    expect(await foundWithin("outcomemarkword", "outcome")).toEqual([o.body.outcome_id]);
    const t = await alice.api("POST", `${P}/sources`, { title: `sourcemarkword ${unusual(180)}`, date: "2026-01-01", tags: ["sourcetagword"] });
    expect(t.status, JSON.stringify(t.body).slice(0, 300)).toBeLessThan(300);
    expect(await foundWithin("sourcemarkword", "source")).toEqual([t.body.record_id]);
    expect(await foundWithin("sourcetagword", "source")).toEqual([t.body.record_id]);
  });

  it("leaves no raw vector anywhere in the search", () => {
    expect(readFileSync(fileURLToPath(new URL("../../../packages/core/src/ops/plain-search.ts", import.meta.url)), "utf8")).not.toContain("to_tsvector(");
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
    // Postgres may report a cancelled statement as active for a moment after the answer has gone.
    await vi.waitFor(async () => expect(await runningSearches()).toBe(0), { timeout: 2000 });

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
    expect((await alice.api("POST", `${P}/mockups`, { title: "Spelled", pages: [{ page_id: "board", title: "Board", html: page("<p>migratedcaf&eacute;</p>") }] })).status).toBe(201);
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
      await c.query("drop function words_search_vector(text)");
      await c.query("drop function html_search_text(text)");
      const began = Date.now();
      await c.query(migrationFile(THE_MIGRATION));
      // A shared runner can take twice its usual time; this is for a rewrite that has stopped being linear.
      expect(Date.now() - began).toBeLessThan(45_000);
      const after = (await c.query<{ all: number; kept: number; found: number; letter: number }>(
        "select count(*)::int as all, (count(*) filter (where tsv is not null))::int as kept, (count(*) filter (where tsv @@ to_tsquery('simple', 'afterscript75x')))::int as found, (count(*) filter (where tsv @@ to_tsquery('simple', 'migratedcafé') and search_text like '%migratedcafé%'))::int as letter from mockup_pages",
      )).rows[0]!;
      expect(after).toMatchObject({ all: before, kept: before, found: 1, letter: 1 });
      // The columns are generated still, by these functions: a row written now has the letter too.
      const generated = (await c.query<{ n: number }>("select count(*)::int as n from information_schema.columns where table_name in ('mockup_pages', 'story_versions') and column_name in ('search_text', 'tsv') and is_generated = 'ALWAYS'")).rows[0]!.n;
      expect(generated).toBe(4);
    } finally {
      await c.query("rollback");
      await c.end();
    }
  });
});

describe("the upgrade, on a database from before the migration", () => {
  const before = `before_${randomBytes(6).toString("hex")}`;
  const owned: string[] = [];
  const urlOf = (name: string) => inject("appUrlTemplate").replace("{db}", name);
  const adminQuery = async (text: string) => {
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    try {
      await admin.query(text);
    } finally {
      await admin.end();
    }
  };
  /** A database of its own, holding what `before` holds. */
  const aCopy = async () => {
    const name = `upgrade_${randomBytes(6).toString("hex")}`;
    await adminQuery(`create database "${name}" template "${before}"`);
    await adminQuery(`alter database "${name}" owner to whatbuild`).catch(() => undefined);
    owned.push(name);
    return urlOf(name);
  };
  const clientOf = async (url: string) => {
    const c = new pg.Client({ connectionString: url });
    c.on("error", () => undefined);
    await c.connect();
    await c.query("select set_config('app.tenant_id', 't', false)");
    return c;
  };
  const actor = JSON.stringify({ type: "user", id: "u" });
  const held = async (c: pg.Client, pid: number) =>
    (await c.query<{ relname: string }>("select c.relname from pg_locks l join pg_class c on c.oid = l.relation where l.pid = $1 and l.mode = 'AccessExclusiveLock' and l.granted and c.relname in ('story_versions', 'mockup_pages')", [pid])).rows.map((r) => r.relname);

  beforeAll(async () => {
    await adminQuery(`create database "${before}" owner whatbuild`).catch(() => adminQuery(`create database "${before}"`));
    const c = new pg.Client({ connectionString: urlOf(before) });
    await c.connect();
    await c.query("create table schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    for (const name of migrationNames().filter((f) => f < THE_MIGRATION)) {
      await c.query("begin");
      await c.query(migrationFile(name));
      await c.query("insert into schema_migrations (name) values ($1)", [name]);
      await c.query("commit");
    }
    await c.query("select set_config('app.tenant_id', 't', false)");
    await c.query("insert into tenants (tenant_id, slug, name, created_by) values ('t', 't', 'T', $1)", [actor]);
    await c.query("insert into teams (team_id, tenant_id, slug, name, created_by) values ('tm', 't', 'tm', 'Tm', $1)", [actor]);
    await c.query("insert into products (product_id, tenant_id, team_id, slug, name, etag, created_by, updated_by) values ('p', 't', 'tm', 'p', 'P', 'e', $1, $1)", [actor]);
    await c.query("insert into mockups (mockup_id, tenant_id, product_id, title, current_version_id, version_count, etag, created_by, updated_by) values ('m', 't', 'p', 'M', 'mv', 1, 'e', $1, $1)", [actor]);
    await c.query("insert into mockup_versions (version_id, tenant_id, product_id, mockup_id, n, title, created_by) values ('mv', 't', 'p', 'm', 1, 'M', $1)", [actor]);
    await c.query("insert into story_pages (tenant_id, product_id, page_id, title, current_version_id, version_count, etag, created_by, updated_by) values ('t', 'p', 's', 'S', 'sv0', 1, 'e', $1, $1)", [actor]);
    const pages = [{ what: "ordinary", words: "ordinaryword caf&eacute; between <script>hidden()</script> words", over: false }, ...UNUSUAL.map((c) => ({ ...c, words: `stored ${c.words} lastword` }))];
    for (const [i, { words }] of pages.entries()) {
      const html = `<p>firstword${i} ${words}</p>`;
      await c.query("insert into mockup_pages (version_id, tenant_id, product_id, position, page_id, title, width, height, html) values ('mv', 't', 'p', $1, $2, 'P', 800, 600, $3)", [i, `page${i}`, html]);
      await c.query("insert into story_versions (version_id, tenant_id, product_id, page_id, n, title, html, created_by) values ($1, 't', 'p', 's', $2, 'S', $3, $4)", [`sv${i}`, i + 1, html, actor]);
    }
    // A page that enters a prototype has no HTML.
    await c.query("insert into mockup_pages (version_id, tenant_id, product_id, position, page_id, title, width, height, entry) values ('mv', 't', 'p', 999, 'proto', 'P', 800, 600, 'index.html')");
    await c.end();
  }, 120_000);

  afterAll(async () => {
    for (const name of [...owned, before]) await adminQuery(`drop database if exists "${name}" with (force)`);
  });

  it("takes every page through it, whatever its words, with the migration after it", async () => {
    const { db, pool } = createDb(await aCopy(), 1);
    const ran = await migrate(db, () => {});
    expect(ran).toEqual(migrationNames().filter((f) => f >= THE_MIGRATION));
    expect(ran.length).toBeGreaterThanOrEqual(2);
    const c = await clientOf(pool.options.connectionString!);
    for (const table of ["mockup_pages", "story_versions"]) {
      const order = table === "story_versions" ? "t.n" : "t.position";
      const rows = (await c.query<{ words: number; lexemes: number; first: boolean; last: boolean }>(`select length(t.search_text)::int as words, length(t.tsv)::int as lexemes, t.tsv @@ to_tsquery('simple', 'firstword' || (row_number() over (order by ${order}) - 1)) as first, t.tsv @@ to_tsquery('simple', 'lastword') as last from ${table} t where t.html is not null order by ${order}`)).rows;
      expect(rows.length).toBe(UNUSUAL.length + 1);
      for (const [i, r] of rows.entries()) {
        expect(r.first, `${table} ${i}`).toBe(true);
        expect(r.lexemes, `${table} ${i}`).toBeGreaterThan(0);
        expect(r.words, `${table} ${i}`).toBeLessThanOrEqual(200_000);
        if (UNUSUAL[i - 1]?.over) expect(r.last, `${table} ${i}`).toBe(false);
      }
    }
    expect((await c.query<{ w: string }>("select search_text as w from mockup_pages where page_id = 'page0'")).rows[0]!.w).toBe("firstword0 ordinaryword café between words");
    expect((await c.query<{ w: string | null; t: string | null }>("select search_text as w, tsv::text as t from mockup_pages where page_id = 'proto'")).rows[0]).toEqual({ w: null, t: null });
    // Generated, by a function a generated column may call.
    expect((await c.query<{ n: number }>("select count(*)::int as n from information_schema.columns where table_name in ('mockup_pages', 'story_versions') and column_name in ('search_text', 'tsv') and is_generated = 'ALWAYS'")).rows[0]!.n).toBe(4);
    expect((await c.query<{ v: string }>("select provolatile as v from pg_proc where proname = 'words_search_vector'")).rows[0]!.v).toBe("i");
    // The next save of such a page raises nothing either.
    await c.query("insert into mockup_pages (version_id, tenant_id, product_id, position, page_id, title, width, height, html) values ('mv', 't', 'p', 1000, 'after', 'P', 800, 600, $1)", [`<p>${hyphened(127)}</p>`]);
    await c.end();
    await pool.end();
  }, 60_000);

  it.each([
    ["a Story page's document, story_versions then mockup_pages", "story_versions", "mockup_pages"],
    ["a search or an open mockup, mockup_pages then story_versions", "mockup_pages", "story_versions"],
  ])("lets a read in either order finish first, and then runs: %s", async (_what, first, second) => {
    const url = await aCopy();
    const { db, pool } = createDb(url, 1);
    const reader = await clientOf(url);
    const watcher = await clientOf(url);
    await reader.query("begin");
    await reader.query(`select 1 from ${first} limit 1`);
    const running = migrate(db, () => {});
    // Until the migration is waiting for one of them, holding whatever else it can.
    await until(async () => (await watcher.query<{ n: number }>("select count(*)::int as n from pg_locks l join pg_class c on c.oid = l.relation where not l.granted and c.relname in ('story_versions', 'mockup_pages')")).rows[0]!.n > 0, 10_000);
    const began = Date.now();
    await reader.query(`select 1 from ${second} limit 1`);
    // The migration gave way, in its own time and well before it could be called a deadlock.
    expect(Date.now() - began).toBeLessThan(900);
    await reader.query("commit");
    await expect(running).resolves.toContain(THE_MIGRATION);
    expect((await watcher.query<{ n: number }>("select count(*)::int as n from mockup_pages where tsv is not null")).rows[0]!.n).toBe(UNUSUAL.length + 1);
    await reader.end();
    await watcher.end();
    await pool.end();
  }, 60_000);

  it.each([
    ["mockup_pages then story_versions", "mockup_pages", "story_versions"],
    ["story_versions then mockup_pages", "story_versions", "mockup_pages"],
  ])("gets past steady reads all in one order, whichever it is: %s", async (_what, first, second) => {
    const url = await aCopy();
    const { db, pool } = createDb(url, 1);
    const watcher = await clientOf(url);
    let reading = true;
    const readers = await Promise.all(Array.from({ length: 16 }, () => clientOf(url)));
    const reads = readers.map(async (r) => {
      while (reading) {
        await r.query("begin");
        await r.query(`select 1 from ${first} limit 1`);
        await new Promise((go) => setTimeout(go, Math.random() * 30));
        await r.query(`select 1 from ${second} limit 1`);
        await r.query("commit");
      }
    });
    await new Promise((go) => setTimeout(go, 100));
    const running = migrate(db, () => {});
    await until(async () => (await watcher.query<{ n: number }>("select count(*)::int as n from pg_locks l join pg_class c on c.oid = l.relation where l.mode = 'AccessExclusiveLock' and l.granted and c.relname in ('story_versions', 'mockup_pages')")).rows[0]!.n === 2, 15_000);
    reading = false;
    await expect(running).resolves.toContain(THE_MIGRATION);
    await Promise.all(reads);
    await Promise.all(readers.map((r) => r.end()));
    await watcher.end();
    await pool.end();
  }, 60_000);

  it("holds both tables before it changes anything, and a save waiting for them stores the new words", async () => {
    const url = await aCopy();
    const { db, pool } = createDb(url, 1);
    const writer = await clientOf(url);
    const watcher = await clientOf(url);
    const running = migrate(db, () => {});
    await until(async () => (await watcher.query<{ n: number }>("select count(*)::int as n from pg_locks l join pg_class c on c.oid = l.relation where l.mode = 'AccessExclusiveLock' and l.granted and c.relname in ('story_versions', 'mockup_pages')")).rows[0]!.n === 2, 10_000);
    const saved = writer.query("insert into mockup_pages (version_id, tenant_id, product_id, position, page_id, title, width, height, html) values ('mv', 't', 'p', 1001, 'during', 'P', 800, 600, '<p>caf&eacute;</p>') returning search_text");
    await running;
    expect((await saved).rows[0].search_text).toBe("café");
    await writer.end();
    await watcher.end();
    await pool.end();
  }, 60_000);

  it("leaves nothing behind when it is ended partway, and runs again", async () => {
    const url = await aCopy();
    const { db, pool } = createDb(url, 1);
    const watcher = await clientOf(url);
    const running = migrate(db, () => {}).catch((e: Error) => e);
    let pid = 0;
    await until(async () => {
      const r = await watcher.query<{ pid: number }>("select l.pid from pg_locks l join pg_class c on c.oid = l.relation where l.mode = 'AccessExclusiveLock' and l.granted and c.relname in ('story_versions', 'mockup_pages') group by l.pid having count(*) = 2");
      pid = r.rows[0]?.pid ?? 0;
      return pid > 0;
    }, 10_000);
    const admin = new pg.Client({ connectionString: inject("adminUrl") });
    await admin.connect();
    await admin.query("select pg_terminate_backend($1)", [pid]);
    await admin.end();
    expect(await running).toBeInstanceOf(Error);
    await until(async () => (await held(watcher, pid)).length === 0, 10_000);
    const left = (await watcher.query<{ columns: number; functions: number; recorded: number; rows: number }>(`select
      (select count(*)::int from information_schema.columns where table_name in ('mockup_pages', 'story_versions') and column_name in ('search_text', 'tsv')) as columns,
      (select count(*)::int from pg_proc where proname in ('html_search_text', 'words_search_vector')) as functions,
      (select count(*)::int from schema_migrations where name = '${THE_MIGRATION}') as recorded,
      (select count(*)::int from mockup_pages) as rows`)).rows[0]!;
    expect(left).toEqual({ columns: 0, functions: 0, recorded: 0, rows: UNUSUAL.length + 2 });
    await pool.end();
    const again = createDb(url, 1);
    await expect(migrate(again.db, () => {})).resolves.toContain(THE_MIGRATION);
    await again.pool.end();
    await watcher.end();
  }, 60_000);
});
