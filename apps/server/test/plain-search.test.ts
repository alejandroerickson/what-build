import { closestWord, editDistanceWithin, excerpt, matchText, parseFind, swappedLettersTsquery, termTsquery, wordRoot } from "@whatbuild/core";
import { findCount, findPattern, findWords } from "@whatbuild/core/find-in-text";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shownWords } from "../../../packages/core/src/ops/plain-search.ts";
import { createPorts } from "../src/app.ts";
import { seed } from "../src/seed.ts";
import { startHarness, type Browser, type Harness } from "./harness.ts";

describe("how plain search reads a query", () => {
  it("marks every ending of a word whose ending doubles a letter, as search reads it", () => {
    expect("Plan, plans, planned, planning, and a bell ringing and filling".match(findPattern("planning")!)).toEqual(["Plan", "plans", "planned", "planning"]);
    expect("The Filling was filled and the fill was full".match(findPattern("filling")!)).toEqual(["Filling", "filled", "fill"]);
    // A word of four letters keeps its final e in a find: note marks notes, not every word that starts with not.
    expect("Nothing was noted in the notes".match(findPattern("note")!)).toEqual(["noted", "notes"]);
  });

  it("reads the pieces a find may mark from a root that starts each root the find marks from", () => {
    // Counting a source's matches reads the pieces its terms match as prefixes, so every place the
    // find marks is in one of them: the find's root of a word starts with search's.
    for (const w of ["pricing", "prices", "price", "planning", "planned", "note", "notes", "lies", "crew", "crews", "messages", "message", "ux", "scheduling", "quotes", "cb26-20734", "2026"]) {
      for (const marked of /\(\?:(.*)\)$/.exec(findPattern(w)!.source)![1]!.replace(/\\/g, "").split("|")) expect(marked.startsWith(wordRoot(w)), `${w}: ${marked} from ${wordRoot(w)}`).toBe(true);
    }
  });

  it("forgives endings, so one root is a prefix of every form", () => {
    expect(wordRoot("pricing")).toBe("pric");
    expect(wordRoot("prices")).toBe("pric");
    expect(wordRoot("price")).toBe("pric");
    expect(wordRoot("scheduling")).toBe("schedul");
    expect(wordRoot("planning")).toBe("plan");
    expect(wordRoot("integrations")).toBe("integr");
    // Short words are not cut into prefixes of unrelated ones.
    expect(wordRoot("pays")).toBe("pays");
    expect(wordRoot("used")).toBe("used");
  });

  it("matches the word being typed as a prefix, skips small words, and takes a kind as a hint", () => {
    // A word that names something every object has is still a word searched for.
    expect(parseFind("constructor crew ")).toMatchObject({ terms: [{ text: "constructor" }, { text: "crew" }], kind: null });
    expect(parseFind("how do crews plan the wee")).toMatchObject({
      terms: [
        { text: "crews", root: "crew", prefix: true },
        { text: "plan", root: "plan", prefix: true },
        { text: "wee", root: "wee", prefix: true },
      ],
      ignored: ["how", "do", "the"],
      kind: null,
    });
    expect(parseFind("mockups for the day planner ")).toMatchObject({ terms: [{ root: "day", prefix: false }, { root: "plan" }], kind: "mockup" });
    // A query of only small words or a kind still searches for them.
    expect(parseFind("the").terms).toHaveLength(1);
    expect(parseFind("mockups").terms).toMatchObject([{ text: "mockups" }]);
  });

  it("matches quoted words as a phrase", () => {
    expect(parseFind('"group chat" sunday')).toMatchObject({ terms: [{ text: "sunday", prefix: true }, { text: "group chat", phrase: true }] });
    // A quote still open while typing is a phrase so far.
    expect(parseFind('"group ch').terms).toMatchObject([{ text: "group ch", phrase: true }]);
  });

  it("reads an id or a number as one word, matched as written, a prefix only while it is typed", () => {
    expect(parseFind("CB26-20734 ").terms).toEqual([{ text: "cb26-20734", root: "cb26-20734", prefix: false, phrase: false }]);
    expect(parseFind("crane CB26-2073").terms).toMatchObject([{ text: "crane" }, { text: "cb26-2073", prefix: true }]);
    expect(parseFind("invoices 2026-05-01 ").terms.map((t) => t.text)).toEqual(["invoices", "2026-05-01"]);
    // Its ending is never forgiven, and a number of four digits is not a prefix once finished.
    expect(parseFind("2026s 2026 ").terms).toEqual([
      { text: "2026s", root: "2026s", prefix: false, phrase: false },
      { text: "2026", root: "2026", prefix: false, phrase: false },
    ]);
    // A hyphenated word without a digit is its words, as before; a phrase keeps an id whole.
    expect(parseFind("follow-up call ").terms.map((t) => t.text)).toEqual(["follow", "up", "call"]);
    expect(parseFind('"ticket CB26-20734"').terms).toMatchObject([{ text: "ticket cb26-20734", phrase: true }]);
    // Postgres reads the quoted id as it reads the text (cb26 <-> -20734), and stores a number after a hyphen with it.
    expect(termTsquery(parseFind("CB26-20734 ").terms[0]!)).toBe("'cb26-20734' | 'cb26' <-> '20734'");
    expect(termTsquery(parseFind("20734").terms[0]!)).toBe("'20734':* | '-20734':*");
    // An id with a letter in it is found as its words side by side too, in order; a date only as written.
    expect(termTsquery(parseFind("q3-planning ").terms[0]!)).toBe("'q3-planning' | 'q3' <-> 'planning'");
    expect(termTsquery(parseFind("covid-19").terms[0]!)).toBe("'covid-19':* | 'covid' <-> '19':*");
    expect(termTsquery(parseFind("2026-05-01 ").terms[0]!)).toBe("'2026-05-01' | '-2026-05-01'");
    expect(matchText("The Q3: planning call", parseFind("q3-planning ").terms).ranges).toEqual([[4, 16]]);
    expect(matchText("Planning for Q3", parseFind("q3-planning ").terms).found).toEqual([false]);
    expect(matchText("logged 2026 05 01", parseFind("2026-05-01 ").terms).found).toEqual([false]);
    // It ends a number after a hyphen before a letter, so a date is found in a timestamp; a number
    // alone runs on into letters, as 2020s is one word.
    expect(matchText("logged 2026-05-01T10:00", parseFind("2026-05-01 ").terms).found).toEqual([true]);
    expect(matchText("logged 2026-05-011", parseFind("2026-05-01 ").terms).found).toEqual([false]);
    expect(matchText("the 2020s", parseFind("2020 ").terms).found).toEqual([false]);
  });

  it("marks matches whatever the case or accents, and cuts an excerpt around the densest run", () => {
    const m = matchText("Café pricing: the PRICE was right.", parseFind("cafe price ").terms);
    expect(m.found).toEqual([true, true]);
    expect(m.ranges).toEqual([[0, 4], [5, 12], [18, 23]]);
    const long = `${"filler words here ".repeat(30)}the crew lead texts the office ${"more filler ".repeat(30)}`;
    const e = excerpt(long, matchText(long, parseFind("crew office ").terms), 120);
    expect(e.text.startsWith("…")).toBe(true);
    expect(e.marks.map(([a, b]) => e.text.slice(a, b))).toEqual(["crew", "office"]);
  });

  it("says where in its text the first match an excerpt marks starts", () => {
    const place = (query: string, text: string, width = 120) => excerpt(text, matchText(text, parseFind(query).terms), width).first;
    const long = `The crew ${"filler words here ".repeat(30)}the crew lead texts the office ${"more filler ".repeat(30)}`;
    // Not the crew at the start, which it leaves out, and counted in the text it was given, spaces and all.
    expect(place("crew office ", long)).toBe(long.indexOf("crew lead"));
    expect(place("crew ", "  Two   spaces,  then the crew.")).toBe("  Two   spaces,  then the ".length);
    expect(place("mower ", long)).toBeNull();
  });

  /** An excerpt of `text` for `query`, with what each mark covers. */
  const cut = (query: string, text: string, width = 120) => {
    const e = excerpt(text, matchText(text, parseFind(query).terms), width);
    return { text: e.text, marked: e.marks.map(([a, b]) => e.text.slice(a, b)) };
  };

  it("marks the words of a text whose folding moves offsets, an ellipsis or a ligature in it", () => {
    expect(cut('"crew message"', "Well… the crew lead said the crew message goes out at six.").marked).toEqual(["crew message"]);
    expect(cut("file crew", "The ﬁle says the crew is late.").marked).toEqual(["ﬁle", "crew"]);
    const m = matchText("½ of the crew… and the CREW", parseFind("crew ").terms);
    expect(m.ranges.map(([a, b]) => "½ of the crew… and the CREW".slice(a, b))).toEqual(["crew", "CREW"]);
  });

  it("centres an excerpt on the place where the most of the words occur, a phrase on the phrase itself", () => {
    // The phrase's first word comes early and alone; the excerpt is around the phrase, not it.
    const phrase = cut('"crew message"', `Crew notes. ${"The yard opens at dawn and the trucks leave. ".repeat(8)}Later the crew message came, after the trucks left.`);
    expect(phrase.marked).toEqual(["crew message"]);
    expect(phrase.text).toContain("Later the crew message came");
    // More matches of one word lose to fewer that hold every word.
    const words = cut("crew message ", `Crew crew crew crew crew. ${"The yard is busy at dawn. ".repeat(8)}The message reached every crew at noon. ${"Then nothing. ".repeat(8)}`);
    expect(words.marked).toEqual(["message", "crew"]);
    // The place is in the middle, with words on both sides of it.
    const mid = cut("gate code ", `${"word ".repeat(100)}the gate code ${"word ".repeat(100)}`);
    const at = mid.text.indexOf("gate code");
    expect(at).toBeGreaterThan(40);
    expect(mid.text.length - at).toBeGreaterThan(40);
  });

  it("starts and ends an excerpt at word boundaries, unless the mark would fall out, and always holds a mark", () => {
    for (const lead of ["", "a", "ab", "abc", "abcd"]) {
      const e = cut("gate ", `${lead}${"yardmaster ".repeat(20)}the gate is shut ${"evening ".repeat(20)}`);
      expect(e.marked, lead).toEqual(["gate"]);
      expect(e.text, lead).toMatch(/^…(yardmaster|the) /);
      expect(e.text, lead).toMatch(/ (evening|shut)…$/);
    }
    // A word too long to fit is cut, and so is a match longer than the excerpt, which is marked as far as it goes.
    const long = cut("gate", `${"x".repeat(60)} gate${"y".repeat(400)} end`, 100);
    expect(long.marked).toHaveLength(1);
    expect(long.marked[0]!.startsWith("gate")).toBe(true);
    // Emoji around the words are never cut in two.
    const e = cut("gate ", `${"🚧".repeat(80)} the gate ${"🚧".repeat(80)}`, 60);
    expect(e.marked).toEqual(["gate"]);
    expect(Buffer.from(e.text, "utf8").toString("utf8")).toBe(e.text);
  });

  it("shows Markdown as a reader sees its words: italics, code spans and a link's text, and nothing it only looks like", () => {
    expect(shownWords("The *crew board* is by the gate, see [the yard map](https://example.com/map_(v2) \"Map\") and `rota_v2`; _leads_ check it, as **every** lead does.")).toBe(
      "The crew board is by the gate, see the yard map and rota_v2; leads check it, as every lead does.",
    );
    expect(shownWords("***All of it*** and *a **b** c*, (*see below*), ![the board](board.png) and [a link](<https://example.com/a b>)")).toBe(
      "All of it and a b c, (see below), the board and a link",
    );
    // A code span shows what it holds as written; a fence's lines go, and what they hold stays.
    expect(shownWords("Run `*args*` and `` a ` b `` with `__init__`\n```ts\nconst crew = 2;\n```")).toBe("Run *args* and  a ` b  with __init__\n\nconst crew = 2;\n");
    // What is not italics, a link or code stays as written: words joined by underscores, sums, lone stars.
    for (const plain of ["snake_case_name and file_name.txt", "2*3*4 and a * b * c", "Cost* includes VAT*. *Note: draft", "*word*s and un*frig*ging", "[ref][1] and [x] done", "C:\\Users\\crew"])
      expect(shownWords(plain), plain).toBe(plain);
  });

  it("shows an escaped character alone, and never takes it for markup", () => {
    expect(shownWords("**Dana \\[PM\\]:** We plan \\*not italic\\*, \\_nor this\\_, \\`nor code\\` and a\\\\b.")).toBe("Dana [PM]: We plan *not italic*, _nor this_, `nor code` and a\\b.");
    expect(shownWords("\\# Not a heading\n\\- nor a list item, and \\[not a link\\](x)")).toBe("# Not a heading\n- nor a list item, and [not a link](x)");
    // In a link's text it shows; in an address it goes with the address; in a code span it is written as it is.
    expect(shownWords("[the \\[board\\]](https://example.com/a\\_b) and \\* and `a\\*b`")).toBe("the [board] and * and a\\*b");
    // Italics around an escaped character, and one inside italics, read as a reader sees them.
    expect(shownWords("\\(*the board*\\) and *the gate\\**")).toBe("(the board) and the gate*");
  });

  it("finds the word a misspelling meant among the product's own words", () => {
    const texts = ["The approval went through.", "Approvals take a week.", "We approved it."];
    expect(closestWord("aproval", texts, false)).toBe("approval");
    expect(closestWord("schedlue", ["the schedule changed"], false)).toBe("schedule");
    expect(closestWord("zzzz", texts, false)).toBeNull();
    // A word still being typed is compared with the start of each word.
    expect(closestWord("aprov", texts, true)).toBe("approval");
    // An id or a number is never corrected, and never offered as a correction.
    expect(closestWord("20735", ["Ticket CB26-20734 and ticket 20733"], false)).toBeNull();
    expect(closestWord("cb27", ["Ticket CB26-20734"], false)).toBeNull();
    expect(closestWord("rout", ["rout1 then the route"], false)).toBe("route");
    // A whole word one edit away beats a longer word whose start is, however often that one is said.
    expect(closestWord("treys", ["greyscale greyscale greyscale", "the trays"], true)).toBe("trays");
    expect(swappedLettersTsquery("tarys")).toContain("'trays'");
    // Two neighbouring letters swapped are one edit, wherever they are in the word.
    for (const typo of ["rtays", "tarys", "tryas", "trasy"]) expect(editDistanceWithin(typo, "trays", 1), typo).toBe(true);
    expect(editDistanceWithin("ytars", "trays", 1)).toBe(false);
    expect(closestWord("tryas", ["the trays"], false)).toBe("trays");
    expect(swappedLettersTsquery("two words")).toBeNull();
    expect(swappedLettersTsquery("aa")).toBeNull();
    // As the index holds a word, accents kept, and never a query too long for Postgres to take.
    expect(swappedLettersTsquery("Seañl")).toContain("'señal'");
    expect(swappedLettersTsquery("\uFB03".repeat(500))).toBeNull();
    expect(swappedLettersTsquery("a".repeat(65))).toBeNull();
  });
});

let h: Harness;
let sam: Browser;
let S: string;

beforeAll(async () => {
  h = await startHarness();
  await seed({ db: h.db, ports: createPorts(h.config, h.blobs, h.mailer) }, h.worker, () => {});
  sam = await h.signIn("sam@example.com", "Sam Okafor");
  const products = await sam.api("GET", "/api/v1/me/products");
  S = `/api/v1/p/${products.body.items.find((p: { name: string }) => p.name === "Crewboard").path}`;
});
afterAll(async () => h?.close());

const find = async (q: string, extra = "") => {
  const r = await sam.api("GET", `${S}/search?mode=plain&query=${encodeURIComponent(q)}${extra}`);
  expect(r.status).toBe(200);
  return r.body;
};

describe("plain search over the sample product", () => {
  const titles = (r: { results: { kind: string; title: string }[] }) => r.results.map((x) => `${x.kind}: ${x.title}`);

  it("finds every kind of thing in one search, a matching title first", async () => {
    const r = await find("crew message");
    // A Story page that shows a mockup page is listed once, as the mockup, which ranks as the page would.
    expect(titles(r)[0]).toBe("mockup: Planning the week: jobs first or days first");
    expect(r.results[0].meta.page_title).toBe("Crew message");
    expect(titles(r)).not.toContain("story: Crew message");
    // A Story page of its own that says the words is still listed.
    expect(new Set(r.results.map((x: { kind: string }) => x.kind))).toEqual(new Set(["story", "source", "mockup", "outcome", "idea"]));
    // A source appears once, with the best places it says the words: each names its field and where its piece starts.
    const greenline = r.results.find((x: { title: string }) => x.title.startsWith("Crew lead interview"));
    expect(greenline.hit_count).toBe(4);
    expect(greenline.hits).toHaveLength(3);
    expect(greenline.hits[0]).toMatchObject({ field: "text", annotation_id: null, char_start: expect.any(Number) });
    expect(greenline.hits[0]).not.toHaveProperty("seq");
    const h = greenline.hits[0];
    expect(h.marks.map(([a, b]: [number, number]) => h.text.slice(a, b).toLowerCase())).toEqual(expect.arrayContaining(["crew", "message"]));
    // The piece is read in the derived text from where it starts.
    const piece = await sam.api("GET", `${S}/sources/${greenline.id}/derived/text?offset=${h.char_start}&limit=2000`);
    const [a, b] = h.marks[0] as [number, number];
    expect(piece.body.text.replace(/\s+/g, " ")).toContain(h.text.slice(a, b));
  });

  it("forgives endings, and matches the word being typed as a prefix", async () => {
    const r = await find("pricing");
    expect(titles(r)).toEqual(["source: Owner interview — Oak & Ash Grounds, Aug 2026"]);
    expect(r.results[0].hits[0].text).toContain("a price the same day");
    expect(titles(await find("greenl"))).toContain("source: Crew lead interview — Greenline Landscaping, Aug 2026");
  });

  it("corrects a word that matches nothing, says so, and searches as typed when asked", async () => {
    const r = await find("quoet");
    expect(r.corrections).toEqual([{ from: "quoet", to: "quote" }]);
    expect(titles(r)).toEqual(["source: Owner interview — Oak & Ash Grounds, Aug 2026"]);
    const strict = await find("quoet", "&strict=true");
    expect(strict).toMatchObject({ corrections: [], results: [], partial: false });
    expect((await find("owners plan the wek")).corrections).toEqual([{ from: "wek", to: "week" }]);
  });

  it("skips small words, brings a named kind first, and opens a mockup on the page that matches", async () => {
    const r = await find("how do owners plan the week");
    expect(r.ignored).toEqual(["how", "do", "the"]);
    expect(r.partial).toBe(false);
    const m = await find("mockups jobs");
    expect(m.kind_hint).toBe("mockup");
    expect(m.results[0]).toMatchObject({ kind: "mockup", meta: { page_id: "jobs-board" } });
  });

  it("lists a named kind first, ahead of things the words alone rank higher, and the rest as the words rank them", async () => {
    const key = (x: { kind: string; id: string }) => `${x.kind}:${x.id}`;
    const crew = await find("crew");
    expect(crew.kind_hint).toBeNull();
    // Sources say "crew" more than the outcome does: by the words alone, one leads it.
    expect(crew.results.findIndex((x: { kind: string }) => x.kind === "outcome")).toBeGreaterThan(crew.results.findIndex((x: { kind: string }) => x.kind === "source"));
    for (const [q, kind] of [["mockups crew", "mockup"], ["crew assumptions", "assumption"], ["outcomes crew", "outcome"]] as const) {
      const r = await find(q);
      expect(r.kind_hint).toBe(kind);
      const named = crew.results.filter((x: { kind: string }) => x.kind === kind);
      expect(named.length, q).toBeGreaterThan(0);
      expect(r.results.map(key), q).toEqual([...named, ...crew.results.filter((x: { kind: string }) => x.kind !== kind)].map(key));
    }
  });

  it("shows what holds most of the words when nothing holds all of them, naming what is missing", async () => {
    const r = await find("zebra pricing ");
    expect(r.partial).toBe(true);
    expect(r.results[0].missing).toEqual(["zebra"]);
  });

  it("narrows to one source's hits, every one of them", async () => {
    const all = await find("crew message");
    const id = all.results.find((x: { kind: string }) => x.kind === "source").id;
    const one = await find("crew", `&record_id=${id}`);
    expect(one.results).toHaveLength(1);
    expect(one.results[0].hits).toHaveLength(one.results[0].hit_count);
  });

  it("returns at most limit results, 60 unless asked, and counts every match", async () => {
    const all = await find("crew");
    const matched = Object.values(all.counts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(all.results).toHaveLength(Math.min(60, matched));
    expect(matched).toBeGreaterThan(2);
    const two = await find("crew", "&limit=2");
    expect(two.results).toEqual(all.results.slice(0, 2));
    expect(two.counts).toEqual(all.counts);
    expect((await sam.api("GET", `${S}/search?mode=plain&query=crew&limit=201`)).body).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("takes no tag or date filters, and keeps its own options to itself", async () => {
    expect((await sam.api("GET", `${S}/search?mode=plain&query=crew&tags=interview`)).body).toMatchObject({ error: { code: "invalid_filter" } });
    expect((await sam.api("GET", `${S}/search?query=crew&strict=true`)).body).toMatchObject({ error: { code: "invalid_filter" } });
  });

  it("reads only the Story for someone who reads only the Story", async () => {
    const jordan = await h.signIn("jordan@example.com");
    const r = await jordan.api("GET", `${S}/search?mode=plain&query=crew`);
    expect(r.status).toBe(200);
    expect(r.body.results.length).toBeGreaterThan(0);
    expect(new Set(r.body.results.map((x: { kind: string }) => x.kind))).toEqual(new Set(["story"]));
    expect(r.body.counts).not.toHaveProperty("source");
    expect((await jordan.api("GET", `${S}/search?query=crew`)).status).toBe(403);
  });
});

describe("plain search's counts", () => {
  it("counts every source that matched, beyond the pieces its results are built from", async () => {
    const lee = await h.signIn("lee@example.com", "Lee Example");
    const t = await lee.api("POST", "/api/v1/tenants", { name: "Ledger Co" });
    const p = await lee.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Ledger" });
    const L = `/api/v1/p/${p.body.path}`;
    const source = async (title: string, content: string) => {
      const r = await lee.api("POST", `${L}/sources`, { title, tags: [] });
      expect((await lee.api("PUT", `${L}/sources/${r.body.record_id}/derived/text`, { content })).status).toBe(200);
      return r.body.record_id as string;
    };
    // One source says the word once; another says it twice in each of more pieces than results are
    // built from, so all of those rank above the first source's one.
    await source("Yard ledger — Example Co", "The quorvel entry is at the end of the yard ledger.\n");
    const filler = "the ledger line is kept by the yard office ".repeat(22);
    const many = await source("Depot ledger — Example Co", Array.from({ length: 410 }, (_, k) => `Entry ${k}: quorvel ${filler}quorvel.`).join("\n\n") + "\n");
    const r = await lee.api("GET", `${L}/search?mode=plain&query=quorvel`);
    expect(r.status).toBe(200);
    expect(r.body.hits_matched).toBe(411);
    expect(r.body.results.map((x: { id: string }) => x.id)).toEqual([many]);
    // Both sources matched, so say so, though only one came back.
    expect(r.body.counts).toEqual({ source: 2 });
    // A source holds every word or it is not counted, when something holds them all.
    const both = await lee.api("GET", `${L}/search?mode=plain&query=${encodeURIComponent("quorvel depot")}`);
    expect(both.body).toMatchObject({ partial: false, counts: { source: 1 } });
  });
});

/** A text with an ellipsis, where the phrase's first word comes long before the phrase. */
const YARD = `Well… the crew lead said so. ${"The yard opens at dawn and the trucks leave on time. ".repeat(12)}Later the crew message came, after the trucks left the yard.\n`;

describe("plain search's excerpts", () => {
  let lee: Browser;
  let L: string;
  let note: string;

  beforeAll(async () => {
    lee = await h.signIn("lee.excerpts@example.com", "Lee Excerpts");
    const t = await lee.api("POST", "/api/v1/tenants", { name: "Excerpt Co" });
    const p = await lee.api("POST", `/api/v1/teams/${t.body.tenant.slug}/${t.body.team.slug}/products`, { name: "Dispatch" });
    L = `/api/v1/p/${p.body.path}`;
    const product = await lee.api("GET", L);
    const concept = "## Who it is for\n\n- **Crew leads** who send the morning dispatch\n- > Owners who read it later";
    expect((await lee.api("PATCH", `${L}/idea/concept`, { expected_etag: product.body.etag, concept })).status).toBe(200);
    const a = await lee.api("POST", `${L}/assumptions`, { statement: "Leads read the board first.", body: "## Why\n\n- The **dispatch** board is by the door.\n- > Quoted: every lead checks it." });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const r = await lee.api("POST", `${L}/sources`, { title: "Yard notes — Example Co", tags: [] });
    note = r.body.record_id;
    expect((await lee.api("PUT", `${L}/sources/${note}/derived/text`, { content: YARD })).status).toBe(200);
  });

  it("shows an assumption's body and the product concept as words, as a source's text is, without the Markdown", async () => {
    const r = (await lee.api("GET", `${L}/search?mode=plain&query=dispatch`)).body;
    const snippets = r.results.filter((x: { kind: string }) => x.kind === "assumption" || x.kind === "idea").map((x: { kind: string; snippet: string }) => [x.kind, x.snippet]);
    expect(snippets).toEqual([
      ["assumption", "Why The dispatch board is by the door. Quoted: every lead checks it."],
      ["idea", "Who it is for Crew leads who send the morning dispatch Owners who read it later"],
    ].sort((a, b) => (r.results.findIndex((x: { kind: string }) => x.kind === a[0]) - r.results.findIndex((x: { kind: string }) => x.kind === b[0]))));
    for (const x of r.results) expect(x.snippet ?? "", x.kind).not.toMatch(/##|\*\*|(^|\s)[->] /);
  });

  it("shows italics, code and a link as their words in an assumption's body, a mockup's notes and a source's text, its marks on the words shown", async () => {
    const md = "The *night crew* keeps the rota in `rota_v2`, beside [the yard map](https://example.com/yard_map_(v2)), as _every_ lead does.";
    expect((await lee.api("POST", `${L}/assumptions`, { statement: "Night crews keep their own rota.", body: md })).status).toBe(201);
    const mockup = await lee.api("POST", `${L}/mockups`, { title: "Rota screen", pages: [{ page_id: "rota", title: "Rota", html: "<p>Shifts</p>", notes: md }] });
    expect(mockup.status, JSON.stringify(mockup.body)).toBe(201);
    const source = await lee.api("POST", `${L}/sources`, { title: "Shift notes — Example Co", tags: [] });
    expect((await lee.api("PUT", `${L}/sources/${source.body.record_id}/derived/text`, { content: `${md}\n` })).status).toBe(200);

    const r = (await lee.api("GET", `${L}/search?mode=plain&query=${encodeURIComponent('"yard map" rota')}`)).body;
    const of = (kind: string) => r.results.find((x: { kind: string }) => x.kind === kind);
    const hits = of("source").hits as { text: string; marks: [number, number][]; char_start: number }[];
    const excerpts = [
      { text: of("assumption").snippet, marks: of("assumption").snippet_marks },
      { text: of("mockup").snippet, marks: of("mockup").snippet_marks },
      ...hits.map((x) => ({ text: x.text, marks: x.marks })),
    ];
    expect(excerpts).toHaveLength(3);
    for (const e of excerpts) {
      expect(e.text).toBe("The night crew keeps the rota in rota_v2, beside the yard map, as every lead does.");
      expect(e.marks.map(([a, b]: [number, number]) => e.text.slice(a, b))).toEqual(["rota", "rota", "yard map"]);
    }
    // A hit still says where its piece starts in the text as written, which a reader opens it at.
    expect(hits[0]).toMatchObject({ field: "text", char_start: 0 });
  });

  it("shows an escaped character alone in an excerpt, its marks on the words shown", async () => {
    const md = "The \\*late\\* crew pins \\[the gate rota\\] by the hut, and \\_every\\_ lead reads the rota twice.";
    expect((await lee.api("POST", `${L}/assumptions`, { statement: "Late crews read the hut first.", body: md })).status).toBe(201);
    const source = await lee.api("POST", `${L}/sources`, { title: "Hut notes — Example Co", tags: [] });
    // A first paragraph long enough to be pieces of its own, so the escaped one is a piece that starts after it.
    const first = "The hut opens at six and the crews come in one by one. ".repeat(30).trim();
    expect((await lee.api("PUT", `${L}/sources/${source.body.record_id}/derived/text`, { content: `${first}\n\n${md}\n` })).status).toBe(200);

    const r = (await lee.api("GET", `${L}/search?mode=plain&query=${encodeURIComponent('"gate rota" late')}`)).body;
    const assumption = r.results.find((x: { kind: string }) => x.kind === "assumption");
    const hit = r.results.find((x: { kind: string; id: string }) => x.kind === "source" && x.id === source.body.record_id).hits[0];
    const shown = "The *late* crew pins [the gate rota] by the hut, and _every_ lead reads the rota twice.";
    for (const e of [{ text: assumption.snippet, marks: assumption.snippet_marks }, { text: hit.text, marks: hit.marks }]) {
      expect(e.text).toContain(shown);
      expect(e.marks.map(([a, b]: [number, number]) => e.text.slice(a, b))).toEqual(["late", "gate rota"]);
    }
    expect(hit.text).not.toContain("\\");
    // Where its piece starts is counted in the text as written, backslashes and all.
    expect(hit.char_start).toBe(first.length + 2);
    const at = await lee.api("GET", `${L}/sources/${source.body.record_id}/derived/text?offset=${hit.char_start}&limit=40`);
    expect(at.body.text.startsWith("The \\*late\\* crew")).toBe(true);
  });

  it("counts a source's matches as its Find in the text does, in its text alone, beside the places it says them", async () => {
    const rota = await lee.api("POST", `${L}/sources`, { title: "Rota — Example Co", tags: [] });
    const text = "The crew leaves at six.\n\nEvery crew lead checks the crew board, and crews swap on Fridays.\n";
    expect((await lee.api("PUT", `${L}/sources/${rota.body.record_id}/derived/text`, { content: text })).status).toBe(200);
    const board = await lee.api("POST", `${L}/sources`, { title: "Board — Example Co", tags: [] });
    expect((await lee.api("PUT", `${L}/sources/${board.body.record_id}/agent-notes/summary`, { content: "The crew board is by the gate." })).status).toBe(200);
    const r = (await lee.api("GET", `${L}/search?mode=plain&query=crew`)).body;
    const of = (id: string) => r.results.find((x: { id: string }) => x.id === id);
    // One place (the text is one piece) where the find marks four words: crew, crew, crew and crews.
    expect(of(rota.body.record_id)).toMatchObject({ hit_count: 1, match_count: 4 });
    expect(of(rota.body.record_id).match_count).toBe(findCount(text, findPattern(findWords(r.terms))!));
    // A source that says it only in its summary has a place, and nothing for the find to mark in its text.
    expect(of(board.body.record_id)).toMatchObject({ hit_count: 1, match_count: 0 });
    // A phrase counts as the find marks it, and narrowing to the source counts the same.
    const phrase = (await lee.api("GET", `${L}/search?mode=plain&query=${encodeURIComponent('"crew board"')}&record_id=${rota.body.record_id}`)).body;
    expect(phrase.results[0]).toMatchObject({ id: rota.body.record_id, match_count: 1 });
    const yard = (await lee.api("GET", `${L}/search?mode=plain&query=crew&record_id=${note}`)).body;
    expect(yard.results[0].match_count).toBe(findCount(YARD, findPattern("crew")!));
  });

  describe("where a hit's match starts", () => {
    async function hitFor(title: string, content: string, query: string) {
      const source = await lee.api("POST", `${L}/sources`, { title, tags: [] });
      expect((await lee.api("PUT", `${L}/sources/${source.body.record_id}/derived/text`, { content })).status).toBe(200);
      const r = (await lee.api("GET", `${L}/search?mode=plain&query=${encodeURIComponent(query)}&record_id=${source.body.record_id}`)).body;
      const hit = r.results[0].hits[0];
      const from = async (offset: number) => (await lee.api("GET", `${L}/sources/${source.body.record_id}/derived/text?offset=${offset}&limit=30`)).body.text as string;
      return { hit, marked: hit.marks.map(([a, b]: [number, number]) => hit.text.slice(a, b)) as string[], from };
    }

    it("is the first the excerpt marks, past an earlier match in its piece that the excerpt leaves out", async () => {
      const rows = Array.from({ length: 12 }, (_, i) => `| crew ${i} | hedges and borders along the drive |`).join("\n");
      const content = `| crew | spare_flailmower |\n|---|---|\n${rows}\n| crew 20 | flailmower only |\n| crew 21 | flailmower only |\n| crew 22 | flailmower only |\n`;
      const { hit, marked, from } = await hitFor("Flail survey — Example Co", content, "flailmower");
      expect(hit.char_start).toBe(0);
      expect(marked[0]).toBe("flailmower");
      expect(hit.text).not.toContain("spare_");
      expect(hit.match_start).toBe(content.indexOf("flailmower only"));
      expect((await from(hit.match_start)).startsWith("flailmower only")).toBe(true);
    });

    it("is the word searched, not an earlier one that only starts like it, in a piece that starts later", async () => {
      const first = "The hut opens at six and the crews come in one by one. ".repeat(30).trim();
      const content = `${first}\n\nNothing is settled and the notes are thin. ${"Words go by here. ".repeat(14)}\nThe lead would not trust a thornrota that changes daily.\n`;
      const { hit, marked, from } = await hitFor("Thorn rota — Example Co", content, "would not trust a thornrota");
      expect(hit.char_start).toBeGreaterThan(first.length);
      expect(hit.match_start).toBeGreaterThan(hit.char_start);
      expect(marked).toEqual(["not", "trust", "thornrota"]);
      expect((await from(hit.match_start)).startsWith("not trust a thornrota")).toBe(true);
    });

    it("is counted in code points in the text as written, whatever Markdown its excerpt leaves out", async () => {
      const content = "# 😀 Heading\n\n**Bold** and *italic*, \\*escaped\\*, `code`, [a link](https://example.com/sloeberry/x) and ![a picture](sloeberry.png), then:\n\n- the sloeberry jam\n";
      const { hit, marked, from } = await hitFor("Sloe notes — Example Co", content, "sloeberry");
      expect(hit.text).toContain("Bold and italic, *escaped*, code, a link and a picture");
      expect(marked).toEqual(["sloeberry"]);
      expect(hit.match_start).toBe([...content.slice(0, content.indexOf("sloeberry jam"))].length);
      expect((await from(hit.match_start)).startsWith("sloeberry jam")).toBe(true);
    });

    it("is where its piece starts when the excerpt marks nothing, the words being only in what is not shown", async () => {
      const content = "See [the guide](quincepress) for more.\n";
      const { hit, marked } = await hitFor("Quince guide — Example Co", content, "quincepress");
      expect(marked).toEqual([]);
      expect(hit.match_start).toBe(hit.char_start);
    });
  });

  it("centres a phrase's hit on the phrase, marked, in a text with an ellipsis before it", async () => {
    for (const q of ['"crew message"', '"crew message" ']) {
      const r = (await lee.api("GET", `${L}/search?mode=plain&query=${encodeURIComponent(q)}`)).body;
      const source = r.results.find((x: { id: string }) => x.id === note);
      expect(source, q).toBeDefined();
      for (const hit of source.hits) {
        expect(hit.marks.length, hit.text).toBeGreaterThan(0);
        expect(hit.marks.map(([a, b]: [number, number]) => hit.text.slice(a, b).toLowerCase())).toContain("crew message");
        // It starts at a word's start, not inside one.
        const words = YARD.replace(/\s+/g, " ").trim();
        const at = words.indexOf(hit.text.replace(/^…/, "").replace(/…$/, ""));
        expect(at, hit.text).toBeGreaterThanOrEqual(0);
        expect(at === 0 || /[^\p{L}\p{N}]/u.test(words[at - 1]!), hit.text).toBe(true);
      }
    }
  });
});
